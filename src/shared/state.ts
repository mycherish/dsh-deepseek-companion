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
 * How a message's `content` must be rendered (Phase 07E). `markdown` means the
 * content is DeepSeek's raw Markdown source; `text` is plain rendered text.
 */
export type ChatFormat = 'text' | 'markdown'

/** A single chat message owned by the Host (Phase 07C.1 / 07E). */
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  format: ChatFormat
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
  }
  chat: {
    messages: ChatMessage[]
    sending: boolean
  }
}
