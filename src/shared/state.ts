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

/** A single chat message owned by the Host (Phase 07C.1 / 07E / 07F). */
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  format: ChatFormat
  /** Only present when DeepSeek produced reasoning for this reply. */
  reasoning?: ChatReasoning
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

export interface CompanionState {
  status: 'ready'
  revision: number
  instanceId: string
  deepseek: {
    status: DeepSeekStatus
    deepThink: DeepThinkState
    /** Phase 07H: both switches are re-read together after any change. */
    search: SearchState
  }
  chat: {
    messages: ChatMessage[]
    sending: boolean
  }
}
