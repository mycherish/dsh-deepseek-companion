import assert from 'node:assert/strict'
import test from 'node:test'

import { parseHistoryEntry, type HistoryRead } from '../src/host/history-idb.ts'

/**
 * Phase 20B1 — IndexedDB history snapshot parsing. No page, no Playwright: these
 * pin the pure contract between the in-page reader and the Host — a probe turns
 * into either a validated snapshot or a typed `unavailable`, and structurally
 * suspicious data NEVER becomes a snapshot.
 *
 * Design: `docs/architecture.md` → "Phase 20B — Session Reconciliation" §1/§2.
 */

/** One IDB entry as the real frontend writes it (`data` holds the snapshot). */
function entry(messages: unknown[], overrides: { sessionId?: string; currentMessageId?: unknown } = {}): unknown {
  return {
    data: {
      chat_session: {
        id: overrides.sessionId ?? 'sess-1',
        current_message_id: 'currentMessageId' in overrides ? overrides.currentMessageId : 6,
      },
      chat_messages: messages,
      cache_control: 'REPLACE',
      cache_reset_at: 1_758_000_000,
    },
    version: 1,
    key: overrides.sessionId ?? 'sess-1',
  }
}

const ok = (messages: unknown[], overrides: Parameters<typeof entry>[1] = {}): unknown => ({
  outcome: 'ok',
  value: entry(messages, overrides),
})

const user = (messageId: number, parentId: number | null, text: string, extra: object = {}): unknown => ({
  message_id: messageId,
  parent_id: parentId,
  role: 'USER',
  status: 'FINISHED',
  fragments: [{ id: `f-${messageId}`, type: 'REQUEST', content: text }],
  ...extra,
})

const assistant = (
  messageId: number,
  parentId: number | null,
  content: string,
  extra: { status?: string; fragments?: unknown[] } = {},
): unknown => ({
  message_id: messageId,
  parent_id: parentId,
  role: 'ASSISTANT',
  status: extra.status ?? 'FINISHED',
  fragments: extra.fragments ?? [{ id: `f-${messageId}`, type: 'RESPONSE', content }],
})

// --- probe outcomes ------------------------------------------------------------

test('20B1 history: 缺 entry → unavailable/no-entry（不是 malformed）', () => {
  assert.deepEqual(parseHistoryEntry({ outcome: 'missing' }, 'sess-1'), {
    kind: 'unavailable',
    reason: 'no-entry',
  })
})

test('20B1 history: in-page 读取失败 → unavailable/malformed', () => {
  assert.deepEqual(parseHistoryEntry({ outcome: 'error' }, 'sess-1'), {
    kind: 'unavailable',
    reason: 'malformed',
  })
})

test('20B1 history: 非对象 probe → malformed（绝不当作 snapshot）', () => {
  for (const probe of [null, undefined, 42, 'x', [], { outcome: 'weird' }]) {
    const read = parseHistoryEntry(probe, 'sess-1')
    assert.equal(read.kind, 'unavailable', `probe=${JSON.stringify(probe)}`)
  }
})

// --- snapshot happy path -------------------------------------------------------

test('20B1 history: REPLACE 全量 entry → snapshot（含 currentMessageId）', () => {
  const read = parseHistoryEntry(
    ok([user(1, null, '你好'), assistant(2, 1, '回复')], { currentMessageId: 2 }),
    'sess-1',
  )
  assert.equal(read.kind, 'snapshot')
  if (read.kind !== 'snapshot') return
  assert.equal(read.sessionId, 'sess-1')
  assert.equal(read.currentMessageId, 2)
  assert.equal(read.messages.length, 2)
  assert.deepEqual(
    read.messages.map((m) => [m.messageId, m.parentId, m.role, m.status]),
    [
      [1, null, 'USER', 'FINISHED'],
      [2, 1, 'ASSISTANT', 'FINISHED'],
    ],
  )
  assert.equal(read.messages[0]!.requestText, '你好')
  assert.equal(read.messages[1]!.responseText, '回复')
})

test('20B1 history: 空 chat_messages → 合法 snapshot（不是 malformed）', () => {
  const read = parseHistoryEntry(ok([]), 'sess-1')
  assert.equal(read.kind, 'snapshot')
  if (read.kind !== 'snapshot') return
  assert.deepEqual(read.messages, [])
})

