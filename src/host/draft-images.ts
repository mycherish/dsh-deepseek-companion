/**
 * DeepSeek page image-draft helpers (Phase 18A).
 *
 * Everything here is about the REAL page's own draft cards: the `blob:` preview
 * `src` of each pending image, the card that owns one, and the tiny geometric X
 * that removes it.
 *
 * ── The one rule that matters ────────────────────────────────────────────────
 * The functions marked "IN-PAGE" are serialized into the browser context by
 * Playwright. Inside the page they can only use the LOCALS declared in their own
 * body — a reference to a module-level helper (or a module constant) becomes a
 * `ReferenceError` there, and `page.evaluate` rejects. That is exactly how an
 * earlier version of this module silently reported "the page has no draft
 * previews" for a page that clearly had them (Phase 18A real-machine
 * acceptance). So every IN-PAGE function inlines its own DOM plumbing, and
 * `tests/draft-images.test.ts` asserts that no module-level identifier leaks
 * into their serialized source.
 *
 * Identity rules (docs/architecture.md):
 *   - an identity is the image's `src` ATTRIBUTE (never a styling class)
 *   - it is unique and stable for one draft; DeepSeek never reuses it
 *   - a removal deletes the card that owns the identity, and only that one
 */
import type { ComposerAttachment } from '../shared/state.ts'

/** The DOM slice the page helpers need (`document` inside the page). */
export interface DraftImageDom {
  querySelectorAll(selector: string): ArrayLike<unknown>
}

/** Injectable browser surface (real globals in the page, fakes in tests). */
export interface DraftImageEnv {
  document?: DraftImageDom
  /** `window.getComputedStyle` inside the page. */
  getComputedStyle?: (element: unknown) => { cursor?: unknown }
  /** `document.elementFromPoint` inside the page. */
  elementFromPoint?: (x: number, y: number) => unknown
}

/** The CSS prefix of a page-side draft preview. */
export const DRAFT_IDENTITY_PREFIX = 'blob:'

/**
 * Candidate points for the removal control, as offsets from the card's
 * TOP-RIGHT corner (`{ dx, dy }`, tried in order). Geometrically located because
 * DeepSeek gives the control neither an aria label nor a title; the identity of
 * WHAT gets deleted stays exact (the card that owns `previewIdentity`).
 */
export const REMOVE_CONTROL_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [4, 4],
  [8, 6],
  [6, 10],
  [12, 8],
  [10, 12],
  [16, 10],
  [8, 16],
  [16, 16],
  [20, 20],
]

/** Whether a value is usable as a draft identity (`blob:` src). */
export function isDraftIdentity(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length > DRAFT_IDENTITY_PREFIX.length && value.startsWith(DRAFT_IDENTITY_PREFIX)
  )
}

// --- IN-PAGE: draft previews --------------------------------------------------

/**
 * Every image-draft preview the page currently shows, in DOM order.
 *
 * Two rules keep this honest (both learned from the real page):
 *   1. identity is the `src` ATTRIBUTE (never a styling class, never the
 *      resolved property) so the same string works as a CSS selector later;
 *   2. a preview counts as a DRAFT only when it sits inside the composer — i.e.
 *      some ancestor (within a few levels) holds the message `textarea` and no
 *      message container. A sent image is rendered in the transcript, sometimes
 *      from its local `blob:` URL, and must never be mistaken for a draft.
 */
export function readDraftIdentitiesInPage(
  payload: { env?: DraftImageEnv; messageSelector?: string } = {},
): string[] {
  const env: DraftImageEnv = payload.env ?? (globalThis as unknown as DraftImageEnv)
  const doc = env.document
  if (doc === undefined || doc === null) return []
  const messageSelector = payload.messageSelector ?? ''

  const attr = (element: unknown, name: string): string => {
    const node = element as { getAttribute?: (n: string) => unknown }
    if (typeof node?.getAttribute !== 'function') return ''
    return String(node.getAttribute(name) ?? '')
  }
  const inComposer = (element: unknown): boolean => {
    let node = (element as { parentElement?: unknown }).parentElement ?? null
    for (let depth = 0; depth < 8 && node !== null && node !== undefined; depth += 1) {
      const probe = node as {
        querySelector?: (selector: string) => unknown
        parentElement?: unknown
      }
      if (typeof probe.querySelector === 'function') {
        if (probe.querySelector('textarea') !== null) {
          // The composer: it holds the message box and never a message bubble.
          return messageSelector === '' || probe.querySelector(messageSelector) === null
        }
      }
      node = probe.parentElement ?? null
    }
    return false
  }

  const out: string[] = []
  for (const element of Array.from(doc.querySelectorAll('img'))) {
    const src = attr(element, 'src')
    if (!src.startsWith('blob:') || src.length <= 5) continue
    if (!inComposer(element)) continue
    out.push(src)
  }
  return out
}

