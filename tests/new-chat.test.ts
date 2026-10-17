import assert from 'node:assert/strict'
import test from 'node:test'

import { handleChatMessage } from '../src/host/chat.ts'
import { createPageGuard, type PageGuard } from '../src/host/guard.ts'
import {
  handleNewChatRequest,
  newChatInPage,
  newChatReadyInPage,
  normalizeNewChatOutcome,
  type NewChatCapableBrowser,
  type NewChatEnv,
  type NewChatOptions,
} from '../src/host/new-chat.ts'
import { createCompanionStateStore } from '../src/host/state.ts'
import type { AssistantReply, Citation } from '../src/shared/state.ts'

/** The options browser.ts actually uses (mirrors NEW_CHAT_OPTIONS). */
const OPTIONS: NewChatOptions = {
  labels: ['New chat', '开启新对话', '新对话'],
  maxAscend: 5,
  historyHrefMarker: '/chat/s/',
}
/** The confirmation rules browser.ts actually uses. */
const MESSAGE_SELECTOR = '.ds-message'
const CONFIRM = { messageSelector: MESSAGE_SELECTOR, emptyPath: '/' }

// --- a tiny fake DOM (deliberately not a framework) --------------------------

interface FakeText {
  nodeType: 3
  textContent: string
}

interface FakeElement {
  nodeType: 1
  tagName: string
  childNodes: Array<FakeElement | FakeText>
  parentElement: FakeElement | null
  contains(other: unknown): boolean
  getAttribute(name: string): string | null
  click(): void
}

interface FakeElementInit {
  tag?: string
  /** Direct text of this element (a real text node child). */
  text?: string
  children?: FakeElement[]
  attrs?: Record<string, string>
  onClick?: () => void
  /** Stands in for the React `__reactProps$…` own key a real node carries. */
  reactProps?: Record<string, unknown>
}

function fakeElement(init: FakeElementInit): FakeElement {
  const children = init.children ?? []
  const element: FakeElement = {
    nodeType: 1,
    tagName: init.tag ?? 'DIV',
    childNodes: [...(init.text !== undefined ? [{ nodeType: 3 as const, textContent: init.text }] : []), ...children],
    parentElement: null,
    contains(other: unknown): boolean {
      return children.some((child) => (child as unknown) === other || child.contains(other))
    },
    getAttribute(name: string): string | null {
      return init.attrs?.[name] ?? null
    },
    click(): void {
      // A real click fires the DOM handler AND React's delegated one.
      init.onClick?.()
      const reactOnClick = init.reactProps?.onClick
      if (typeof reactOnClick === 'function') (reactOnClick as () => void)()
    },
  }
  for (const child of children) child.parentElement = element
  if (init.reactProps !== undefined) {
    ;(element as unknown as Record<string, unknown>)['__reactProps$test'] = init.reactProps
  }
  return element
}

function flatten(root: FakeElement): FakeElement[] {
  const out: FakeElement[] = [root]
  for (const child of root.childNodes) {
    if (child.nodeType === 1) out.push(...flatten(child))
  }
  return out
}

/** `document.querySelectorAll('*')` returns every element, in document order. */
function fakeEnv(roots: FakeElement[], pathname = '/', messages = 0): NewChatEnv {
  const all = roots.flatMap(flatten)
  return {
    document: {
      querySelectorAll: (selector: string) =>
        selector === MESSAGE_SELECTOR ? new Array<unknown>(messages).fill(null) : all,
    },
    location: { pathname },
  }
}

// --- A. locating the REAL control -------------------------------------------

test('A: 纯 div 容器里的唯一文本 → 点击文本元素本身（原生 click 冒泡给页面）', () => {
  const clicked: string[] = []
  const control = fakeElement({
    children: [
      fakeElement({ tag: 'svg', attrs: { class: 'icon' } }),
      fakeElement({
        tag: 'SPAN',
        text: 'New chat',
        onClick: () => clicked.push('span'),
      }),
    ],
  })

  assert.deepEqual(newChatInPage({ options: OPTIONS, env: fakeEnv([control]) }), { outcome: 'clicked' })
  assert.deepEqual(clicked, ['span'], '点击文本元素本身，让原生 click 冒泡')
})

