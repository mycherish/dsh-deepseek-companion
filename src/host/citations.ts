/**
 * DeepSeek search-answer citation handling (Phase 07I).
 *
 * Investigation (07I-0) established:
 *   - the raw Markdown contains only `[reference:N]` / `[citation:N]` markers —
 *     N carries NO url;
 *   - the real url is hydrated LATER by DeepSeek onto the rendered badge
 *     (`.ds-markdown-cite`, which becomes an `<a href>` once ready);
 *   - adjacent markers are merged into ONE badge, so marker count >= badge count;
 *   - marker-group order always matches badge order.
 *
 * So the mapping is positional and strictly validated: if the counts disagree we
 * do NOT guess, and chat keeps working with plain `[N]` markers.
 *
 * Everything here is a pure function except the page-side reader, which stays
 * self-contained so Playwright can serialize it.
 */

/** One badge's worth of markers: adjacent markers share a single source. */
export interface CitationGroup {
  /** Marker numbers in source order, e.g. `[1, 2]`. */
  markers: number[]
}

/**
 * One resolved source behind a DeepSeek search answer (Phase 07I). Deliberately
 * minimal: DeepSeek exposes no stable title/snippet, so we only model what we
 * can actually verify.
 */
export interface Citation {
  /** The marker number as it appears in the raw Markdown (`[reference:N]`). */
  marker: number
  /** The real URL DeepSeek hydrated onto the badge (protocol-validated). */
  url: string
  /** `new URL(url).hostname` — the only "site name" available. */
  domain: string
}

/** Matches both marker dialects DeepSeek emits. */
const MARKER_PATTERN = /\[(?:reference|citation):(\d+)\]/g

/**
 * Split Markdown into marker groups. Markers separated ONLY by whitespace land
 * in the same group (DeepSeek renders them as one badge); any other text — or a
 * code fence, an ordinary word, punctuation — starts a new group.
 */
export function parseCitationGroups(markdown: string): CitationGroup[] {
  const groups: CitationGroup[] = []
  const pattern = new RegExp(MARKER_PATTERN.source, 'g')
  let current: number[] | null = null
  let lastEnd = -1
  let match: RegExpExecArray | null

  while ((match = pattern.exec(markdown)) !== null) {
    const gap = markdown.slice(lastEnd + 1, match.index)
    const adjacent = current !== null && lastEnd >= 0 && gap.trim() === ''
    if (!adjacent) {
      if (current !== null) groups.push({ markers: current })
      current = []
    }
    current!.push(Number(match[1]))
    lastEnd = match.index + match[0].length - 1
  }
  if (current !== null) groups.push({ markers: current })
  return groups
}

/** How many source links this Markdown would need. */
export function citationGroupCount(markdown: string): number {
  return parseCitationGroups(markdown).length
}

/**
 * Validate a hydrated href. Only `http:` / `https:` are accepted — `javascript:`,
 * `data:`, `file:` and anything unparseable are rejected. The ORIGINAL string is
 * returned as-is so a click lands on exactly the URL DeepSeek used.
 */
export function safeCitationUrl(raw: string | null): { url: string; domain: string } | null {
  if (raw === null) return null
  const value = raw.trim()
  if (value === '') return null
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  if (parsed.hostname === '') return null
  return { url: value, domain: parsed.hostname }
}

/** Coerce whatever came back from the page into `(string | null)[]`. */
export function normalizeBadges(value: unknown): (string | null)[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => (typeof entry === 'string' && entry !== '' ? entry : null))
}

/**
 * Map marker groups onto hydrated badges.
 *
 * The mapping is positional and CONSERVATIVE — it returns `[]` (no citations at
 * all) unless every one of these holds:
 *   1. there is at least one group and one badge;
 *   2. group count === badge count (adjacent markers are merged, so a mismatch
 *      means we cannot trust the ordering);
 *   3. every badge has a protocol-valid url;
 *   4. no marker maps to two different urls.
 *
 * A marker that appears in several places with the SAME url collapses into one
 * `Citation`.
 */
