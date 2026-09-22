import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import { createDeepSeekBrowser, type DeepSeekBrowser } from './host/browser.ts'
import { handleChatMessage } from './host/chat.ts'
import { handleDeepThinkRequest } from './host/deep-think.ts'
import { createPageGuard } from './host/guard.ts'
import { handleNewChatRequest } from './host/new-chat.ts'
import { browserProfileDir } from './host/paths.ts'
import { handleSearchRequest } from './host/search.ts'
import {
  createSessionSyncController,
  handleListSessionsRequest,
  handleSwitchChatRequest,
  type SessionLocation,
} from './host/sessions.ts'
import { handleStopRequest } from './host/stop.ts'
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
/** POST route to focus/reopen the DeepSeek login page (Phase 07B). */
const SHOW_PATH = '/api/deepseek-companion/browser/show'
/** POST route to send one chat message and await the final reply (Phase 07C). */
const CHAT_PATH = '/api/deepseek-companion/chat'
/** POST route to flip DeepSeek's Deep Think toggle (Phase 07G). */
const DEEP_THINK_PATH = '/api/deepseek-companion/deep-think'
/** POST route to flip DeepSeek's web-search toggle (Phase 07H). */
const SEARCH_PATH = '/api/deepseek-companion/search'
/** POST route to stop the in-flight DeepSeek generation (Phase 07J). */
const STOP_PATH = '/api/deepseek-companion/chat/stop'
/** POST route to start a new DeepSeek chat and reset the transcript (Phase 07L). */
const NEW_CHAT_PATH = '/api/deepseek-companion/chat/new'
/** GET route listing the sidebar's history sessions (Phase 08, read-only). */
const SESSIONS_PATH = '/api/deepseek-companion/chat/sessions'
/** POST route switching the current conversation (Phase 08). */
const SWITCH_PATH = '/api/deepseek-companion/chat/switch'

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

  // DeepSeek browser: a single persistent instance owned by the Host and shared
  // by every view. The `browser` reference lives in `apply` scope so the show
  // route below can reach it. Closing a dock/float/pop-out never closes it;
  // only plugin dispose does.
  let browser: DeepSeekBrowser | null = null

  // One page is shared by every route, so the Host arbitrates its use (Phase
  // 07L → 08): while a page operation (new chat / history switch) is in flight,
  // sends are refused and a second page operation is refused. Bookkeeping only
  // — no view renders it.
  const pageGuard = createPageGuard()

  // External session sync (Phase 08.1): when the USER navigates inside the
  // DeepSeek window itself, the Host pulls the page's transcript back into the
  // shared state. It reuses the SAME page guard, so a sync never runs next to a
  // send / new chat / switch.
  const sessionSync = createSessionSyncController({
    // The browser is created asynchronously; resolve it lazily.
    browser: () => browser,
    store,
    guard: pageGuard,
  })

  ctx.effect(() => {
    let disposed = false

    void createDeepSeekBrowser(
      browserProfileDirForCtx,
      (status) => {
        if (!disposed) store.setDeepSeekStatus(status)
      },
      // Composer switches are only ever mirrored from the real page
      // (Deep Think: Phase 07G, Search: Phase 07H).
      (state) => {
        if (!disposed) store.setDeepThinkState(state)
      },
      (state) => {
        if (!disposed) store.setSearchState(state)
      },
      // Session navigation inside the DeepSeek window itself (Phase 08.1).
      (location, info) => {
        if (!disposed) sessionSync.onLocation(location, info)
      },
    )
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
      if (browser !== null) {
        void browser.dispose()
        browser = null
      }
    }
  }, 'deepseek-companion: deepseek browser')

  // Manual login entry: focus or reopen the DeepSeek page. The browser object,
  // token, and cookies never leave the Host.
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: SHOW_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async () => {
          if (browser === null) return Response.json({ ok: false }, { status: 503 })
          try {
            await browser.showLogin()
            return Response.json({ ok: true })
          } catch (error) {
            console.warn('[dsh-deepseek-companion] failed to show DeepSeek login', error)
            return Response.json({ ok: false }, { status: 500 })
          }
        },
      }),
    'deepseek-companion: browser show route',
  )

  // Minimal text chat: the Host is the authoritative message source. It claims
  // the send slot, appends the user message, sends via the browser, then
  // appends the assistant reply — every change streams to all views.
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: CHAT_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          let message: string
          try {
            const body = (await request.json()) as { message?: unknown }
            message = typeof body?.message === 'string' ? body.message.trim() : ''
          } catch {
            return Response.json({ error: 'invalid request body' }, { status: 400 })
          }
          if (message === '') return Response.json({ error: 'message is empty' }, { status: 400 })
          if (browser === null) return Response.json({ error: 'browser not ready' }, { status: 503 })
          // Capture a non-null reference so the send closure below type-checks.
          const currentBrowser = browser
          // Delegate to the tested send flow (claims the slot, appends user,
          // sends, appends assistant, resets sending in `finally`).
          const result = await handleChatMessage(
            store,
            (text, onDelta, onReasoning, onCitations) =>
              currentBrowser.sendMessage(text, onDelta, onReasoning, onCitations),
            message,
            // Refused while a page operation (new chat / switch) owns the page.
            pageGuard,
          )
          if (result.status === 500) {
            console.warn('[dsh-deepseek-companion] failed to send chat message', result.body.error)
          }
          // The send no longer owns the page: a session switch that happened
          // WHILE it streamed can now be applied (Phase 08.1, latest wins).
          void sessionSync.drain()
          return Response.json(result.body, { status: result.status })
        },
      }),
    'deepseek-companion: chat route',
  )

  // Deep Think control (Phase 07G): flips the REAL DeepSeek composer toggle and
  // reports the page's true state back. Never optimistic — on failure the real
  // state is still read and written to the store.
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: DEEP_THINK_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          // Delegate to the tested flow: validates the body, refuses while busy,
          // clicks the real toggle and always writes back the page's real state.
          const body: unknown = await request.json().catch(() => null)
          const result = await handleDeepThinkRequest(store, browser, body)
          if (result.status === 500) {
            console.warn('[dsh-deepseek-companion] failed to set Deep Think', result.body.error)
          }
          return Response.json(result.body, { status: result.status })
        },
      }),
    'deepseek-companion: deep think route',
  )

  // Web-search control (Phase 07H): same contract as Deep Think — flips the REAL
  // DeepSeek composer toggle and reports the page's true state back. Both
  // switches are re-read after any change, so a page-side link between them can
  // never leave the Host mirror stale.
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: SEARCH_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          const body: unknown = await request.json().catch(() => null)
          const result = await handleSearchRequest(store, browser, body)
          if (result.status === 500) {
            console.warn('[dsh-deepseek-companion] failed to set Search', result.body.error)
          }
          return Response.json(result.body, { status: result.status })
        },
      }),
    'deepseek-companion: search route',
  )

  // Stop the in-flight generation (Phase 07J). Clicks DeepSeek's REAL stop
  // control; whatever partial reply/reasoning already streamed is kept by the
  // send flow, so no "stopped" assistant message is ever fabricated.
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: STOP_PATH,
        methods: ['POST'],
        // The stop request carries no payload, but the route table requires the
        // field; a buffered body is simply ignored.
        requestBody: 'buffered',
        fetch: async () => {
          const result = await handleStopRequest(store, browser)
          if (result.status !== 200) {
            console.warn('[dsh-deepseek-companion] stop request not applied:', result.status, result.body.error)
          }
          return Response.json(result.body, { status: result.status })
        },
      }),
    'deepseek-companion: stop route',
  )

  // New chat (Phase 07L): clicks DeepSeek's REAL sidebar control and only clears
  // the Host transcript once the page confirms the switch (page first, Host
  // second). Nothing here is optimistic — a failed page switch leaves every
  // Companion surface showing the conversation it still has.
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: NEW_CHAT_PATH,
        methods: ['POST'],
        // The request carries no payload, but the route table requires the
        // field; a buffered body is simply ignored.
        requestBody: 'buffered',
        fetch: async () => {
          const result = await handleNewChatRequest(store, browser, pageGuard)
          if (result.status === 200) {
            // The Host made this navigation itself: record where it landed, so
            // the watcher never syncs the same change a second time (08.1).
            sessionSync.markKnown({ kind: 'empty' })
          } else {
            console.warn('[dsh-deepseek-companion] new chat request not applied:', result.status, result.body.error)
          }
          void sessionSync.drain()
          return Response.json(result.body, { status: result.status })
        },
      }),
    'deepseek-companion: chat new route',
  )

  // History sessions (Phase 08): a read-only projection of the sidebar, and one
  // real click on a history link. The switch is confirmed on the page (pathname
  // + rebuilt message DOM) and only then does the Host replace its transcript —
  // a failed switch leaves every surface showing what it already had.
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: SESSIONS_PATH,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: async () => {
          const result = await handleListSessionsRequest(browser)
          if (result.status !== 200) {
            console.warn('[dsh-deepseek-companion] failed to list chat sessions:', result.body.error)
          }
          return Response.json(result.body, { status: result.status })
        },
      }),
    'deepseek-companion: chat sessions route',
  )

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: SWITCH_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          const body: unknown = await request.json().catch(() => null)
          const result = await handleSwitchChatRequest(store, browser, pageGuard, body)
          if (result.status === 200) {
            // The Host switched itself: record the destination so the watcher
            // never re-syncs it (Phase 08.1).
            const known = knownLocationFromSwitchBody(body)
            if (known !== null) sessionSync.markKnown(known)
          } else {
            console.warn('[dsh-deepseek-companion] chat switch not applied:', result.status, result.body.error)
          }
          void sessionSync.drain()
          return Response.json(result.body, { status: result.status })
        },
      }),
    'deepseek-companion: chat switch route',
  )

  ctx.effect(() => () => store.dispose(), 'deepseek-companion: state store')

  console.log('[dsh-deepseek-companion] loaded')
}

/**
 * The location a successful switch landed on, or `null` when the request body
 * carried no usable conversation id. Used only to record what the Host itself
 * already synced (Phase 08.1).
 */
function knownLocationFromSwitchBody(body: unknown): SessionLocation | null {
  const requested: { conversationId?: unknown } =
    body !== null && typeof body === 'object' ? (body as { conversationId?: unknown }) : {}
  return typeof requested.conversationId === 'string' && requested.conversationId !== ''
    ? { kind: 'session', id: requested.conversationId }
    : null
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
