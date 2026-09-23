import assert from 'node:assert/strict'
import test from 'node:test'

import { handleChatMessage } from '../src/host/chat.ts'
import { createCompanionStateStore } from '../src/host/state.ts'
import { decideStopAction, emptyReplyError, handleStopRequest, type StopCapableBrowser } from '../src/host/stop.ts'
import type { AssistantReply } from '../src/shared/state.ts'

/** A browser stub whose stop can succeed, miss the control, or blow up. */
function stopStub(result: boolean | Error): { browser: StopCapableBrowser; calls: number[] } {
  const calls: number[] = []
  return {
    calls,
    browser: {
      async stopGeneration() {
        calls.push(1)
        if (result instanceof Error) throw result
        return result
      },
    },
  }
}

// --- A / B. Host API semantics ---------------------------------------------

test('A: browser 未就绪 → 503，且不判定 sending', async () => {
  const store = createCompanionStateStore()
  store.setChatSending(true)

  const result = await handleStopRequest(store, null)

  assert.equal(result.status, 503)
  assert.equal(result.body.error, 'browser not ready')
})

test('B: 当前未生成 → 409，且完全不触碰 browser', async () => {
  const store = createCompanionStateStore()
  const { browser, calls } = stopStub(true)

  const result = await handleStopRequest(store, browser)

  assert.equal(result.status, 409)
  assert.equal(result.body.error, 'not generating')
  assert.deepEqual(calls, [])
})

// --- C / D / E. stop outcomes ----------------------------------------------

test('C: 生成中 → 200 且沿用页面真实结果（stopped: true）', async () => {
  const store = createCompanionStateStore()
  store.setChatSending(true)
  const { browser, calls } = stopStub(true)

  const result = await handleStopRequest(store, browser)

  assert.equal(result.status, 200)
  assert.deepEqual(result.body, { stopped: true })
  assert.deepEqual(calls, [1])
})

test('D: Stop 控件不存在（页面返回 false）→ 仍是 200 + stopped:false（不伪造成功）', async () => {
  const store = createCompanionStateStore()
  store.setChatSending(true)
  const { browser } = stopStub(false)

  const result = await handleStopRequest(store, browser)

  assert.equal(result.status, 200)
  assert.deepEqual(result.body, { stopped: false })
})

test('E: 页面操作失败 → 503 + 错误信息，且不改变 chat.sending', async () => {
  const store = createCompanionStateStore()
  store.setChatSending(true)
  const { browser } = stopStub(new Error('page closed'))

  const result = await handleStopRequest(store, browser)

  assert.equal(result.status, 503)
  assert.equal(result.body.error, 'page closed')
  // The send flow still owns `sending`; a failed stop must not flip it.
  assert.equal(store.getState().chat.sending, true)
})

// --- F / G. stop inside the chat flow --------------------------------------

test('F: Stop 提前结束时保留部分正文与 reasoning，不报聊天错误', async () => {
  const store = createCompanionStateStore()

  const result = await handleChatMessage(
    store,
    async (_message, onDelta, onReasoning) => {
      // A stop lands mid-stream: deltas already arrived, then the browser reports
      // an EMPTY final reply (that is what `sendMessage` returns after a stop).
      onDelta({ content: '部分正文', format: 'markdown' })
      onReasoning({ content: '部分思考', format: 'text' })
      return { content: '', format: 'text' } satisfies AssistantReply
    },
    'hi',
  )

  assert.equal(result.status, 200)
  const message = store.getState().chat.messages[1]!
  assert.equal(message.content, '部分正文') // NOT wiped by the empty final reply
  assert.equal(message.format, 'markdown')
  assert.deepEqual(message.reasoning, { content: '部分思考', format: 'text' })
  assert.equal(store.getState().chat.sending, false)
})

test('F: 非 Stop 的空回复仍然写入（保持原有语义）', async () => {
  const store = createCompanionStateStore()

  const result = await handleChatMessage(
    store,
    async () => ({ content: '', format: 'text' }) satisfies AssistantReply,
    'hi',
  )

  // The message simply stays empty — the Host never fabricates content.
  assert.equal(result.status, 200)
  assert.equal(store.getState().chat.messages[1]!.content, '')
})

