import assert from 'node:assert/strict'
import test from 'node:test'

import { handleChatMessage } from '../src/host/chat.ts'
import {
  deepThinkInPage,
  handleDeepThinkRequest,
  needsDeepThinkClick,
  type DeepThinkController,
  type DeepThinkOptions,
} from '../src/host/deep-think.ts'
import { createCompanionStateStore } from '../src/host/state.ts'
import type { ReplyEnv } from '../src/host/reply.ts'
import type { DeepThinkState } from '../src/shared/state.ts'

/** The options browser.ts actually uses (mirrors DEEP_THINK_OPTIONS). */
const OPTIONS: DeepThinkOptions = {
  toggleSelector: '.ds-toggle-button',
  selectedClass: 'ds-toggle-button--selected',
  labels: ['深度思考', 'deepthink'],
  exclusions: ['智能搜索', 'search'],
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
      querySelectorAll: (selector: string) => (selector === OPTIONS.toggleSelector ? toggles : []),
    },
    window: {},
    MutationObserver: class {
      observe(): void {}
      disconnect(): void {}
    } as unknown as ReplyEnv['MutationObserver'],
  }
}

test('A: 开启的 DOM（aria-pressed=true）→ enabled=true', () => {
  const env = fakeEnv([fakeToggle('深度思考', true), fakeToggle('智能搜索', false)])
  assert.deepEqual(deepThinkInPage({ options: OPTIONS, action: 'read', env }), {
    available: true,
    enabled: true,
  })
})

test('A: 关闭的 DOM（aria-pressed=false）→ enabled=false', () => {
  const env = fakeEnv([fakeToggle('深度思考', false), fakeToggle('智能搜索', true)])
  assert.deepEqual(deepThinkInPage({ options: OPTIONS, action: 'read', env }), {
    available: true,
    enabled: false,
  })
})

test('A: 没有 aria-pressed 时退回 selected class 判断', () => {
  const env = fakeEnv([{ textContent: '深度思考', className: 'ds-toggle-button ds-toggle-button--selected' }])
  assert.deepEqual(deepThinkInPage({ options: OPTIONS, action: 'read', env }), {
    available: true,
    enabled: true,
  })
})

test('B: 控件存在 → available=true；不存在 → available=false', () => {
  assert.equal(deepThinkInPage({ options: OPTIONS, action: 'read', env: fakeEnv([]) }).available, false)
  assert.equal(
    deepThinkInPage({ options: OPTIONS, action: 'read', env: fakeEnv([fakeToggle('深度思考', false)]) }).available,
    true,
  )
})

test('B: 只有 Search 时不会误选成 Deep Think', () => {
  const env = fakeEnv([fakeToggle('智能搜索', true)])
  assert.deepEqual(deepThinkInPage({ options: OPTIONS, action: 'read', env }), {
    available: false,
    enabled: false,
  })
})

test('B: 无标签匹配，但 Search 可识别且只剩唯一候选 → 才允许兜底', () => {
  const env = fakeEnv([fakeToggle('某个未知开关', false), fakeToggle('智能搜索', true)])
  assert.deepEqual(deepThinkInPage({ options: OPTIONS, action: 'read', env }), {
    available: true,
    enabled: false,
  })
})

test('B: 排除 Search 后仍有多个候选 → available=false（绝不误点）', () => {
  const env = fakeEnv([
    fakeToggle('某个未知开关', false),
    fakeToggle('智能搜索', true),
    fakeToggle('另一个新开关', true),
  ])
  assert.deepEqual(deepThinkInPage({ options: OPTIONS, action: 'read', env }), {
    available: false,
    enabled: false,
  })
})

test('B: 无法识别 Search 且无标签匹配 → available=false', () => {
  const env = fakeEnv([fakeToggle('开关甲', false), fakeToggle('开关乙', true)])
  assert.deepEqual(deepThinkInPage({ options: OPTIONS, action: 'read', env }), {
    available: false,
    enabled: false,
  })
})

test('B: 标签命中多个（歧义）→ available=false', () => {
  const env = fakeEnv([fakeToggle('深度思考', false), fakeToggle('深度思考（新）', true)])
  assert.deepEqual(deepThinkInPage({ options: OPTIONS, action: 'read', env }), {
    available: false,
    enabled: false,
  })
})

