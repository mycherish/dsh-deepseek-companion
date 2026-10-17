/**
 * DeepSeek history sessions (Phase 08).
 *
 * Companion can LIST the sidebar's history entries and SWITCH the current
 * conversation — nothing else: no multi-session cache, no delete, no rename,
 * no search.
 *
 * Every page helper below is SELF-CONTAINED (they reference no module-level
 * values) because Playwright serializes them into the browser context; they
 * take the browser surface by injection, which keeps the exact same code
 * unit-testable in Node without a browser (same pattern as `./toggle.ts`).
 *
 * Everything here works on STANDARD DOM only: entries are anchors
 * (`a[href*="/a/chat/s/"]`), the conversation id comes from the href itself,
 * and the "active" entry is decided by comparing that id with the page's own
 * pathname. No hash class, no React fiber, and the title is never a key.
 */
import type { ChatAttachment, ChatMessageInput, ChatSessionSummary } from '../shared/state.ts'
import { resolveCitationsByBlock, type DomBlock } from './citations.ts'
import type { PageGuard } from './guard.ts'
import type { CompanionStateStore } from './state.ts'

/** Injectable browser surface (real globals in the page, fakes in tests). */
export interface SessionsEnv {
  document?: SessionsDom
  location?: { pathname?: unknown }
  window?: Record<string, unknown>
}

export interface SessionsDom {
  querySelectorAll(selector: string): ArrayLike<unknown>
}

export interface SessionLinkOptions {
  /** Semantic link selector: every history entry is a plain anchor. */
  linkSelector: string
  /** Path marker inside the href that precedes the conversation id. */
  hrefMarker: string
}

/** One history entry as read from the page (id from href, title from text). */
export interface SessionLink {
  id: string
  title: string
}

/**
 * Read every history entry in the sidebar, de-duplicated by id and in DOM
 * order. `currentId` is the conversation the page itself is showing (parsed
 * from its pathname), so "active" never relies on a styling class.
 */
