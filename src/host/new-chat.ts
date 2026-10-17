/**
 * Host "new chat" flow (Phase 07L).
 *
 * Companion starts a new conversation the same way a user does: by clicking
 * DeepSeek's REAL sidebar control. No private endpoint, no DOM attribute
 * writing, no new page.
 *
 * The two page-side helpers below are deliberately SELF-CONTAINED (they
 * reference no module-level values) because Playwright serializes them into the
 * browser context; they take the browser surface by injection, which keeps the
 * exact same code unit-testable in Node without a browser (same pattern as
 * `./toggle.ts`):
 *
 *   - `newChatInPage`      — locate the control by SEMANTIC LABEL (never a hash
 *                            class, never "the first sidebar button") and click
 *                            it exactly once. Zero or multiple candidates is a
 *                            SAFE FAILURE: the page is left untouched.
 *   - `newChatReadyInPage` — the confirmation condition: the SPA is on the
 *                            empty-chat pathname AND no message container is
 *                            left from the previous conversation.
 *
 * `handleNewChatRequest` wraps both with the Host rules: browser not ready →
 * 503, a reply is streaming → 409, and the shared transcript is cleared ONLY
 * after the page switch was confirmed (page first, Host second — never the
 * other way round).
 */
import type { PageGuard } from './guard.ts'
import type { CompanionStateStore } from './state.ts'

/** The DOM surface the page helpers need (`document` inside the page). */
export interface NewChatDom {
  querySelectorAll(selector: string): ArrayLike<unknown>
}

/** Injectable browser surface (real globals in the page, fakes in tests). */
export interface NewChatEnv {
  document?: NewChatDom
  location?: { pathname?: unknown }
  window?: Record<string, unknown>
}

export interface NewChatOptions {
  /** Labels identifying the control (multi-language, matched EXACTLY). */
  labels: string[]
  /** How many ancestors to walk up from a label looking for the click target. */
  maxAscend: number
  /**
   * Substring of the href of a conversation-history entry. A history entry is a
   * real link, but clicking it OPENS a conversation instead of starting one, so
   * it must never be treated as the control — even when a chat happens to be
   * titled like the label.
   */
  historyHrefMarker: string
}

/** What the locate-and-click step actually did. */
export type NewChatClickOutcome =
  /** The single real control was clicked. */
  | 'clicked'
  /** No plausible control on the page — nothing was clicked. */
  | 'missing'
  /** More than one plausible control — nothing was clicked (never guess). */
  | 'ambiguous'

export interface NewChatConfirmOptions {
  /** Message-container selector: a fresh chat keeps none of them. */
  messageSelector: string
  /** Pathname of the empty-chat state (`/`; the id is minted on first send). */
  emptyPath: string
}

/**
 * Locate DeepSeek's "new chat" control and click it exactly once.
 *
 * A candidate is an element whose OWN direct text (or `aria-label` / `title`)
 * exactly equals one of the labels. Direct text (not `textContent`) keeps a big
 * sidebar container from matching just because the label lives somewhere inside
 * it. The click target is the nearest ancestor that is a STANDARD clickable
 * element (`button` / `a` / `role=button|menuitem|link`). When the label sits in
 * a plain container — DeepSeek renders the control as a `div` — the label
 * element itself is clicked and the native click BUBBLES up to whatever handler
 * owns it. No React internals, no hash class, no DOM attribute writing.
 *
 * Ambiguity stays a SAFE FAILURE: with no candidate, or more than one, nothing
 * is clicked at all.
 */