/** Where one draft's card is (its hover point), or why it could not be found. */
export interface DraftPointResult {
  found: boolean
  reason?: string
  x?: number
  y?: number
}

/**
 * IN-PAGE: locate the card that owns `identity` and report a point inside it
 * (its centre) — used to HOVER the card so DeepSeek renders the removal control.
 */
export function findDraftCardInPage(payload: { identity: string; env?: DraftImageEnv }): DraftPointResult {
  const env: DraftImageEnv = payload.env ?? (globalThis as unknown as DraftImageEnv)
  const doc = env.document
  if (doc === undefined || doc === null) return { found: false, reason: 'no-document' }
  const identity = payload.identity
  if (typeof identity !== 'string' || !identity.startsWith('blob:') || identity.length <= 5) {
    return { found: false, reason: 'invalid-identity' }
  }

  const attr = (element: unknown, name: string): string => {
    const node = element as { getAttribute?: (n: string) => unknown }
    if (typeof node?.getAttribute !== 'function') return ''
    return String(node.getAttribute(name) ?? '')
  }
  const rectOf = (element: unknown): { left: number; top: number; width: number; height: number } | null => {
    const node = element as { getBoundingClientRect?: () => unknown }
    if (typeof node?.getBoundingClientRect !== 'function') return null
    const raw = node.getBoundingClientRect() as Record<string, unknown> | null
    if (raw === null || typeof raw !== 'object') return null
    const left = Number(raw.left)
    const top = Number(raw.top)
    const width = Number(raw.width)
    const height = Number(raw.height)
    if (![left, top, width, height].every((value) => Number.isFinite(value))) return null
    return { left, top, width, height }
  }

  let image: unknown = null
  for (const element of Array.from(doc.querySelectorAll('img'))) {
    if (attr(element, 'src') === identity) {
      image = element
      break
    }
  }
  if (image === null) return { found: false, reason: 'draft-image-not-found' }

  let card: unknown = null
  let node: unknown = image
  for (let i = 0; i < 8 && node !== null && node !== undefined; i += 1) {
    if (attr(node, 'role') === 'button') {
      card = node
      break
    }
    node = (node as { parentElement?: unknown }).parentElement ?? null
  }
  if (card === null) return { found: false, reason: 'draft-card-not-found' }

  const box = rectOf(card)
  if (box === null || box.width <= 0 || box.height <= 0) return { found: false, reason: 'draft-card-not-measurable' }
  return { found: true, x: box.left + box.width / 2, y: box.top + box.height / 2 }
}

/**
 * IN-PAGE: find the removal control of one draft card — an SVG with
 * `cursor: pointer` that sits in the card's TOP-RIGHT quadrant and stays inside
 * the card. Any failure (no image, no card, no such control) is a SAFE failure:
 * nothing is clicked, and a random SVG on the page is never accepted.
 *
 * `offsets` is required (the caller passes `REMOVE_CONTROL_OFFSETS`) so this
 * function stays self-contained.
 */