export function resolveCitations(input: { groups: CitationGroup[]; badges: (string | null)[] }): Citation[] {
  const { groups, badges } = input
  if (groups.length === 0 || groups.length !== badges.length) return []

  const markerToUrl = new Map<number, { url: string; domain: string }>()
  for (let index = 0; index < groups.length; index += 1) {
    const safe = safeCitationUrl(badges[index] ?? null)
    // Any invalid badge makes the whole ordering suspect → give up entirely.
    if (safe === null) return []
    for (const marker of groups[index]!.markers) {
      const existing = markerToUrl.get(marker)
      if (existing !== undefined && existing.url !== safe.url) {
        // One marker pointing at two different sources: never guess.
        return []
      }
      markerToUrl.set(marker, safe)
    }
  }

  return [...markerToUrl.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([marker, value]) => ({ marker, url: value.url, domain: value.domain }))
}

// --- block mapping (Phase 07I-1) --------------------------------------------
// The global "group count === badge count" rule fails often (DeepSeek renders a
// badge only for the references that resolved to a real source). Block-level
// mapping instead matches a Markdown block to the DOM block that renders it,
// with EXACT text equality, and then applies the strict rule per block.

/** One Markdown block that carries at least one citation marker. */
export interface MarkdownBlock {
  /** Visible text with markers/decoration removed and whitespace normalized. */
  text: string
  /** Marker groups inside this block, in source order. */
  groups: number[][]
}

const FENCE = /^\s*(?:```|~~~)/
const BLOCK_START = /^\s{0,3}(?:#{1,6}\s+|(?:[-*+]|\d+[.)])\s+)/

/**
 * Normalize a block's visible text so it can be compared with the rendered DOM
 * text: drop link targets, citation markers, block/inline decoration, then
 * collapse whitespace. Deliberately strict — no fuzzy step follows.
 *
 * Self-contained on purpose: it is also sent into the page for the DOM side.
 */
export function normalizeBlockText(raw: string): string {
  let text = raw
  // Links keep their label only; images keep their alt text.
  text = text.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
  // Citation markers are compared separately, never as text.
  text = text.replace(/\[(?:reference|citation):\d+\]/g, '')
  // Leading block decoration per line (heading hashes, quote marks, bullets).
  text = text.replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|(?:[-*+]|\d+[.)])\s+)/gm, '')
  // Hyphens are dropped on BOTH sides. A citation badge DeepSeek has not
  // hydrated renders as a hidden "-" glyph in the DOM (the hydrated ones sit
  // inside `.ds-markdown-cite` and are removed by the DOM reader), so the
  // rendered text carries a stray "-" the Markdown source does not have.
  // Removing it symmetrically keeps the comparison exact.
  text = text.replace(/-/g, '')
  // Inline decoration.
  text = text.replace(/[*_`~]/g, '')
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Split raw Markdown into the block units DeepSeek renders as separate DOM
 * elements: fenced code is skipped entirely, blank lines and block starts
 * (heading / list item) cut a new block. Only blocks carrying markers are kept,
 * because only those can ever produce a citation.
 */
export function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = []
  let current: string[] = []
  let inFence = false

  const flush = (): void => {
    const raw = current.join('\n')
    current = []
    const groups = parseCitationGroups(raw)
    if (groups.length === 0) return
    const text = normalizeBlockText(raw)
    if (text === '') return
    blocks.push({ text, groups: groups.map((group) => group.markers) })
  }

  for (const line of markdown.split('\n')) {
    if (FENCE.test(line)) {
      flush()
      inFence = !inFence
      continue
    }
    if (inFence) continue
    if (line.trim() === '') {
      flush()
      continue
    }
    if (BLOCK_START.test(line)) flush()
    current.push(line)
  }
  flush()
  return blocks
}

