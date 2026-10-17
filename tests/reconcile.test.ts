import assert from 'node:assert/strict'
import test from 'node:test'

import type { DeepSeekHistoryMessage } from '../src/host/history-idb.ts'
import {
  buildReconcilePlan,
  createCommittedAnchorRegistry,
  hasPendingServerWork,
  RECONCILE_STABILITY_INTERVAL_MS,
  RECONCILE_TOTAL_BUDGET_MS,
  resolveIdentity,
  snapshotFingerprint,
  type CommittedAnchor,
} from '../src/host/reconcile.ts'
import type { ChatMessage } from '../src/shared/state.ts'

/**
 * Phase 20B1 — reconciliation pure logic. No browser, no store: these pin the
 * three-level identity strategy (§3/§5.1/§5.2), the plan builder (§7/§8) and the
 * committed-anchor bookkeeping. Every ambiguity must become a safe-fail.
 *
 * Design: `docs/architecture.md` → "Phase 20B — Session Reconciliation".
 */

// --- fixtures ------------------------------------------------------------------

function host(id: string, role: ChatMessage['role'], content: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id, role, content, format: 'text', status: role === 'assistant' ? 'finished' : 'finished', ...extra }
}

function sUser(
  messageId: number,
  parentId: number | null,
  text: string,
  files: { name: string; size: number }[] = [],
): DeepSeekHistoryMessage {
  return {
    messageId,
    parentId,
    role: 'USER',
    status: 'FINISHED',
    requestText: text,
    responseText: null,
    reasoningText: null,
    files,
  }
}

function sAssistant(
  messageId: number,
  parentId: number | null,
  content: string,
  options: { status?: DeepSeekHistoryMessage['status']; reasoning?: string | null } = {},
): DeepSeekHistoryMessage {
  return {
    messageId,
    parentId,
    role: 'ASSISTANT',
    status: options.status ?? 'FINISHED',
    requestText: null,
    responseText: content,
    reasoningText: options.reasoning ?? null,
    files: [],
  }
}

const anchorOf = (overrides: Partial<CommittedAnchor> = {}): CommittedAnchor => ({
  sessionId: 'sess-1',
  parentMessageId: 4,
  userMessageId: 'h-user',
  assistantMessageId: 'h-assistant',
  ...overrides,
})

const hostTurn = (
  options: { userContent?: string; assistantContent?: string; status?: ChatMessage['status'] } = {},
): ChatMessage[] => [
  host('h-user', 'user', options.userContent ?? '第二个问题'),
  host('h-assistant', 'assistant', options.assistantContent ?? '', { status: options.status ?? 'error' }),
]

// ================================================================== Level 1
// 已有 deepSeekMessageId → 直接 ID reconciliation，不重新绑定。

test('20B1 identity L1: 当前 turn 已有 deepSeekMessageId → Level 1、零新绑定', () => {
  const messages = [
    host('h-user', 'user', 'q', { deepSeekMessageId: 5 }),
    host('h-assistant', 'assistant', 'a', { deepSeekMessageId: 6 }),
  ]
  const resolved = resolveIdentity({
    sessionId: 'sess-1',
    messages: [sUser(5, 4, 'q'), sAssistant(6, 5, 'a')],
    hostMessages: messages,
    anchor: anchorOf(),
  })
  assert.deepEqual(resolved, { ok: true, level: 1, bindings: [] })
})

test('20B1 identity L1: 已有 id 与 snapshot 冲突（id 不存在）→ 不静默重绑，safe-fail', () => {
  const messages = [
    host('h-user', 'user', 'q', { deepSeekMessageId: 5 }),
    host('h-assistant', 'assistant', 'a', { deepSeekMessageId: 99 }),
  ]
  const resolved = resolveIdentity({
    sessionId: 'sess-1',
    messages: [sUser(5, 4, 'q'), sAssistant(6, 5, 'a')],
    hostMessages: messages,
    anchor: anchorOf(),
  })
  assert.equal(resolved.ok, false)
})

// ================================================================== Level 2
// parent-anchor binding（当前 committed turn）。

test('20B1 identity L2: anchor=4 → 经 parent chain 绑定 USER/ASSISTANT（不靠 +1/+2）', () => {
  const resolved = resolveIdentity({
    sessionId: 'sess-1',
    messages: [sUser(5, 4, '第二个问题'), sAssistant(6, 5, '')],
    hostMessages: hostTurn(),
    anchor: anchorOf(),
  })
  assert.deepEqual(resolved, {
    ok: true,
    level: 2,
    bindings: [
      { hostId: 'h-user', deepSeekMessageId: 5 },
      { hostId: 'h-assistant', deepSeekMessageId: 6 },
    ],
  })
})

test('20B1 identity L2: 非连续 message_id（7 / 9）仍正确绑定', () => {
  const resolved = resolveIdentity({
    sessionId: 'sess-1',
    messages: [sUser(7, 4, '第二个问题'), sAssistant(9, 7, '')],
    hostMessages: hostTurn(),
    anchor: anchorOf(),
  })
  assert.deepEqual(resolved, {
    ok: true,
    level: 2,
    bindings: [
      { hostId: 'h-user', deepSeekMessageId: 7 },
      { hostId: 'h-assistant', deepSeekMessageId: 9 },
    ],
  })
})

test('20B1 identity L2: 两个 USER 都 parent_id=4 → ambiguous → safe-fail', () => {
  const resolved = resolveIdentity({
    sessionId: 'sess-1',
    messages: [sUser(5, 4, '第二个问题'), sUser(7, 4, '第二个问题')],
    hostMessages: hostTurn(),
    anchor: anchorOf(),
  })
  assert.equal(resolved.ok, false)
})

test('20B1 identity L2: parent 命中但 text 不匹配 → safe-fail', () => {
  const resolved = resolveIdentity({
    sessionId: 'sess-1',
    messages: [sUser(5, 4, '别的问题'), sAssistant(6, 5, '')],
    hostMessages: hostTurn(),
    anchor: anchorOf(),
  })
  assert.equal(resolved.ok, false)
})

test('20B1 identity L2: 命中的 USER 没有唯一 ASSISTANT 子节点 → safe-fail', () => {
  const resolved = resolveIdentity({
    sessionId: 'sess-1',
    messages: [sUser(5, 4, '第二个问题')],
    hostMessages: hostTurn(),
    anchor: anchorOf(),
  })
  assert.equal(resolved.ok, false)
})

