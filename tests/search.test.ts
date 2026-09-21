import assert from 'node:assert/strict'
import test from 'node:test'

import { handleChatMessage } from '../src/host/chat.ts'
import { handleSearchRequest, type SearchController } from '../src/host/search.ts'
import { createCompanionStateStore } from '../src/host/state.ts'
import {
  composerToggleInPage,
  needsToggleClick,
  normalizeToggleState,
  TOGGLE_TARGET_KEY,
  type ComposerToggleOptions,
} from '../src/host/toggle.ts'
import type { ReplyEnv } from '../src/host/reply.ts'
import type { SearchState } from '../src/shared/state.ts'

/** The options browser.ts actually uses (mirrors SEARCH_OPTIONS). */
const SEARCH: ComposerToggleOptions = {
  toggleSelector: '.ds-toggle-button',
  selectedClass: 'ds-toggle-button--selected',
  labels: ['智能搜索', 'search'],
  exclusions: ['深度思考', 'deepthink'],
}

/** A DeepSeek-like composer toggle. */
function fakeToggle(label: string, enabled: boolean, onClick?: () => void): Record<string, unknown> {
  return {
    textContent: label,
    className: enabled ? 'ds-toggle-button ds-toggle-button--selected' : 'ds-toggle-button',
    getAttribute: (name: string) => (name === 'aria-pressed' ? String(enabled) : null),
    click: onClick ?? (() => {}),
  }
}

function fakeEnv(toggles: unknown[]): ReplyEnv {
  return {
    document: {
      body: {},
      querySelectorAll: (selector: string) => (selector === SEARCH.toggleSelector ? toggles : []),
    },
    window: {},
    MutationObserver: class {
      observe(): void {}
      disconnect(): void {}
    } as unknown as ReplyEnv['MutationObserver'],
  }
}

// --- A. state parsing -------------------------------------------------------

test('A: aria-pressed=true → enabled=true；false → enabled=false', () => {
  const on = fakeEnv([fakeToggle('智能搜索', true), fakeToggle('深度思考', false)])
  const off = fakeEnv([fakeToggle('智能搜索', false), fakeToggle('深度思考', true)])
  assert.deepEqual(composerToggleInPage({ options: SEARCH, action: 'read', env: on }), {
    available: true,
    enabled: true,
  })
  assert.deepEqual(composerToggleInPage({ options: SEARCH, action: 'read', env: off }), {
    available: true,
    enabled: false,
  })
})

test('A: 没有 aria-pressed 时退回 selected class 判断', () => {
  const env = fakeEnv([{ textContent: '智能搜索', className: 'ds-toggle-button ds-toggle-button--selected' }])
  assert.deepEqual(composerToggleInPage({ options: SEARCH, action: 'read', env }), {
    available: true,
    enabled: true,
  })
})

test('A: normalizeToggleState 归一化任意来源的值', () => {
  assert.deepEqual(normalizeToggleState({ available: true, enabled: true }), { available: true, enabled: true })
  // enabled=true 但没有控件 → available=false 且 enabled 归零
  assert.deepEqual(normalizeToggleState({ available: false, enabled: true }), { available: false, enabled: false })
  assert.deepEqual(normalizeToggleState(null), { available: false, enabled: false })
  assert.deepEqual(normalizeToggleState('nonsense'), { available: false, enabled: false })
})

// --- B. availability --------------------------------------------------------

test('B: 唯一识别 Search → available=true；只有 Deep Think → false', () => {
  assert.equal(
    composerToggleInPage({
      options: SEARCH,
      action: 'read',
      env: fakeEnv([fakeToggle('智能搜索', false), fakeToggle('深度思考', false)]),
    }).available,
    true,
  )
  assert.deepEqual(
    composerToggleInPage({ options: SEARCH, action: 'read', env: fakeEnv([fakeToggle('深度思考', true)]) }),
    { available: false, enabled: false },
  )
})

