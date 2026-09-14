import test from 'node:test'
import assert from 'node:assert/strict'

import { Context } from '@deepseek-ai/cordis'

/**
 * 生命周期验证（Phase 06B 审核补充）。
 *
 * 源码结论（@deepseek-ai/dsh-client-connection@0.1.2-rc.1）：
 * - `ctx.connection.fetch.register(route)` 返回 disposer。
 * - 其内部用 `owner.effect(...)` 绑定生命周期，而 `owner = HostConnectionService.ctx`
 *   （client-connection 插件的 ctx），**不是**调用者插件的 ctx。
 * - 因此 register 返回的 disposer 不会随我们插件 dispose 自动执行，必须用
 *   `ctx.effect(() => register(...))` 包裹，把返回的 disposer 作为外层 effect 的 cleanup。
 */

/** 模拟 `connection.fetch.register`：注册返回 disposer，且不绑定调用者生命周期。 */
function fakeRegister() {
  let active = false
  return {
    register() {
      active = true
      return () => {
        active = false
      }
    },
    isActive: () => active,
  }
}

test('ctx.effect(() => register(...)) 的 disposer 在调用时注销 route', () => {
  const { register, isActive } = fakeRegister()
  const ctx = new Context()

  // 复刻 src/index.ts 的 apply 生命周期模式
  const dispose = ctx.effect(() => register(), 'deepseek-companion: companion state route')

  assert.equal(isActive(), true, 'register 后 route 应处于激活状态')
  dispose() // 等价于插件 dispose 时 Cordis 调用 effect 返回的 disposer
  assert.equal(isActive(), false, '调用 effect disposer 后 route 应被注销')
})

test('register 返回的 disposer 是注销 route 的唯一途径', () => {
  const { register, isActive } = fakeRegister()

  // 若像错误写法那样丢弃 disposer，route 将无法注销（证明必须 ctx.effect 包裹）
  const disposer = register()
  assert.equal(isActive(), true)

  disposer()
  assert.equal(isActive(), false, 'register 返回的 disposer 调用后 route 应被注销')
})
