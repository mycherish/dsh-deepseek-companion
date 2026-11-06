/**
 * DeepSeek composer toggle helper (Phase 07G → 07H).
 *
 * DeepSeek renders its composer switches (Deep Think, Search, …) as
 * `div.ds-toggle-button` siblings that share EVERY stable attribute:
 *   - `aria-pressed="true" | "false"`  → the authoritative on/off state
 *   - `class` containing `ds-toggle-button--selected` when on (same signal)
 *   - their icons differ only by a dynamically generated lottie id
 *   - no `data-*`, `role` or other discriminator
 *
 * So each switch is located by its SEMANTIC CLASS (never a hash class, never
 * nth-child, never "the second button") and disambiguated conservatively:
 *   A. exactly one label match                       → use it
 *   B. no label match, BUT a sibling switch is
 *      positively identified and exactly one
 *      candidate remains                             → use that leftover
 *   C. anything ambiguous                            → `available: false`
 * Never guessing keeps a future third DeepSeek switch from being clicked.
 *
 * `composerToggleInPage` is SELF-CONTAINED because Playwright serializes it
 * into the browser context, and it takes the browser surface by injection so
 * the same code is unit-testable in Node. A switch is only ever changed by
 * clicking the real DeepSeek UI — never by writing DOM attributes or calling
 * DeepSeek's private endpoints.
 */
import type { ComposerToggleState } from '../shared/state.ts'
import type { ReplyEnv } from './reply.ts'
import type { CompanionStateStore } from './state.ts'

export interface ComposerToggleOptions {
  /** DeepSeek's toggle class (semantic, non-hashed). */
  toggleSelector: string
  /** Class that marks a toggle as ON (used when `aria-pressed` is absent). */
  selectedClass: string
  /** Labels identifying THIS switch (multi-language, case/space-insensitive). */
  labels: string[]
  /** Labels identifying the OTHER composer switches (excluded from this one). */
  exclusions: string[]
}

/**
 * Page global written by a `click` action: the element that was just clicked.
 * The Host uses it for the follow-up condition wait, so the locating rules live
 * in exactly ONE place. Keep it in sync with the literal inside
 * `composerToggleInPage` (which cannot reference module scope).
 */
export const TOGGLE_TARGET_KEY = '__composerToggleTarget'

/**
 * Read — or click — one composer switch inside the page.
 *
 * `action: 'read'` returns the current real state and never touches the DOM.
 * `action: 'click'` clicks the switch once, records the clicked element on the
 * page global for the Host's condition wait, and returns the state observed
 * immediately after the click (the SPA updates asynchronously).
 */
export function composerToggleInPage(payload: {
  options: ComposerToggleOptions
  action: 'read' | 'click'
  env?: ReplyEnv
}): ComposerToggleState {
  const options = payload.options
  const env: Partial<ReplyEnv> = payload.env ?? (globalThis as unknown as Partial<ReplyEnv>)
  const doc = env.document
  const missing: ComposerToggleState = { available: false, enabled: false }
  if (doc === undefined) return missing

  const squash = (value: string): string => value.replace(/\s+/g, '').toLowerCase()
  const labels = options.labels.map(squash)
  const exclusions = options.exclusions.map(squash)

  const labelOf = (el: unknown): string => squash(String((el as { textContent?: string | null }).textContent ?? ''))
  const matchesAny = (el: unknown, words: string[]): boolean => {
    const label = labelOf(el)
    return words.some((word) => word !== '' && label.includes(word))
  }
  const isOn = (el: unknown): boolean => {
    const node = el as { getAttribute?: (name: string) => string | null; className?: unknown }
    const pressed = typeof node.getAttribute === 'function' ? node.getAttribute('aria-pressed') : null
    if (pressed !== null) return pressed === 'true'
    return typeof node.className === 'string' && node.className.includes(options.selectedClass)
  }

  const toggles = Array.from(doc.querySelectorAll(options.toggleSelector))

  // A) An UNAMBIGUOUS label match wins. Two label matches means we cannot tell
  //    which one is the target, so we do NOT guess.
  const labelMatches = toggles.filter((el) => matchesAny(el, labels))
  let target: unknown = null
  if (labelMatches.length === 1) target = labelMatches[0]

  // B) No label matched at all: only accept the leftover when the other switch
  //    is positively identified AND exactly one candidate remains.
  if (target === null && labelMatches.length === 0) {
    const identified = toggles.filter((el) => matchesAny(el, exclusions))
    const rest = toggles.filter((el) => !matchesAny(el, exclusions))
    if (identified.length > 0 && rest.length === 1) target = rest[0]
  }

  // C) Anything else is ambiguous → stay unavailable. Better to be temporarily
  //    unusable than to click some other (possibly newly added) switch.
  if (target === null) return missing

  if (payload.action === 'click') {
    const win = env.window as Record<string, unknown> | undefined
    if (win !== undefined) win['__composerToggleTarget'] = target
    const click = (target as { click?: unknown }).click
    if (typeof click === 'function') (click as () => void).call(target)
  }
  return { available: true, enabled: isOn(target) }
}

