/**
 * Companion Host state store (Phase 07A).
 *
 * The Host owns the authoritative, subscribable Companion state. `instanceId`
 * is minted once per Host process; `revision` increments when the Host bumps
 * the state; `deepseek.status` tracks the DeepSeek web session login state and
 * updates independently of `revision`. Every change notifies all listeners.
 */
import { randomUUID } from 'node:crypto'
import { connectionFrom } from '../shared/state.ts'
import type {
  ChatFormat,
  ChatMessage,
  ChatMessageInput,
  ChatReasoning,
  Citation,
  CompanionState,
  CurrentSession,
  DeepSeekStatus,
  DeepThinkState,
  MessageStatus,
  SearchState,
} from '../shared/state.ts'

export type StateListener = (state: CompanionState) => void

/** Structural equality for two citation lists (independent of object identity). */
function sameCitations(a: Citation[], b: Citation[]): boolean {
  if (a.length !== b.length) return false
  return a.every((entry, index) => {
    const other = b[index]!
    return entry.marker === other.marker && entry.url === other.url && entry.domain === other.domain
  })
}

function sameReasoning(a: ChatReasoning | undefined, b: ChatReasoning | undefined): boolean {
  if (a === undefined || b === undefined) return a === b
  return a.content === b.content && a.format === b.format
}

/**
 * Whether an incoming transcript is EQUIVALENT to the current one: same roles,
 * content, format, reasoning and citations — ids aside, since a re-read of the
 * same conversation mints fresh Host ids every time (Phase 08).
 */
/** Structural equality for the page's current conversation. */
function sameSession(a: CurrentSession, b: CurrentSession): boolean {
  return a.id === b.id && a.title === b.title
}

/**
 * Rebuild the unified `composer` group AND the legacy `deepseek` switches from
 * ONE write (Phase 08.2). `deepThink` / `search` end up as the SAME objects in
 * both projections, so the two can never drift apart; `chat.sending` and
 * `composer.sending` are likewise written together by `setChatSending`.
 */
function withComposer(
  state: CompanionState,
  next: { sending?: boolean; stopping?: boolean; deepThink?: DeepThinkState; search?: SearchState },
): CompanionState {
  const deepThink = next.deepThink ?? state.deepseek.deepThink
  const search = next.search ?? state.deepseek.search
  return {
    ...state,
    deepseek: { ...state.deepseek, deepThink, search },
    composer: {
      sending: next.sending ?? state.composer.sending,
      stopping: next.stopping ?? state.composer.stopping,
      deepThink,
      search,
    },
  }
}

/** Recompute the unified connection projection from its two real inputs. */
function withConnection(
  state: CompanionState,
  status: DeepSeekStatus,
  browserReady: boolean = state.connection.browserReady,
): CompanionState {
  return { ...state, connection: connectionFrom(status, browserReady) }
}

function equivalentMessages(current: ChatMessage[], next: ChatMessageInput[]): boolean {
  if (current.length !== next.length) return false
  return current.every((message, index) => {
    const other = next[index]!
    if (message.role !== other.role || message.content !== other.content || message.format !== other.format) return false
    if (!sameReasoning(message.reasoning, other.reasoning)) return false
    const a = message.citations
    const b = other.citations
    if (a === undefined || b === undefined) return a === b
    return sameCitations(a, b)
  })
}

export interface CompanionStateStore {
  getState(): CompanionState
  subscribe(listener: StateListener): () => void
  bumpRevision(): void
  setDeepSeekStatus(status: DeepSeekStatus): void
  /**
   * Whether the Host's DeepSeek browser exists (Phase 08.2). The ONLY thing that
   * makes the connection potentially usable — the login probe decides the rest.
   */
  setBrowserReady(ready: boolean): void
  /**
   * Record where the DeepSeek page is (Phase 08.2). Sources are standard DOM /
   * URL only (page pathname, sidebar href). A `title: null` update for the SAME
   * id keeps the title that is already known.
   */
  setCurrentSession(session: { id: string | null; title?: string | null }): void
  setDeepThinkState(state: DeepThinkState): void
  setSearchState(state: SearchState): void
  appendChatMessage(role: ChatMessage['role'], content: string, format?: ChatFormat): ChatMessage
  updateChatMessage(id: string, content: string, format?: ChatFormat): void
  updateChatReasoning(id: string, content: string, format: ChatFormat): void
  updateChatCitations(id: string, citations: Citation[]): void
  /** Record the lifecycle of one message (Phase 08.2). */
  setChatMessageStatus(id: string, status: MessageStatus): void
  /**
   * Give every message that does not carry a session id yet this conversation
   * (Phase 08.2): a send started from `/` writes its messages BEFORE DeepSeek
   * mints the id, and this is what binds them afterwards.
   */
  adoptSessionMessages(sessionId: string): void
  setChatSending(sending: boolean): void
  /**
   * A stop was requested for the in-flight send (Phase 08.2). Only meaningful
   * while `sending`; cleared automatically when the send ends, so a stale flag
   * can never outlive its round.
   */
  setComposerStopping(stopping: boolean): void
  /** Drop every chat message (new DeepSeek conversation, Phase 07L). */
  clearChatMessages(): void
  /**
   * Replace the whole transcript with a rebuilt one (history switch, Phase 08).
   * Fresh Host ids are minted for every entry; an equivalent transcript is a
   * no-op (no notify). `sessionId` tags every rebuilt message with the
   * conversation it was read from.
   */
  replaceChatMessages(messages: ChatMessageInput[], sessionId?: string): void
  dispose(): void
}

