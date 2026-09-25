import assert from 'node:assert/strict'
import test from 'node:test'

import { createCompanionStateStore } from '../src/host/state.ts'
import { connectionFrom, type CompanionState } from '../src/shared/state.ts'

test('初始 revision = 1 且 status = ready', () => {
  const store = createCompanionStateStore()
  assert.equal(store.getState().status, 'ready')
  assert.equal(store.getState().revision, 1)
  assert.ok(store.getState().instanceId.length > 0)
})

test('subscribe 立即回放当前状态，bump 后收到 revision = 2', () => {
  const store = createCompanionStateStore()
  const received: number[] = []
  store.subscribe((state) => received.push(state.revision))

  assert.deepEqual(received, [1], '新监听者应立即收到初始状态')
  store.bumpRevision()
  assert.deepEqual(received, [1, 2], '状态更新后监听者应收到 revision 2')
})

test('两个监听者都能收到每次更新', () => {
  const store = createCompanionStateStore()
  const a: number[] = []
  const b: number[] = []
  store.subscribe((state) => a.push(state.revision))
  store.subscribe((state) => b.push(state.revision))

  store.bumpRevision()
  assert.deepEqual(a, [1, 2])
  assert.deepEqual(b, [1, 2])
})

test('取消一个监听后另一个仍正常收到更新', () => {
  const store = createCompanionStateStore()
  const a: number[] = []
  const b: number[] = []
  const unsubscribeA = store.subscribe((state) => a.push(state.revision))
  store.subscribe((state) => b.push(state.revision))

  unsubscribeA()
  store.bumpRevision()

  assert.deepEqual(a, [1], '已取消的监听者不再收到更新')
  assert.deepEqual(b, [1, 2], '未取消的监听者仍正常收到更新')
})

test('新监听者能立即得到当前最新状态', () => {
  const store = createCompanionStateStore()
  store.bumpRevision()
  store.bumpRevision() // 当前 revision = 3

  const received: number[] = []
  store.subscribe((state) => received.push(state.revision))

  assert.deepEqual(received, [3], '新监听者应立即回放最新 revision 3')
  assert.equal(store.getState().revision, 3)
})

test('dispose 后不再推送', () => {
  const store = createCompanionStateStore()
  const received: number[] = []
  store.subscribe((state) => received.push(state.revision))

  store.dispose()
  store.bumpRevision()

  assert.deepEqual(received, [1], 'dispose 后不应再推送任何更新')
  assert.equal(store.getState().revision, 1, 'dispose 后 bump 不再改变 revision')
})

test('初始 deepseek.status 为 checking', () => {
  const store = createCompanionStateStore()
  assert.equal(store.getState().deepseek.status, 'checking')
})

test('setDeepSeekStatus 更新状态并通知监听者', () => {
  const store = createCompanionStateStore()
  const received: string[] = []
  store.subscribe((state) => received.push(state.deepseek.status))

  store.setDeepSeekStatus('logged_out')
  assert.deepEqual(received, ['checking', 'logged_out'])
  assert.equal(store.getState().deepseek.status, 'logged_out')
})

test('setDeepSeekStatus 相同状态不重复通知', () => {
  const store = createCompanionStateStore()
  const received: string[] = []
  store.subscribe((state) => received.push(state.deepseek.status))

  store.setDeepSeekStatus('logged_in')
  store.setDeepSeekStatus('logged_in') // 重复，不应通知
  assert.deepEqual(received, ['checking', 'logged_in'])
})

test('初始 chat 状态：messages 为空且 sending=false', () => {
  const store = createCompanionStateStore()
  assert.deepEqual(store.getState().chat.messages, [])
  assert.equal(store.getState().chat.sending, false)
})

test('appendChatMessage 追加 user/assistant 并通知监听者', () => {
  const store = createCompanionStateStore()
  const counts: number[] = []
  store.subscribe((state) => counts.push(state.chat.messages.length))

  store.appendChatMessage('user', '你好')
  store.appendChatMessage('assistant', '你好！')

  const messages = store.getState().chat.messages
  assert.equal(messages.length, 2)
  assert.equal(messages[0]!.role, 'user')
  assert.equal(messages[0]!.content, '你好')
  assert.ok(messages[0]!.id.length > 0)
  assert.equal(messages[1]!.role, 'assistant')
  assert.equal(messages[1]!.content, '你好！')
  assert.deepEqual(counts, [0, 1, 2])
})

test('setChatSending false→true→false 并通知监听者', () => {
  const store = createCompanionStateStore()
  const received: boolean[] = []
  store.subscribe((state) => received.push(state.chat.sending))

  store.setChatSending(true)
  store.setChatSending(false)
  assert.deepEqual(received, [false, true, false])
  assert.equal(store.getState().chat.sending, false)
})