/** One rendered DOM block as read from the page (raw text, badge-free). */
export interface DomBlock {
  /** Visible text with the badge text removed, NOT yet normalized. */
  text: string
  /** Hydrated href per badge, in DOM order (`null` = not hydrated). */
  badges: (string | null)[]
}

/**
 * Map Markdown blocks onto DOM blocks, then resolve each matched block with the
 * strict rule. A block is only ever matched when its normalized text EQUALS a
 * DOM block's normalized text, and only blocks whose marker-group count equals
 * their badge count contribute citations. Everything else is dropped — other
 * blocks are unaffected, so partial success is normal.
 */
export function resolveCitationsByBlock(input: { markdown: string; domBlocks: DomBlock[] }): Citation[] {
  const blocks = parseMarkdownBlocks(input.markdown)
  if (blocks.length === 0) return []

  // Normalize the page's raw text with the SAME rules as the Markdown side.
  const domBlocks = input.domBlocks.map((block) => ({ text: normalizeBlockText(block.text), badges: block.badges }))

  const markerToUrl = new Map<number, { url: string; domain: string }>()
  const used = new Set<number>()

  for (const block of blocks) {
    // Strict: the block must render as a DOM block with identical visible text.
    const index = domBlocks.findIndex((candidate, position) => !used.has(position) && candidate.text === block.text)
    if (index === -1) continue
    used.add(index)
    const dom = domBlocks[index]!
    if (dom.badges.length !== block.groups.length) continue

    const urls: { url: string; domain: string }[] = []
    let valid = true
    for (const badge of dom.badges) {
      const safe = safeCitationUrl(badge)
      if (safe === null) {
        valid = false
        break
      }
      urls.push(safe)
    }
    if (!valid) continue

    for (let groupIndex = 0; groupIndex < block.groups.length; groupIndex += 1) {
      const safe = urls[groupIndex]!
      for (const marker of block.groups[groupIndex]!) {
        const existing = markerToUrl.get(marker)
        if (existing !== undefined && existing.url !== safe.url) {
          // Conflicting evidence for one marker: drop that marker, keep the rest.
          markerToUrl.delete(marker)
          continue
        }
        markerToUrl.set(marker, safe)
      }
    }
  }

  return [...markerToUrl.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([marker, value]) => ({ marker, url: value.url, domain: value.domain }))
}

// --- page side --------------------------------------------------------------
// `readCitationBadges` is SELF-CONTAINED (no module-level references) because
// Playwright serializes it into the browser context. It reads a NODE handed to
// it, so the caller can bind it to one specific assistant reply.

/**
 * Read every rendered block inside one assistant node (innermost `p` / `li` /
 * `blockquote` / `h1-h6` / `td` / `th`), with the badge text stripped from the
 * visible text so it can be compared with the Markdown source.
 *
 * Self-contained (Playwright serializes it); the caller normalizes the returned
 * text with the same rules as the Markdown side.
 */