test('A: 标准 button 祖先存在 → 点击 button（而不是文本元素）', () => {
  const clicked: string[] = []
  const button = fakeElement({
    tag: 'BUTTON',
    children: [
      fakeElement({
        tag: 'SPAN',
        text: '新对话',
        onClick: () => clicked.push('span'),
      }),
    ],
    onClick: () => clicked.push('button'),
  })

  assert.deepEqual(newChatInPage({ options: OPTIONS, env: fakeEnv([button]) }), { outcome: 'clicked' })
  assert.deepEqual(clicked, ['button'])
})

test('A: aria-label + role=button 的容器 → 直接点击它', () => {
  const clicked: string[] = []
  const control = fakeElement({
    attrs: { 'aria-label': 'New chat', role: 'button' },
    onClick: () => clicked.push('control'),
  })

  assert.deepEqual(newChatInPage({ options: OPTIONS, env: fakeEnv([control]) }), { outcome: 'clicked' })
  assert.deepEqual(clicked, ['control'])
})

test('A: 中文「新对话」按钮 → 同样能定位并点击', () => {
  let clicks = 0
  const control = fakeElement({
    tag: 'BUTTON',
    text: '新对话',
    onClick: () => {
      clicks += 1
    },
  })

  assert.deepEqual(newChatInPage({ options: OPTIONS, env: fakeEnv([control]) }), { outcome: 'clicked' })
  assert.equal(clicks, 1)
})

test('A: 使用方只依赖标准 DOM —— 不使用 React 私有 props 作为可点击证据', () => {
  // 元素上挂着一个假造的 React props 键，但它不是标准 DOM 证据：只有
  // 「文本元素本身」允许被点击（冒泡），绝不当成 button/a 祖先来选中。
  const clicked: string[] = []
  const container = fakeElement({
    reactProps: {
      onClick: () => clicked.push('react-props'),
    },
    children: [
      fakeElement({
        tag: 'SPAN',
        text: 'New chat',
        onClick: () => clicked.push('span'),
      }),
    ],
  })

  assert.deepEqual(newChatInPage({ options: OPTIONS, env: fakeEnv([container]) }), { outcome: 'clicked' })
  assert.deepEqual(clicked, ['span'])
})

// --- B. ambiguity & safe failure ---------------------------------------------

test('B: 两个候选（同名控件）→ ambiguous，且一个都不点击', () => {
  let clicks = 0
  const first = fakeElement({
    tag: 'BUTTON',
    text: 'New chat',
    onClick: () => {
      clicks += 1
    },
  })
  const second = fakeElement({
    tag: 'BUTTON',
    text: '新对话',
    onClick: () => {
      clicks += 1
    },
  })

  assert.deepEqual(newChatInPage({ options: OPTIONS, env: fakeEnv([first, second]) }), { outcome: 'ambiguous' })
  assert.equal(clicks, 0)
})

test('B: 完全没有候选 → missing，不点击任何东西', () => {
  let clicks = 0
  const unrelated = fakeElement({
    tag: 'BUTTON',
    text: '搜索',
    onClick: () => {
      clicks += 1
    },
  })

  assert.deepEqual(newChatInPage({ options: OPTIONS, env: fakeEnv([unrelated]) }), { outcome: 'missing' })
  assert.equal(clicks, 0)
})

test('B: 历史会话链接（标题恰好同名）永远不被当成控件', () => {
  let clicks = 0
  const historyEntry = fakeElement({
    tag: 'A',
    attrs: { href: '/a/chat/s/0b7a2d1e-0000-0000-0000-000000000000' },
    children: [fakeElement({ tag: 'DIV', text: '新对话' })],
    onClick: () => {
      clicks += 1
    },
  })

  assert.deepEqual(newChatInPage({ options: OPTIONS, env: fakeEnv([historyEntry]) }), { outcome: 'missing' })
  assert.equal(clicks, 0)
})