test('20B1 history: fragments 解析 REQUEST / RESPONSE / THINK / FILE', () => {
  const read = parseHistoryEntry(
    ok([
      user(1, null, '看图', {
        fragments: [
          { id: 'a', type: 'REQUEST', content: '看图' },
          {
            id: 'b',
            type: 'FILE',
            files: [
              { id: 'file-1', file_name: 'a.png', file_size: 120, model_kind: 'VISION' },
              { id: 'file-2', file_name: 'b.png', file_size: 340, model_kind: 'VISION' },
            ],
          },
        ],
      }),
      assistant(2, 1, '看到了', {
        fragments: [
          { id: 'c', type: 'THINK', content: '先看图' },
          { id: 'd', type: 'RESPONSE', content: '看到了' },
          { id: 'e', type: 'TIP', content: '提示' },
        ],
      }),
    ]),
    'sess-1',
  )
  assert.equal(read.kind, 'snapshot')
  if (read.kind !== 'snapshot') return
  const [first, second] = read.messages
  assert.equal(first!.requestText, '看图')
  assert.deepEqual(first!.files, [
    { name: 'a.png', size: 120 },
    { name: 'b.png', size: 340 },
  ])
  assert.equal(second!.reasoningText, '先看图')
  assert.equal(second!.responseText, '看到了')
})

test('20B1 history: WIP 原样保留（status 由 reconcile 决定怎么用）', () => {
  const read = parseHistoryEntry(
    ok([
      user(1, null, '你好'),
      assistant(2, 1, '', { status: 'WIP', fragments: [{ id: 'x', type: 'RESPONSE', content: '半' }] }),
    ]),
    'sess-1',
  )
  assert.equal(read.kind, 'snapshot')
  if (read.kind !== 'snapshot') return
  assert.equal(read.messages[1]!.status, 'WIP')
})

// --- structure refusal ---------------------------------------------------------

test('20B1 history: session id 不匹配 → unavailable/stale（绝不跨会话对账）', () => {
  assert.deepEqual(parseHistoryEntry(ok([user(1, null, 'hi')], { sessionId: 'other' }), 'sess-1'), {
    kind: 'unavailable',
    reason: 'stale',
  })
})

test('20B1 history: duplicate message_id → malformed', () => {
  const read = parseHistoryEntry(ok([user(1, null, 'a'), assistant(1, 1, 'b')]), 'sess-1')
  assert.deepEqual(read, { kind: 'unavailable', reason: 'malformed' })
})

test('20B1 history: broken parent chain → malformed', () => {
  // 第二条的 parent 指向不存在的 99。
  assert.deepEqual(parseHistoryEntry(ok([user(1, null, 'a'), assistant(2, 99, 'b')]), 'sess-1'), {
    kind: 'unavailable',
    reason: 'malformed',
  })
  // 首条 parent 不是 null（没有单根）。
  assert.deepEqual(parseHistoryEntry(ok([user(1, 0, 'a')]), 'sess-1'), {
    kind: 'unavailable',
    reason: 'malformed',
  })
})

test('20B1 history: role 不交替 / 首条不是 USER → malformed', () => {
  assert.deepEqual(parseHistoryEntry(ok([assistant(1, null, 'a')]), 'sess-1'), {
    kind: 'unavailable',
    reason: 'malformed',
  })
  assert.deepEqual(parseHistoryEntry(ok([user(1, null, 'a'), user(2, 1, 'b')]), 'sess-1'), {
    kind: 'unavailable',
    reason: 'malformed',
  })
})

test('20B1 history: 字段类型不对（message_id / role / status / fragments）→ malformed', () => {
  const wrongId = { message_id: '1', parent_id: null, role: 'USER', status: 'FINISHED', fragments: [] }
  assert.equal(parseHistoryEntry(ok([wrongId]), 'sess-1').kind, 'unavailable')
  const wrongRole = { message_id: 1, parent_id: null, role: 'SYSTEM', status: 'FINISHED', fragments: [] }
  assert.equal(parseHistoryEntry(ok([wrongRole]), 'sess-1').kind, 'unavailable')
  const wrongFragments = { message_id: 1, parent_id: null, role: 'USER', status: 'FINISHED', fragments: 'x' }
  assert.equal(parseHistoryEntry(ok([wrongFragments]), 'sess-1').kind, 'unavailable')
})