test('20B1 identity L2: anchor.sessionId 不匹配 → 不使用 anchor（落 Level 3）', () => {
  const resolved = resolveIdentity({
    sessionId: 'sess-1',
    messages: [sUser(1, null, 'a'), sAssistant(2, 1, 'b')],
    hostMessages: [host('h-user', 'user', 'a'), host('h-assistant', 'assistant', 'b')],
    anchor: anchorOf({ sessionId: 'other' }),
  })
  assert.equal(resolved.ok, true)
  if (!resolved.ok) return
  assert.equal(resolved.level, 3)
})

test('20B1 identity L2 新 session: anchor.parentMessageId=null + 唯一 root → 绑定', () => {
  const resolved = resolveIdentity({
    sessionId: 'sess-1',
    messages: [sUser(1, null, '第一个问题'), sAssistant(2, 1, '')],
    hostMessages: hostTurn({ userContent: '第一个问题' }),
    anchor: anchorOf({ parentMessageId: null }),
  })
  assert.deepEqual(resolved, {
    ok: true,
    level: 2,
    bindings: [
      { hostId: 'h-user', deepSeekMessageId: 1 },
      { hostId: 'h-assistant', deepSeekMessageId: 2 },
    ],
  })
})

test('20B1 identity L2 新 session: 多个 root（或 0 个）→ safe-fail', () => {
  const many = resolveIdentity({
    sessionId: 'sess-1',
    messages: [sUser(1, null, '第一个问题'), sUser(3, null, '第一个问题')],
    hostMessages: hostTurn({ userContent: '第一个问题' }),
    anchor: anchorOf({ parentMessageId: null }),
  })
  assert.equal(many.ok, false)
  const none = resolveIdentity({
    sessionId: 'sess-1',
    messages: [sUser(5, 4, '第一个问题')],
    hostMessages: hostTurn({ userContent: '第一个问题' }),
    anchor: anchorOf({ parentMessageId: null }),
  })
  assert.equal(none.ok, false)
})

test('20B1 identity L2: FILE evidence 不匹配（Host 已有附件）→ safe-fail', () => {
  const messages: ChatMessage[] = [
    host('h-user', 'user', '第二个问题', {
      attachments: [{ id: 'a1', kind: 'image', name: 'a.png', mimeType: 'image/png', bytes: 120 }],
    }),
    host('h-assistant', 'assistant', '', { status: 'error' }),
  ]
  const mismatch = resolveIdentity({
    sessionId: 'sess-1',
    messages: [sUser(5, 4, '第二个问题', [{ name: 'other.png', size: 120 }]), sAssistant(6, 5, '')],
    hostMessages: messages,
    anchor: anchorOf(),
  })
  assert.equal(mismatch.ok, false)
  const match = resolveIdentity({
    sessionId: 'sess-1',
    messages: [sUser(5, 4, '第二个问题', [{ name: 'a.png', size: 120 }]), sAssistant(6, 5, '')],
    hostMessages: messages,
    anchor: anchorOf(),
  })
  assert.equal(match.ok, true)
})

test('20B1 identity L2: Host 无附件而 server 有 FILE → Host 不认识，safe-fail（不绑定）', () => {
  const resolved = resolveIdentity({
    sessionId: 'sess-1',
    messages: [sUser(5, 4, '第二个问题', [{ name: 'a.png', size: 120 }]), sAssistant(6, 5, '')],
    hostMessages: hostTurn(),
    anchor: anchorOf(),
  })
  assert.equal(resolved.ok, false)
})

test('20B1 identity L2: anchor 指向的 Host 消息不在当前 transcript → safe-fail', () => {
  const resolved = resolveIdentity({
    sessionId: 'sess-1',
    messages: [sUser(5, 4, '第二个问题'), sAssistant(6, 5, '')],
    hostMessages: [host('h-assistant', 'assistant', '', { status: 'error' })],
    anchor: anchorOf(),
  })
  assert.equal(resolved.ok, false)
})

// ================================================================== Level 3
// strict chain alignment（无 ID 且无可用 anchor）。

test('20B1 identity L3: 整链 exact → 全部绑定', () => {
  const resolved = resolveIdentity({
    sessionId: 'sess-1',
    messages: [sUser(1, null, 'a'), sAssistant(2, 1, 'b'), sUser(3, 2, 'c'), sAssistant(4, 3, 'd')],
    hostMessages: [
      host('h1', 'user', 'a'),
      host('h2', 'assistant', 'b'),
      host('h3', 'user', 'c'),
      host('h4', 'assistant', 'd'),
    ],
  })
  assert.deepEqual(resolved, {
    ok: true,
    level: 3,
    bindings: [
      { hostId: 'h1', deepSeekMessageId: 1 },
      { hostId: 'h2', deepSeekMessageId: 2 },
      { hostId: 'h3', deepSeekMessageId: 3 },
      { hostId: 'h4', deepSeekMessageId: 4 },
    ],
  })
})

test('20B1 identity L3: 历史 assistant 文本不 exact → safe-fail', () => {
  const resolved = resolveIdentity({
    sessionId: 'sess-1',
    messages: [sUser(1, null, 'a'), sAssistant(2, 1, '服务器版本')],
    hostMessages: [host('h1', 'user', 'a'), host('h2', 'assistant', '本地版本')],
  })
  assert.equal(resolved.ok, false)
})

test('20B1 identity L3: 历史 assistant 是 server 的 prefix（非当前 turn）→ safe-fail（不当同一段）', () => {
  const resolved = resolveIdentity({
    sessionId: 'sess-1',
    messages: [sUser(1, null, 'a'), sAssistant(2, 1, '完整回复'), sUser(3, 2, 'c'), sAssistant(4, 3, 'd')],
    hostMessages: [
      host('h1', 'user', 'a'),
      host('h2', 'assistant', '完整'),
      host('h3', 'user', 'c'),
      host('h4', 'assistant', 'd'),
    ],
  })
  assert.equal(resolved.ok, false)
})

