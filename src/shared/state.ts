/**
 * Shared Companion Host state shape (Phase 07A).
 *
 * Host is the authoritative owner; Client only reads and displays it. This is
 * a pure type — no runtime dependency — so both the Host and Client bundles can
 * import it without pulling `node:*` into the browser.
 */

/** DeepSeek web session login state (Phase 07A). */
export type DeepSeekStatus = 'checking' | 'logged_in' | 'logged_out' | 'error'

export interface CompanionState {
  status: 'ready'
  revision: number
  instanceId: string
  deepseek: {
    status: DeepSeekStatus
  }
}
