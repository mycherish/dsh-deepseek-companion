import assert from 'node:assert/strict'
import test from 'node:test'

import { apply, name } from '../src/index.ts'

test('exports the stable plugin id', () => {
  assert.equal(name, 'deepseek-companion')
})

test('exports a callable apply function', () => {
  assert.equal(typeof apply, 'function')
})
