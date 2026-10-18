/**
 * DeepSeek web session browser (Phase 07A).
 *
 * The Host owns a single persistent Playwright browser context backed by the
 * plugin's own profile directory. It opens chat.deepseek.com and reports the
 * login state; a user can log in inside the visible window and the persisted
 * profile keeps that session across Host restarts. No messages are sent.
 *
 * Chromium comes from Playwright's own matched browser (via `npx playwright
 * install chromium`); when it is missing, `launchPersistentContext` throws a
 * clear "Executable doesn't exist" error and the caller maps it to `error`.
 * No automatic browser download, no shell install, no guessing old caches.
 */
import { readFile } from 'node:fs/promises'
import { chromium, type BrowserContext, type JSHandle, type Page } from 'playwright'
import type {
  AssistantReply,
  ChatFormat,
  ChatMessageInput,
  ChatSessionSummary,
  Citation,
  ComposerModeState,
  ComposerToggleState,
  DeepSeekStatus,
  DeepThinkState,
  SearchState,
} from '../shared/state.ts'
import {
  chooseFileInput,
  countPageInputsInPage,
  describeFileInputsInPage,
  diffDraftIdentities,
  findDraftCardInPage,
  findRemoveControlInPage,
  isDraftIdentity,
  normalizeUploadResponse,
  readDraftIdentitiesInPage,
  REMOVE_CONTROL_OFFSETS,
  type DraftIdentityDiff,
  type FileInputCandidate,
} from './draft-images.ts'
import { readCompletionSubmission, type CompletionSubmission } from './send-attachments.ts'
import { parseCitationGroups, readDomBlocks, resolveCitationsByBlock, type DomBlock } from './citations.ts'
import {
  DEEPSEEK_HISTORY_DB,
  DEEPSEEK_HISTORY_STORE,
  HISTORY_READ_TIMEOUT_MS,
  parseHistoryEntry,
  readHistoryEntryInPage,
  type HistorySnapshotTicket,
} from './history-idb.ts'
import { loginStatusFromCurrentUser } from './login.ts'
import {
  classifyHistoryResponse,
  matchesRecoveryHistoryRequest,
  type HistorySignal,
  type RecoverySettlement,
} from './recovery-settlement.ts'
import {
  buildTranscript,
  classifyDuringSend,
  conversationIdFromPath,
  needsSwitchChat,
  normalizeSessionsResult,
  normalizeSwitchOutcome,
  normalizeTranscript,
  pageLocalImagesReplaced,
  readSessionsInPage,
  readTranscriptInPage,
  sameLocation,
  scrollMessagesInPage,
  sessionLocationFromPath,
  switchChatInPage,
  switchChatReadyInPage,
  toSessionSummaries,
  transcriptNeedsBlocks,
  type ScrollMessagesOptions,
  type SendSessionState,
  type SessionLinkOptions,
  type SessionLocation,
  type SwitchChatOptions,
  type TranscriptOptions,
} from './sessions.ts'
import {
  newChatInPage,
  newChatReadyInPage,
  normalizeNewChatOutcome,
  type NewChatConfirmOptions,
  type NewChatOptions,
} from './new-chat.ts'
import { cleanupReasoningReader, installReasoningReader, readAndCleanupReasoning } from './reasoning.ts'
import {
  backoffForAttempt,
  classifyPageHealth,
  createRecoveryBudget,
  maxAttemptsFor,
  type PageHealth,
  type RecoveryBudget,
  type RecoveryLevel,
} from './recovery.ts'
import { cleanupReplyReader, installReplyReader, readAndCleanupReply } from './reply.ts'
import { decideStopAction, emptyReplyError } from './stop.ts'
import { createThrottle } from './throttle.ts'
import {
  composerToggleInPage,
  needsToggleClick,
  normalizeToggleState,
  TOGGLE_TARGET_KEY,
  type ComposerToggleOptions,
} from './toggle.ts'

const DEEPSEEK_URL = 'https://chat.deepseek.com'
/** DeepSeek's authoritative "current user" endpoint. */
const CURRENT_USER_PATH = '/api/v0/users/current'
/** Completion endpoint the SPA posts to when sending a message. */
const COMPLETION_PATH = '/api/v0/chat/completion'
/** Image upload endpoint the SPA posts to when a file is attached. */
const UPLOAD_PATH = '/api/v0/file/upload_file'
/** How long one send may take to produce its completion REQUEST / response. */
const COMPLETION_TIMEOUT = 60000
/** How long one page upload may take to answer (Phase 18A). */
const UPLOAD_TIMEOUT = 10000
/** How long the page may take to draw the preview card of a fresh upload. */
const DRAFT_PREVIEW_TIMEOUT = 3000
/** How long the removal control may take to appear once its card is hovered. */
const REMOVE_CONTROL_TIMEOUT = 3000
/** How long one draft removal may take to actually take effect. */
const REMOVE_SETTLE_TIMEOUT = 3000
/** The single chat input (a plain `textarea`, no stable id/role/aria). */
const INPUT_SELECTOR = 'textarea'
/** The page's only file input (hidden; image and document uploads share it). */
const FILE_INPUT_SELECTOR = 'input[type=file]'
/** The send button (DeepSeek's `ds-button--primary`). */
const SEND_BUTTON_SELECTOR = '.ds-button--primary'
/**
 * DeepSeek has no separate stop button: while a reply streams the SAME primary
 * composer button turns into the stop control (circular icon button, square
 * "stop" glyph instead of the send arrow). The glyph is the only streaming
 * signal that does not depend on the composer's text content, so it is what we
 * wait on to confirm the stop landed.
 */
const STOP_GLYPH_PREFIX = 'M2 4.88'
/**
 * How long to let the SPA leave the streaming state after a stop click. A
 * CONDITION wait (bounded), never a fixed sleep; on timeout we simply report
 * what the page shows.
 */
const STOP_SETTLE_TIMEOUT = 5000
/**
 * Phase 20B1 review: how long one frontend history refresh (a `reload()`) may take,
 * and how long the SPA is then given to write its own IDB entry. Measured on a real
 * page: the whole refresh+write settled well inside this (≈6 s end to end).
 */
const REFRESH_TIMEOUT_MS = 15000
const REFRESH_SETTLE_TIMEOUT = 8000
/** Primary assistant reply container (semantic class, Phase 07D-0). */
const REPLY_SELECTOR = '.ds-assistant-message-main-content'
/** Fallback when the semantic class is absent (older/renamed DOM). */
const REPLY_FALLBACK_SELECTOR = '.ds-markdown'
/**
 * How many `fiber.return` hops to scan for the raw Markdown prop. DeepSeek's
 * fiber layout is private, so we scan a bounded chain instead of hard-coding a
 * depth (Phase 07E).
 */
const MAX_FIBER_SCAN = 10
/** DeepSeek's reasoning ("Deep Think") container (Phase 07F). */
const REASONING_SELECTOR = '.ds-think-content'
/**
 * How long to wait for the NEW reply/reasoning node to appear after the
 * completion stream ended (Phase 07G hardening). This is a CONDITION wait, not
 * a fixed sleep; on timeout we simply read whatever the DOM currently holds.
 */
const NEW_NODE_TIMEOUT = 5000
/**
 * Composer switches (Phase 07G / 07H). DeepSeek's two toggles share every
 * stable attribute, so each one's label set does the disambiguation and the
 * other one is explicitly excluded. See `./toggle.ts` for the rules.
 */
const DEEP_THINK_OPTIONS: ComposerToggleOptions = {
  toggleSelector: '.ds-toggle-button',
  selectedClass: 'ds-toggle-button--selected',
  labels: ['深度思考', 'deepthink', 'deep think', 'deep thinking', 'thinking'],
  exclusions: ['智能搜索', 'search'],
}
const SEARCH_OPTIONS: ComposerToggleOptions = {
  toggleSelector: '.ds-toggle-button',
  selectedClass: 'ds-toggle-button--selected',
  labels: ['智能搜索', 'search', '联网搜索'],
  exclusions: ['深度思考', 'deepthink', 'deep think', 'deep thinking', 'thinking'],
}
/**
 * How long to let the SPA commit a composer-switch click before re-reading.
 * A CONDITION wait (the clicked switch must report the requested state), never
 * a fixed sleep; on timeout we still re-read and report the page's truth.
 */
const TOGGLE_SETTLE_TIMEOUT = 3000
/**
 * Upper bound for the out-of-band citation hydration (Phase 07I). DeepSeek
 * attaches the real source URLs a few seconds after the body finishes; this wait
 * runs AFTER the reply has been delivered, so a timeout only means "this reply
 * keeps plain [N] markers".
 */
const CITATION_HYDRATION_TIMEOUT = 8000
/**
 * DeepSeek's sidebar "new chat" control (Phase 07L). Located by its SEMANTIC
 * label — the English UI renders "New chat", Chinese builds use one of the
 * 新对话 variants — never by a hash class or by position. `/chat/s/` marks a
 * conversation-history link, which must never be mistaken for the control.
 */
const NEW_CHAT_OPTIONS: NewChatOptions = {
  labels: ['New chat', '开启新对话', '新对话', '新建对话', '开始新对话', 'New conversation'],
  maxAscend: 5,
  historyHrefMarker: '/chat/s/',
}
/** Message container: a freshly started chat keeps none of them. */
const MESSAGE_SELECTOR = '.ds-message'
/** Pathname of the empty-chat state; the conversation id is minted on first send. */
const NEW_CHAT_EMPTY_PATH = '/'
/**
 * How long to let the SPA commit the new chat before declaring failure. A
 * CONDITION wait (bounded), never a fixed sleep.
 */
const NEW_CHAT_CONFIRM_TIMEOUT = 5000
const NEW_CHAT_CONFIRM_OPTIONS: NewChatConfirmOptions = {
  messageSelector: MESSAGE_SELECTOR,
  emptyPath: NEW_CHAT_EMPTY_PATH,
}
/**
 * Sidebar history entries (Phase 08): plain anchors whose OWN href carries the
 * conversation id. The id is compared as a string — never interpolated into a
 * selector — and the title is never used as a key.
 */
const SESSION_LINK_SELECTOR = 'a[href*="/a/chat/s/"]'
const SESSION_HREF_MARKER = '/a/chat/s/'
const SESSION_OPTIONS: SessionLinkOptions = {
  linkSelector: SESSION_LINK_SELECTOR,
  hrefMarker: SESSION_HREF_MARKER,
}
/**
 * How long to let the SPA commit a history switch before declaring failure. A
 * CONDITION wait (bounded), never a fixed sleep.
 */
const SWITCH_CONFIRM_TIMEOUT = 8000
/**
 * After the switch is confirmed the SPA may still be filling the DOM in
 * (history fetch → render), so the message count must stop moving before the
 * transcript is read. Same bounded-condition style, no fixed sleep.
 */
const SWITCH_STABLE_TIMEOUT = 4000
const SWITCH_STABLE_INTERVAL = 350
/** A freshly sent image may remain a page-local blob until DeepSeek reloads its history. */
const HISTORY_IMAGE_REFRESH_BUDGET = REFRESH_TIMEOUT_MS + REFRESH_SETTLE_TIMEOUT
const TRANSCRIPT_OPTIONS: TranscriptOptions = {
  messageSelector: MESSAGE_SELECTOR,
  replySelector: REPLY_SELECTOR,
  replyFallback: REPLY_FALLBACK_SELECTOR,
  reasoningSelector: REASONING_SELECTOR,
  maxFiberScan: MAX_FIBER_SCAN,
}
/** How to find the chat's real scroller when filling the virtual list. */
const SCROLL_OPTIONS: ScrollMessagesOptions = { messageSelector: MESSAGE_SELECTOR }
/**
 * Bounded rounds used to make the virtual list render the whole history. One
 * round is enough today (verified 5 → 16 nodes); the loop only exists so a
 * future step-wise renderer still converges.
 */