test('setChatSending 相同值不重复通知', () => {
  const store = createCompanionStateStore()
  const received: boolean[] = []
  store.subscribe((state) => received.push(state.chat.sending))

  store.setChatSending(true)
  store.setChatSending(true) // 重复，不应通知
  assert.deepEqual(received, [false, true])
})

test('updateChatMessage 更新指定消息且不影响其他消息', () => {
  const store = createCompanionStateStore()
  const user = store.appendChatMessage('user', '你好')
  const assistant = store.appendChatMessage('assistant', '')
  store.appendChatMessage('user', '第三条')

  store.updateChatMessage(assistant.id, '回复内容')

  const messages = store.getState().chat.messages
  assert.equal(messages[1]!.content, '回复内容')
  assert.equal(messages[0]!.id, user.id)
  assert.equal(messages[0]!.content, '你好')
  assert.equal(messages[2]!.content, '第三条')
})

test('updateChatMessage 相同 content 不重复 notify', () => {
  const store = createCompanionStateStore()
  store.appendChatMessage('user', '你好')
  const assistant = store.appendChatMessage('assistant', '')
  const contents: string[] = []
  store.subscribe((state) => contents.push(state.chat.messages[1]?.content ?? ''))

  store.updateChatMessage(assistant.id, '内容A')
  store.updateChatMessage(assistant.id, '内容A') // 重复，不应通知

  assert.deepEqual(contents, ['', '内容A'])
})

test('updateChatMessage 找不到 id 时安全 no-op', () => {
  const store = createCompanionStateStore()
  store.appendChatMessage('user', '你好')
  const before = store.getState().chat.messages

  store.updateChatMessage('nonexistent-id', '内容')

  assert.deepEqual(store.getState().chat.messages, before)
})

test('updateChatMessage 可以同时更新 content 与 format', () => {
  const store = createCompanionStateStore()
  const assistant = store.appendChatMessage('assistant', '')

  store.updateChatMessage(assistant.id, '# Go 语言', 'markdown')

  const message = store.getState().chat.messages[0]!
  assert.equal(message.content, '# Go 语言')
  assert.equal(message.format, 'markdown')
})

test('updateChatMessage 仅 format 变化也会 notify（text → markdown）', () => {
  const store = createCompanionStateStore()
  const assistant = store.appendChatMessage('assistant', 'Go 语言')
  const seen: string[] = []
  store.subscribe((state) => seen.push(state.chat.messages[0]!.format))

  // Same text, only the format flips — this must still notify.
  store.updateChatMessage(assistant.id, 'Go 语言', 'markdown')

  assert.deepEqual(seen, ['text', 'markdown'])
})

test('appendChatMessage：默认 format 为 text，可显式指定 markdown', () => {
  const store = createCompanionStateStore()
  const user = store.appendChatMessage('user', '你好')
  const assistant = store.appendChatMessage('assistant', '# 标题', 'markdown')

  assert.equal(user.format, 'text')
  assert.equal(assistant.format, 'markdown')
})

test('A: assistant 可以同时保存正文与 reasoning（两个独立字段）', () => {
  const store = createCompanionStateStore()
  const assistant = store.appendChatMessage('assistant', '正文内容', 'markdown')

  store.updateChatReasoning(assistant.id, '思考内容', 'text')

  const message = store.getState().chat.messages[0]!
  assert.equal(message.content, '正文内容')
  assert.equal(message.format, 'markdown')
  assert.deepEqual(message.reasoning, { content: '思考内容', format: 'text' })
})

test('B: updateChatReasoning 不改变正文 content / format', () => {
  const store = createCompanionStateStore()
  const assistant = store.appendChatMessage('assistant', '正文', 'markdown')
  const before = store.getState().chat.messages[0]!

  store.updateChatReasoning(assistant.id, '思考', 'text')

  const after = store.getState().chat.messages[0]!
  assert.equal(after.content, before.content)
  assert.equal(after.format, before.format)
})

test('B: updateChatReasoning 相同值不重复 notify', () => {
  const store = createCompanionStateStore()
  const assistant = store.appendChatMessage('assistant', '正文')
  const seen: string[] = []
  store.subscribe((state) => seen.push(state.chat.messages[0]!.reasoning?.content ?? ''))

  store.updateChatReasoning(assistant.id, '思考', 'text')
  store.updateChatReasoning(assistant.id, '思考', 'text') // 重复，不应通知

  assert.deepEqual(seen, ['', '思考'])
})