test('B: 无标准可点击祖先 → 点击文本元素自身（冒泡策略），绝不点无关元素', () => {
  const clicked: string[] = []
  const plain = fakeElement({
    children: [
      fakeElement({
        tag: 'SPAN',
        text: 'New chat',
        onClick: () => clicked.push('span'),
      }),
      fakeElement({
        tag: 'svg',
        onClick: () => clicked.push('svg'),
      }),
    ],
  })

  assert.deepEqual(newChatInPage({ options: OPTIONS, env: fakeEnv([plain]) }), { outcome: 'clicked' })
  assert.deepEqual(clicked, ['span'], '只点文本候选，不点同级/无关元素')
})

test('B: 文本只是「包含」标签而非精确相等 → 不选中', () => {
  const container = fakeElement({ text: '新对话开始' })
  assert.deepEqual(newChatInPage({ options: OPTIONS, env: fakeEnv([container]) }), { outcome: 'missing' })
})

test('B: 缺少浏览器环境时安全 no-op', () => {
  assert.deepEqual(newChatInPage({ options: OPTIONS, env: {} }), { outcome: 'missing' })
})

// --- C. the confirmation condition -------------------------------------------

test('C: pathname = / 且消息 DOM 为空 → 已确认新会话', () => {
  assert.equal(newChatReadyInPage({ options: CONFIRM, env: fakeEnv([], '/', 0) }), true)
})

test('C: 仍停留在旧会话路径 → 未确认', () => {
  assert.equal(newChatReadyInPage({ options: CONFIRM, env: fakeEnv([], '/a/chat/s/abc', 0) }), false)
})

test('C: 路径已切换但旧消息 DOM 还在 → 未确认', () => {
  assert.equal(newChatReadyInPage({ options: CONFIRM, env: fakeEnv([], '/', 2) }), false)
})

test('C: 缺少环境 → 未确认（绝不假定成功）', () => {
  assert.equal(newChatReadyInPage({ options: CONFIRM, env: {} }), false)
})

test('C: normalizeNewChatOutcome 只信任 clicked / ambiguous，其余视为 missing', () => {
  assert.equal(normalizeNewChatOutcome({ outcome: 'clicked' }), 'clicked')
  assert.equal(normalizeNewChatOutcome({ outcome: 'ambiguous' }), 'ambiguous')
  assert.equal(normalizeNewChatOutcome({ outcome: 'whatever' }), 'missing')
  assert.equal(normalizeNewChatOutcome(null), 'missing')
})

// --- D. Host request flow ----------------------------------------------------

function stubBrowser(behavior: () => Promise<void>): {
  browser: NewChatCapableBrowser
  state: { calls: number }
} {
  const state = { calls: 0 }
  return {
    state,
    browser: {
      async newChat(): Promise<void> {
        state.calls += 1
        await behavior()
      },
    },
  }
}

test('D: browser 未就绪 → 503，既有消息保持不变', async () => {
  const store = createCompanionStateStore()
  store.appendChatMessage('user', '旧消息')

  const result = await handleNewChatRequest(store, null, createPageGuard())

  assert.equal(result.status, 503)
  assert.equal(result.body.error, 'browser not ready')
  assert.equal(store.getState().chat.messages.length, 1)
})

test('D: 生成中 → 409，完全不触碰 browser，也绝不清空消息', async () => {
  const store = createCompanionStateStore()
  store.appendChatMessage('user', '生成中…')
  store.setChatSending(true)
  const { browser, state } = stubBrowser(async () => {})

  const result = await handleNewChatRequest(store, browser, createPageGuard())

  assert.equal(result.status, 409)
  assert.equal(result.body.error, 'chat is busy')
  assert.equal(state.calls, 0)
  assert.equal(store.getState().chat.messages.length, 1)
  assert.equal(store.getState().chat.sending, true)
})

