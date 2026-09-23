import assert from 'node:assert/strict'
import test from 'node:test'

import type { AttachmentRecord } from '../src/host/attachment-resources.ts'
import { handleChatMessage } from '../src/host/chat.ts'
import {
  evaluateDraftGate,
  prepareAttachmentTransaction,
  verifyRefFileIds,
  type CompletionSubmission,
} from '../src/host/send-attachments.ts'
import { createCompanionStateStore, type CompanionStateStore } from '../src/host/state.ts'
import type { AssistantReply, Citation } from '../src/shared/state.ts'

/**
 * Phase 18A：发送事务（design Tasks 6 / 7）。
 *
 * 覆盖设计文档里的三阶段矩阵：PRE-SUBMIT 全保留、COMMITTED 才写 attachments、
 * POST-SUBMIT 永不回滚草稿 —— 以及 ref_file_ids 的唯一性集合校验。
 */

const ID_A = 'blob:https://chat.deepseek.com/aaaaaaaa-1111'
const ID_B = 'blob:https://chat.deepseek.com/bbbbbbbb-2222'
const FILE_A = 'file-3f1a8c22-9d5b-4c7e-8a11-2b3c4d5e6f70'
const FILE_B = 'file-7c2b9d31-4e6a-4f88-9b22-5c6d7e8f9a01'

const reply = (content: string): AssistantReply => ({ content, format: 'text' })

interface Draft {
  store: CompanionStateStore
  records: Map<string, AttachmentRecord>
  consumed: string[][]
}

/** Add one draft attachment with its Host record, as the route would. */
function addDraft(
  draft: Draft,
  options: {
    name?: string
    status?: 'ready' | 'uploading' | 'error'
    identity?: string
    fileId?: string
    recordless?: boolean
  } = {},
): { id: string; identity: string; fileId: string } {
  const attachment = draft.store.addComposerAttachment({
    name: options.name ?? 'a.png',
    mimeType: 'image/png',
    bytes: 1024,
  })
  const status = options.status ?? 'ready'
  if (status === 'error') draft.store.updateComposerAttachment(attachment.id, { status, error: 'boom' })
  else if (status === 'uploading') {
    // stays uploading
  } else draft.store.updateComposerAttachment(attachment.id, { status })

  const identity = options.identity ?? ID_A
  const fileId = options.fileId ?? FILE_A
  if (options.recordless !== true) {
    draft.records.set(attachment.id, {
      id: attachment.id,
      tempPath: `/tmp/${attachment.id}.png`,
      ...(status === 'uploading' ? {} : { previewIdentity: identity, deepSeekFileId: fileId }),
    })
  }
  return { id: attachment.id, identity, fileId }
}

function makeDraft(): Draft {
  const store = createCompanionStateStore()
  const consumed: string[][] = []
  const draft: Draft = { store, records: new Map(), consumed }
  return draft
}

function gate(draft: Draft, pageIdentities: string[]) {
  return evaluateDraftGate({
    attachments: draft.store.getState().composer.attachments,
    recordOf: (id) => draft.records.get(id),
    pageIdentities,
  })
}

// --- pre-submit gate ----------------------------------------------------------

test('18A gate: 没有草稿、页面也没有 blob → 通过（纯文本轮）', () => {
  const draft = makeDraft()
  assert.deepEqual(gate(draft, []), { ok: true, snapshot: [], expectedFileIds: [] })
})

test('18A gate: ready + 记录完整 + 页面集合相同（顺序无关）→ 通过', () => {
  const draft = makeDraft()
  const a = addDraft(draft, { name: 'a.png', identity: ID_A, fileId: FILE_A })
  const b = addDraft(draft, { name: 'b.png', identity: ID_B, fileId: FILE_B })

  const result = gate(draft, [ID_B, ID_A]) // page order differs on purpose

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.snapshot.map((entry) => entry.id), [a.id, b.id], 'snapshot 按 composer 顺序')
  assert.deepEqual(result.expectedFileIds, [FILE_A, FILE_B])
})

test('18A gate: uploading / error 的草稿禁止发送', () => {
  const uploading = makeDraft()
  addDraft(uploading, { status: 'uploading' })
  const stillUploading = gate(uploading, [])
  assert.equal(stillUploading.ok, false)
  if (!stillUploading.ok) assert.match(stillUploading.error, /still uploading/)

  const failed = makeDraft()
  addDraft(failed, { status: 'error' })
  const broken = gate(failed, [])
  assert.equal(broken.ok, false)
  if (!broken.ok) assert.match(broken.error, /remove it first/)
})

