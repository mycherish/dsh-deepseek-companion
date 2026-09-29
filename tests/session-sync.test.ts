import assert from 'node:assert/strict'
import test from 'node:test'

import { createPageGuard } from '../src/host/guard.ts'
import {
  classifyDuringSend,
  createSessionSyncController,
  sameLocation,
  sessionLocationFromPath,
  type SessionLocation,
  type SessionSyncBrowser,
  type SendSessionState,
} from '../src/host/sessions.ts'
import { createCompanionStateStore } from '../src/host/state.ts'
import { emptyReplyError } from '../src/host/stop.ts'
import type { ChatMessageInput } from '../src/shared/state.ts'

const SESSION_A = 'aaaaaaaa-1111-4111-8111-111111111111'
const SESSION_B = 'bbbbbbbb-2222-4222-8222-222222222222'
const SESSION_C = 'cccccccc-3333-4333-8333-333333333333'

const atA: SessionLocation = { kind: 'session', id: SESSION_A }
const atB: SessionLocation = { kind: 'session', id: SESSION_B }
const atC: SessionLocation = { kind: 'session', id: SESSION_C }
const atEmpty: SessionLocation = { kind: 'empty' }
const atOther: SessionLocation = { kind: 'other' }

/** Let the controller's fire-and-forget sync settle. */
const flush = async (): Promise<void> => {
  for (let index = 0; index < 4; index += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

function transcript(label: string): ChatMessageInput[] {
  return [
    { role: 'user', content: `${label} 问题`, format: 'text' },
    { role: 'assistant', content: `${label} 回答`, format: 'markdown' },
  ]
}

/** A browser stub whose reads are countable and can be made to fail. */
function stubSyncBrowser(
  plan: Array<ChatMessageInput[] | Error> = [transcript('默认')],
): { browser: SessionSyncBrowser; state: { reads: number } } {
  const state = { reads: 0 }
  return {
    state,
    browser: {
      async readTranscript() {
        const step = plan[Math.min(state.reads, plan.length - 1)]
        state.reads += 1
        if (step instanceof Error) throw step
        return step ?? []
      },
    },
  }
}

function makeController(plan?: Array<ChatMessageInput[] | Error>) {
  const store = createCompanionStateStore()
  const guard = createPageGuard()
  const { browser, state } = stubSyncBrowser(plan)
  const controller = createSessionSyncController({ browser: () => browser, store, guard })
  return { store, guard, state, controller }
}

// --- L. location parsing -------------------------------------------------------

test('L: sessionLocationFromPath 区分 session / empty / other 三态', () => {
  assert.deepEqual(sessionLocationFromPath(`/a/chat/s/${SESSION_A}`), { kind: 'session', id: SESSION_A })
  assert.deepEqual(sessionLocationFromPath(`https://chat.deepseek.com/a/chat/s/${SESSION_A}?x=1`), {
    kind: 'session',
    id: SESSION_A,
  })
  assert.deepEqual(sessionLocationFromPath('/'), { kind: 'empty' })
  assert.deepEqual(sessionLocationFromPath(''), { kind: 'empty' })
  // Never a session, and never a reason to clear the Host transcript.
  assert.deepEqual(sessionLocationFromPath('/sign_in'), { kind: 'other' })
  assert.deepEqual(sessionLocationFromPath('/a/chat/s/'), { kind: 'other' })
  assert.deepEqual(sessionLocationFromPath('/a/chat/s/short'), { kind: 'other' })
  assert.deepEqual(sessionLocationFromPath('/a/chat'), { kind: 'other' })
})

test('L: sameLocation 只比较 kind 与 session id', () => {
  assert.equal(sameLocation(atA, { kind: 'session', id: SESSION_A }), true)
  assert.equal(sameLocation(atA, atB), false)
  assert.equal(sameLocation(atEmpty, atEmpty), true)
  assert.equal(sameLocation(atEmpty, atOther), false)
  assert.equal(sameLocation(atOther, atOther), true)
})

// --- M. what a navigation means to the running send ----------------------------

test('M: 从 / 发送首条消息 → DeepSeek 创建 session 不算外部切换', () => {
  const state: SendSessionState = { startedAt: atEmpty, currentId: null }

  assert.equal(classifyDuringSend(state, { kind: 'session', id: SESSION_A }), 'accept-created')
})

test('M: 创建后同一 id → ignore；随后又切另一个 id → external', () => {
  const created: SendSessionState = { startedAt: atEmpty, currentId: SESSION_A }

  assert.equal(classifyDuringSend(created, atA), 'ignore')
  assert.equal(classifyDuringSend(created, atB), 'external')
})

test('M: 已有会话 A 正在生成 → 切 B 是 external，回 A 是 ignore', () => {
  const state: SendSessionState = { startedAt: atA, currentId: SESSION_A }

  assert.equal(classifyDuringSend(state, atB), 'external')
  assert.equal(classifyDuringSend(state, atA), 'ignore')
})

test('M: 生成中点 New chat → external；other 页面永远 ignore', () => {
  const state: SendSessionState = { startedAt: atA, currentId: SESSION_A }

  assert.equal(classifyDuringSend(state, atEmpty), 'external')
  assert.equal(classifyDuringSend(state, atOther), 'ignore')
})

test('M: 从 / 发送但页面先出现 other（登录页等）→ ignore，不误判', () => {
  const state: SendSessionState = { startedAt: atEmpty, currentId: null }

  assert.equal(classifyDuringSend(state, atOther), 'ignore')
})

// --- N. session sync controller ------------------------------------------------

test('20B2: an unverified session stays blocked until external transcript read succeeds', async () => {
  const { store, controller } = makeController([new Error('read failed'), transcript('B')])
  store.setCurrentSession({ id: SESSION_A })
  store.appendChatMessage('user', 'preserved')
  store.markSessionUnverified(SESSION_A)
  controller.onLocation(atB, { createdBySend: false })
  await flush()
  assert.equal(store.getState().currentSession.id, SESSION_B)
  assert.equal(store.getState().chat.messages[0]?.content, 'preserved')
  assert.equal(store.getState().recoveryNotice, 'session_unverified')
  controller.onLocation(atA, { createdBySend: false })
  await flush()
  assert.equal(store.getState().currentSession.id, SESSION_A)
  assert.equal(store.getState().chat.messages[0]?.content, 'B 问题')
  assert.equal(store.getState().recoveryNotice, null)
})

test('N-A: 页面空闲时外部 A→B → Host 自动替换为 B', async () => {
  const { store, state, controller } = makeController([transcript('A'), transcript('B')])
  store.appendChatMessage('user', '旧的 A 内容')

  controller.onLocation(atA, { createdBySend: false })
  await flush()
  assert.equal(state.reads, 1, '第一次位置也要同步（A）')
  assert.equal(store.getState().chat.messages[0]!.content, 'A 问题')

  controller.onLocation(atB, { createdBySend: false })
  await flush()
  assert.equal(state.reads, 2)
  assert.equal(store.getState().chat.messages[0]!.content, 'B 问题')
  assert.equal(store.getState().chat.messages.length, 2)
})

test('N-B: New chat（empty）→ Host 自动清空', async () => {
  const { store, state, controller } = makeController()
  store.appendChatMessage('user', '旧消息')

  controller.onLocation(atEmpty, { createdBySend: false })
  await flush()

  assert.deepEqual(store.getState().chat.messages, [])
  assert.equal(state.reads, 0, 'empty 不需要读页面')
})

test('N-C: sign_in / 其它 pathname → 绝不清空、绝不读页面', async () => {
  const { store, state, controller } = makeController()
  store.appendChatMessage('user', '必须保住')

  controller.onLocation(atOther, { createdBySend: false })
  await flush()

  assert.equal(store.getState().chat.messages.length, 1)
  assert.equal(state.reads, 0)
})

test('N-D: createdBySend（首条消息建会话）→ 不读页面、不动 messages、记录位置', async () => {
  const { store, state, controller } = makeController()
  store.appendChatMessage('user', '首条消息')
  store.appendChatMessage('assistant', '正在流式')

  controller.onLocation(atA, { createdBySend: true })
  await flush()

  assert.equal(state.reads, 0, '本轮 transcript 归 send flow 所有')
  assert.equal(store.getState().chat.messages.length, 2)
  assert.equal(store.getState().chat.messages[1]!.content, '正在流式')

  // Same location again (a later navigation event) → already known, no read.
  controller.onLocation(atA, { createdBySend: false })
  await flush()
  assert.equal(state.reads, 0)
})

test('N-F: 生成中连续 A→B→C → pending latest wins，结束后只同步 C', async () => {
  const { store, state, controller } = makeController([transcript('C')])
  store.setChatSending(true)
  store.appendChatMessage('user', '正在生成的 A')

  controller.onLocation(atB, { createdBySend: false })
  controller.onLocation(atC, { createdBySend: false })
  await flush()
  assert.equal(state.reads, 0, '生成中不读页面')

  // The send ends → the Host drains what was parked.
  store.setChatSending(false)
  await controller.drain()

  assert.equal(state.reads, 1, '只同步最终位置')
  assert.equal(store.getState().chat.messages[0]!.content, 'C 问题')
})

test('N-F2: guard 被其它页面操作持有 → 事件挂起；释放后才同步', async () => {
  const { store, guard, state, controller } = makeController([transcript('B')])
  store.appendChatMessage('user', '旧内容')

  assert.equal(guard.tryClaim(), true, '模拟 DSH 自己的 switchChat 正在执行')
  controller.onLocation(atB, { createdBySend: false })
  await flush()
  assert.equal(state.reads, 0)

  // Still busy → drain keeps the pending location.
  await controller.drain()
  assert.equal(state.reads, 0)

  guard.release()
  await controller.drain()

  assert.equal(state.reads, 1)
  assert.equal(store.getState().chat.messages[0]!.content, 'B 问题')
})

test('N-G: DSH 自己的切换（markKnown）→ watcher 不重复同步', async () => {
  const { store, state, controller } = makeController()
  store.appendChatMessage('user', 'Host 已同步的内容')

  controller.markKnown(atB)
  controller.onLocation(atB, { createdBySend: false })
  await flush()

  assert.equal(state.reads, 0, '相同位置不产生第二次读取')
  assert.equal(store.getState().chat.messages[0]!.content, 'Host 已同步的内容')
})

test('N-G2: newChat 后 markKnown(empty) → 后续 empty 事件不重复清空', async () => {
  const { store, controller } = makeController()
  store.clearChatMessages()

  controller.markKnown(atEmpty)
  controller.onLocation(atEmpty, { createdBySend: false })
  await flush()

  assert.deepEqual(store.getState().chat.messages, [])
})

test('N-H: 读取失败 → 保留现有 transcript、guard 释放、后续事件仍可同步', async () => {
  const failing = new Error('transcript read failed')
  const { store, guard, state, controller } = makeController([failing, transcript('B')])
  store.appendChatMessage('user', '必须保住')

  controller.onLocation(atA, { createdBySend: false })
  await flush()

  assert.equal(state.reads, 1)
  assert.equal(store.getState().chat.messages[0]!.content, '必须保住')
  assert.equal(guard.inProgress(), false, '失败也必须释放 guard')

  controller.onLocation(atB, { createdBySend: false })
  await flush()
  assert.equal(state.reads, 2)
  assert.equal(store.getState().chat.messages[0]!.content, 'B 问题')
})

test('N: browser 未就绪 → 不清空、不改动、guard 释放', async () => {
  const store = createCompanionStateStore()
  const guard = createPageGuard()
  const controller = createSessionSyncController({ browser: () => null, store, guard })
  store.appendChatMessage('user', '必须保住')

  controller.onLocation(atA, { createdBySend: false })
  await flush()

  assert.equal(store.getState().chat.messages.length, 1)
  assert.equal(guard.inProgress(), false)
})

test('N: 同步不会改变 sending / composer / login 状态', async () => {
  const { store, controller } = makeController([transcript('B')])
  store.setDeepThinkState({ available: true, enabled: true })
  store.setSearchState({ available: true, enabled: false })

  controller.onLocation(atB, { createdBySend: false })
  await flush()

  const view = store.getState()
  assert.equal(view.chat.sending, false)
  assert.deepEqual(view.deepseek.deepThink, { available: true, enabled: true })
  assert.deepEqual(view.deepseek.search, { available: true, enabled: false })
})

// --- Q. Phase 08.2: the watcher is also the session recorder -------------------

test('08.2 Q: 外部切到会话 A → currentSession 立即跟上（transcript 随同步更新）', async () => {
  const { store, controller } = makeController([transcript('A')])

  controller.onLocation(atA, { createdBySend: false })

  // URL 事实先落地，页面读取随后完成 —— 三个界面的「当前」标记不等 transcript。
  assert.deepEqual(store.getState().currentSession, { id: SESSION_A, title: null })
  await flush()
  assert.deepEqual(store.getState().currentSession, { id: SESSION_A, title: null })
  assert.equal(store.getState().chat.messages[0]!.sessionId, SESSION_A)
})

test('08.2 Q: 外部 New chat（empty）→ currentSession 归零', async () => {
  const { store, controller } = makeController()
  store.setCurrentSession({ id: SESSION_A, title: '会话 A' })
  store.appendChatMessage('user', '旧消息')

  controller.onLocation(atEmpty, { createdBySend: false })
  await flush()

  assert.deepEqual(store.getState().currentSession, { id: null, title: null })
  assert.deepEqual(store.getState().chat.messages, [])
})

test('08.2 Q: sign_in 等 other 页面 → 位置与 transcript 都不动', async () => {
  const { store, controller } = makeController()
  store.setCurrentSession({ id: SESSION_A, title: '会话 A' })
  store.appendChatMessage('user', '必须保住')

  controller.onLocation(atOther, { createdBySend: false })
  await flush()

  assert.deepEqual(store.getState().currentSession, { id: SESSION_A, title: '会话 A' })
  assert.equal(store.getState().chat.messages.length, 1)
})

test('08.2 Q: 首条消息铸出的会话 id → 记录 + 认领本轮消息，且绝不重读 transcript', async () => {
  const { store, state, controller } = makeController([transcript('不该被读')])
  store.appendChatMessage('user', '首条')
  store.appendChatMessage('assistant', '回答')

  controller.onLocation(atA, { createdBySend: true })
  await flush()

  assert.equal(state.reads, 0, '本轮 transcript 属于正在进行的发送，绝不重读')
  assert.deepEqual(store.getState().currentSession, { id: SESSION_A, title: null })
  const messages = store.getState().chat.messages
  assert.equal(messages.length, 2)
  assert.equal(messages[0]!.sessionId, SESSION_A, 'DeepSeek 为这一轮铸出的 id 认领此前写入的消息')
  assert.equal(messages[1]!.sessionId, SESSION_A)
  assert.equal(messages[0]!.content, '首条', '消息本身不改写')
})

// --- O. emptyReplyError: sessionInterrupted is its own signal ------------------

test('O: 外部会话切换让空回复合法，且与 stopRequested 相互独立', () => {
  // A genuinely empty reply is still an error when nothing ended the round.
  assert.equal(emptyReplyError('', false), 'empty reply from DeepSeek')
  assert.equal(emptyReplyError('', false, false), 'empty reply from DeepSeek')
  // Either normal ending is acceptable…
  assert.equal(emptyReplyError('', true, false), null)
  assert.equal(emptyReplyError('', false, true), null)
  assert.equal(emptyReplyError('', true, true), null)
  // …while real content is never an error at all.
  assert.equal(emptyReplyError('有内容', false, false), null)
  assert.equal(emptyReplyError('有内容', false, true), null)
})