export function newChatInPage(payload: { options: NewChatOptions; env?: NewChatEnv }): {
  outcome: NewChatClickOutcome
} {
  const options = payload.options
  const env: NewChatEnv = payload.env ?? (globalThis as unknown as NewChatEnv)
  const doc = env.document
  if (doc === undefined || doc === null) return { outcome: 'missing' }

  const squash = (value: unknown): string =>
    String(value ?? '')
      .replace(/\s+/g, '')
      .toLowerCase()
  const labels = options.labels.map(squash)

  const tagOf = (el: unknown): string => String((el as { tagName?: unknown }).tagName ?? '').toUpperCase()
  const attrOf = (el: unknown, name: string): string => {
    const node = el as { getAttribute?: (n: string) => unknown }
    if (typeof node.getAttribute !== 'function') return ''
    return String(node.getAttribute(name) ?? '')
  }
  const parentOf = (el: unknown): unknown =>
    (el as { parentElement?: unknown } | null | undefined)?.parentElement ?? null
  const contains = (parent: unknown, child: unknown): boolean => {
    const node = parent as { contains?: (n: unknown) => boolean }
    return typeof node.contains === 'function' ? node.contains(child) : false
  }

  /** The label candidates carried by ONE element. */
  const labelsOn = (el: unknown): string[] => {
    const out: string[] = []
    const nodes = (el as { childNodes?: ArrayLike<unknown> }).childNodes
    if (nodes !== undefined && nodes !== null) {
      let text = ''
      for (let i = 0; i < nodes.length; i += 1) {
        const child = nodes[i]
        if ((child as { nodeType?: unknown }).nodeType === 3) {
          text += String((child as { textContent?: unknown }).textContent ?? '')
        }
      }
      out.push(squash(text))
    }
    out.push(squash(attrOf(el, 'aria-label')), squash(attrOf(el, 'title')))
    return out
  }

  const matches = Array.from(doc.querySelectorAll('*')).filter((el) =>
    labelsOn(el).some((value) => value !== '' && labels.includes(value)),
  )
  // Keep the INNERMOST match: a container that also carries the label as a
  // descendant is never the control itself.
  const innermost = matches.filter((el) => !matches.some((other) => other !== el && contains(el, other)))

  const isHistoryEntry = (el: unknown): boolean =>
    tagOf(el) === 'A' && attrOf(el, 'href').includes(options.historyHrefMarker)

  /** Standard DOM clickable evidence only — never React internals. */
  const isStandardClickable = (el: unknown): boolean => {
    const tag = tagOf(el)
    if (tag === 'BUTTON' || tag === 'A') return true
    const role = attrOf(el, 'role')
    return role === 'button' || role === 'menuitem' || role === 'link'
  }

  const clickTargetOf = (label: unknown): unknown | null => {
    let el: unknown = label
    for (let i = 0; i <= options.maxAscend && el !== null; i += 1) {
      // A history entry looks clickable but navigates to a conversation.
      if (isHistoryEntry(el)) return null
      if (isStandardClickable(el)) return el
      el = parentOf(el)
    }
    // No standard control around the label: click the label element itself and
    // let the native click bubble to whoever owns the handler. Clicking a label
    // that happens to have no handler is a no-op, and the confirmation wait
    // still refuses to report success — never a wrong click on some other
    // widget.
    return label
  }

  const targets: unknown[] = []
  for (const el of innermost) {
    const target = clickTargetOf(el)
    if (target !== null && !targets.includes(target)) targets.push(target)
  }

  if (targets.length === 0) return { outcome: 'missing' }
  if (targets.length > 1) return { outcome: 'ambiguous' }
  const target = targets[0]
  const click = (target as { click?: unknown }).click
  if (typeof click !== 'function') return { outcome: 'missing' }
  ;(click as () => void).call(target)
  return { outcome: 'clicked' }
}

/**
 * The confirmation condition: the SPA is on the empty-chat pathname and every
 * message container of the previous conversation is gone. Used as a bounded
 * `page.waitForFunction` predicate (never a fixed sleep).
 */
export function newChatReadyInPage(payload: { options: NewChatConfirmOptions; env?: NewChatEnv }): boolean {
  const options = payload.options
  const env: NewChatEnv = payload.env ?? (globalThis as unknown as NewChatEnv)
  const doc = env.document
  const location = env.location
  if (doc === undefined || doc === null || location === undefined || location === null) return false
  if (String(location.pathname ?? '') !== options.emptyPath) return false
  return doc.querySelectorAll(options.messageSelector).length === 0
}

/** Coerce a value arriving from the page into a trusted click outcome. */
export function normalizeNewChatOutcome(value: unknown): NewChatClickOutcome {
  const raw = value !== null && typeof value === 'object' ? (value as { outcome?: unknown }).outcome : undefined
  if (raw === 'clicked' || raw === 'ambiguous') return raw
  return 'missing'
}

// --- Host-side request flow -------------------------------------------------

/** Just the browser capability this flow needs (keeps the unit test trivial). */
export interface NewChatCapableBrowser {
  /**
   * Click DeepSeek's REAL "New chat" control and resolve ONLY once the SPA
   * confirmed the switch (empty-chat pathname + no message DOM left). Throws
   * when the control is missing/ambiguous or the switch never happened.
   */
  newChat(): Promise<void>
}

export interface ChatNewResult {
  status: 200 | 409 | 500 | 503
  body: { ok?: boolean; error?: string }
}

//   503 browser not ready · 409 while a reply streams OR another page op runs
//   200 new chat confirmed + Host transcript cleared
//   500 the control/page failed — the Host transcript is left UNTOUCHED
export async function handleNewChatRequest(
  store: CompanionStateStore,
  browser: NewChatCapableBrowser | null,
  guard: PageGuard,
): Promise<ChatNewResult> {
  if (browser === null) return { status: 503, body: { error: 'browser not ready' } }
  // A reply is streaming: the page belongs to that send. The Host refuses
  // instead of yanking the conversation out from under it.
  if (store.getState().chat.sending) return { status: 409, body: { error: 'chat is busy' } }
  // Claim the page for the whole switch. A second request (another surface, a
  // history switch, or a double click that slipped past the UI) is refused here
  // — the real control is clicked exactly once, by the request that won.
  if (!guard.tryClaim()) return { status: 409, body: { error: 'page operation in progress' } }
  try {
    // Page FIRST: only a confirmed new conversation may clear the transcript.
    await browser.newChat()
    store.clearChatMessages()
    // Phase 08.2: the page really is on the empty-chat path — there is no
    // conversation yet. The id DeepSeek mints on the first send is adopted by
    // the session watcher when that navigation arrives.
    store.setCurrentSession({ id: null, title: null })
    return { status: 200, body: { ok: true } }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { status: 500, body: { error: detail } }
  } finally {
    // Success, page failure or a thrown error — the page is free again.
    guard.release()
  }
}
