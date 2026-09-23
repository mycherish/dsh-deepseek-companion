/**
 * Host-side attachment resources for image sends (Phase 18A).
 *
 * This module is PURE Host bookkeeping: it validates what a Client uploaded,
 * keeps the bytes in a private temp file, and deletes those files again. It
 * never touches the Playwright page — the page half lives in `browser.ts`
 * (`attachImage` / `removeDraftAttachment`).
 *
 * Trust rules (docs/architecture.md, Phase 18A):
 *   - the Client's `mimeType` is a CLAIM: the real type comes from magic bytes
 *   - the Client's byte count is not trusted either: it is recomputed here
 *   - a file name is display metadata ONLY — a temp path never contains it
 */
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** The four image types the Host accepts (design: no other format, no documents). */
export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

const IMAGE_MIMES: readonly ImageMime[] = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

/** File extension per accepted MIME — derived from the MAGIC, never from the name. */
const MIME_EXTENSIONS: Record<ImageMime, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/** Upload limits (docs/architecture.md): one image, the whole draft, and the count. */
export interface AttachmentLimits {
  /** One image (bytes). */
  maxBytes: number
  /** All draft attachments together (bytes). */
  maxTotalBytes: number
  /** How many draft attachments one composer may hold. */
  maxCount: number
}

export const ATTACHMENT_LIMITS: AttachmentLimits = {
  maxBytes: 20 * 1024 * 1024,
  maxTotalBytes: 40 * 1024 * 1024,
  maxCount: 5,
}

// --- magic bytes --------------------------------------------------------------

const PNG_MAGIC = Buffer.from('89504e470d0a1a0a', 'hex')
const JPEG_MAGIC = Buffer.from('ffd8ff', 'hex')
const GIF87_MAGIC = Buffer.from('474946383761', 'hex')
const GIF89_MAGIC = Buffer.from('474946383961', 'hex')
const RIFF_MAGIC = Buffer.from('52494646', 'hex')
const WEBP_MAGIC = Buffer.from('57454250', 'hex')

/**
 * The real image type of a byte buffer, or `null` when it is not one of the four
 * accepted formats. Deliberately a few byte comparisons — no MIME dependency,
 * no decoding, no `<img>`: a file that claims to be an image is only an image
 * when its header says so.
 */
export function detectImageMime(bytes: Uint8Array): ImageMime | null {
  const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
  if (data.length >= PNG_MAGIC.length && data.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) return 'image/png'
  if (data.length >= JPEG_MAGIC.length && data.subarray(0, JPEG_MAGIC.length).equals(JPEG_MAGIC)) return 'image/jpeg'
  if (data.length >= GIF89_MAGIC.length) {
    const head = data.subarray(0, GIF89_MAGIC.length)
    if (head.equals(GIF89_MAGIC) || head.equals(GIF87_MAGIC)) return 'image/gif'
  }
  // WEBP is a RIFF container: "RIFF" + 4 size bytes + "WEBP".
  if (data.length >= 12 && data.subarray(0, 4).equals(RIFF_MAGIC) && data.subarray(8, 12).equals(WEBP_MAGIC)) {
    return 'image/webp'
  }
  return null
}

// --- strict base64 ------------------------------------------------------------

/**
 * Canonical base64: full 4-char groups, and an optional tail of either two chars
 * plus `==` or three chars plus `=`. Anything else (stray characters, embedded
 * whitespace, a data-URL prefix, wrong padding) fails here.
 */
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

export type Base64DecodeResult = { ok: true; bytes: Buffer } | { ok: false; error: string }

/**
 * Decode base64 STRICTLY. `Buffer.from(..., 'base64')` is far too forgiving: it
 * silently skips invalid characters and ignores non-zero tail bits, so a dirty
 * input would "decide" bytes nobody sent. Here the input must be canonical, and
 * the decoded bytes must round-trip back to exactly the input string.
 */
export function decodeBase64Strict(input: unknown): Base64DecodeResult {
  if (typeof input !== 'string' || input.length === 0) return { ok: false, error: 'invalid base64 data' }
  if (!CANONICAL_BASE64.test(input)) return { ok: false, error: 'invalid base64 data' }
  const bytes = Buffer.from(input, 'base64')
  if (bytes.toString('base64') !== input) return { ok: false, error: 'invalid base64 data' }
  return { ok: true, bytes }
}

// --- display name -------------------------------------------------------------

/** Longest display name kept (a name is metadata, not a path). */
const MAX_NAME_LENGTH = 200

/**
 * Normalize the user-visible file name: control characters out, surrounding
 * whitespace trimmed, length capped. Slashes are left as typed — the name is
 * shown and echoed to DeepSeek, and it NEVER takes part in a filesystem path.
 */