test('B: 标签唯一命中时忽略其他未知 toggle', () => {
  const env = fakeEnv([fakeToggle('某个未知开关', false), fakeToggle('深度思考', true), fakeToggle('智能搜索', false)])
  assert.deepEqual(deepThinkInPage({ options: OPTIONS, action: 'read', env }), {
    available: true,
    enabled: true,
  })
})

test('B: 歧义时 click 动作也不点击任何 toggle', () => {
  let clicks = 0
  const env = fakeEnv([
    fakeToggle('开关甲', true, () => {
      clicks += 1
    }),
    fakeToggle('开关乙', true, () => {
      clicks += 1
    }),
  ])
  const result = deepThinkInPage({ options: OPTIONS, action: 'click', env })
  assert.equal(clicks, 0)
  assert.deepEqual(result, { available: false, enabled: false })
})

test('B: 缺少浏览器环境时安全 no-op', () => {
  assert.deepEqual(deepThinkInPage({ options: OPTIONS, action: 'read', env: {} as ReplyEnv }), {
    available: false,
    enabled: false,
  })
})

test('C: action=click 点击一次并返回点击时的读数', () => {
  let clicks = 0
  const env = fakeEnv([
    fakeToggle('深度思考', false, () => {
      clicks += 1
    }),
  ])

  const result = deepThinkInPage({ options: OPTIONS, action: 'click', env })

  assert.equal(clicks, 1)
  assert.deepEqual(result, { available: true, enabled: false })
})

test('C: action=read 永不点击', () => {
  let clicks = 0
  const env = fakeEnv([
    fakeToggle('深度思考', false, () => {
      clicks += 1
    }),
  ])
  deepThinkInPage({ options: OPTIONS, action: 'read', env })
  assert.equal(clicks, 0)
})

test('C: needsDeepThinkClick 决策（已是目标状态 / 不可用都不点击）', () => {
  assert.equal(needsDeepThinkClick({ available: true, enabled: true }, true), false)
  assert.equal(needsDeepThinkClick({ available: true, enabled: false }, false), false)
  assert.equal(needsDeepThinkClick({ available: false, enabled: false }, true), false)
  assert.equal(needsDeepThinkClick({ available: true, enabled: false }, true), true)
  assert.equal(needsDeepThinkClick({ available: true, enabled: true }, false), true)
})

/** A tiny stub browser (deliberately not a mock framework). */
function makeController(initial: DeepThinkState): {
  controller: DeepThinkController
  calls: string[]
} {
  const calls: string[] = []
  let current = initial
  return {
    calls,
    controller: {
      async getDeepThinkState() {
        calls.push('get')
        return current
      },
      async setDeepThinkEnabled(enabled: boolean) {
        calls.push(`set:${enabled}`)
        // A missing toggle stays missing — the Host only ever reports the truth.
        current = current.available ? { available: true, enabled } : { available: false, enabled: false }
        return current
      },
    },
  }
}

test('D: enabled 不是 boolean → 400，且完全不触碰浏览器', async () => {
  const store = createCompanionStateStore()
  const { controller, calls } = makeController({ available: true, enabled: false })

  const result = await handleDeepThinkRequest(store, controller, { enabled: 'yes' })

  assert.equal(result.status, 400)
  assert.equal(result.body.error, 'enabled must be a boolean')
  assert.deepEqual(calls, [])
})

test('D: 请求体缺失或非法 JSON → 400', async () => {
  const store = createCompanionStateStore()
  const { controller } = makeController({ available: true, enabled: false })
  assert.equal((await handleDeepThinkRequest(store, controller, null)).status, 400)
  assert.equal((await handleDeepThinkRequest(store, controller, {})).status, 400)
})

test('D: browser 未就绪 → 503', async () => {
  const store = createCompanionStateStore()
  const result = await handleDeepThinkRequest(store, null, { enabled: true })
  assert.equal(result.status, 503)
  assert.equal(result.body.error, 'browser not ready')
})

