import assert from 'node:assert/strict'
import test from 'node:test'
import { sendChatMessage } from '../src/client/api.ts'
import { createCompanionStateStore } from '../src/host/state.ts'
import { handleChatMessage } from '../src/host/chat.ts'

// Removing the response identity must fail this: the Client needs the exact
// Host message to distinguish an obsolete failure from a still-valid one.
test('聊天失败经 HTTP 保留 Host 消息身份与错误原因', async (t) => {
  const store = createCompanionStateStore()
  const result = await handleChatMessage(
    store,
    async () => {
      throw new Error('page closed')
    },
    'hello',
  )
  t.mock.method(globalThis, 'fetch', async () => Response.json(result.body, { status: result.status }))
  await assert.rejects(sendChatMessage('https://host.test', 'hello'), (error: unknown) => {
    assert.ok(error instanceof Error)
    assert.equal(error.message, 'page closed')
    assert.equal(
      (error as Error & { assistantMessageId?: string }).assistantMessageId,
      store.getState().chat.messages[1]!.id,
    )
    assert.equal((error as Error & { instanceId?: string }).instanceId, store.getState().instanceId)
    return true
  })
})

test('恢复结果与错误响应任一先到，同一条完成消息都消除旧错误', async (t) => {
  const { chatRequestErrorText } = await import('../src/client/error-lifecycle.ts')
  const store = createCompanionStateStore()
  const result = await handleChatMessage(
    store,
    async () => {
      throw new Error('page closed')
    },
    'hello',
  )
  t.mock.method(globalThis, 'fetch', async () => Response.json(result.body, { status: result.status }))
  let failure: unknown
  try {
    await sendChatMessage('https://host.test', 'hello')
  } catch (error) {
    failure = error
  }
  assert.equal(chatRequestErrorText(failure, store.getState()), 'page closed')
  store.setRecovering(true)
  assert.equal(chatRequestErrorText(failure, store.getState()), 'page closed', '恢复开始不能凭空宣告请求成功')
  store.applyChatReconcile({
    patches: [{ id: store.getState().chat.messages[1]!.id, content: 'complete', status: 'finished' }],
  })
  store.setRecovering(false)
  assert.equal(chatRequestErrorText(failure, store.getState()), null)
  try {
    await sendChatMessage('https://host.test', 'hello')
  } catch (lateError) {
    assert.equal(chatRequestErrorText(lateError, store.getState()), null, '迟到的 HTTP 错误不能重新出现')
  }
  const other = createCompanionStateStore()
  assert.equal(chatRequestErrorText(failure, other.getState()), 'page closed', '其它 Host 不能解除旧请求错误')
})

test('旧 Host、无效身份、非 JSON 与空响应不会丢失有效错误', async (t) => {
  const responses = [
    Response.json({ error: 'busy' }, { status: 409 }),
    Response.json({ error: 'failure', assistantMessageId: '', instanceId: 'host' }, { status: 500 }),
    new Response('bad gateway', { status: 502 }),
    Response.json(null, { status: 503 }),
  ]
  t.mock.method(globalThis, 'fetch', async () => responses.shift()!)
  for (const message of ['busy', 'failure', 'HTTP 502', 'HTTP 503']) {
    await assert.rejects(sendChatMessage('https://host.test', 'hello'), { message })
  }
})