test('B: updateChatReasoning 找不到 id 时安全 no-op', () => {
  const store = createCompanionStateStore()
  store.appendChatMessage('assistant', '正文')
  const before = store.getState().chat.messages

  store.updateChatReasoning('nonexistent-id', '思考', 'text')

  assert.deepEqual(store.getState().chat.messages, before)
})

test('B: updateChatReasoning 空内容不创建空 reasoning（Deep Think 未开启）', () => {
  const store = createCompanionStateStore()
  const assistant = store.appendChatMessage('assistant', '正文')

  store.updateChatReasoning(assistant.id, '', 'text')

  assert.equal(store.getState().chat.messages[0]!.reasoning, undefined)
})

// --- Phase 08.2: connection（统一连接状态） ------------------------------------

test('08.2 connection: browser 未就绪 → offline，与登录状态无关', () => {
  const store = createCompanionStateStore()
  assert.deepEqual(store.getState().connection, { status: 'offline', browserReady: false })

  store.setDeepSeekStatus('logged_in')
  assert.deepEqual(store.getState().connection, { status: 'offline', browserReady: false })
})

test('08.2 connection: browser 就绪 + logged_in → online；logged_out → login_required', () => {
  const store = createCompanionStateStore()
  store.setBrowserReady(true)
  store.setDeepSeekStatus('logged_in')
  assert.deepEqual(store.getState().connection, { status: 'online', browserReady: true })

  store.setDeepSeekStatus('logged_out')
  assert.deepEqual(store.getState().connection, { status: 'login_required', browserReady: true })
})

test('08.2 connection: error / 掉线都回到 offline（browserReady 保留真实值）', () => {
  const store = createCompanionStateStore()
  store.setBrowserReady(true)
  store.setDeepSeekStatus('error')
  assert.deepEqual(store.getState().connection, { status: 'offline', browserReady: true })

  store.setBrowserReady(false)
  assert.deepEqual(store.getState().connection, { status: 'offline', browserReady: false })
})

test('08.2 connection: 相同值不重复通知，真实变化恰好通知一次', () => {
  const store = createCompanionStateStore()
  const seen: string[] = []
  store.subscribe((state) => seen.push(state.connection.status))
  seen.length = 0 // ignore the subscribe replay

  store.setBrowserReady(false) // 已是 false
  assert.deepEqual(seen, [])

  store.setBrowserReady(true)
  assert.deepEqual(seen, ['offline'], 'browser 就绪但仍在检测 → offline')
  store.setDeepSeekStatus('logged_in')
  assert.deepEqual(seen, ['offline', 'online'])
})

test('08.2 connectionFrom: Host 与 Client 共用同一张映射表', () => {
  assert.deepEqual(connectionFrom('checking', false), { status: 'offline', browserReady: false })
  assert.deepEqual(connectionFrom('checking', true), { status: 'offline', browserReady: true })
  assert.deepEqual(connectionFrom('logged_in', false), { status: 'offline', browserReady: false })
  assert.deepEqual(connectionFrom('logged_in', true), { status: 'online', browserReady: true })
  assert.deepEqual(connectionFrom('logged_out', true), { status: 'login_required', browserReady: true })
  assert.deepEqual(connectionFrom('error', true), { status: 'offline', browserReady: true })
})

// --- Phase 20A: recovering（恢复中的连接态） --------------------------------------

test('20A recovering: setRecovering(true) → status=recovering，且不改 currentSession/messages', () => {
  const store = createCompanionStateStore()
  store.setBrowserReady(true)
  store.setDeepSeekStatus('logged_in')
  store.setCurrentSession({ id: 'sess-a', title: '会话 A' })
  store.appendChatMessage('user', '你好')
  const before = store.getState()

  store.setRecovering(true)
  const after = store.getState()
  assert.deepEqual(after.connection, { status: 'recovering', browserReady: true })
  assert.deepEqual(after.currentSession, before.currentSession, 'recovering 不碰 currentSession')
  assert.deepEqual(after.chat.messages, before.chat.messages, 'recovering 不碰 messages')
})

test('20A recovering: setRecovering(false) 回落到派生值（online / login_required / offline）', () => {
  const store = createCompanionStateStore()
  store.setBrowserReady(true)
  store.setDeepSeekStatus('logged_in')
  store.setRecovering(true)
  assert.equal(store.getState().connection.status, 'recovering')

  store.setRecovering(false)
  assert.deepEqual(store.getState().connection, { status: 'online', browserReady: true })

  // 恢复结束落在 logged_out → login_required（transcript 仍保留）。
  store.setDeepSeekStatus('logged_out')
  assert.deepEqual(store.getState().connection, { status: 'login_required', browserReady: true })
})

