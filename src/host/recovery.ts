/**
 * Browser-recovery pure logic (Phase 20A).
 *
 * Every decision here is a pure function or a tiny state object, so it can be
 * unit-tested without Playwright. The actual page/context/browser manipulation
 * lives in `browser.ts`, which consumes these rules and never re-derives them.
 *
 * Design: `docs/architecture.md` → "Browser Recovery (Phase 20A)".
 */

/** The five-way page-health verdict the recovery engine acts on (design §5). */
export type PageHealth = 'healthy_chat' | 'login_required' | 'page_invalid' | 'page_dead' | 'browser_dead'

/** Which reconstruction a recovery performs. There is no Level 2 (design §4). */
export type RecoveryLevel = 1 | 3

/**
 * Whole-recovery wall-clock budget (design §7): every retry, backoff and step
 * of a single recovery shares this one window, measured from when its
 * single-flight promise was created.
 */
export const RECOVERY_TOTAL_BUDGET_MS = 60_000

/** Attempt caps (design §7). These are UPPER bounds only — the 60s budget can end recovery earlier. */
export const LEVEL_1_MAX_ATTEMPTS = 2
export const LEVEL_3_MAX_ATTEMPTS = 3

/** Backoff before attempts 1/2/3 (1-based). */
export const RECOVERY_BACKOFF_MS: readonly number[] = [0, 250, 750]

/** Per-step timeouts; each is still capped by the remaining recovery budget. */
export const RECOVERY_STEP_TIMEOUTS = {
  closeQuietly: 2_000,
  newPage: 5_000,
  goto: 30_000,
  loginDetection: 10_000,
  composerReadiness: 2_000,
} as const

export type RecoveryStepName = keyof typeof RECOVERY_STEP_TIMEOUTS

/**
 * The synchronous facts a health classification needs. All of these are cheap:
 * they read Playwright's own lifecycle flags (`isClosed`, `isConnected`) or the
 * page URL — never a DOM probe. A DOM composer-readiness probe is deliberately
 * NOT an input here: it runs inside the recovery only when needed (design §5
 * "zero-cost hot path").
 */
export interface PageHealthInput {
  /** `browser.isConnected()` — false after a disconnect / kill. */
  connected: boolean
  /** `page.isClosed()` — true after the page (or its context/browser) closed. */
  pageClosed: boolean
  /** Set by `page.on('crash')`; a crashed page reports `isClosed() === false`. */
  crashed: boolean
  /** The page URL is on DeepSeek's chat origin (not `about:blank` / `chrome://`). */
  originOk: boolean
  /** The page URL is the sign-in route (a HEALTHY page that needs a login). */
  signIn: boolean
  /** This page was previously confirmed healthy and no invalidation happened since. */
  knownHealthy: boolean
}

/**
 * Map the synchronous facts to one of the five health verdicts (design §5).
 *
 * Order matters: a dead browser outranks a dead page, which outranks a bad
 * origin; `signIn` is checked AFTER the origin so `about:blank` never looks
 * like a login page, and the `knownHealthy` hot path is only reachable once
 * everything else already passed.
 */
export function classifyPageHealth(input: PageHealthInput): PageHealth {
  if (!input.connected) return 'browser_dead'
  if (input.pageClosed || input.crashed) return 'page_dead'
  if (!input.originOk) return 'page_invalid'
  if (input.signIn) return 'login_required'
  if (input.knownHealthy) return 'healthy_chat'
  return 'page_invalid'
}

/** Cap for one recovery level (design §7). */
export function maxAttemptsFor(level: RecoveryLevel): number {
  return level === 1 ? LEVEL_1_MAX_ATTEMPTS : LEVEL_3_MAX_ATTEMPTS
}

/** Backoff before a 1-based attempt number; clamped to the last slot. */
export function backoffForAttempt(attempt: number): number {
  const index = Math.max(0, Math.min(attempt - 1, RECOVERY_BACKOFF_MS.length - 1))
  return RECOVERY_BACKOFF_MS[index]!
}

export interface RecoveryBudget {
  /** Milliseconds left of the 60s window (never negative). */
  remaining(): number
  /** Whether the budget is gone: recovery must stop and report `offline`. */
  exhausted(): boolean
  /** A named step's effective timeout, capped by the remaining budget. */
  effectiveTimeout(step: RecoveryStepName): number
  /** A raw step timeout, capped by the remaining budget. */
  effectiveTimeoutMs(stepTimeout: number): number
}

/**
 * The 60s wall-clock budget for ONE recovery (design §7). `startedAtMs` defaults
 * to "now"; tests inject a fixed value to make exhaustion deterministic.
 */
export function createRecoveryBudget(startedAtMs: number = Date.now()): RecoveryBudget {
  const remaining = (): number => Math.max(0, RECOVERY_TOTAL_BUDGET_MS - (Date.now() - startedAtMs))
  return {
    remaining,
    exhausted: () => remaining() <= 0,
    effectiveTimeout: (step) => Math.min(RECOVERY_STEP_TIMEOUTS[step], remaining()),
    effectiveTimeoutMs: (stepTimeout) => Math.min(stepTimeout, remaining()),
  }
}