test('20B1 history: chat_messages 不是数组 / entry 缺 data → malformed', () => {
  assert.equal(
    parseHistoryEntry({ outcome: 'ok', value: { data: { chat_messages: 'x' } } }, 'sess-1').kind,
    'unavailable',
  )
  assert.equal(parseHistoryEntry({ outcome: 'ok', value: null }, 'sess-1').kind, 'unavailable')
  assert.equal(parseHistoryEntry({ outcome: 'ok', value: {} }, 'sess-1').kind, 'unavailable')
})

test('20B1 history: current_message_id 缺失或非数字 → snapshot 仍成立（null）', () => {
  const read: HistoryRead = parseHistoryEntry(ok([user(1, null, 'a')], { currentMessageId: null }), 'sess-1')
  assert.equal(read.kind, 'snapshot')
  if (read.kind !== 'snapshot') return
  assert.equal(read.currentMessageId, null)
})

test('20B1 history: 无 FILE fragment → files 为空数组（绝不猜附件）', () => {
  const read = parseHistoryEntry(ok([user(1, null, 'a')]), 'sess-1')
  assert.equal(read.kind, 'snapshot')
  if (read.kind !== 'snapshot') return
  assert.deepEqual(read.messages[0]!.files, [])
})

// --- 真机 MERGE 顺序（Phase 20B1 验收发现） ---------------------------------------

test('20B1 history: MERGE 把增量插在数组头部 → 按 parent chain 重建顺序', () => {
  // 实测：cache_control='MERGE' 时数组为「新段在前」（如 7,8,9,10,1..6），
  // parents 为 6,7,8,9,null,1..5 —— 链完整，只是顺序不是链序。
  const read = parseHistoryEntry(
    ok([
      user(7, 6, '第三轮问题'),
      assistant(8, 7, '第三轮回答'),
      user(1, null, '第一轮问题'),
      assistant(2, 1, '第一轮回答'),
      user(3, 2, '第二轮问题'),
      assistant(4, 3, '第二轮回答'),
      user(5, 4, '第三轮铺垫'),
      assistant(6, 5, '第三轮铺垫回答'),
    ]),
    'sess-1',
  )
  assert.equal(read.kind, 'snapshot')
  if (read.kind !== 'snapshot') return
  assert.deepEqual(
    read.messages.map((m) => m.messageId),
    [1, 2, 3, 4, 5, 6, 7, 8],
    '链序即从根出发的 parent 顺序',
  )
  assert.deepEqual(
    read.messages.map((m) => m.role),
    ['USER', 'ASSISTANT', 'USER', 'ASSISTANT', 'USER', 'ASSISTANT', 'USER', 'ASSISTANT'],
  )
})

test('20B1 history: 顺序打乱但链完整 → 仍解析（顺序不是事实来源）', () => {
  const read = parseHistoryEntry(
    ok([assistant(2, 1, 'a'), user(3, 2, 'b'), user(1, null, 'c'), assistant(4, 3, 'd')]),
    'sess-1',
  )
  assert.equal(read.kind, 'snapshot')
  if (read.kind !== 'snapshot') return
  assert.deepEqual(
    read.messages.map((m) => m.messageId),
    [1, 2, 3, 4],
  )
})

test('20B1 history: 孤儿（parent 不在数组内）→ malformed（entry 不完整）', () => {
  const read = parseHistoryEntry(ok([user(1, null, 'a'), assistant(2, 1, 'b'), assistant(4, 99, 'c')]), 'sess-1')
  assert.deepEqual(read, { kind: 'unavailable', reason: 'malformed' })
})

test('20B1 history: 环（互指）→ malformed（没有根）', () => {
  const read = parseHistoryEntry(ok([user(1, 2, 'a'), assistant(2, 1, 'b')]), 'sess-1')
  assert.deepEqual(read, { kind: 'unavailable', reason: 'malformed' })
})

test('20B1 history: 分叉（同一 parent 两个子）→ malformed', () => {
  const read = parseHistoryEntry(ok([user(1, null, 'a'), assistant(2, 1, 'b'), assistant(4, 1, 'c')]), 'sess-1')
  assert.deepEqual(read, { kind: 'unavailable', reason: 'malformed' })
})
