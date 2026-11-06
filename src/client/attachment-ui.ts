/**
 * Attachment UI rules of the Companion surfaces (Phase 18A).
 *
 * The views render attachment CARDS (metadata only) and ask the Host to do every
 * real change. What is left for the Client is display text and one decision —
 * "may this round be sent?" — so both live here as pure functions that the three
 * surfaces share and the tests can cover without a DOM.
 */
import type { ComposerAttachment, ConnectionStatus } from '../shared/state.ts'

/** Image types the picker offers. UX only: the Host re-checks the real bytes. */
export const IMAGE_MIME_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

/** `1.8 MB` — the size shown on an attachment card. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** The status line of one draft card; a failure shows the Host's reason. */
export function attachmentStatusText(attachment: ComposerAttachment): string {
  if (attachment.status === 'uploading') return '上传中…'
  if (attachment.status === 'error') {
    return attachment.error !== undefined && attachment.error !== '' ? `失败 · ${attachment.error}` : '失败'
  }
  return '已就绪'
}

/**
 * Whether the composer may send right now (the Client's copy of the rule).
 *
 * Images-only rounds ARE allowed — DeepSeek accepts `prompt: ""` with
 * `ref_file_ids` — but a round with neither text nor a ready image is not, and
 * neither is one while a draft entry is still uploading or has failed. The Host
 * re-checks all of it (and the page's real draft set) before it clicks Send.
 */
export function canSendRound(input: {
  /** Raw composer text (not trimmed by the caller). */
  text: string
  attachments: readonly ComposerAttachment[]
  /** A reply is streaming, or a local submit is in flight. */
  busy: boolean
  /** A picker → Host round trip is in flight. */
  attaching: boolean
  sessionUnverified: boolean
  connection: ConnectionStatus
}): boolean {
  if (input.busy || input.attaching || input.sessionUnverified) return false
  if (input.connection !== 'online') return false
  // Uploading / failed drafts block the round for everyone.
  if (input.attachments.some((attachment) => attachment.status !== 'ready')) return false
  const hasReadyImage = input.attachments.some((attachment) => attachment.status === 'ready')
  return input.text.trim() !== '' || hasReadyImage
}

/** Whether the image picker may be opened right now. */
export function canPickAttachment(input: {
  sessionUnverified: boolean
  pageBusy: boolean
  attaching: boolean
  attachments: readonly ComposerAttachment[]
}): boolean {
  if (input.pageBusy || input.attaching || input.sessionUnverified) return false
  // One upload at a time: a second pick while a card is still uploading would
  // race the page's own draft diff.
  return !input.attachments.some((attachment) => attachment.status === 'uploading')
}
