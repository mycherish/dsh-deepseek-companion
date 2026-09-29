/**
 * Client Companion Host-state reader (Phase 06C).
 *
 * One shared reader used by both Dock and Pop-out, so neither view owns its own
 * copy of the state shape. `origin` is the parent DSH page origin (the pop-out
 * is `about:blank`, so it must not rely on its own relative URL).
 */
import { connectionFrom } from '../shared/state.ts'
import type {
  ChatAttachment,
  ChatMessage,
  ChatSessionSummary,
  Citation,
  CompanionState,
  ComposerAttachment,
  ComposerAttachmentStatus,
  ComposerState,
  ConnectionState,
  CurrentSession,
  DeepSeekStatus,
  DeepThinkState,
  MessageStatus,
  SearchState,
} from '../shared/state.ts'

export type { CompanionState }

/** Read-only Host route returning the shared Companion state. */
const STATE_PATH = '/api/deepseek-companion/state'
/** Read-only SSE stream route. */
const STREAM_PATH = '/api/deepseek-companion/state/stream'
/** POST route to focus/reopen the DeepSeek login page. */
const SHOW_PATH = '/api/deepseek-companion/browser/show'
/** POST route to send one chat message and await the final reply. */
const CHAT_PATH = '/api/deepseek-companion/chat'
/** POST route to flip DeepSeek's Deep Think toggle (Phase 07G). */
const DEEP_THINK_PATH = '/api/deepseek-companion/deep-think'
/** POST route to flip DeepSeek's web-search toggle (Phase 07H). */
const SEARCH_PATH = '/api/deepseek-companion/search'

/**
 * Ask the Host to switch DeepSeek's Deep Think toggle and resolve with the REAL
 * state it read back from the page (the Client never keeps its own truth).
 */
export async function setDeepThink(origin: string, enabled: boolean): Promise<DeepThinkState> {
  const response = await fetch(`${origin}${DEEP_THINK_PATH}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  })
  const body = (await response.json().catch(() => null)) as
    | { available?: unknown; enabled?: unknown; error?: unknown }
    | null
  if (!response.ok) {
    throw new Error(typeof body?.error === 'string' ? body.error : `HTTP ${response.status}`)
  }
  return { available: body?.available === true, enabled: body?.enabled === true }
}

/**
 * Ask the Host to switch DeepSeek's web-search toggle and resolve with the REAL
 * state it read back from the page (the Client never keeps its own truth).
 */
export async function setSearch(origin: string, enabled: boolean): Promise<SearchState> {
  const response = await fetch(`${origin}${SEARCH_PATH}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  })
  const body = (await response.json().catch(() => null)) as
    | { available?: unknown; enabled?: unknown; error?: unknown }
    | null
  if (!response.ok) {
    throw new Error(typeof body?.error === 'string' ? body.error : `HTTP ${response.status}`)
  }
  return { available: body?.available === true, enabled: body?.enabled === true }
}

/** POST route that stops the in-flight DeepSeek generation (Phase 07J). */
const STOP_PATH = '/api/deepseek-companion/chat/stop'

/** POST route that starts a new DeepSeek chat (Phase 07L). */
const NEW_CHAT_PATH = '/api/deepseek-companion/chat/new'

/** GET route listing the sidebar's history sessions (Phase 08). */
const SESSIONS_PATH = '/api/deepseek-companion/chat/sessions'
/** POST route switching the current conversation (Phase 08). */
const SWITCH_PATH = '/api/deepseek-companion/chat/switch'

/**
 * Read the DeepSeek history sessions the Host can currently see. Read-only: the
 * list is a projection of the sidebar, never cached by this view.
 */