export function findRemoveControlInPage(payload: {
  identity: string
  offsets: ReadonlyArray<readonly [number, number]>
  env?: DraftImageEnv
  /** Optional diagnostics sink: one line per probed point (Host log only). */
  probe?: (line: string) => void
}): DraftPointResult {
  const env: DraftImageEnv = payload.env ?? (globalThis as unknown as DraftImageEnv)
  const doc = env.document
  if (doc === undefined || doc === null) return { found: false, reason: 'no-document' }
  const identity = payload.identity
  if (typeof identity !== 'string' || !identity.startsWith('blob:') || identity.length <= 5) {
    return { found: false, reason: 'invalid-identity' }
  }
  const hitTest = env.elementFromPoint
  const styleOf = env.getComputedStyle
  if (typeof hitTest !== 'function' || typeof styleOf !== 'function') return { found: false, reason: 'no-hit-testing' }

  const attr = (element: unknown, name: string): string => {
    const node = element as { getAttribute?: (n: string) => unknown }
    if (typeof node?.getAttribute !== 'function') return ''
    return String(node.getAttribute(name) ?? '')
  }
  const tagOf = (element: unknown): string => String((element as { tagName?: unknown }).tagName ?? '').toUpperCase()
  const rectOf = (element: unknown): { left: number; top: number; width: number; height: number } | null => {
    const node = element as { getBoundingClientRect?: () => unknown }
    if (typeof node?.getBoundingClientRect !== 'function') return null
    const raw = node.getBoundingClientRect() as Record<string, unknown> | null
    if (raw === null || typeof raw !== 'object') return null
    const left = Number(raw.left)
    const top = Number(raw.top)
    const width = Number(raw.width)
    const height = Number(raw.height)
    if (![left, top, width, height].every((value) => Number.isFinite(value))) return null
    return { left, top, width, height }
  }
  const contains = (parent: unknown, child: unknown): boolean => {
    const node = parent as { contains?: (n: unknown) => boolean }
    return typeof node?.contains === 'function' ? node.contains(child) : false
  }

  let image: unknown = null
  for (const element of Array.from(doc.querySelectorAll('img'))) {
    if (attr(element, 'src') === identity) {
      image = element
      break
    }
  }
  if (image === null) return { found: false, reason: 'draft-image-not-found' }

  let card: unknown = null
  let node: unknown = image
  for (let i = 0; i < 8 && node !== null && node !== undefined; i += 1) {
    if (attr(node, 'role') === 'button') {
      card = node
      break
    }
    node = (node as { parentElement?: unknown }).parentElement ?? null
  }
  if (card === null) return { found: false, reason: 'draft-card-not-found' }
  const box = rectOf(card)
  if (box === null || box.width <= 0 || box.height <= 0) return { found: false, reason: 'draft-card-not-measurable' }

  for (const offset of payload.offsets) {
    const x = box.left + box.width - (offset[0] ?? 0)
    const y = box.top + (offset[1] ?? 0)
    if (x <= box.left || y >= box.top + box.height) continue

    const hit = hitTest(x, y)
    if (hit === null || hit === undefined) {
      payload.probe?.(`(${x},${y}) -> null`)
      continue
    }
    payload.probe?.(
      `(${x},${y}) -> ${tagOf(hit)} class="${String(attr(hit, 'class') ?? '')}" cursor="${String(
        styleOf(hit).cursor ?? '',
      )}"`,
    )
    let svg: unknown = tagOf(hit) === 'SVG' ? hit : null
    if (svg === null) {
      let up: unknown = (hit as { parentElement?: unknown }).parentElement ?? null
      for (let i = 0; i < 6 && up !== null && up !== undefined; i += 1) {
        if (tagOf(up) === 'SVG') {
          svg = up
          break
        }
        up = (up as { parentElement?: unknown }).parentElement ?? null
      }
    }
    if (svg === null || svg === image) continue
    // The hit element itself must be the control (or live inside it): a plain
    // card body hit must never be treated as the X.
    if (svg !== hit && !contains(svg, hit)) continue
    if (String(styleOf(svg).cursor ?? '') !== 'pointer') continue

    const control = rectOf(svg)
    if (control === null) continue
    // Top-right quadrant of THIS card, and fully inside it.
    if (control.left < box.left + box.width / 2) continue
    if (control.top > box.top + box.height / 2) continue
    if (control.left + control.width > box.left + box.width + 1) continue
    if (control.top + control.height > box.top + box.height + 1) continue
    // A control that swallows the whole card (or the image itself) is not the X.
    if (control.width >= box.width || control.height >= box.height) continue
    if (!contains(card, svg)) continue

    return { found: true, x, y }
  }
  return { found: false, reason: 'remove-control-not-found' }
}

/**
 * IN-PAGE: the removal CONFIRMATION — the target identity is gone from the
 * composer AND every other draft identity is still there. A shrinking count is
 * never enough (Phase 18A): losing a second draft is a failure, not a success.
 */