test('D: 成功 → 页面先确认、Host 后清空（成功后 messages 为空）', async () => {
  const store = createCompanionStateStore()
  store.appendChatMessage('user', '第一轮')
  store.appendChatMessage('assistant', '回答')
  const seenByPage: number[] = []
  const { browser, state } = stubBrowser(async () => {
    // The page action runs while the Host transcript is still intact.
    seenByPage.push(store.getState().chat.messages.length)
  })

  const result = await handleNewChatRequest(store, browser, createPageGuard())

  assert.equal(result.status, 200)
  assert.deepEqual(result.body, { ok: true })
  assert.equal(state.calls, 1)
  assert.deepEqual(seenByPage, [2], '页面成功之前 Host 不得先清消息')
  assert.deepEqual(store.getState().chat.messages, [])
})

test('D: 页面失败 → 500 + 原因，且 Host 消息完全不变（绝不先清后点）', async () => {
  const store = createCompanionStateStore()
  store.appendChatMessage('user', '第一轮')
  const { browser, state } = stubBrowser(async () => {
    throw new Error('new chat control not found')
  })

  const result = await handleNewChatRequest(store, browser, createPageGuard())

  assert.equal(result.status, 500)
  assert.equal(result.body.error, 'new chat control not found')
  assert.equal(state.calls, 1)
  assert.equal(store.getState().chat.messages.length, 1)
})

// --- E. store.clearChatMessages ----------------------------------------------

test('E: 清空只动 messages：sending / Deep Think / Search / status 全部保持', () => {
  const store = createCompanionStateStore()
  store.appendChatMessage('user', 'hi')
  store.appendChatMessage('assistant', 'hello')
  store.setDeepThinkState({ available: true, enabled: true })
  store.setSearchState({ available: true, enabled: false })

  store.clearChatMessages()

  const state = store.getState()
  assert.deepEqual(state.chat.messages, [])
  assert.equal(state.chat.sending, false)
  assert.deepEqual(state.deepseek.deepThink, { available: true, enabled: true })
  assert.deepEqual(state.deepseek.search, { available: true, enabled: false })
  assert.equal(state.deepseek.status, 'checking')
  assert.equal(state.status, 'ready')
})

test('E: 已为空时零通知（不产生无意义的 SSE 推送）', () => {
  const store = createCompanionStateStore()
  let notifies = 0
  store.subscribe(() => {
    notifies += 1
  })
  notifies = 0 // ignore the subscribe replay

  store.clearChatMessages()
  assert.equal(notifies, 0, '已经为空 → 不 notify')

  store.appendChatMessage('user', 'hi')
  assert.equal(notifies, 1)

  store.clearChatMessages()
  assert.equal(notifies, 2, '真正清空恰好通知一次')

  store.clearChatMessages()
  assert.equal(notifies, 2, '再次清空（已为空）不再通知')
})

test('E: sending 为 true 时清空也不会改变 sending 字段', () => {
  const store = createCompanionStateStore()
  store.appendChatMessage('user', 'hi')
  store.setChatSending(true)

  store.clearChatMessages()

  assert.deepEqual(store.getState().chat.messages, [])
  assert.equal(store.getState().chat.sending, true)
})

// --- F. the next chat is a clean slate ---------------------------------------

const send = async (_message: string, onDelta: (reply: AssistantReply) => void): Promise<AssistantReply> => {
  onDelta({ content: '回答', format: 'markdown' })
  return { content: '回答', format: 'markdown' }
}

