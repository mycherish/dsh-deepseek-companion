import assert from 'node:assert/strict'
import test from 'node:test'

import type { DomBlock } from '../src/host/citations.ts'
import { handleChatMessage } from '../src/host/chat.ts'
import { createPageGuard } from '../src/host/guard.ts'
import { handleNewChatRequest, type NewChatCapableBrowser } from '../src/host/new-chat.ts'
import {
  buildTranscript,
  conversationIdFromPath,
  handleListSessionsRequest,
  handleSwitchChatRequest,
  isValidConversationId,
  needsSwitchChat,
  normalizeSessionsResult,
  normalizeSwitchOutcome,
  normalizeTranscript,
  readSessionsInPage,
  readTranscriptInPage,
  scrollMessagesInPage,
  switchChatInPage,
  switchChatReadyInPage,
  toSessionSummaries,
  transcriptNeedsBlocks,
  type SessionLinkOptions,
  type SessionsCapableBrowser,
  type SessionsEnv,
  type SwitchChatOptions,
  type TranscriptOptions,
  type TranscriptEntryRaw,
} from '../src/host/sessions.ts'
import { createCompanionStateStore } from '../src/host/state.ts'
import type { AssistantReply, ChatMessageInput, Citation } from '../src/shared/state.ts'

const VALID_ID = 'aaaaaaaa-1111-4111-8111-111111111111'
const OTHER_ID = 'bbbbbbbb-2222-4222-8222-222222222222'

const LINKS: SessionLinkOptions = { linkSelector: 'a[href*="/a/chat/s/"]', hrefMarker: '/a/chat/s/' }
const SWITCH: Omit<SwitchChatOptions, 'conversationId'> = { ...LINKS, messageSelector: '.ds-message' }
const TRANSCRIPT: TranscriptOptions = {
  messageSelector: '.ds-message',
  replySelector: '.ds-assistant-message-main-content',
  replyFallback: '.ds-markdown',
  reasoningSelector: '.ds-think-content',
  maxFiberScan: 10,
}

// --- a tiny fake DOM (deliberately not a framework) ---------------------------

class FakeEl {
  tagName: string
  textContent: string
  attrs: Record<string, string>
  isConnected = true
  clicks = 0
  /** Explicit selector map: querySelector/All never do real CSS matching. */
  map: Record<string, FakeEl[]> = {}
  closestMap: Record<string, FakeEl | null> = {}

  constructor(init: { tag?: string; text?: string; attrs?: Record<string, string> } = {}) {
    this.tagName = init.tag ?? 'DIV'
    this.textContent = init.text ?? ''
    this.attrs = init.attrs ?? {}
  }

  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null
  }

  click(): void {
    this.clicks += 1
  }

  querySelector(selector: string): FakeEl | null {
    return this.map[selector]?.[0] ?? null
  }

  querySelectorAll(selector: string): FakeEl[] {
    return this.map[selector] ?? []
  }

  closest(selector: string): FakeEl | null {
    return this.closestMap[selector] ?? null
  }
}

function link(title: string, href: string): FakeEl {
  return new FakeEl({ tag: 'A', text: title, attrs: { href } })
}

/** Build a fiber chain: deepest props first, each linked through `return`. */
function fiberChain(propsList: Record<string, unknown>[]): unknown {
  let next: unknown = null
  for (let index = propsList.length - 1; index >= 0; index -= 1) {
    next = { memoizedProps: propsList[index], return: next }
  }
  return next
}

function withFiber(el: FakeEl, fiber: unknown): FakeEl {
  ;(el as unknown as Record<string, unknown>)['__reactFiber$test'] = fiber
  return el
}

function sessionsEnv(init: {
  links?: FakeEl[]
  messages?: FakeEl[]
  pathname?: string
  window?: Record<string, unknown>
}): SessionsEnv {
  const messages = init.messages ?? []
  const collect = (selector: string): FakeEl[] => messages.flatMap((message) => message.querySelectorAll(selector))
  return {
    document: {
      querySelectorAll: (selector: string) => {
        if (selector === LINKS.linkSelector) return init.links ?? []
        if (selector === TRANSCRIPT.messageSelector) return messages
        if (selector === TRANSCRIPT.replySelector) return collect(TRANSCRIPT.replySelector)
        if (selector === TRANSCRIPT.replyFallback) return collect(TRANSCRIPT.replyFallback)
        if (selector === TRANSCRIPT.reasoningSelector) return collect(TRANSCRIPT.reasoningSelector)
        return []
      },
    },
    location: { pathname: init.pathname ?? '/' },
    window: init.window ?? {},
  }
}