export async function fetchChatSessions(origin: string): Promise<ChatSessionSummary[]> {
  const response = await fetch(`${origin}${SESSIONS_PATH}`, { credentials: 'include' })
  const body = (await response.json().catch(() => null)) as { sessions?: unknown; error?: unknown } | null
  if (!response.ok) {
    throw new Error(typeof body?.error === 'string' ? body.error : `HTTP ${response.status}`)
  }
  const sessions: ChatSessionSummary[] = []
  if (Array.isArray(body?.sessions)) {
    for (const entry of body.sessions) {
      if (entry === null || typeof entry !== 'object') continue
      const { id, title, active } = entry as { id?: unknown; title?: unknown; active?: unknown }
      if (typeof id !== 'string' || id === '') continue
      sessions.push({ id, title: typeof title === 'string' ? title : '', active: active === true })
    }
  }
  return sessions
}

/**
 * Ask the Host to switch to a history conversation and resolve with the number
 * of messages the rebuilt transcript holds. The Host clicks the real DeepSeek
 * link and only replaces the transcript once the switch is confirmed; this view
 * never clears anything locally.
 */
export async function switchChatSession(origin: string, conversationId: string): Promise<number> {
  const response = await fetch(`${origin}${SWITCH_PATH}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId }),
  })
  const body = (await response.json().catch(() => null)) as { messages?: unknown; error?: unknown } | null
  if (!response.ok) {
    throw new Error(typeof body?.error === 'string' ? body.error : `HTTP ${response.status}`)
  }
  return typeof body?.messages === 'number' ? body.messages : 0
}

/**
 * Ask the Host to start a new DeepSeek conversation. The Host clicks the real
 * DeepSeek control, confirms the switch, THEN clears the shared transcript — so
 * this view never clears anything locally: the SSE push does it, on every
 * surface at once.
 */
export async function startNewChat(origin: string): Promise<void> {
  const response = await fetch(`${origin}${NEW_CHAT_PATH}`, {
    method: 'POST',
    credentials: 'include',
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: unknown } | null
    throw new Error(typeof body?.error === 'string' ? body.error : `HTTP ${response.status}`)
  }
}

/**
 * Ask the Host to stop the current generation. Resolves `true` when a stop was
 * actually requested of the DeepSeek page; the partial reply stays in the Host
 * state and `chat.sending` flips back to false through the normal send flow.
 */
export async function stopChatMessage(origin: string): Promise<boolean> {
  const response = await fetch(`${origin}${STOP_PATH}`, {
    method: 'POST',
    credentials: 'include',
  })
  const body = (await response.json().catch(() => null)) as { stopped?: unknown; error?: unknown } | null
  if (!response.ok) {
    throw new Error(typeof body?.error === 'string' ? body.error : `HTTP ${response.status}`)
  }
  return body?.stopped === true
}

/** Ask the Host to focus (or reopen) the DeepSeek login page. */
export async function showDeepSeekBrowser(origin: string): Promise<void> {
  const response = await fetch(`${origin}${SHOW_PATH}`, {
    method: 'POST',
    credentials: 'include',
  })
  if (!response.ok) throw new Error(`show browser failed (HTTP ${response.status})`)
}

/** Send one message and resolve with the final complete reply text. */
export async function sendChatMessage(origin: string, message: string): Promise<string> {
  const response = await fetch(`${origin}${CHAT_PATH}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  })
  if (!response.ok) {
    let detail = `HTTP ${response.status}`
    try {
      const body = (await response.json()) as { error?: unknown }
      if (typeof body.error === 'string') detail = body.error
    } catch {
      // keep the HTTP detail
    }
    throw new Error(detail)
  }
  const body = (await response.json()) as { reply?: unknown }
  if (typeof body.reply !== 'string') throw new Error('invalid reply from Host')
  return body.reply
}

/** POST route that adds / removes one draft image (Phase 18A). */
const ATTACHMENT_PATH = '/api/deepseek-companion/chat/attachment'

