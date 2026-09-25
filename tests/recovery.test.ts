import assert from 'node:assert/strict'
import test from 'node:test'

import {
  backoffForAttempt,
  classifyPageHealth,
  createRecoveryBudget,
  LEVEL_1_MAX_ATTEMPTS,
  LEVEL_3_MAX_ATTEMPTS,
  maxAttemptsFor,
  RECOVERY_BACKOFF_MS,
  RECOVERY_STEP_TIMEOUTS,
  RECOVERY_TOTAL_BUDGET_MS,
} from '../src/host/recovery.ts'

/**
 * Phase 20A — recovery pure logic. No Playwright: these pin the five-way health
 * classification, the retry caps, the backoff schedule and the 60s wall-clock
 * budget the browser engine consumes.
 */

const base = {
  connected: true,
  pageClosed: false,
  crashed: false,
  originOk: true,
  signIn: false,
  knownHealthy: true,
}

// --- 5. health classification -------------------------------------------------

test('recovery health: 健康热路径 → healthy_chat（零成本，不触发 recovery）', () => {
  assert.equal(classifyPageHealth(base), 'healthy_chat')
})

test('recovery health: sign_in → login_required（不 recovery）', () => {
  assert.equal(classifyPageHealth({ ...base, signIn: true }), 'login_required')
})

test('recovery health: about:blank / 非 DeepSeek origin → page_invalid → Level 1', () => {
  assert.equal(classifyPageHealth({ ...base, originOk: false }), 'page_invalid')
})

test('recovery health: page close → page_dead → Level 1', () => {
  assert.equal(classifyPageHealth({ ...base, pageClosed: true }), 'page_dead')
})

test('recovery health: renderer crash（isClosed 仍为 false）→ page_dead', () => {
  assert.equal(classifyPageHealth({ ...base, crashed: true }), 'page_dead')
})

test('recovery health: browser disconnect → browser_dead → Level 3', () => {
  assert.equal(classifyPageHealth({ ...base, connected: false }), 'browser_dead')
})

test('recovery health: DeepSeek origin 但未确认健康 → page_invalid（需要 bounded readiness）', () => {
  assert.equal(classifyPageHealth({ ...base, knownHealthy: false }), 'page_invalid')
})

test('recovery health: 判定优先级 —— dead 优先于 origin，sign_in 在 origin 之后', () => {
  // 页面死了且 origin 不对：page_dead 赢过 page_invalid。
  assert.equal(classifyPageHealth({ ...base, pageClosed: true, originOk: false }), 'page_dead')
  // 浏览器死了：browser_dead 赢过一切。
  assert.equal(classifyPageHealth({ ...base, connected: false, pageClosed: true, crashed: true }), 'browser_dead')
  // about:blank 绝不能看起来像登录页。
  assert.equal(classifyPageHealth({ ...base, originOk: false, signIn: true }), 'page_invalid')
})

// --- retry caps + backoff -----------------------------------------------------

test('recovery retry: Level 1 ≤2、Level 3 ≤3、不存在 Level 2', () => {
  assert.equal(LEVEL_1_MAX_ATTEMPTS, 2)
  assert.equal(LEVEL_3_MAX_ATTEMPTS, 3)
  assert.equal(maxAttemptsFor(1), 2)
  assert.equal(maxAttemptsFor(3), 3)
})

test('recovery backoff: 0 / 250 / 750ms，超出后钳制到最后一位', () => {
  assert.deepEqual([...RECOVERY_BACKOFF_MS], [0, 250, 750])
  assert.equal(backoffForAttempt(1), 0)
  assert.equal(backoffForAttempt(2), 250)
  assert.equal(backoffForAttempt(3), 750)
  assert.equal(backoffForAttempt(99), 750)
})

// --- 60s wall-clock budget ----------------------------------------------------

test('recovery budget: 新鲜预算不耗尽，remaining 接近 60s', () => {
  const budget = createRecoveryBudget()
  assert.equal(budget.exhausted(), false)
  assert.ok(budget.remaining() > RECOVERY_TOTAL_BUDGET_MS - 1000)
  assert.ok(budget.remaining() <= RECOVERY_TOTAL_BUDGET_MS)
})

test('recovery budget: 时间流逝使 remaining 缩小，越过 60s 即耗尽', () => {
  const started = Date.now() - RECOVERY_TOTAL_BUDGET_MS - 1
  const budget = createRecoveryBudget(started)
  assert.equal(budget.remaining(), 0)
  assert.equal(budget.exhausted(), true)
})

test('recovery budget: effectiveTimeout = min(stepTimeout, remaining)', () => {
  // 剩 ~50s：每个步骤都退回自己的完整 timeout。
  const fresh = createRecoveryBudget(Date.now() - 10_000)
  assert.equal(fresh.effectiveTimeout('closeQuietly'), RECOVERY_STEP_TIMEOUTS.closeQuietly)
  assert.equal(fresh.effectiveTimeout('newPage'), RECOVERY_STEP_TIMEOUTS.newPage)
  assert.equal(fresh.effectiveTimeout('goto'), RECOVERY_STEP_TIMEOUTS.goto)
  assert.equal(fresh.effectiveTimeout('loginDetection'), RECOVERY_STEP_TIMEOUTS.loginDetection)
  assert.equal(fresh.effectiveTimeout('composerReadiness'), RECOVERY_STEP_TIMEOUTS.composerReadiness)
})

test('recovery budget: 剩余预算不足时，步骤 timeout 被预算截断（不再吃满完整 step timeout）', () => {
  // 只剩 3s 预算：goto 的 30s 被截到 ~3s。
  const tight = createRecoveryBudget(Date.now() - (RECOVERY_TOTAL_BUDGET_MS - 3_000))
  assert.ok(tight.remaining() <= 3_000)
  assert.ok(tight.effectiveTimeout('goto') <= 3_000)
  assert.equal(tight.effectiveTimeoutMs(30_000) <= 3_000, true)
  // 一个本来就小于剩余预算的步骤不受影响。
  assert.equal(tight.effectiveTimeoutMs(1_000), 1_000)
})

test('recovery budget: effectiveTimeoutMs 钳制任意 stepTimeout', () => {
  const fresh = createRecoveryBudget()
  assert.equal(fresh.effectiveTimeoutMs(500), 500)
  assert.equal(fresh.effectiveTimeoutMs(999_999), RECOVERY_TOTAL_BUDGET_MS)
})

test('recovery budget: 耗尽后 remaining 恒为 0，绝不继续下一 retry 的依据', () => {
  const exhausted = createRecoveryBudget(Date.now() - RECOVERY_TOTAL_BUDGET_MS - 5_000)
  assert.equal(exhausted.exhausted(), true)
  assert.equal(exhausted.effectiveTimeout('goto'), 0)
  assert.equal(exhausted.effectiveTimeoutMs(30_000), 0)
})