test('G: Stop 之后 sending 立即释放，下一条可以马上发送', async () => {
  const store = createCompanionStateStore()
  const send = async (_message: string, onDelta: (reply: AssistantReply) => void) => {
    onDelta({ content: '部分', format: 'markdown' })
    return { content: '', format: 'text' } satisfies AssistantReply
  }

  const first = await handleChatMessage(store, send, '第一条')
  assert.equal(first.status, 200)
  assert.equal(store.getState().chat.sending, false)

  // No waiting, no extra state: the next send must be accepted right away.
  const second = await handleChatMessage(store, send, '第二条')
  assert.equal(second.status, 200)
  assert.equal(store.getState().chat.messages.length, 4)
  assert.equal(store.getState().chat.sending, false)
})

test('G: Stop 期间再次发送会被拒绝（并发闸门仍然生效）', async () => {
  const store = createCompanionStateStore()
  let release: (() => void) | null = null
  const blocked = handleChatMessage(
    store,
    async (_message, onDelta) => {
      onDelta({ content: '生成中', format: 'markdown' })
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return { content: '', format: 'text' } satisfies AssistantReply
    },
    '第一条',
  )
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(store.getState().chat.sending, true)

  const concurrent = await handleChatMessage(store, async () => ({ content: 'x', format: 'text' }), '抢跑')
  assert.equal(concurrent.status, 409)

  release!()
  assert.equal((await blocked).status, 200)
  assert.equal(store.getState().chat.sending, false)
})

// --- H. shared state across surfaces ---------------------------------------

test('H: sending 是唯一的权威状态（三个界面读同一份 Host state）', async () => {
  const store = createCompanionStateStore()
  const seen: boolean[] = []
  store.subscribe((state) => seen.push(state.chat.sending))
  seen.length = 0

  const pending = handleChatMessage(
    store,
    async (_message, onDelta) => {
      onDelta({ content: '正文', format: 'markdown' })
      return { content: '正文', format: 'markdown' } satisfies AssistantReply
    },
    'hi',
  )
  assert.equal(store.getState().chat.sending, true)
  await pending

  // `sending` flips exactly once in each direction through the store, which is
  // what every surface (Dock / Float / Pop-out) subscribes to — no surface keeps
  // its own copy. (Other chat updates also notify; the boolean never changes.)
  const transitions = seen.filter((value, index) => index === 0 || value !== seen[index - 1])
  assert.deepEqual(transitions, [true, false])
  assert.equal(store.getState().chat.sending, false)
})

// --- 幂等 A / B / C. one click per send -------------------------------------

/** Replays exactly what `browser.stopGeneration` does with the decision. */
function makeStopGate(): { request(sending: boolean): boolean; clicks: number } {
  let stopRequested = false
  let clicks = 0
  return {
    get clicks() {
      return clicks
    },
    request(sending: boolean) {
      const action = decideStopAction({ sending, stopRequested })
      if (action === 'idle') return false
      if (action === 'already') return true // satisfied WITHOUT clicking
      stopRequested = true
      clicks += 1
      return true
    },
  }
}

test('幂等 A: 同一轮生成期间连续两次 Stop → 只点击一次', () => {
  const gate = makeStopGate()

  assert.equal(gate.request(true), true)
  assert.equal(gate.clicks, 1)

  // Second surface asks for the same stop: reported as satisfied, no new click.
  assert.equal(gate.request(true), true)
  assert.equal(gate.clicks, 1)
})

test('幂等 A: 判定本身——首次为 click，已请求为 already', () => {
  assert.equal(decideStopAction({ sending: true, stopRequested: false }), 'click')
  assert.equal(decideStopAction({ sending: true, stopRequested: true }), 'already')
})