/** Coerce a value arriving from the page into a trusted toggle state. */
export function normalizeToggleState(value: unknown): ComposerToggleState {
  const raw: { available?: unknown; enabled?: unknown } =
    value !== null && typeof value === 'object' ? (value as { available?: unknown; enabled?: unknown }) : {}
  const available = raw.available === true
  return { available, enabled: available && raw.enabled === true }
}

/** Whether reaching `enabled` requires clicking the switch at all. */
export function needsToggleClick(before: ComposerToggleState, enabled: boolean): boolean {
  return before.available && before.enabled !== enabled
}

// --- Host-side request flow -------------------------------------------------
// Shared by every composer switch route so the status codes stay identical:
//   400 non-boolean body · 503 browser not ready · 409 while a reply streams
//   200 with the page's REAL state · 500 when the click failed (real state kept)

export interface ToggleControlResponse {
  status: 200 | 400 | 409 | 500 | 503
  body: ComposerToggleState & { error?: string }
}

/** One switch as the route sees it: page access + Host mirror access. */
export interface ToggleControl {
  /** Read the page's REAL state. */
  read(): Promise<ComposerToggleState>
  /** Click toward `enabled` (no-op when already there) and re-read the page. */
  set(enabled: boolean): Promise<ComposerToggleState>
  /** The state the Host currently mirrors. */
  mirrored(): ComposerToggleState
  /** Write the page's real state into the Host mirror. */
  mirror(state: ComposerToggleState): void
}

const UNAVAILABLE: ComposerToggleState = { available: false, enabled: false }

/**
 * Shared composer-switch request flow (Phase 07H), extracted so Deep Think and
 * Search cannot drift apart. The mirror is ALWAYS written with the page's real
 * state — never an optimistic guess.
 */
export async function handleToggleRequest(
  store: CompanionStateStore,
  control: ToggleControl | null,
  body: unknown,
  options: { failure: string },
): Promise<ToggleControlResponse> {
  const requested: { enabled?: unknown } =
    body !== null && typeof body === 'object' ? (body as { enabled?: unknown }) : {}
  if (typeof requested.enabled !== 'boolean') {
    return { status: 400, body: { ...UNAVAILABLE, error: 'enabled must be a boolean' } }
  }
  if (control === null) {
    return { status: 503, body: { ...UNAVAILABLE, error: 'browser not ready' } }
  }
  // Readiness can await recovery; do not apply an earlier click to an uncertain page.
  if (store.getState().recoveryNotice === 'session_unverified') {
    return { status: 409, body: { ...control.mirrored(), error: 'recovered session is unverified' } }
  }
  // Never change the composer mode while a reply is streaming.
  if (store.getState().chat.sending) {
    return { status: 409, body: { ...control.mirrored(), error: 'chat is busy' } }
  }
  try {
    const state = await control.set(requested.enabled)
    control.mirror(state)
    return { status: 200, body: state }
  } catch {
    // Report the page's truth even when the click failed.
    const state = await control.read().catch(() => UNAVAILABLE)
    control.mirror(state)
    return { status: 500, body: { ...state, error: options.failure } }
  }
}