test('18A gate: ready 但记录缺失 / 缺 identity / 缺 file id → 409（绝不猜）', () => {
  for (const mutate of [
    (draft: Draft, id: string) => draft.records.delete(id),
    (draft: Draft, id: string) => draft.records.set(id, { id, tempPath: '/tmp/x.png' }),
    (draft: Draft, id: string) => draft.records.set(id, { id, tempPath: '/tmp/x.png', previewIdentity: ID_A }),
  ]) {
    const draft = makeDraft()
    const { id } = addDraft(draft)
    mutate(draft, id)
    const result = gate(draft, [ID_A])
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.error, /bookkeeping/)
  }
})

test('18A gate: 页面有 Companion 不认识的草稿 → 409（设计文案）', () => {
  const draft = makeDraft()
  addDraft(draft, { identity: ID_A })

  const extra = gate(draft, [ID_A, ID_B])
  assert.equal(extra.ok, false)
  if (!extra.ok) {
    assert.equal(extra.error, 'DeepSeek page contains image drafts not managed by Companion')
  }

  const missing = gate(draft, [])
  assert.equal(missing.ok, false, 'Host 有、页面没有 → 同样拒绝')
})

test('18A gate: 页面出现重复 identity → 409（集合必须严格相等）', () => {
  const draft = makeDraft()
  addDraft(draft, { identity: ID_A })

  assert.equal(gate(draft, [ID_A, ID_A]).ok, false)
})

// --- ref_file_ids integrity ---------------------------------------------------

const submission = (refFileIds: unknown): CompletionSubmission => ({ ok: true, refFileIds })

test('18A integrity: 顺序不同但集合相等 → 通过', () => {
  assert.deepEqual(verifyRefFileIds([FILE_A, FILE_B], submission([FILE_B, FILE_A])), {
    ok: true,
    fileIds: [FILE_B, FILE_A],
  })
})

test('18A integrity: 纯文本（expected=[] + ref_file_ids=[]）→ 通过', () => {
  assert.deepEqual(verifyRefFileIds([], submission([])), { ok: true, fileIds: [] })
})

test('18A integrity: expected=[A] + actual=[A] → 通过', () => {
  assert.deepEqual(verifyRefFileIds([FILE_A], submission([FILE_A])), { ok: true, fileIds: [FILE_A] })
})

// 严格规则（18A Review 定稿）：即使 expected=[]，payload 也必须显式声明
// ref_file_ids 且形状正确。缺字段 / null / 非数组一律是 POST-SUBMIT INTEGRITY
// ERROR ——「读不出来的请求」绝不被当成「没有引用任何文件」。
test('18A integrity: expected=[] + ref_file_ids 缺失 → integrity error（不视为空数组）', () => {
  const result = verifyRefFileIds([], submission(undefined))
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error, /missing/)
})

test('18A integrity: expected=[] + ref_file_ids=null → integrity error', () => {
  const result = verifyRefFileIds([], submission(null))
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error, /null/)
})

test('18A integrity: expected=[] + ref_file_ids 非数组 → integrity error', () => {
  for (const malformed of ['file-x', { 0: FILE_A }, 42, true]) {
    const result = verifyRefFileIds([], submission(malformed))
    assert.equal(result.ok, false, `${JSON.stringify(malformed)} 必须判失败`)
    if (!result.ok) assert.match(result.error, /not an array/)
  }
})

test('18A integrity: expected=[] + 元素非 string / duplicate → integrity error', () => {
  assert.equal(verifyRefFileIds([], submission([42])).ok, false)
  assert.equal(verifyRefFileIds([], submission([''])).ok, false, '空字符串不是合法 file id')
  assert.equal(verifyRefFileIds([], submission([FILE_A, FILE_A])).ok, false, '空期望也不允许重复项')
})

test('18A send: 缺字段 / null 也是 post-submit integrity error（纯文本亦不例外）', async () => {
  const draft = makeDraft()
  const { id } = addDraft(draft)
  const integrityErrors: string[] = []

  // request 已出现但 payload 里没有 ref_file_ids → 不能当作「没有引用任何文件」
  await runSend(
    draft,
    '看这张',
    [ID_A],
    makeSend(async (onSubmitted) => {
      await onSubmitted?.({ ok: true, refFileIds: undefined })
      return reply('回答')
    }),
    { integrityErrors },
  )

  assert.equal(draft.store.getState().chat.messages[0]!.attachments, undefined, '绝不谎报图片已发送')
  assert.deepEqual(draft.store.getState().composer.attachments, [], '已提交 → 不回滚草稿')
  assert.deepEqual(draft.consumed, [[id]], '仍然清理 snapshot 记录/临时文件')
  assert.equal(integrityErrors.length, 1)
  assert.match(integrityErrors[0]!, /missing/)
})