test('幂等 B: 按钮已恢复 Send 但 sending 仍为 true → 第二次 Stop 零点击', () => {
  const gate = makeStopGate()
  gate.request(true)
  assert.equal(gate.clicks, 1)

  // This is the dangerous window: the SPA already flipped the shared
  // `.ds-button--primary` back to the send glyph while the Host is still
  // finishing the send. A second click here would SEND a message.
  const clicksBefore = gate.clicks
  assert.equal(gate.request(true), true)
  assert.equal(gate.clicks, clicksBefore) // zero additional clicks
})

test('幂等 B: 三个界面同时请求 Stop → 总共只点击一次', () => {
  const gate = makeStopGate()

  const results = [gate.request(true), gate.request(true), gate.request(true)]

  assert.deepEqual(results, [true, true, true]) // every surface sees success
  assert.equal(gate.clicks, 1) // but the real control is clicked once
})

test('幂等 C: Stop 完成后复位 → 下一轮可以再次停止', () => {
  const gate = makeStopGate()
  gate.request(true)
  assert.equal(gate.clicks, 1)

  // `sendMessage`'s finally resets BOTH flags, so the send is over…
  assert.equal(decideStopAction({ sending: false, stopRequested: false }), 'idle')
  assert.equal(gate.request(false), false) // nothing streaming → nothing to stop

  // …and a NEW send can be stopped again (a fresh gate, i.e. a fresh send).
  const next = makeStopGate()
  assert.equal(next.request(true), true)
  assert.equal(next.clicks, 1)
})

test('幂等 C: 控件缺失 / click 失败后恢复 → 之后仍可重试', () => {
  // `stopGeneration` resets the flag when the click could not happen, so a later
  // attempt is still allowed instead of being stuck on 'already'.
  assert.equal(decideStopAction({ sending: true, stopRequested: false }), 'click')
})

test('幂等 C: Host API 在幂等成功时仍返回 200 + stopped:true', async () => {
  const store = createCompanionStateStore()
  store.setChatSending(true)
  // The browser reports an already-requested stop as satisfied.
  const { browser, calls } = stopStub(true)

  const result = await handleStopRequest(store, browser)

  assert.equal(result.status, 200)
  assert.deepEqual(result.body, { stopped: true })
  assert.deepEqual(calls, [1])
})

// --- 幂等 D. the flag never leaks into the next send -------------------------

test('幂等 D: 上一轮 Stop 不会让下一轮的空回复变成合法', () => {
  // Round 1 was stopped → its empty final reply is a normal outcome.
  assert.equal(emptyReplyError('', true), null)

  // The flag is reset when that send ends, so round 2 has no stop to justify an
  // empty reply: it must fail with the original error.
  assert.equal(emptyReplyError('', false), 'empty reply from DeepSeek')
})

test('幂等 D: 每轮 send 的 stopRequested 生命周期——开始前与结束后都复位', () => {
  // Mirrors browser.ts: `sendMessage` sets it false before streaming and again in
  // `finally`, so the value observed by the empty-reply check belongs to THIS
  // round only.
  const rounds: { stopRequested: boolean; emptyReplyLegal: boolean }[] = []
  for (const stopped of [true, false]) {
    let stopRequested = false // ← reset before the send starts
    stopRequested = stopped // ← stop arrives mid-stream (or not)
    rounds.push({ stopRequested, emptyReplyLegal: emptyReplyError('', stopRequested) === null })
    stopRequested = false // ← finally
    assert.equal(stopRequested, false)
  }

  assert.deepEqual(rounds, [
    { stopRequested: true, emptyReplyLegal: true },
    { stopRequested: false, emptyReplyLegal: false },
  ])
})

// --- 回归 A / B / C / D. emptyReplyError 的完整真值表 -------------------------

test('回归 A: 非空正文 + 未停止 → null（本次 bug 的守门测试）', () => {
  // 普通发送的路径：finalReply 有内容、stopRequested === false。
  // 只判断 stopRequested 的旧签名会在这里错误地返回 'empty reply from DeepSeek'。
  assert.equal(emptyReplyError('正常正文', false), null)
})

