/**
 * Host stop-generation flow (Phase 07J).
 *
 * Extracted from the route handler so the status semantics stay unit-testable
 * without a real browser:
 *   - browser not ready            → 503
 *   - nothing is generating        → 409
 *   - otherwise                    → click the REAL DeepSeek stop control and
 *                                    report what actually happened (200)
 *
 * The Host never fabricates a "stopped" state: the reply/reasoning that already
 * streamed stays in the message, and an empty final reply becomes valid once a
 * stop was requested (see `browser.stopGeneration`).
 *
 * The two pure helpers below carry the rules that make stopping SAFE when more
 * than one surface asks for it; they live here (and not inside the browser) so
 * they can be tested without launching a page.
 */
import type { CompanionStateStore } from './state.ts'

/** Just the browser capability this flow needs (keeps the unit test trivial). */
export interface StopCapableBrowser {
  stopGeneration(): Promise<boolean>
}

/** Per-send bookkeeping the stop rules are decided from. */
export interface StopGuardState {
  /** The Host is currently streaming a reply. */
  sending: boolean
  /** A stop was ALREADY requested for this send. */
  stopRequested: boolean
}

/** What a stop request must actually do. */
export type StopAction =
  /** No send in flight — there is nothing to stop. */
  | 'idle'
  /** This send was already stopped — report success, never click again. */
  | 'already'
  /** First stop of this send — click the real control exactly once. */
  | 'click'

/**
 * DeepSeek's send and stop share ONE `.ds-button--primary`. After the first stop
 * the button can already be back to "send" while the Host is still finishing the
 * send (`sending === true`), so a second click would SEND a message instead of
 * stopping one.
 *
 * This is why stopping is made idempotent per send HERE, in the Host, and not
 * only in the Client: Dock / Float / Pop-out can each send a stop request at the
 * same time, and a Client-side flag cannot see the other surfaces' requests.
 */
export function decideStopAction(state: StopGuardState): StopAction {
  if (!state.sending) return 'idle'
  return state.stopRequested ? 'already' : 'click'
}

/**
 * Is this final reply acceptable, or must the send fail?
 *
 * A NON-EMPTY reply is never an error — it is the normal case, and checking it
 * first is what keeps a plain send from being reported as "empty reply".
 *
 * An empty reply is only acceptable when the user asked to stop THIS send. A stop
 * from an EARLIER round must never make a later failure look like a success, which
 * is why the flag is reset both before a send starts and when the send flow ends.
 *
 * `content` is compared with `=== ''` (the original pre-07J semantics — no trim).
 */
export function emptyReplyError(content: string, stopRequested: boolean): string | null {
  if (content !== '') return null
  return stopRequested ? null : 'empty reply from DeepSeek'
}

export interface ChatStopResult {
  status: 200 | 409 | 503
  body: { stopped?: boolean; error?: string }
}

export async function handleStopRequest(
  store: CompanionStateStore,
  browser: StopCapableBrowser | null,
): Promise<ChatStopResult> {
  if (browser === null) return { status: 503, body: { error: 'browser not ready' } }
  // The Host's own send state is the authority. Outside a streaming window the
  // primary composer button is the SEND button, so a stop must never be tried.
  if (!store.getState().chat.sending) return { status: 409, body: { error: 'not generating' } }
  try {
    return { status: 200, body: { stopped: await browser.stopGeneration() } }
  } catch (error) {
    // A page-level failure is reported as such; the chat state itself is left to
    // `sendMessage`, which still owns `chat.sending`.
    const detail = error instanceof Error ? error.message : String(error)
    return { status: 503, body: { error: detail } }
  }
}
