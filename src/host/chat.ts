/**
 * Host chat send flow (Phase 07C.1).
 *
 * Extracted from the route handler so the concurrency gate and finally-reset
 * can be unit-tested without a real browser or connection service.
 */
import type { CompanionStateStore } from './state.ts'

export interface ChatSendResult {
  status: 200 | 409 | 500
  body: { reply?: string; error?: string }
}

export async function handleChatMessage(
  store: CompanionStateStore,
  send: (message: string) => Promise<string>,
  message: string,
): Promise<ChatSendResult> {
  // Concurrency gate: atomically claim the send slot before touching messages,
  // so a busy second request is rejected without a stray user message.
  if (store.getState().chat.sending) {
    return { status: 409, body: { error: 'chat is busy' } }
  }
  store.setChatSending(true)
  store.appendChatMessage('user', message)
  try {
    const reply = await send(message)
    store.appendChatMessage('assistant', reply)
    return { status: 200, body: { reply } }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { status: 500, body: { error: detail } }
  } finally {
    store.setChatSending(false)
  }
}