test('18A integrity: payload 读不出来（malformed）→ 失败，纯文本也算失败', () => {
  const bad = verifyRefFileIds([], { ok: false })
  assert.equal(bad.ok, false)
  if (!bad.ok) assert.match(bad.error, /could not be read/)
  assert.equal(verifyRefFileIds([FILE_A], { ok: false }).ok, false)
})

test('18A integrity: 长度不等 / 多一个 id → 失败', () => {
  assert.equal(verifyRefFileIds([FILE_A], submission([])).ok, false)
  assert.equal(verifyRefFileIds([FILE_A], submission([FILE_A, FILE_B])).ok, false)
  assert.equal(verifyRefFileIds([FILE_A, FILE_B], submission([FILE_A])).ok, false)
})

test('18A integrity: duplicate 绝不放过（[A] 与 [A,A] 必须 mismatch）', () => {
  const short = verifyRefFileIds([FILE_A], submission([FILE_A, FILE_A]))
  assert.equal(short.ok, false)
  if (!short.ok) assert.match(short.error, /duplicates/, '重复项本身就是异常，先于长度判断')

  const sameLength = verifyRefFileIds([FILE_A, FILE_B], submission([FILE_A, FILE_A]))
  assert.equal(sameLength.ok, false)
  if (!sameLength.ok) assert.match(sameLength.error, /duplicates/)

  // 没有重复项时，长度不等同样挡住（少一个 / 多一个）。
  const shorter = verifyRefFileIds([FILE_A], submission([]))
  assert.equal(shorter.ok, false)
  if (!shorter.ok) assert.match(shorter.error, /length mismatch/)
})

test('18A integrity: 非数组 / 非 string / 意外 id / expected 自身脏 → 失败', () => {
  assert.equal(verifyRefFileIds([], submission('file-x')).ok, false)
  assert.equal(verifyRefFileIds([], submission({ 0: FILE_A })).ok, false)
  assert.equal(verifyRefFileIds([], submission([42])).ok, false)
  assert.equal(verifyRefFileIds([FILE_A], submission([FILE_A, 'file-other'])).ok, false)

  assert.equal(verifyRefFileIds([''], submission([''])).ok, false, 'expected 必须是合法非空 string')
  assert.equal(verifyRefFileIds([FILE_A, FILE_A], submission([FILE_A, FILE_A])).ok, false, 'expected 不允许重复')
})

// --- the transaction, through handleChatMessage -------------------------------

type SendFn = Parameters<typeof handleChatMessage>[1]

function makeSend(
  behaviour: (
    onSubmitted: Parameters<SendFn>[4],
    onDelta: (reply: AssistantReply) => void,
  ) => Promise<AssistantReply>,
): SendFn {
  return async (_message, onDelta, _onReasoning, _onCitations, onSubmitted) =>
    behaviour(onSubmitted, onDelta)
}

async function runSend(
  draft: Draft,
  message: string,
  pageIdentities: string[],
  send: SendFn,
  options: { integrityErrors?: string[]; wasInterrupted?: () => boolean } = {},
) {
  const prepared = await prepareAttachmentTransaction({
    store: draft.store,
    recordOf: (id) => draft.records.get(id),
    consume: async (ids) => {
      draft.consumed.push([...ids])
      for (const id of ids) draft.records.delete(id)
    },
    listDraftIdentities: async () => pageIdentities,
    onIntegrityError: (error) => options.integrityErrors?.push(error),
  })
  assert.equal(prepared.ok, true, '这篇文章只测通过闸门后的行为')
  const result = await handleChatMessage(
    draft.store,
    send,
    message,
    undefined,
    options.wasInterrupted,
    prepared.ok ? prepared.transaction : undefined,
  )
  return { result, transaction: prepared.ok ? prepared.transaction : undefined }
}

test('18A send: 纯文本轮没有 transaction，也不会调用 onSubmitted', async () => {
  const draft = makeDraft()
  let submittedCalls = 0
  const result = await runSend(draft, '你好', [], makeSend(async (onSubmitted) => {
    submittedCalls += onSubmitted === undefined ? 0 : 1
    return reply('回答')
  }))

  assert.equal(result.result.status, 200)
  assert.equal(result.transaction, undefined, '没有草稿 → 没有事务')
  assert.equal(submittedCalls, 0)
  assert.equal(draft.store.getState().chat.messages[0]!.attachments, undefined)
})

