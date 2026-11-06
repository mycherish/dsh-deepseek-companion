import assert from 'node:assert/strict'
import test from 'node:test'

import { handleChatMessage } from '../src/host/chat.ts'
import { createCompanionStateStore } from '../src/host/state.ts'
import type { AssistantReply, ChatFormat } from '../src/shared/state.ts'

const reply = (content: string, format: ChatFormat = 'text'): AssistantReply => ({ content, format })

test('20B2: unverified recovery refuses send before appending a message', async () => {
  const store = createCompanionStateStore()
  store.setCurrentSession({ id: 'uncertain' })
  store.appendChatMessage('user', 'preserved')
  store.markSessionUnverified('uncertain')
  let called = false
  const result = await handleChatMessage(
    store,
    async () => {
      called = true
      return reply('unexpected')
    },
    'new message',
  )
  assert.equal(result.status, 409)
  assert.equal(called, false)
  assert.deepEqual(
    store.getState().chat.messages.map((entry) => entry.content),
    ['preserved'],
  )
  assert.equal(store.getState().chat.sending, false)
})

test('发送成功后返回 reply，assistant 消息为最终内容', async () => {
  const store = createCompanionStateStore()
  const result = await handleChatMessage(store, async () => reply('回复内容'), '你好')

  assert.equal(result.status, 200)
  assert.equal(result.body.reply, '回复内容')

  const messages = store.getState().chat.messages
  assert.equal(messages.length, 2)
  assert.equal(messages[0]!.role, 'user')
  assert.equal(messages[0]!.content, '你好')
  assert.equal(messages[0]!.format, 'text')
  assert.equal(messages[1]!.role, 'assistant')
  assert.equal(messages[1]!.content, '回复内容')
  assert.equal(messages[1]!.format, 'text')
  assert.equal(store.getState().chat.sending, false)
})

test('流式：多次 delta 只更新同一个 assistant message，messages 数量不随 chunk 增长', async () => {
  const store = createCompanionStateStore()
  const result = await handleChatMessage(
    store,
    async (_message, onDelta) => {
      onDelta(reply('你'))
      onDelta(reply('你好'))
      onDelta(reply('你好！'))
      return reply('你好！')
    },
    'hi',
  )

  assert.equal(result.status, 200)
  const messages = store.getState().chat.messages
  assert.equal(messages.length, 2)
  assert.equal(messages[1]!.content, '你好！')
  assert.equal(store.getState().chat.sending, false)
})

test('流式：text → markdown 切换后仍只更新同一个 assistant message', async () => {
  const store = createCompanionStateStore()
  let assistantId = ''
  store.subscribe((state) => {
    const last = state.chat.messages[state.chat.messages.length - 1]
    if (last !== undefined && last.role === 'assistant') assistantId = last.id
  })

  const result = await handleChatMessage(
    store,
    async (_message, onDelta) => {
      // Early frames only have the rendered text; once DeepSeek's props land the
      // same message switches to raw Markdown.
      onDelta(reply('# Go'))
      onDelta(reply('Go 语言', 'text'))
      onDelta(reply('# Go 语言', 'markdown'))
      return reply('# Go 语言\n\n正文', 'markdown')
    },
    'hi',
  )

  assert.equal(result.status, 200)
  const messages = store.getState().chat.messages
  assert.equal(messages.length, 2)
  assert.equal(messages[1]!.id, assistantId)
  assert.equal(messages[1]!.format, 'markdown')
  assert.equal(messages[1]!.content, '# Go 语言\n\n正文')
  assert.equal(store.getState().chat.sending, false)
})

test('最终 flush：最终原始 Markdown 覆盖流式过程中的文本（不丢失）', async () => {
  const store = createCompanionStateStore()
  const result = await handleChatMessage(
    store,
    async (_message, onDelta) => {
      onDelta(reply('Go 语言', 'text'))
      // The last delta was throttled away; the return value carries the final
      // raw Markdown and must still land on the message.
      return reply('## Go 语言\n\n```go\nfunc main() {}\n```', 'markdown')
    },
    'hi',
  )

  assert.equal(result.status, 200)
  const final = store.getState().chat.messages[1]!
  assert.equal(final.format, 'markdown')
  assert.equal(final.content, '## Go 语言\n\n```go\nfunc main() {}\n```')
})

