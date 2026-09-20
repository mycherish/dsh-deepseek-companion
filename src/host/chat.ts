/**
 * Host chat send flow (Phase 07C.1 → 07D).
 *
 * Extracted from the route handler so the concurrency gate, single-message
 * streaming update, and finally-reset can be unit-tested without a real browser
 * or connection service.
 */
import type { CompanionStateStore } from './state.ts'

export interface ChatSendResult {
  status: 200 | 409 | 500
  body: { reply?: string; error?: string }
}

export async function handleChatMessage(
  store: CompanionStateStore,
  send: (message: string, onDelta: (text: string) => void) => Promise<string>,
  message: string,
): Promise<ChatSendResult> {
  // Concurrency gate: atomically claim the send slot before touching messages,
  // so a busy second request is rejected without a stray user message.
  if (store.getState().chat.sending) {
    return { status: 409, body: { error: 'chat is busy' } }
  }
  store.setChatSending(true)
  store.appendChatMessage('user', message)
  // One empty assistant message is created up front; every delta updates the
  // SAME message, so the message count never grows while streaming.
  const assistant = store.appendChatMessage('assistant', '')
  try {
    const reply = await send(message, (delta) => store.updateChatMessage(assistant.id, delta))
    // Force-write the final reply even if the last delta was throttled/dropped.
    store.updateChatMessage(assistant.id, reply)
    return { status: 200, body: { reply } }
  } catch (error) {
    // Keep the user message and any partial assistant text; never fabricate a
    // completion.
    const detail = error instanceof Error ? error.message : String(error)
    return { status: 500, body: { error: detail } }
  } finally {
    store.setChatSending(false)
  }
}