/**
 * Ask the Host to take ONE image into the composer draft (Phase 18A). The Host
 * validates the bytes (magic MIME, strict base64, limits), drives the REAL
 * DeepSeek upload and returns the draft entry it recorded — `status` may be
 * `uploading`, `ready` or `error`, and the card is rendered from Host state.
 * The caller keeps the base64 only until this promise settles.
 */
export async function addChatAttachment(
  origin: string,
  input: { name: string; mimeType: string; dataBase64: string },
): Promise<ComposerAttachment> {
  const response = await fetch(`${origin}${ATTACHMENT_PATH}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'add', ...input }),
  })
  const body = (await response.json().catch(() => null)) as { attachment?: unknown; error?: unknown } | null
  if (!response.ok) {
    throw new Error(typeof body?.error === 'string' ? body.error : `HTTP ${response.status}`)
  }
  const attachment = normalizeComposerAttachment(body?.attachment)
  if (attachment === null) throw new Error('invalid attachment from Host')
  return attachment
}

/**
 * Ask the Host to drop ONE draft image (Phase 18A). The Host removes the real
 * page card first and only then forgets the draft entry — a failure leaves both
 * sides untouched, so this view never edits its own attachment list.
 */
export async function removeChatAttachment(origin: string, id: string): Promise<void> {
  const response = await fetch(`${origin}${ATTACHMENT_PATH}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'remove', id }),
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: unknown } | null
    throw new Error(typeof body?.error === 'string' ? body.error : `HTTP ${response.status}`)
  }
}

// --- state compatibility layer (Phase 08.2) -----------------------------------
// The Client never trusts the wire shape blindly: every snapshot and every SSE
// event goes through one normalizer, so the unified fields (`connection`,
// `currentSession`, `composer`, message `status` / `sessionId`) exist even when
// a state written by an older Host arrives without them. The legacy fields are
// the fallback — never a second source on top of the new ones.

const DEEPSEEK_STATUSES: DeepSeekStatus[] = ['checking', 'logged_in', 'logged_out', 'error']
const CONNECTION_STATUSES: ConnectionState['status'][] = ['online', 'recovering', 'offline', 'login_required']
const MESSAGE_STATUSES: MessageStatus[] = ['streaming', 'finished', 'interrupted', 'error']

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function normalizeToggle(raw: unknown): DeepThinkState {
  const value = asRecord(raw)
  return { available: value.available === true, enabled: value.enabled === true }
}

function normalizeMessageStatus(raw: unknown): MessageStatus {
  return MESSAGE_STATUSES.includes(raw as MessageStatus) ? (raw as MessageStatus) : 'finished'
}

const COMPOSER_ATTACHMENT_STATUSES: ComposerAttachmentStatus[] = ['uploading', 'ready', 'error']

/**
 * One draft attachment, or `null` when it is not usable. Metadata only: an
 * unknown field (say a preview URL a future Host might add) is dropped here, so
 * no view can start rendering image bytes by accident (Phase 18A).
 */
function normalizeComposerAttachment(raw: unknown): ComposerAttachment | null {
  const value = asRecord(raw)
  if (typeof value.id !== 'string' || value.id === '') return null
  if (typeof value.name !== 'string') return null

  const status: ComposerAttachmentStatus = COMPOSER_ATTACHMENT_STATUSES.includes(
    value.status as ComposerAttachmentStatus,
  )
    ? (value.status as ComposerAttachmentStatus)
    : 'error'

  const attachment: ComposerAttachment = {
    id: value.id,
    kind: 'image',
    name: value.name,
    mimeType: typeof value.mimeType === 'string' ? value.mimeType : '',
    bytes: typeof value.bytes === 'number' && Number.isFinite(value.bytes) ? value.bytes : 0,
    status,
  }
  if (status === 'error' && typeof value.error === 'string' && value.error !== '') {
    attachment.error = value.error
  }
  return attachment
}

