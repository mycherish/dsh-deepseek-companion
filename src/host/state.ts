/**
 * Companion Host state factory (Phase 06B).
 *
 * The Host owns the authoritative Companion state. `instanceId` is minted once
 * per Host process so Dock and Pop-out can prove they read the same source.
 */
import { randomUUID } from 'node:crypto'
import type { CompanionState } from '../shared/state.ts'

export function createCompanionState(): CompanionState {
  return {
    status: 'ready',
    revision: 1,
    instanceId: randomUUID(),
  }
}
