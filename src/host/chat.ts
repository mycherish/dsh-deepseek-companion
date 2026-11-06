/**
 * Host chat send flow (Phase 07C.1 → 07D → 07E → 07I).
 *
 * Extracted from the route handler so the concurrency gate, single-message
 * streaming update (content + format), and finally-reset can be unit-tested
 * without a real browser or connection service.
 */
import type { AssistantReply, Citation } from '../shared/state.ts'
import type { PageOperationBlocker } from './guard.ts'
import type { CompletionSubmission, SendAttachmentTransaction } from './send-attachments.ts'
import type { CompanionStateStore } from './state.ts'

export interface ChatSendResult {
  status: 200 | 409 | 500
  body: { reply?: string; error?: string; assistantMessageId?: string; instanceId?: string }
}

export async function handleChatMessage(
  store: CompanionStateStore,
  send: (
    message: string,
    onDelta: (reply: AssistantReply) => void,
    onReasoning: (reply: AssistantReply) => void,
    onCitations: (citations: Citation[]) => void,
    /**
     * Phase 18A: called exactly once at the commit point (the completion request
     * was observed). Absent for a browser that cannot report it.
     */
    onSubmitted?: (submitted: CompletionSubmission) => void | Promise<void>,
  ) => Promise<AssistantReply>,
  message: string,
  /** A page operation (new chat / history switch) owns the page right now → refuse without touching it. */
  pageGuard?: PageOperationBlocker,
  /**
   * Whether the round that just ended was interrupted ON PURPOSE (Phase 08.2):
   * a user-requested stop or an external conversation switch. Read after `send`
   * settled; it only decides the message's `status`, never the reply content.
   */
  wasInterrupted?: () => boolean,
  /**
   * The image half of this round (Phase 18A), present only when the composer
   * held a draft. Its `onSubmitted` fires at the commit point with the id of the
   * user message this round wrote — the ONLY moment `message.attachments` may be
   * written, and the moment after which the draft is never restored.
   */
  attachmentTransaction?: SendAttachmentTransaction,
  /**
   * The commit point, bound to THIS round's Host message ids (Phase 20B1). Fires
   * whether or not the round carried images: reconciliation needs the parent
   * anchor of every committed turn, not just the attachment ones.
   */
  onCommitted?: (submitted: CompletionSubmission, ids: { userMessageId: string; assistantMessageId: string }) => void,
): Promise<ChatSendResult> {
  if (store.getState().recoveryNotice === 'session_unverified') {
    return { status: 409, body: { error: 'recovered session is unverified' } }
  }
  // A page operation owns the page — never start a send against it, and never
  // append a user message that could not be sent.
  if (pageGuard?.inProgress() === true) {
    return { status: 409, body: { error: 'page operation in progress' } }
  }
  // Concurrency gate: atomically claim the send slot before touching messages,
  // so a busy second request is rejected without a stray user message.
  if (store.getState().chat.sending) {
    return { status: 409, body: { error: 'chat is busy' } }
  }
  store.setChatSending(true)
  const user = store.appendChatMessage('user', message)
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
      // The commit point, bound to THIS round's Host messages. Phase 20B1 always
      // records the parent anchor; Phase 18A additionally verifies the images
      // (and only then writes `attachments` on the user message).
      onCommitted === undefined && attachmentTransaction === undefined
        ? undefined
        : async (submitted) => {
            onCommitted?.(submitted, { userMessageId: user.id, assistantMessageId: assistant.id })
            await attachmentTransaction?.onSubmitted(submitted, user.id)
          },
    )
    // Force-write the final reply even if the last delta was throttled/dropped.
    // An EMPTY final reply is not written: that is what a user-requested stop can
    // produce, and the partial content already streamed must be kept rather than
    // wiped (Phase 07J). Reasoning follows the same rule in `sendMessage`.
    if (reply.content !== '') store.updateChatMessage(assistant.id, reply.content, reply.format)
    // Lifecycle only (Phase 08.2): a normal end is `finished`, and a round that
    // ended on purpose (stop / external switch) is `interrupted` — the partial
    // content that already streamed is kept either way.
    store.setChatMessageStatus(assistant.id, wasInterrupted?.() === true ? 'interrupted' : 'finished')
    return { status: 200, body: { reply: reply.content } }
  } catch (error) {
    // Keep the user message and any partial assistant text; never fabricate a
    // completion.
    store.setChatMessageStatus(assistant.id, 'error')
    const detail = error instanceof Error ? error.message : String(error)
    return {
      status: 500,
      body: { error: detail, assistantMessageId: assistant.id, instanceId: store.getState().instanceId },
    }
  } finally {
    store.setChatSending(false)
  }
}
