/**
 * Shared Companion Host state shape (Phase 07A).
 *
 * Host is the authoritative owner; Client only reads and displays it. This is
 * a pure type — no runtime dependency — so both the Host and Client bundles can
 * import it without pulling `node:*` into the browser.
 */

/** DeepSeek web session login state (Phase 07A). */
export type DeepSeekStatus = 'checking' | 'logged_in' | 'logged_out' | 'error'

/**
 * Unified connection status (Phase 08.2, extended by Phase 20A).
 *
 *   - `online`          — Browser/Page verified usable (logged-in DeepSeek page)
 *   - `recovering`      — single-flight recovery is executing (Phase 20A): Client
 *                         operations are disabled; does NOT mean login lost; never
 *                         changes `currentSession` / `messages` / `MessageStatus`.
 *   - `login_required`  — Browser/Page healthy but DeepSeek explicitly wants login
 *   - `offline`         — not usable: browser not created (yet), probing, or the
 *                         recovery failed / exhausted its budget / is unreachable
 *
 * `offline` deliberately covers `checking`/`error`/no-browser: a client that
 * wants the finer distinction still reads the legacy `deepseek.status`.
 */
export type ConnectionStatus = 'online' | 'recovering' | 'offline' | 'login_required'

/** The unified connection projection (Phase 08.2). */
export interface ConnectionState {
  status: ConnectionStatus
  /** Whether the Host's DeepSeek browser exists and can serve requests. */
  browserReady: boolean
}

/**
 * Map the legacy signals onto the unified connection status. Shared by the Host
 * store and the Client state reader, so both can never disagree about what
 * `online` means.
 */
export function connectionFrom(status: DeepSeekStatus, browserReady: boolean): ConnectionState {
  if (!browserReady) return { status: 'offline', browserReady: false }
  if (status === 'logged_in') return { status: 'online', browserReady: true }
  if (status === 'logged_out') return { status: 'login_required', browserReady: true }
  // `checking` / `error`: a browser exists but the pipeline is not usable yet.
  return { status: 'offline', browserReady: true }
}

/**
 * State of one DeepSeek composer switch (Phase 07G / 07H). The Host mirrors the
 * REAL state of the DeepSeek page — it is never optimistically pinned by the
 * Client.
 */
export interface ComposerToggleState {
  /** Whether the switch exists in the page (false when logged out / UI changed). */
  available: boolean
  /** Whether the switch is currently ON in the real DeepSeek page. */
  enabled: boolean
}

/**
 * The unified composer state (Phase 08.2 → 18A): what the composer row needs to
 * know, in ONE group. `sending` / `stopping` are Host-owned; `deepThink` /
 * `search` are the same objects the legacy `deepseek` mirror carries, so the two
 * projections can never drift apart.
 */
export interface ComposerState {
  /** A reply is streaming right now (the existing `chat.sending`). */
  sending: boolean
  /** A stop was requested for THIS send and the round has not ended yet. */
  stopping: boolean
  deepThink: DeepThinkState
  search: SearchState
  /**
   * Draft image attachments of the current composer (Phase 18A). Host-owned and
   * metadata-only: NEVER pixels, NEVER a temp path, NEVER a page blob URL.
   */
  attachments: ComposerAttachment[]
}

/** Upload lifecycle of one draft attachment (Phase 18A). */
export type ComposerAttachmentStatus = 'uploading' | 'ready' | 'error'

/**
 * One draft image in the composer (Phase 18A). This is what the three views
 * render as an attachment card — there is deliberately no preview/thumbnail
 * field, so no surface can accidentally start shipping image bytes.
 */
export interface ComposerAttachment {
  /** Host-minted id, unique for the plugin's lifetime. */
  id: string
  kind: 'image'
  /** Display name only — never used to build a filesystem path. */
  name: string
  mimeType: string
  bytes: number
  status: ComposerAttachmentStatus
  /** Human-readable failure reason; only present while `status === 'error'`. */
  error?: string
}

/**
 * One image that was really sent with a message (Phase 18A). The Host writes it
 * only after the completion request was observed AND its `ref_file_ids` matched
 * this round's snapshot — a message never claims images it cannot prove.
 */
export interface ChatAttachment {
  id: string
  kind: 'image'
  /** Original file name; `null` when it is not known (Phase 18B reads `img.alt`). */
  name: string | null
  mimeType?: string
  bytes?: number
  /** Signed history URL for display; absent on 18A live sends. */
  remoteUrl?: string
}

/**
 * Where the DeepSeek page currently is (Phase 08.2). Parsed from the page's own
 * URL only — never a hash class, never React internals, never the sidebar title
 * used as a key. `id: null` means "no conversation yet" (`/`).
 */
export interface CurrentSession {
  id: string | null
  /** Sidebar title of that entry when it is known — display only, never a key. */
  title: string | null
}

/** DeepSeek's "Deep Think" toggle mirror (Phase 07G). */
export type DeepThinkState = ComposerToggleState

