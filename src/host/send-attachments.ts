/**
 * The attachment half of a send (Phase 18A) — the transaction, not the page.
 *
 * A send of images has three phases and exactly one irreversible moment:
 *
 *   PRE-SUBMIT  everything can still be refused: the draft is wrong, a record is
 *               incomplete, the page shows a draft Companion does not manage, or
 *               the completion REQUEST never appeared. Nothing is touched.
 *   COMMITTED   the completion REQUEST was observed. The page HAS the images.
 *               From here on the draft is never put back.
 *   POST-SUBMIT the round ends (normally, by stop, by switch, by error, or with
 *               an integrity failure) — consumed attachments are cleaned up and
 *               never restored.
 *
 * All of it is pure Host logic (no Playwright), so the whole matrix is testable.
 */
import type { AssistantReply, ChatAttachment, Citation, ComposerAttachment } from '../shared/state.ts'
import type { AttachmentRecord } from './attachment-resources.ts'

/**
 * What the completion request carried when the commit point was observed.
 * `{ ok: false }` means the payload could not be read at all (null body, bad
 * JSON, not an object) — that is an INTEGRITY failure, never a pre-submit one.
 */
/**
 * The completion REQUEST as read at the commit point. `refFileIds` drives the
 * Phase 18A attachment contract; `chatSessionId` / `parentMessageId` are the
 * Phase 20B1 parent ANCHOR — a stable pointer at where this turn hangs, never
 * the new message ids themselves. All three are passed through EXACTLY as the
 * payload stated them, so a missing/mistyped field stays detectable.
 */
export type CompletionSubmission =
  { ok: true; refFileIds: unknown; chatSessionId?: unknown; parentMessageId?: unknown } | { ok: false }

/** The browser capability a send needs (keeps unit tests free of Playwright). */
export interface AttachmentSendBrowser {
  sendMessage(
    text: string,
    onDelta: (reply: AssistantReply) => void,
    onReasoning: (reply: AssistantReply) => void,
    onCitations: (citations: Citation[]) => void,
    /** Called EXACTLY once, the moment the completion request was observed. */
    onSubmitted: (submitted: CompletionSubmission) => void | Promise<void>,
  ): Promise<AssistantReply>
}

/**
 * The send's attachment transaction. Built by the route from the draft snapshot;
 * `handleChatMessage` only calls `onSubmitted` at the commit point and hands it
 * the id of the user message this round wrote.
 */
export interface SendAttachmentTransaction {
  /** The consumed entries (exact ids — nothing outside this list is ever touched). */
  snapshot: readonly ConsumedAttachment[]
  /** Every snapshot entry's `deepSeekFileId`, in snapshot order. */
  expectedFileIds: readonly string[]
  /**
   * The commit point. Implementations MUST treat `submitted` as final: a
   * verification failure leaves the message WITHOUT attachments (never a false
   * claim) and never restores the composer draft.
   */
  onSubmitted(submitted: CompletionSubmission, userMessageId: string): void | Promise<void>
}

/**
 * One consumed draft entry: what the send transaction and the committed message
 * attachment both need. Deliberately metadata-only — the Host-private side
 * (temp path, page identity, DeepSeek file id) never travels with it.
 */
export interface ConsumedAttachment {
  id: string
  name: string
  mimeType: string
  bytes: number
}

// --- pre-submit gate ----------------------------------------------------------

export interface DraftGateInput {
  /** What the composer currently holds (shared state). */
  attachments: readonly ComposerAttachment[]
  /** Host-private records, by id. */
  recordOf: (id: string) => AttachmentRecord | undefined
  /** The draft previews the REAL page shows right now (`blob:` srcs). */
  pageIdentities: readonly string[]
}

export type DraftGateResult =
  | {
      ok: true
      /** Ready attachments only, in composer order. */
      snapshot: ConsumedAttachment[]
      expectedFileIds: string[]
    }
  | { ok: false; error: string; status: 409 }

/**
 * The pre-send gate (design Tasks 6.A + 6.B). It answers two questions:
 *
 *   1. can the composer's own draft be sent at all? — every attachment must be
 *      `ready` AND have a record with both `previewIdentity` and
 *      `deepSeekFileId`; anything else is refused instead of guessed;
 *   2. does the page show EXACTLY the drafts this Host manages? — the identity
 *      SETS must be equal (never just the count, never the DOM order). A page
 *      draft Companion cannot track means the send is refused outright: the
 *      strict rule is "never send images we cannot account for".
 */
