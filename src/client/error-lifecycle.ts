import type { CompanionState } from '../shared/state.ts'

/** The Host identifies the exact assistant message belonging to a failed send. */
export class ChatRequestError extends Error {
  readonly instanceId: string
  readonly assistantMessageId: string

  constructor(message: string, instanceId: string, assistantMessageId: string) {
    super(message)
    this.name = 'ChatRequestError'
    this.instanceId = instanceId
    this.assistantMessageId = assistantMessageId
  }
}

/** Resolve against current Host evidence, even when the HTTP failure arrives late. */
export function chatRequestErrorText(
  error: unknown,
  state: Pick<CompanionState, 'instanceId' | 'chat'>,
): string | null {
  if (error === null) return null
  if (error instanceof ChatRequestError && error.instanceId === state.instanceId) {
    const message = state.chat.messages.find((entry) => entry.id === error.assistantMessageId)
    if (message?.role === 'assistant' && (message.status === 'finished' || message.status === 'interrupted'))
      return null
  }
  return error instanceof Error ? error.message : '发送失败'
}