test('20A recovering: 恢复期间 setDeepSeekStatus / setBrowserReady 不打断 recovering', () => {
  const store = createCompanionStateStore()
  store.setBrowserReady(true)
  store.setDeepSeekStatus('logged_in')
  store.setRecovering(true)

  // 恢复中登录态/就绪态可能被内部检测更新，但 status 仍是 recovering。
  store.setDeepSeekStatus('error')
  assert.equal(store.getState().connection.status, 'recovering')
  store.setBrowserReady(false)
  assert.deepEqual(store.getState().connection, { status: 'recovering', browserReady: false })

  // 结束后回到派生值。
  store.setRecovering(false)
  assert.deepEqual(store.getState().connection, { status: 'offline', browserReady: false })
})

test('20A recovering: 相同值不重复通知（setRecovering 幂等）', () => {
  const store = createCompanionStateStore()
  store.setBrowserReady(true)
  store.setDeepSeekStatus('logged_in')
  const seen: string[] = []
  store.subscribe((state) => seen.push(state.connection.status))
  seen.length = 0

  store.setRecovering(true)
  store.setRecovering(true) // 幂等
  store.setRecovering(false)
  store.setRecovering(false) // 幂等
  assert.deepEqual(seen, ['recovering', 'online'])
})

// --- Phase 08.2: currentSession（当前会话） ------------------------------------

test('08.2 currentSession: 记录 id/title，相同值不重复通知', () => {
  const store = createCompanionStateStore()
  assert.deepEqual(store.getState().currentSession, { id: null, title: null })

  let notifies = 0
  store.subscribe(() => {
    notifies += 1
  })
  notifies = 0

  store.setCurrentSession({ id: 'a1', title: '会话 A' })
  assert.deepEqual(store.getState().currentSession, { id: 'a1', title: '会话 A' })
  assert.equal(notifies, 1)

  store.setCurrentSession({ id: 'a1', title: '会话 A' })
  assert.equal(notifies, 1, '完全相同的会话 → 不 notify')
})

test('08.2 currentSession: 同一会话的 title:null 不擦掉已知标题', () => {
  const store = createCompanionStateStore()
  store.setCurrentSession({ id: 'a1', title: '会话 A' })

  // 页面再次报告同一 id（URL 每次导航都会推一遍），但没有标题信息。
  store.setCurrentSession({ id: 'a1' })
  store.setCurrentSession({ id: 'a1', title: null })
  assert.deepEqual(store.getState().currentSession, { id: 'a1', title: '会话 A' })

  // 换到别的会话 → 旧标题必须被清掉（它属于另一个会话）。
  store.setCurrentSession({ id: 'b2' })
  assert.deepEqual(store.getState().currentSession, { id: 'b2', title: null })
})

test('08.2 currentSession: 回到空会话（/）→ id 与 title 都清空', () => {
  const store = createCompanionStateStore()
  store.setCurrentSession({ id: 'a1', title: '会话 A' })

  store.setCurrentSession({ id: null, title: null })

  assert.deepEqual(store.getState().currentSession, { id: null, title: null })
})

// --- Phase 08.2: composer（统一 composer 状态） --------------------------------

test('08.2 composer: sending 与 chat.sending 始终一致', () => {
  const store = createCompanionStateStore()
  assert.equal(store.getState().composer.sending, false)

  store.setChatSending(true)
  assert.equal(store.getState().chat.sending, true)
  assert.equal(store.getState().composer.sending, true)

  store.setChatSending(false)
  assert.equal(store.getState().chat.sending, false)
  assert.equal(store.getState().composer.sending, false)
})

test('08.2 composer: stopping 只在 sending 期间记录，send 结束即清除', () => {
  const store = createCompanionStateStore()

  store.setComposerStopping(true) // 没有 send → 忽略
  assert.equal(store.getState().composer.stopping, false)

  store.setChatSending(true)
  store.setComposerStopping(true)
  assert.equal(store.getState().composer.stopping, true)

  // 一次 send 结束 = sending 与 stopping 在同一次写入中归零。
  store.setChatSending(false)
  assert.deepEqual(
    { sending: store.getState().composer.sending, stopping: store.getState().composer.stopping },
    { sending: false, stopping: false },
  )
})

test('08.2 composer: deepThink/search 与 deepseek 镜像同源（同一对象引用）', () => {
  const store = createCompanionStateStore()
  store.setDeepThinkState({ available: true, enabled: true })
  store.setSearchState({ available: true, enabled: false })

  const state = store.getState()
  assert.deepEqual(state.composer.deepThink, state.deepseek.deepThink)
  assert.deepEqual(state.composer.search, state.deepseek.search)
  assert.equal(state.composer.deepThink, state.deepseek.deepThink, '同一对象引用 → 两个投影不可能漂移')
  assert.equal(state.composer.search, state.deepseek.search)
})