test('F: 旧会话的 citation 迟到不会写入新会话', async () => {
  const store = createCompanionStateStore()
  let late: ((citations: Citation[]) => void) | null = null
  await handleChatMessage(
    store,
    async (_message, onDelta, _onReasoning, onCitations) => {
      onDelta({ content: '搜索结果', format: 'markdown' })
      late = onCitations
      return { content: '搜索结果', format: 'markdown' }
    },
    '查询',
  )
  assert.equal(store.getState().chat.messages.length, 2)

  store.clearChatMessages()
  assert.deepEqual(store.getState().chat.messages, [])

  // The previous reply's background hydration only NOW finds its URLs: its
  // target id is gone, so the write is a natural no-op.
  assert.ok(late !== null, 'send flow 必须暴露 onCitations')
  ;(late as (citations: Citation[]) => void)([{ marker: 1, url: 'https://a.com', domain: 'a.com' }])
  assert.deepEqual(store.getState().chat.messages, [])
})

test('F: 新会话后再次发送正常（消息从 0 重新累积）', async () => {
  const store = createCompanionStateStore()
  const first = await handleChatMessage(store, send, '第一条')
  assert.equal(first.status, 200)
  assert.equal(store.getState().chat.messages.length, 2)

  store.clearChatMessages()

  const second = await handleChatMessage(store, send, '第二条')
  assert.equal(second.status, 200)
  const messages = store.getState().chat.messages
  assert.equal(messages.length, 2)
  assert.equal(messages[0]!.content, '第二条')
  assert.equal(store.getState().chat.sending, false)
})

test('F: 清空后每个订阅者（Dock / Float / Pop-out）读到同一份空消息', () => {
  const store = createCompanionStateStore()
  const seen: number[] = []
  store.subscribe((state) => seen.push(state.chat.messages.length))
  store.appendChatMessage('user', 'hi')
  seen.length = 0

  store.clearChatMessages()

  assert.deepEqual(seen, [0])
})

// --- G. Host guard: new chat and send never share the page --------------------

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

test('G: tryClaim 是同步原子的——同一时刻只有一个持有者', () => {
  const guard: PageGuard = createPageGuard()

  assert.equal(guard.inProgress(), false)
  assert.equal(guard.tryClaim(), true)
  assert.equal(guard.inProgress(), true)
  assert.equal(guard.tryClaim(), false, '第二个持有者必须失败')
  guard.release()
  assert.equal(guard.inProgress(), false)
  assert.equal(guard.tryClaim(), true, '释放后可以重新声明')
  guard.release()
})

test('G-A: newChat 进行中 → 发送被 409 拒绝，且 sendMessage 零调用', async () => {
  const store = createCompanionStateStore()
  const guard = createPageGuard()
  const gate = deferred()
  const { browser } = stubBrowser(() => gate.promise)

  const pending = handleNewChatRequest(store, browser, guard)
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(guard.inProgress(), true, '页面切换期间 guard 必须被持有')

  let sendCalls = 0
  const result = await handleChatMessage(
    store,
    async () => {
      sendCalls += 1
      return { content: '不该发出去', format: 'text' } satisfies AssistantReply
    },
    '抢跑',
    guard,
  )

  assert.equal(result.status, 409)
  assert.equal(result.body.error, 'page operation in progress')
  assert.equal(sendCalls, 0, 'sendMessage 绝不能被调用')
  assert.equal(store.getState().chat.messages.length, 0, '被拒绝的发送不得留下任何消息')

  gate.resolve()
  assert.equal((await pending).status, 200)
  assert.equal(guard.inProgress(), false, '切换结束后 guard 释放')
})

test('G-B: 三个界面同时请求 newChat → 真实控件最多点击一次（其余 409）', async () => {
  const store = createCompanionStateStore()
  store.appendChatMessage('user', '旧消息')
  const guard = createPageGuard()
  const gate = deferred()
  const { browser, state } = stubBrowser(async () => {
    await gate.promise
  })

  const winner = handleNewChatRequest(store, browser, guard)
  const loserA = handleNewChatRequest(store, browser, guard)
  const loserB = handleNewChatRequest(store, browser, guard)

  // The two losers are refused synchronously — they resolve without touching the
  // page, while the winner is still awaiting the (gated) page switch.
  const b = await loserA
  const c = await loserB
  assert.equal(b.status, 409)
  assert.equal(b.body.error, 'page operation in progress')
  assert.equal(c.status, 409)
  assert.equal(c.body.error, 'page operation in progress')
  assert.equal(state.calls, 1, '第二/第三个请求绝不触碰页面')

  gate.resolve()
  const a = await winner
  assert.equal(a.status, 200)
  assert.equal(state.calls, 1, '整轮只点击一次')
  assert.deepEqual(store.getState().chat.messages, [])
})

