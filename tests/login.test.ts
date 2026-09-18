import assert from 'node:assert/strict'
import test from 'node:test'

import { loginStatusFromCurrentUser } from '../src/host/login.ts'

test('已登录信号（code 0 + id）→ logged_in', () => {
  assert.equal(
    loginStatusFromCurrentUser({ code: 0, id: '08158f80-c63f-429b-a77e-d7055d5f9e4d' }),
    'logged_in',
  )
})

test('未登录信号（code 40002 Missing Token，无 id）→ logged_out', () => {
  assert.equal(loginStatusFromCurrentUser({ code: 40002, id: null }), 'logged_out')
})

test('任意非 0 code 且无用户 id → logged_out', () => {
  assert.equal(loginStatusFromCurrentUser({ code: 401, id: null }), 'logged_out')
})

test('非对象（null）→ error', () => {
  assert.equal(loginStatusFromCurrentUser(null), 'error')
})

test('非对象（字符串）→ error', () => {
  assert.equal(loginStatusFromCurrentUser('not json'), 'error')
})

test('code 为 0 但缺少 id → error', () => {
  assert.equal(loginStatusFromCurrentUser({ code: 0, id: null }), 'error')
})

test('id 存在但 code 异常（仍以 id 为准）→ logged_in', () => {
  assert.equal(loginStatusFromCurrentUser({ code: 500, id: 'abc-123' }), 'logged_in')
})