export function readSessionsInPage(payload: { options: SessionLinkOptions; env?: SessionsEnv }): {
  sessions: SessionLink[]
  currentId: string | null
} {
  const options = payload.options
  const env: SessionsEnv = payload.env ?? (globalThis as unknown as SessionsEnv)
  const doc = env.document
  if (doc === undefined || doc === null) return { sessions: [], currentId: null }

  const idFrom = (value: string): string | null => {
    const at = value.indexOf(options.hrefMarker)
    if (at === -1) return null
    const rest = value.slice(at + options.hrefMarker.length)
    const id = rest.split(/[/?#]/)[0] ?? ''
    return id === '' ? null : id
  }
  const attrOf = (el: unknown, name: string): string => {
    const node = el as { getAttribute?: (n: string) => unknown }
    if (typeof node.getAttribute !== 'function') return ''
    return String(node.getAttribute(name) ?? '')
  }

  const seen = new Set<string>()
  const sessions: SessionLink[] = []
  const links = Array.from(doc.querySelectorAll(options.linkSelector))
  for (const el of links) {
    const id = idFrom(attrOf(el, 'href'))
    if (id === null || seen.has(id)) continue
    seen.add(id)
    sessions.push({
      id,
      title: String((el as { textContent?: unknown }).textContent ?? '')
        .trim()
        .slice(0, 200),
    })
  }

  const currentId = idFrom(String(env.location?.pathname ?? ''))
  return { sessions, currentId }
}

// --- switching ---------------------------------------------------------------

export interface SwitchChatOptions extends SessionLinkOptions {
  /** Conversation the caller wants to open. */
  conversationId: string
  /** Message container selector, used for the rebuild base. */
  messageSelector: string
}

/** What the locate-and-click step actually did. */
export type SwitchOutcome =
  /** The one entry with this id was clicked. */
  | 'clicked'
  /** No entry carries this id — nothing was clicked. */
  | 'missing'
  /** More than one entry carries this id — nothing was clicked. */
  | 'ambiguous'

/**
 * Page global holding the message nodes that existed BEFORE the switch. The
 * confirmation below uses their identity (not a count, not a fixed sleep) to
 * prove the DOM was really rebuilt.
 *
 * NOTE: both page helpers below write/read this key as an INLINE literal
 * (Playwright serializes them, so module constants do not exist in the page).
 * Keep the literal in sync with this constant.
 */
export const SWITCH_BASE_KEY = '__switchBase'

/**
 * Click the history entry whose href carries exactly this conversation id.
 *
 * The id is COMPARED (never interpolated into a selector), and the click is a
 * plain native click on the anchor — no private API. Before clicking, the
 * current message nodes are recorded on the page global so the Host can wait
 * for the rebuild.
 */
export function switchChatInPage(payload: { options: SwitchChatOptions; env?: SessionsEnv }): {
  outcome: SwitchOutcome
} {
  const options = payload.options
  const env: SessionsEnv = payload.env ?? (globalThis as unknown as SessionsEnv)
  const doc = env.document
  if (doc === undefined || doc === null) return { outcome: 'missing' }

  const idFrom = (value: string): string | null => {
    const at = value.indexOf(options.hrefMarker)
    if (at === -1) return null
    const rest = value.slice(at + options.hrefMarker.length)
    const id = rest.split(/[/?#]/)[0] ?? ''
    return id === '' ? null : id
  }
  const attrOf = (el: unknown, name: string): string => {
    const node = el as { getAttribute?: (n: string) => unknown }
    if (typeof node.getAttribute !== 'function') return ''
    return String(node.getAttribute(name) ?? '')
  }

  const matches = Array.from(doc.querySelectorAll(options.linkSelector)).filter(
    (el) => idFrom(attrOf(el, 'href')) === options.conversationId,
  )
  // Zero or several matches: never guess (a duplicated id must not be clicked).
  if (matches.length === 0) return { outcome: 'missing' }
  if (matches.length > 1) return { outcome: 'ambiguous' }

  const target = matches[0]
  const win = env.window
  if (win !== undefined) {
    // Inline key (not the module constant): this function is serialized into the
    // page, where module scope does not exist. Keep in sync with SWITCH_BASE_KEY.
    win['__switchBase'] = Array.from(doc.querySelectorAll(options.messageSelector)).slice(0, 60)
  }
  const click = (target as { click?: unknown }).click
  if (typeof click !== 'function') return { outcome: 'missing' }
  ;(click as () => void).call(target)
  return { outcome: 'clicked' }
}

/**
 * The confirmation condition: the page is on the target conversation AND every
 * message node recorded before the click is gone from the document. A bounded
 * `page.waitForFunction` predicate (never a fixed sleep).
 */
export function switchChatReadyInPage(payload: { options: SwitchChatOptions; env?: SessionsEnv }): boolean {
  const options = payload.options
  const env: SessionsEnv = payload.env ?? (globalThis as unknown as SessionsEnv)
  const doc = env.document
  const location = env.location
  if (doc === undefined || doc === null || location === undefined || location === null) return false

  const idFrom = (value: string): string | null => {
    const at = value.indexOf(options.hrefMarker)
    if (at === -1) return null
    const rest = value.slice(at + options.hrefMarker.length)
    const id = rest.split(/[/?#]/)[0] ?? ''
    return id === '' ? null : id
  }
  if (idFrom(String(location.pathname ?? '')) !== options.conversationId) return false

  // Inline key (not the module constant): see `switchChatInPage`.
  const base = env.window?.['__switchBase']
  if (Array.isArray(base)) {
    const stillAttached = base.some(
      (node) => node !== null && typeof node === 'object' && (node as { isConnected?: unknown }).isConnected === true,
    )
    if (stillAttached) return false
  }
  return true
}

// --- transcript restore -------------------------------------------------------

export interface TranscriptOptions {
  /** Message container selector. */
  messageSelector: string
  /** Primary assistant reply selector (also the role discriminator). */
  replySelector: string
  /** Fallback used only when the primary selector matches nothing page-wide. */
  replyFallback: string
  /** Reasoning container selector. */
  reasoningSelector: string
  /** How many `fiber.return` hops to scan for the raw Markdown prop. */
  maxFiberScan: number
}

/** One rebuilt transcript entry, still keyed to its page reply index. */
export interface TranscriptEntryRaw {
  role: 'user' | 'assistant'
  content: string
  format: 'text' | 'markdown'
  /** Reasoning text ('' when DeepSeek produced none). */
  reasoning: string
  /** Index into the assistant reply nodes (-1 for a user entry). */
  replyIndex: number
  /** Images structurally contained in this user message (Phase 18B). */
  attachments?: ChatAttachment[]
}

/**
 * Rebuild the CURRENT conversation's transcript from the page, in DOM order.
 *
 * Role is decided by structure — a message that contains the assistant reply
 * container is an assistant message, everything else is a user message — never
 * by a hash class. Assistant content prefers the raw Markdown DeepSeek keeps on
 * its React props (same bounded scan and same loose text check as `reply.ts`)
 * and falls back to the rendered text; reasoning is read from its own container.
 * Only plain data ever leaves the page.
 */
export function readTranscriptInPage(payload: { options: TranscriptOptions; env?: SessionsEnv }): {
  entries: TranscriptEntryRaw[]
} {
  const options = payload.options
  const env: SessionsEnv = payload.env ?? (globalThis as unknown as SessionsEnv)
  const doc = env.document
  if (doc === undefined || doc === null) return { entries: [] }

  /** Raw Markdown off the fiber chain, or null (mirrors `reply.ts`). */
  const scanMarkdown = (node: unknown): { content: string; format: 'markdown' } | null => {
    const rendered = String((node as { textContent?: unknown }).textContent ?? '').trim()
    // Strip Markdown markers + whitespace so raw source and rendered text can be
    // compared loosely. Kept inline: this function must stay self-contained.
    const strip = (value: string): string => {
      let out = ''
      for (const ch of value) {
        if ('#*`_~>!|-()[]{}'.includes(ch)) continue
        if (/\s/.test(ch)) continue
        out += ch
      }
      return out
    }
    const key = Object.keys(node as object).find((k) => k.startsWith('__reactFiber$'))
    if (key === undefined) return null
    let fiber: unknown = (node as Record<string, unknown>)[key]
    for (let depth = 0; depth < options.maxFiberScan && fiber != null; depth += 1) {
      const props = (fiber as { memoizedProps?: Record<string, unknown> | null }).memoizedProps
      if (props != null) {
        const markdown = props['markdown']
        if (typeof markdown === 'string' && markdown.trim() !== '') return { content: markdown, format: 'markdown' }
        const content = props['content']
        if (typeof content === 'string') {
          const stripped = strip(content)
          const probe = strip(rendered).slice(0, 24)
          if (stripped !== '' && probe !== '' && stripped.includes(probe)) return { content, format: 'markdown' }
        }
      }
      fiber = (fiber as { return?: unknown }).return
    }
    return null
  }

  const messages = Array.from(doc.querySelectorAll(options.messageSelector))
  // The fallback is a page-wide decision (same rule as the streaming reader):
  // it is only trusted when the primary selector matches nothing at all.
  const useFallback = doc.querySelectorAll(options.replySelector).length === 0

  const entries: TranscriptEntryRaw[] = []
  let replyIndex = -1
  for (const message of messages) {
    const reply =
      (message as { querySelector?: (s: string) => unknown }).querySelector?.(options.replySelector) ??
      (useFallback
        ? (message as { querySelector?: (s: string) => unknown }).querySelector?.(options.replyFallback)
        : null)
    if (reply === null || reply === undefined) {
      // Only images INSIDE this message can belong to it. One ambiguous image
      // invalidates the attachment set; never infer ownership by DOM order.
      const images = Array.from(
        (message as { querySelectorAll?: (s: string) => ArrayLike<unknown> }).querySelectorAll?.('img') ?? [],
      )
      const attachments: ChatAttachment[] = []
      const seen = new Set<string>()
      let validImages = true
      for (const image of images) {
        const node = image as { getAttribute?: (name: string) => unknown }
        const src = node.getAttribute?.('src')
        if (typeof src !== 'string' || src.length > 4096 || src.includes('#')) {
          validImages = false
          break
        }
        const relative = src.startsWith('/api/file?')
        let url: URL
        try {
          url = new URL(src, 'https://chat.deepseek.com')
        } catch {
          validImages = false
          break
        }
        if ((!relative && url.origin !== 'https://files.deepseeksvc.com') || url.pathname !== '/api/file') {
          validImages = false
          break
        }
        const ids = url.searchParams.getAll('file_id')
        const signatures = url.searchParams.getAll('state')
        const id = ids[0] ?? ''
        if (
          ids.length !== 1 ||
          !/^[a-zA-Z0-9_-]{1,128}$/.test(id) ||
          signatures.length !== 1 ||
          signatures[0] === '' ||
          seen.has(id)
        ) {
          validImages = false
          break
        }
        seen.add(id)
        const alt = node.getAttribute?.('alt')
        attachments.push({
          id,
          kind: 'image',
          name: typeof alt === 'string' && alt.trim() !== '' ? alt.trim().slice(0, 200) : null,
          remoteUrl: url.href,
        })
      }
      const entry: TranscriptEntryRaw = {
        role: 'user',
        content: String((message as { textContent?: unknown }).textContent ?? '').trim(),
        format: 'text',
        reasoning: '',
        replyIndex: -1,
      }
      if (validImages && attachments.length > 0) entry.attachments = attachments
      entries.push(entry)
      continue
    }
    replyIndex += 1
    const scanned = scanMarkdown(reply)
    const reasoningNode = (message as { querySelector?: (s: string) => unknown }).querySelector?.(
      options.reasoningSelector,
    )
    entries.push({
      role: 'assistant',
      content: scanned?.content ?? String((reply as { textContent?: unknown }).textContent ?? '').trim(),
      format: scanned?.format ?? 'text',
      reasoning:
        reasoningNode === null || reasoningNode === undefined
          ? ''
          : String((reasoningNode as { textContent?: unknown }).textContent ?? '').trim(),
      replyIndex,
    })
  }
  return { entries }
}

export interface ScrollMessagesOptions {
  /** Message container selector (used to find the real scroller). */
  messageSelector: string
}

/**
 * Scroll the chat's virtual list to the top or the bottom.
 *
 * DeepSeek renders the chat as a VIRTUAL list: only the messages around the
 * viewport exist in the DOM, so a switched-to conversation may hold just a few
 * nodes until the list is scrolled. Scrolling to the top makes the earlier
 * history render (verified: 5 → 16 nodes, scrollHeight 3545 → 8767).
 *
 * The scroller is the scroll-area ANCESTOR that can actually scroll — the inner
 * wrappers report `scrollHeight === clientHeight` and would silently do nothing.
 */
export function scrollMessagesInPage(payload: {
  options: ScrollMessagesOptions
  position: 'top' | 'bottom'
  env?: SessionsEnv
}): void {
  const env: SessionsEnv = payload.env ?? (globalThis as unknown as SessionsEnv)
  const doc = env.document
  if (doc === undefined || doc === null) return

  const messages = Array.from(doc.querySelectorAll(payload.options.messageSelector))
  const candidates: unknown[] = []
  let current: unknown = messages[0] ?? null
  while (current !== null && current !== undefined) {
    if (String((current as { className?: unknown }).className ?? '').includes('ds-scroll-area'))
      candidates.push(current)
    current = (current as { parentElement?: unknown }).parentElement ?? null
  }
  const scroller = candidates.find((el) => {
    const node = el as { scrollHeight?: unknown; clientHeight?: unknown }
    return (
      typeof node.scrollHeight === 'number' &&
      typeof node.clientHeight === 'number' &&
      node.scrollHeight > node.clientHeight + 10
    )
  })
  if (scroller === undefined) return
  const node = scroller as { scrollHeight: number; scrollTop: number }
  node.scrollTop = payload.position === 'top' ? 0 : node.scrollHeight
}

// --- rebuilding the Host transcript -------------------------------------------

/** Whether any assistant entry carries raw Markdown (i.e. blocks are needed). */
export function transcriptNeedsBlocks(entries: TranscriptEntryRaw[]): boolean {
  return entries.some((entry) => entry.role === 'assistant' && entry.format === 'markdown')
}

/**
 * Assemble the rebuilt transcript: user entries become plain text messages;
 * assistant entries keep their raw Markdown (or rendered text), their reasoning
 * and — only where the strict block rule can map them — their citations. Empty
 * user bubbles are dropped unless they contain proven image attachments.
 */
export function buildTranscript(entries: TranscriptEntryRaw[], blocksByReply: DomBlock[][]): ChatMessageInput[] {
  const messages: ChatMessageInput[] = []
  for (const entry of entries) {
    if (entry.role === 'user') {
      if (entry.content === '' && (entry.attachments?.length ?? 0) === 0) continue
      const message: ChatMessageInput = { role: 'user', content: entry.content, format: 'text' }
      if (entry.attachments?.length) message.attachments = entry.attachments
      messages.push(message)
      continue
    }
    const message: ChatMessageInput = { role: 'assistant', content: entry.content, format: entry.format }
    if (entry.reasoning !== '') message.reasoning = { content: entry.reasoning, format: 'text' }
    if (entry.format === 'markdown') {
      // Without raw Markdown there is no marker information to map, and an
      // unmappable block simply contributes nothing (the reply is unaffected).
      const citations = resolveCitationsByBlock({
        markdown: entry.content,
        domBlocks: blocksByReply[entry.replyIndex] ?? [],
      })
      if (citations.length > 0) message.citations = citations
    }
    messages.push(message)
  }
  return messages
}

// --- Host-side rules ----------------------------------------------------------

/**
 * Project a page read into the Host-facing summaries. `active` is decided by
 * comparing ids only — a repeated title never makes two entries "the same", and
 * a styling class is never consulted.
 */
export function toSessionSummaries(result: {
  sessions: SessionLink[]
  currentId: string | null
}): ChatSessionSummary[] {
  return result.sessions.map((entry) => ({
    id: entry.id,
    title: entry.title,
    active: result.currentId !== null && entry.id === result.currentId,
  }))
}

/** Extract the conversation id that follows `marker` in a path/href. */
export function conversationIdFromPath(value: string, marker: string): string | null {
  const at = value.indexOf(marker)
  if (at === -1) return null
  const rest = value.slice(at + marker.length)
  const id = rest.split(/[/?#]/)[0] ?? ''
  return id === '' ? null : id
}

/** DeepSeek conversation ids are uuid-like; anything else is rejected up front. */
export function isValidConversationId(value: string): boolean {
  return /^[0-9a-zA-Z_-]{8,64}$/.test(value)
}

/**
 * Whether reaching `targetId` still requires clicking a history link. When the
 * conversation is ALREADY the one on screen the page must never be clicked
 * again — it is simply re-read.
 */
export function needsSwitchChat(currentId: string | null, targetId: string): boolean {
  return currentId !== targetId
}

// --- where the page is (Phase 08.1) ------------------------------------------

/**
 * Where the DeepSeek page currently sits. THREE cases, never a bare id:
 *   - `session` — `/a/chat/s/<id>`
 *   - `empty`   — `/` (no conversation yet; the id is minted on first send)
 *   - `other`   — sign-in and anything else. It must NEVER touch the Host
 *                 transcript: only a page that is really an empty chat may be
 *                 cleared.
 */
export type SessionLocation = { kind: 'session'; id: string } | { kind: 'empty' } | { kind: 'other' }

/**
 * Classify a URL or a bare pathname. The conversation id is parsed from the
 * `/a/chat/s/<id>` path only — never from a hash class, never from the title.
 */
export function sessionLocationFromPath(value: string): SessionLocation {
  // Accept a full URL as well as a pathname.
  let pathname = value
  const schemeAt = value.indexOf('://')
  if (schemeAt !== -1) {
    const afterScheme = value.slice(schemeAt + 3)
    const slashAt = afterScheme.indexOf('/')
    pathname = slashAt === -1 ? '/' : afterScheme.slice(slashAt)
  } else {
    pathname = pathname.startsWith('/') ? pathname : `/${pathname}`
  }
  pathname = pathname.split(/[?#]/)[0] ?? ''
  if (pathname === '' || pathname === '/') return { kind: 'empty' }
  const id = conversationIdFromPath(pathname, '/a/chat/s/')
  if (id !== null && isValidConversationId(id)) return { kind: 'session', id }
  return { kind: 'other' }
}

/** Structural equality for two locations. */
export function sameLocation(a: SessionLocation, b: SessionLocation): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'session' && b.kind === 'session') return a.id === b.id
  return true
}

/** What this send knows about the conversation it is writing into. */
export interface SendSessionState {
  /** Where the page was when the send started. */
  startedAt: SessionLocation
  /** The id this send belongs to; `null` while the page is still `/`. */
  currentId: string | null
}

export type SendLocationVerdict =
  /** DeepSeek created the session FOR THIS send — not an external switch. */
  | 'accept-created'
  /** The user switched to another conversation (or started a new chat). */
  | 'external'
  /** Same conversation, or a page this send never acts on. */
  | 'ignore'

/**
 * Decide what a navigation means for the send that is currently streaming.
 *
 * A send started from `/` gets its session CREATED by DeepSeek a moment later;
 * that first id belongs to this round and must never be treated as an external
 * switch (otherwise a normal first message would interrupt itself). Only a
 * LATER, different conversation is external.
 */
export function classifyDuringSend(state: SendSessionState, next: SessionLocation): SendLocationVerdict {
  // Sign-in and unknown pages: nothing to do, and never a reason to interrupt.
  if (next.kind === 'other') return 'ignore'
  // The user hit "New chat" mid-generation: the page left this conversation.
  if (next.kind === 'empty') return 'external'
  if (state.currentId === null) {
    return state.startedAt.kind === 'empty' ? 'accept-created' : 'external'
  }
  return next.id === state.currentId ? 'ignore' : 'external'
}

// --- Host session sync controller (Phase 08.1) --------------------------------

/** The browser capability the sync needs (lazy: it is created asynchronously). */
export interface SessionSyncBrowser {
  readTranscript(): Promise<ChatMessageInput[]>
}

export interface SessionSyncController {
  /**
   * A main-frame navigation was observed (the browser already de-duplicated
   * identical locations). `createdBySend` marks the session DeepSeek created
   * for the in-flight send — recorded, never re-read.
   */
  onLocation(location: SessionLocation, info: { createdBySend: boolean }): void
  /** Record a location the Host itself has just synced (new chat / switch). */
  markKnown(location: SessionLocation): void
  /** Apply a pending external change (called once a send / page op has ended). */
  drain(): Promise<void>
}

/**
 * Keeps the Host transcript in step with the page when the USER navigates
 * inside DeepSeek itself.
 *
 * Page FIRST, Host second: a session is only replaced after its transcript was
 * read successfully, and an `empty` location only clears after the page really
 * is on `/`. A failed read keeps whatever the Host already shows, and the guard
 * is always released.
 *
 * Busy pages are never fought over: while a send streams or another page
 * operation holds the guard, the newest location is parked in `pending` and
 * applied on `drain()` (latest wins, events are never dropped).
 */
export function createSessionSyncController(deps: {
  /** Resolved lazily — the browser is created asynchronously. */
  browser: () => SessionSyncBrowser | null
  store: CompanionStateStore
  guard: PageGuard
  /**
   * The page moved to another conversation on its own (Phase 18A): any composer
   * draft the Host tracked belonged to the OLD page state and is dropped — a
   * draft is never migrated across conversations.
   */
  onDraftInvalidated?: () => void | Promise<void>
}): SessionSyncController {
  let lastKnown: SessionLocation | undefined
  let pending: SessionLocation | undefined

  const apply = async (location: SessionLocation): Promise<void> => {
    if (location.kind === 'other') return
    // The page belongs to another conversation now; its composer no longer holds
    // the draft this Host was tracking (Phase 18A). Drop it BEFORE the transcript
    // work, so a failed read cannot leave a stale draft behind.
    await deps.onDraftInvalidated?.()
    if (location.kind === 'empty') {
      // The page is really an empty chat (the location says so) — clear.
      deps.store.clearChatMessages()
      return
    }
    const browser = deps.browser()
    if (browser === null) throw new Error('browser not ready')
    const transcript = await browser.readTranscript()
    // Page first, Host second: the rebuilt transcript arrives tagged with the
    // conversation it was read from (Phase 08.2).
    deps.store.replaceChatMessages(transcript, location.id)
    deps.store.clearSessionUnverified(location.id)
  }

  const run = async (location: SessionLocation): Promise<void> => {
    if (!deps.guard.tryClaim()) {
      // Someone else owns the page right now — keep the newest location only.
      pending = location
      return
    }
    try {
      await apply(location)
      lastKnown = location
    } catch {
      // Keep the current transcript; a later navigation event can retry.
    } finally {
      pending = undefined
      deps.guard.release()
    }
  }

  return {
    onLocation(location, info) {
      // WHERE the page is is a URL fact, not a transcript fact (Phase 08.2), so
      // it is recorded before the read below: every surface's「当前」marker
      // follows the real page even when a transcript read is pending or fails.
      if (location.kind === 'session') {
        deps.store.setCurrentSession({ id: location.id, title: null })
        // DeepSeek minted this id FOR the running send: the messages that send
        // already wrote have no session id yet — they belong to it.
        if (info.createdBySend) deps.store.adoptSessionMessages(location.id)
      } else if (location.kind === 'empty') {
        deps.store.setCurrentSession({ id: null, title: null })
      }
      if (info.createdBySend) {
        // DeepSeek created this send's own session: it belongs to the running
        // send, whose flow already owns the transcript. Record, never sync.
        lastKnown = location
        return
      }
      if (lastKnown !== undefined && sameLocation(location, lastKnown)) return
      if (deps.store.getState().chat.sending || deps.guard.inProgress()) {
        pending = location // latest wins; nothing is dropped
        return
      }
      void run(location)
    },

    markKnown(location) {
      lastKnown = location
      if (pending !== undefined && sameLocation(pending, location)) pending = undefined
    },

    async drain() {
      const location = pending
      if (location === undefined) return
      if (lastKnown !== undefined && sameLocation(location, lastKnown)) {
        pending = undefined
        return
      }
      if (deps.store.getState().chat.sending || deps.guard.inProgress()) return
      await run(location)
    },
  }
}

/** Coerce a value arriving from the page into a trusted switch outcome. */
export function normalizeSwitchOutcome(value: unknown): SwitchOutcome {
  const raw = value !== null && typeof value === 'object' ? (value as { outcome?: unknown }).outcome : undefined
  if (raw === 'clicked' || raw === 'ambiguous') return raw
  return 'missing'
}

/** Coerce the session list read back from the page. */
export function normalizeSessionsResult(value: unknown): { sessions: SessionLink[]; currentId: string | null } {
  const raw = value !== null && typeof value === 'object' ? (value as { sessions?: unknown; currentId?: unknown }) : {}
  const sessions: SessionLink[] = []
  if (Array.isArray(raw.sessions)) {
    for (const entry of raw.sessions) {
      if (entry === null || typeof entry !== 'object') continue
      const { id, title } = entry as { id?: unknown; title?: unknown }
      if (typeof id !== 'string' || id === '') continue
      sessions.push({ id, title: typeof title === 'string' ? title : '' })
    }
  }
  const currentId = typeof raw.currentId === 'string' && raw.currentId !== '' ? raw.currentId : null
  return { sessions, currentId }
}

/** Coerce the transcript read back from the page. */
export function normalizeTranscript(value: unknown): { entries: TranscriptEntryRaw[] } {
  const raw = value !== null && typeof value === 'object' ? (value as { entries?: unknown }) : {}
  const entries: TranscriptEntryRaw[] = []
  if (Array.isArray(raw.entries)) {
    for (const entry of raw.entries) {
      if (entry === null || typeof entry !== 'object') continue
      const source = entry as {
        role?: unknown
        content?: unknown
        format?: unknown
        reasoning?: unknown
        replyIndex?: unknown
        attachments?: unknown
      }
      if (source.role !== 'user' && source.role !== 'assistant') continue
      if (typeof source.content !== 'string') continue
      const normalized: TranscriptEntryRaw = {
        role: source.role,
        content: source.content,
        format: source.format === 'markdown' ? 'markdown' : 'text',
        reasoning: typeof source.reasoning === 'string' ? source.reasoning : '',
        replyIndex: typeof source.replyIndex === 'number' ? source.replyIndex : -1,
      }
      if (source.role === 'user' && Array.isArray(source.attachments)) {
        const attachments: ChatAttachment[] = []
        let valid = true
        const seen = new Set<string>()
        for (const item of source.attachments) {
          if (item === null || typeof item !== 'object') {
            valid = false
            break
          }
          const image = item as Record<string, unknown>
          if (
            typeof image.id !== 'string' ||
            !/^[a-zA-Z0-9_-]{1,128}$/.test(image.id) ||
            image.kind !== 'image' ||
            seen.has(image.id) ||
            (image.name !== null && typeof image.name !== 'string') ||
            typeof image.remoteUrl !== 'string' ||
            image.remoteUrl.length > 4096 ||
            image.remoteUrl.includes('#')
          ) {
            valid = false
            break
          }
          let url: URL
          try {
            url = new URL(image.remoteUrl)
          } catch {
            valid = false
            break
          }
          if (
            (url.origin !== 'https://files.deepseeksvc.com' && url.origin !== 'https://chat.deepseek.com') ||
            url.pathname !== '/api/file' ||
            url.searchParams.getAll('file_id').length !== 1 ||
            url.searchParams.get('file_id') !== image.id ||
            url.searchParams.getAll('state').length !== 1 ||
            !url.searchParams.get('state')
          ) {
            valid = false
            break
          }
          seen.add(image.id)
          attachments.push({ id: image.id, kind: 'image', name: image.name, remoteUrl: image.remoteUrl })
        }
        if (valid && attachments.length > 0) normalized.attachments = attachments
      }
      entries.push(normalized)
    }
  }
  return { entries }
}

// --- Host-side request flows --------------------------------------------------

/** Just the browser capability these flows need (keeps the unit test trivial). */
export interface SessionsCapableBrowser {
  /** Read the sidebar's history entries (read-only projection). */
  listSessions(): Promise<ChatSessionSummary[]>
  /**
   * Open the given conversation: a no-op resolution when it is ALREADY the one
   * on screen, otherwise one native click plus a bounded confirmation. Throws
   * when the entry is missing/ambiguous or the page never switched.
   */
  switchChat(conversationId: string): Promise<void>
  /** Rebuild the transcript the page is currently showing. */
  readTranscript(): Promise<ChatMessageInput[]>
}

export interface ChatSessionsResult {
  status: 200 | 503
  body: { sessions?: ChatSessionSummary[]; error?: string }
}

//   503 browser not ready · 200 with what the sidebar actually shows
export async function handleListSessionsRequest(
  browser: SessionsCapableBrowser | null,
  /**
   * When given, this read also refreshes the Host's `currentSession` (Phase
   * 08.2): the sidebar's ACTIVE entry carries the title the URL alone cannot
   * give us. Only a found entry updates it — a partial/virtualized sidebar read
   * never erases a conversation that is already known.
   */
  store?: CompanionStateStore,
): Promise<ChatSessionsResult> {
  if (browser === null) return { status: 503, body: { error: 'browser not ready' } }
  try {
    const sessions = await browser.listSessions()
    const active = sessions.find((entry) => entry.active)
    if (store !== undefined && active !== undefined) {
      store.setCurrentSession({ id: active.id, title: active.title })
    }
    return { status: 200, body: { sessions } }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { status: 503, body: { error: detail } }
  }
}

export interface ChatSwitchResult {
  status: 200 | 400 | 409 | 500 | 503
  body: { switched?: boolean; messages?: number; error?: string }
}

//   400 malformed id · 503 browser not ready · 409 busy (send or another page op)
//   200 switched + transcript rebuilt   · 500 page failure (Host transcript kept)
export async function handleSwitchChatRequest(
  store: CompanionStateStore,
  browser: SessionsCapableBrowser | null,
  guard: PageGuard,
  body: unknown,
): Promise<ChatSwitchResult> {
  const requested: { conversationId?: unknown } =
    body !== null && typeof body === 'object' ? (body as { conversationId?: unknown }) : {}
  if (typeof requested.conversationId !== 'string' || !isValidConversationId(requested.conversationId)) {
    return { status: 400, body: { error: 'conversationId must be a valid id' } }
  }
  if (browser === null) return { status: 503, body: { error: 'browser not ready' } }
  // A reply is streaming: the page belongs to that send (and a switch would make
  // the live reader emit another conversation's text — verified in 08-0).
  if (store.getState().chat.sending) return { status: 409, body: { error: 'chat is busy' } }
  if (!guard.tryClaim()) return { status: 409, body: { error: 'page operation in progress' } }
  try {
    // Same conversation → the browser resolves without clicking.
    await browser.switchChat(requested.conversationId)
    // Page FIRST, Host second: the transcript is only replaced once the switch
    // AND the rebuild read both succeeded.
    const transcript = await browser.readTranscript()
    // Phase 08.2: the rebuilt messages are tagged with the conversation they
    // were read from, and the Host records where the page is now.
    store.replaceChatMessages(transcript, requested.conversationId)
    store.setCurrentSession({ id: requested.conversationId, title: null })
    store.clearSessionUnverified(requested.conversationId)
    return { status: 200, body: { switched: true, messages: transcript.length } }
  } catch (error) {
    // The current Host transcript is deliberately left untouched.
    const detail = error instanceof Error ? error.message : String(error)
    return { status: 500, body: { error: detail } }
  } finally {
    guard.release()
  }
}