test('B: 标签命中多个（歧义）→ available=false', () => {
  const env = fakeEnv([fakeToggle('智能搜索', false), fakeToggle('智能搜索（新）', true)])
  assert.deepEqual(composerToggleInPage({ options: SEARCH, action: 'read', env }), {
    available: false,
    enabled: false,
  })
})

test('B: 无标签匹配但 Deep Think 可识别且只剩唯一候选 → 兜底', () => {
  const env = fakeEnv([fakeToggle('某个未知开关', false), fakeToggle('深度思考', true)])
  assert.deepEqual(composerToggleInPage({ options: SEARCH, action: 'read', env }), {
    available: true,
    enabled: false,
  })
})

test('B: 缺少浏览器环境时安全 no-op', () => {
  assert.deepEqual(composerToggleInPage({ options: SEARCH, action: 'read', env: {} as ReplyEnv }), {
    available: false,
    enabled: false,
  })
})

// --- C. a third, unknown toggle --------------------------------------------

test('C: 标签唯一命中时，第三个未知 toggle 不会被误点', () => {
  let searchClicks = 0
  let unknownClicks = 0
  const env = fakeEnv([
    fakeToggle('未知开关', false, () => {
      unknownClicks += 1
    }),
    fakeToggle('智能搜索', true, () => {
      searchClicks += 1
    }),
    fakeToggle('另一个未知开关', false, () => {
      unknownClicks += 1
    }),
  ])

  const result = composerToggleInPage({ options: SEARCH, action: 'click', env })

  assert.equal(unknownClicks, 0)
  assert.equal(searchClicks, 1)
  assert.deepEqual(result, { available: true, enabled: true })
})

test('C: 标签无法命中且第三个未知 toggle 出现 → available=false 且零点击', () => {
  let clicks = 0
  const env = fakeEnv([
    fakeToggle('搜索模式', false, () => {
      clicks += 1
    }),
    fakeToggle('深度思考', false, () => {
      clicks += 1
    }),
    fakeToggle('实验功能', true, () => {
      clicks += 1
    }),
  ])

  const result = composerToggleInPage({ options: SEARCH, action: 'click', env })

  assert.equal(clicks, 0)
  assert.deepEqual(result, { available: false, enabled: false })
})

test('C: 歧义时不写页面全局（Host 不会对未知元素做条件等待）', () => {
  const env = fakeEnv([fakeToggle('搜索模式', false), fakeToggle('实验功能', true)])
  composerToggleInPage({ options: SEARCH, action: 'click', env })
  assert.equal(TOGGLE_TARGET_KEY in env.window, false)
})

// --- D. set flow ------------------------------------------------------------

test('D: needsToggleClick —— 已是目标状态或控件不可用都不点击', () => {
  assert.equal(needsToggleClick({ available: true, enabled: true }, true), false)
  assert.equal(needsToggleClick({ available: true, enabled: false }, false), false)
  assert.equal(needsToggleClick({ available: false, enabled: false }, true), false)
  assert.equal(needsToggleClick({ available: true, enabled: false }, true), true)
  assert.equal(needsToggleClick({ available: true, enabled: true }, false), true)
})

test('D: 状态不同 → 点击一次并返回点击时的读数', () => {
  let clicks = 0
  const env = fakeEnv([
    fakeToggle('智能搜索', false, () => {
      clicks += 1
    }),
    fakeToggle('深度思考', false),
  ])

  const result = composerToggleInPage({ options: SEARCH, action: 'click', env })

  assert.equal(clicks, 1)
  assert.deepEqual(result, { available: true, enabled: false })
})

test('D: click 把被点击元素写到页面全局，供 Host 条件等待（定位规则不重复）', () => {
  const target = fakeToggle('智能搜索', false)
  const env = fakeEnv([fakeToggle('深度思考', false), target])

  composerToggleInPage({ options: SEARCH, action: 'click', env })

  assert.equal(env.window[TOGGLE_TARGET_KEY], target)
})

