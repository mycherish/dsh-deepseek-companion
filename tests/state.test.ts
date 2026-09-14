import assert from 'node:assert/strict'
import test from 'node:test'

import { createCompanionState } from '../src/host/state.ts'

test('createCompanionState returns ready with initial revision 1', () => {
  const state = createCompanionState()
  assert.equal(state.status, 'ready')
  assert.equal(state.revision, 1)
})

test('instanceId is a non-empty string', () => {
  const state = createCompanionState()
  assert.equal(typeof state.instanceId, 'string')
  assert.ok(state.instanceId.length > 0)
})

test('each call mints a distinct instanceId', () => {
  assert.notEqual(createCompanionState().instanceId, createCompanionState().instanceId)
})
