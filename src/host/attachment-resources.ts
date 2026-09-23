/**
 * Host-private attachment resources (Phase 18A).
 *
 * The shared state only ever carries METADATA (`ComposerAttachment`). The three
 * things that must never leave the Host live here:
 *
 *   - `tempPath`        — where the bytes wait for the page upload
 *   - `previewIdentity` — the page blob src of this draft's card
 *   - `deepSeekFileId`  — DeepSeek's own file id (what a send references)
 *
 * One `id` ties the three views, the record and the temp file together, so every
 * cleanup is an EXACT by-id operation: a send only ever touches its own snapshot,
 * and dropping a draft can never delete somebody else's file.
 */
import { clearAttachmentTempDir, prepareAttachmentTempDir, removeAttachmentTempFiles } from './attachments.ts'
import type { CompanionStateStore } from './state.ts'

/** The Host-private half of one draft attachment. */
export interface AttachmentRecord {
  /** `att-<uuid>`, the same id the shared state carries. */
  id: string
  /** Host-owned temp file holding the verified bytes. */
  tempPath: string
  /** Page blob src of this draft's card; absent until the card exists. */
  previewIdentity?: string
  /** DeepSeek's uploaded file id; absent until the upload was accepted. */
  deepSeekFileId?: string
}

/** What a record patch may change (the id and path are fixed at creation). */
export type AttachmentRecordPatch = {
  previewIdentity?: string | null
  deepSeekFileId?: string | null
}

export interface AttachmentResources {
  readonly dir: string
  /** Startup: create the directory and drop a previous run's leftovers. */
  prepare(): Promise<void>
  get(id: string): AttachmentRecord | undefined
  put(record: AttachmentRecord): void
  /** Patch one record; `null` clears a field. Unknown ids are a no-op. */
  update(id: string, patch: AttachmentRecordPatch): void
  /** All records (insertion order) — used for the draft identity set. */
  list(): AttachmentRecord[]
  /** Forget these records AND delete their temp files (quiet, idempotent). */
  drop(ids: readonly string[]): Promise<void>
  /**
   * Drop only the BYTES of one record, keeping the record itself. A failed
   * upload's temp file is useless, but the record still carries the page
   * identity that makes the failed card removable (Phase 18A).
   */
  discardBytes(id: string): Promise<void>
  /**
   * A send's post-submit cleanup: the bytes are no longer needed (the page
   * already took them), so forget the records and delete the temp files —
   * WITHOUT touching any record outside this exact id list.
   */
  consume(ids: readonly string[]): Promise<void>
  /**
   * Drop the whole draft: shared state, records and temp files. Used by every
   * "the page moved on" path (new chat, history switch, external navigation,
   * page rebuild, dispose). The page is the source of truth — a draft is never
   * migrated.
   */
  resetDraft(): Promise<void>
}

export function createAttachmentResources(options: {
  dir: string
  store: CompanionStateStore
}): AttachmentResources {
  const records = new Map<string, AttachmentRecord>()

  const forget = async (ids: readonly string[], deleteFiles: boolean): Promise<void> => {
    const paths: string[] = []
    for (const id of ids) {
      const record = records.get(id)
      if (record === undefined) continue
      records.delete(id)
      if (deleteFiles) paths.push(record.tempPath)
    }
    // One quiet pass: a missing file must never stop the rest of the cleanup.
    if (paths.length > 0) await removeAttachmentTempFiles(paths)
  }

  return {
    dir: options.dir,

    async prepare() {
      await prepareAttachmentTempDir(options.dir)
    },

    get(id) {
      return records.get(id)
    },

    put(record) {
      records.set(record.id, record)
    },

    update(id, patch) {
      const record = records.get(id)
      if (record === undefined) return
      const next: AttachmentRecord = { ...record }
      if (patch.previewIdentity !== undefined) {
        if (patch.previewIdentity === null) delete next.previewIdentity
        else next.previewIdentity = patch.previewIdentity
      }
      if (patch.deepSeekFileId !== undefined) {
        if (patch.deepSeekFileId === null) delete next.deepSeekFileId
        else next.deepSeekFileId = patch.deepSeekFileId
      }
      records.set(id, next)
    },

    list() {
      return [...records.values()]
    },

    async drop(ids) {
      await forget(ids, true)
    },

    async discardBytes(id) {
      const record = records.get(id)
      if (record === undefined) return
      await removeAttachmentTempFiles([record.tempPath])
    },

    async consume(ids) {
      await forget(ids, true)
    },

    async resetDraft() {
      const ids = [...records.keys()]
      await forget(ids, true)
      options.store.clearComposerAttachments()
      // Belt and braces: the directory is Host-owned and holds temp files only,
      // so a leftover from a path we lost track of is cleaned here too.
      await clearAttachmentTempDir(options.dir)
    },
  }
}