/** One already-sent attachment, or `null` when it is not usable (Phase 18A). */
function normalizeChatAttachment(raw: unknown): ChatAttachment | null {
  const value = asRecord(raw)
  if (typeof value.id !== 'string' || value.id === '') return null

  const attachment: ChatAttachment = {
    id: value.id,
    kind: 'image',
    name: typeof value.name === 'string' ? value.name : null,
  }
  if (typeof value.mimeType === 'string' && value.mimeType !== '') attachment.mimeType = value.mimeType
  if (typeof value.bytes === 'number' && Number.isFinite(value.bytes)) attachment.bytes = value.bytes
  if (typeof value.remoteUrl === 'string' && value.remoteUrl !== '') attachment.remoteUrl = value.remoteUrl
  return attachment
}

function normalizeCitations(raw: unknown): Citation[] {
  if (!Array.isArray(raw)) return []
  const citations: Citation[] = []
  for (const entry of raw) {
    const value = asRecord(entry)
    if (typeof value.marker !== 'number' || typeof value.url !== 'string' || typeof value.domain !== 'string') continue
    citations.push({ marker: value.marker, url: value.url, domain: value.domain })
  }
  return citations
}

/** Coerce one wire message, or null when it carries no usable identity. */
function normalizeMessage(raw: unknown): ChatMessage | null {
  const value = asRecord(raw)
  if (typeof value.id !== 'string' || value.id === '') return null
  if (value.role !== 'user' && value.role !== 'assistant') return null
  if (typeof value.content !== 'string') return null

  const message: ChatMessage = {
    id: value.id,
    role: value.role,
    content: value.content,
    format: value.format === 'markdown' ? 'markdown' : 'text',
    status: normalizeMessageStatus(value.status),
  }
  if (typeof value.sessionId === 'string' && value.sessionId !== '') message.sessionId = value.sessionId
  // DeepSeek's own message id (Phase 20B1): a plain number, no content, so the
  // views may keep mirroring the Host state one-to-one.
  if (typeof value.deepSeekMessageId === 'number' && Number.isFinite(value.deepSeekMessageId)) {
    message.deepSeekMessageId = value.deepSeekMessageId
  }
  const reasoning = asRecord(value.reasoning)
  if (typeof reasoning.content === 'string' && reasoning.content !== '') {
    message.reasoning = { content: reasoning.content, format: reasoning.format === 'markdown' ? 'markdown' : 'text' }
  }
  const citations = normalizeCitations(value.citations)
  if (citations.length > 0) message.citations = citations
  const attachments: ChatAttachment[] = []
  if (Array.isArray(value.attachments)) {
    for (const entry of value.attachments) {
      const attachment = normalizeChatAttachment(entry)
      if (attachment !== null) attachments.push(attachment)
    }
  }
  // Absent means "no images in this message" — never an empty array (Phase 18A).
  if (attachments.length > 0) message.attachments = attachments
  return message
}

/**
 * Normalize one Host state payload (snapshot or SSE event) into the shape the
 * views rely on. Unknown/garbage input degrades to the initial state instead of
 * crashing a render.
 */
