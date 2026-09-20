import assert from 'node:assert/strict'
import test from 'node:test'

import { handleChatMessage } from '../src/host/chat.ts'
import { createCompanionStateStore } from '../src/host/state.ts'

test('发送成功后返回 reply，assistant 消息为最终内容', async () => {
  const store = createCompanionStateStore()
  const result = await handleChatMessage(store, async () => '回复内容', '你好')

  assert.equal(result.status, 200)
  assert.equal(result.body.reply, '回复内容')

  const messages = store.getState().chat.messages
  assert.equal(messages.length, 2)
  assert.equal(messages[0]!.role, 'user')
  assert.equal(messages[0]!.content, '你好')
  assert.equal(messages[1]!.role, 'assistant')
  assert.equal(messages[1]!.content, '回复内容')
  assert.equal(store.getState().chat.sending, false)
})

test('流式：多次 delta 只更新同一个 assistant message，messages 数量不随 chunk 增长', async () => {
  const store = createCompanionStateStore()
  const result = await handleChatMessage(
    store,
    async (_message, onDelta) => {
      onDelta('你')
      onDelta('你好')
      onDelta('你好！')
      return '你好！'
    },
    'hi',
  )

  assert.equal(result.status, 200)
  const messages = store.getState().chat.messages
  assert.equal(messages.length, 2)
  assert.equal(messages[1]!.content, '你好！')
  assert.equal(store.getState().chat.sending, false)
})

test('并发保护：发送进行中第二条被 409 拒绝，且其 user message 不进入 messages', async () => {
  const store = createCompanionStateStore()
  let resolveSend!: (value: string) => void
  const sendPromise = new Promise<string>((resolve) => {
    resolveSend = resolve
  })

  // 第一条：同步执行到 await send 后挂起（此时 sending 已为 true）
  const first = handleChatMessage(store, () => sendPromise, '第一条')

  // 第二条：应被立即拒绝
  const second = await handleChatMessage(store, async () => '不该发生', '第二条')
  assert.equal(second.status, 409)
  assert.equal(second.body.error, 'chat is busy')

  // 第一条挂起时：messages = [user('第一条'), assistant('')]，第二条 user 未进入
  const during = store.getState().chat.messages
  assert.equal(during.length, 2)
  assert.equal(during[0]!.content, '第一条')
  assert.equal(during[1]!.role, 'assistant')
  assert.equal(during[1]!.content, '')

  // 完成第一条后，assistant 更新为最终内容，sending 恢复 false
  resolveSend('回复')
  const firstResult = await first
  assert.equal(firstResult.status, 200)
  assert.equal(store.getState().chat.messages.length, 2)
  assert.equal(store.getState().chat.sending, false)
})

test('sendMessage 抛错：保留 user 与部分 assistant 文本，sending 恢复 false', async () => {
  const store = createCompanionStateStore()
  const result = await handleChatMessage(
    store,
    async (_message, onDelta) => {
      onDelta('部分文本')
      throw new Error('boom')
    },
    '你好',
  )

  assert.equal(result.status, 500)
  assert.equal(result.body.error, 'boom')

  // user message 保留，assistant 保留已收到的部分文本，不伪造完成
  const messages = store.getState().chat.messages
  assert.equal(messages.length, 2)
  assert.equal(messages[0]!.role, 'user')
  assert.equal(messages[0]!.content, '你好')
  assert.equal(messages[1]!.role, 'assistant')
  assert.equal(messages[1]!.content, '部分文本')
  assert.equal(store.getState().chat.sending, false)
})