export function evaluateDraftGate(input: DraftGateInput): DraftGateResult {
  const snapshot: ConsumedAttachment[] = []
  const hostIdentities: string[] = []
  const expectedFileIds: string[] = []

  for (const attachment of input.attachments) {
    if (attachment.status === 'uploading') {
      return { ok: false, status: 409, error: 'an attachment is still uploading' }
    }
    if (attachment.status === 'error') {
      return { ok: false, status: 409, error: 'an attachment failed to upload — remove it first' }
    }
    const record = input.recordOf(attachment.id)
    if (
      record === undefined ||
      record.previewIdentity === undefined ||
      record.previewIdentity === '' ||
      record.deepSeekFileId === undefined ||
      record.deepSeekFileId === ''
    ) {
      // A `ready` draft whose Host record is incomplete can never be verified
      // against the page or the completion request → refuse, never guess.
      return { ok: false, status: 409, error: 'attachment bookkeeping is incomplete' }
    }
    snapshot.push({
      id: attachment.id,
      name: attachment.name,
      mimeType: attachment.mimeType,
      bytes: attachment.bytes,
    })
    hostIdentities.push(record.previewIdentity)
    expectedFileIds.push(record.deepSeekFileId)
  }

  if (!sameIdentitySet(hostIdentities, input.pageIdentities)) {
    return {
      ok: false,
      status: 409,
      error: 'DeepSeek page contains image drafts not managed by Companion',
    }
  }

  return { ok: true, snapshot, expectedFileIds }
}

/** Set equality (order-independent, duplicate-insensitive) of two identity lists. */
function sameIdentitySet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  if (set.size !== a.length) return false
  for (const identity of b) {
    if (!set.has(identity)) return false
  }
  return true
}

// --- commit point: ref_file_ids integrity -------------------------------------

/**
 * Read `ref_file_ids` out of the committed completion request. A body that
 * cannot be read at all is reported as `{ ok: false }`: after the request is out
 * the round is submitted, so "unreadable" must become an INTEGRITY failure
 * rather than a silent "no files referenced".
 *
 * The field itself is passed through EXACTLY as it appeared (`undefined` when it
 * is absent, `null` when it is null) so `verifyRefFileIds` can call a missing
 * field malformed instead of treating it as an empty reference list.
 */
export function readCompletionSubmission(request: { postData(): string | null }): CompletionSubmission {
  let body: string | null
  try {
    body = request.postData()
  } catch {
    return { ok: false }
  }
  if (body === null) return { ok: false }
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return { ok: false }
  }
  if (parsed === null || typeof parsed !== 'object') return { ok: false }
  const payload = parsed as { ref_file_ids?: unknown; chat_session_id?: unknown; parent_message_id?: unknown }
  return {
    ok: true,
    refFileIds: payload.ref_file_ids,
    chatSessionId: payload.chat_session_id,
    parentMessageId: payload.parent_message_id,
  }
}

/**
 * The committed turn's parent anchor (Phase 20B1): the session id plus the
 * `parent_message_id` the request declared (`null` for the first message of a
 * NEW session). A payload that does not state both in usable form has NO anchor
 * — Level 2 binding is then skipped rather than guessed at, and the strict
 * bootstrap decides instead.
 */
export function readParentAnchor(
  submitted: CompletionSubmission,
): { sessionId: string; parentMessageId: number | null } | undefined {
  if (!submitted.ok) return undefined
  const sessionId = submitted.chatSessionId
  if (typeof sessionId !== 'string' || sessionId === '') return undefined
  const parent = submitted.parentMessageId
  if (parent === null) return { sessionId, parentMessageId: null }
  if (typeof parent === 'number' && Number.isFinite(parent)) return { sessionId, parentMessageId: parent }
  return undefined
}

export type IntegrityResult = { ok: true; fileIds: string[] } | { ok: false; error: string }