test('G-C: browser.newChat 抛错 → guard 在 finally 正确释放，下一次可以重试', async () => {
  const store = createCompanionStateStore()
  store.appendChatMessage('user', '旧消息')
  const guard = createPageGuard()
  let fail = true
  const { browser, state } = stubBrowser(async () => {
    if (fail) throw new Error('new chat did not open')
  })

  const first = await handleNewChatRequest(store, browser, guard)
  assert.equal(first.status, 500)
  assert.equal(first.body.error, 'new chat did not open')
  assert.equal(guard.inProgress(), false, 'finally 必须释放 guard')
  assert.equal(store.getState().chat.messages.length, 1, '失败不清空')

  fail = false
  const second = await handleNewChatRequest(store, browser, guard)
  assert.equal(second.status, 200)
  assert.equal(state.calls, 2, '释放后重试可以真正执行')
  assert.deepEqual(store.getState().chat.messages, [])
})

test('G-D: newChat 成功后 guard 释放 → 下一条发送正常', async () => {
  const store = createCompanionStateStore()
  store.appendChatMessage('user', '旧消息')
  const guard = createPageGuard()
  const { browser } = stubBrowser(async () => {})

  assert.equal((await handleNewChatRequest(store, browser, guard)).status, 200)
  assert.equal(guard.inProgress(), false)

  const result = await handleChatMessage(store, send, '新会话第一条', guard)
  assert.equal(result.status, 200)
  const messages = store.getState().chat.messages
  assert.equal(messages.length, 2)
  assert.equal(messages[0]!.content, '新会话第一条')
})

test('G: 不传 guard 时 handleChatMessage 完全保持原有行为', async () => {
  const store = createCompanionStateStore()
  const result = await handleChatMessage(store, send, 'hi')

  assert.equal(result.status, 200)
  assert.equal(store.getState().chat.messages.length, 2)
})

// --- Phase 08.2: new chat also clears the current session ---------------------

test('08.2: 新建成功 → currentSession 归零（页面确实停在 /）', async () => {
  const store = createCompanionStateStore()
  store.setCurrentSession({ id: 'a1', title: '会话 A' })
  store.appendChatMessage('user', '旧消息')
  const { browser } = stubBrowser(async () => {})

  const result = await handleNewChatRequest(store, browser, createPageGuard())

  assert.equal(result.status, 200)
  assert.deepEqual(store.getState().currentSession, { id: null, title: null })
})

test('08.2: 新建失败 → currentSession 保持原样（绝不清成空会话）', async () => {
  const store = createCompanionStateStore()
  store.setCurrentSession({ id: 'a1', title: '会话 A' })
  const { browser } = stubBrowser(async () => {
    throw new Error('new chat did not open')
  })

  const result = await handleNewChatRequest(store, browser, createPageGuard())

  assert.equal(result.status, 500)
  assert.deepEqual(store.getState().currentSession, { id: 'a1', title: '会话 A' })
})

test('08.2: 新建后的第一条消息不再带旧会话 id（归属由 watcher 认领）', async () => {
  const store = createCompanionStateStore()
  store.setCurrentSession({ id: 'a1', title: '会话 A' })
  const { browser } = stubBrowser(async () => {})
  await handleNewChatRequest(store, browser, createPageGuard())

  const message = store.appendChatMessage('user', '新会话第一条')

  assert.equal(message.sessionId, undefined, 'id 由 DeepSeek 在首次发送时铸出，随后由 adoptSessionMessages 认领')
})
