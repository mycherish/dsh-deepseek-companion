import assert from 'node:assert/strict'
import test from 'node:test'

import { createThrottle } from '../src/host/throttle.ts'

test('throttle 高频 push 在 interval 内只 emit 一次最新值', async () => {
  const emitted: string[] = []
  const throttle = createThrottle((value) => emitted.push(value), 10)
  throttle.push('a')
  throttle.push('ab')
  throttle.push('abc')
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.deepEqual(emitted, ['abc'])
  throttle.dispose()
})

test('throttle flush 立即发出最后文本（不丢内容）', () => {
  const emitted: string[] = []
  const throttle = createThrottle((value) => emitted.push(value), 10000)
  throttle.push('部分')
  throttle.push('完整回复')
  throttle.flush()
  assert.deepEqual(emitted, ['完整回复'])
  throttle.dispose()
})

test('throttle flush 无新内容时不重复 emit', () => {
  const emitted: string[] = []
  const throttle = createThrottle((value) => emitted.push(value), 10000)
  throttle.push('内容')
  throttle.flush()
  throttle.flush()
  assert.deepEqual(emitted, ['内容'])
  throttle.dispose()
})
