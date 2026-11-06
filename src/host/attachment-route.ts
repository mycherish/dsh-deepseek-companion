/**
 * `/chat/attachment` request flow (Phase 18A).
 *
 * ONE route with an `action` discriminator (`add` / `remove`) — DSH's route table
 * only speaks GET/HEAD/POST, and both actions operate on the same draft set, so
 * a single registration is the smaller surface.
 *
 * ADD    The Host validates the bytes itself (magic MIME, strict base64, limits),
 *        writes them to a private temp file, drives the REAL DeepSeek upload and
 *        ends with a draft entry that is `ready` or `error`. A failed upload
 *        still keeps its page identity (`previewIdentity`) whenever the page drew
 *        a card, so the failure can be undone precisely afterwards.
 * REMOVE The page goes first: only a CONFIRMED page-card removal deletes the
 *        Host entry. A failed removal leaves state, record and temp file alone
 *        (409) — the three views keep showing exactly what still exists.
 */
import { validateAttachmentAdd, writeAttachmentTempFile, type AttachmentLimits, type ImageMime } from './attachments.ts'
import type { AttachmentResources } from './attachment-resources.ts'
import type { PageGuard } from './guard.ts'
import type { CompanionStateStore } from './state.ts'
import type { AttachImageResult } from './browser.ts'
import type { ComposerAttachment } from '../shared/state.ts'

/** The browser surface this flow needs (keeps unit tests free of Playwright). */
export interface AttachmentCapableBrowser {
  attachImage(input: { path: string; fileName: string; mimeType: string; bytes: number }): Promise<AttachImageResult>
  removeDraftAttachment(input: { previewIdentity: string }): Promise<boolean>
}

export interface AttachmentRequestResult {
  status: 200 | 400 | 409 | 500 | 503
  body: { attachment?: ComposerAttachment; ok?: boolean; error?: string }
}

export interface AttachmentRequestDeps {
  store: CompanionStateStore
  resources: AttachmentResources
  browser: AttachmentCapableBrowser | null
  guard: PageGuard
  /** Production limits by default; tests inject small ones. */
  limits?: AttachmentLimits
}

/**
 * Handle one attachment request. The body is untrusted: it is validated here
 * (and again inside `validateAttachmentAdd`), never in the Client.
 */
export async function handleAttachmentRequest(
  deps: AttachmentRequestDeps,
  body: unknown,
): Promise<AttachmentRequestResult> {
  const requested = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const action = requested.action

  if (action === 'add') return handleAdd(deps, requested)
  if (action === 'remove') return handleRemove(deps, requested)
  return { status: 400, body: { error: 'unknown attachment action' } }
}

// --- add ----------------------------------------------------------------------

