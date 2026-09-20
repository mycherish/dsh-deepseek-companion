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
import type { DeepSeekStatus } from '../shared/state.ts'
import { loginStatusFromCurrentUser } from './login.ts'
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

export interface DeepSeekBrowser {
  /** Run one initial check now (then re-checks automatically on navigation). */
  check(): Promise<DeepSeekStatus>
  /** Focus the live DeepSeek page, reopening the sign-in page if it was closed. */
  showLogin(): Promise<void>
  /**
   * Send one message and resolve with the final complete reply text. `onDelta`
   * fires with the growing reply text while DeepSeek is still generating (pure
   * text snapshots — no token or cookie ever leaves the page context).
   */
  sendMessage(text: string, onDelta: (text: string) => void): Promise<string>
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

  // Wire the detection triggers to a page. Re-run after a full navigation
  // (login OAuth redirects across pages fire `load`) and after the SPA
  // re-fetches `/users/current` (in-app login/logout use history.pushState and
  // do NOT fire `load`). We only treat that response as a "state may have
  // changed" trigger and never read its body here — the token stays inside the
  // page context, where `detectStatus()` reads it.
  const attachListeners = (target: Page): void => {
    target.on('load', () => {
      void runDetect()
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
  let currentDeltaReceiver: ((text: string) => void) | null = null

  await context.exposeFunction('__onReplyDelta', (text: string) => {
    currentDeltaReceiver?.(text)
  })

  const check = async (): Promise<DeepSeekStatus> => {
    try {
      await page.goto(DEEPSEEK_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
      return await runDetect()
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
  }

  // Single-flight guard: only one in-flight send at a time (no per-message
  // session isolation in this phase).
  let sending = false

  const sendMessage = async (text: string, onDelta: (text: string) => void): Promise<string> => {
    if (sending) throw new Error('a send is already in progress')
    sending = true

    // Light throttle: emit at most ~every 100ms, always with the latest text.
    const throttle = createThrottle(onDelta, 100)
    currentDeltaReceiver = (snapshot) => throttle.push(snapshot)

    const cleanupObserver = (): Promise<void> =>
      page
        .evaluate(() => {
          const w = window as unknown as {
            __replyObserver?: { disconnect(): void }
            __readCurrentReply?: () => string
          }
          w.__replyObserver?.disconnect()
          delete w.__replyObserver
          delete w.__readCurrentReply
        })
        .catch(() => {})

    try {
      // Fail fast when logged out; the token check happens inside the page and
      // only a boolean/code leaves it — no token or cookie is ever read here.
      const status = await detectStatus(page)
      if (status !== 'logged_in') {
        throw new Error(status === 'logged_out' ? 'not logged in' : 'login state unknown')
      }

      // Install the DOM observer BEFORE sending, capturing the current reply
      // count so we only read the NEW assistant reply (never stale history).
      await page.evaluate(
        ({ selector, fallback }) => {
          const w = window as unknown as {
            __onReplyDelta?: (text: string) => void
            __replyObserver?: MutationObserver
            __readCurrentReply?: () => string
          }
          const selectNodes = (): NodeListOf<Element> => {
            const nodes = document.querySelectorAll(selector)
            return nodes.length > 0 ? nodes : document.querySelectorAll(fallback)
          }
          const startCount = selectNodes().length
          const readCurrent = (): string => {
            const nodes = selectNodes()
            if (nodes.length <= startCount) return ''
            return (nodes[nodes.length - 1]!.textContent ?? '').trim()
          }
          const observer = new MutationObserver(() => {
            w.__onReplyDelta?.(readCurrent())
          })
          observer.observe(document.body, { childList: true, subtree: true, characterData: true })
          w.__replyObserver = observer
          w.__readCurrentReply = readCurrent
        },
        { selector: REPLY_SELECTOR, fallback: REPLY_FALLBACK_SELECTOR },
      )

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

      // Final read (also disconnects the observer), then force-flush so the
      // final text can never be dropped by the throttle.
      const finalText = await page.evaluate(() => {
        const w = window as unknown as {
          __replyObserver?: { disconnect(): void }
          __readCurrentReply?: () => string
        }
        const text = typeof w.__readCurrentReply === 'function' ? w.__readCurrentReply() : ''
        w.__replyObserver?.disconnect()
        delete w.__replyObserver
        delete w.__readCurrentReply
        return text
      })

      // Force-flush the final text (bypasses any pending throttle timer so the
      // last chunk can never be dropped).
      throttle.push(finalText)
      throttle.flush()

      if (finalText === '') throw new Error('empty reply from DeepSeek')
      return finalText
    } finally {
      currentDeltaReceiver = null
      throttle.dispose()
      await cleanupObserver()
      sending = false
    }
  }

  return {
    check,
    showLogin,
    sendMessage,
    async dispose() {
      await context.close().catch(() => {})
    },
  }
}
