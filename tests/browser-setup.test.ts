import assert from 'node:assert/strict'
import test from 'node:test'
import { browserSetupHint } from '../src/client/browser-setup.ts'

test('浏览器启动失败时提供当前 profile 的 Chromium 安装与重启步骤', () => {
  const hint = browserSetupHint({ status: 'offline', browserReady: false })
  assert.ok(hint)
  assert.match(hint, /Chromium/)
  assert.match(hint, /dsh plugin --profile <profile> exec playwright install chromium/)
  assert.match(hint, /重启 DSH/)
  assert.match(hint, /已安装.*日志/)
})

test('浏览器已经存在的连接故障不要求用户重新安装', () => {
  assert.equal(browserSetupHint({ status: 'offline', browserReady: true }), null)
})

test('登录、在线和恢复状态不显示安装提示', () => {
  for (const status of ['online', 'login_required', 'recovering'] as const) {
    for (const browserReady of [true, false]) assert.equal(browserSetupHint({ status, browserReady }), null)
  }
})