async function handleAdd(
  deps: AttachmentRequestDeps,
  requested: Record<string, unknown>,
): Promise<AttachmentRequestResult> {
  // 1. the browser must be able to reach DeepSeek at all.
  if (deps.browser === null) return { status: 503, body: { error: 'browser not ready' } }
  // A request queued before recovery may resume on an unverified page.
  if (deps.store.getState().recoveryNotice === 'session_unverified') {
    return { status: 409, body: { error: 'recovered session is unverified' } }
  }
  // 2. a reply is streaming: the page belongs to that send (drafts are frozen).
  if (deps.store.getState().chat.sending) return { status: 409, body: { error: 'chat is busy' } }
  // 3. claim the page: a second attach / remove / newChat / switch is refused.
  if (!deps.guard.tryClaim()) return { status: 409, body: { error: 'page operation in progress' } }

  try {
    const draft = deps.store.getState().composer.attachments
    // 4. validate BEFORE anything is created: bytes, real type and limits.
    const validation = validateAttachmentAdd(
      { name: requested.name, mimeType: requested.mimeType, dataBase64: requested.dataBase64 },
      {
        count: draft.length,
        totalBytes: draft.reduce((sum, attachment) => sum + attachment.bytes, 0),
      },
      deps.limits,
    )
    if (!validation.ok) return { status: 400, body: { error: validation.error } }

    // 5-7. Host id, draft entry, temp file, private record.
    const attachment = deps.store.addComposerAttachment({
      name: validation.name,
      mimeType: validation.mimeType,
      bytes: validation.bytes.length,
    })
    let tempPath: string
    try {
      tempPath = await writeTemp(deps, attachment.id, validation.bytes, validation.mimeType)
    } catch (error) {
      // Nothing was uploaded and no page card exists — roll the entry back.
      deps.store.removeComposerAttachment(attachment.id)
      return { status: 500, body: { error: `cannot store the attachment: ${errorText(error)}` } }
    }

    // 8. the page upload (deepSeekFileId / previewIdentity are its outcome).
    const result = await deps.browser.attachImage({
      path: tempPath,
      fileName: validation.name,
      mimeType: validation.mimeType,
      bytes: validation.bytes.length,
    })

    // 9. record what the page told us, then publish the entry's real state.
    if (result.previewIdentity !== undefined) {
      deps.resources.update(attachment.id, { previewIdentity: result.previewIdentity })
    }
    if (result.ok) {
      deps.resources.update(attachment.id, { deepSeekFileId: result.deepSeekFileId })
      deps.store.updateComposerAttachment(attachment.id, { status: 'ready' })
      return { status: 200, body: { attachment: storedAttachment(deps, attachment.id) } }
    }

    // A failed upload keeps its card entry (so the user can see and remove it)
    // and its record (so that removal stays precise). Only the BYTES go: the
    // page already took them or never got them, and a retry is a NEW entry.
    await deps.resources.discardBytes(attachment.id).catch(() => {})
    deps.store.updateComposerAttachment(attachment.id, { status: 'error', error: result.error })
    return { status: 200, body: { attachment: storedAttachment(deps, attachment.id) } }
  } catch (error) {
    return { status: 500, body: { error: errorText(error) } }
  } finally {
    deps.guard.release()
  }
}

// --- remove -------------------------------------------------------------------

async function handleRemove(
  deps: AttachmentRequestDeps,
  requested: Record<string, unknown>,
): Promise<AttachmentRequestResult> {
  const id = typeof requested.id === 'string' && requested.id !== '' ? requested.id : null
  if (id === null) return { status: 400, body: { error: 'attachment id is required' } }
  if (deps.browser === null) return { status: 503, body: { error: 'browser not ready' } }
  if (deps.store.getState().chat.sending) return { status: 409, body: { error: 'chat is busy' } }

  const stored = deps.store.getState().composer.attachments.find((attachment) => attachment.id === id)
  if (stored === undefined) return { status: 400, body: { error: 'unknown attachment' } }

  if (!deps.guard.tryClaim()) return { status: 409, body: { error: 'page operation in progress' } }
  try {
    const record = deps.resources.get(id)
    const identity = record?.previewIdentity
    if (identity !== undefined && identity !== '') {
      // The page card must really disappear — otherwise nothing changes here.
      const removed = await deps.browser.removeDraftAttachment({ previewIdentity: identity })
      if (!removed) {
        return { status: 409, body: { error: 'failed to remove the DeepSeek draft image' } }
      }
    }
    // Page confirmed (or there never was a card): now the Host forgets it.
    deps.store.removeComposerAttachment(id)
    await deps.resources.drop([id])
    return { status: 200, body: { ok: true } }
  } catch (error) {
    return { status: 500, body: { error: errorText(error) } }
  } finally {
    deps.guard.release()
  }
}

// --- helpers ------------------------------------------------------------------

/** Write the validated bytes to a fresh temp file and record where they live. */
async function writeTemp(
  deps: AttachmentRequestDeps,
  id: string,
  bytes: Uint8Array,
  mimeType: ImageMime,
): Promise<string> {
  const path = await writeAttachmentTempFile(deps.resources.dir, bytes, mimeType)
  deps.resources.put({ id, tempPath: path })
  return path
}

/** The draft entry as the shared state holds it right now. */
function storedAttachment(deps: AttachmentRequestDeps, id: string): ComposerAttachment {
  const attachment = deps.store.getState().composer.attachments.find((entry) => entry.id === id)
  if (attachment === undefined) throw new Error('attachment entry is missing')
  return attachment
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
