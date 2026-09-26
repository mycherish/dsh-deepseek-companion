import assert from 'node:assert/strict'
import test from 'node:test'

import { createCompanionStateStore } from '../src/host/state.ts'

/**
 * Phase 20B1 — the ONE write a reconciliation performs. The store applies
 * bindings, patches and appends together and notifies once: a partially applied
 * reconcile must never be observable, and the Host message id never changes.
 */

function seeded() {
  const store = createCompanionStateStore()
  store.setBrowserReady(true)
  store.setDeepSeekStatus('logged_in')
  store.setCurrentSession({ id: 'sess-1', title: '会话' })
  const user = store.appendChatMessage('user', '第二个问题')
  const assistant = store.appendChatMessage('assistant', '')
  store.setChatMessageStatus(assistant.id, 'error')
  return { store, user, assistant }
}

test('20B1 apply: bindings 写 deepSeekMessageId，Host message.id 保持不变', () => {
  const { store, user, assistant } = seeded()
  store.applyChatReconcile({
    bindings: [
      { hostId: user.id, deepSeekMessageId: 5 },
      { hostId: assistant.id, deepSeekMessageId: 6 },
    ],
  })
  const messages = store.getState().chat.messages
  assert.equal(messages.length, 2)
  assert.equal(messages[0]!.id, user.id, 'Host id 必须保持不变')
  assert.equal(messages[1]!.id, assistant.id, 'Host id 必须保持不变')
  assert.equal(messages[0]!.deepSeekMessageId, 5)
  assert.equal(messages[1]!.deepSeekMessageId, 6)
})

test('20B1 apply: patches 原地补全 content / reasoning / status', () => {
  const { store, assistant } = seeded()
  store.applyChatReconcile({
    patches: [
      {
        id: assistant.id,
        content: '完整回复',
        reasoning: { content: '完整推理', format: 'text' },
        status: 'finished',
      },
    ],
  })
  const message = store.getState().chat.messages[1]!
  assert.equal(message.id, assistant.id)
  assert.equal(message.content, '完整回复')
  assert.deepEqual(message.reasoning, { content: '完整推理', format: 'text' })
  assert.equal(message.status, 'finished')
})

test('20B1 apply: appends 追加新消息（Host 新 id + deepSeekMessageId + sessionId）', () => {
  const { store, user, assistant } = seeded()
  store.applyChatReconcile({
    appends: [
      {
        role: 'assistant',
        content: '续写',
        format: 'text',
        status: 'finished',
        deepSeekMessageId: 8,
        sessionId: 'sess-1',
      },
    ],
  })
  const messages = store.getState().chat.messages
  assert.equal(messages.length, 3, '绝不 duplicate —— 只加一条')
  const appended = messages[2]!
  assert.notEqual(appended.id, user.id)
  assert.notEqual(appended.id, assistant.id)
  assert.equal(appended.deepSeekMessageId, 8)
  assert.equal(appended.sessionId, 'sess-1')
  assert.equal(appended.status, 'finished')
  assert.equal(appended.content, '续写')
})

test('20B1 apply: 一次 reconcile 只 notify 一次（bindings + patches + appends 同时落地）', () => {
  const { store, user, assistant } = seeded()
  let notifications = 0
  store.subscribe(() => {
    notifications += 1
  })
  // subscribe() fires once immediately; count only what the reconcile adds.
  notifications = 0
  store.applyChatReconcile({
    bindings: [{ hostId: user.id, deepSeekMessageId: 5 }],
    patches: [{ id: assistant.id, content: '完整', status: 'finished' }],
    appends: [
      {
        role: 'assistant',
        content: '续写',
        format: 'text',
        status: 'finished',
        deepSeekMessageId: 8,
        sessionId: 'sess-1',
      },
    ],
  })
  assert.equal(notifications, 1)
})

test('20B1 apply: 空 patch 是 no-op（不 notify）', () => {
  const { store } = seeded()
  let notifications = 0
  store.subscribe(() => {
    notifications += 1
  })
  notifications = 0
  store.applyChatReconcile({})
  store.applyChatReconcile({ bindings: [], patches: [], appends: [] })
  assert.equal(notifications, 0)
})

test('20B1 apply: 未知 Host id 静默忽略（transcript 已变，不崩不改别的）', () => {
  const { store, user } = seeded()
  store.applyChatReconcile({
    bindings: [{ hostId: 'gone', deepSeekMessageId: 9 }],
    patches: [{ id: 'gone', content: '不该出现' }],
  })
  const messages = store.getState().chat.messages
  assert.equal(messages.length, 2)
  assert.equal(messages[0]!.id, user.id)
  assert.equal(messages[0]!.deepSeekMessageId, undefined)
  assert.equal(messages[0]!.content, '第二个问题')
})

test('20B1 apply: patch 不会触碰 attachments（FILE 永远不覆盖 Host 附件）', () => {
  const { store, user, assistant } = seeded()
  const attachments = [{ id: 'a1', kind: 'image' as const, name: 'a.png', mimeType: 'image/png', bytes: 120 }]
  store.setChatMessageAttachments(user.id, attachments)
  store.applyChatReconcile({
    bindings: [{ hostId: user.id, deepSeekMessageId: 5 }],
    patches: [{ id: assistant.id, content: '补全' }],
  })
  assert.deepEqual(store.getState().chat.messages[0]!.attachments, attachments)
})
