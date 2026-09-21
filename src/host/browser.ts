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
import { chromium, type BrowserContext, type Page } from 'playwright'
import type { AssistantReply, ChatFormat, DeepSeekStatus, DeepThinkState } from '../shared/state.ts'
import {
  deepThinkInPage,
  needsDeepThinkClick,
  normalizeDeepThinkState,
  type DeepThinkOptions,
} from './deep-think.ts'
import { loginStatusFromCurrentUser } from './login.ts'
import { cleanupReasoningReader, installReasoningReader, readAndCleanupReasoning } from './reasoning.ts'
import { cleanupReplyReader, installReplyReader, readAndCleanupReply } from './reply.ts'
import { createThrottle } from './throttle.ts'

const DEEPSEEK_URL = 'https://chat.deepseek.com'
/** DeepSeek's authoritative "current user" endpoint. */
const CURRENT_USER_PATH = '/api/v0/users/current'
/** Completion endpoint the SPA posts to when sending a message. */
const COMPLETION_PATH = '/chat/completion'
/** The single chat input (a plain `textarea`, no stable id/role/aria). */
const INPUT_SELECTOR = 'textarea'
/** The send button (DeepSeek's `ds-button--primary`). */
const SEND_BUTTON_SELECTOR = '.ds-button--primary'
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
 * How to find the Deep Think toggle (Phase 07G). DeepSeek's two composer toggles
 * (Deep Think / Search) share every stable attribute, so the label set does the
 * disambiguation and Search is explicitly excluded.
 */
const DEEP_THINK_OPTIONS: DeepThinkOptions = {
  toggleSelector: '.ds-toggle-button',
  selectedClass: 'ds-toggle-button--selected',
  labels: ['深度思考', 'deepthink', 'deep think', 'deep thinking', 'thinking'],
  exclusions: ['智能搜索', 'search'],
}

/** Coerce a value arriving from the page into a trusted `AssistantReply`. */
function normalizeReply(value: unknown): AssistantReply {
  const raw: { content?: unknown; format?: unknown } =
    value !== null && typeof value === 'object' ? (value as { content?: unknown; format?: unknown }) : {}
  const format: ChatFormat = raw.format === 'markdown' ? 'markdown' : 'text'
  return { content: typeof raw.content === 'string' ? raw.content : '', format }
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

  // Deep Think toggle (Phase 07G). The Host mirrors the page's REAL state: the
  // toggle is only ever changed by clicking the real DeepSeek UI, and every read
  // is a fresh read of the page (never cached, never optimistic). No polling —
  // we re-read at the few moments where the state can actually change.
  const readDeepThink = async (): Promise<DeepThinkState> => {
    try {
      return normalizeDeepThinkState(
        await page.evaluate(deepThinkInPage, { options: DEEP_THINK_OPTIONS, action: 'read' as const }),
      )
    } catch {
      return { available: false, enabled: false }
    }
  }

  const syncDeepThink = async (): Promise<DeepThinkState> => {
    const state = await readDeepThink()
    onDeepThink?.(state)
    return state
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
      // A full load can rebuild the composer: mirror the toggle's real state.
      void syncDeepThink()
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
      // Initial sync: mirror the composer's real Deep Think state.
      await syncDeepThink()
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
    }
    await page.goto(`${DEEPSEEK_URL}/sign_in`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.bringToFront()
    // Never carry the previous page's toggle state over: report what the new
    // page actually shows (the sign-in route has no composer → unavailable).
    await syncDeepThink()
  }

  /**
   * Click the real Deep Think toggle toward `enabled`, then re-read the page.
   * Already in the requested state → no click at all; toggle missing → the page
   * state (`available: false`) is returned untouched. The result is always the
   * page's truth, so a failed click simply reports what is really there.
   */
  const setDeepThinkEnabled = async (enabled: boolean): Promise<DeepThinkState> => {
    const before = await readDeepThink()
    if (!needsDeepThinkClick(before, enabled)) return before
    try {
      await page.evaluate(deepThinkInPage, { options: DEEP_THINK_OPTIONS, action: 'click' as const })
    } catch {
      // ignored — the re-read below reports the page's real state
    }
    // Give the SPA a beat to flip the toggle, then re-read.
    await page.waitForTimeout(400)
    return readDeepThink()
  }

  // Single-flight guard: only one in-flight send at a time (no per-message
  // session isolation in this phase).
  let sending = false

  const sendMessage = async (
    text: string,
    onDelta: (reply: AssistantReply) => void,
    onReasoning: (reply: AssistantReply) => void,
  ): Promise<AssistantReply> => {
    if (sending) throw new Error('a send is already in progress')
    sending = true

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
    currentDeltaReceiver = (reply) => replyThrottle.push(reply)
    currentReasoningReceiver = (reply) => reasoningThrottle.push(reply)

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

      // The user may have flipped Deep Think inside the DeepSeek window itself,
      // so re-read the toggle's truth before every send (no polling). The result
      // also tells us whether this send may produce reasoning at all.
      const deepThinkAtSend = await syncDeepThink()

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

      // Wait for the completion POST before clicking, then wait for its SSE
      // stream to finish — the reliable "reply complete" signal (no polling).
      const completionPromise = page.waitForResponse(
        (response) => response.request().method() === 'POST' && response.url().includes(COMPLETION_PATH),
        { timeout: 60000 },
      )
      await page.fill(INPUT_SELECTOR, text)
      await page.locator(SEND_BUTTON_SELECTOR).first().click()
      const response = await completionPromise
      await response.finished()

      // Condition waits (never a fixed sleep): the final read needs the NEW node
      // to exist. Reasoning is only awaited when Deep Think was ON for this send,
      // so a normal reply never blocks waiting for a reasoning node.
      await waitForNewNode('__hasNewReply')
      if (deepThinkAtSend.enabled) await waitForNewNode('__hasNewReasoning')

      // Final reads (each also disconnects its own observer), then force-flush
      // both throttles so neither final value can be dropped.
      const finalReasoning = normalizeReply(await page.evaluate(readAndCleanupReasoning, {}))
      const finalReply = normalizeReply(await page.evaluate(readAndCleanupReply, {}))

      // Reasoning is optional: an empty result means Deep Think produced none, so
      // nothing is emitted and the reply path is completely unaffected.
      if (finalReasoning.content !== '') {
        reasoningThrottle.push(finalReasoning)
        reasoningThrottle.flush()
      }
      replyThrottle.push(finalReply)
      replyThrottle.flush()

      if (finalReply.content === '') throw new Error('empty reply from DeepSeek')
      return finalReply
    } finally {
      currentDeltaReceiver = null
      currentReasoningReceiver = null
      replyThrottle.dispose()
      reasoningThrottle.dispose()
      await cleanupObservers()
      sending = false
    }
  }

  return {
    check,
    showLogin,
    getDeepThinkState: readDeepThink,
    setDeepThinkEnabled,
    sendMessage,
    async dispose() {
      await context.close().catch(() => {})
    },
  }
}