test('18A send: ref_file_ids 匹配 → 写入 user message.attachments，仅消费 snapshot', async () => {
  const draft = makeDraft()
  const { id, fileId } = addDraft(draft, { name: '照片.png' })

  let calls = 0
  const { result } = await runSend(draft, '看这张', [ID_A], makeSend(async (onSubmitted) => {
    calls += 1
    await onSubmitted?.(submission([fileId]))
    return reply('看到了')
  }))

  assert.equal(result.status, 200)
  assert.equal(calls, 1, 'onSubmitted 恰好一次')
  const messages = draft.store.getState().chat.messages
  assert.deepEqual(messages[0]!.attachments, [
    { id, kind: 'image', name: '照片.png', mimeType: 'image/png', bytes: 1024 },
  ])
  assert.deepEqual(draft.store.getState().composer.attachments, [], '草稿已消费')
  assert.deepEqual(draft.consumed, [[id]], '只消费 snapshot 里的记录')
})

test('18A send: 只发图片（message === ""）→ 允许，user 消息只有附件', async () => {
  const draft = makeDraft()
  const { id, fileId } = addDraft(draft)

  const { result } = await runSend(draft, '', [ID_A], makeSend(async (onSubmitted) => {
    await onSubmitted?.(submission([fileId]))
    return reply('这是蓝色')
  }))

  assert.equal(result.status, 200)
  const user = draft.store.getState().chat.messages[0]!
  assert.equal(user.content, '')
  assert.equal(user.attachments?.length, 1)
  assert.equal(user.attachments?.[0]!.id, id)
})

test('18A send: PRE-SUBMIT —— request 未出现（send 抛错）→ 草稿全保留、消息无附件、不清理', async () => {
  const draft = makeDraft()
  const { id } = addDraft(draft)

  const { result } = await runSend(draft, '看这张', [ID_A], makeSend(async () => {
    throw new Error('completion request never appeared')
  }))

  assert.equal(result.status, 500)
  assert.deepEqual(
    draft.store.getState().composer.attachments.map((attachment) => attachment.id),
    [id],
    '草稿原封不动（可以重试）',
  )
  assert.equal(draft.store.getState().chat.messages[0]!.attachments, undefined, '不谎报附件')
  assert.deepEqual(draft.consumed, [], '不清理任何东西')
  assert.equal(draft.records.get(id)?.deepSeekFileId, FILE_A, '记录也还在')
})

test('18A send: POST-SUBMIT —— request 已发出但 response 超时 → 附件留在消息，草稿不回滚', async () => {
  const draft = makeDraft()
  const { id, fileId } = addDraft(draft)

  const { result } = await runSend(draft, '看这张', [ID_A], makeSend(async (onSubmitted, onDelta) => {
    onDelta(reply('部分'))
    await onSubmitted?.(submission([fileId]))
    throw new Error('response timeout')
  }))

  assert.equal(result.status, 500)
  const user = draft.store.getState().chat.messages[0]!
  assert.equal(user.attachments?.length, 1, '已提交 → 附件归属这条消息')
  assert.deepEqual(draft.store.getState().composer.attachments, [], '绝不把草稿放回去')
  assert.deepEqual(draft.consumed, [[id]])
  assert.equal(draft.store.getState().chat.messages[1]!.content, '部分', '已流出的内容保留')
  assert.equal(draft.store.getState().chat.messages[1]!.status, 'error')
})

test('18A send: POST-SUBMIT integrity error —— refs 不匹配 → 不写 attachments、不回滚、清理 snapshot', async () => {
  const draft = makeDraft()
  const { id } = addDraft(draft)
  const integrityErrors: string[] = []

  const { result } = await runSend(
    draft,
    '看这张',
    [ID_A],
    makeSend(async (onSubmitted) => {
      await onSubmitted?.(submission([FILE_B])) // 页面提交的是别的东西
      return reply('回答')
    }),
    { integrityErrors },
  )

  assert.equal(result.status, 200, '回复本身是好的')
  assert.equal(draft.store.getState().chat.messages[0]!.attachments, undefined, '绝不谎报图片已发送')
  assert.deepEqual(draft.store.getState().composer.attachments, [], '已提交 → 不回滚草稿')
  assert.deepEqual(draft.consumed, [[id]], '仍然清理 snapshot 记录/临时文件')
  assert.equal(integrityErrors.length, 1)
  assert.match(integrityErrors[0]!, /unexpected id|length mismatch/)
})