/** DeepSeek's web-search ("智能搜索") toggle mirror (Phase 07H). */
export type SearchState = ComposerToggleState

/** Both composer switches at once, as read from the same page load (Phase 07H). */
export interface ComposerModeState {
  deepThink: DeepThinkState
  search: SearchState
}

/**
 * How a message's `content` must be rendered (Phase 07E). `markdown` means the
 * content is DeepSeek's raw Markdown source; `text` is plain rendered text.
 */
export type ChatFormat = 'text' | 'markdown'

/**
 * DeepSeek's reasoning ("Deep Think") text for one assistant reply (Phase 07F).
 * Kept strictly separate from the reply body — reasoning never merges into
 * `content`, and `content` never merges into reasoning.
 */
export interface ChatReasoning {
  content: string
  format: ChatFormat
}

/**
 * One resolved source behind a DeepSeek search answer (Phase 07I). Deliberately
 * minimal: DeepSeek exposes no stable title/snippet, so only what can actually
 * be verified is modelled. `marker` is the number used in the raw Markdown
 * (`[reference:N]` / `[citation:N]`).
 */
export interface Citation {
  marker: number
  url: string
  domain: string
}

/**
 * Lifecycle of one chat message (Phase 08.2). Optional so a state written by an
 * older Host stays readable — the reader treats a missing status as `finished`.
 */
export type MessageStatus = 'streaming' | 'finished' | 'interrupted' | 'error'

/** A single chat message owned by the Host (Phase 07C.1 / 07E / 07F / 07I). */
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  format: ChatFormat
  /** Lifecycle (Phase 08.2). Assistant messages start `streaming`. */
  status?: MessageStatus
  /** Conversation this message belongs to (Phase 08.2); absent until it is known. */
  sessionId?: string
  /**
   * DeepSeek's own `message_id` for this message (Phase 20B1). Written ONLY once
   * a history snapshot confirmed the binding through its parent chain — never
   * derived from a completion request (the request only carries the parent
   * anchor). The Host's own `id` stays the key; this is identity evidence.
   */
  deepSeekMessageId?: number
  /**
   * Images sent with this message. Phase 18A writes only after the completion
   * request's `ref_file_ids` match; Phase 18B rebuilds from the history DOM's
   * exact user-message containment and signed file URL.
   */
  attachments?: ChatAttachment[]
  /** Only present when DeepSeek produced reasoning for this reply. */
  reasoning?: ChatReasoning
  /**
   * Only present when DeepSeek hydrated real URLs onto this reply's citation
   * badges (Phase 07I). Always a best-effort late addition — absent until the
   * background hydration succeeds, and absent forever when it does not.
   */
  citations?: Citation[]
}

/**
 * One assistant reply read from the DeepSeek page (Phase 07E). This is the only
 * shape that crosses the browser-context boundary — never HTML, never a React
 * object, never a token.
 */
export interface AssistantReply {
  content: string
  format: ChatFormat
}

/**
 * One DeepSeek history entry as read from the sidebar (Phase 08). Read-only
 * projection: `id` comes from the entry's own href — never from a hash class,
 * and never from the title (two chats may share a title).
 */
export interface ChatSessionSummary {
  /** Conversation id parsed from the sidebar link's href. */
  id: string
  /** Sidebar title — display only, never a key. */
  title: string
  /** Whether this entry is the conversation currently open in the page. */
  active: boolean
}

/**
 * A chat message before the Host assigns its id (Phase 08 history restore).
 * Only the fields the Host already models — never React props, HTML or a token.
 */
export type ChatMessageInput = Omit<ChatMessage, 'id'>

export interface CompanionState {
  /** Host-state marker: the Host is up and publishing (never a page status). */
  status: 'ready'
  revision: number
  instanceId: string
  /** Unified connection projection (Phase 08.2). */
  connection: ConnectionState
  /** Where the DeepSeek page is right now (Phase 08.2). */
  currentSession: CurrentSession
  /** A confirmed recovery outcome worth showing after `recovering` ends. */
  recoveryNotice: 'session_deleted' | 'session_unverified' | null
  /**
   * Legacy login/composer mirror (Phase 07A → 07H). Kept for backward
   * compatibility: `deepseek.status` is still the source of the login texts, and
   * `deepseek.deepThink` / `.search` are the SAME objects as their `composer`
   * counterparts.
   */
  deepseek: {
    status: DeepSeekStatus
    deepThink: DeepThinkState
    /** Phase 07H: both switches are re-read together after any change. */
    search: SearchState
  }
  /** Unified composer state (Phase 08.2). */
  composer: ComposerState
  /**
   * Legacy transcript group. `chat.sending` stays the authoritative single-flight
   * gate (the Host refuses concurrent sends on it) and always equals
   * `composer.sending`.
   */
  chat: {
    messages: ChatMessage[]
    sending: boolean
  }
}