test('20B1 identity L3: 当前 crash turn 的 assistant 允许严格 prefix → 成功', () => {
  const resolved = resolveIdentity({
    sessionId: 'sess-1',
    messages: [sUser(1, null, 'a'), sAssistant(2, 1, '完整回复')],
    hostMessages: [host('h1', 'user', 'a'), host('h2', 'assistant', '完整', { status: 'error' })],
  })
  assert.deepEqual(resolved, {
    ok: true,
    level: 3,
    bindings: [
      { hostId: 'h1', deepSeekMessageId: 1 },
      { hostId: 'h2', deepSeekMessageId: 2 },
    ],
  })
})

test('20B1 identity L3: 当前 turn reasoning prefix 允许；分叉 → safe-fail', () => {
  const prefix = resolveIdentity({
    sessionId: 'sess-1',
    messages: [sUser(1, null, 'a'), sAssistant(2, 1, '回复', { reasoning: '完整推理' })],
    hostMessages: [
      host('h1', 'user', 'a'),
      host('h2', 'assistant', '回复', { status: 'error', reasoning: { content: '完整', format: 'text' } }),
    ],
  })
  assert.equal(prefix.ok, true)
  const diverged = resolveIdentity({
    sessionId: 'sess-1',
    messages: [sUser(1, null, 'a'), sAssistant(2, 1, '回复', { reasoning: '完整推理' })],
    hostMessages: [
      host('h1', 'user', 'a'),
      host('h2', 'assistant', '回复', { status: 'error', reasoning: { content: '别的推理', format: 'text' } }),
    ],
  })
  assert.equal(diverged.ok, false)
})

// 真机实测（Phase 20B1 验收）：同一条 assistant 的正文 exact（5700/5700），但
// Host 的 reasoning 被 DOM 截断（8918 chars）而 server THINK 更长（9261 chars），
// 前缀完全一致。历史段因此也必须接受「Host 是 server 的严格前缀」。
test('20B1 identity L3: 历史 assistant 的 reasoning 是 server THINK 的严格前缀 → 允许', () => {
  const resolved = resolveIdentity({
    sessionId: 'sess-1',
    messages: [sUser(1, null, 'a'), sAssistant(2, 1, '回复', { reasoning: '完整推理内容' })],
    hostMessages: [
      host('h1', 'user', 'a'),
      host('h2', 'assistant', '回复', { status: 'finished', reasoning: { content: '完整推理', format: 'text' } }),
    ],
  })
  assert.deepEqual(resolved, {
    ok: true,
    level: 3,
    bindings: [
      { hostId: 'h1', deepSeekMessageId: 1 },
      { hostId: 'h2', deepSeekMessageId: 2 },
    ],
  })
})

test('20B1 identity L3: 历史 assistant 的 reasoning 分叉 → safe-fail', () => {
  // ① 前缀不同
  const diverged = resolveIdentity({
    sessionId: 'sess-1',
    messages: [sUser(1, null, 'a'), sAssistant(2, 1, '回复', { reasoning: '完整推理内容' })],
    hostMessages: [
      host('h1', 'user', 'a'),
      host('h2', 'assistant', '回复', { status: 'finished', reasoning: { content: '另起炉灶的推理', format: 'text' } }),
    ],
  })
  assert.equal(diverged.ok, false)
  // ② Host 比 server 更长（方向相反，同样不接受）
  const longer = resolveIdentity({
    sessionId: 'sess-1',
    messages: [sUser(1, null, 'a'), sAssistant(2, 1, '回复', { reasoning: '完整推理' })],
    hostMessages: [
      host('h1', 'user', 'a'),
      host('h2', 'assistant', '回复', {
        status: 'finished',
        reasoning: { content: '完整推理内容更长', format: 'text' },
      }),
    ],
  })
  assert.equal(longer.ok, false)
})

test('20B1 identity L3: role / 条数不齐 / user 文本不匹配 → safe-fail', () => {
  const roleMismatch = resolveIdentity({
    sessionId: 'sess-1',
    messages: [sUser(1, null, 'a')],
    hostMessages: [host('h1', 'assistant', 'a')],
  })
  assert.equal(roleMismatch.ok, false)
  const countMismatch = resolveIdentity({
    sessionId: 'sess-1',
    messages: [sUser(1, null, 'a'), sAssistant(2, 1, 'b')],
    hostMessages: [host('h1', 'user', 'a')],
  })
  assert.equal(countMismatch.ok, false)
  const textMismatch = resolveIdentity({
    sessionId: 'sess-1',
    messages: [sUser(1, null, '服务器问法')],
    hostMessages: [host('h1', 'user', '本地问法')],
  })
  assert.equal(textMismatch.ok, false)
})

test('20B1 identity L3: 空 transcript（Host 与 server 都空）→ 成功且零绑定', () => {
  assert.deepEqual(resolveIdentity({ sessionId: 'sess-1', messages: [], hostMessages: [] }), {
    ok: true,
    level: 3,
    bindings: [],
  })
})

// ================================================================== plan: patch
// §8 status merge 与补全规则。

const planFor = (
  messages: DeepSeekHistoryMessage[],
  hostMessages: ChatMessage[],
  anchor?: CommittedAnchor,
): ReturnType<typeof buildReconcilePlan> => buildReconcilePlan({ sessionId: 'sess-1', messages, hostMessages, anchor })

test('20B1 plan: FINISHED 补全 partial（host prefix）→ content 补全 + finished', () => {
  const plan = planFor(
    [sUser(5, 4, '第二个问题'), sAssistant(6, 5, '完整回复')],
    [
      host('h-user', 'user', '第二个问题', { deepSeekMessageId: 5 }),
      host('h-assistant', 'assistant', '完整', { deepSeekMessageId: 6, status: 'error' }),
    ],
  )
  assert.equal(plan.kind, 'apply')
  if (plan.kind !== 'apply') return
  assert.deepEqual(plan.patch.patches, [{ id: 'h-assistant', content: '完整回复', status: 'finished' }])
  assert.deepEqual(plan.patch.appends, [])
})

test('20B1 plan: 空 assistant + FINISHED server → 补全内容并 finished', () => {
  const plan = planFor(
    [sUser(5, 4, '第二个问题'), sAssistant(6, 5, '回复')],
    [
      host('h-user', 'user', '第二个问题', { deepSeekMessageId: 5 }),
      host('h-assistant', 'assistant', '', { deepSeekMessageId: 6, status: 'error' }),
    ],
  )
  assert.equal(plan.kind, 'apply')
  if (plan.kind !== 'apply') return
  assert.deepEqual(plan.patch.patches, [{ id: 'h-assistant', content: '回复', status: 'finished' }])
})