function isUsableFileId(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

/**
 * Verify the completion request's `ref_file_ids` against this round's snapshot
 * (design §二). The payload must STATE its referenced files, and uniqueness is
 * part of the contract — `[A]` vs `[A, A]` is a mismatch, and duplicates are
 * never hidden by de-duplicating first:
 *
 *   1. `ref_file_ids` must be PRESENT (a missing field or `null` is malformed)
 *   2. every expected id is a valid non-empty string
 *   3. `actual` must be an array whose elements are all valid non-empty strings
 *   4. expected must not repeat
 *   5. actual must not repeat
 *   6. same length
 *   7. same set (order is irrelevant; a text-only send is `[]` on both sides)
 *
 * Rule 1 holds even when `expected` is empty: rule 3 of the design table makes
 * "malformed payload" a POST-SUBMIT INTEGRITY ERROR regardless of what this
 * round referenced — a request that cannot be verified is never assumed to have
 * referenced nothing. (The real page always sends `ref_file_ids: []` for a
 * text-only round, so the strict rule costs the text path nothing.)
 */
export function verifyRefFileIds(expected: readonly string[], submitted: CompletionSubmission): IntegrityResult {
  if (!submitted.ok) return { ok: false, error: 'completion request payload could not be read' }
  if (!expected.every(isUsableFileId)) return { ok: false, error: 'expected file ids are malformed' }
  if (new Set(expected).size !== expected.length) {
    return { ok: false, error: 'expected file ids contain duplicates' }
  }

  if (submitted.refFileIds === undefined) {
    return { ok: false, error: 'ref_file_ids is missing from the completion payload' }
  }
  if (submitted.refFileIds === null) return { ok: false, error: 'ref_file_ids is null' }
  if (!Array.isArray(submitted.refFileIds)) return { ok: false, error: 'ref_file_ids is not an array' }
  const raw = submitted.refFileIds as unknown[]
  if (!raw.every(isUsableFileId)) return { ok: false, error: 'ref_file_ids contains a non-string id' }
  const actual = raw as string[]
  if (new Set(actual).size !== actual.length) {
    return { ok: false, error: 'ref_file_ids contains duplicates' }
  }
  if (actual.length !== expected.length) {
    return {
      ok: false,
      error: `ref_file_ids length mismatch (expected ${expected.length}, got ${actual.length})`,
    }
  }
  const expectedSet = new Set(expected)
  for (const fileId of actual) {
    if (!expectedSet.has(fileId)) return { ok: false, error: `ref_file_ids contains an unexpected id (${fileId})` }
  }
  return { ok: true, fileIds: actual }
}

/**
 * The message attachments a VERIFIED snapshot turns into: metadata only, pinned
 * to the ids the composer used, so the card in the transcript and the draft it
 * came from stay traceable.
 */
export function chatAttachmentsFromSnapshot(snapshot: readonly ConsumedAttachment[]): ChatAttachment[] {
  return snapshot.map((entry) => ({
    id: entry.id,
    kind: 'image' as const,
    name: entry.name,
    mimeType: entry.mimeType,
    bytes: entry.bytes,
  }))
}

// --- the /chat wiring, as one testable step ------------------------------------

/** Everything the send step needs from the outside world. */
export interface AttachmentTransactionDeps {
  /** Composer draft + the two writes a commit performs. */
  store: {
    getState(): { composer: { attachments: readonly ComposerAttachment[] } }
    setChatMessageAttachments(id: string, attachments: ChatAttachment[]): void
    removeComposerAttachments(ids: readonly string[]): void
  }
  /** Host-private record lookup (identity + DeepSeek file id). */
  recordOf: (id: string) => AttachmentRecord | undefined
  /** Cleanup of the consumed records / temp files. */
  consume: (ids: readonly string[]) => Promise<void>
  /** The draft previews the REAL page shows right now. */
  listDraftIdentities: () => Promise<string[]>
  /** Post-submit integrity failures are reported, never silently swallowed. */
  onIntegrityError?: (error: string) => void
}

export type PrepareTransactionResult =
  { ok: true; transaction?: SendAttachmentTransaction } | { ok: false; error: string; status: 409 }

/**
 * Prepare the attachment half of one send.
 *
 * The identity comparison runs for EVERY send — text-only included. That is the
 * whole point of the strict rule: a page draft Companion does not manage makes
 * the composer's real content unknowable, so the send is refused instead of
 * risking a message that mixes managed and unmanaged images.
 */
export async function prepareAttachmentTransaction(deps: AttachmentTransactionDeps): Promise<PrepareTransactionResult> {
  const attachments = deps.store.getState().composer.attachments
  const pageIdentities = await deps.listDraftIdentities()
  const gate = evaluateDraftGate({ attachments, recordOf: deps.recordOf, pageIdentities })
  if (!gate.ok) return { ok: false, error: gate.error, status: gate.status }
  // Nothing consumed → a plain text round, with no commit work to do.
  if (gate.snapshot.length === 0) return { ok: true }

  const consumedIds = gate.snapshot.map((entry) => entry.id)
  const chatAttachments = chatAttachmentsFromSnapshot(gate.snapshot)
  return {
    ok: true,
    transaction: {
      snapshot: gate.snapshot,
      expectedFileIds: gate.expectedFileIds,
      onSubmitted: async (submitted, userMessageId) => {
        const verdict = verifyRefFileIds(gate.expectedFileIds, submitted)
        if (verdict.ok) {
          deps.store.setChatMessageAttachments(userMessageId, chatAttachments)
        } else {
          // The page HAS the images; only the message's claim is unprovable.
          // Never restore the draft, never write a half-truth.
          deps.onIntegrityError?.(verdict.error)
        }
        // Exactly the consumed snapshot leaves the composer, and exactly its
        // records / temp files are dropped.
        deps.store.removeComposerAttachments(consumedIds)
        await deps.consume(consumedIds)
      },
    },
  }
}
