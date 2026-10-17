import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import { handleAttachmentRequest } from './host/attachment-route.ts'
import { createAttachmentResources } from './host/attachment-resources.ts'
import { createDeepSeekBrowser, type DeepSeekBrowser } from './host/browser.ts'
import { handleChatMessage } from './host/chat.ts'
import { handleDeepThinkRequest } from './host/deep-think.ts'
import { createPageGuard } from './host/guard.ts'
import { handleNewChatRequest } from './host/new-chat.ts'
import { attachmentUploadDir, browserProfileDir } from './host/paths.ts'
import { createCommittedAnchorRegistry, readAndPlanReconcile } from './host/reconcile.ts'
import {
  recoverySessionVerdict,
  titleForRecoveredSession,
  type RecoverySettlement,
} from './host/recovery-settlement.ts'
import { handleSearchRequest } from './host/search.ts'
import { prepareAttachmentTransaction, readParentAnchor } from './host/send-attachments.ts'
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
/** POST route to add / remove one draft image (Phase 18A). */
const ATTACHMENT_PATH = '/api/deepseek-companion/chat/attachment'
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

  // Host-private attachment resources (Phase 18A): the temp files and the page
  // identities behind the composer's image draft. Only metadata ever reaches the
  // shared state — bytes, temp paths and page identities stay in the Host.
  const resources = createAttachmentResources({
    dir: attachmentUploadDir(process.env, ctx.baseUrl),
    store,
  })
  // The directory is Host-owned, so a previous abnormally-ended run may have left
  // temp files behind: empty it at startup (Phase 18A).
  void resources.prepare().catch((error: unknown) => {
    console.warn('[dsh-deepseek-companion] failed to prepare the attachment directory', error)
  })

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

  // Single readiness gate (Phase 20A): every page-touching route calls this
  // before doing browser work. `null` means the browser is (still) unavailable —
  // the route answers 503 and the recovery keeps running on its own.
  const readyBrowser = async (): Promise<DeepSeekBrowser | null> => {
    if (browser === null) return null
    const status = await browser.ensureReady()
    return status === 'error' ? null : browser
  }

  // One page is shared by every route, so the Host arbitrates its use (Phase
  // 07L → 08): while a page operation (new chat / history switch) is in flight,
  // sends are refused and a second page operation is refused. Bookkeeping only
  // — no view renders it.
  const pageGuard = createPageGuard()

  // Committed-turn anchors (Phase 20B1): Host-only bookkeeping for the LAST
  // committed send — the session id plus the completion request's
  // `parent_message_id`. Never part of the shared `ChatMessage` shape, and never
  // a message id itself: realtime only ever learns the parent anchor.
  const anchors = createCommittedAnchorRegistry()
  // Bumped whenever a reconcile starts: a plan built by an older round must
  // never be applied over a newer one (Phase 20B1 stale guard).
  let reconcileGeneration = 0

  // External session sync (Phase 08.1): when the USER navigates inside the
  // DeepSeek window itself, the Host pulls the page's transcript back into the
  // shared state. It reuses the SAME page guard, so a sync never runs next to a
  // send / new chat / switch.
  const sessionSync = createSessionSyncController({
    // The browser is created asynchronously; resolve it lazily.
    browser: () => browser,
    store,
    guard: pageGuard,
    // The page moved to another conversation by itself: its composer is gone, so
    // the draft tracked for it is dropped too (Phase 18A).
    onDraftInvalidated: () => resources.resetDraft(),
  })

  ctx.effect(() => {
    let disposed = false

    /**
     * Phase 20B1: reconcile the Host transcript against DeepSeek's own history
     * once a recovery settled on a logged-in session. It runs INSIDE the
     * `recovering` window (through `onSettled`), holds the page guard for its
     * whole duration, and is strictly best-effort: any failure keeps the Host
     * transcript untouched and still reports the recovery as successful.
     */
    const runReconcile = async (settlement: RecoverySettlement): Promise<void> => {
      if (disposed) return
      const verdict = recoverySessionVerdict(settlement)
      if (verdict === 'deleted' && settlement.target.kind === 'session') {
        if (store.applyDeletedSession(settlement.target.id)) anchors.clear()
        return
      }
      if (verdict === 'uncertain') {
        if (settlement.target.kind === 'session') store.markSessionUnverified(settlement.target.id)
        console.warn('[dsh-deepseek-companion] recovery location/history inconclusive; preserving Host transcript')
        return
      }
      if (verdict !== 'reconcile' || settlement.target.kind !== 'session') return
      const currentBrowser = browser
      if (currentBrowser === null) return
      const sessionId = settlement.target.id
      if (store.getState().currentSession.id !== sessionId) return
      store.clearSessionUnverified(sessionId)
      // The guard arbitrates the ONE page: a busy page is skipped, never fought over.
      if (!pageGuard.tryClaim()) return
      const generation = ++reconcileGeneration
      try {
        // Read → bounded stability wait → validate → plan (Phase 20B1, pure logic).
        const isFresh = (): boolean =>
          !disposed && generation === reconcileGeneration && store.getState().currentSession.id === sessionId
        try {
          const outcome = await readAndPlanReconcile({
            browser: currentBrowser,
            sessionId,
            hostMessages: store.getState().chat.messages,
            anchor: anchors.get(),
            isFresh,
          })
          if (outcome.kind === 'plan') {
            store.applyChatReconcile(outcome.patch)
            anchors.clear()
          } else console.warn('[dsh-deepseek-companion] reconcile skipped:', outcome.reason)
        } catch (error) {
          console.warn('[dsh-deepseek-companion] reconcile failed:', error)
        }
        // Title is a sidebar projection, never an identity input. A missing or
        // slow sidebar read cannot block the reconciled transcript.
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          const sessions = await Promise.race([
            currentBrowser.listSessions(),
            new Promise<null>((resolve) => {
              timer = setTimeout(() => resolve(null), 2_000)
            }),
          ])
          const title = sessions === null ? null : titleForRecoveredSession(sessions, sessionId)
          if (title !== null && isFresh()) {
            store.setCurrentSession({ id: sessionId, title })
          }
        } catch {
          // Title refresh is best-effort.
        } finally {
          if (timer !== undefined) clearTimeout(timer)
        }
      } finally {
        pageGuard.release()
      }
    }

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
      // The page was closed and a fresh one opened: nothing the old page's draft
      // was tied to exists any more (Phase 18A).
      () => {
        if (!disposed) void resources.resetDraft()
      },
      // Browser recovery (Phase 20A): drive `connection = recovering`, snapshot
      // the last-known session to reopen, and align `sessionSync.lastKnown` with
      // the page's real location once the rebuild settles.
      {
        onRecovering: (recovering) => {
          if (!disposed) store.setRecovering(recovering)
        },
        getRecoverTarget: () => {
          const session = store.getState().currentSession
          return session.id !== null ? ({ kind: 'session', id: session.id } as const) : ({ kind: 'empty' } as const)
        },
        onMarkKnown: (location) => {
          if (!disposed) sessionSync.markKnown(location)
        },
        // Phase 20B1: the last step of a successful recovery is reconciliation —
        // it runs while `connection` still reads `recovering`, so the UI is only
        // handed back once the transcript and the real page agree.
        onSettled: (settlement) => runReconcile(settlement),
      },
    )
      .then((created) => {
        if (disposed) {
          void created.dispose()
          return
        }
        browser = created
        // Phase 08.2: the unified connection needs to know the browser EXISTS —
        // the login probe below decides whether it is usable.
        store.setBrowserReady(true)
        return created.check()
      })
      .catch((error: unknown) => {
        console.warn('[dsh-deepseek-companion] failed to start DeepSeek browser', error)
        if (!disposed) {
          store.setBrowserReady(false)
          store.setDeepSeekStatus('error')
        }
      })

    return () => {
      disposed = true
      // A disposed Host must not leave a committed anchor behind: a stale one
      // could bind ids for a session this process no longer owns (Phase 20B1).
      anchors.clear()
      // The page is about to go away, taking its drafts with it (Phase 18A).
      // Fire-and-forget: teardown must not block on file I/O.
      void resources.resetDraft()
      if (browser !== null) {
        void browser.dispose()
        browser = null
      }
      store.setBrowserReady(false)
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
          const ready = await readyBrowser()
          if (ready === null) return Response.json({ ok: false }, { status: 503 })
          try {
            await ready.showLogin()
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
          // Phase 18A: a round may be images only (`prompt === ""` on the page),
          // but a round with neither text nor draft is still refused.
          const draft = store.getState().composer.attachments
          if (message === '' && draft.length === 0) {
            return Response.json({ error: 'message is empty' }, { status: 400 })
          }
          // Capture a non-null reference so the send closure below type-checks.
          // `ensureReady` returns immediately on the healthy hot path, and awaits
          // the single-flight recovery when the page needs it (Phase 20A).
          const currentBrowser = await readyBrowser()
          if (currentBrowser === null) return Response.json({ error: 'browser not ready' }, { status: 503 })
          if (store.getState().recoveryNotice === 'session_unverified') {
            return Response.json({ error: 'recovered session is unverified' }, { status: 409 })
          }

          // The image half of the round (Phase 18A). The identity comparison runs
          // for EVERY send — text-only included: a page draft this Host does not
          // manage makes the composer's real content unknowable, so the round is
          // refused before the page is touched (composer, records and temp files
          // all left untouched).
          if (draft.length > 0) {
            if (store.getState().chat.sending) {
              return Response.json({ error: 'chat is busy' }, { status: 409 })
            }
            if (pageGuard.inProgress()) {
              return Response.json({ error: 'page operation in progress' }, { status: 409 })
            }
          }
          const prepared = await prepareAttachmentTransaction({
            store,
            recordOf: (id) => resources.get(id),
            consume: (ids) => resources.consume(ids),
            listDraftIdentities: () => currentBrowser.listDraftIdentities(),
            onIntegrityError: (error) => {
              console.warn('[dsh-deepseek-companion] attachment integrity error:', error)
            },
          })
          if (!prepared.ok) {
            console.warn('[dsh-deepseek-companion] send refused:', prepared.error)
            return Response.json({ error: prepared.error }, { status: prepared.status })
          }
          const attachmentTransaction = prepared.transaction

          // Delegate to the tested send flow (claims the slot, appends user,
          // sends, appends assistant, resets sending in `finally`).
          const result = await handleChatMessage(
            store,
            (text, onDelta, onReasoning, onCitations, onSubmitted) =>
              currentBrowser.sendMessage(text, onDelta, onReasoning, onCitations, onSubmitted),
            message,
            // Refused while a page operation (new chat / switch) owns the page.
            pageGuard,
            // Phase 08.2: label the round `finished` or `interrupted` (stop /
            // external switch) — read after the send settled.
            () => currentBrowser.wasInterrupted(),
            attachmentTransaction,
            // Phase 20B1: record the committed parent anchor (Host-only) so a
            // later recovery can bind this turn's ids through the parent chain.
            // A payload without a usable anchor simply records nothing.
            (submitted, ids) => {
              const anchor = readParentAnchor(submitted)
              if (anchor === undefined) return
              anchors.record({
                sessionId: anchor.sessionId,
                parentMessageId: anchor.parentMessageId,
                userMessageId: ids.userMessageId,
                assistantMessageId: ids.assistantMessageId,
              })
            },
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

  // Draft images (Phase 18A): ONE route with an `action` discriminator (`add` /
  // `remove`). `add` validates the bytes itself (magic MIME, strict base64,
  // limits) and drives the REAL DeepSeek upload; `remove` deletes the page card
  // first and only then forgets the Host entry.
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: ATTACHMENT_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          const body: unknown = await request.json().catch(() => null)
          const ready = await readyBrowser()
          if (ready === null) return Response.json({ error: 'browser not ready' }, { status: 503 })
          const result = await handleAttachmentRequest({ store, resources, browser: ready, guard: pageGuard }, body)
          if (result.status >= 400) {
            console.warn('[dsh-deepseek-companion] attachment request not applied:', result.status, result.body.error)
          }
          return Response.json(result.body, { status: result.status })
        },
      }),
    'deepseek-companion: chat attachment route',
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
          const ready = await readyBrowser()
          if (ready === null) return Response.json({ error: 'browser not ready' }, { status: 503 })
          const result = await handleDeepThinkRequest(store, ready, body)
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
          const ready = await readyBrowser()
          if (ready === null) return Response.json({ error: 'browser not ready' }, { status: 503 })
          const result = await handleSearchRequest(store, ready, body)
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
          const ready = await readyBrowser()
          if (ready === null) return Response.json({ error: 'browser not ready' }, { status: 503 })
          const result = await handleNewChatRequest(store, ready, pageGuard)
          if (result.status === 200) {
            // The Host made this navigation itself: record where it landed, so
            // the watcher never syncs the same change a second time (08.1).
            sessionSync.markKnown({ kind: 'empty' })
            // The committed anchor belonged to the conversation that just went
            // away (Phase 20B1) — a new chat starts with no turn to bind.
            anchors.clear()
            // Phase 18A: a fresh conversation means a fresh composer — the old
            // draft (and its temp files) is dropped with the old transcript.
            await resources.resetDraft()
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
          const ready = await readyBrowser()
          if (ready === null) return Response.json({ error: 'browser not ready' }, { status: 503 })
          // The active sidebar entry also refreshes `currentSession` (title
          // included) — Phase 08.2.
          const result = await handleListSessionsRequest(ready, store)
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
          const ready = await readyBrowser()
          if (ready === null) return Response.json({ error: 'browser not ready' }, { status: 503 })
          const result = await handleSwitchChatRequest(store, ready, pageGuard, body)
          if (result.status === 200) {
            // The Host switched itself: record the destination so the watcher
            // never re-syncs it (Phase 08.1).
            const known = knownLocationFromSwitchBody(body)
            if (known !== null) sessionSync.markKnown(known)
            // The committed anchor described the conversation left behind
            // (Phase 20B1): it must never bind ids in the new one.
            anchors.clear()
            // Phase 18A: the composer belonged to the OLD conversation, so its
            // draft is dropped rather than carried into the new one.
            await resources.resetDraft()
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