export function normalizeCompanionState(raw: unknown): CompanionState {
  const value = asRecord(raw)
  const deepseek = asRecord(value.deepseek)
  const status: DeepSeekStatus = DEEPSEEK_STATUSES.includes(deepseek.status as DeepSeekStatus)
    ? (deepseek.status as DeepSeekStatus)
    : 'checking'
  const deepThink = normalizeToggle(deepseek.deepThink)
  const search = normalizeToggle(deepseek.search)

  const chat = asRecord(value.chat)
  const sending = chat.sending === true
  const messages: ChatMessage[] = []
  if (Array.isArray(chat.messages)) {
    for (const entry of chat.messages) {
      const message = normalizeMessage(entry)
      if (message !== null) messages.push(message)
    }
  }

  const composerRaw = asRecord(value.composer)
  const attachments: ComposerAttachment[] = []
  if (Array.isArray(composerRaw.attachments)) {
    for (const entry of composerRaw.attachments) {
      const attachment = normalizeComposerAttachment(entry)
      if (attachment !== null) attachments.push(attachment)
    }
  }
  const composer: ComposerState = {
    sending: typeof composerRaw.sending === 'boolean' ? composerRaw.sending : sending,
    stopping: composerRaw.stopping === true,
    deepThink: 'deepThink' in composerRaw ? normalizeToggle(composerRaw.deepThink) : deepThink,
    search: 'search' in composerRaw ? normalizeToggle(composerRaw.search) : search,
    // An older Host never sends drafts → an empty draft, never `undefined`.
    attachments,
  }

  const connectionRaw = asRecord(value.connection)
  const connection: ConnectionState = CONNECTION_STATUSES.includes(connectionRaw.status as ConnectionState['status'])
    ? {
        status: connectionRaw.status as ConnectionState['status'],
        browserReady: connectionRaw.browserReady === true,
      }
    : // Older Host: derive it from the signals it does publish. A login RESULT
      // proves the browser exists; `checking`/`error` never claim it does.
      connectionFrom(status, status === 'logged_in' || status === 'logged_out')

  const sessionRaw = asRecord(value.currentSession)
  const currentSession: CurrentSession = {
    id: typeof sessionRaw.id === 'string' && sessionRaw.id !== '' ? sessionRaw.id : null,
    title: typeof sessionRaw.title === 'string' && sessionRaw.title !== '' ? sessionRaw.title : null,
  }

  return {
    status: 'ready',
    revision: typeof value.revision === 'number' ? value.revision : 0,
    instanceId: typeof value.instanceId === 'string' ? value.instanceId : '',
    connection,
    currentSession,
    recoveryNotice:
      value.recoveryNotice === 'session_deleted' || value.recoveryNotice === 'session_unverified'
        ? value.recoveryNotice
        : null,
    deepseek: { status, deepThink, search },
    composer,
    chat: { messages, sending },
  }
}

/** One-shot snapshot (still used for simple/fallback reads). */
export async function fetchCompanionState(origin: string, signal?: AbortSignal): Promise<CompanionState> {
  const response = await fetch(`${origin}${STATE_PATH}`, {
    credentials: 'include',
    signal,
  })
  if (!response.ok) throw new Error(`host state unavailable (HTTP ${response.status})`)
  return normalizeCompanionState(await response.json())
}

/**
 * Subscribe to the Host SSE stream. The Host pushes the current state on
 * connect and then every revision bump. Returns an unsubscribe function that
 * aborts the connection; no auto-reconnect in this phase.
 */
export function subscribeCompanionState(
  origin: string,
  onState: (state: CompanionState) => void,
  onError?: (error: unknown) => void,
): () => void {
  const controller = new AbortController()
  let disposed = false

  void (async () => {
    try {
      const response = await fetch(`${origin}${STREAM_PATH}`, {
        credentials: 'include',
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      if (!response.body) throw new Error('no stream body')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        let separator: number
        while ((separator = buffer.indexOf('\n\n')) !== -1) {
          const rawEvent = buffer.slice(0, separator)
          buffer = buffer.slice(separator + 2)
          const state = parseSseData(rawEvent)
          if (state !== null) onState(state)
        }
      }
    } catch (error) {
      if (disposed || (error instanceof Error && error.name === 'AbortError')) return
      onError?.(error)
    }
  })()

  return () => {
    disposed = true
    controller.abort()
  }
}

/** Parse one `data: {...}` SSE event body into a CompanionState, or null. */
function parseSseData(rawEvent: string): CompanionState | null {
  for (const line of rawEvent.split('\n')) {
    if (!line.startsWith('data: ')) continue
    const text = line.slice('data: '.length).trim()
    if (text === '') return null
    try {
      return normalizeCompanionState(JSON.parse(text))
    } catch {
      return null
    }
  }
  return null
}
