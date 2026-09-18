/**
 * Companion Host state store (Phase 07A).
 *
 * The Host owns the authoritative, subscribable Companion state. `instanceId`
 * is minted once per Host process; `revision` increments when the Host bumps
 * the state; `deepseek.status` tracks the DeepSeek web session login state and
 * updates independently of `revision`. Every change notifies all listeners.
 */
import { randomUUID } from 'node:crypto'
import type { CompanionState, DeepSeekStatus } from '../shared/state.ts'

export type StateListener = (state: CompanionState) => void

export interface CompanionStateStore {
  getState(): CompanionState
  subscribe(listener: StateListener): () => void
  bumpRevision(): void
  setDeepSeekStatus(status: DeepSeekStatus): void
  dispose(): void
}

export function createCompanionStateStore(): CompanionStateStore {
  let state: CompanionState = {
    status: 'ready',
    revision: 1,
    instanceId: randomUUID(),
    deepseek: { status: 'checking' },
  }
  const listeners = new Set<StateListener>()
  let disposed = false

  const notify = (next: CompanionState): void => {
    for (const listener of [...listeners]) {
      try {
        listener(next)
      } catch {
        // a failing listener must not break the store
      }
    }
  }

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
      notify(state)
    },

    setDeepSeekStatus(status: DeepSeekStatus) {
      if (disposed) return
      if (state.deepseek.status === status) return
      state = { ...state, deepseek: { status } }
      notify(state)
    },

    dispose() {
      disposed = true
      listeners.clear()
    },
  }
}