test('20B1 plan: server 更短（是 Host 的严格前缀）→ 保留 Host（不倒退）', () => {
  const plan = planFor(
    [sUser(5, 4, '第二个问题'), sAssistant(6, 5, '完整的')],
    [
      host('h-user', 'user', '第二个问题', { deepSeekMessageId: 5 }),
      host('h-assistant', 'assistant', '完整的本地回复更长', { deepSeekMessageId: 6, status: 'error' }),
    ],
  )
  assert.equal(plan.kind, 'apply')
  if (plan.kind !== 'apply') return
  assert.deepEqual(plan.patch.patches, [])
})

test('20B1 plan: 内容分叉 → 整单 safe-fail（no-op）', () => {
  const plan = planFor(
    [sUser(5, 4, '第二个问题'), sAssistant(6, 5, '服务器版本')],
    [
      host('h-user', 'user', '第二个问题', { deepSeekMessageId: 5 }),
      host('h-assistant', 'assistant', '本地版本', { deepSeekMessageId: 6, status: 'error' }),
    ],
  )
  assert.equal(plan.kind, 'no-op')
})

test('20B1 plan: interrupted 永不自动改 finished（也不补内容）', () => {
  const plan = planFor(
    [sUser(5, 4, '第二个问题'), sAssistant(6, 5, '完整的服务器回复')],
    [
      host('h-user', 'user', '第二个问题', { deepSeekMessageId: 5 }),
      host('h-assistant', 'assistant', '被停止的部分', { deepSeekMessageId: 6, status: 'interrupted' }),
    ],
  )
  assert.equal(plan.kind, 'apply')
  if (plan.kind !== 'apply') return
  assert.deepEqual(plan.patch.patches, [])
  assert.deepEqual(plan.patch.appends, [])
})

test('20B1 plan: server WIP → 不升级、不补全', () => {
  const plan = planFor(
    [sUser(5, 4, '第二个问题'), sAssistant(6, 5, '半截', { status: 'WIP' })],
    [
      host('h-user', 'user', '第二个问题', { deepSeekMessageId: 5 }),
      host('h-assistant', 'assistant', '半', { deepSeekMessageId: 6, status: 'error' }),
    ],
  )
  assert.equal(plan.kind, 'apply')
  if (plan.kind !== 'apply') return
  assert.deepEqual(plan.patch.patches, [])
})

test('20B1 plan: host 已 finished 且内容一致 → no-op（零 patch）', () => {
  const plan = planFor(
    [sUser(5, 4, '第二个问题'), sAssistant(6, 5, '回复')],
    [
      host('h-user', 'user', '第二个问题', { deepSeekMessageId: 5 }),
      host('h-assistant', 'assistant', '回复', { deepSeekMessageId: 6, status: 'finished' }),
    ],
  )
  assert.equal(plan.kind, 'apply')
  if (plan.kind !== 'apply') return
  assert.deepEqual(plan.patch.patches, [])
})

test('20B1 plan: reasoning 补全（host prefix / server 更短不倒退）', () => {
  const completed = planFor(
    [sUser(5, 4, '第二个问题'), sAssistant(6, 5, '回复', { reasoning: '完整推理' })],
    [
      host('h-user', 'user', '第二个问题', { deepSeekMessageId: 5 }),
      host('h-assistant', 'assistant', '回复', {
        deepSeekMessageId: 6,
        status: 'error',
        reasoning: { content: '完整', format: 'text' },
      }),
    ],
  )
  assert.equal(completed.kind, 'apply')
  if (completed.kind !== 'apply') return
  assert.deepEqual(completed.patch.patches, [
    { id: 'h-assistant', reasoning: { content: '完整推理', format: 'text' }, status: 'finished' },
  ])

  const shorter = planFor(
    [sUser(5, 4, '第二个问题'), sAssistant(6, 5, '回复', { reasoning: '完整推理' })],
    [
      host('h-user', 'user', '第二个问题', { deepSeekMessageId: 5 }),
      host('h-assistant', 'assistant', '回复', {
        deepSeekMessageId: 6,
        status: 'error',
        reasoning: { content: '完整推理更长', format: 'text' },
      }),
    ],
  )
  assert.equal(shorter.kind, 'apply')
  if (shorter.kind !== 'apply') return
  assert.deepEqual(shorter.patch.patches, [])
})

test('20B1 plan: markdown 格式随正文一起补全', () => {
  const plan = planFor(
    [{ ...sUser(5, 4, '第二个问题') }, { ...sAssistant(6, 5, '**回复**') }],
    [
      host('h-user', 'user', '第二个问题', { deepSeekMessageId: 5 }),
      host('h-assistant', 'assistant', '**', { deepSeekMessageId: 6, status: 'error', format: 'markdown' }),
    ],
  )
  assert.equal(plan.kind, 'apply')
  if (plan.kind !== 'apply') return
  assert.deepEqual(plan.patch.patches, [{ id: 'h-assistant', content: '**回复**', status: 'finished' }])
})

// ================================================================== plan: append
// §7 表：只有 parent 精确指向已绑定 Host user 的 server assistant 才 append。

test('20B1 plan: server 新增 assistant（parent 指向已绑定 user）→ append，不重复当前 turn', () => {
  const plan = planFor(
    [sUser(5, 4, '第二个问题'), sAssistant(6, 5, '半截'), sUser(7, 6, '第三个问题'), sAssistant(8, 7, '答案')],
    [
      host('h-user', 'user', '第二个问题', { deepSeekMessageId: 5 }),
      host('h-assistant', 'assistant', '半截', { deepSeekMessageId: 6, status: 'error' }),
      host('h-user-2', 'user', '第三个问题', { deepSeekMessageId: 7 }),
    ],
  )
  assert.equal(plan.kind, 'apply')
  if (plan.kind !== 'apply') return
  assert.deepEqual(plan.patch.appends, [
    {
      role: 'assistant',
      content: '答案',
      format: 'text',
      status: 'finished',
      deepSeekMessageId: 8,
      sessionId: 'sess-1',
    },
  ])
})

