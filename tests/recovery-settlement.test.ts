import assert from 'node:assert/strict'
import test from 'node:test'

import {
  classifyHistoryResponse,
  matchesRecoveryHistoryRequest,
  recoverySessionVerdict,
  titleForRecoveredSession,
} from '../src/host/recovery-settlement.ts'

test('20B2: only the frontend history request for the exact target id counts', () => {
  const path = 'https://chat.deepseek.com/api/v0/chat/history_messages?chat_session_id=a'
  assert.equal(matchesRecoveryHistoryRequest(path, 'a', 'GET'), true)
  assert.equal(matchesRecoveryHistoryRequest(path, 'b', 'GET'), false)
  assert.equal(matchesRecoveryHistoryRequest(path, 'a', 'POST'), false)
  assert.equal(matchesRecoveryHistoryRequest(`${path}&chat_session_id=b`, 'a', 'GET'), false)
  assert.equal(
    matchesRecoveryHistoryRequest('https://chat.deepseek.com.evil/api/v0/chat/history_messages?chat_session_id=a', 'a', 'GET'),
    false,
  )
  assert.equal(
    matchesRecoveryHistoryRequest('https://chat.deepseek.com/api/v0/chat/history_messages_extra?chat_session_id=a', 'a', 'GET'),
    false,
  )
  assert.equal(matchesRecoveryHistoryRequest('not a url', 'a', 'GET'), false)
})

test('20B2: the measured missing history envelope is the only not-found signal', () => {
  assert.equal(classifyHistoryResponse(200, { code: 0, data: { biz_code: 1, biz_data: null } }), 'not_found')
  assert.equal(classifyHistoryResponse(200, { code: 0, data: { biz_code: 0, biz_data: { chat_messages: [] } } }), 'found')
  for (const [status, body] of [
    [503, { code: 0, data: { biz_code: 1, biz_data: null } }],
    [200, { code: 40002, data: { biz_code: 1, biz_data: null } }],
    [200, { code: 0, data: { biz_code: 1, biz_data: {} } }],
    [200, { code: 0, data: { biz_code: 0, biz_data: null } }],
    [200, null],
  ] as const) assert.equal(classifyHistoryResponse(status, body), 'unknown')
})

test('20B2: title refresh uses only the active exact-id sidebar entry', () => {
  const entries = [
    { id: 'a', title: 'Old', active: false },
    { id: 'b', title: 'Same title', active: true },
  ]
  assert.equal(titleForRecoveredSession(entries, 'a'), null)
  assert.equal(titleForRecoveredSession(entries, 'b'), 'Same title')
  assert.equal(titleForRecoveredSession([{ id: 'a', title: '', active: true }], 'a'), null)
  assert.equal(titleForRecoveredSession([{ id: 'a', title: 'New', active: true }], 'a'), 'New')
})

test('20B2: delete only on logged-in target redirect plus matching not-found history', () => {
  const base = {
    status: 'logged_in' as const,
    target: { kind: 'session' as const, id: 'a' },
    location: { kind: 'empty' as const },
    history: 'not_found' as const,
  }
  assert.equal(recoverySessionVerdict(base), 'deleted')
  assert.equal(recoverySessionVerdict({ ...base, history: 'unknown' }), 'uncertain')
  assert.equal(recoverySessionVerdict({ ...base, history: 'found' }), 'uncertain')
  assert.equal(recoverySessionVerdict({ ...base, status: 'logged_out' }), 'unavailable')
  assert.equal(recoverySessionVerdict({ ...base, location: { kind: 'other' } }), 'uncertain')
  assert.equal(recoverySessionVerdict({ ...base, location: { kind: 'session', id: 'a' } }), 'reconcile')
  assert.equal(recoverySessionVerdict({ ...base, location: { kind: 'session', id: 'b' } }), 'uncertain')
  assert.equal(recoverySessionVerdict({ ...base, target: { kind: 'empty' } }), 'empty')
})