test('18A send: payload 读不出来（malformed）也算 post-submit integrity error', async () => {
  const draft = makeDraft()
  const { id } = addDraft(draft)
  const integrityErrors: string[] = []

  await runSend(
    draft,
    '看这张',
    [ID_A],
    makeSend(async (onSubmitted) => {
      await onSubmitted?.({ ok: false })
      return reply('回答')
    }),
    { integrityErrors },
  )

  assert.equal(draft.store.getState().chat.messages[0]!.attachments, undefined)
  assert.deepEqual(draft.consumed, [[id]])
  assert.equal(integrityErrors.length, 1)
  assert.match(integrityErrors[0]!, /could not be read/)
})

test('18A send: Stop / 外部切换打断 → 附件仍属于 user 消息，status=interrupted', async () => {
  const draft = makeDraft()
  const { fileId } = addDraft(draft)

  const { result } = await runSend(
    draft,
    '看这张',
    [ID_A],
    makeSend(async (onSubmitted, onDelta) => {
      onDelta(reply('被打断的一半'))
      await onSubmitted?.(submission([fileId]))
      return reply('')
    }),
    { wasInterrupted: () => true },
  )

  assert.equal(result.status, 200)
  const messages = draft.store.getState().chat.messages
  assert.equal(messages[0]!.attachments?.length, 1, '已发送的附件不回滚')
  assert.equal(messages[1]!.status, 'interrupted')
  assert.deepEqual(draft.store.getState().composer.attachments, [])
})

test('18A send: 闸门失败时根本不进入 send（不点击 Send）', async () => {
  const draft = makeDraft()
  addDraft(draft, { identity: ID_A })
  let sendCalls = 0

  const prepared = await prepareAttachmentTransaction({
    store: draft.store,
    recordOf: (id) => draft.records.get(id),
    consume: async () => {},
    // 页面多了一张 Companion 不认识的草稿
    listDraftIdentities: async () => [ID_A, ID_B],
  })

  assert.equal(prepared.ok, false)
  if (!prepared.ok) {
    assert.equal(prepared.status, 409)
    assert.equal(prepared.error, 'DeepSeek page contains image drafts not managed by Companion')
  }
  assert.equal(sendCalls, 0)
  assert.equal(draft.store.getState().composer.attachments.length, 1, '不修改 composer')
})

test('18A send: 纯文本轮也会做页面身份校验（外部草稿一律拦住）', async () => {
  const draft = makeDraft()
  const prepared = await prepareAttachmentTransaction({
    store: draft.store,
    recordOf: (id) => draft.records.get(id),
    consume: async () => {},
    listDraftIdentities: async () => [ID_A],
  })

  assert.equal(prepared.ok, false, 'Host 空集合 vs 页面一张 → 拒绝')
})

test('18A send: 三界面看到同一份结果（附件消费与消息写入都是 Host 单写）', async () => {
  const draft = makeDraft()
  const { id, fileId } = addDraft(draft)
  const dock: string[] = []
  const float: string[] = []
  const popout: string[] = []
  draft.store.subscribe((state) => dock.push(JSON.stringify(state.composer.attachments)))
  draft.store.subscribe((state) => float.push(JSON.stringify(state.composer.attachments)))
  draft.store.subscribe((state) => popout.push(JSON.stringify(state.composer.attachments)))

  await runSend(draft, '看这张', [ID_A], makeSend(async (onSubmitted) => {
    await onSubmitted?.(submission([fileId]))
    return reply('好')
  }))

  assert.deepEqual(dock, float)
  assert.deepEqual(float, popout)
  assert.equal(dock[dock.length - 1], '[]')
  assert.equal(JSON.stringify(draft.store.getState().chat.messages[0]!.attachments).includes(id), true)
})

test('18A send: 非 Phase 18A 的既有语义不变（纯文本无附件、无 transaction）', async () => {
  const draft = makeDraft()
  const citations: Citation[] = [{ marker: 1, url: 'https://a.com', domain: 'a.com' }]
  const send: SendFn = async (_message, onDelta, onReasoning, onCitations) => {
    onDelta(reply('# 标题'))
    onReasoning(reply('思考'))
    onCitations(citations)
    return reply('# 标题')
  }

  const result = await handleChatMessage(draft.store, send, '你好')

  assert.equal(result.status, 200)
  const assistant = draft.store.getState().chat.messages[1]!
  assert.equal(assistant.content, '# 标题')
  assert.deepEqual(assistant.reasoning, { content: '思考', format: 'text' })
  assert.deepEqual(assistant.citations, citations)
})