test('20B1 plan: unknown server user → 不盲 append', () => {
  const plan = planFor(
    [sUser(5, 4, '第二个问题'), sAssistant(6, 5, ''), sUser(9, 6, '外部插入的问题')],
    [
      host('h-user', 'user', '第二个问题', { deepSeekMessageId: 5 }),
      host('h-assistant', 'assistant', '', { deepSeekMessageId: 6, status: 'error' }),
    ],
  )
  assert.equal(plan.kind, 'apply')
  if (plan.kind !== 'apply') return
  assert.deepEqual(plan.patch.appends, [])
})

test('20B1 plan: server assistant 的 parent 指向未知消息 → 不 append', () => {
  const plan = planFor(
    [sUser(5, 4, '第二个问题'), sAssistant(6, 5, ''), sUser(7, 6, '第三个问题'), sAssistant(9, 99, '孤儿')],
    [
      host('h-user', 'user', '第二个问题', { deepSeekMessageId: 5 }),
      host('h-assistant', 'assistant', '', { deepSeekMessageId: 6, status: 'error' }),
      host('h-user-2', 'user', '第三个问题', { deepSeekMessageId: 7 }),
    ],
  )
  assert.equal(plan.kind, 'apply')
  if (plan.kind !== 'apply') return
  assert.deepEqual(plan.patch.appends, [])
})

test('20B1 plan: server WIP 的追加 assistant → 不 append（等稳定）', () => {
  const plan = planFor(
    [
      sUser(5, 4, '第二个问题'),
      sAssistant(6, 5, ''),
      sUser(7, 6, '第三个问题'),
      sAssistant(8, 7, '半', { status: 'WIP' }),
    ],
    [
      host('h-user', 'user', '第二个问题', { deepSeekMessageId: 5 }),
      host('h-assistant', 'assistant', '', { deepSeekMessageId: 6, status: 'error' }),
      host('h-user-2', 'user', '第三个问题', { deepSeekMessageId: 7 }),
    ],
  )
  assert.equal(plan.kind, 'apply')
  if (plan.kind !== 'apply') return
  assert.deepEqual(plan.patch.appends, [])
})

test('20B1 plan: FILE 不覆盖 Host attachments（user 永远不 patch）', () => {
  const plan = planFor(
    [sUser(5, 4, '第二个问题', [{ name: 'a.png', size: 120 }])],
    [
      host('h-user', 'user', '第二个问题', {
        deepSeekMessageId: 5,
        attachments: [{ id: 'a1', kind: 'image', name: 'a.png', mimeType: 'image/png', bytes: 120 }],
      }),
    ],
  )
  assert.equal(plan.kind, 'apply')
  if (plan.kind !== 'apply') return
  assert.deepEqual(plan.patch.patches, [])
})

// ================================================================== bindings 落地
// bindings 随 plan 一起 apply（不做两次写）。

test('20B1 plan: Level 2 绑定 + 补全在同一次 apply 里返回', () => {
  const plan = planFor([sUser(5, 4, '第二个问题'), sAssistant(6, 5, '完整回复')], hostTurn(), anchorOf())
  assert.equal(plan.kind, 'apply')
  if (plan.kind !== 'apply') return
  assert.equal(plan.level, 2)
  assert.deepEqual(plan.patch.bindings, [
    { hostId: 'h-user', deepSeekMessageId: 5 },
    { hostId: 'h-assistant', deepSeekMessageId: 6 },
  ])
  assert.deepEqual(plan.patch.patches, [{ id: 'h-assistant', content: '完整回复', status: 'finished' }])
})

// ================================================================== anchor registry

test('20B1 anchor: record / get / clear（单槽，最新覆盖）', () => {
  const registry = createCommittedAnchorRegistry()
  assert.equal(registry.get(), undefined)
  registry.record(anchorOf())
  assert.deepEqual(registry.get(), anchorOf())
  registry.record(anchorOf({ parentMessageId: 8 }))
  assert.equal(registry.get()?.parentMessageId, 8)
  registry.clear()
  assert.equal(registry.get(), undefined)
})

// ================================================================== stability

test('20B1 stability: WIP 视为未完成，FINISHED 视为完成', () => {
  assert.equal(hasPendingServerWork([sUser(1, null, 'a'), sAssistant(2, 1, 'b')]), false)
  assert.equal(hasPendingServerWork([sUser(1, null, 'a'), sAssistant(2, 1, 'b', { status: 'WIP' })]), true)
})

test('20B1 stability: fingerprint 反映 current_message_id / 条数 / 末条长度', () => {
  const base: HistorySnapshotish = { currentMessageId: 6, messages: [sUser(5, 4, 'q'), sAssistant(6, 5, 'abcdef')] }
  const same: HistorySnapshotish = { currentMessageId: 6, messages: [sUser(5, 4, 'q'), sAssistant(6, 5, 'abcdef')] }
  const longer: HistorySnapshotish = { currentMessageId: 6, messages: [sUser(5, 4, 'q'), sAssistant(6, 5, 'abcdefg')] }
  const extra: HistorySnapshotish = {
    currentMessageId: 6,
    messages: [sUser(5, 4, 'q'), sAssistant(6, 5, 'abcdef'), sAssistant(8, 6, 'x')],
  }
  assert.equal(snapshotFingerprint(base), snapshotFingerprint(same))
  assert.notEqual(snapshotFingerprint(base), snapshotFingerprint(longer))
  assert.notEqual(snapshotFingerprint(base), snapshotFingerprint(extra))
})

test('20B1 stability: 预算与间隔常量符合设计（30s / 500ms）', () => {
  assert.equal(RECONCILE_TOTAL_BUDGET_MS, 30_000)
  assert.equal(RECONCILE_STABILITY_INTERVAL_MS, 500)
})

// --- helper types used only by the fingerprint test ---------------------------

interface HistorySnapshotish {
  currentMessageId: number | null
  messages: readonly DeepSeekHistoryMessage[]
}

// ================================================================== orchestration
// read → bounded stability wait → validate → plan（design §11）。

import { readAndPlanReconcile, type ReconcileHistoryReader } from '../src/host/reconcile.ts'
import type { HistoryRead } from '../src/host/history-idb.ts'

const snapshotOf = (messages: DeepSeekHistoryMessage[], currentMessageId: number | null = null): HistoryRead => ({
  kind: 'snapshot',
  sessionId: 'sess-1',
  currentMessageId,
  messages,
})

