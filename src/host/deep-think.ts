/**
 * DeepSeek "Deep Think" toggle (Phase 07G, moved onto the shared composer
 * toggle helper in Phase 07H).
 *
 * Investigation found that Deep Think and Search are `div.ds-toggle-button`
 * siblings sharing every stable attribute, so BOTH are handled by
 * `./toggle.ts` — one conservative locating rule, one request flow. This module
 * only pins down Deep Think's labels and exposes the Phase 07G names, so the
 * existing call sites and tests keep working unchanged.
 *
 * The switch is only ever changed by clicking the real DeepSeek UI — never by
 * writing DOM attributes or calling DeepSeek's private endpoints.
 */
import type { ComposerToggleState, DeepThinkState } from '../shared/state.ts'
import type { CompanionStateStore } from './state.ts'
import {
  composerToggleInPage,
  handleToggleRequest,
  needsToggleClick,
  normalizeToggleState,
  type ComposerToggleOptions,
  type ToggleControlResponse,
} from './toggle.ts'

/** Deep Think's own locating rules (Phase 07G). */
export type DeepThinkOptions = ComposerToggleOptions

/**
 * Read — or click — the Deep Think toggle inside the page. Re-exported straight
 * from the shared helper: it is the same self-contained function Playwright
 * serializes into the page, just named for the Deep Think call sites.
 */
export const deepThinkInPage = composerToggleInPage

/** Coerce a value arriving from the page into a trusted `DeepThinkState`. */
export const normalizeDeepThinkState = normalizeToggleState

/** Whether reaching `enabled` requires clicking the toggle at all. */
export const needsDeepThinkClick = needsToggleClick

/** The slice of the browser the Deep Think route needs (stubbed in tests). */
export interface DeepThinkController {
  getDeepThinkState(): Promise<DeepThinkState>
  setDeepThinkEnabled(enabled: boolean): Promise<DeepThinkState>
}

export type DeepThinkResponseBody = ComposerToggleState & { error?: string }

export type DeepThinkResponse = ToggleControlResponse

/**
 * Host-side Deep Think request flow (Phase 07G). Delegates to the shared
 * composer-switch flow so Deep Think and Search cannot drift apart; the store is
 * ALWAYS written with the page's real state — never an optimistic guess.
 */
export async function handleDeepThinkRequest(
  store: CompanionStateStore,
  controller: DeepThinkController | null,
  body: unknown,
): Promise<DeepThinkResponse> {
  return handleToggleRequest(
    store,
    controller === null
      ? null
      : {
          read: () => controller.getDeepThinkState(),
          set: (enabled) => controller.setDeepThinkEnabled(enabled),
          mirrored: () => store.getState().deepseek.deepThink,
          mirror: (state) => store.setDeepThinkState(state),
        },
    body,
    { failure: 'failed to set Deep Think' },
  )
}