export function sanitizeDisplayName(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_NAME_LENGTH)
}

// --- add validation -----------------------------------------------------------

/** What the draft currently holds, so the limits can be checked before accepting. */
export interface AttachmentDraftSnapshot {
  count: number
  totalBytes: number
}

export type AttachmentAddResult =
  | { ok: true; name: string; mimeType: ImageMime; bytes: Buffer }
  | { ok: false; error: string }

function formatMiB(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MiB`
}

/**
 * Validate one `add` body (design order: name → declared MIME → strict base64 →
 * real magic → declared-vs-real MIME → limits). Everything is checked BEFORE a
 * temp file is written, so a rejected upload never leaves anything behind.
 */
export function validateAttachmentAdd(
  input: { name?: unknown; mimeType?: unknown; dataBase64?: unknown },
  draft: AttachmentDraftSnapshot,
  limits: AttachmentLimits = ATTACHMENT_LIMITS,
): AttachmentAddResult {
  const name = sanitizeDisplayName(typeof input.name === 'string' ? input.name : '')
  if (name === '') return { ok: false, error: 'file name is required' }

  const declared = typeof input.mimeType === 'string' ? input.mimeType.trim().toLowerCase() : ''
  if (!IMAGE_MIMES.includes(declared as ImageMime)) {
    return { ok: false, error: `unsupported image type: ${declared === '' ? '(missing)' : declared}` }
  }

  const decoded = decodeBase64Strict(input.dataBase64)
  if (!decoded.ok) return { ok: false, error: decoded.error }
  if (decoded.bytes.length === 0) return { ok: false, error: 'empty image data' }

  const actual = detectImageMime(decoded.bytes)
  if (actual === null) return { ok: false, error: 'unsupported image content (png/jpeg/webp/gif only)' }
  if (actual !== declared) {
    return { ok: false, error: `image content does not match the declared MIME type (${declared})` }
  }

  if (draft.count >= limits.maxCount) {
    return { ok: false, error: `too many attachments (max ${limits.maxCount})` }
  }
  if (decoded.bytes.length > limits.maxBytes) {
    return { ok: false, error: `image is too large (max ${formatMiB(limits.maxBytes)})` }
  }
  if (draft.totalBytes + decoded.bytes.length > limits.maxTotalBytes) {
    return { ok: false, error: `draft is too large (max ${formatMiB(limits.maxTotalBytes)})` }
  }

  return { ok: true, name, mimeType: actual, bytes: decoded.bytes }
}

// --- temp files ---------------------------------------------------------------

/**
 * A random, Host-owned temp file name. A `randomUUID` and an extension derived
 * from the MAGIC — the user's file name never takes part in it (no traversal, no
 * collisions, no leaking what the user called the file).
 */
export function attachmentTempName(mime: ImageMime): string {
  return `att-${randomUUID()}.${MIME_EXTENSIONS[mime]}`
}

/** Write one validated image to a fresh temp file; returns its absolute path. */
export async function writeAttachmentTempFile(
  dir: string,
  bytes: Uint8Array,
  mime: ImageMime,
): Promise<string> {
  await mkdir(dir, { recursive: true })
  const path = join(dir, attachmentTempName(mime))
  await writeFile(path, bytes)
  return path
}

/**
 * Delete one temp file. Idempotent: an already-deleted file is a success (the
 * same record can be cleaned up by `remove`, by a commit, by a `newChat` reset
 * and by `dispose` — every one of them must be safe on its own).
 */
export async function removeAttachmentTempFile(path: string): Promise<void> {
  try {
    await unlink(path)
  } catch (error) {
    if (!isMissing(error)) throw error
  }
}

/**
 * Delete many temp files without ever failing: used by every cleanup path that
 * must not be blocked by one unreadable file (commit cleanup, session reset,
 * dispose). Idempotent per file.
 */
export async function removeAttachmentTempFiles(paths: readonly string[]): Promise<void> {
  for (const path of paths) {
    try {
      await unlink(path)
    } catch {
      // Already gone, or not deletable: cleanup must never throw (Phase 18A).
    }
  }
}

/**
 * Delete every file in the attachment temp directory. Never throws and never
 * touches anything outside `dir` — the directory is Host-owned and holds temp
 * files only.
 */
export async function clearAttachmentTempDir(dir: string): Promise<void> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return // directory does not exist (yet) → nothing to clean
  }
  await removeAttachmentTempFiles(entries.map((entry) => join(dir, entry)))
}

/**
 * Startup preparation: make sure the directory exists and drop whatever a
 * previous, abnormally-ended run left behind (design: orphan cleanup).
 */
export async function prepareAttachmentTempDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  await clearAttachmentTempDir(dir)
}

function isMissing(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}