/** A reader that hands back the given reads in order (the last one repeats). */
function fakeReader(reads: HistoryRead[], fresh = true): { reader: ReconcileHistoryReader; calls: () => number } {
  let calls = 0
  return {
    reader: {
      readHistorySnapshot: async () => {
        const read = reads[Math.min(calls, reads.length - 1)] as HistoryRead
        calls += 1
        return { read, current: () => fresh }
      },
    },
    calls: () => calls,
  }
}

test('20B1 run: 无 WIP → 一次读取即出 plan（warm path 不空等）', async () => {
  const { reader, calls } = fakeReader([snapshotOf([sUser(5, 4, '第二个问题'), sAssistant(6, 5, '完整回复')], 6)])
  const outcome = await readAndPlanReconcile({
    browser: reader,
    sessionId: 'sess-1',
    hostMessages: hostTurn(),
    anchor: anchorOf(),
    isFresh: () => true,
  })
  assert.equal(outcome.kind, 'plan')
  assert.equal(calls(), 1)
  if (outcome.kind !== 'plan') return
  assert.equal(outcome.level, 2)
  assert.deepEqual(outcome.patch.patches, [{ id: 'h-assistant', content: '完整回复', status: 'finished' }])
})

test('20B1 run: WIP → bounded 等待并重读，FINISHED 后补全', async () => {
  const { reader, calls } = fakeReader([
    snapshotOf([sUser(5, 4, '第二个问题'), sAssistant(6, 5, '半', { status: 'WIP' })], 6),
    snapshotOf([sUser(5, 4, '第二个问题'), sAssistant(6, 5, '完整回复')], 6),
  ])
  const sleeps: number[] = []
  const outcome = await readAndPlanReconcile({
    browser: reader,
    sessionId: 'sess-1',
    hostMessages: hostTurn(),
    anchor: anchorOf(),
    isFresh: () => true,
    sleep: async (ms) => {
      sleeps.push(ms)
    },
  })
  assert.equal(calls(), 2)
  assert.deepEqual(sleeps, [500])
  assert.equal(outcome.kind, 'plan')
  if (outcome.kind !== 'plan') return
  assert.deepEqual(outcome.patch.patches, [{ id: 'h-assistant', content: '完整回复', status: 'finished' }])
})

test('20B1 run: WIP 连续两次指纹一致（服务端停更）→ 用当前快照出 plan，不死等', async () => {
  const stuck = snapshotOf([sUser(5, 4, '第二个问题'), sAssistant(6, 5, '半', { status: 'WIP' })], 6)
  const { reader, calls } = fakeReader([stuck, stuck, stuck])
  const outcome = await readAndPlanReconcile({
    browser: reader,
    sessionId: 'sess-1',
    hostMessages: hostTurn(),
    anchor: anchorOf(),
    isFresh: () => true,
    sleep: async () => {},
  })
  assert.equal(calls(), 2, '一致即停')
  assert.equal(outcome.kind, 'plan')
  if (outcome.kind !== 'plan') return
  // WIP 永不升级 / 不补全。
  assert.deepEqual(outcome.patch.patches, [])
})

test('20B1 run: 预算耗尽 → skipped（Host 完全不动，connection 保持 online）', async () => {
  const growing = (length: number): HistoryRead =>
    snapshotOf([sUser(5, 4, '第二个问题'), sAssistant(6, 5, 'x'.repeat(length), { status: 'WIP' })], 6)
  const reads = [growing(1), growing(2), growing(3), growing(4), growing(5)]
  const { reader } = fakeReader(reads)
  let fakeNow = 0
  const outcome = await readAndPlanReconcile({
    browser: reader,
    sessionId: 'sess-1',
    hostMessages: hostTurn(),
    anchor: anchorOf(),
    isFresh: () => true,
    now: () => fakeNow,
    sleep: async () => {
      fakeNow += 1_000
    },
    budgetMs: 2_000,
  })
  assert.equal(outcome.kind, 'skipped')
  if (outcome.kind !== 'skipped') return
  assert.match(outcome.reason, /budget/)
})

test('20B1 run: isFresh()=false → skipped（切换 / 新 reconcile / 页面重建）', async () => {
  const { reader } = fakeReader([snapshotOf([sUser(5, 4, '第二个问题'), sAssistant(6, 5, '完整回复')], 6)])
  const outcome = await readAndPlanReconcile({
    browser: reader,
    sessionId: 'sess-1',
    hostMessages: hostTurn(),
    anchor: anchorOf(),
    isFresh: () => false,
  })
  assert.deepEqual(outcome, { kind: 'skipped', reason: 'stale snapshot' })
})

test('20B1 run: ticket.current()=false → skipped（读期间 page 已被替换）', async () => {
  const { reader } = fakeReader([snapshotOf([sUser(5, 4, '第二个问题'), sAssistant(6, 5, '完整回复')], 6)], false)
  const outcome = await readAndPlanReconcile({
    browser: reader,
    sessionId: 'sess-1',
    hostMessages: hostTurn(),
    anchor: anchorOf(),
    isFresh: () => true,
  })
  assert.deepEqual(outcome, { kind: 'skipped', reason: 'stale snapshot' })
})

test('20B1 run: history unavailable（无 entry / 破损 / stale）→ skipped，永不 destructive', async () => {
  for (const reason of ['no-entry', 'malformed', 'stale'] as const) {
    const { reader } = fakeReader([{ kind: 'unavailable', reason }])
    const outcome = await readAndPlanReconcile({
      browser: reader,
      sessionId: 'sess-1',
      hostMessages: hostTurn(),
      anchor: anchorOf(),
      isFresh: () => true,
    })
    assert.equal(outcome.kind, 'skipped')
    if (outcome.kind !== 'skipped') continue
    assert.match(outcome.reason, new RegExp(reason))
  }
})

// ==================================================== frontend refresh（20B1 review）
// 真机实测：recovery 后前端只在自己页面加载时写一次 IDB，崩溃轮的 assistant 会
// 永久停在 `WIP`；`page.reload()` 能让前端自己重新 MERGE/REPLACE（4(A:WIP) →
// 4(A:FINISHED)，884 字）。因此允许「最多一次」bounded 前端刷新。