export function draftRemovedInPage(payload: {
  target: string
  others: readonly string[]
  env?: DraftImageEnv
  messageSelector?: string
}): boolean {
  const env: DraftImageEnv = payload.env ?? (globalThis as unknown as DraftImageEnv)
  const doc = env.document
  if (doc === undefined || doc === null) return false
  const messageSelector = payload.messageSelector ?? ''

  const attr = (element: unknown, name: string): string => {
    const node = element as { getAttribute?: (n: string) => unknown }
    if (typeof node?.getAttribute !== 'function') return ''
    return String(node.getAttribute(name) ?? '')
  }
  const inComposer = (element: unknown): boolean => {
    let node = (element as { parentElement?: unknown }).parentElement ?? null
    for (let depth = 0; depth < 8 && node !== null && node !== undefined; depth += 1) {
      const probe = node as { querySelector?: (selector: string) => unknown; parentElement?: unknown }
      if (typeof probe.querySelector === 'function') {
        if (probe.querySelector('textarea') !== null) {
          return messageSelector === '' || probe.querySelector(messageSelector) === null
        }
      }
      node = probe.parentElement ?? null
    }
    return false
  }

  const now: string[] = []
  for (const element of Array.from(doc.querySelectorAll('img'))) {
    const src = attr(element, 'src')
    if (!src.startsWith('blob:') || src.length <= 5) continue
    if (!inComposer(element)) continue
    now.push(src)
  }
  if (now.indexOf(payload.target) !== -1) return false
  return payload.others.every((identity) => now.indexOf(identity) !== -1)
}

// --- IN-PAGE: file inputs -----------------------------------------------------

/**
 * One `input[type=file]` as the page really exposes it (standard DOM only). The
 * page may hold MORE than one (DeepSeek ships a single composer input, but a
 * dialog or a second feature can add another), so the input is chosen by its own
 * evidence instead of "the first one on the page".
 */
export interface FileInputCandidate {
  /** Position among `input[type=file]`, for `locator(...).nth(index)`. */
  index: number
  multiple: boolean
  /** Whether the accept list (or its absence) allows image files. */
  acceptsImages: boolean
  /** Length of the accept attribute — the composer's list is by far the longest. */
  acceptLength: number
}

/** IN-PAGE: describe every file input on the page, in DOM order. */
export function describeFileInputsInPage(payload: { env?: DraftImageEnv } = {}): FileInputCandidate[] {
  const env: DraftImageEnv = payload.env ?? (globalThis as unknown as DraftImageEnv)
  const doc = env.document
  if (doc === undefined || doc === null) return []
  // Inlined on purpose (IN-PAGE function): no module constant may leak in.
  const extensions = ['.png', '.jpg', '.jpeg', '.webp', '.gif']

  const out: FileInputCandidate[] = []
  Array.from(doc.querySelectorAll('input[type=file]')).forEach((element, index) => {
    const reader = element as { getAttribute?: (n: string) => unknown; multiple?: unknown } | null
    const accept = typeof reader?.getAttribute === 'function' ? String(reader.getAttribute('accept') ?? '') : ''
    const lowered = accept.toLowerCase()
    out.push({
      index,
      // Real inputs expose `multiple` as a property; the attribute is the fallback.
      multiple:
        reader?.multiple === true ||
        (typeof reader?.getAttribute === 'function' && reader.getAttribute('multiple') !== null),
      // An empty accept means "any file"; a list must mention an image.
      acceptsImages:
        lowered === '' || lowered.includes('image') || extensions.some((extension) => lowered.includes(extension)),
      acceptLength: accept.length,
    })
  })
  return out
}

/**
 * A tiny DOM census, used ONLY to explain a failed attach in the Host log
 * (Phase 18A diagnostics): how many `<input>`s the page exposes at all and how
 * many of them are file inputs.
 */
export interface PageInputCensus {
  totalInputs: number
  fileInputs: number
}

/** IN-PAGE: count the page's inputs (diagnostics only). */
export function countPageInputsInPage(payload: { env?: DraftImageEnv } = {}): PageInputCensus {
  const env: DraftImageEnv = payload.env ?? (globalThis as unknown as DraftImageEnv)
  const doc = env.document
  if (doc === undefined || doc === null) return { totalInputs: 0, fileInputs: 0 }
  return {
    totalInputs: Array.from(doc.querySelectorAll('input')).length,
    fileInputs: Array.from(doc.querySelectorAll('input[type=file]')).length,
  }
}

export type FileInputChoice = { ok: true; index: number } | { ok: false; error: string }

/**
 * Pick the composer's file input (HOST-side, pure): it is the `multiple` input
 * that accepts images and carries the LONGEST accept list (DeepSeek's own list
 * is a few hundred characters). Nothing plausible, or two equally plausible
 * candidates, is a SAFE failure — the Host never drives an input it cannot
 * identify.
 */