test('D: read 动作是纯读 —— 不点击、不写页面全局', () => {
  let clicks = 0
  const env = fakeEnv([
    fakeToggle('智能搜索', true, () => {
      clicks += 1
    }),
  ])

  composerToggleInPage({ options: SEARCH, action: 'read', env })

  assert.equal(clicks, 0)
  assert.equal(TOGGLE_TARGET_KEY in env.window, false)
})

// --- E. Host request flow ---------------------------------------------------

/** A tiny stub browser (deliberately not a mock framework). */
function makeController(initial: SearchState): { controller: SearchController; calls: string[] } {
  const calls: string[] = []
  let current = initial
  return {
    calls,
    controller: {
      async getSearchState() {
        calls.push('get')
        return current
      },
      async setSearchEnabled(enabled: boolean) {
        calls.push(`set:${enabled}`)
        current = current.available ? { available: true, enabled } : { available: false, enabled: false }
        return current
      },
    },
  }
}

test('E: enabled 不是 boolean → 400，且完全不触碰浏览器', async () => {
  const store = createCompanionStateStore()
  const { controller, calls } = makeController({ available: true, enabled: false })

  const result = await handleSearchRequest(store, controller, { enabled: 'yes' })

  assert.equal(result.status, 400)
  assert.equal(result.body.error, 'enabled must be a boolean')
  assert.deepEqual(calls, [])
})

test('E: 请求体缺失或非法 JSON → 400', async () => {
  const store = createCompanionStateStore()
  const { controller } = makeController({ available: true, enabled: false })
  assert.equal((await handleSearchRequest(store, controller, null)).status, 400)
  assert.equal((await handleSearchRequest(store, controller, {})).status, 400)
})

test('E: browser 未就绪 → 503', async () => {
  const store = createCompanionStateStore()
  const result = await handleSearchRequest(store, null, { enabled: true })
  assert.equal(result.status, 503)
  assert.equal(result.body.error, 'browser not ready')
})

test('E: 生成过程中 → 409，不切换（且返回镜像的当前状态）', async () => {
  const store = createCompanionStateStore()
  store.setSearchState({ available: true, enabled: false })
  store.setChatSending(true)
  const { controller, calls } = makeController({ available: true, enabled: false })

  const result = await handleSearchRequest(store, controller, { enabled: true })

  assert.equal(result.status, 409)
  assert.deepEqual(calls, [])
  assert.deepEqual(result.body, { available: true, enabled: false, error: 'chat is busy' })
})

test('E: 切换成功 → 200 且返回页面真实状态', async () => {
  const store = createCompanionStateStore()
  const { controller, calls } = makeController({ available: true, enabled: false })

  const result = await handleSearchRequest(store, controller, { enabled: true })

  assert.equal(result.status, 200)
  assert.deepEqual(result.body, { available: true, enabled: true })
  assert.deepEqual(calls, ['set:true'])
})

test('E: 控件不存在 → 200 且 available=false（不是错误）', async () => {
  const store = createCompanionStateStore()
  const { controller } = makeController({ available: false, enabled: false })

  const result = await handleSearchRequest(store, controller, { enabled: true })

  assert.equal(result.status, 200)
  assert.deepEqual(result.body, { available: false, enabled: false })
})

test('E: 页面操作失败 → 500 但仍写入页面真实状态（不做 optimistic 保留）', async () => {
  const store = createCompanionStateStore()
  const controller: SearchController = {
    async getSearchState() {
      return { available: true, enabled: false }
    },
    async setSearchEnabled() {
      throw new Error('boom')
    },
  }

  const result = await handleSearchRequest(store, controller, { enabled: true })

  assert.equal(result.status, 500)
  assert.equal(result.body.error, 'failed to set Search')
  assert.deepEqual(store.getState().deepseek.search, { available: true, enabled: false })
})

// --- F. Host state ----------------------------------------------------------

