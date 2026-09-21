/**
 * Minimal local remark plugin for DeepSeek citation markers (Phase 07I).
 *
 * DeepSeek's raw Markdown carries `[reference:N]` / `[citation:N]` markers that
 * mean nothing to a normal Markdown renderer. This plugin rewrites ONLY ordinary
 * text nodes:
 *
 *   - resolved marker → a real Markdown `link` node (`[N]` → `<a href>`) so it
 *     goes through react-markdown's own URL handling;
 *   - unresolved marker → a plain `[N]` label, so DeepSeek's internal syntax is
 *     never shown to the user.
 *
 * `code` and `inlineCode` subtrees are deliberately skipped: a code sample that
 * happens to contain `[reference:1]` must stay literal text.
 */

/** marker number → resolved url */
export type CitationUrls = Map<number, string>

export interface CitationRemarkOptions {
  urls: CitationUrls
}

/** Both dialects DeepSeek emits. */
const MARKER_SOURCE = '\\[(?:reference|citation):(\\d+)\\]'
/** Class put on the rendered anchor so the view can style it as a badge. */
const CITATION_CLASS = 'dsc-citation'

interface AstNode {
  type?: string
  value?: unknown
  url?: unknown
  title?: unknown
  data?: unknown
  children?: unknown[]
}

/** Turn one text value into a mix of text and link nodes. */
function splitText(value: string, urls: CitationUrls): unknown[] {
  const pattern = new RegExp(MARKER_SOURCE, 'g')
  const out: unknown[] = []
  let last = 0
  let matched = false
  let match: RegExpExecArray | null

  while ((match = pattern.exec(value)) !== null) {
    matched = true
    if (match.index > last) out.push({ type: 'text', value: value.slice(last, match.index) })
    const marker = Number(match[1])
    const label = `[${marker}]`
    const url = urls.get(marker)
    if (url === undefined) {
      // Not hydrated (yet): keep the number, hide DeepSeek's internal syntax.
      out.push({ type: 'text', value: label })
    } else {
      out.push({
        type: 'link',
        url,
        title: null,
        // `hProperties` becomes the rendered anchor's attribute set.
        data: { hProperties: { className: CITATION_CLASS } },
        children: [{ type: 'text', value: label }],
      })
    }
    last = match.index + match[0].length
  }

  if (!matched) return [{ type: 'text', value }]
  if (last < value.length) out.push({ type: 'text', value: value.slice(last) })
  return out
}

/** Rewrite markers in place, recursing only where Markdown text can live. */
function transform(parent: AstNode, urls: CitationUrls): void {
  if (!Array.isArray(parent.children)) return
  const next: unknown[] = []
  for (const child of parent.children) {
    const node = child as AstNode
    if (node !== null && typeof node === 'object' && node.type === 'text' && typeof node.value === 'string') {
      next.push(...splitText(node.value, urls))
      continue
    }
    // Code — fenced or inline — is literal: never look inside it.
    if (node !== null && typeof node === 'object' && node.type !== 'code' && node.type !== 'inlineCode') {
      transform(node, urls)
    }
    next.push(node)
  }
  parent.children = next
}

/**
 * Remark plugin (attacher). Pass it to `remarkPlugins` as
 * `[remarkCitations, { urls }]`.
 */
export function remarkCitations(options: CitationRemarkOptions): (tree: unknown) => void {
  const urls = options?.urls ?? new Map<number, string>()
  return (tree: unknown) => {
    if (tree === null || typeof tree !== 'object') return
    transform(tree as AstNode, urls)
  }
}