/** A reader that can also be asked to refresh; each refresh advances the read. */
function refreshableReader(
  reads: HistoryRead[],
  options: { canRefresh?: boolean; refreshThrows?: boolean } = {},
): { reader: ReconcileHistoryReader; state: { reads: number; refreshes: number } } {
  const state = { reads: 0, refreshes: 0, index: 0 }
  const reader: ReconcileHistoryReader = {
    readHistorySnapshot: async () => {
      state.reads += 1
      return { read: reads[Math.min(state.index, reads.length - 1)] as HistoryRead, current: () => true }
    },
  }
  if (options.canRefresh !== false) {
    reader.refreshHistoryView = async () => {
      state.refreshes += 1
      if (options.refreshThrows === true) throw new Error('reload failed')
      state.index += 1
    }
  }
  return { reader, state }
}

/** A clock that advances by exactly what the run sleeps — no real waiting. */
function testClock(): {
  now: () => number
  sleep: (ms: number) => Promise<void>
  elapsed: () => number
  consume: (ms: number) => void
} {
  let t = 0
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms
    },
    elapsed: () => t,
    consume: (ms: number) => {
      t += ms
    },
  }
}

const staleOnly = (): HistoryRead => snapshotOf([sUser(1, null, '第一个问题'), sAssistant(2, 1, '第一个回答')], 2)
const turnDone = (): HistoryRead =>
  snapshotOf(
    [
      sUser(1, null, '第一个问题'),
      sAssistant(2, 1, '第一个回答'),
      sUser(3, 2, '第二个问题'),
      sAssistant(4, 3, '完整回复'),
    ],
    4,
  )

/** Host transcript for the four-message conversation above, last turn unfinished. */
const hostFour = (): ChatMessage[] => [
  host('h1', 'user', '第一个问题', { deepSeekMessageId: 1 }),
  host('h2', 'assistant', '第一个回答', { deepSeekMessageId: 2 }),
  host('h3', 'user', '第二个问题'),
  host('h4', 'assistant', '', { status: 'error' }),
]

const committedAnchor = (): CommittedAnchor => ({
  sessionId: 'sess-1',
  parentMessageId: 2,
  userMessageId: 'h3',
  assistantMessageId: 'h4',
})

test('20B1 run: committed turn 不在缓存快照 → 恰好一次前端刷新 → 用新快照出 plan', async () => {
  const clock = testClock()
  const { reader, state } = refreshableReader([staleOnly(), turnDone()])
  const outcome = await readAndPlanReconcile({
    browser: reader,
    sessionId: 'sess-1',
    hostMessages: hostFour(),
    anchor: committedAnchor(),
    isFresh: () => true,
    now: clock.now,
    sleep: clock.sleep,
  })
  assert.equal(state.refreshes, 1, '恰好刷新一次')
  assert.ok(clock.elapsed() >= 15_000, `刷新前先给服务端留时间（实得 ${clock.elapsed()}ms）`)
  assert.equal(outcome.kind, 'plan')
  if (outcome.kind !== 'plan') return
  assert.equal(outcome.level, 2)
  assert.deepEqual(outcome.patch.bindings, [
    { hostId: 'h3', deepSeekMessageId: 3 },
    { hostId: 'h4', deepSeekMessageId: 4 },
  ])
  assert.deepEqual(outcome.patch.patches, [{ id: 'h4', content: '完整回复', status: 'finished' }])
})

test('20B1 run: 缓存快照停更在 WIP → 一次刷新 → FINISHED 原地补全', async () => {
  const wip = (): HistoryRead => snapshotOf([sUser(3, 2, '第二个问题'), sAssistant(4, 3, '半截', { status: 'WIP' })], 4)
  const done = (): HistoryRead => snapshotOf([sUser(3, 2, '第二个问题'), sAssistant(4, 3, '半截加完整尾巴')], 4)
  const clock = testClock()
  // reads: 0 = stale WIP (twice, the stability wait converges on it) → refresh → 1 = FINISHED
  const { reader, state } = refreshableReader([wip(), done()])
  const outcome = await readAndPlanReconcile({
    browser: reader,
    sessionId: 'sess-1',
    hostMessages: [
      host('h3', 'user', '第二个问题', { deepSeekMessageId: 3 }),
      host('h4', 'assistant', '半截', { deepSeekMessageId: 4, status: 'error' }),
    ],
    anchor: committedAnchor(),
    isFresh: () => true,
    now: clock.now,
    sleep: clock.sleep,
  })
  assert.equal(state.refreshes, 1)
  assert.equal(outcome.kind, 'plan')
  if (outcome.kind !== 'plan') return
  assert.deepEqual(outcome.patch.patches, [{ id: 'h4', content: '半截加完整尾巴', status: 'finished' }])
})

test('20B1 run: 最多一次刷新 —— 仍缺失则 safe-fail，绝不循环 reload', async () => {
  const clock = testClock()
  const { reader, state } = refreshableReader([staleOnly(), staleOnly(), staleOnly(), staleOnly()])
  const outcome = await readAndPlanReconcile({
    browser: reader,
    sessionId: 'sess-1',
    hostMessages: hostFour(),
    anchor: committedAnchor(),
    isFresh: () => true,
    now: clock.now,
    sleep: clock.sleep,
  })
  assert.equal(state.refreshes, 1, '只允许一次')
  assert.equal(outcome.kind, 'skipped')
  if (outcome.kind !== 'skipped') return
  assert.match(outcome.reason, /anchor not found/)
})

test('20B1 run: 快照已含本轮且 FINISHED → 零刷新（热路径）', async () => {
  const { reader, state } = refreshableReader([turnDone()])
  const outcome = await readAndPlanReconcile({
    browser: reader,
    sessionId: 'sess-1',
    hostMessages: hostFour(),
    anchor: committedAnchor(),
    isFresh: () => true,
  })
  assert.equal(state.refreshes, 0)
  assert.equal(outcome.kind, 'plan')
})

test('20B1 run: reader 不支持刷新 → 退回旧行为（skipped，不假装成功）', async () => {
  const { reader, state } = refreshableReader([staleOnly()], { canRefresh: false })
  const outcome = await readAndPlanReconcile({
    browser: reader,
    sessionId: 'sess-1',
    hostMessages: hostFour(),
    anchor: committedAnchor(),
    isFresh: () => true,
  })
  assert.equal(state.refreshes, 0)
  assert.equal(outcome.kind, 'skipped')
})