test('F: setSearchState 只在真正变化时 notify', () => {
  const store = createCompanionStateStore()
  let notifies = 0
  store.subscribe(() => {
    notifies += 1
  })
  notifies = 0 // ignore the subscribe replay

  store.setSearchState({ available: false, enabled: false }) // identical → nothing
  assert.equal(notifies, 0)

  store.setSearchState({ available: true, enabled: false }) // availability changed
  assert.equal(notifies, 1)

  store.setSearchState({ available: true, enabled: false }) // duplicate
  assert.equal(notifies, 1)

  store.setSearchState({ available: true, enabled: true }) // enabled changed
  assert.equal(notifies, 2)
})

test('F: 初始 state 同时带有 deepThink 与 search（都为不可用）', () => {
  const store = createCompanionStateStore()
  assert.deepEqual(store.getState().deepseek.deepThink, { available: false, enabled: false })
  assert.deepEqual(store.getState().deepseek.search, { available: false, enabled: false })
})

// --- G. page-side linkage ---------------------------------------------------

test('G: 页面联动时两个状态都被镜像为真实值（不会只更新 Search）', async () => {
  const store = createCompanionStateStore()
  store.setDeepThinkState({ available: true, enabled: true })

  const controller: SearchController = {
    async getSearchState() {
      return { available: true, enabled: false }
    },
    async setSearchEnabled(enabled) {
      // Mirrors browser.setSearchEnabled(): the Host re-reads BOTH switches, so
      // a page-side link (here: Deep Think forcing itself off) lands too.
      store.setDeepThinkState({ available: true, enabled: false })
      return { available: true, enabled }
    },
  }

  const result = await handleSearchRequest(store, controller, { enabled: true })

  assert.equal(result.status, 200)
  assert.deepEqual(store.getState().deepseek.search, { available: true, enabled: true })
  assert.deepEqual(store.getState().deepseek.deepThink, { available: true, enabled: false })
})

test('G: handleSearchRequest 自身不覆盖 Deep Think（成对镜像由 browser 层完成）', async () => {
  const store = createCompanionStateStore()
  store.setDeepThinkState({ available: true, enabled: true })
  const { controller } = makeController({ available: true, enabled: false })

  await handleSearchRequest(store, controller, { enabled: true })

  assert.deepEqual(store.getState().deepseek.deepThink, { available: true, enabled: true })
  assert.deepEqual(store.getState().deepseek.search, { available: true, enabled: true })
})

// --- H. plain chat stays unaffected -----------------------------------------

test('H: Search 不可用 / 关闭时普通聊天（含 Markdown 正文）完全不受影响', async () => {
  const store = createCompanionStateStore()

  const result = await handleChatMessage(
    store,
    async (_message, onDelta) => {
      onDelta({ content: '# 正文', format: 'markdown' })
      return { content: '# 正文', format: 'markdown' }
    },
    'hi',
  )

  assert.equal(result.status, 200)
  const message = store.getState().chat.messages[1]!
  assert.equal(message.content, '# 正文')
  assert.equal(message.format, 'markdown')
  assert.equal(message.reasoning, undefined)
  assert.equal(store.getState().chat.sending, false)
  assert.deepEqual(store.getState().deepseek.search, { available: false, enabled: false })
})

test('H: page 重建后 Search 写入新页面的真实状态，不沿用旧 page 的 enabled', () => {
  const store = createCompanionStateStore()

  store.setSearchState({ available: true, enabled: true })
  assert.deepEqual(store.getState().deepseek.search, { available: true, enabled: true })

  // New page (e.g. the sign-in route) has no composer → sync writes the truth.
  store.setSearchState({ available: false, enabled: false })
  assert.deepEqual(store.getState().deepseek.search, { available: false, enabled: false })

  store.setSearchState({ available: true, enabled: false })
  assert.deepEqual(store.getState().deepseek.search, { available: true, enabled: false })
})