const HISTORY_FILL_ROUNDS = 3

/** Coerce a value arriving from the page into a trusted `AssistantReply`. */
function normalizeReply(value: unknown): AssistantReply {
  const raw: { content?: unknown; format?: unknown } =
    value !== null && typeof value === 'object' ? (value as { content?: unknown; format?: unknown }) : {}
  const format: ChatFormat = raw.format === 'markdown' ? 'markdown' : 'text'
  return { content: typeof raw.content === 'string' ? raw.content : '', format }
}

/**
 * Whether a completion call (request or response) is DeepSeek's own send call.
 * The REQUEST side of this predicate is the Phase 18A commit point: the moment
 * `POST /api/v0/chat/completion` leaves the page, the round is submitted.
 */
function isCompletionCall(call: { method(): string; url(): string }): boolean {
  if (call.method() !== 'POST') return false
  try {
    return new URL(call.url()).pathname === COMPLETION_PATH
  } catch {
    return false
  }
}

/**
 * One failed attach attempt: keep the card identity whenever the page's preview
 * diff was clean, so a failed upload can still be removed precisely later
 * (Phase 18A). An unclean diff keeps nothing — an identity that cannot be tied
 * to this upload must never be recorded.
 */
function failedAttach(diff: DraftIdentityDiff, error: string): AttachImageResult {
  return diff.ok ? { ok: false, error, previewIdentity: diff.identity } : { ok: false, error }
}

/** Message of an unknown thrown value. */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Coerce a page-provided point into `{ x, y }`, or `null` when it is unusable. */
function asPoint(value: unknown): { x: number; y: number } | null {
  if (value === null || typeof value !== 'object') return null
  const raw = value as { found?: unknown; x?: unknown; y?: unknown }
  if (raw.found !== true) return null
  if (typeof raw.x !== 'number' || typeof raw.y !== 'number') return null
  if (!Number.isFinite(raw.x) || !Number.isFinite(raw.y)) return null
  return { x: raw.x, y: raw.y }
}

/** What one `attachImage` attempt did (Phase 18A). */
export type AttachImageResult =
  | { ok: true; previewIdentity: string; deepSeekFileId: string }
  | {
      ok: false
      error: string
      /** Present when the page DID draw a card for the failed upload. */
      previewIdentity?: string
    }

export interface DeepSeekBrowser {
  /** Run one initial check now (then re-checks automatically on navigation). */
  check(): Promise<DeepSeekStatus>
  /**
   * Single entry point every page operation calls first (Phase 20A): returns
   * immediately (zero cost) when the page is healthy, otherwise runs the
   * single-flight recovery and resolves with the page's real status once it
   * settles. Never starts more than one recovery, and never auto-resends.
   */
  ensureReady(): Promise<DeepSeekStatus>
  /**
   * Read one session's authoritative history from DeepSeek's OWN IndexedDB cache
   * (Phase 20B1). Read-only and bounded; the ticket also carries the page epoch
   * the read belonged to, so the caller can refuse to apply a stale snapshot.
   */
  readHistorySnapshot(sessionId: string, budgetMs?: number): Promise<HistorySnapshotTicket>
  /**
   * Ask the page to re-fetch its OWN history (Phase 20B1 review): one bounded
   * `reload()`, after which the SPA writes a fresh `MERGE`/`REPLACE` into its own
   * IndexedDB entry. Never deletes the DB, never calls the history API, never
   * reads tokens/cookies, and never looks like a user navigation.
   */
  refreshHistoryView(budgetMs?: number): Promise<void>
  /** Focus the live DeepSeek page, reopening the sign-in page if it was closed. */
  showLogin(): Promise<void>
  /** Read DeepSeek's REAL Deep Think toggle state (Phase 07G). */
  getDeepThinkState(): Promise<DeepThinkState>
  /**
   * Click the real Deep Think toggle toward `enabled`, then re-read the page so
   * the returned state is always the page's truth (never optimistic).
   */
  setDeepThinkEnabled(enabled: boolean): Promise<DeepThinkState>
  /** Read DeepSeek's REAL web-search toggle state (Phase 07H). */
  getSearchState(): Promise<SearchState>
  /** Click the real web-search toggle toward `enabled` and re-read the page. */
  setSearchEnabled(enabled: boolean): Promise<SearchState>
  /**
   * Read BOTH composer switches from the same page state (Phase 07H). Used
   * before every send and after every switch, so a link between them (present or
   * future) is always reflected in the Host mirror.
   */
  getComposerModeState(): Promise<ComposerModeState>
  /**
   * Stop the in-flight generation by clicking DeepSeek's REAL stop control.
   * Resolves `true` when a stop was requested (or had already been requested for
   * this send — the call is idempotent), `false` when there was nothing to stop
   * or the control was missing. The partial reply/reasoning already received is
   * kept — see `sendMessage`.
   */
  stopGeneration(): Promise<boolean>
  /**
   * Whether the send that ended LAST was interrupted on purpose (Phase 08.2):
   * the user stopped it, or the page left the conversation mid-stream. Read
   * straight after `sendMessage` settled — it is what separates a normal
   * completion (`finished`) from an `interrupted` message. The flags themselves
   * stay per-send internal; this is a read-only projection of the round that
   * just ended.
   */
  wasInterrupted(): boolean
  /**
   * Every image-draft preview the page currently shows (`img[src^="blob:"]`,
   * DOM order). Read-only — the Host compares this set with its own draft
   * before every send, so it can never send a draft it does not manage
   * (Phase 18A).
   */
  listDraftIdentities(): Promise<string[]>
  /**
   * Drive DeepSeek's REAL hidden file input for ONE image and report the page
   * blob identity of the draft card it produced, plus DeepSeek's own file id
   * (Phase 18A). Success means "DeepSeek accepted the upload" — never "the
   * audit finished" (`status: "PENDING"` is a normal answer).
   *
   * On failure `previewIdentity` is still returned whenever a card DID appear
   * (the page draws one even for a failed upload), so the failed draft can be
   * removed precisely later; when no card appeared the field is absent.
   */
  attachImage(input: { path: string; fileName: string; mimeType: string; bytes: number }): Promise<AttachImageResult>
  /**
   * Remove ONE draft card from the page (Phase 18A): locate it by
   * `previewIdentity`, hover it, click ITS OWN removal control, then confirm the
   * target identity is gone AND every other identity survived. `false` means
   * nothing was changed for sure — a missing identity, a missing control or a
   * stray SVG is a SAFE failure, never a fuzzy guess.
   */
  removeDraftAttachment(input: { previewIdentity: string }): Promise<boolean>
  /**
   * Start a NEW DeepSeek conversation by clicking the REAL sidebar control, then
   * confirm the SPA actually switched (empty-chat pathname + no message DOM
   * left) and re-mirror the composer switches. Resolves only on that
   * confirmation; throws when the control is missing/ambiguous or the switch
   * never happened, so the Host can never clear its transcript while the page
   * still shows the old conversation. The page is reused — no new tab.
   */
  newChat(): Promise<void>
  /**
   * Read the sidebar's history entries (Phase 08). Read-only projection:
   * `{ id, title, active }`, where `active` is computed from the page's own
   * pathname — never from a styling class.
   */
  listSessions(): Promise<ChatSessionSummary[]>
  /**
   * Open a history conversation by id (Phase 08). When that conversation is
   * already on screen this resolves WITHOUT clicking. Otherwise exactly one
   * native click lands on the matching sidebar link, and the call only resolves
   * after a bounded confirmation (pathname is that id AND the previous message
   * DOM is gone). Throws when the entry is missing/duplicated or the switch
   * never completed — the Host transcript is then left untouched.
   */
  switchChat(conversationId: string): Promise<void>
  /**
   * Rebuild the transcript the page is currently showing (Phase 08): DOM order,
   * roles decided by structure, assistant content from the raw Markdown props
   * (rendered-text fallback), reasoning from its own container, citations via
   * the strict block rule. Only plain data leaves the page.
   */
  readTranscript(): Promise<ChatMessageInput[]>
  /**
   * Send one message and resolve with the final complete reply. `onDelta` fires
   * with the growing reply while DeepSeek is still generating — the raw Markdown
   * DeepSeek keeps in its React props when available, otherwise the rendered
   * plain text. `onReasoning` fires independently with DeepSeek's "Deep Think"
   * text and is simply never called when Deep Think produced none. Only
   * `{ content, format }` ever leaves the page context; no token, cookie, HTML
   * or React object crosses the boundary.
   */
  sendMessage(
    text: string,
    onDelta: (reply: AssistantReply) => void,
    onReasoning: (reply: AssistantReply) => void,
    /**
     * Optional, best-effort: called LATER (never before `sendMessage` resolves)
     * when DeepSeek hydrated real URLs onto this reply's citation badges. It may
     * never be called at all — the reply is already complete either way.
     */
    onCitations?: (citations: Citation[]) => void,
    /**
     * The commit point (Phase 18A): called EXACTLY ONCE, the moment the
     * completion REQUEST was observed leaving the page — before the response is
     * awaited. The payload is read from that very request, so an image send can
     * prove which files the round really referenced. After this call the round is
     * submitted: a later failure (response timeout, HTTP error, stop, external
     * switch, payload mismatch) is POST-submit and never restores the draft.
     */
    onSubmitted?: (submitted: CompletionSubmission) => void | Promise<void>,
  ): Promise<AssistantReply>
  dispose(): Promise<void>
}

/**
 * Detect login state by calling DeepSeek's own "current user" API inside the
 * page, reusing the session token the SPA stores in `localStorage.userToken`
 * (sent as `Authorization: Bearer <token>`, exactly like the SPA does). The
 * server is still the source of truth: it returns a user id when logged in and
 * a non-zero `code` (Missing Token) when logged out. The token is read, used,
 * and discarded entirely inside the browser page — only the minimal `{ code,
 * id }` signal is returned to the Host.
 */
async function detectStatus(page: Page): Promise<DeepSeekStatus> {
  try {
    const signal: unknown = await page.evaluate(async (path) => {
      let token: string | null = null
      try {
        const raw = localStorage.getItem('userToken')
        const parsed = JSON.parse(raw ?? '{}') as { value?: unknown }
        token = typeof parsed.value === 'string' && parsed.value.length > 0 ? parsed.value : null
      } catch {
        token = null
      }
      const headers: Record<string, string> = token !== null ? { Authorization: `Bearer ${token}` } : {}
      const res = await fetch(path, { credentials: 'include', headers })
      const json: unknown = await res.json()
      // Keep the token inside the page context: return only the minimal signal.
      const body = json as { code?: unknown; data?: { biz_data?: { id?: unknown } | null } | null }
      return { code: body.code, id: body.data?.biz_data?.id ?? null }
    }, CURRENT_USER_PATH)
    return loginStatusFromCurrentUser(signal)
  } catch {
    return 'error'
  }
}

/**
 * Host callbacks the recovery engine (Phase 20A) needs. All optional so existing
 * callers keep working; the Host wires the three it owns.
 */
