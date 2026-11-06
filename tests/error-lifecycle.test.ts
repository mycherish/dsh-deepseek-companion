import assert from 'node:assert/strict'
import test from 'node:test'
import { ChatRequestError, chatRequestErrorText } from '../src/client/error-lifecycle.ts'
import { createCompanionStateStore } from '../src/host/state.ts'

test('恢复失败、身份不匹配、旧协议与普通错误保留原原因', () => {
  const store = createCompanionStateStore()
  const assistant = store.appendChatMessage('assistant', 'partial')
  const failure = new ChatRequestError('page closed', store.getState().instanceId, assistant.id)
  store.setChatMessageStatus(assistant.id, 'error')
  store.setRecovering(true)
  store.setRecovering(false)
  assert.equal(chatRequestErrorText(failure, store.getState()), 'page closed')
  store.appendChatMessage('assistant', 'another answer')
  assert.equal(chatRequestErrorText(failure, store.getState()), 'page closed')
  store.clearChatMessages()
  assert.equal(chatRequestErrorText(failure, store.getState()), 'page closed')
  assert.equal(chatRequestErrorText(new Error('HTTP 409'), store.getState()), 'HTTP 409')
  assert.equal(chatRequestErrorText(null, store.getState()), null)
})

test('精确匹配已中断的 assistant 可以解除旧请求错误，user 不可以', () => {
  const store = createCompanionStateStore()
  const user = store.appendChatMessage('user', 'hello')
  const assistant = store.appendChatMessage('assistant', 'partial')
  store.setChatMessageStatus(assistant.id, 'interrupted')
  assert.equal(
    chatRequestErrorText(new ChatRequestError('old', store.getState().instanceId, assistant.id), store.getState()),
    null,
  )
  assert.equal(
    chatRequestErrorText(new ChatRequestError('old', store.getState().instanceId, user.id), store.getState()),
    'old',
  )
})
