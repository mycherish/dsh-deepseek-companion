/**
 * Host page-operation guard (Phase 07L → 08).
 *
 * ONE DeepSeek page is shared by every route, so the Host arbitrates its use.
 * Three operations may touch the page — a send, a new chat and a history switch
 * — and they must never overlap:
 *
 *   - while `chat.sending` is true      → new chat / switch are refused
 *   - while a page operation holds the guard → send is refused, and a SECOND
 *     page operation is refused too (the real control is clicked exactly once)
 *
 * The Client's per-surface flags (Dock / Float / Pop-out cannot see each other)
 * are only UI debounce; the real arbitration lives here. This is bookkeeping,
 * not state any view renders, so it is deliberately NOT part of
 * `CompanionState`.
 */
export interface PageGuard {
  /** Is a page operation (new chat / switch) in flight right now? */
  inProgress(): boolean
  /** Claim the guard atomically. `false` when someone else already holds it. */
  tryClaim(): boolean
  /** Release the guard (always from `finally`, success or failure). */
  release(): void
}

export function createPageGuard(): PageGuard {
  let inProgress = false
  return {
    inProgress: () => inProgress,
    tryClaim() {
      // Synchronous check-and-set with no `await` in between: two concurrent
      // requests can never both win.
      if (inProgress) return false
      inProgress = true
      return true
    },
    release() {
      inProgress = false
    },
  }
}

/** The slice of the guard a send only needs. */
export interface PageOperationBlocker {
  inProgress(): boolean
}