export function createCompanionStateStore(): CompanionStateStore {
  // One switch object per switch: both projections share these references.
  const deepThink: DeepThinkState = { available: false, enabled: false }
  const search: SearchState = { available: false, enabled: false }
  let state: CompanionState = {
    status: 'ready',
    revision: 1,
    instanceId: randomUUID(),
    connection: connectionFrom('checking', false),
    currentSession: { id: null, title: null },
    deepseek: { status: 'checking', deepThink, search },
    composer: { sending: false, stopping: false, deepThink, search },
    chat: { messages: [], sending: false },
  }
  const listeners = new Set<StateListener>()
  let disposed = false

  const notify = (next: CompanionState): void => {
    for (const listener of [...listeners]) {
      try {
        listener(next)
      } catch {
        // a failing listener must not break the store
      }
    }
  }

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener)
      try {
        listener(state)
      } catch {
        // a failing listener must not break the store
      }
      return () => {
        listeners.delete(listener)
      }
    },

    bumpRevision() {
      if (disposed) return
      state = { ...state, revision: state.revision + 1 }
      notify(state)
    },

    setDeepThinkState(next: DeepThinkState) {
      if (disposed) return
      const current = state.deepseek.deepThink
      if (current.available === next.available && current.enabled === next.enabled) return
      state = withComposer(state, { deepThink: next })
      notify(state)
    },

    setSearchState(next: SearchState) {
      if (disposed) return
      const current = state.deepseek.search
      if (current.available === next.available && current.enabled === next.enabled) return
      state = withComposer(state, { search: next })
      notify(state)
    },

    setDeepSeekStatus(status: DeepSeekStatus) {
      if (disposed) return
      if (state.deepseek.status === status) return
      // The legacy mirror and the unified connection view move together.
      state = withConnection({ ...state, deepseek: { ...state.deepseek, status } }, status)
      notify(state)
    },

    setBrowserReady(ready: boolean) {
      if (disposed) return
      if (state.connection.browserReady === ready) return
      state = withConnection(state, state.deepseek.status, ready)
      notify(state)
    },

    setCurrentSession(session: { id: string | null; title?: string | null }) {
      if (disposed) return
      const current = state.currentSession
      // A `null` title never erases a title that is already known for the SAME
      // conversation (the sidebar is read far less often than the URL changes).
      const title =
        session.title == null ? (session.id === current.id ? current.title : null) : session.title
      const next: CurrentSession = { id: session.id, title }
      if (sameSession(current, next)) return
      state = { ...state, currentSession: next }
      notify(state)
    },

    appendChatMessage(role: ChatMessage['role'], content: string, format: ChatFormat = 'text'): ChatMessage {
      const message: ChatMessage = {
        id: randomUUID(),
        role,
        content,
        format,
        // A user message is complete the moment it exists; an assistant message
        // is the streaming placeholder that `setChatMessageStatus` finalises.
        status: role === 'assistant' ? 'streaming' : 'finished',
        ...(state.currentSession.id !== null ? { sessionId: state.currentSession.id } : {}),
      }
      if (disposed) return message
      state = { ...state, chat: { ...state.chat, messages: [...state.chat.messages, message] } }
      notify(state)
      return message
    },

    updateChatMessage(id: string, content: string, format?: ChatFormat) {
      if (disposed) return
      const index = state.chat.messages.findIndex((message) => message.id === id)
      if (index === -1) return
      const existing = state.chat.messages[index]!
      const nextFormat = format ?? existing.format
      // No notify unless something actually changed (content OR format — a
      // streaming reply may switch text -> markdown with the same text prefix).
      if (existing.content === content && existing.format === nextFormat) return
      const messages = state.chat.messages.slice()
      messages[index] = { ...existing, content, format: nextFormat }
      state = { ...state, chat: { ...state.chat, messages } }
      notify(state)
    },

    updateChatReasoning(id: string, content: string, format: ChatFormat) {
      if (disposed) return
      // Empty reasoning means "none yet" (Deep Think off, or nothing streamed
      // so far) — never create an empty reasoning block.
      if (content === '') return
      const index = state.chat.messages.findIndex((message) => message.id === id)
      if (index === -1) return
      const existing = state.chat.messages[index]!
      // Reasoning sits BESIDE the body: content/format of the reply are untouched.
      const current = existing.reasoning
      if (current !== undefined && current.content === content && current.format === format) return
      const messages = state.chat.messages.slice()
      messages[index] = { ...existing, reasoning: { content, format } }
      state = { ...state, chat: { ...state.chat, messages } }
      notify(state)
    },

    updateChatCitations(id: string, citations: Citation[]) {
      if (disposed) return
      // An empty result means "not resolved (yet)" — never a state change.
      if (citations.length === 0) return
      const index = state.chat.messages.findIndex((message) => message.id === id)
      if (index === -1) return
      const existing = state.chat.messages[index]!
      const current = existing.citations
      if (current !== undefined && sameCitations(current, citations)) return
      // Citations sit BESIDE the reply: content / format / reasoning untouched.
      const messages = state.chat.messages.slice()
      messages[index] = { ...existing, citations }
      state = { ...state, chat: { ...state.chat, messages } }
      notify(state)
    },

    setChatMessageStatus(id: string, status: MessageStatus) {
      if (disposed) return
      const index = state.chat.messages.findIndex((message) => message.id === id)
      if (index === -1) return
      const existing = state.chat.messages[index]!
      // A message without a status is treated as finished, so setting exactly
      // that is a no-op (no redundant push).
      if ((existing.status ?? 'finished') === status) return
      const messages = state.chat.messages.slice()
      messages[index] = { ...existing, status }
      state = { ...state, chat: { ...state.chat, messages } }
      notify(state)
    },

    adoptSessionMessages(sessionId: string) {
      if (disposed) return
      if (state.chat.messages.every((message) => message.sessionId !== undefined)) return
      const messages = state.chat.messages.map((message) =>
        message.sessionId === undefined ? { ...message, sessionId } : message,
      )
      state = { ...state, chat: { ...state.chat, messages } }
      notify(state)
    },

    setChatSending(sending: boolean) {
      if (disposed) return
      if (state.chat.sending === sending) return
      // One write, three fields: the legacy gate, the unified composer view, and
      // the end of a stopping round (a stop can never outlive its send).
      state = withComposer({ ...state, chat: { ...state.chat, sending } }, {
        sending,
        stopping: sending ? state.composer.stopping : false,
      })
      notify(state)
    },

    setComposerStopping(stopping: boolean) {
      if (disposed) return
      // Only a streaming send can be stopped; a stale flag is never recorded.
      if (stopping && !state.chat.sending) return
      if (state.composer.stopping === stopping) return
      state = withComposer(state, { stopping })
      notify(state)
    },

    clearChatMessages() {
      if (disposed) return
      // Already empty → nothing to change, nothing to notify. Everything else
      // (`sending`, the composer switches, `deepseek.status`) is left alone:
      // this is a new conversation, not a reset of the Host.
      if (state.chat.messages.length === 0) return
      state = { ...state, chat: { ...state.chat, messages: [] } }
      notify(state)
    },

    replaceChatMessages(messages: ChatMessageInput[], sessionId?: string) {
      if (disposed) return
      // Re-reading the same conversation must not produce a redundant push: the
      // rebuilt transcript carries NEW ids, so equivalence ignores them.
      if (equivalentMessages(state.chat.messages, messages)) return
      const next = messages.map((message) => ({
        ...message,
        id: randomUUID(),
        // A rebuilt message is a finished one: it was read from a rendered page.
        status: 'finished' as MessageStatus,
        ...(sessionId !== undefined ? { sessionId } : {}),
      }))
      // One replacement, one notify. `sending` and everything under `deepseek`
      // are untouched — a switch never changes the login or composer state.
      state = { ...state, chat: { ...state.chat, messages: next } }
      notify(state)
    },

    dispose() {
      disposed = true
      listeners.clear()
    },
  }
}
