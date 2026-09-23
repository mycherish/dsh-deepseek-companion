/**
 * Send / stop button state machine (Phase 07J → 08.2).
 *
 * The button has three labels, fed by the Host plus one local window:
 *   - `sending`  — the Host's authoritative `composer.sending` (= `chat.sending`)
 *   - `stopping` — the Host's `composer.stopping` (a stop was requested for THIS
 *                  send), OR the LOCAL click flag that covers the window between
 *                  the click and that Host state arriving
 *
 * The local flag is what stops the label from flashing: the Stop API returns
 * quickly (the Host only forwards the click to the page), so clearing as soon as
 * the request resolves re-renders 「停止」 while the generation is still finishing
 * — the user sees 停止 → 停止中 → 停止 → 发送.
 *
 * The Host flag is what makes Dock / Float / Pop-out agree: whatever surface
 * asked for the stop, every surface is pushed `composer.stopping === true`.
 *
 * `stopping` is therefore cleared by exactly three things: the Host reporting the
 * send is over (`host-sending: false`), a FAILED Stop request, or a request that
 * reported `stopped:false`.
 *
 * This module is pure so the whole lifecycle is unit-testable without React.
 */

export interface StopUiState {
  /** Host-authoritative: a reply is currently streaming. */
  sending: boolean
  /** Host stop for this send, or the local click window — whichever is active. */
  stopping: boolean
}

/** What the send/stop slot currently shows. */
export type StopPhase = 'send' | 'stop' | 'stopping'

/** Labels for the three phases (kept next to the phases they belong to). */
export const STOP_PHASE_LABEL: Record<StopPhase, string> = {
  send: '发送',
  stop: '停止',
  stopping: '停止中…',
}

export type StopEvent =
  /** The user pressed 「停止」. */
  | { type: 'click' }
  /** The Stop API resolved with `stopped: true`. */
  | { type: 'request-succeeded' }
  /** The Stop API resolved with `stopped: false` — nothing was stopped. */
  | { type: 'request-refused' }
  /** The Stop API threw. */
  | { type: 'request-failed' }
  /** A Host state push: the authoritative send state. */
  | { type: 'host-sending'; sending: boolean }
  /**
   * A Host state push: the Host itself recorded a stop for the running send
   * (Phase 08.2). `true` shows 停止中… on EVERY surface, even one that never
   * clicked. `false` is deliberately a no-op — it would otherwise wipe the local
   * click flag before the send actually ends.
   */
  | { type: 'host-stopping'; stopping: boolean }

export const initialStopUiState: StopUiState = { sending: false, stopping: false }

export function reduceStopUi(state: StopUiState, event: StopEvent): StopUiState {
  switch (event.type) {
    case 'click':
      // The caller only sends this when the slot really is the stop control.
      return { ...state, stopping: true }

    case 'request-succeeded':
      // DELIBERATELY unchanged: the Host is still finishing the send, and the
      // push that reports `sending === false` is what ends 停止中… . Clearing the
      // flag here is exactly what caused the label to flash back to 「停止」.
      return state

    case 'request-refused':
    case 'request-failed':
      // Nothing was stopped (or nothing could be) → never sit on 停止中…, and let
      // the user press 停止 again.
      return { ...state, stopping: false }

    case 'host-sending':
      // A NEW send always starts clean: every send passes through
      // `sending === false` first, which clears the flag, so the next round can
      // never inherit the previous round's 停止中… . And the authoritative end of
      // a send always clears the stop label.
      return { sending: event.sending, stopping: event.sending ? state.stopping : false }

    case 'host-stopping':
      // Only `true` is actionable (another surface asked for the stop); `false`
      // is ignored on purpose — the local click flag must survive until the send
      // really ends, which is `host-sending: false` alone.
      return event.stopping ? { ...state, stopping: true } : state
  }
}

/**
 * The label phase. `sending` here is the SLOT's busy state (the Host's
 * `chat.sending`, or the short local pre-push window), so the phase matches what
 * the button is actually offering at that moment.
 */
export function stopPhase(state: { sending: boolean; stopping: boolean }): StopPhase {
  if (!state.sending) return 'send'
  return state.stopping ? 'stopping' : 'stop'
}
