/**
 * Client Companion Host-state reader (Phase 06B).
 *
 * One shared fetch used by both Dock and Pop-out, so neither view owns its own
 * copy of the state shape. `origin` is the parent DSH page origin (the pop-out
 * is `about:blank`, so it must not rely on its own relative URL).
 */
import type { CompanionState } from '../shared/state.ts'

export type { CompanionState }

/** Read-only Host route returning the shared Companion state. */
const STATE_PATH = '/api/deepseek-companion/state'

export async function fetchCompanionState(origin: string, signal?: AbortSignal): Promise<CompanionState> {
  const response = await fetch(`${origin}${STATE_PATH}`, {
    credentials: 'include',
    signal,
  })
  if (!response.ok) throw new Error(`host state unavailable (HTTP ${response.status})`)
  return (await response.json()) as CompanionState
}