export function readDomBlocks(node: unknown): DomBlock[] {
  const container = node as { querySelectorAll?: (selector: string) => ArrayLike<unknown> } | null
  if (container === null || container === undefined || typeof container.querySelectorAll !== 'function') return []

  const CANDIDATES = 'p, li, blockquote, h1, h2, h3, h4, h5, h6, td, th'
  const all = Array.from(container.querySelectorAll(CANDIDATES))
  // Only the innermost blocks: a <li> wrapping a <p> must not count twice.
  const leaves = all.filter((el) => {
    const probe = el as { querySelector?: (selector: string) => unknown }
    if (typeof probe.querySelector !== 'function') return false
    if (probe.querySelector(CANDIDATES) !== null) return false
    const closest = (el as { closest?: (selector: string) => unknown }).closest
    // Code samples are literal text, never sources.
    return typeof closest !== 'function' || closest.call(el, 'pre') === null
  })

  return leaves.map((el) => {
    const badgeEls = Array.from(
      (el as { querySelectorAll(s: string): ArrayLike<unknown> }).querySelectorAll('.ds-markdown-cite'),
    )
    const badges = badgeEls.map((badge) => {
      const b = badge as {
        tagName?: string
        getAttribute?: (n: string) => string | null
        querySelector?: (s: string) => unknown
        closest?: (s: string) => unknown
      }
      // The badge itself can be the anchor...
      if (b.tagName === 'A' && typeof b.getAttribute === 'function') {
        const own = b.getAttribute('href')
        if (typeof own === 'string' && own !== '') return own
      }
      // ...or (today's shape) it is nested INSIDE the anchor.
      if (typeof b.closest === 'function') {
        const anchor = b.closest('a[href]') as { getAttribute?: (n: string) => string | null } | null
        const href =
          anchor !== null && anchor !== undefined && typeof anchor.getAttribute === 'function'
            ? anchor.getAttribute('href')
            : null
        if (typeof href === 'string' && href !== '') return href
      }
      if (typeof b.querySelector !== 'function') return null
      const inner = b.querySelector('a[href]') as { getAttribute?: (n: string) => string | null } | null
      const nested =
        inner !== null && inner !== undefined && typeof inner.getAttribute === 'function'
          ? inner.getAttribute('href')
          : null
      return typeof nested === 'string' && nested !== '' ? nested : null
    })

    // Visible text WITHOUT the badges (they render as "-5"-style glyphs).
    const source = el as { cloneNode?: (deep: boolean) => unknown; textContent?: string | null }
    let text = source.textContent ?? ''
    const clone =
      typeof source.cloneNode === 'function'
        ? (source.cloneNode(true) as {
            querySelectorAll?: (s: string) => ArrayLike<unknown>
            textContent?: string | null
          })
        : null
    if (clone !== null && typeof clone.querySelectorAll === 'function') {
      Array.from(clone.querySelectorAll('.ds-markdown-cite')).forEach((badge) => {
        ;(badge as { remove?: () => void }).remove?.()
      })
      text = clone.textContent ?? ''
    }
    return { text, badges }
  })
}

/**
 * Read the (possibly still un-hydrated) hrefs of the citation badges inside one
 * assistant node, in DOM order. `null` means "this badge has no url yet".
 */
export function readCitationBadges(node: unknown): (string | null)[] {
  const container = node as { querySelectorAll?: (selector: string) => ArrayLike<unknown> } | null
  if (container === null || container === undefined || typeof container.querySelectorAll !== 'function') return []
  return Array.from(container.querySelectorAll('.ds-markdown-cite')).map((badge) => {
    const el = badge as {
      tagName?: string
      href?: unknown
      getAttribute?: (name: string) => string | null
      querySelector?: (selector: string) => unknown
      closest?: (selector: string) => unknown
    }
    // DeepSeek renders `<a href="…"><span class="ds-markdown-cite">…</span></a>`,
    // so the anchor is the badge's PARENT. Check all three shapes in order.
    if (el.tagName === 'A' && typeof el.getAttribute === 'function') {
      const own = el.getAttribute('href')
      if (typeof own === 'string' && own !== '') return own
    }
    if (typeof el.closest === 'function') {
      const anchor = el.closest('a[href]') as { getAttribute?: (name: string) => string | null } | null
      const href =
        anchor !== null && anchor !== undefined && typeof anchor.getAttribute === 'function'
          ? anchor.getAttribute('href')
          : null
      if (typeof href === 'string' && href !== '') return href
    }
    if (typeof el.querySelector !== 'function') return null
    const inner = el.querySelector('a[href]') as { getAttribute?: (name: string) => string | null } | null
    if (inner === null || inner === undefined || typeof inner.getAttribute !== 'function') return null
    const nested = inner.getAttribute('href')
    return typeof nested === 'string' && nested !== '' ? nested : null
  })
}
