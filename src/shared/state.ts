/**
 * Shared Companion Host state shape (Phase 06B).
 *
 * Host is the authoritative owner; Client only reads and displays it. This is
 * a pure type — no runtime dependency — so both the Host and Client bundles can
 * import it without pulling `node:*` into the browser.
 */
export interface CompanionState {
  status: 'ready'
  revision: number
  instanceId: string
}