test('并发保护：发送进行中第二条被 409 拒绝，且其 user message 不进入 messages', async () => {
  const store = createCompanionStateStore()
  let resolveSend!: (value: AssistantReply) => void
  const sendPromise = new Promise<AssistantReply>((resolve) => {
    resolveSend = resolve
  })

  // 第一条：同步执行到 await send 后挂起（此时 sending 已为 true）
  const first = handleChatMessage(store, () => sendPromise, '第一条')

  // 第二条：应被立即拒绝
  const second = await handleChatMessage(store, async () => reply('不该发生'), '第二条')
  assert.equal(second.status, 409)
  assert.equal(second.body.error, 'chat is busy')

  // 第一条挂起时：messages = [user('第一条'), assistant('')]，第二条 user 未进入
  const during = store.getState().chat.messages
  assert.equal(during.length, 2)
  assert.equal(during[0]!.content, '第一条')
  assert.equal(during[1]!.role, 'assistant')
  assert.equal(during[1]!.content, '')

  // 完成第一条后，assistant 更新为最终内容，sending 恢复 false
  resolveSend(reply('回复'))
  const firstResult = await first
  assert.equal(firstResult.status, 200)
  assert.equal(store.getState().chat.messages.length, 2)
  assert.equal(store.getState().chat.sending, false)
})

test('D: 流式 reasoning 始终更新同一个 assistant message，messages 数量不增长', async () => {
  const store = createCompanionStateStore()
  const result = await handleChatMessage(
    store,
    async (_message, onDelta, onReasoning) => {
      onReasoning(reply('思考'))
      onReasoning(reply('思考一步'))
      onReasoning(reply('思考一步两步'))
      onDelta(reply('# 正文', 'markdown'))
      return reply('# 正文', 'markdown')
    },
    'hi',
  )

  assert.equal(result.status, 200)
  const messages = store.getState().chat.messages
  assert.equal(messages.length, 2)
  assert.equal(messages[1]!.reasoning?.content, '思考一步两步')
  assert.equal(messages[1]!.content, '# 正文')
})

test('E: reasoning 更新不改正文，正文更新不改 reasoning', async () => {
  const store = createCompanionStateStore()
  const assistant = store.appendChatMessage('assistant', '正文 A', 'markdown')
  store.updateChatReasoning(assistant.id, '思考 A', 'text')

  store.updateChatMessage(assistant.id, '正文 B', 'markdown')

  const message = store.getState().chat.messages[0]!
  assert.equal(message.content, '正文 B')
  assert.equal(message.format, 'markdown')
  assert.equal(message.reasoning?.content, '思考 A')
})

test('F: Deep Think 未开启（无 reasoning）时正文完整成功，reasoning 保持 undefined', async () => {
  const store = createCompanionStateStore()
  const result = await handleChatMessage(
    store,
    async (_message, onDelta) => {
      // No onReasoning call at all — Deep Think produced nothing.
      onDelta(reply('正文', 'markdown'))
      return reply('正文', 'markdown')
    },
    'hi',
  )

  assert.equal(result.status, 200)
  const message = store.getState().chat.messages[1]!
  assert.equal(message.content, '正文')
  assert.equal(message.format, 'markdown')
  assert.equal(message.reasoning, undefined)
  assert.equal(store.getState().chat.sending, false)
})

test('sendMessage 抛错：保留 user 与部分 assistant 文本，sending 恢复 false', async () => {
  const store = createCompanionStateStore()
  const result = await handleChatMessage(
    store,
    async (_message, onDelta) => {
      onDelta(reply('部分文本'))
      throw new Error('boom')
    },
    '你好',
  )

  assert.equal(result.status, 500)
  assert.equal(result.body.error, 'boom')
  assert.equal(result.body.assistantMessageId, store.getState().chat.messages[1]!.id)
  assert.equal(result.body.instanceId, store.getState().instanceId)

  // user message 保留，assistant 保留已收到的部分文本，不伪造完成
  const messages = store.getState().chat.messages
  assert.equal(messages.length, 2)
  assert.equal(messages[0]!.role, 'user')
  assert.equal(messages[0]!.content, '你好')
  assert.equal(messages[1]!.role, 'assistant')
  assert.equal(messages[1]!.content, '部分文本')
  assert.equal(store.getState().chat.sending, false)
})

// --- Phase 08.2: message lifecycle (status) -----------------------------------

