/**
 * DeepSeek "Deep Think" toggle reader/writer (Phase 07G).
 *
 * Investigation (07G-0) found that DeepSeek renders Deep Think and Search as
 * `div.ds-toggle-button` siblings with:
 *   - `aria-pressed="true" | "false"`  → the authoritative on/off state
 *   - `class` containing `ds-toggle-button--selected` when on (same signal)
 *   - NO other discriminator: their icons differ only by a dynamically generated
 *     lottie id, and there is no `data-*` / `role` / stable attribute to tell
 *     Deep Think apart from Search.
 *
 * So the toggle is located by its SEMANTIC CLASS (never a hash class, never
 * nth-child) and then disambiguated conservatively:
 *   A. exactly one label match              → use it
 *   B. no label match, BUT Search is positively identified and exactly one
 *      non-Search candidate remains         → use that leftover
 *   C. anything ambiguous                   → `available: false`
 * Never guessing keeps a future third DeepSeek switch from being clicked.
 *
 * Like `reply.ts` / `reasoning.ts`, `deepThinkInPage` is SELF-CONTAINED because
 * Playwright serializes it into the browser context, and it takes the browser
 * surface by injection so the same code is unit-testable in Node.
 *
 * The toggle is only ever changed by clicking the real DeepSeek UI — never by
 * writing DOM attributes or calling DeepSeek's private endpoints.
 */
import type { DeepThinkState } from '../shared/state.ts'
import type { ReplyEnv } from './reply.ts'
import type { CompanionStateStore } from './state.ts'

export interface DeepThinkOptions {
  /** DeepSeek's toggle class (semantic, non-hashed). */
  toggleSelector: string
  /** Class that marks a toggle as ON (used when `aria-pressed` is absent). */
  selectedClass: string
  /** Labels identifying the Deep Think toggle (multi-language, case/space-insensitive). */
  labels: string[]
  /** Labels identifying other toggles to skip (e.g. Search). */
  exclusions: string[]
}

/**
 * Read — or click — the Deep Think toggle inside the page.
 *
 * `action: 'read'` returns the current real state. `action: 'click'` clicks the
 * toggle once and returns the state observed immediately after the click; the
 * caller re-reads later, because the SPA updates asynchronously.
 */
export function deepThinkInPage(payload: {
  options: DeepThinkOptions
  action: 'read' | 'click'
  env?: ReplyEnv
}): DeepThinkState {
  const options = payload.options
  const env: Partial<ReplyEnv> = payload.env ?? (globalThis as unknown as Partial<ReplyEnv>)
  const doc = env.document
  const missing: DeepThinkState = { available: false, enabled: false }
  if (doc === undefined) return missing

  const squash = (value: string): string => value.replace(/\s+/g, '').toLowerCase()
  const labels = options.labels.map(squash)
  const exclusions = options.exclusions.map(squash)

  const labelOf = (el: unknown): string => squash(String((el as { textContent?: string | null }).textContent ?? ''))
  const isExcluded = (el: unknown): boolean => {
    const label = labelOf(el)
    return exclusions.some((word) => word !== '' && label.includes(word))
  }
  const isOn = (el: unknown): boolean => {
    const node = el as { getAttribute?: (name: string) => string | null; className?: unknown }
    const pressed = typeof node.getAttribute === 'function' ? node.getAttribute('aria-pressed') : null
    if (pressed !== null) return pressed === 'true'
    return typeof node.className === 'string' && node.className.includes(options.selectedClass)
  }

  const toggles = Array.from(doc.querySelectorAll(options.toggleSelector))

  // A) An UNAMBIGUOUS label match wins. Two label matches means we cannot tell
  //    which one is Deep Think, so we do NOT guess.
  const labelMatches = toggles.filter((el) => labels.some((word) => word !== '' && labelOf(el).includes(word)))
  let target: unknown = null
  if (labelMatches.length === 1) target = labelMatches[0]

  // B) No label matched at all: only accept the leftover when Search is
  //    positively identified AND exactly one non-Search candidate remains.
  if (target === null && labelMatches.length === 0) {
    const identified = toggles.filter((el) => isExcluded(el))
    const rest = toggles.filter((el) => !isExcluded(el))
    if (identified.length > 0 && rest.length === 1) target = rest[0]
  }

  // C) Anything else is ambiguous → stay unavailable. Better to be temporarily
  //    unusable than to click some other (possibly newly added) DeepSeek switch.
  if (target === null) return missing

  if (payload.action === 'click') {
    const click = (target as { click?: unknown }).click
    if (typeof click === 'function') (click as () => void).call(target)
  }
  return { available: true, enabled: isOn(target) }
}

/** Coerce a value arriving from the page into a trusted `DeepThinkState`. */
export function normalizeDeepThinkState(value: unknown): DeepThinkState {
  const raw: { available?: unknown; enabled?: unknown } =
    value !== null && typeof value === 'object' ? (value as { available?: unknown; enabled?: unknown }) : {}
  const available = raw.available === true
  return { available, enabled: available && raw.enabled === true }
}

/** Whether reaching `enabled` requires clicking the toggle at all. */
export function needsDeepThinkClick(before: DeepThinkState, enabled: boolean): boolean {
  return before.available && before.enabled !== enabled
}

/** The slice of the browser the Deep Think route needs (stubbed in tests). */
export interface DeepThinkController {
  getDeepThinkState(): Promise<DeepThinkState>
  setDeepThinkEnabled(enabled: boolean): Promise<DeepThinkState>
}

export interface DeepThinkResponseBody {
  available: boolean
  enabled: boolean
  error?: string
}

export interface DeepThinkResponse {
  status: 200 | 400 | 409 | 500 | 503
  body: DeepThinkResponseBody
}

const UNAVAILABLE: DeepThinkState = { available: false, enabled: false }

/**
 * Host-side Deep Think request flow (Phase 07G), extracted from the route so it
 * is unit-testable without a browser. The store is ALWAYS written with the
 * page's real state — never an optimistic guess.
 */
export async function handleDeepThinkRequest(
  store: CompanionStateStore,
  controller: DeepThinkController | null,
  body: unknown,
): Promise<DeepThinkResponse> {
  const requested: { enabled?: unknown } =
    body !== null && typeof body === 'object' ? (body as { enabled?: unknown }) : {}
  if (typeof requested.enabled !== 'boolean') {
    return { status: 400, body: { ...UNAVAILABLE, error: 'enabled must be a boolean' } }
  }
  if (controller === null) {
    return { status: 503, body: { ...UNAVAILABLE, error: 'browser not ready' } }
  }
  // Never change the mode while a reply is streaming.
  if (store.getState().chat.sending) {
    return { status: 409, body: { ...store.getState().deepseek.deepThink, error: 'chat is busy' } }
  }
  try {
    const state = await controller.setDeepThinkEnabled(requested.enabled)
    store.setDeepThinkState(state)
    return { status: 200, body: state }
  } catch {
    // Report the page's truth even when the click failed.
    const state = await controller.getDeepThinkState().catch(() => UNAVAILABLE)
    store.setDeepThinkState(state)
    return { status: 500, body: { ...state, error: 'failed to set Deep Think' } }
  }
}