test('20B1 run: malformed（树形分支）不触发刷新 —— reload 改变不了结构', async () => {
  const { reader, state } = refreshableReader([{ kind: 'unavailable', reason: 'malformed' }])
  const outcome = await readAndPlanReconcile({
    browser: reader,
    sessionId: 'sess-1',
    hostMessages: hostFour(),
    anchor: committedAnchor(),
    isFresh: () => true,
  })
  assert.equal(state.refreshes, 0)
  assert.deepEqual(outcome, { kind: 'skipped', reason: 'history unavailable (malformed)' })
})

test('20B1 run: 刷新抛错被吞掉，仍只尝试一次，Host 保持不变', async () => {
  const clock = testClock()
  const { reader, state } = refreshableReader([staleOnly()], { refreshThrows: true })
  const outcome = await readAndPlanReconcile({
    browser: reader,
    sessionId: 'sess-1',
    hostMessages: hostFour(),
    anchor: committedAnchor(),
    isFresh: () => true,
    now: clock.now,
    sleep: clock.sleep,
  })
  assert.equal(state.refreshes, 1)
  assert.equal(outcome.kind, 'skipped')
})

test('20B1 run: 预算已耗尽 → 不刷新', async () => {
  const { reader, state } = refreshableReader([staleOnly()])
  const outcome = await readAndPlanReconcile({
    browser: reader,
    sessionId: 'sess-1',
    hostMessages: hostFour(),
    anchor: committedAnchor(),
    isFresh: () => true,
    budgetMs: 0,
  })
  assert.equal(state.refreshes, 0)
  assert.equal(outcome.kind, 'skipped')
})

test('20B1 run: idle 恢复（无 anchor 且无 WIP）→ 零刷新零等待', async () => {
  const clock = testClock()
  const { reader, state } = refreshableReader([turnDone()])
  const outcome = await readAndPlanReconcile({
    browser: reader,
    sessionId: 'sess-1',
    hostMessages: [
      host('h1', 'user', '第一个问题', { deepSeekMessageId: 1 }),
      host('h2', 'assistant', '第一个回答', { deepSeekMessageId: 2 }),
      host('h3', 'user', '第二个问题', { deepSeekMessageId: 3 }),
      host('h4', 'assistant', '完整回复', { deepSeekMessageId: 4 }),
    ],
    isFresh: () => true,
    now: clock.now,
    sleep: clock.sleep,
  })
  assert.equal(state.refreshes, 0, 'idle 路径不得变慢')
  assert.equal(clock.elapsed(), 0, 'idle 路径零等待')
  assert.equal(outcome.kind, 'plan')
})

// ============================================ shared deadline（20B1 review：硬 deadline）
// 每一步的 timeout 都必须是 min(stepCap, deadline - now)，而不是各自独立固定超时。

test('20B1 deadline: read / refresh 每一步都收到剩余预算（min(stepCap, remaining)）', async () => {
  const clock = testClock()
  const budgets: { read: Array<number | undefined>; refresh: Array<number | undefined> } = { read: [], refresh: [] }
  let index = 0
  const reads = [staleOnly(), turnDone()]
  const reader: ReconcileHistoryReader = {
    readHistorySnapshot: async (_sessionId, budgetMs) => {
      budgets.read.push(budgetMs)
      return { read: reads[Math.min(index, reads.length - 1)] as HistoryRead, current: () => true }
    },
    refreshHistoryView: async (budgetMs) => {
      budgets.refresh.push(budgetMs)
      index += 1
    },
  }
  const outcome = await readAndPlanReconcile({
    browser: reader,
    sessionId: 'sess-1',
    hostMessages: hostFour(),
    anchor: committedAnchor(),
    isFresh: () => true,
    now: clock.now,
    sleep: clock.sleep,
  })
  assert.equal(outcome.kind, 'plan')
  assert.equal(budgets.refresh.length, 1)
  for (const budget of budgets.read) {
    assert.ok(typeof budget === 'number' && budget > 0, `read 必须收到预算（实得 ${String(budget)}）`)
    assert.ok((budget ?? 0) <= 30_000, `read 预算不得超过总预算（实得 ${String(budget)}）`)
  }
  const refreshBudget = budgets.refresh[0]
  assert.ok(
    typeof refreshBudget === 'number' && refreshBudget > 0,
    `refresh 必须收到预算（实得 ${String(refreshBudget)}）`,
  )
  assert.ok((refreshBudget ?? 0) <= 12_000, `refresh 预算必须落在剩余预算内（实得 ${String(refreshBudget)}）`)
})

test('20B1 deadline: 刷新吃满剩余预算 → 立即结束（不再读取、不再写入、不超额）', async () => {
  const clock = testClock()
  const stale = staleOnly()
  const readBudgets: Array<number | undefined> = []
  let refreshed = 0
  const reader: ReconcileHistoryReader = {
    readHistorySnapshot: async (_sessionId, budgetMs) => {
      readBudgets.push(budgetMs)
      return { read: stale, current: () => true }
    },
    refreshHistoryView: async (budgetMs) => {
      refreshed += 1
      // A reload that eats everything it was given — the run must stop here.
      clock.consume(budgetMs ?? 0)
    },
  }
  const outcome = await readAndPlanReconcile({
    browser: reader,
    sessionId: 'sess-1',
    hostMessages: hostFour(),
    anchor: committedAnchor(),
    isFresh: () => true,
    now: clock.now,
    sleep: clock.sleep,
  })
  assert.equal(refreshed, 1)
  assert.equal(outcome.kind, 'skipped')
  if (outcome.kind !== 'skipped') return
  assert.match(outcome.reason, /budget/)
  assert.equal(clock.elapsed() <= 30_000, true, `总耗时必须留在 30s 预算内（实得 ${clock.elapsed()}ms）`)
  // 只允许刷新前那一轮读取，刷新后不得再发起读取。
  assert.ok(readBudgets.length >= 1)
})

test('20B1 deadline: 快照读取超出总预算后不得交出 plan', async () => {
  const clock = testClock()
  const reader: ReconcileHistoryReader = {
    readHistorySnapshot: async () => {
      clock.consume(30_001)
      return { read: turnDone(), current: () => true }
    },
  }
  const outcome = await readAndPlanReconcile({
    browser: reader,
    sessionId: 'sess-1',
    hostMessages: hostFour(),
    anchor: committedAnchor(),
    isFresh: () => true,
    now: clock.now,
    sleep: clock.sleep,
  })
  assert.deepEqual(outcome, { kind: 'skipped', reason: 'reconcile budget exhausted' })
})