test('08.2: 流式期间 assistant 为 streaming，成功后落为 finished', async () => {
  const store = createCompanionStateStore()
  let duringSend: string | undefined
  const result = await handleChatMessage(
    store,
    async (_message, onDelta) => {
      onDelta(reply('流式中'))
      duringSend = store.getState().chat.messages[1]!.status
      return reply('最终回复')
    },
    '你好',
  )

  assert.equal(result.status, 200)
  assert.equal(duringSend, 'streaming')
  assert.equal(store.getState().chat.messages[1]!.status, 'finished')
})

test('08.2: 用户停止 / 外部切换那一轮 → interrupted（部分内容保留）', async () => {
  const store = createCompanionStateStore()
  // The browser froze this round as interrupted before `sendMessage` settled.
  let interrupted = false
  const result = await handleChatMessage(
    store,
    async (_message, onDelta) => {
      onDelta(reply('被打断的部分'))
      interrupted = true
      return reply('')
    },
    '你好',
    undefined,
    () => interrupted,
  )

  assert.equal(result.status, 200)
  const assistant = store.getState().chat.messages[1]!
  assert.equal(assistant.content, '被打断的部分')
  assert.equal(assistant.status, 'interrupted')
})

test('08.2: status 绑定到本轮消息 —— 下一轮发送不会改写上一轮', async () => {
  const store = createCompanionStateStore()
  await handleChatMessage(store, async () => reply('第一轮'), '你好')
  const firstId = store.getState().chat.messages[1]!.id

  let previousDuringSecond: string | undefined
  await handleChatMessage(
    store,
    async (_message, onDelta) => {
      onDelta(reply('第二轮'))
      previousDuringSecond = store.getState().chat.messages[1]!.status
      return reply('第二轮')
    },
    '再来',
  )

  const messages = store.getState().chat.messages
  assert.equal(messages[1]!.id, firstId)
  assert.equal(messages[1]!.status, 'finished')
  assert.equal(previousDuringSecond, 'finished', '第二轮流式期间上一轮仍是 finished')
  assert.equal(messages[3]!.status, 'finished')
})

test('08.2: send 抛错 → error 状态（不回写成 finished）', async () => {
  const store = createCompanionStateStore()

  await handleChatMessage(
    store,
    async () => {
      throw new Error('boom')
    },
    '你好',
  )

  assert.equal(store.getState().chat.messages[1]!.status, 'error')
})

// --- Phase 20B1: the commit point always records the parent anchor --------------

test('20B1 commit point: onCommitted 恰好一次，带本轮 Host user/assistant id', async () => {
  const store = createCompanionStateStore()
  const seen: Array<{
    ok: boolean
    sessionId: unknown
    parentMessageId: unknown
    userId: string
    assistantId: string
  }> = []

  const result = await handleChatMessage(
    store,
    async (_message, _onDelta, _onReasoning, _onCitations, onSubmitted) => {
      await onSubmitted?.({ ok: true, refFileIds: [], chatSessionId: 'sess-1', parentMessageId: 4 })
      return reply('回复')
    },
    '第二个问题',
    undefined,
    undefined,
    undefined,
    (submitted, ids) => {
      const anchor = submitted.ok
        ? { sessionId: submitted.chatSessionId, parentMessageId: submitted.parentMessageId }
        : { sessionId: undefined, parentMessageId: undefined }
      seen.push({ ok: submitted.ok, ...anchor, userId: ids.userMessageId, assistantId: ids.assistantMessageId })
    },
  )

  assert.equal(result.status, 200)
  assert.equal(seen.length, 1, 'commit point 恰好一次')
  const messages = store.getState().chat.messages
  assert.equal(seen[0]!.userId, messages[0]!.id)
  assert.equal(seen[0]!.assistantId, messages[1]!.id)
  assert.equal(seen[0]!.sessionId, 'sess-1')
  assert.equal(seen[0]!.parentMessageId, 4)
})

test('20B1 commit point: 无附件轮次也记录 anchor（onSubmitted 不再只属于 18A）', async () => {
  const store = createCompanionStateStore()
  let committed = 0

  const result = await handleChatMessage(
    store,
    async (_message, _onDelta, _onReasoning, _onCitations, onSubmitted) => {
      await onSubmitted?.({ ok: true, refFileIds: [], chatSessionId: 'sess-1', parentMessageId: null })
      return reply('回复')
    },
    '第一个问题',
    undefined,
    undefined,
    undefined,
    () => {
      committed += 1
    },
  )

  assert.equal(result.status, 200)
  assert.equal(committed, 1)
  assert.equal(store.getState().chat.messages.length, 2)
})