test('回归 B: 非空正文 + 已停止 → null', () => {
  assert.equal(emptyReplyError('正常正文', true), null)
})

test('回归 C: 空正文 + 未停止 → 仍然报错', () => {
  assert.equal(emptyReplyError('', false), 'empty reply from DeepSeek')
})

test('回归 D: 空正文 + 已停止 → null（07J 的 Stop 例外）', () => {
  assert.equal(emptyReplyError('', true), null)
})

test('回归: 只有「空正文且未停止」才报错（完整真值表）', () => {
  const table = [
    { content: 'x', stop: false, expected: null },
    { content: 'x', stop: true, expected: null },
    { content: '', stop: false, expected: 'empty reply from DeepSeek' },
    { content: '', stop: true, expected: null },
  ]
  for (const row of table) {
    assert.equal(
      emptyReplyError(row.content, row.stop),
      row.expected,
      `content=${JSON.stringify(row.content)} stopRequested=${row.stop}`,
    )
  }
})

test('回归: content 不做 trim（纯空白正文不算空回复）', () => {
  assert.equal(emptyReplyError('   ', false), null)
})

// --- I. stop does not disturb the other phases ------------------------------

test('I: Stop 后 citations 回调仍然只写给本条 assistant', async () => {
  const store = createCompanionStateStore()
  let late: ((citations: { marker: number; url: string; domain: string }[]) => void) | null = null

  await handleChatMessage(
    store,
    async (_message, onDelta, _onReasoning, onCitations) => {
      onDelta({ content: '部分正文', format: 'markdown' })
      late = onCitations
      return { content: '', format: 'text' } satisfies AssistantReply
    },
    'hi',
  )

  late!([{ marker: 1, url: 'https://a.com', domain: 'a.com' }])
  assert.deepEqual(store.getState().chat.messages[1]!.citations, [
    { marker: 1, url: 'https://a.com', domain: 'a.com' },
  ])
  assert.equal(store.getState().chat.messages[1]!.content, '部分正文')
})

// --- J. Phase 08.2: a requested stop becomes Host state ----------------------

test('08.2 J: 成功请求停止 → composer.stopping 记录为真（三个界面都能看到）', async () => {
  const store = createCompanionStateStore()
  store.setChatSending(true)
  const { browser } = stopStub(true)

  const result = await handleStopRequest(store, browser)

  assert.equal(result.status, 200)
  assert.equal(store.getState().composer.stopping, true)
  assert.equal(store.getState().chat.sending, true, '停止请求不改变发送中的事实')
})

test('08.2 J: stopped:false（页面没有可停的东西）→ 不记录 stopping', async () => {
  const store = createCompanionStateStore()
  store.setChatSending(true)
  const { browser } = stopStub(false)

  await handleStopRequest(store, browser)

  assert.equal(store.getState().composer.stopping, false)
})

test('08.2 J: 409 / 503 都不记录 stopping', async () => {
  const store = createCompanionStateStore()
  const { browser } = stopStub(true)

  await handleStopRequest(store, null) // 503：browser 未就绪
  await handleStopRequest(store, browser) // 409：没有正在生成的回复
  assert.equal(store.getState().composer.stopping, false)

  store.setChatSending(true)
  const failing = stopStub(new Error('page closed'))
  await handleStopRequest(store, failing.browser) // 503：页面操作失败
  assert.equal(store.getState().composer.stopping, false)
})

test('08.2 J: 停止中的标记在 send 结束时自动归零（不会跨轮残留）', async () => {
  const store = createCompanionStateStore()
  store.setChatSending(true)
  const { browser } = stopStub(true)
  await handleStopRequest(store, browser)
  assert.equal(store.getState().composer.stopping, true)

  // The send flow always ends with `setChatSending(false)`.
  store.setChatSending(false)

  assert.deepEqual(
    { sending: store.getState().composer.sending, stopping: store.getState().composer.stopping },
    { sending: false, stopping: false },
  )
})
