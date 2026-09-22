/**
 * Host chat send flow (Phase 07C.1 → 07D → 07E → 07I).
 *
 * Extracted from the route handler so the concurrency gate, single-message
 * streaming update (content + format), and finally-reset can be unit-tested
 * without a real browser or connection service.
 */
import type { AssistantReply, Citation } from '../shared/state.ts'
import type { CompanionStateStore } from './state.ts'

export interface ChatSendResult {
  status: 200 | 409 | 500
  body: { reply?: string; error?: string }
}

/**
 * Optional Host-side exclusion a send must respect (Phase 07L): while a
 * new-chat page switch is in flight the page belongs to that switch, so a send
 * is refused instead of racing it. Defined here (not imported from the new-chat
 * module) because a send only needs this one read.
 */
export interface ChatSendBlocker {
  inProgress(): boolean
}

export async function handleChatMessage(
  store: CompanionStateStore,
  send: (
    message: string,
    onDelta: (reply: AssistantReply) => void,
    onReasoning: (reply: AssistantReply) => void,
    onCitations: (citations: Citation[]) => void,
  ) => Promise<AssistantReply>,
  message: string,
  /** A new-chat switch owns the page right now → refuse without touching it. */
  newChatGuard?: ChatSendBlocker,
): Promise<ChatSendResult> {
  // A new-chat switch owns the page — never start a send against it, and never
  // append a user message that could not be sent.
  if (newChatGuard?.inProgress() === true) {
    return { status: 409, body: { error: 'new chat in progress' } }
  }
  // Concurrency gate: atomically claim the send slot before touching messages,
  // so a busy second request is rejected without a stray user message.
  if (store.getState().chat.sending) {
    return { status: 409, body: { error: 'chat is busy' } }
  }
  store.setChatSending(true)
  store.appendChatMessage('user', message)
  // One empty assistant message is created up front; every delta updates the
  // SAME message, so the message count never grows while streaming. Its format
  // may switch text -> markdown once DeepSeek's raw Markdown becomes available.
  const assistant = store.appendChatMessage('assistant', '')
  try {
    // Body and reasoning stay on two independent channels: each callback only
    // ever writes its own field on the SAME assistant message.
    const reply = await send(
      message,
      (delta) => store.updateChatMessage(assistant.id, delta.content, delta.format),
      (delta) => store.updateChatReasoning(assistant.id, delta.content, delta.format),
      // Best-effort and LATE: citations resolve after the reply is complete and
      // `sending` is already false. Bound to THIS assistant message id, so a
      // following send can never write its sources here (Phase 07I).
      (citations) => store.updateChatCitations(assistant.id, citations),
    )
    // Force-write the final reply even if the last delta was throttled/dropped.
    // An EMPTY final reply is not written: that is what a user-requested stop can
    // produce, and the partial content already streamed must be kept rather than
    // wiped (Phase 07J). Reasoning follows the same rule in `sendMessage`.
    if (reply.content !== '') store.updateChatMessage(assistant.id, reply.content, reply.format)
    return { status: 200, body: { reply: reply.content } }
  } catch (error) {
    // Keep the user message and any partial assistant text; never fabricate a
    // completion.
    const detail = error instanceof Error ? error.message : String(error)
    return { status: 500, body: { error: detail } }
  } finally {
    store.setChatSending(false)
  }
}
