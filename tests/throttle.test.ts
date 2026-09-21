import assert from 'node:assert/strict'
import test from 'node:test'

import { createThrottle } from '../src/host/throttle.ts'

const sameString = (a: string, b: string): boolean => a === b

test('throttle 高频 push 在 interval 内只 emit 一次最新值', async () => {
  const emitted: string[] = []
  const throttle = createThrottle<string>((value) => emitted.push(value), 10, sameString)
  throttle.push('a')
  throttle.push('ab')
  throttle.push('abc')
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.deepEqual(emitted, ['abc'])
  throttle.dispose()
})

test('throttle flush 立即发出最后文本（不丢内容）', () => {
  const emitted: string[] = []
  const throttle = createThrottle<string>((value) => emitted.push(value), 10000, sameString)
  throttle.push('部分')
  throttle.push('完整回复')
  throttle.flush()
  assert.deepEqual(emitted, ['完整回复'])
  throttle.dispose()
})

test('throttle flush 无新内容时不重复 emit', () => {
  const emitted: string[] = []
  const throttle = createThrottle<string>((value) => emitted.push(value), 10000, sameString)
  throttle.push('内容')
  throttle.flush()
  throttle.flush()
  assert.deepEqual(emitted, ['内容'])
  throttle.dispose()
})

test('throttle 支持对象值：按 isEqual 去重，format 变化会 emit', async () => {
  interface Value {
    content: string
    format: string
  }
  const emitted: Value[] = []
  const throttle = createThrottle<Value>(
    (value) => emitted.push(value),
    10,
    (a, b) => a.content === b.content && a.format === b.format,
  )
  throttle.push({ content: 'Go', format: 'text' })
  // Same text but the format flipped — not a duplicate, must be emitted.
  throttle.push({ content: 'Go', format: 'markdown' })
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(emitted.length, 1)
  assert.deepEqual(emitted[0], { content: 'Go', format: 'markdown' })
  throttle.dispose()
})
