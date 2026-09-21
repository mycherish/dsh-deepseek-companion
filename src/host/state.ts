/**
 * Companion Host state store (Phase 07A).
 *
 * The Host owns the authoritative, subscribable Companion state. `instanceId`
 * is minted once per Host process; `revision` increments when the Host bumps
 * the state; `deepseek.status` tracks the DeepSeek web session login state and
 * updates independently of `revision`. Every change notifies all listeners.
 */
import { randomUUID } from 'node:crypto'
import type {
  ChatFormat,
  ChatMessage,
  CompanionState,
  DeepSeekStatus,
  DeepThinkState,
  SearchState,
} from '../shared/state.ts'

export type StateListener = (state: CompanionState) => void

export interface CompanionStateStore {
  getState(): CompanionState
  subscribe(listener: StateListener): () => void
  bumpRevision(): void
  setDeepSeekStatus(status: DeepSeekStatus): void
  setDeepThinkState(state: DeepThinkState): void
  setSearchState(state: SearchState): void
  appendChatMessage(role: ChatMessage['role'], content: string, format?: ChatFormat): ChatMessage
  updateChatMessage(id: string, content: string, format?: ChatFormat): void
  updateChatReasoning(id: string, content: string, format: ChatFormat): void
  setChatSending(sending: boolean): void
  dispose(): void
}

export function createCompanionStateStore(): CompanionStateStore {
  let state: CompanionState = {
    status: 'ready',
    revision: 1,
    instanceId: randomUUID(),
    deepseek: {
      status: 'checking',
      deepThink: { available: false, enabled: false },
      search: { available: false, enabled: false },
    },
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
      state = { ...state, deepseek: { ...state.deepseek, deepThink: next } }
      notify(state)
    },

    setSearchState(next: SearchState) {
      if (disposed) return
      const current = state.deepseek.search
      if (current.available === next.available && current.enabled === next.enabled) return
      state = { ...state, deepseek: { ...state.deepseek, search: next } }
      notify(state)
    },

    setDeepSeekStatus(status: DeepSeekStatus) {
      if (disposed) return
      if (state.deepseek.status === status) return
      state = { ...state, deepseek: { ...state.deepseek, status } }
      notify(state)
    },

    appendChatMessage(role: ChatMessage['role'], content: string, format: ChatFormat = 'text'): ChatMessage {
      const message: ChatMessage = { id: randomUUID(), role, content, format }
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

    setChatSending(sending: boolean) {
      if (disposed) return
      if (state.chat.sending === sending) return
      state = { ...state, chat: { ...state.chat, sending } }
      notify(state)
    },

    dispose() {
      disposed = true
      listeners.clear()
    },
  }
}