test('08.2 三界面一致: 一次 send 生命周期内三个 surface 收到完全相同的 composer 快照', () => {
  const store = createCompanionStateStore()
  const snapshot = (state: CompanionState): string => JSON.stringify(state.composer)
  const dock: string[] = []
  const float: string[] = []
  const popout: string[] = []
  store.subscribe((state) => dock.push(snapshot(state)))
  store.subscribe((state) => float.push(snapshot(state)))
  store.subscribe((state) => popout.push(snapshot(state)))

  store.setChatSending(true)
  store.setComposerStopping(true)
  store.setChatSending(false)

  assert.deepEqual(dock, float, 'Dock 与 Float 必须看到同一串 composer 快照')
  assert.deepEqual(float, popout, 'Float 与 Pop-out 必须看到同一串 composer 快照')
  assert.deepEqual(JSON.parse(dock[dock.length - 1]!) as object, {
    sending: false,
    stopping: false,
    deepThink: { available: false, enabled: false },
    search: { available: false, enabled: false },
    attachments: [],
  })
})

// --- Phase 08.2: Message 模型（status / sessionId） ---------------------------

test('08.2 message: assistant 初始 streaming，user 直接 finished', () => {
  const store = createCompanionStateStore()
  const user = store.appendChatMessage('user', '你好')
  const assistant = store.appendChatMessage('assistant', '')

  assert.equal(user.status, 'finished')
  assert.equal(assistant.status, 'streaming')
})

test('08.2 message: setChatMessageStatus 迁移并去重', () => {
  const store = createCompanionStateStore()
  const assistant = store.appendChatMessage('assistant', '部分内容')
  const seen: string[] = []
  store.subscribe((state) => seen.push(state.chat.messages[0]!.status ?? 'finished'))
  seen.length = 0

  store.setChatMessageStatus(assistant.id, 'interrupted')
  assert.equal(store.getState().chat.messages[0]!.status, 'interrupted')

  store.setChatMessageStatus(assistant.id, 'interrupted') // 重复 → 不 notify
  assert.deepEqual(seen, ['interrupted'])

  store.setChatMessageStatus('nonexistent-id', 'error') // 安全 no-op
  assert.equal(store.getState().chat.messages[0]!.status, 'interrupted')
})

test('08.2 message: 新消息带上当前会话 id，空会话（/）不带', () => {
  const store = createCompanionStateStore()
  store.setCurrentSession({ id: 'a1', title: null })

  const tagged = store.appendChatMessage('user', '在 A 里')
  assert.equal(tagged.sessionId, 'a1')

  store.setCurrentSession({ id: null, title: null })
  const untagged = store.appendChatMessage('user', '在 / 里')
  assert.equal(untagged.sessionId, undefined)
})

test('08.2 message: adoptSessionMessages 只补没有 sessionId 的消息', () => {
  const store = createCompanionStateStore()
  const first = store.appendChatMessage('user', '首条（无会话）')
  store.setCurrentSession({ id: 'a1', title: null })
  store.appendChatMessage('user', '第二条（属于 A）')

  store.adoptSessionMessages('a1')

  const messages = store.getState().chat.messages
  assert.equal(messages[0]!.id, first.id)
  assert.equal(messages[0]!.sessionId, 'a1', 'DeepSeek 为这一轮铸出的 id 会认领此前写入的消息')
  assert.equal(messages[1]!.sessionId, 'a1')
})

test('08.2 message: replaceChatMessages 带 sessionId 标签，等价重建仍 no-op', () => {
  const store = createCompanionStateStore()
  const transcript = [
    { role: 'user' as const, content: '问题', format: 'text' as const },
    { role: 'assistant' as const, content: '回答', format: 'markdown' as const },
  ]

  store.replaceChatMessages(transcript, 'b2')

  const messages = store.getState().chat.messages
  assert.equal(messages.length, 2)
  assert.equal(messages[0]!.sessionId, 'b2')
  assert.equal(messages[1]!.sessionId, 'b2')
  assert.equal(messages[0]!.status, 'finished', '重建出来的消息都是已完成态')
  assert.equal(messages[1]!.status, 'finished')

  let notifies = 0
  store.subscribe(() => {
    notifies += 1
  })
  notifies = 0
  store.replaceChatMessages(transcript, 'b2')
  assert.equal(notifies, 0, '同一会话的等价重建不产生推送')
})
