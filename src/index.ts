import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import { createDeepSeekBrowser, type DeepSeekBrowser } from './host/browser.ts'
import { browserProfileDir } from './host/paths.ts'
import { createCompanionStateStore, type CompanionStateStore } from './host/state.ts'
import type { CompanionState } from './shared/state.ts'

/** Cordis plugin id, referenced by the bundle patch to insert this plugin. */
export const name = 'deepseek-companion'

/** Host services this plugin requires before `apply`. */
export const inject = ['connection']

/** Read-only snapshot route. */
const STATE_PATH = '/api/deepseek-companion/state'
/** Read-only SSE stream route (Phase 06C realtime sync). */
const STREAM_PATH = '/api/deepseek-companion/state/stream'

/**
 * DeepSeek Web Companion host half.
 *
 * The Host owns the single authoritative Companion state (including the
 * DeepSeek web session login state) and a single persistent DeepSeek browser.
 * State is exposed over a snapshot route and an SSE stream so Dock, Float, and
 * Pop-out all read the same live data. No chat yet.
 */
export function apply(ctx: Context): void {
  const store = createCompanionStateStore()

  // Per-profile browser profile (via ctx.baseUrl), overridable for tests.
  const browserProfileDirForCtx = browserProfileDir(process.env, ctx.baseUrl)

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: STATE_PATH,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: async () => Response.json(store.getState()),
      }),
    'deepseek-companion: companion state route',
  )

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: STREAM_PATH,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: async (request) => createStateStream(store, request.signal),
      }),
    'deepseek-companion: companion state stream route',
  )

  // DeepSeek browser lifecycle: owned by the Host, shared by all views. Closing
  // a dock/float/pop-out never closes it; only plugin dispose does.
  ctx.effect(() => {
    let disposed = false
    let browser: DeepSeekBrowser | null = null

    void createDeepSeekBrowser(browserProfileDirForCtx, (status) => {
      if (!disposed) store.setDeepSeekStatus(status)
    })
      .then((created) => {
        if (disposed) {
          void created.dispose()
          return
        }
        browser = created
        return created.check()
      })
      .catch((error: unknown) => {
        console.warn('[dsh-deepseek-companion] failed to start DeepSeek browser', error)
        if (!disposed) store.setDeepSeekStatus('error')
      })

    return () => {
      disposed = true
      if (browser !== null) void browser.dispose()
    }
  }, 'deepseek-companion: deepseek browser')

  ctx.effect(() => () => store.dispose(), 'deepseek-companion: state store')

  console.log('[dsh-deepseek-companion] loaded')
}

/**
 * Build an SSE-style streaming response that pushes the current state, then
 * every subsequent revision until the client disconnects. The `abort` signal
 * fires when the bridge notices the socket closed, so we can release the
 * subscription and close the stream.
 */
function createStateStream(store: CompanionStateStore, signal: AbortSignal): Response {
  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | null = null
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null

  const cleanup = () => {
    if (unsubscribe !== null) {
      unsubscribe()
      unsubscribe = null
    }
    if (controller !== null) {
      try {
        controller.close()
      } catch {
        // already closed
      }
      controller = null
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
      const push = (state: CompanionState) => {
        try {
          c.enqueue(encoder.encode(`data: ${JSON.stringify(state)}\n\n`))
        } catch {
          // stream already closed
        }
      }
      // subscribe replays the current state, then pushes every later revision
      unsubscribe = store.subscribe(push)
      if (signal.aborted) cleanup()
      else signal.addEventListener('abort', cleanup, { once: true })
    },
    cancel() {
      cleanup()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
  })
}
