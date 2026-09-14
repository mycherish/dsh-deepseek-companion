/**
 * Companion Host state store (Phase 06C).
 *
 * The Host owns the authoritative, subscribable Companion state. `instanceId`
 * is minted once per Host process; `revision` increments when the Host bumps
 * the state, and every listener receives the new snapshot. `subscribe` replays
 * the current state immediately so a new listener always starts fresh. This is
 * a plain in-memory observable — no Redux/Zustand, no persistence.
 */
import { randomUUID } from 'node:crypto'
import type { CompanionState } from '../shared/state.ts'

export type StateListener = (state: CompanionState) => void

export interface CompanionStateStore {
  getState(): CompanionState
  subscribe(listener: StateListener): () => void
  bumpRevision(): void
  dispose(): void
}

export function createCompanionStateStore(): CompanionStateStore {
  let state: CompanionState = {
    status: 'ready',
    revision: 1,
    instanceId: randomUUID(),
  }
  const listeners = new Set<StateListener>()
  let disposed = false

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener)
      try {
        listener(state)
      } catch {
        // a failing listener must not break the store
      }
      return () => {
        listeners.delete(listener)
      }
    },

    bumpRevision() {
      if (disposed) return
      state = { ...state, revision: state.revision + 1 }
      for (const listener of [...listeners]) {
        try {
          listener(state)
        } catch {
          // a failing listener must not break the store
        }
      }
    },

    dispose() {
      disposed = true
      listeners.clear()
    },
  }
}