export interface RecoveryCallbacks {
  /** Recovery entered / left the in-flight state → drive `connection = recovering`. */
  onRecovering?: (recovering: boolean) => void
  /** Snapshot of the last-known current session to reopen after a rebuild. */
  getRecoverTarget?: () => SessionLocation
  /** Align `sessionSync.lastKnown` with the page's real location after recovery. */
  onMarkKnown?: (location: SessionLocation) => void
  /**
   * The recovery reached a final verdict (Phase 20B1). Runs INSIDE the
   * `recovering` window — `connection` stays `recovering` until this resolves —
   * so the Host can reconcile the transcript BEFORE the UI is handed back. A
   * rejection is swallowed: reconciliation is best-effort and can never turn a
   * successful recovery into a failure.
   */
  onSettled?: (result: RecoverySettlement) => Promise<void> | void
  /**
   * Diagnostics only (Phase 20A fault injection / debugging): getters for the
   * live page and context, so a test harness can trigger `page.close()` / crash /
   * kill. Routes never touch this — it is not part of the feature surface.
   */
  onDiagnostics?: (diagnostics: { getPage: () => Page; getContext: () => BrowserContext }) => void
}

export async function createDeepSeekBrowser(
  profileDir: string,
  onStatus: (status: DeepSeekStatus) => void,
  onDeepThink?: (state: DeepThinkState) => void,
  onSearch?: (state: SearchState) => void,
  /**
   * Every main-frame navigation inside DeepSeek, as a three-state location
   * (Phase 08.1). `createdBySend` marks the session DeepSeek created for the
   * in-flight send — the Host records it and never re-reads that transcript.
   */
  onSessionLocation?: (location: SessionLocation, info: { createdBySend: boolean }) => void,
  /**
   * A page that carries composer drafts was REPLACED (Phase 18A): the old page
   * was closed and a fresh one was opened. Everything the Host tracked about the
   * old page's draft (temp files, page identities) is stale from that moment on —
   * the caller drops it instead of trying to migrate it.
   */
  onPageReplaced?: () => void,
  recovery: RecoveryCallbacks = {},
): Promise<DeepSeekBrowser> {
  // Playwright resolves its own matched Chromium via `chromium.executablePath()`;
  // a missing browser surfaces as a clear launch error (mapped to `error`).
  let context: BrowserContext = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: { width: 1280, height: 800 },
  })

  let page: Page = context.pages()[0] ?? (await context.newPage())

  // Diagnostics only (fault injection): getters, not raw objects, so a rebuild's
  // fresh page/context stay reachable through the same handles.
  recovery.onDiagnostics?.({ getPage: () => page, getContext: () => context })

  // --- Phase 20A recovery state -----------------------------------------------
  // `disposed` is declared up here so every lifecycle listener and the recovery
  // engine can read it; `pageEpoch` / `browserEpoch` are the stale-event fences.
  let disposed = false
  /** +1 whenever the page is replaced (Level 1 or Level 3) — fences old-page events. */
  let pageEpoch = 0
  /** +1 on every Level 3 rebuild — fences old-context/browser events. */
  let browserEpoch = 0
  /** Set by `page.on('crash')`; a crashed page reports `isClosed() === false`. */
  let crashed = false
  /** This page was confirmed healthy and nothing invalidated it since (§5). */
  let knownHealthy = false
  /** Recovery's own navigation is in flight — the watcher must not sync it (§10.1). */
  let recoveryNavigationActive = false
  /** Only the current recovery attempt's frontend requests can prove deletion. */
  let recoveryTarget: SessionLocation | null = null
  let historySignals: Promise<HistorySignal>[] = []
  let settledLocation: SessionLocation = { kind: 'other' }
  /** Single-flight recovery promise; non-null while a recovery is executing (§6). */
  let recoveryPromise: Promise<DeepSeekStatus> | null = null
  /** A failure arrived WHILE recovering — handled after the current round (§6). */
  let pendingRecovery = false
  /** Every page already mounted, so a page object is never double-wired (§8). */
  const mountedPages = new WeakSet<Page>()

  // Re-entrancy guard: `detectStatus()` itself fetches `/users/current`, which
  // fires the `response` listener below. The flag prevents a
  // response -> detect -> response loop, with no timer and no polling.
  let detecting = false

  const runDetect = async (): Promise<DeepSeekStatus> => {
    if (detecting) return 'checking'
    detecting = true
    try {
      const status = await detectStatus(page)
      // A successful login probe on DeepSeek's home page is the cheapest healthy
      // confirmation: the page loaded a usable conversation surface.
      if (status === 'logged_in') {
        try {
          const url = page.url()
          if (url.startsWith(DEEPSEEK_URL) && !url.includes('/sign_in')) knownHealthy = true
        } catch {
          // a page that cannot report its URL is not healthy
        }
      }
      onStatus(status)
      return status
    } finally {
      detecting = false
    }
  }

  // Composer switches — Deep Think (Phase 07G) and Search (Phase 07H). The Host
  // mirrors the page's REAL state: a switch is only ever changed by clicking the
  // real DeepSeek UI, and every read is a fresh read of the page (never cached,
  // never optimistic). No polling — we re-read at the few moments where the
  // state can actually change.
  const readToggle = async (options: ComposerToggleOptions): Promise<ComposerToggleState> => {
    try {
      return normalizeToggleState(await page.evaluate(composerToggleInPage, { options, action: 'read' as const }))
    } catch {
      return { available: false, enabled: false }
    }
  }

  /**
   * Click the real switch toward `enabled`, then wait for the page to report the
   * requested state. Already in the requested state → no click at all; switch
   * missing → the page state (`available: false`) is returned untouched. The
   * result is always the page's truth, so a failed click simply reports what is
   * really there.
   */
  const setToggle = async (options: ComposerToggleOptions, enabled: boolean): Promise<ComposerToggleState> => {
    const before = await readToggle(options)
    if (!needsToggleClick(before, enabled)) return before
    try {
      await page.evaluate(composerToggleInPage, { options, action: 'click' as const })
    } catch {
      // ignored — the re-read below reports the page's real state
    }
    // Condition wait, owned and bounded by Playwright: the switch we just
    // clicked must report the requested state. Never a fixed sleep — the `click`
    // action records the element on the page global, so the locating rules are
    // not duplicated here. A timeout is not fatal: we re-read below.
    await page
      .waitForFunction(
        (payload: { key: string; enabled: boolean; selectedClass: string }) => {
          const el = (window as unknown as Record<string, unknown>)[payload.key]
          if (el === null || el === undefined) return false
          const node = el as { getAttribute?: (name: string) => string | null; className?: unknown }
          const pressed = typeof node.getAttribute === 'function' ? node.getAttribute('aria-pressed') : null
          if (pressed !== null) return pressed === (payload.enabled ? 'true' : 'false')
          const on = typeof node.className === 'string' && node.className.includes(payload.selectedClass)
          return on === payload.enabled
        },
        { key: TOGGLE_TARGET_KEY, enabled, selectedClass: options.selectedClass },
        { timeout: TOGGLE_SETTLE_TIMEOUT },
      )
      .catch(() => {
        // fall through — the re-read below reports the page's real state
      })
    const after = await readToggle(options)
    await page
      .evaluate((key: string) => {
        delete (window as unknown as Record<string, unknown>)[key]
      }, TOGGLE_TARGET_KEY)
      .catch(() => {})
    return after
  }

  const readComposerMode = async (): Promise<ComposerModeState> => {
    const [deepThink, search] = await Promise.all([readToggle(DEEP_THINK_OPTIONS), readToggle(SEARCH_OPTIONS)])
    return { deepThink, search }
  }

  /**
   * Re-read BOTH switches and mirror them. DeepSeek may link the two (now or
   * later), so the Host never updates one without the other.
   */
  const syncComposerMode = async (): Promise<ComposerModeState> => {
    const mode = await readComposerMode()
    onDeepThink?.(mode.deepThink)
    onSearch?.(mode.search)
    return mode
  }

  // Wire every page-level trigger once per page object (Phase 08 + 20A). A page
  // is mounted exactly once (`WeakSet`), so repeated recovery can never stack
  // duplicate listeners; every callback first checks `disposed` and the epoch it
  // was mounted under, so a stale page can never forward state after a rebuild.
  const mountPage = (target: Page): void => {
    if (mountedPages.has(target)) return
    mountedPages.add(target)
    const myEpoch = pageEpoch

    target.on('load', () => {
      if (disposed || myEpoch !== pageEpoch) return
      void runDetect()
      // A full load can rebuild the composer: mirror both switches' real state.
      void syncComposerMode()
    })
    target.on('response', (response) => {
      if (disposed || myEpoch !== pageEpoch) return
      if (recoveryNavigationActive && recoveryTarget?.kind === 'session') {
        if (matchesRecoveryHistoryRequest(response.url(), recoveryTarget.id, response.request().method())) {
          // Observe the frontend's OWN request. Never make a Host request or
          // expose its body, cookies, or headers outside this classifier.
          historySignals.push(
            response
              .json()
              .then((body: unknown) => classifyHistoryResponse(response.status(), body))
              .catch(() => 'unknown'),
          )
        }
      }
      if (!response.url().includes(CURRENT_USER_PATH)) return
      void runDetect()
    })
    target.on('framenavigated', (frame) => {
      if (disposed || myEpoch !== pageEpoch) return
      if (frame !== target.mainFrame()) return
      // Recovery's own goto must never look like a user switch (§10.1).
      if (recoveryNavigationActive) return
      handleLocationNavigation(sessionLocationFromPath(frame.url()))
    })
    target.on('close', () => {
      if (disposed || myEpoch !== pageEpoch) return
      // The live page closed underneath us (external close) → recover.
      void triggerRecovery('page-closed')
    })
    target.on('crash', () => {
      if (disposed || myEpoch !== pageEpoch) return
      crashed = true
      knownHealthy = false
      void triggerRecovery('page-crashed')
    })
  }

  // Bridge from the page's MutationObserver back to the Host. Registered on the
  // CONTEXT — once at launch and again after every Level 3 rebuild (a NEW
  // context does NOT inherit the old one's functions, verified by fault
  // injection). `current*Receiver` is the per-send target; recovery nulls them
  // so a stale send can never write into a rebuilt page's assistant message.
  let currentDeltaReceiver: ((reply: AssistantReply) => void) | null = null
  let currentReasoningReceiver: ((reply: AssistantReply) => void) | null = null

  const installBridges = async (): Promise<void> => {
    await context.exposeFunction('__onReplyDelta', (reply: unknown) => {
      currentDeltaReceiver?.(normalizeReply(reply))
    })
    await context.exposeFunction('__onReasoningDelta', (reply: unknown) => {
      currentReasoningReceiver?.(normalizeReply(reply))
    })
  }

  await installBridges()

  const check = async (): Promise<DeepSeekStatus> => {
    try {
      await page.goto(DEEPSEEK_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
      const status = await runDetect()
      // Initial sync: mirror the composer's real switch states.
      await syncComposerMode()
      return status
    } catch {
      onStatus('error')
      return 'error'
    }
  }

  // Show the DeepSeek page for manual login. Reuse the live page and navigate it
  // to the sign-in route, then focus it; only when it was closed do we open a
  // fresh page and re-attach detection first. Never spawns a second browser
  // context or page. DeepSeek may redirect /sign_in back to the home page when
  // a session already exists — that is normal site behavior (a redirect is not
  // a `goto` failure). Errors here propagate to the Host show route, which maps
  // them to a 500 response.
  const showLogin = async (): Promise<void> => {
    if (page.isClosed()) {
      pageEpoch += 1
      page = await context.newPage()
      mountPage(page)
      // The previous page is gone — its draft cards went with it (Phase 18A).
      onPageReplaced?.()
      // A fresh page has not been confirmed healthy yet (§5).
      knownHealthy = false
      crashed = false
    }
    await page.goto(`${DEEPSEEK_URL}/sign_in`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.bringToFront()
    // Never carry the previous page's switch states over: report what the new
    // page actually shows (the sign-in route has no composer → unavailable).
    await syncComposerMode()
  }

  /**
   * Flip one switch, then mirror BOTH. DeepSeek currently keeps Deep Think and
   * Search independent (all four combinations verified in Phase 07H), but the
   * Host never assumes it: after any change it re-reads the page and reports the
   * truth for both.
   */
  const setDeepThinkEnabled = async (enabled: boolean): Promise<DeepThinkState> => {
    await setToggle(DEEP_THINK_OPTIONS, enabled)
    return (await syncComposerMode()).deepThink
  }

  const setSearchEnabled = async (enabled: boolean): Promise<SearchState> => {
    await setToggle(SEARCH_OPTIONS, enabled)
    return (await syncComposerMode()).search
  }

  // Single-flight guard: only one in-flight send at a time (no per-message
  // session isolation in this phase).
  let sending = false
  /**
   * Set when the user asked to stop THIS send (Phase 07J). DeepSeek ends the
   * completion normally in that case, so the only thing it changes is that an
   * empty final reply is expected rather than an error.
   */
  let stopRequested = false
  /**
   * Set when the page moved to ANOTHER conversation while this send was
   * streaming (Phase 08.1). Kept strictly separate from `stopRequested`: nobody
   * asked to stop — the page simply left. It detaches both delta receivers and
   * makes the final read use the last received frame instead of the page.
   */
  let sessionInterrupted = false
  /**
   * Read-only projection of the round that just ended (Phase 08.2): `true` when
   * that send was stopped or left behind. Kept AFTER the per-send flags reset so
   * the Host can ask "was this round interrupted?" the moment `sendMessage`
   * settles — see `wasInterrupted()`.
   */
  let lastSendInterrupted = false
  /** The conversation this in-flight send writes into (`null` while at `/`). */
  let sendSession: SendSessionState | null = null
  /** Last location handed to the Host (de-duplicates repeated navigations). */
  let lastForwardedLocation: SessionLocation | undefined

  /**
   * One main-frame navigation inside DeepSeek (Phase 08.1).
   *
   * `page.on('framenavigated')` fires for the SPA's `history.pushState` as well
   * (verified in Phase 08.1), so this is the only signal needed — no polling,
   * no history patching, no fiber/hash-class reading. The conversation id comes
   * from the URL path alone.
   *
   * While a send streams, the meaning of the navigation is decided FIRST: a
   * session DeepSeek created for THIS send is accepted (its id becomes the
   * send's session), while a switch to ANOTHER conversation detaches both delta
   * receivers immediately, so nothing from the new conversation can reach the
   * in-flight assistant message. The Host is then told about the location —
   * with `createdBySend`, so its sync controller records it instead of
   * re-reading a transcript the running send already owns.
   */
  const handleLocationNavigation = (location: SessionLocation): void => {
    let createdBySend = false
    if (sending && sendSession !== null) {
      const verdict = classifyDuringSend(sendSession, location)
      if (verdict === 'accept-created') {
        createdBySend = true
        if (location.kind === 'session') sendSession = { ...sendSession, currentId: location.id }
      } else if (verdict === 'external') {
        // The page left this conversation: stop feeding the in-flight assistant
        // and never read the new conversation on its behalf. The send keeps
        // whatever it already received; DeepSeek's own Stop is NOT clicked.
        sessionInterrupted = true
        currentDeltaReceiver = null
        currentReasoningReceiver = null
      }
    }
    if (lastForwardedLocation !== undefined && sameLocation(location, lastForwardedLocation)) return
    lastForwardedLocation = location
    onSessionLocation?.(location, { createdBySend })
  }

  // --- Phase 20A recovery engine (§4–§12) --------------------------------------

  type RecoveryReason = 'page-closed' | 'page-crashed' | 'context-closed' | 'browser-disconnected'

  /** Whether a thrown Playwright error means the context/browser died (→ Level 3). */
  const isTargetClosedError = (error: unknown): boolean => {
    const message = error instanceof Error ? error.message : String(error)
    return /target closed|targetclosed|has been closed|page crashed|target crashed/i.test(message)
  }

  /** Bound a promise by `ms`; a zero/negative budget rejects immediately. */
  const bound = <T>(promise: Promise<T>, ms: number): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      if (ms <= 0) {
        reject(new Error('recovery step budget exhausted'))
        return
      }
      const timer = setTimeout(() => reject(new Error('recovery step timed out')), ms)
      promise.then(
        (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        (error) => {
          clearTimeout(timer)
          reject(error)
        },
      )
    })

  /** Synchronous health snapshot — zero DOM work (design §5 hot path). */
  const syncHealth = (): PageHealth => {
    let connected = true
    try {
      connected = context.browser()?.isConnected() ?? false
    } catch {
      connected = false
    }
    let originOk = false
    let signIn = false
    try {
      const url = page.url()
      originOk = url.startsWith(DEEPSEEK_URL)
      signIn = url.includes('/sign_in')
    } catch {
      // a page that cannot report its URL is handled by `pageClosed`/`crashed`
    }
    return classifyPageHealth({
      connected,
      pageClosed: page.isClosed(),
      crashed,
      originOk,
      signIn,
      knownHealthy,
    })
  }

  /** Navigate the fresh page to the recover target, then report its REAL location. */
  const gotoRecoverTarget = async (target: SessionLocation, budget: RecoveryBudget): Promise<SessionLocation> => {
    const url = target.kind === 'session' ? `${DEEPSEEK_URL}/a/chat/s/${target.id}` : DEEPSEEK_URL
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: budget.effectiveTimeout('goto') })
    const settleMs = budget.effectiveTimeoutMs(15_000)
    if (settleMs > 0) await page.waitForLoadState('networkidle', { timeout: settleMs }).catch(() => {})
    return sessionLocationFromPath(page.url())
  }

  const detectWithBudget = async (budget: RecoveryBudget): Promise<DeepSeekStatus> =>
    bound(detectStatus(page), budget.effectiveTimeout('loginDetection')).catch(() => 'error')

  /** Bounded composer readiness: the page must expose a chat input to be usable. */
  const composerReady = async (budget: RecoveryBudget): Promise<boolean> =>
    page
      .waitForSelector(INPUT_SELECTOR, { timeout: budget.effectiveTimeout('composerReadiness') })
      .then(() => true)
      .catch(() => false)

  const settleAfterRebuild = async (
    status: DeepSeekStatus,
    location: SessionLocation,
    budget: RecoveryBudget,
  ): Promise<DeepSeekStatus> => {
    settledLocation = location
    recovery.onMarkKnown?.(location)
    crashed = false
    knownHealthy = status === 'logged_in' && location.kind !== 'other' && (await composerReady(budget))
    return status
  }

  /** Level 1: replace the dead/invalid page, keep the context/browser (§9). */
  const rebuildPage = async (target: SessionLocation, budget: RecoveryBudget): Promise<DeepSeekStatus> => {
    pageEpoch += 1
    currentDeltaReceiver = null
    currentReasoningReceiver = null
    onPageReplaced?.()
    await bound(
      page.close().catch(() => {}),
      budget.effectiveTimeout('closeQuietly'),
    ).catch(() => {})
    page = await bound(context.newPage(), budget.effectiveTimeout('newPage'))
    mountPage(page)
    const location = await gotoRecoverTarget(target, budget)
    const status = await detectWithBudget(budget)
    return settleAfterRebuild(status, location, budget)
  }

  /** Level 3: rebuild the persistent context/browser on the SAME profile (§10). */
  const rebuildBrowser = async (target: SessionLocation, budget: RecoveryBudget): Promise<DeepSeekStatus> => {
    browserEpoch += 1
    pageEpoch += 1
    currentDeltaReceiver = null
    currentReasoningReceiver = null
    onPageReplaced?.()
    await bound(
      context.close().catch(() => {}),
      budget.effectiveTimeout('closeQuietly'),
    ).catch(() => {})
    context = await bound(
      chromium.launchPersistentContext(profileDir, { headless: false, viewport: { width: 1280, height: 800 } }),
      budget.effectiveTimeout('newPage'),
    )
    mountBrowserLifecycle()
    await installBridges()
    page = context.pages()[0] ?? (await context.newPage())
    mountPage(page)
    const location = await gotoRecoverTarget(target, budget)
    const status = await detectWithBudget(budget)
    return settleAfterRebuild(status, location, budget)
  }

  /**
   * The recovery loop (design §7): bounded retries, backoff, and a 60s wall-clock
   * budget shared by every attempt. Level 1 upgrades to Level 3 when the context
   * itself died; the whole loop stops the moment the budget is exhausted.
   */
  const runRecovery = async (reason: RecoveryReason): Promise<DeepSeekStatus> => {
    recovery.onRecovering?.(true)
    recoveryNavigationActive = true
    const budget = createRecoveryBudget()
    const target = recovery.getRecoverTarget?.() ?? ({ kind: 'empty' } as const)
    recoveryTarget = target
    let finalStatus: DeepSeekStatus = 'error'
    try {
      let level: RecoveryLevel = reason === 'browser-disconnected' || reason === 'context-closed' ? 3 : 1
      let attempt = 0
      for (;;) {
        if (disposed || budget.exhausted()) break
        if (attempt > 0) {
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(backoffForAttempt(attempt + 1), budget.remaining())),
          )
          if (budget.exhausted()) break
        }
        attempt += 1
        historySignals = []
        settledLocation = { kind: 'other' }
        try {
          const status = level === 1 ? await rebuildPage(target, budget) : await rebuildBrowser(target, budget)
          if (status === 'logged_in' || status === 'logged_out') {
            finalStatus = status
            break
          }
          // 'error' → retryable within this level
        } catch (error) {
          if (level === 1 && isTargetClosedError(error)) {
            level = 3
            attempt = 0
            continue
          }
        }
        if (attempt >= maxAttemptsFor(level)) {
          if (level === 1) {
            level = 3
            attempt = 0
            continue
          }
          break // Level 3 exhausted → offline
        }
      }
    } finally {
      recoveryNavigationActive = false
      // Phase 20B1: the recovery's LAST step is reconciliation. It runs while
      // the connection still reads `recovering`, so the UI is never handed back
      // before the transcript and the real page agree. Strictly best-effort — a
      // failure here can never turn a successful recovery into a failure.
      try {
        let history: HistorySignal = 'unknown'
        if (historySignals.length > 0 && budget.remaining() > 0) {
          const signals = await bound(Promise.all(historySignals), budget.effectiveTimeoutMs(1_000)).catch(() => [])
          if (signals.length > 0 && signals.every((signal) => signal === 'not_found')) history = 'not_found'
          else if (signals.length > 0 && signals.every((signal) => signal === 'found')) history = 'found'
        }
        let location = settledLocation
        try {
          if (!page.isClosed()) location = sessionLocationFromPath(page.url())
        } catch {
          location = { kind: 'other' }
        }
        await recovery.onSettled?.({ status: finalStatus, target, location, history })
      } catch {
        // reconciliation never owns the recovery's outcome
      }
      recoveryTarget = null
      historySignals = []
      recovery.onRecovering?.(false)
    }
    // The recovery has settled: report the page's real state (never optimistic).
    if (finalStatus === 'logged_in') onStatus('logged_in')
    else if (finalStatus === 'logged_out') onStatus('logged_out')
    else onStatus('error')
    return finalStatus
  }

  /** Single-flight recovery entry (§6): concurrent callers share one promise. */
  const recover = (reason: RecoveryReason): Promise<DeepSeekStatus> => {
    if (disposed) return Promise.resolve('error')
    if (recoveryPromise !== null) {
      pendingRecovery = true
      return recoveryPromise
    }
    const promise = runRecovery(reason)
    recoveryPromise = promise
    void promise.finally(() => {
      recoveryPromise = null
      const again = pendingRecovery
      pendingRecovery = false
      // A failure arrived WHILE recovering (§6). Only run another round when the
      // page is still not usable — a kill fires BOTH `page close` and `disconnected`,
      // and the first round (Level 3) may already have healed everything.
      if (again && !disposed) {
        const health = syncHealth()
        if (health !== 'healthy_chat' && health !== 'login_required') {
          void recover(reason)
        }
      }
    })
    return promise
  }

  const triggerRecovery = (reason: RecoveryReason): void => {
    void recover(reason)
  }

  /** Wire the context/browser lifecycle once (re-wired after each Level 3). */
  const mountBrowserLifecycle = (): void => {
    const myEpoch = browserEpoch
    const browserObj = context.browser()
    if (browserObj !== null) {
      browserObj.on('disconnected', () => {
        if (disposed || myEpoch !== browserEpoch) return
        knownHealthy = false
        void triggerRecovery('browser-disconnected')
      })
    }
    context.on('close', () => {
      if (disposed || myEpoch !== browserEpoch) return
      knownHealthy = false
      void triggerRecovery('context-closed')
    })
  }

  /**
   * Every route's single readiness gate (design §13): healthy → resolve now;
   * `login_required` → report logged out without recovering; anything else →
   * run the single-flight recovery and resolve with the settled status.
   */
  const ensureReady = async (): Promise<DeepSeekStatus> => {
    if (disposed) return 'error'
    // A recovery is already running — await it instead of racing another (§6).
    // This also avoids misreading an intermediate page (the fresh page is briefly
    // `about:blank` before its goto) as a new failure.
    if (recoveryPromise !== null) return recoveryPromise
    const health = syncHealth()
    if (health === 'healthy_chat') return 'logged_in'
    if (health === 'login_required') return 'logged_out'
    return recover(
      health === 'browser_dead' ? 'browser-disconnected' : health === 'page_dead' ? 'page-closed' : 'page-crashed',
    )
  }

  /**
   * Phase 20B1: read one session's authoritative history from the page's own
   * IndexedDB cache. Read-only and bounded, and fenced by BOTH epochs — a page
   * replaced while the read was in flight reports `stale` instead of handing
   * back a snapshot that no longer describes the live page.
   */
  const readHistorySnapshot = async (sessionId: string, budgetMs?: number): Promise<HistorySnapshotTicket> => {
    const readPageEpoch = pageEpoch
    const readBrowserEpoch = browserEpoch
    const target = page
    let probe: unknown = { outcome: 'error' }
    // The reconcile's deadline is shared: this read gets whatever is left of it,
    // capped by its own limit — never a fresh full timeout.
    const timeoutMs =
      budgetMs === undefined ? HISTORY_READ_TIMEOUT_MS : Math.max(1, Math.min(HISTORY_READ_TIMEOUT_MS, budgetMs))
    try {
      probe = await bound(
        target.evaluate(readHistoryEntryInPage, {
          db: DEEPSEEK_HISTORY_DB,
          store: DEEPSEEK_HISTORY_STORE,
          key: sessionId,
          timeoutMs,
        }),
        timeoutMs,
      )
    } catch {
      // A closed or replaced page makes the evaluate itself throw — same verdict:
      // there is no trustworthy snapshot.
      probe = { outcome: 'error' }
    }
    const read = parseHistoryEntry(probe, sessionId)
    const current = (): boolean =>
      !disposed && readPageEpoch === pageEpoch && readBrowserEpoch === browserEpoch && target === page
    return { read: current() ? read : { kind: 'unavailable', reason: 'stale' }, current }
  }

  /**
   * Phase 20B1 review: ask the PAGE ITSELF to re-fetch its history. Measured on a
   * real session, the frontend writes its IDB entry once per page load and never
   * again — a crash mid-turn therefore leaves the assistant frozen at `WIP`
   * forever, while a plain `reload()` makes the SPA request its own history again
   * and write a fresh `MERGE`/`REPLACE` (`4(A:WIP)` → `4(A:FINISHED)`, 884 chars).
   *
   * The Host only reloads: it never deletes the DB, never calls the history API
   * and never reads tokens/cookies. The navigation this causes is suppressed so it
   * can never look like a user switch, and it is bounded by a step timeout — the
   * caller (reconcile) additionally allows at most ONE refresh per run.
   */
  const refreshHistoryView = async (budgetMs?: number): Promise<void> => {
    if (disposed) return
    // The WHOLE refresh shares the caller's deadline: `left()` is re-read before
    // every sub-step, so its real timeout is `min(stepCap, remaining)` — a fixed
    // step cap could otherwise be spent twice in a row and overrun the budget.
    const deadline = Date.now() + (budgetMs ?? REFRESH_TIMEOUT_MS + REFRESH_SETTLE_TIMEOUT)
    const left = (): number => Math.max(0, deadline - Date.now())
    const reloadBudget = Math.min(REFRESH_TIMEOUT_MS, left())
    if (reloadBudget <= 0) return
    const refreshPageEpoch = pageEpoch
    const refreshBrowserEpoch = browserEpoch
    const previousSuppression = recoveryNavigationActive
    // Our navigation, not the user's: the session watcher must ignore it.
    recoveryNavigationActive = true
    try {
      await bound(page.reload({ waitUntil: 'domcontentloaded' }), reloadBudget)
      if (disposed || refreshPageEpoch !== pageEpoch || refreshBrowserEpoch !== browserEpoch) return
      // `networkidle` is the real "the SPA finished its own requests" signal, and
      // it may only use what the reload left behind.
      const settleBudget = Math.min(REFRESH_SETTLE_TIMEOUT, left())
      if (settleBudget > 0) await page.waitForLoadState('networkidle', { timeout: settleBudget }).catch(() => {})
    } finally {
      recoveryNavigationActive = previousSuppression
    }
  }

  // Mount the initial browser + page lifecycle listeners.
  mountBrowserLifecycle()
  mountPage(page)

  /**
   * Best-effort citation hydration (Phase 07I).
   *
   * Runs strictly AFTER the reply has been delivered and `chat.sending` is back
   * to false: DeepSeek hydrates the real source URLs onto the citation badges a
   * few seconds after the body stops streaming. Because it is bound to ONE
   * captured reply node, a following send can never leak its badges in here.
   *
   * Every outcome is swallowed — a timeout, a closed page, plugin disposal or a
   * recycled DOM simply means "this reply keeps its plain [N] markers".
   */
  const scheduleCitationHydration = (
    node: JSHandle,
    reply: AssistantReply,
    onCitations: ((citations: Citation[]) => void) | undefined,
  ): void => {
    const markdown = reply.format === 'markdown' ? reply.content : ''
    // A plain answer carries no markers → no task, no waiting, no cost at all.
    if (onCitations === undefined || parseCitationGroups(markdown).length === 0) {
      void node.dispose().catch(() => {})
      return
    }

    void (async () => {
      try {
        // A null node (nothing rendered) means there is nothing to wait for.
        const usable = await page
          .evaluate((target: unknown) => target !== null && target !== undefined, node)
          .catch(() => false)
        if (!usable || disposed) return
        // Wait only until the badges exist AND every one of them carries its URL.
        // The COUNT is deliberately NOT required to match the marker count:
        // DeepSeek renders a badge only for settled references (7 groups → 3
        // badges is normal), and the block-level mapping handles the rest.
        await page.waitForFunction(
          (target: unknown) => {
            const container = target as { querySelectorAll?: (selector: string) => ArrayLike<unknown> } | null
            if (container === null || container === undefined || typeof container.querySelectorAll !== 'function') {
              return false
            }
            const badges = Array.from(container.querySelectorAll('.ds-markdown-cite'))
            if (badges.length === 0) return false
            return badges.every((badge) => {
              const el = badge as {
                tagName?: string
                getAttribute?: (name: string) => string | null
                querySelector?: (selector: string) => unknown
                closest?: (selector: string) => unknown
              }
              // DeepSeek's shape is `<a href><span.ds-markdown-cite>`, so the
              // anchor is the badge's PARENT; the other two shapes are kept for
              // robustness across front-end changes.
              if (el.tagName === 'A' && typeof el.getAttribute === 'function') {
                const own = el.getAttribute('href')
                if (typeof own === 'string' && own !== '') return true
              }
              if (typeof el.closest === 'function') {
                const anchor = el.closest('a[href]') as { getAttribute?: (name: string) => string | null } | null
                const href =
                  anchor !== null && anchor !== undefined && typeof anchor.getAttribute === 'function'
                    ? anchor.getAttribute('href')
                    : null
                if (typeof href === 'string' && href !== '') return true
              }
              if (typeof el.querySelector !== 'function') return false
              const inner = el.querySelector('a[href]') as { getAttribute?: (name: string) => string | null } | null
              const nested =
                inner !== null && inner !== undefined && typeof inner.getAttribute === 'function'
                  ? inner.getAttribute('href')
                  : null
              return typeof nested === 'string' && nested !== ''
            })
          },
          node,
          { timeout: CITATION_HYDRATION_TIMEOUT },
        )
        if (disposed) return
        const domBlocks = await page.evaluate(readDomBlocks, node)
        const citations = resolveCitationsByBlock({ markdown, domBlocks })
        if (citations.length > 0 && !disposed) onCitations(citations)
      } catch {
        // Timeout / closed page / disposal / recycled DOM — citations are optional.
      } finally {
        await node.dispose().catch(() => {})
      }
    })()
  }

  const sendMessage = async (
    text: string,
    onDelta: (reply: AssistantReply) => void,
    onReasoning: (reply: AssistantReply) => void,
    onCitations?: (citations: Citation[]) => void,
    onSubmitted?: (submitted: CompletionSubmission) => void | Promise<void>,
  ): Promise<AssistantReply> => {
    if (sending) throw new Error('a send is already in progress')
    sending = true
    stopRequested = false
    sessionInterrupted = false
    lastSendInterrupted = false
    // Capture the page this round is bound to (Phase 20A §3): if a rebuild
    // replaces it mid-send, the final DOM read must never touch the new page.
    const sendEpoch = pageEpoch
    // Which conversation does this round write into? A send started from `/`
    // gets its session created by DeepSeek a moment later — `classifyDuringSend`
    // accepts exactly that first id and treats any LATER change as external.
    const startedAt = sessionLocationFromPath(page.url())
    sendSession = { startedAt, currentId: startedAt.kind === 'session' ? startedAt.id : null }

    // Body and reasoning get their OWN throttle, so the two streams can never
    // overwrite each other. Both coalesce to ~one emit per 100ms.
    const replyThrottle = createThrottle<AssistantReply>(
      onDelta,
      100,
      (a, b) => a.content === b.content && a.format === b.format,
    )
    const reasoningThrottle = createThrottle<AssistantReply>(
      onReasoning,
      100,
      (a, b) => a.content === b.content && a.format === b.format,
    )
    // Keep the last frame of each stream: an interrupted send must finish with
    // what it already received instead of reading the NEW conversation's DOM.
    let lastReply: AssistantReply | null = null
    let lastReasoning: AssistantReply | null = null
    currentDeltaReceiver = (reply) => {
      lastReply = reply
      replyThrottle.push(reply)
    }
    currentReasoningReceiver = (reply) => {
      lastReasoning = reply
      reasoningThrottle.push(reply)
    }

    const cleanupObservers = (): Promise<void> =>
      Promise.all([
        page.evaluate(cleanupReplyReader, {}).catch(() => {}),
        page.evaluate(cleanupReasoningReader, {}).catch(() => {}),
      ]).then(() => undefined)

    /**
     * Wait (bounded) until the reader installed for this send reports that the
     * NEW node exists. The readers expose `__hasNewReply` / `__hasNewReasoning`,
     * which compare against the pre-send node identity — no fixed sleep, no
     * polling loop of our own, and no dependency on the text being non-empty.
     */
    const waitForNewNode = async (flag: string): Promise<void> => {
      await page
        .waitForFunction(
          (name: string) => {
            const w = window as unknown as Record<string, unknown>
            const probe = w[name]
            return typeof probe === 'function' ? (probe as () => boolean)() === true : false
          },
          flag,
          { timeout: NEW_NODE_TIMEOUT },
        )
        .catch(() => {
          // Timeout is not fatal — fall through and read what is there.
        })
    }

    try {
      // Fail fast when logged out; the token check happens inside the page and
      // only a boolean/code leaves it — no token or cookie is ever read here.
      const status = await detectStatus(page)
      if (status !== 'logged_in') {
        throw new Error(status === 'logged_out' ? 'not logged in' : 'login state unknown')
      }

      // The user may have flipped EITHER switch inside the DeepSeek window
      // itself, so re-read both before every send (no polling). Deep Think also
      // tells us whether this send may produce reasoning at all.
      const modeAtSend = await syncComposerMode()

      // Capture how many replies / reasoning blocks already exist so each reader
      // only ever looks at the NEW one (never stale history).
      const counts = await page.evaluate(
        ({ selector, fallback, reasoning }) => {
          const replies = document.querySelectorAll(selector)
          return {
            replies: (replies.length > 0 ? replies : document.querySelectorAll(fallback)).length,
            reasoning: document.querySelectorAll(reasoning).length,
          }
        },
        { selector: REPLY_SELECTOR, fallback: REPLY_FALLBACK_SELECTOR, reasoning: REASONING_SELECTOR },
      )

      // Install BOTH DOM observers BEFORE sending, independently: the reply
      // reader prefers DeepSeek's raw Markdown (React props) and falls back to
      // rendered text; the reasoning reader reads `.ds-think-content` and stays
      // completely silent when Deep Think produced none. Neither can break chat.
      await page.evaluate(installReplyReader, {
        options: {
          selector: REPLY_SELECTOR,
          fallback: REPLY_FALLBACK_SELECTOR,
          // Reasoning renders through its own `.ds-markdown` too — keep the
          // reply fallback from reading thinking text as the answer.
          excludeWithin: REASONING_SELECTOR,
          startCount: counts.replies,
          maxScan: MAX_FIBER_SCAN,
        },
      })
      await page.evaluate(installReasoningReader, {
        options: {
          selector: REASONING_SELECTOR,
          startCount: counts.reasoning,
          maxScan: MAX_FIBER_SCAN,
        },
      })

      // TWO waiters, both registered BEFORE the click (Phase 18A). The REQUEST is
      // the commit point: the moment this round's content reaches the page the
      // page owns it, so a response that never arrives can no longer be mistaken
      // for "nothing was submitted". The response keeps its old role — the SSE
      // stream's end is still the reliable "reply complete" signal.
      const requestPromise = page.waitForRequest(isCompletionCall, { timeout: COMPLETION_TIMEOUT })
      const completionPromise = page.waitForResponse((response) => isCompletionCall(response.request()), {
        timeout: COMPLETION_TIMEOUT,
      })
      // If the commit point itself fails, the response waiter must not surface as
      // an unhandled rejection later — it is still awaited properly below.
      completionPromise.catch(() => {})

      await page.fill(INPUT_SELECTOR, text)
      await page.locator(SEND_BUTTON_SELECTOR).first().click()

      // ★ COMMIT POINT: the completion REQUEST left the page. Exactly one
      // `onSubmitted` call, before the response is awaited — a deadline miss here
      // (pre-submit) leaves the draft untouched; anything after it is post-submit.
      const committedRequest = await requestPromise
      if (onSubmitted !== undefined) await onSubmitted(readCompletionSubmission(committedRequest))

      const response = await completionPromise
      // The response must belong to THIS round's request — never a stranger's.
      if (response.request() !== committedRequest) {
        throw new Error('completion response does not belong to this send')
      }
      await response.finished()

      // An interruption means the page now shows a DIFFERENT conversation: the
      // new DOM must never be read on behalf of this send — no node wait, no
      // final page read, no citation handle. The reply ends with the last frame
      // that actually arrived for THIS conversation.
      let replyHandle: JSHandle | null = null
      let finalReasoning: AssistantReply
      let finalReply: AssistantReply
      if (sessionInterrupted || sendEpoch !== pageEpoch) {
        // Either the page left this conversation, or a recovery replaced the
        // page mid-send (§3). In both cases the NEW page's DOM must never be
        // read on this round's behalf — finish with the last streamed frame.
        finalReasoning = lastReasoning ?? { content: '', format: 'text' }
        finalReply = lastReply ?? { content: '', format: 'text' }
        // Tear the readers down WITHOUT reading.
        await cleanupObservers()
      } else {
        // Condition waits (never a fixed sleep): the final read needs the NEW
        // node to exist. Reasoning is only awaited when Deep Think was ON for
        // this send, so a normal reply never blocks on a reasoning node.
        await waitForNewNode('__hasNewReply')
        if (modeAtSend.deepThink.enabled) await waitForNewNode('__hasNewReasoning')

        // Capture THIS reply's node before the readers are torn down (they
        // delete the page globals). The later, out-of-band citation hydration
        // must stay pinned to this exact reply, never to "whatever is last"
        // (Phase 07I).
        replyHandle = await page
          .evaluateHandle(() => {
            const w = window as unknown as { __replyNode?: () => unknown }
            return typeof w.__replyNode === 'function' ? w.__replyNode() : null
          })
          .catch(() => null)

        // Final reads (each also disconnects its own observer).
        finalReasoning = normalizeReply(await page.evaluate(readAndCleanupReasoning, {}))
        finalReply = normalizeReply(await page.evaluate(readAndCleanupReply, {}))
      }

      // Force-flush both throttles so neither final value can be dropped.
      // Reasoning is optional: an empty result means Deep Think produced none.
      if (finalReasoning.content !== '') {
        reasoningThrottle.push(finalReasoning)
        reasoningThrottle.flush()
      }
      replyThrottle.push(finalReply)
      replyThrottle.flush()

      // A non-empty reply is always fine. An EMPTY one is only an error when the
      // round ended for a reason the user asked for — a stop (Phase 07J) or an
      // external session switch (Phase 08.1). Those are normal endings and keep
      // whatever partial reply already streamed; anything else is a real error.
      const emptyError = emptyReplyError(finalReply.content, stopRequested, sessionInterrupted)
      if (emptyError !== null) throw new Error(emptyError)

      // Hand the citation work off BEFORE returning. The reply is already
      // complete, `sending` flips back to false in `finally`, and the hydration
      // keeps running on its own — the next send is never blocked by it.
      if (replyHandle !== null) scheduleCitationHydration(replyHandle, finalReply, onCitations)
      return finalReply
    } finally {
      currentDeltaReceiver = null
      currentReasoningReceiver = null
      replyThrottle.dispose()
      reasoningThrottle.dispose()
      await cleanupObservers()
      sending = false
      // Freeze how THIS round ended before the per-send flags are reset, so the
      // Host can label the message (Phase 08.2).
      lastSendInterrupted = stopRequested || sessionInterrupted
      // Reset together with `sending`, AFTER the empty-reply check above: a stop
      // belongs to exactly one send, so it must never leak into the next round
      // (a later, genuinely empty reply has to fail again).
      stopRequested = false
      // The session state follows the same one-send lifecycle (Phase 08.1).
      sessionInterrupted = false
      sendSession = null
    }
  }

  /**
   * Stop the in-flight generation by clicking the REAL DeepSeek stop control
   * (Phase 07J).
   *
   * DeepSeek does not render a separate stop button: while a reply streams the
   * primary composer button BECOMES the stop control. Clicking it ends the
   * completion normally — the response still finishes with HTTP 200 — so
   * `sendMessage` flushes whatever partial reply/reasoning arrived and reports no
   * error. No private endpoint, no DOM mutation, no React state change.
   *
   * The `sending` guard matters: outside a streaming window the same button is
   * the send button, so clicking it then would send a new message instead. The
   * `stopRequested` check makes the call IDEMPOTENT per send: Dock / Float /
   * Pop-out can each ask to stop at the same time, and after the first stop the
   * shared button may already be back to "send" while this Host is still
   * finishing the send — a second click would SEND instead of stopping.
   */
  const stopGeneration = async (): Promise<boolean> => {
    const action = decideStopAction({ sending, stopRequested })
    // Nothing is streaming → there is nothing to stop.
    if (action === 'idle') return false
    // This send was already stopped (another surface won the race): report the
    // stop as satisfied WITHOUT a second DOM click on the shared button.
    if (action === 'already') return true
    stopRequested = true
    const clicked = await page
      .evaluate((selector: string) => {
        const el = document.querySelector(selector)
        if (el === null) return false
        ;(el as HTMLElement).click()
        return true
      }, SEND_BUTTON_SELECTOR)
      .catch(() => false)
    if (!clicked) {
      // The control was missing → nothing was stopped; do not mask a real error.
      stopRequested = false
      return false
    }
    // Bounded condition wait (never a fixed sleep): the primary button must stop
    // showing the streaming "stop" glyph. A timeout is not fatal — the completion
    // stream still settles and `sendMessage` still returns.
    await page
      .waitForFunction(
        (payload: { selector: string; glyph: string }) => {
          const el = document.querySelector(payload.selector)
          if (el === null) return true
          const path = el.querySelector('svg path')?.getAttribute('d') ?? ''
          return path === '' || !path.startsWith(payload.glyph)
        },
        { selector: SEND_BUTTON_SELECTOR, glyph: STOP_GLYPH_PREFIX },
        { timeout: STOP_SETTLE_TIMEOUT },
      )
      .catch(() => {
        // fall through — the Host only reports that a stop was requested
      })
    return true
  }

  /**
   * Start a NEW DeepSeek conversation by clicking the REAL "New chat" control
   * (Phase 07L).
   *
   * The control is located by its semantic label and never by a hash class;
   * a missing or ambiguous label leaves the page untouched and FAILS the call
   * (Companion must never clear its transcript without a real new conversation
   * behind it). A click alone proves nothing either: the SPA must also land on
   * the empty-chat pathname with no message container left. Only then is the
   * switch confirmed. DeepSeek's composer switches are GLOBAL and persist
   * across chats, so their real values are re-read instead of assuming.
   */
  const newChat = async (): Promise<void> => {
    const outcome = normalizeNewChatOutcome(await page.evaluate(newChatInPage, { options: NEW_CHAT_OPTIONS }))
    if (outcome === 'missing') throw new Error('new chat control not found')
    if (outcome === 'ambiguous') throw new Error('new chat control is ambiguous')
    // Bounded condition wait (never a fixed sleep): the SPA must actually be on
    // the empty chat with every old message gone.
    const ready = await page
      .waitForFunction(newChatReadyInPage, { options: NEW_CHAT_CONFIRM_OPTIONS }, { timeout: NEW_CHAT_CONFIRM_TIMEOUT })
      .then(() => true)
      .catch(() => false)
    if (!ready) throw new Error('new chat did not open')
    // The new chat inherited the page's composer switches — mirror the truth.
    await syncComposerMode()
  }

  /**
   * Read the sidebar's history entries (Phase 08). Read-only projection of the
   * standard anchors the sidebar itself renders: `{ id, title }` plus an
   * `active` flag computed by comparing the id with the page's own pathname —
   * no styling class is involved, and only what the DOM really holds is
   * returned.
   */
  const listSessions = async (): Promise<ChatSessionSummary[]> =>
    toSessionSummaries(normalizeSessionsResult(await page.evaluate(readSessionsInPage, { options: SESSION_OPTIONS })))

  /** The number of message containers the page currently renders. */
  const messageCount = async (): Promise<number> =>
    page.evaluate((selector: string) => document.querySelectorAll(selector).length, MESSAGE_SELECTOR).catch(() => -1)

  /**
   * Wait (bounded) until the message count stops moving. The rebuild after a
   * switch happens in steps, and reading mid-render would capture a partial
   * transcript.
   */
  const waitForMessageCountStable = async (): Promise<void> => {
    const deadline = Date.now() + SWITCH_STABLE_TIMEOUT
    let last = -1
    let stableReads = 0
    while (Date.now() < deadline) {
      const count = await messageCount()
      if (count === last) stableReads += 1
      else stableReads = 0
      last = count
      if (stableReads >= 2) return
      await new Promise((resolve) => setTimeout(resolve, SWITCH_STABLE_INTERVAL))
    }
  }

  /**
   * Open a DeepSeek history conversation (Phase 08).
   *
   * When the target IS the conversation already on screen this resolves without
   * any click — the page is never asked to reload what it is showing. Otherwise
   * exactly one native click lands on the sidebar anchor whose href carries that
   * id, and the switch is only reported as done after a bounded confirmation:
   * the page's pathname is that id AND every message node recorded before the
   * click is gone (identity, not a count). No private API, no hash class, no
   * fixed sleep.
   */
  const switchChat = async (conversationId: string): Promise<void> => {
    const currentId = conversationIdFromPath(page.url(), SESSION_HREF_MARKER)
    // Already on this conversation → never click it again: the caller simply
    // re-reads what the page shows.
    if (!needsSwitchChat(currentId, conversationId)) return
    const options: SwitchChatOptions = {
      ...SESSION_OPTIONS,
      conversationId,
      messageSelector: MESSAGE_SELECTOR,
    }
    const outcome = normalizeSwitchOutcome(await page.evaluate(switchChatInPage, { options }))
    if (outcome === 'missing') throw new Error('chat session not found')
    if (outcome === 'ambiguous') throw new Error('chat session link is ambiguous')
    const ready = await page
      .waitForFunction(switchChatReadyInPage, { options }, { timeout: SWITCH_CONFIRM_TIMEOUT })
      .then(() => true)
      .catch(() => false)
    if (!ready) throw new Error('chat switch did not complete')
    await waitForMessageCountStable()
  }

  /** Scroll the chat's virtual list (the scroller that can actually scroll). */
  const scrollMessagesTo = async (position: 'top' | 'bottom'): Promise<void> => {
    await page.evaluate(scrollMessagesInPage, { options: SCROLL_OPTIONS, position }).catch(() => {})
  }

  /**
   * A signature of the virtual list: how many message nodes are rendered AND
   * how tall the real scroller says the conversation is. Both grow when the
   * missing history is rendered, so the wait below cannot mistake "still
   * clipped" for "settled".
   */
  const listSignature = async (): Promise<string> =>
    page
      .evaluate((selector: string) => {
        const messages = Array.from(document.querySelectorAll(selector))
        let current: Element | null = messages[0] ?? null
        let height = 0
        while (current !== null) {
          if (
            String(current.className).includes('ds-scroll-area') &&
            current.scrollHeight > current.clientHeight + 10
          ) {
            height = Math.round(current.scrollHeight)
            break
          }
          current = current.parentElement
        }
        return `${messages.length}:${height}`
      }, MESSAGE_SELECTOR)
      .catch(() => '')

  /** Wait (bounded) until the list signature stops moving. */
  const waitForListStable = async (): Promise<void> => {
    const deadline = Date.now() + SWITCH_STABLE_TIMEOUT
    let last = ''
    let stableReads = 0
    while (Date.now() < deadline) {
      const signature = await listSignature()
      if (signature !== '' && signature === last) stableReads += 1
      else stableReads = 0
      last = signature
      if (stableReads >= 2) return
      await new Promise((resolve) => setTimeout(resolve, SWITCH_STABLE_INTERVAL))
    }
  }

  /**
   * Make the virtual list render the WHOLE conversation, and LEAVE it there.
   *
   * DeepSeek keeps only the messages around the viewport in the DOM, so a
   * switched-to chat shows a handful of nodes at first (verified: 5 of 16).
   * Scrolling to the top renders the rest (16 of 16, scrollHeight 3545 → 8767);
   * scrolling back to the bottom would clip them again, so the view is restored
   * only AFTER the transcript has been read. Bounded rounds, settled signature —
   * never a fixed sleep.
   */
  const ensureFullHistory = async (): Promise<void> => {
    for (let round = 0; round < HISTORY_FILL_ROUNDS; round += 1) {
      const before = await listSignature()
      await scrollMessagesTo('top')
      await waitForListStable()
      if ((await listSignature()) === before) break
    }
  }

  /**
   * Rebuild the transcript the page is currently showing (Phase 08).
   *
   * The virtual list is filled first (see `ensureFullHistory`), then one
   * page-side pass reads the message list in DOM order (roles decided by
   * structure, assistant content from the raw Markdown props with a rendered
   * text fallback, reasoning from its own container). Citation badges are then
   * read per reply with the SAME block reader the hydration uses, and mapped
   * with the SAME strict block rule. Only plain data leaves the page — never
   * HTML, a React object or a token.
   */
  const readTranscript = async (): Promise<ChatMessageInput[]> => {
    await ensureFullHistory()
    let raw = normalizeTranscript(await page.evaluate(readTranscriptInPage, { options: TRANSCRIPT_OPTIONS }))
    if (raw.pageLocalImages) {
      const beforeRefresh = raw
      if (beforeRefresh.pageLocalImageRequirements.length === 0)
        throw new Error('page-local image evidence is incomplete')
      // DeepSeek keeps a just-sent image as blob: in its SPA cache, including
      // after a sidebar switch. Only its own fresh page load yields a signed
      // history URL. Never turn the blob into a Host attachment.
      const sessionId = conversationIdFromPath(page.url(), SESSION_HREF_MARKER)
      if (sessionId === null) throw new Error('cannot refresh page-local image outside a chat session')
      await refreshHistoryView(HISTORY_IMAGE_REFRESH_BUDGET)
      if (conversationIdFromPath(page.url(), SESSION_HREF_MARKER) !== sessionId)
        throw new Error('chat session changed during image history refresh')
      await page.waitForFunction(
        (selector: string) => document.querySelectorAll(selector).length > 0,
        MESSAGE_SELECTOR,
        {
          timeout: SWITCH_CONFIRM_TIMEOUT,
        },
      )
      await waitForMessageCountStable()
      await ensureFullHistory()
      raw = normalizeTranscript(await page.evaluate(readTranscriptInPage, { options: TRANSCRIPT_OPTIONS }))
      if (conversationIdFromPath(page.url(), SESSION_HREF_MARKER) !== sessionId)
        throw new Error('chat session changed during image history read')
      if (!pageLocalImagesReplaced(beforeRefresh, raw))
        throw new Error('signed image history did not replace the page-local images')
    }

    /** DOM blocks per assistant reply, in reply order (only when needed). */
    const readReplyBlocks = async (): Promise<DomBlock[][]> => {
      // The selector is written inline: this callback is serialized into the
      // page, where module constants do not exist.
      const nodes = await page
        .evaluateHandle(() => Array.from(document.querySelectorAll('.ds-assistant-message-main-content')))
        .catch(() => null)
      if (nodes === null) return []
      try {
        const count = await nodes.evaluate((value) => (Array.isArray(value) ? value.length : 0)).catch(() => 0)
        const blocks: DomBlock[][] = []
        for (let index = 0; index < count; index += 1) {
          const node = await nodes.getProperty(String(index)).catch(() => null)
          if (node === null) {
            blocks.push([])
            continue
          }
          const read = await page.evaluate(readDomBlocks, node).catch(() => [] as DomBlock[])
          blocks.push(read)
          await node.dispose().catch(() => {})
        }
        return blocks
      } finally {
        await nodes.dispose().catch(() => {})
      }
    }

    const blocks = transcriptNeedsBlocks(raw.entries) ? await readReplyBlocks() : []
    const messages = buildTranscript(raw.entries, blocks)
    // The rebuild is done — put the page back where a reader expects it (the
    // newest message). Doing this earlier would clip the DOM mid-read.
    await scrollMessagesTo('bottom')
    return messages
  }

  /** Describe the page's file inputs (Phase 18A, read-only). */
  const readFileInputs = async (): Promise<FileInputCandidate[]> => {
    try {
      const raw: unknown = await page.evaluate(describeFileInputsInPage, {})
      return Array.isArray(raw) ? (raw as FileInputCandidate[]) : []
    } catch {
      return []
    }
  }

  /** Every draft preview the page shows right now (Phase 18A, read-only). */
  const listDraftIdentities = async (): Promise<string[]> => {
    try {
      const raw: unknown = await page.evaluate(readDraftIdentitiesInPage, { messageSelector: MESSAGE_SELECTOR })
      if (!Array.isArray(raw)) return []
      return raw.filter((entry): entry is string => typeof entry === 'string')
    } catch {
      return []
    }
  }

  /**
   * Bounded wait for the preview card one `setInputFiles` call produced, then the
   * EXACT identity diff. "At least one new blob" is not enough: the diff must be
   * exactly one added preview and nothing lost, otherwise the upload cannot be
   * tied to a card and the attempt fails safely (Phase 18A).
   */
  const waitForNewDraftIdentity = async (before: readonly string[]): Promise<DraftIdentityDiff> => {
    const known = [...before]
    await page
      .waitForFunction(
        // Serialized into the page: module constants do not exist here. The
        // composer scope mirrors `readDraftIdentitiesInPage` — a SENT image is
        // rendered in the transcript and must never count as a draft.
        (payload: { previous: string[]; messageSelector: string }) => {
          const inComposer = (element: Element): boolean => {
            let node: Element | null = element.parentElement
            for (let depth = 0; depth < 8 && node !== null; depth += 1) {
              if (node.querySelector('textarea') !== null) {
                return payload.messageSelector === '' || node.querySelector(payload.messageSelector) === null
              }
              node = node.parentElement
            }
            return false
          }
          const srcs = Array.from(document.querySelectorAll('img'))
            .filter((img) => inComposer(img))
            .map((img) => img.getAttribute('src') ?? '')
            .filter((src) => src.startsWith('blob:'))
          return srcs.some((src) => !payload.previous.includes(src))
        },
        { previous: known, messageSelector: MESSAGE_SELECTOR },
        { timeout: DRAFT_PREVIEW_TIMEOUT },
      )
      .catch(() => {
        // Timeout is not fatal here: the exact diff below decides.
      })
    return diffDraftIdentities(known, await listDraftIdentities())
  }

  /**
   * Attach ONE image through DeepSeek's own file input (Phase 18A).
   *
   * Page-first, guessed-never: the upload waiter is registered BEFORE the input
   * is touched, the answer is validated field by field, and the draft identity
   * comes from an exact DOM diff — never from a count and never from "the last
   * blob on the page".
   */
  const attachImage = async (input: {
    path: string
    fileName: string
    mimeType: string
    bytes: number
  }): Promise<AttachImageResult> => {
    if (disposed) return { ok: false, error: 'browser disposed' }

    let buffer: Buffer
    try {
      buffer = await readFile(input.path)
    } catch (error) {
      return { ok: false, error: `cannot read the attachment: ${errorText(error)}` }
    }
    if (buffer.length !== input.bytes) {
      return { ok: false, error: 'attachment bytes changed on disk' }
    }

    const before = await listDraftIdentities()
    // Which file input is the COMPOSER's? DeepSeek ships one, but the page may
    // hold more (another feature, a dialog). It is chosen by its own evidence —
    // `multiple` + accepts images + the long accept list — and a tie is a safe
    // failure, never a guess.
    const inputs = await readFileInputs()
    const choice = chooseFileInput(inputs)
    if (!choice.ok) {
      // A page whose composer cannot be identified is worth a diagnostic line:
      // it is the difference between "DeepSeek changed its UI" and "the page is
      // in a state that has no composer at all".
      const census: unknown = await page
        .evaluate(countPageInputsInPage, {})
        .catch(() => ({ totalInputs: -1, fileInputs: -1 }))
      console.warn(
        '[dsh-deepseek-companion] attachImage: no usable file input',
        JSON.stringify({ census, inputs, blobPreviews: before.length }),
      )
      return { ok: false, error: choice.error }
    }

    // ① register the upload waiter BEFORE the input is driven.
    const uploadPromise = page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().includes(UPLOAD_PATH),
      { timeout: UPLOAD_TIMEOUT },
    )
    uploadPromise.catch(() => {})
    try {
      // ② drive the REAL hidden input (no hash class, no React internals, one
      //    file per call — the Host serializes attaches anyway).
      await page.locator(FILE_INPUT_SELECTOR).nth(choice.index).setInputFiles({
        name: input.fileName,
        mimeType: input.mimeType,
        buffer,
      })
      // ③ the upload answer, validated field by field.
      const response = await uploadPromise
      const body: unknown = await response.json().catch(() => null)
      const meta = normalizeUploadResponse({ status: response.status(), body })
      // ④ the page's own card for this upload (bounded, exact diff).
      const diff = await waitForNewDraftIdentity(before)
      const where = `page: ${before.length} blob previews, ${inputs.length} file inputs (used #${choice.index})`

      if (!meta.ok) return failedAttach(diff, `${meta.error} · ${where}`)
      if (!diff.ok) return failedAttach(diff, `${diff.error} · ${where}`)
      if (meta.meta.fileName !== input.fileName) {
        return failedAttach(diff, `upload response file name mismatch (${meta.meta.fileName})`)
      }
      if (meta.meta.fileSize !== input.bytes) {
        return failedAttach(diff, `upload response file size mismatch (${String(meta.meta.fileSize)})`)
      }
      return { ok: true, previewIdentity: diff.identity, deepSeekFileId: meta.meta.fileId }
    } catch (error) {
      // The upload failed (timeout, HTTP error, aborted input). The page may
      // STILL have drawn a card — keep its identity so the failed draft can be
      // removed precisely later; if the diff is not clean, keep nothing.
      const diff = await waitForNewDraftIdentity(before)
      return failedAttach(diff, errorText(error))
    }
  }

  /**
   * Remove ONE draft card (Phase 18A). The identity decides WHICH card; the
   * control is located geometrically (DeepSeek gives it neither aria nor title)
   * but must be a `cursor: pointer` SVG in that card's top-right quadrant — a
   * random SVG is never clicked. Success requires the target identity to be gone
   * AND every other identity to survive.
   */
  const removeDraftAttachment = async (input: { previewIdentity: string }): Promise<boolean> => {
    if (disposed) return false
    if (!isDraftIdentity(input.previewIdentity)) {
      console.warn('[dsh-deepseek-companion] removeDraftAttachment: invalid identity')
      return false
    }

    const others = (await listDraftIdentities()).filter((identity) => identity !== input.previewIdentity)
    try {
      const card: unknown = await page.evaluate(findDraftCardInPage, { identity: input.previewIdentity })
      const point = asPoint(card)
      if (point === null) {
        console.warn('[dsh-deepseek-companion] removeDraftAttachment: card not found', JSON.stringify(card))
        return false
      }

      // Hover the card: DeepSeek only renders the X while the card is hovered.
      await page.mouse.move(point.x, point.y)

      const control = await page
        .waitForFunction(
          // Serialized into the page; mirrors `findRemoveControlInPage` (which is
          // the unit-tested rule set and the check used right before the click).
          (payload: { identity: string; offsets: number[][] }) => {
            const image = Array.from(document.querySelectorAll('img')).find(
              (img) => img.getAttribute('src') === payload.identity,
            )
            if (image === undefined) return false
            const card = image.closest('div[role=button]')
            if (card === null) return false
            const box = card.getBoundingClientRect()
            for (const [dx, dy] of payload.offsets) {
              const x = box.right - (dx ?? 0)
              const y = box.top + (dy ?? 0)
              if (x <= box.left || y >= box.bottom) continue
              const hit = document.elementFromPoint(x, y)
              if (hit === null) continue
              const svg = hit.tagName.toLowerCase() === 'svg' ? hit : hit.closest('svg')
              if (svg === null || svg === image) continue
              if (svg !== hit && !svg.contains(hit)) continue
              if (getComputedStyle(svg).cursor !== 'pointer') continue
              const control = svg.getBoundingClientRect()
              if (control.left < box.left + box.width / 2) continue
              if (control.top > box.top + box.height / 2) continue
              if (control.right > box.right + 1 || control.bottom > box.bottom + 1) continue
              if (control.width >= box.width || control.height >= box.height) continue
              if (!card.contains(svg)) continue
              return { found: true, x, y }
            }
            return false
          },
          {
            identity: input.previewIdentity,
            offsets: REMOVE_CONTROL_OFFSETS.map(([dx, dy]) => [dx, dy]),
          },
          { timeout: REMOVE_CONTROL_TIMEOUT },
        )
        .catch(() => null)
      if (control === null) {
        console.warn('[dsh-deepseek-companion] removeDraftAttachment: control not found, card at', point.x, point.y)
        await probeRemoveControl(input.previewIdentity)
        return false
      }

      const target = asPoint(await control.jsonValue())
      if (target === null) {
        console.warn('[dsh-deepseek-companion] removeDraftAttachment: unusable control point', JSON.stringify(target))
        return false
      }
      // The tested rule set confirms the point once more before the click.
      // Probe lines go to the Host log only (the page-side `probe` callback is
      // not serializable, so the points are collected by the wait above).
      const confirmed: unknown = await page.evaluate(findRemoveControlInPage, {
        identity: input.previewIdentity,
        offsets: REMOVE_CONTROL_OFFSETS.map(([dx, dy]) => [dx, dy] as [number, number]),
      })
      const clickPoint = asPoint(confirmed) ?? target

      await page.mouse.click(clickPoint.x, clickPoint.y)
      // Confirm: THIS identity is gone and every other identity survived.
      const settled = await page
        .waitForFunction(
          (payload: { target: string; others: string[]; messageSelector: string }) => {
            const inComposer = (element: Element): boolean => {
              let node: Element | null = element.parentElement
              for (let depth = 0; depth < 8 && node !== null; depth += 1) {
                if (node.querySelector('textarea') !== null) {
                  return payload.messageSelector === '' || node.querySelector(payload.messageSelector) === null
                }
                node = node.parentElement
              }
              return false
            }
            const srcs = Array.from(document.querySelectorAll('img'))
              .filter((img) => inComposer(img))
              .map((img) => img.getAttribute('src') ?? '')
              .filter((src) => src.startsWith('blob:'))
            if (srcs.includes(payload.target)) return false
            return payload.others.every((identity) => srcs.includes(identity))
          },
          { target: input.previewIdentity, others, messageSelector: MESSAGE_SELECTOR },
          { timeout: REMOVE_SETTLE_TIMEOUT },
        )
        .then(() => true)
        .catch(() => false)
      if (!settled) {
        console.warn(
          '[dsh-deepseek-companion] removeDraftAttachment: confirmation failed at',
          clickPoint.x,
          clickPoint.y,
        )
      }
      return settled
    } catch (error) {
      console.warn('[dsh-deepseek-companion] removeDraftAttachment threw:', errorText(error))
      return false
    }
  }

  /**
   * Diagnostics for a failed removal (Host log only): where each candidate point
   * actually lands. Kept separate from the removal itself so the rule stays pure.
   */
  const probeRemoveControl = async (identity: string): Promise<void> => {
    const env = await page
      .evaluate(
        (payload: { identity: string; offsets: number[][] }) => {
          const lines: string[] = []
          const image = Array.from(document.querySelectorAll('img')).find(
            (img) => img.getAttribute('src') === payload.identity,
          )
          if (image === undefined) return ['image not found']
          const card = image.closest('div[role=button]')
          if (card === null) return ['card not found']
          const box = card.getBoundingClientRect()
          lines.push(
            `card=(${Math.round(box.left)},${Math.round(box.top)},${Math.round(box.width)}x${Math.round(box.height)})`,
          )
          for (const [dx, dy] of payload.offsets) {
            const x = box.right - (dx ?? 0)
            const y = box.top + (dy ?? 0)
            const hit = document.elementFromPoint(x, y)
            if (hit === null) {
              lines.push(`(${Math.round(x)},${Math.round(y)}) -> null`)
              continue
            }
            const svg = hit.tagName.toLowerCase() === 'svg' ? hit : hit.closest('svg')
            lines.push(
              `(${Math.round(x)},${Math.round(y)}) -> ${hit.tagName.toLowerCase()}` +
                (svg === null
                  ? ' no-svg'
                  : ` svg(cursor=${getComputedStyle(svg).cursor},${Math.round(svg.getBoundingClientRect().width)}x${Math.round(
                      svg.getBoundingClientRect().height,
                    )})`),
            )
          }
          return lines
        },
        { identity, offsets: REMOVE_CONTROL_OFFSETS.map(([dx, dy]) => [dx, dy]) },
      )
      .catch(() => ['probe failed'])
    console.warn('[dsh-deepseek-companion] removeDraftAttachment probe:', JSON.stringify(env))
  }

  return {
    check,
    ensureReady,
    readHistorySnapshot,
    refreshHistoryView,
    showLogin,
    getDeepThinkState: () => readToggle(DEEP_THINK_OPTIONS),
    setDeepThinkEnabled,
    getSearchState: () => readToggle(SEARCH_OPTIONS),
    setSearchEnabled,
    getComposerModeState: readComposerMode,
    sendMessage,
    stopGeneration,
    wasInterrupted: () => lastSendInterrupted,
    listDraftIdentities,
    attachImage,
    removeDraftAttachment,
    newChat,
    listSessions,
    switchChat,
    readTranscript,
    async dispose() {
      // Stop any in-flight background work before the page goes away. The epoch
      // fences make every pending listener callback a no-op, and `disposed` stops
      // the recovery engine from launching a fresh Chromium (design §12).
      disposed = true
      pageEpoch += 1
      browserEpoch += 1
      currentDeltaReceiver = null
      currentReasoningReceiver = null
      await context.close().catch(() => {})
    },
  }
}
