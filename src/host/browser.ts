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
import {
  parseCitationGroups,
  readDomBlocks,
  resolveCitationsByBlock,
  type DomBlock,
} from './citations.ts'
import { loginStatusFromCurrentUser } from './login.ts'
import {
  buildTranscript,
  classifyDuringSend,
  conversationIdFromPath,
  needsSwitchChat,
  normalizeSessionsResult,
  normalizeSwitchOutcome,
  normalizeTranscript,
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
): Promise<DeepSeekBrowser> {
  // Playwright resolves its own matched Chromium via `chromium.executablePath()`;
  // a missing browser surfaces as a clear launch error (mapped to `error`).
  const context: BrowserContext = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: { width: 1280, height: 800 },
  })

  let page: Page = context.pages()[0] ?? (await context.newPage())

  // Re-entrancy guard: `detectStatus()` itself fetches `/users/current`, which
  // fires the `response` listener below. The flag prevents a
  // response -> detect -> response loop, with no timer and no polling.
  let detecting = false

  const runDetect = async (): Promise<DeepSeekStatus> => {
    if (detecting) return 'checking'
    detecting = true
    try {
      const status = await detectStatus(page)
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

  // Wire the detection triggers to a page. Re-run after a full navigation
  // (login OAuth redirects across pages fire `load`) and after the SPA
  // re-fetches `/users/current` (in-app login/logout use history.pushState and
  // do NOT fire `load`). We only treat that response as a "state may have
  // changed" trigger and never read its body here — the token stays inside the
  // page context, where `detectStatus()` reads it.
  const attachListeners = (target: Page): void => {
    target.on('load', () => {
      void runDetect()
      // A full load can rebuild the composer: mirror both switches' real state.
      void syncComposerMode()
    })
    target.on('response', (response) => {
      if (!response.url().includes(CURRENT_USER_PATH)) return
      void runDetect()
    })
  }

  attachListeners(page)

  // Bridge from the page's MutationObserver back to the Host. Registered on the
  // CONTEXT once, so every page (current AND future — including a page
  // recreated after close) automatically has `window.__onReplyDelta`; the
  // context re-injects it on every document load, so one install survives
  // navigation and there is never a duplicate registration across sends.
  let currentDeltaReceiver: ((reply: AssistantReply) => void) | null = null
  let currentReasoningReceiver: ((reply: AssistantReply) => void) | null = null

  await context.exposeFunction('__onReplyDelta', (reply: unknown) => {
    currentDeltaReceiver?.(normalizeReply(reply))
  })
  // Separate bridge for reasoning: one registration on the context, so every
  // page (current and future) has it and sends never re-register.
  await context.exposeFunction('__onReasoningDelta', (reply: unknown) => {
    currentReasoningReceiver?.(normalizeReply(reply))
  })

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
      page = await context.newPage()
      attachListeners(page)
      // A recreated page needs its own session watcher (Phase 08.1).
      attachSessionWatcher(page)
      // The previous page is gone — its draft cards went with it (Phase 18A).
      onPageReplaced?.()
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
  /** Set by `dispose()`: background work must stop touching the page. */
  let disposed = false

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

  /** Watch one page's main frame for session navigation. */
  const attachSessionWatcher = (target: Page): void => {
    target.on('framenavigated', (frame) => {
      if (frame !== target.mainFrame()) return
      handleLocationNavigation(sessionLocationFromPath(frame.url()))
    })
  }

  attachSessionWatcher(page)

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
      const completionPromise = page.waitForResponse(
        (response) => isCompletionCall(response.request()),
        { timeout: COMPLETION_TIMEOUT },
      )
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
      if (sessionInterrupted) {
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
          if (String(current.className).includes('ds-scroll-area') && current.scrollHeight > current.clientHeight + 10) {
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

    const raw = normalizeTranscript(await page.evaluate(readTranscriptInPage, { options: TRANSCRIPT_OPTIONS }))

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
        console.warn('[dsh-deepseek-companion] removeDraftAttachment: confirmation failed at', clickPoint.x, clickPoint.y)
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
          lines.push(`card=(${Math.round(box.left)},${Math.round(box.top)},${Math.round(box.width)}x${Math.round(box.height)})`)
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
      // Stop any in-flight background work before the page goes away.
      disposed = true
      currentDeltaReceiver = null
      currentReasoningReceiver = null
      await context.close().catch(() => {})
    },
  }
}