test('D: 生成过程中 → 409，不切换模式', async () => {
  const store = createCompanionStateStore()
  store.setChatSending(true)
  const { controller, calls } = makeController({ available: true, enabled: false })

  const result = await handleDeepThinkRequest(store, controller, { enabled: true })

  assert.equal(result.status, 409)
  assert.deepEqual(calls, [])
})

test('E: 切换成功后 CompanionState.deepseek.deepThink 更新为真实状态', async () => {
  const store = createCompanionStateStore()
  const { controller } = makeController({ available: true, enabled: false })

  const result = await handleDeepThinkRequest(store, controller, { enabled: true })

  assert.equal(result.status, 200)
  assert.deepEqual(result.body, { available: true, enabled: true })
  assert.deepEqual(store.getState().deepseek.deepThink, { available: true, enabled: true })
})

test('E: 控件不存在 → 200 且 available=false（不是错误）', async () => {
  const store = createCompanionStateStore()
  const { controller } = makeController({ available: false, enabled: false })

  const result = await handleDeepThinkRequest(store, controller, { enabled: true })

  assert.equal(result.status, 200)
  assert.deepEqual(result.body, { available: false, enabled: false })
  assert.deepEqual(store.getState().deepseek.deepThink, { available: false, enabled: false })
})

test('E: 页面操作失败 → 500 但仍写入页面真实状态（不做 optimistic 保留）', async () => {
  const store = createCompanionStateStore()
  const controller: DeepThinkController = {
    async getDeepThinkState() {
      return { available: true, enabled: false }
    },
    async setDeepThinkEnabled() {
      throw new Error('boom')
    },
  }

  const result = await handleDeepThinkRequest(store, controller, { enabled: true })

  assert.equal(result.status, 500)
  assert.equal(result.body.error, 'failed to set Deep Think')
  assert.deepEqual(store.getState().deepseek.deepThink, { available: true, enabled: false })
})

test('E: setDeepThinkState 只在真正变化时 notify', () => {
  const store = createCompanionStateStore()
  let notifies = 0
  store.subscribe(() => {
    notifies += 1
  })
  notifies = 0 // ignore the subscribe replay

  store.setDeepThinkState({ available: false, enabled: false }) // identical → nothing
  assert.equal(notifies, 0)

  store.setDeepThinkState({ available: true, enabled: false }) // availability changed
  assert.equal(notifies, 1)

  store.setDeepThinkState({ available: true, enabled: false }) // duplicate
  assert.equal(notifies, 1)

  store.setDeepThinkState({ available: true, enabled: true }) // enabled changed
  assert.equal(notifies, 2)
})

test('F: Deep Think 不可用时普通聊天（含正文）完全不受影响', async () => {
  const store = createCompanionStateStore()
  assert.deepEqual(store.getState().deepseek.deepThink, { available: false, enabled: false })

  const result = await handleChatMessage(
    store,
    async (_message, onDelta) => {
      onDelta({ content: '正文', format: 'markdown' })
      return { content: '正文', format: 'markdown' }
    },
    'hi',
  )

  assert.equal(result.status, 200)
  const message = store.getState().chat.messages[1]!
  assert.equal(message.content, '正文')
  assert.equal(message.reasoning, undefined)
  assert.equal(store.getState().chat.sending, false)
  assert.deepEqual(store.getState().deepseek.deepThink, { available: false, enabled: false })
})

test('G: page 重建后写入新页面的真实状态，不沿用旧 page 的 enabled', () => {
  const store = createCompanionStateStore()

  // Old page: Deep Think was ON.
  store.setDeepThinkState({ available: true, enabled: true })
  assert.deepEqual(store.getState().deepseek.deepThink, { available: true, enabled: true })

  // New page (e.g. the sign-in route) has no composer → sync writes the truth.
  store.setDeepThinkState({ available: false, enabled: false })
  assert.deepEqual(store.getState().deepseek.deepThink, { available: false, enabled: false })

  // Once the new page exposes the toggle (OFF), that truth wins as well.
  store.setDeepThinkState({ available: true, enabled: false })
  assert.deepEqual(store.getState().deepseek.deepThink, { available: true, enabled: false })
})