export function chooseFileInput(candidates: readonly FileInputCandidate[]): FileInputChoice {
  const usable = candidates.filter((candidate) => candidate.multiple && candidate.acceptsImages)
  if (usable.length === 0) return { ok: false, error: 'DeepSeek page has no image file input' }

  const longest = Math.max(...usable.map((candidate) => candidate.acceptLength))
  const best = usable.filter((candidate) => candidate.acceptLength === longest)
  if (best.length > 1) {
    return { ok: false, error: `ambiguous: DeepSeek page has ${best.length} equally plausible file inputs` }
  }
  return { ok: true, index: best[0]!.index }
}

// --- HOST-side pure helpers ---------------------------------------------------

export interface UploadMetadata {
  /** DeepSeek's file id (`file-<uuid>`) — what the completion request references. */
  fileId: string
  /** `file_name` as DeepSeek echoed it back. */
  fileName: string
  fileSize: number
  /** DeepSeek's own processing status; `PENDING` means "accepted", not "failed". */
  status: string
}

export type UploadResponseResult = { ok: true; meta: UploadMetadata } | { ok: false; error: string }

const FILE_ID_PATTERN = /^file-[0-9a-f-]{36}$/i

/**
 * Validate one `POST /api/v0/file/upload_file` answer. Success means "DeepSeek
 * accepted this upload and returned a usable file id" — NEVER "the audit
 * finished": the real answer carries `status: "PENDING"`, which is fine.
 */
export function normalizeUploadResponse(input: { status: number; body: unknown }): UploadResponseResult {
  if (input.status !== 200) return { ok: false, error: `upload failed (HTTP ${input.status})` }

  const body = asRecord(input.body)
  if (body.code !== 0) return { ok: false, error: `upload rejected (code ${String(body.code ?? 'missing')})` }

  const data = asRecord(body.data)
  if (data.biz_code !== 0) return { ok: false, error: `upload rejected (biz_code ${String(data.biz_code ?? 'missing')})` }

  const biz = asRecord(data.biz_data)
  const fileId = biz.id
  if (typeof fileId !== 'string' || !FILE_ID_PATTERN.test(fileId)) {
    return { ok: false, error: 'upload response carries no usable file id' }
  }
  if (typeof biz.file_name !== 'string') return { ok: false, error: 'upload response carries no file name' }
  if (typeof biz.file_size !== 'number' || !Number.isFinite(biz.file_size)) {
    return { ok: false, error: 'upload response carries no file size' }
  }

  return {
    ok: true,
    meta: {
      fileId,
      fileName: biz.file_name,
      fileSize: biz.file_size,
      status: typeof biz.status === 'string' ? biz.status : '',
    },
  }
}

export type DraftIdentityDiff = { ok: true; identity: string } | { ok: false; error: string }

/**
 * The identity of the draft `setInputFiles` just added: exactly ONE new blob src
 * and nothing lost. Anything else (0, 2+, a vanished identity) is a SAFE
 * failure — the Host can no longer prove which page card belongs to which
 * upload, and guessing is never allowed.
 */
export function diffDraftIdentities(before: readonly string[], after: readonly string[]): DraftIdentityDiff {
  const added = after.filter((identity) => !before.includes(identity))
  const removed = before.filter((identity) => !after.includes(identity))
  if (removed.length > 0) {
    return { ok: false, error: `draft previews changed unexpectedly (${removed.length} disappeared)` }
  }
  if (added.length !== 1) {
    return { ok: false, error: `expected exactly one new draft preview, saw ${added.length}` }
  }
  return { ok: true, identity: added[0]! }
}

/** The `ChatAttachment[]` a verified snapshot turns into (metadata only). */
export function chatAttachmentsFromDraft(
  snapshot: ReadonlyArray<{ id: string; name: string; mimeType: string; bytes: number }>,
): Array<{ id: string; kind: 'image'; name: string; mimeType: string; bytes: number }> {
  return snapshot.map((entry) => ({
    id: entry.id,
    kind: 'image' as const,
    name: entry.name,
    mimeType: entry.mimeType,
    bytes: entry.bytes,
  }))
}

/**
 * The draft identities the composer currently owns (its ready attachments).
 * Used for the set comparison against what the page actually shows.
 */
export function draftIdentitiesOf(
  attachments: readonly ComposerAttachment[],
  identityOf: (id: string) => string | undefined,
): string[] {
  const out: string[] = []
  for (const attachment of attachments) {
    if (attachment.status !== 'ready') continue
    const identity = identityOf(attachment.id)
    if (identity !== undefined) out.push(identity)
  }
  return out
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}
