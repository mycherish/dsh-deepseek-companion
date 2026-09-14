import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import { createCompanionState } from './host/state.ts'

/** Cordis plugin id, referenced by the bundle patch to insert this plugin. */
export const name = 'deepseek-companion'

/** Host services this plugin requires before `apply`. */
export const inject = ['connection']

/** Read-only Host API route exposing the shared Companion state. */
const STATE_PATH = '/api/deepseek-companion/state'

/**
 * DeepSeek Web Companion host half (Phase 06B).
 *
 * The Host owns the authoritative Companion state and exposes it over one
 * read-only GET route. Dock and Pop-out both read this same route, proving the
 * future chat state can live in a single Host-owned place. No write API, no
 * SSE, no user data.
 */
export function apply(ctx: Context): void {
  const state = createCompanionState()

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: STATE_PATH,
        methods: ['GET'],
        fetch: async () => Response.json(state),
      }),
    'deepseek-companion: companion state route',
  )

  console.log('[dsh-deepseek-companion] loaded')
}
