import assert from 'node:assert/strict'
import test from 'node:test'

import { createCompanionStateStore } from '../src/host/state.ts'

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
