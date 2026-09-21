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
import { chromium, type BrowserContext, type JSHandle, type Page } from 'playwright'
import type {
  AssistantReply,
  ChatFormat,
  Citation,
  ComposerModeState,
  ComposerToggleState,
  DeepSeekStatus,
  DeepThinkState,
  SearchState,
} from '../shared/state.ts'
import {
  parseCitationGroups,
  readDomBlocks,
  resolveCitationsByBlock,
} from './citations.ts'
import { loginStatusFromCurrentUser } from './login.ts'
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
const COMPLETION_PATH = '/chat/completion'
/** The single chat input (a plain `textarea`, no stable id/role/aria). */
const INPUT_SELECTOR = 'textarea'
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
  /** Set by `dispose()`: background work must stop touching the page. */
  let disposed = false

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
  ): Promise<AssistantReply> => {
    if (sending) throw new Error('a send is already in progress')
    sending = true
    stopRequested = false

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
      if (modeAtSend.deepThink.enabled) await waitForNewNode('__hasNewReasoning')

      // Capture THIS reply's node before the readers are torn down (they delete
      // the page globals). The later, out-of-band citation hydration must stay
      // pinned to this exact reply, never to "whatever is last" (Phase 07I).
      const replyHandle = await page
        .evaluateHandle(() => {
          const w = window as unknown as { __replyNode?: () => unknown }
          return typeof w.__replyNode === 'function' ? w.__replyNode() : null
        })
        .catch(() => null)

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

      // An empty reply is only an error when nobody asked to stop: a stop that
      // arrived before the first token is a NORMAL outcome, and whatever partial
      // reply/reasoning already streamed has been flushed above and is kept.
      const emptyError = emptyReplyError(stopRequested)
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
      // Reset together with `sending`, AFTER the empty-reply check above: a stop
      // belongs to exactly one send, so it must never leak into the next round
      // (a later, genuinely empty reply has to fail again).
      stopRequested = false
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
    async dispose() {
      // Stop any in-flight background work before the page goes away.
      disposed = true
      currentDeltaReceiver = null
      currentReasoningReceiver = null
      await context.close().catch(() => {})
    },
  }
}