/** One assistant message with a reply node and optional reasoning/text. */
function assistantMessage(init: { text?: string; fiber?: unknown; reasoning?: string; fallback?: boolean }): FakeEl {
  const message = new FakeEl()
  const reply = new FakeEl({ text: init.text ?? '' })
  if (init.fiber !== undefined) withFiber(reply, init.fiber)
  message.map[init.fallback === true ? TRANSCRIPT.replyFallback : TRANSCRIPT.replySelector] = [reply]
  if (init.reasoning !== undefined) {
    message.map[TRANSCRIPT.reasoningSelector] = [new FakeEl({ text: init.reasoning })]
  }
  return message
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

// --- J. sidebar session listing ----------------------------------------------

test('J: 从 href 解析 id 与标题，按 id 去重，currentId 来自 pathname', () => {
  const env = sessionsEnv({
    links: [
      link('会话甲', `/a/chat/s/${VALID_ID}`),
      link('会话甲', `/a/chat/s/${OTHER_ID}`),
      link('会话甲', `/a/chat/s/${VALID_ID}`),
    ],
    pathname: `/a/chat/s/${OTHER_ID}`,
  })

  const result = readSessionsInPage({ options: LINKS, env })

  assert.equal(result.sessions.length, 2, '重复 id 只保留一次')
  assert.deepEqual(
    result.sessions.map((entry) => entry.id),
    [VALID_ID, OTHER_ID],
  )
  assert.equal(result.currentId, OTHER_ID)
})

test('J: 重复标题但不同 id → 两条独立会话（标题绝不作为键）', () => {
  const env = sessionsEnv({ links: [link('同名', `/a/chat/s/${VALID_ID}`), link('同名', `/a/chat/s/${OTHER_ID}`)] })

  const summaries = toSessionSummaries(readSessionsInPage({ options: LINKS, env }))

  assert.deepEqual(summaries, [
    { id: VALID_ID, title: '同名', active: false },
    { id: OTHER_ID, title: '同名', active: false },
  ])
})

test('J: active 只由 id 相等决定（同标题的另一会话不会被标记）', () => {
  const env = sessionsEnv({
    links: [link('同名', `/a/chat/s/${VALID_ID}`), link('同名', `/a/chat/s/${OTHER_ID}`)],
    pathname: `/a/chat/s/${OTHER_ID}`,
  })

  const summaries = toSessionSummaries(readSessionsInPage({ options: LINKS, env }))

  assert.deepEqual(
    summaries.map((entry) => entry.active),
    [false, true],
  )
})

test('J: href 没有 id / 空 id 一律跳过', () => {
  const env = sessionsEnv({
    links: [
      new FakeEl({ tag: 'A', text: '无 href' }),
      link('空 id', '/a/chat/s/'),
      link('正常', `/a/chat/s/${VALID_ID}`),
    ],
  })

  const result = readSessionsInPage({ options: LINKS, env })

  assert.deepEqual(
    result.sessions.map((entry) => entry.id),
    [VALID_ID],
  )
  assert.equal(result.currentId, null, '/ 上没有会话 id')
})

test('J: 缺少浏览器环境时返回空列表而不是崩溃', () => {
  assert.deepEqual(readSessionsInPage({ options: LINKS, env: {} }), { sessions: [], currentId: null })
})

test('J: normalizeSessionsResult 只信任形状正确的条目', () => {
  const result = normalizeSessionsResult({
    sessions: [{ id: 'abc', title: 't' }, { id: '' }, { nope: true }, 'x', { id: 'def' }],
    currentId: 'abc',
  })

  assert.deepEqual(result, {
    sessions: [
      { id: 'abc', title: 't' },
      { id: 'def', title: '' },
    ],
    currentId: 'abc',
  })
})

// --- K. switching -------------------------------------------------------------

test('K: 精确匹配 conversationId → 只点击目标链接一次并记录重建基准', () => {
  const target = link('目标会话', `/a/chat/s/${VALID_ID}`)
  const other = link('别的会话', `/a/chat/s/${OTHER_ID}`)
  const win: Record<string, unknown> = {}
  const env = sessionsEnv({ links: [other, target], pathname: `/a/chat/s/${OTHER_ID}`, window: win })

  const outcome = switchChatInPage({ options: { ...SWITCH, conversationId: VALID_ID }, env })

  assert.deepEqual(outcome, { outcome: 'clicked' })
  assert.equal(target.clicks, 1)
  assert.equal(other.clicks, 0, '绝不点别的会话')
  assert.ok(Array.isArray(win['__switchBase']), '点击前必须记录旧消息节点')
})

test('K: 找不到该 id → missing，零点击', () => {
  const other = link('别的会话', `/a/chat/s/${OTHER_ID}`)
  const env = sessionsEnv({ links: [other] })

  assert.deepEqual(switchChatInPage({ options: { ...SWITCH, conversationId: VALID_ID }, env }), { outcome: 'missing' })
  assert.equal(other.clicks, 0)
})

test('K: 同一个 id 出现两次 → ambiguous，零点击', () => {
  const first = link('甲', `/a/chat/s/${VALID_ID}`)
  const second = link('乙', `/a/chat/s/${VALID_ID}`)
  const env = sessionsEnv({ links: [first, second] })

  assert.deepEqual(switchChatInPage({ options: { ...SWITCH, conversationId: VALID_ID }, env }), {
    outcome: 'ambiguous',
  })
  assert.equal(first.clicks + second.clicks, 0)
})

test('K: 确认条件 = pathname 命中 + 旧消息节点全部脱链', () => {
  const old = new FakeEl()
  const win: Record<string, unknown> = {}
  const options = { ...SWITCH, conversationId: VALID_ID }
  // Record the base through the real click step.
  switchChatInPage({
    options,
    env: sessionsEnv({ links: [link('目标', `/a/chat/s/${VALID_ID}`)], messages: [old], window: win }),
  })

  // Still on the old conversation → not ready.
  assert.equal(
    switchChatReadyInPage({ options, env: sessionsEnv({ pathname: `/a/chat/s/${OTHER_ID}`, window: win }) }),
    false,
  )
  // Pathname switched but the old node is still attached → not ready.
  assert.equal(
    switchChatReadyInPage({ options, env: sessionsEnv({ pathname: `/a/chat/s/${VALID_ID}`, window: win }) }),
    false,
    '旧节点仍连着 → 重建还没完成',
  )
  // The real signal: the old node detached.
  old.isConnected = false
  assert.equal(
    switchChatReadyInPage({ options, env: sessionsEnv({ pathname: `/a/chat/s/${VALID_ID}`, window: win }) }),
    true,
  )
})

test('K: 目标会话已经在屏幕上 → 不需要再次点击', () => {
  assert.equal(needsSwitchChat(VALID_ID, VALID_ID), false)
  assert.equal(needsSwitchChat(OTHER_ID, VALID_ID), true)
  assert.equal(needsSwitchChat(null, VALID_ID), true)
})

test('K: normalizeSwitchOutcome 只信任 clicked / ambiguous', () => {
  assert.equal(normalizeSwitchOutcome({ outcome: 'clicked' }), 'clicked')
  assert.equal(normalizeSwitchOutcome({ outcome: 'ambiguous' }), 'ambiguous')
  assert.equal(normalizeSwitchOutcome({ outcome: 'whatever' }), 'missing')
  assert.equal(normalizeSwitchOutcome(null), 'missing')
})

test('K: conversationIdFromPath 解析 id，非法路径返回 null', () => {
  assert.equal(conversationIdFromPath(`/a/chat/s/${VALID_ID}`, '/a/chat/s/'), VALID_ID)
  assert.equal(conversationIdFromPath(`/a/chat/s/${VALID_ID}?x=1`, '/a/chat/s/'), VALID_ID)
  assert.equal(conversationIdFromPath('/', '/a/chat/s/'), null)
  assert.equal(conversationIdFromPath('/a/chat/s/', '/a/chat/s/'), null)
})

test('K: isValidConversationId 拒绝路径穿越等非法输入', () => {
  assert.equal(isValidConversationId(VALID_ID), true)
  assert.equal(isValidConversationId('short'), false)
  assert.equal(isValidConversationId('../../etc/passwd'), false)
  assert.equal(isValidConversationId('a b c d e f'), false)
  assert.equal(isValidConversationId(''), false)
})

// --- H. transcript rebuild ----------------------------------------------------

test('H: user + assistant 顺序与角色由结构决定（不看 hash class）', () => {
  const user = new FakeEl({ text: '什么是栈？' })
  const assistant = assistantMessage({ text: '栈是后进先出。', reasoning: '先想想…' })

  const { entries } = readTranscriptInPage({ options: TRANSCRIPT, env: sessionsEnv({ messages: [user, assistant] }) })

  assert.deepEqual(
    entries.map((entry) => entry.role),
    ['user', 'assistant'],
  )
  assert.equal(entries[0]!.content, '什么是栈？')
  assert.equal(entries[0]!.replyIndex, -1)
  assert.equal(entries[1]!.reasoning, '先想想…')
  assert.equal(entries[1]!.replyIndex, 0)
})

test('18B: 同一条 user 消息的历史图片与文本一起恢复；纯图片消息保留', () => {
  const imageOnly = new FakeEl()
  imageOnly.map.img = [
    new FakeEl({
      tag: 'IMG',
      attrs: {
        src: 'https://files.deepseeksvc.com/api/file?file_id=file-one&state=signed&ty=chat',
        alt: 'one.png',
      },
    }),
  ]
  const mixed = new FakeEl({ text: '请描述图片' })
  mixed.map.img = [
    new FakeEl({
      tag: 'IMG',
      attrs: {
        src: '/api/file?file_id=file-two&state=signed&ty=chat',
        alt: 'two.jpg',
      },
    }),
  ]
  const entries = readTranscriptInPage({
    options: TRANSCRIPT,
    env: sessionsEnv({ messages: [imageOnly, mixed] }),
  }).entries
  const messages = buildTranscript(normalizeTranscript({ entries }).entries, [])

  assert.deepEqual(messages, [
    {
      role: 'user',
      content: '',
      format: 'text',
      attachments: [
        {
          id: 'file-one',
          kind: 'image',
          name: 'one.png',
          remoteUrl: 'https://files.deepseeksvc.com/api/file?file_id=file-one&state=signed&ty=chat',
        },
      ],
    },
    {
      role: 'user',
      content: '请描述图片',
      format: 'text',
      attachments: [
        {
          id: 'file-two',
          kind: 'image',
          name: 'two.jpg',
          remoteUrl: 'https://chat.deepseek.com/api/file?file_id=file-two&state=signed&ty=chat',
        },
      ],
    },
  ])
})

test('18B: 无法证明为历史附件的图片不挂到消息，重复 file_id 不猜', () => {
  const user = new FakeEl({ text: '文本保留' })
  user.map.img = [
    new FakeEl({ tag: 'IMG', attrs: { src: 'https://evil.example/api/file?file_id=file-one', alt: 'fake.png' } }),
    new FakeEl({
      tag: 'IMG',
      attrs: { src: 'https://files.deepseeksvc.com/api/file?state=signed', alt: 'missing.png' },
    }),
    new FakeEl({
      tag: 'IMG',
      attrs: { src: 'https://files.deepseeksvc.com/api/file?file_id=file-a&state=s', alt: 'a.png' },
    }),
    new FakeEl({
      tag: 'IMG',
      attrs: { src: 'https://files.deepseeksvc.com/api/file?file_id=file-a&state=s', alt: 'duplicate.png' },
    }),
  ]
  const entry = readTranscriptInPage({ options: TRANSCRIPT, env: sessionsEnv({ messages: [user] }) }).entries[0]!
  assert.deepEqual(buildTranscript([entry], []), [{ role: 'user', content: '文本保留', format: 'text' }])
})

test('18B: Host 再校验页面返回的签名 URL 与 file_id', () => {
  const entries = normalizeTranscript({
    entries: [
      {
        role: 'user',
        content: '保留文本',
        attachments: [
          {
            id: 'file-a',
            kind: 'image',
            name: 'a.png',
            remoteUrl: 'https://evil.example/api/file?file_id=file-a&state=s',
          },
        ],
      },
      {
        role: 'user',
        content: '',
        attachments: [
          {
            id: 'file-a',
            kind: 'image',
            name: 'a.png',
            remoteUrl: 'https://files.deepseeksvc.com/api/file?file_id=file-b&state=s',
          },
        ],
      },
    ],
  }).entries
  assert.deepEqual(buildTranscript(entries, []), [{ role: 'user', content: '保留文本', format: 'text' }])
})

test('H: fiber markdown 命中 → content = 原始 Markdown，format = markdown', () => {
  const assistant = assistantMessage({
    text: '渲染出来的正文',
    fiber: fiberChain([{ markdown: '# 标题\n\n正文 [citation:1]' }]),
  })

  const { entries } = readTranscriptInPage({ options: TRANSCRIPT, env: sessionsEnv({ messages: [assistant] }) })

  assert.equal(entries[0]!.content, '# 标题\n\n正文 [citation:1]')
  assert.equal(entries[0]!.format, 'markdown')
})

test('H: fiber 不可用 → DOM 文本 fallback（format = text）', () => {
  const assistant = assistantMessage({ text: '只有渲染文本' })

  const { entries } = readTranscriptInPage({ options: TRANSCRIPT, env: sessionsEnv({ messages: [assistant] }) })

  assert.equal(entries[0]!.content, '只有渲染文本')
  assert.equal(entries[0]!.format, 'text')
})

test('H: content prop 与渲染文本不匹配 → 不采用（回退到 text）', () => {
  const assistant = assistantMessage({ text: '真实的渲染文本', fiber: fiberChain([{ content: '完全不相干的内容' }]) })

  const { entries } = readTranscriptInPage({ options: TRANSCRIPT, env: sessionsEnv({ messages: [assistant] }) })

  assert.equal(entries[0]!.content, '真实的渲染文本')
  assert.equal(entries[0]!.format, 'text')
})

test('H: content prop 与渲染文本匹配 → 采用为 markdown', () => {
  const assistant = assistantMessage({ text: '栈是后进先出。', fiber: fiberChain([{ content: '栈是后进先出。' }]) })

  const { entries } = readTranscriptInPage({ options: TRANSCRIPT, env: sessionsEnv({ messages: [assistant] }) })

  assert.equal(entries[0]!.content, '栈是后进先出。')
  assert.equal(entries[0]!.format, 'markdown')
})

test('H: 全页没有主回复类时，fallback 容器也参与角色判定', () => {
  const assistant = assistantMessage({ text: 'fallback 正文', fallback: true })

  const { entries } = readTranscriptInPage({ options: TRANSCRIPT, env: sessionsEnv({ messages: [assistant] }) })

  assert.equal(entries[0]!.role, 'assistant')
  assert.equal(entries[0]!.content, 'fallback 正文')
})

test('H: normalizeTranscript 丢弃形状不对的条目', () => {
  const result = normalizeTranscript({
    entries: [
      { role: 'user', content: 'ok' },
      { role: 'system', content: 'nope' },
      { role: 'assistant', content: 42 },
      { role: 'assistant', content: 'ok', format: 'markdown', reasoning: 'r', replyIndex: 0 },
    ],
  })

  assert.deepEqual(result.entries, [
    { role: 'user', content: 'ok', format: 'text', reasoning: '', replyIndex: -1 },
    { role: 'assistant', content: 'ok', format: 'markdown', reasoning: 'r', replyIndex: 0 },
  ])
})

test('H: buildTranscript 组装 reasoning 与 citations（block 映射成功）', () => {
  const entries: TranscriptEntryRaw[] = [
    { role: 'user', content: '问题', format: 'text', reasoning: '', replyIndex: -1 },
    { role: 'assistant', content: '答案 [citation:1]', format: 'markdown', reasoning: '思考', replyIndex: 0 },
    { role: 'assistant', content: '纯文本回答', format: 'text', reasoning: '', replyIndex: 1 },
  ]
  const blocks: DomBlock[][] = [[{ text: '答案 ', badges: ['https://a.com/x'] }]]

  const messages = buildTranscript(entries, blocks)

  assert.deepEqual(messages[0], { role: 'user', content: '问题', format: 'text' })
  assert.equal(messages[1]!.content, '答案 [citation:1]')
  assert.equal(messages[1]!.format, 'markdown')
  assert.deepEqual(messages[1]!.reasoning, { content: '思考', format: 'text' })
  assert.deepEqual(messages[1]!.citations, [{ marker: 1, url: 'https://a.com/x', domain: 'a.com' }])
  assert.equal(messages[2]!.reasoning, undefined, '没有 reasoning 就不产生字段')
  assert.equal(messages[2]!.citations, undefined, 'text 格式不参与 citation 映射')
})

test('H: buildTranscript 在无法映射 citations 时省略（不猜）', () => {
  const entries: TranscriptEntryRaw[] = [
    { role: 'assistant', content: '答案 [citation:1]', format: 'markdown', reasoning: '', replyIndex: 0 },
  ]

  const messages = buildTranscript(entries, [])

  assert.equal(messages[0]!.citations, undefined)
  assert.equal(messages[0]!.content, '答案 [citation:1]')
})

test('H: buildTranscript 丢弃空 user 气泡；transcriptNeedsBlocks 只在需要时要求 blocks', () => {
  assert.deepEqual(
    buildTranscript([{ role: 'user', content: '', format: 'text', reasoning: '', replyIndex: -1 }], []),
    [],
  )

  const markdownEntries: TranscriptEntryRaw[] = [
    { role: 'assistant', content: 'a', format: 'markdown', reasoning: '', replyIndex: 0 },
  ]
  assert.equal(transcriptNeedsBlocks(markdownEntries), true)
  assert.equal(
    transcriptNeedsBlocks([{ role: 'assistant', content: 'a', format: 'text', reasoning: '', replyIndex: 0 }]),
    false,
  )
  assert.equal(
    transcriptNeedsBlocks([{ role: 'user', content: 'q', format: 'text', reasoning: '', replyIndex: -1 }]),
    false,
  )
})

// --- L. store.replaceChatMessages --------------------------------------------

test('L: 一次替换、一次 notify，且每条消息拿到新的 Host id', () => {
  const store = createCompanionStateStore()
  store.appendChatMessage('user', '旧会话')
  const notifies: number[] = []
  store.subscribe((state) => notifies.push(state.chat.messages.length))
  notifies.length = 0

  store.replaceChatMessages([
    { role: 'user', content: '历史问题', format: 'text' },
    { role: 'assistant', content: '历史回答', format: 'markdown' },
  ])

  assert.deepEqual(notifies, [2], '恰好一次推送')
  const messages = store.getState().chat.messages
  assert.equal(messages.length, 2)
  assert.ok(messages[0]!.id.length > 0)
  assert.notEqual(messages[0]!.id, messages[1]!.id)
})

test('L: 内容等价（id 不同）→ 不再 notify；内容变化才推送', () => {
  const store = createCompanionStateStore()
  store.replaceChatMessages([{ role: 'user', content: 'hi', format: 'text' }])
  let notifies = 0
  store.subscribe(() => {
    notifies += 1
  })
  notifies = 0

  store.replaceChatMessages([{ role: 'user', content: 'hi', format: 'text' }])
  assert.equal(notifies, 0, '重新读同一个会话不应产生无意义推送')

  store.replaceChatMessages([{ role: 'user', content: 'hi 2', format: 'text' }])
  assert.equal(notifies, 1)
})

test('L: 替换不动 sending / Deep Think / Search / login status', () => {
  const store = createCompanionStateStore()
  store.setDeepThinkState({ available: true, enabled: true })
  store.setSearchState({ available: true, enabled: false })

  store.replaceChatMessages([{ role: 'user', content: 'x', format: 'text' }])

  const state = store.getState()
  assert.equal(state.chat.sending, false)
  assert.deepEqual(state.deepseek.deepThink, { available: true, enabled: true })
  assert.deepEqual(state.deepseek.search, { available: true, enabled: false })
  assert.equal(state.deepseek.status, 'checking')
})

test('L: 替换为空数组就是清空（一次 notify）', () => {
  const store = createCompanionStateStore()
  store.appendChatMessage('user', 'old')
  let notifies = 0
  store.subscribe(() => {
    notifies += 1
  })
  notifies = 0

  store.replaceChatMessages([])
  assert.deepEqual(store.getState().chat.messages, [])
  assert.equal(notifies, 1)

  store.replaceChatMessages([])
  assert.equal(notifies, 1, '已经为空 → 静默')
})

// --- 旧后台任务 ----------------------------------------------------------------

test('旧会话的 citation 迟到（切换后）→ 自然 no-op，不污染新会话', async () => {
  const store = createCompanionStateStore()
  let late: ((citations: Citation[]) => void) | null = null
  await handleChatMessage(
    store,
    async (_message, onDelta, _onReasoning, onCitations) => {
      onDelta({ content: '旧会话回答 [citation:1]', format: 'markdown' })
      late = onCitations
      return { content: '旧会话回答 [citation:1]', format: 'markdown' }
    },
    '旧问题',
  )

  store.replaceChatMessages([{ role: 'user', content: '新会话问题', format: 'text' }])

  assert.ok(late !== null)
  ;(late as (citations: Citation[]) => void)([{ marker: 1, url: 'https://a.com', domain: 'a.com' }])
  const messages = store.getState().chat.messages
  assert.equal(messages.length, 1)
  assert.equal(messages[0]!.citations, undefined)
})

// --- M. Host flows & concurrency ---------------------------------------------

const TRANSCRIPT_FIXTURE: ChatMessageInput[] = [
  { role: 'user', content: '历史问题', format: 'text' },
  { role: 'assistant', content: '历史回答', format: 'markdown' },
]

/** A sessions-capable browser stub (deliberately not a mock framework). */
function stubSessionsBrowser(
  init: {
    onSwitch?: () => Promise<void>
    transcript?: ChatMessageInput[]
    sessions?: { id: string; title: string; active: boolean }[]
  } = {},
): { browser: SessionsCapableBrowser; state: { switches: number; lists: number; reads: number } } {
  const state = { switches: 0, lists: 0, reads: 0 }
  return {
    state,
    browser: {
      async listSessions() {
        state.lists += 1
        return init.sessions ?? []
      },
      async switchChat() {
        state.switches += 1
        await (init.onSwitch?.() ?? Promise.resolve())
      },
      async readTranscript() {
        state.reads += 1
        return init.transcript ?? TRANSCRIPT_FIXTURE
      },
    },
  }
}

/** A new-chat stub that only counts its calls. */
function stubNewChatBrowser(): { browser: NewChatCapableBrowser; state: { calls: number } } {
  const state = { calls: 0 }
  return {
    state,
    browser: {
      async newChat() {
        state.calls += 1
      },
    },
  }
}

const send = async (_message: string, onDelta: (reply: AssistantReply) => void): Promise<AssistantReply> => {
  onDelta({ content: '回答', format: 'markdown' })
  return { content: '回答', format: 'markdown' }
}

test('M: browser 未就绪 → 503（列表与切换一致）', async () => {
  const store = createCompanionStateStore()

  assert.equal((await handleListSessionsRequest(null)).status, 503)
  const result = await handleSwitchChatRequest(store, null, createPageGuard(), { conversationId: VALID_ID })
  assert.equal(result.status, 503)
  assert.equal(result.body.error, 'browser not ready')
})

test('M: conversationId 非法 → 400，且完全不触碰 browser / guard', async () => {
  const store = createCompanionStateStore()
  const guard = createPageGuard()
  const { browser, state } = stubSessionsBrowser()

  for (const body of [null, {}, { conversationId: 42 }, { conversationId: 'short' }, { conversationId: '../../etc' }]) {
    const result = await handleSwitchChatRequest(store, browser, guard, body)
    assert.equal(result.status, 400, JSON.stringify(body))
  }
  assert.equal(state.switches, 0)
  assert.equal(guard.inProgress(), false)
})

test('M: 列表流透传 Host 读到的会话（browser null → 503）', async () => {
  const { browser, state } = stubSessionsBrowser({
    sessions: [{ id: VALID_ID, title: '会话甲', active: true }],
  })

  const result = await handleListSessionsRequest(browser)

  assert.equal(result.status, 200)
  assert.deepEqual(result.body.sessions, [{ id: VALID_ID, title: '会话甲', active: true }])
  assert.equal(state.lists, 1)
})

// --- 并发 A-F -----------------------------------------------------------------

test('M-A: sending 中 switch → 409，页面零点击，transcript 不变', async () => {
  const store = createCompanionStateStore()
  store.appendChatMessage('user', '正在生成')
  store.setChatSending(true)
  const { browser, state } = stubSessionsBrowser()

  const result = await handleSwitchChatRequest(store, browser, createPageGuard(), { conversationId: VALID_ID })

  assert.equal(result.status, 409)
  assert.equal(result.body.error, 'chat is busy')
  assert.equal(state.switches, 0, '绝不能触碰页面')
  assert.equal(store.getState().chat.messages.length, 1)
})

test('M-B: switch 进行中 → 发送被 409 拒绝，sendMessage 零调用', async () => {
  const store = createCompanionStateStore()
  store.appendChatMessage('user', '旧消息')
  const guard = createPageGuard()
  const gate = deferred()
  const { browser } = stubSessionsBrowser({ onSwitch: () => gate.promise })

  const pending = handleSwitchChatRequest(store, browser, guard, { conversationId: VALID_ID })
  await tick()
  assert.equal(guard.inProgress(), true)

  let sendCalls = 0
  const blocked = await handleChatMessage(
    store,
    async () => {
      sendCalls += 1
      return { content: '不该发出去', format: 'text' }
    },
    '抢跑',
    guard,
  )

  assert.equal(blocked.status, 409)
  assert.equal(blocked.body.error, 'page operation in progress')
  assert.equal(sendCalls, 0)

  gate.resolve()
  assert.equal((await pending).status, 200)
  assert.equal(guard.inProgress(), false)
})

test('M-C: switch 进行中 → newChat 被 409 拒绝，页面零点击', async () => {
  const store = createCompanionStateStore()
  const guard = createPageGuard()
  const gate = deferred()
  const { browser } = stubSessionsBrowser({ onSwitch: () => gate.promise })
  const { browser: newChatBrowser, state } = stubNewChatBrowser()

  const pending = handleSwitchChatRequest(store, browser, guard, { conversationId: VALID_ID })
  await tick()

  const blocked = await handleNewChatRequest(store, newChatBrowser, guard)
  assert.equal(blocked.status, 409)
  assert.equal(blocked.body.error, 'page operation in progress')
  assert.equal(state.calls, 0)

  gate.resolve()
  assert.equal((await pending).status, 200)
})

test('M-D: 两个界面同时 switch → 只有一个执行，另一个 409', async () => {
  const store = createCompanionStateStore()
  store.appendChatMessage('user', '旧消息')
  const guard = createPageGuard()
  const gate = deferred()
  const { browser, state } = stubSessionsBrowser({ onSwitch: () => gate.promise })

  const winner = handleSwitchChatRequest(store, browser, guard, { conversationId: VALID_ID })
  const loser = await handleSwitchChatRequest(store, browser, guard, { conversationId: VALID_ID })

  assert.equal(loser.status, 409)
  assert.equal(loser.body.error, 'page operation in progress')
  assert.equal(state.switches, 1)

  gate.resolve()
  assert.equal((await winner).status, 200)
  assert.equal(state.switches, 1, '整轮只点击一次')
  assert.equal(store.getState().chat.messages[0]!.content, '历史问题')
})

test('M-E: switch 失败 → guard 释放、Host transcript 不变、可重试', async () => {
  const store = createCompanionStateStore()
  store.appendChatMessage('user', '旧消息')
  const guard = createPageGuard()
  let fail = true
  const { browser, state } = stubSessionsBrowser({
    onSwitch: async () => {
      if (fail) throw new Error('chat switch did not complete')
    },
  })

  const first = await handleSwitchChatRequest(store, browser, guard, { conversationId: VALID_ID })
  assert.equal(first.status, 500)
  assert.equal(first.body.error, 'chat switch did not complete')
  assert.equal(guard.inProgress(), false, 'finally 必须释放')
  assert.equal(store.getState().chat.messages.length, 1, '失败绝不清空')

  fail = false
  const second = await handleSwitchChatRequest(store, browser, guard, { conversationId: VALID_ID })
  assert.equal(second.status, 200)
  assert.equal(second.body.messages, 2)
  assert.equal(state.switches, 2)
  assert.equal(store.getState().chat.messages[1]!.content, '历史回答')
})

test('M-F: switch 成功后 guard 释放 → 下一条发送正常', async () => {
  const store = createCompanionStateStore()
  const guard = createPageGuard()
  const { browser } = stubSessionsBrowser()

  assert.equal((await handleSwitchChatRequest(store, browser, guard, { conversationId: VALID_ID })).status, 200)
  assert.equal(guard.inProgress(), false)

  const result = await handleChatMessage(store, send, '新会话里的一条消息', guard)
  assert.equal(result.status, 200)
  assert.equal(store.getState().chat.messages.length, 4)
})

// --- N. virtual list scrolling -------------------------------------------------

/** A fake scroll container: only the outer one can actually scroll. */
function scroller(init: { scrollHeight: number; clientHeight: number; className?: string }): FakeEl & {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  className: string
} {
  const el = new FakeEl() as FakeEl & {
    scrollTop: number
    scrollHeight: number
    clientHeight: number
    className: string
  }
  el.scrollTop = 0
  el.scrollHeight = init.scrollHeight
  el.clientHeight = init.clientHeight
  el.className = init.className ?? 'ds-scroll-area'
  return el
}

/** A message whose ancestor chain holds the given scrollers (inner → outer). */
function messageWithScrollers(message: FakeEl, chain: Array<FakeEl & { scrollTop: number }>): FakeEl {
  let current: FakeEl | undefined = message
  for (const parent of chain) {
    ;(current as unknown as { parentElement?: unknown }).parentElement = parent
    current = parent
  }
  return message
}

const SCROLL_OPTIONS = { messageSelector: '.ds-message' }

test('N: 只有真正可滚动的祖先会被滚动（内层容器 scrollHeight === clientHeight 时跳过）', () => {
  const inner = scroller({ scrollHeight: 1831, clientHeight: 1829 })
  const outer = scroller({ scrollHeight: 3545, clientHeight: 840, className: 'ds-virtual-list ds-scroll-area' })
  const message = messageWithScrollers(new FakeEl(), [inner, outer])

  scrollMessagesInPage({ options: SCROLL_OPTIONS, position: 'top', env: sessionsEnv({ messages: [message] }) })

  assert.equal(inner.scrollTop, 0, '不可滚动的内层不得被当成滚动目标')
  assert.equal(outer.scrollTop, 0)
})

test('N: 滚到底部 = scrollHeight；没有可滚动祖先时静默无操作', () => {
  const inner = scroller({ scrollHeight: 1831, clientHeight: 1829 })
  const outer = scroller({ scrollHeight: 3545, clientHeight: 840 })
  const message = messageWithScrollers(new FakeEl(), [inner, outer])

  scrollMessagesInPage({ options: SCROLL_OPTIONS, position: 'bottom', env: sessionsEnv({ messages: [message] }) })
  assert.equal(outer.scrollTop, 3545)

  assert.doesNotThrow(() =>
    scrollMessagesInPage({ options: SCROLL_OPTIONS, position: 'top', env: sessionsEnv({ messages: [new FakeEl()] }) }),
  )
})

// --- P. page helpers must survive serialization --------------------------------

/**
 * Run a page helper the way Playwright does: only its SOURCE is sent to the
 * page, so module-scope references (constants, helpers) simply do not exist.
 * A helper that closes over module state passes every other test and still
 * fails in the real browser — this is the regression guard for that.
 */
function runIsolated(fn: unknown, payload: unknown): unknown {
  const rebuilt = new Function(`return (${String(fn)})`)() as (arg: unknown) => unknown
  return rebuilt(payload)
}

test('P: 页面函数自包含 —— 去掉模块作用域后仍能执行', () => {
  const links = [link('目标', `/a/chat/s/${VALID_ID}`)]
  const win: Record<string, unknown> = {}
  const switchOptions = { ...SWITCH, conversationId: VALID_ID }
  const message = assistantMessage({ text: '正文', reasoning: '思考' })
  const imageMessage = new FakeEl()
  imageMessage.map.img = [
    new FakeEl({
      tag: 'IMG',
      attrs: {
        src: '/api/file?file_id=file-isolated&state=signed',
        alt: 'isolated.png',
      },
    }),
  ]
  const scrollEnv = sessionsEnv({
    messages: [messageWithScrollers(new FakeEl(), [scroller({ scrollHeight: 3545, clientHeight: 840 })])],
  })
  const cases: Array<[string, unknown, unknown, boolean]> = [
    ['readSessionsInPage', readSessionsInPage, { options: LINKS, env: sessionsEnv({ links }) }, true],
    ['switchChatInPage', switchChatInPage, { options: switchOptions, env: sessionsEnv({ links, window: win }) }, true],
    [
      'switchChatReadyInPage',
      switchChatReadyInPage,
      { options: switchOptions, env: sessionsEnv({ pathname: '/', window: win }) },
      true,
    ],
    [
      'readTranscriptInPage',
      readTranscriptInPage,
      { options: TRANSCRIPT, env: sessionsEnv({ messages: [message] }) },
      true,
    ],
    [
      'readTranscriptInPage with image',
      readTranscriptInPage,
      { options: TRANSCRIPT, env: sessionsEnv({ messages: [imageMessage] }) },
      true,
    ],
    ['scrollMessagesInPage', scrollMessagesInPage, { options: SCROLL_OPTIONS, position: 'top', env: scrollEnv }, false],
  ]

  for (const [name, fn, payload, expectsResult] of cases) {
    let result: unknown
    assert.doesNotThrow(() => {
      result = runIsolated(fn, payload)
    }, `${name} 不得引用模块作用域（Playwright 只发送函数源码）`)
    if (expectsResult) assert.notEqual(result, undefined, `${name} 应返回结果`)
  }

  // The switch helper must have really recorded its base through the inline key.
  assert.ok(Array.isArray(win['__switchBase']))
})

test('M: 失败时绝不先清空 —— 读取失败同样保留 transcript', async () => {
  const store = createCompanionStateStore()
  store.appendChatMessage('user', '旧消息')
  const browser: SessionsCapableBrowser = {
    async listSessions() {
      return []
    },
    async switchChat() {},
    async readTranscript(): Promise<ChatMessageInput[]> {
      throw new Error('transcript read failed')
    },
  }

  const result = await handleSwitchChatRequest(store, browser, createPageGuard(), { conversationId: VALID_ID })

  assert.equal(result.status, 500)
  assert.equal(result.body.error, 'transcript read failed')
  assert.equal(store.getState().chat.messages.length, 1)
})

// --- Q. Phase 08.2: the switch is also a session record -----------------------

test('08.2 Q: switch 成功 → currentSession 记录目标 id，消息带上 sessionId', async () => {
  const store = createCompanionStateStore()
  const { browser } = stubSessionsBrowser({ sessions: [{ id: VALID_ID, title: '会话甲', active: true }] })

  const result = await handleSwitchChatRequest(store, browser, createPageGuard(), { conversationId: VALID_ID })

  assert.equal(result.status, 200)
  assert.deepEqual(store.getState().currentSession, { id: VALID_ID, title: null })
  const messages = store.getState().chat.messages
  assert.equal(messages.length, 2)
  assert.equal(messages[0]!.sessionId, VALID_ID)
  assert.equal(messages[1]!.sessionId, VALID_ID)
})

test('08.2 Q: switch 失败 → currentSession 保持原样（不谎报已切换）', async () => {
  const store = createCompanionStateStore()
  store.setCurrentSession({ id: 'keep-me', title: '原会话' })
  const browser: SessionsCapableBrowser = {
    async listSessions() {
      return []
    },
    async switchChat() {
      throw new Error('switch failed')
    },
    async readTranscript() {
      return TRANSCRIPT_FIXTURE
    },
  }

  const result = await handleSwitchChatRequest(store, browser, createPageGuard(), { conversationId: VALID_ID })

  assert.equal(result.status, 500)
  assert.deepEqual(store.getState().currentSession, { id: 'keep-me', title: '原会话' })
  assert.equal(store.getState().chat.messages.length, 0)
})

test('08.2 Q: 列表读取顺带刷新 currentSession（把侧栏标题带进 Host）', async () => {
  const store = createCompanionStateStore()
  const { browser } = stubSessionsBrowser({
    sessions: [
      { id: VALID_ID, title: '会话甲', active: true },
      { id: 'other-id', title: '会话乙', active: false },
    ],
  })

  await handleListSessionsRequest(browser, store)

  assert.deepEqual(store.getState().currentSession, { id: VALID_ID, title: '会话甲' })
})

test('08.2 Q: 列表里没有 active 条目（页面停在 /）→ 不擦掉已知会话', async () => {
  const store = createCompanionStateStore()
  store.setCurrentSession({ id: VALID_ID, title: '会话甲' })
  const { browser } = stubSessionsBrowser({ sessions: [{ id: 'other-id', title: '会话乙', active: false }] })

  await handleListSessionsRequest(browser, store)

  assert.deepEqual(store.getState().currentSession, { id: VALID_ID, title: '会话甲' })
})

test('08.2 Q: 不传 store 的列表读取保持原行为（向后兼容）', async () => {
  const store = createCompanionStateStore()
  const { browser } = stubSessionsBrowser({ sessions: [{ id: VALID_ID, title: '会话甲', active: true }] })

  const result = await handleListSessionsRequest(browser)

  assert.equal(result.status, 200)
  assert.deepEqual(store.getState().currentSession, { id: null, title: null }, '没传 store 就不动 Host 状态')
})
