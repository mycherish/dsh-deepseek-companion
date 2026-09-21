/**
 * DeepSeek reasoning ("Deep Think") reader (Phase 07F).
 *
 * DeepSeek renders the model's thinking into `.ds-think-content`. Phase 07F-0
 * verified that — unlike the assistant reply — that node carries **no** raw
 * Markdown prop on its React fiber, and its text contains no Markdown markers
 * (it is natural-language thinking). So the reader falls back to `textContent`.
 *
 * It still probes a bounded fiber chain for a reasoning-ish raw prop first, so
 * if DeepSeek ever exposes one it is picked up automatically (and only then is
 * the value treated as Markdown).
 *
 * Same rules as `reply.ts`: self-contained (Playwright serializes it into the
 * browser context), injected browser surface (unit-testable in Node), and only
 * `{ content, format }` ever leaves the page.
 */
import type { ReplyEnv, ReplyObserver, ReplyReadResult } from './reply.ts'

export interface ReasoningReadOptions {
  /** Primary reasoning container selector. */
  selector: string
  /** How many reasoning blocks existed before the send began. */
  startCount: number
  /** How many `fiber.return` hops to scan for a raw reasoning prop. */
  maxScan: number
}

/**
 * Install the reasoning reader into the page: it watches `.ds-think-content` and
 * pushes the growing thinking text through `window.__onReasoningDelta`.
 *
 * NOTE: every string key is written inline (not imported) so this function
 * survives Playwright's serialization. `__onReasoningDelta` must match the name
 * registered by `context.exposeFunction` in `browser.ts`. If the page has no
 * reasoning container at all (Deep Think off), the reader simply emits nothing —
 * chat keeps working exactly as in Phase 07E.
 */
export function installReasoningReader(payload: { options: ReasoningReadOptions; env?: ReplyEnv }): void {
  const options = payload.options
  const env: Partial<ReplyEnv> = payload.env ?? (globalThis as unknown as Partial<ReplyEnv>)
  const doc = env.document
  const win = env.window
  const ObserverCtor = env.MutationObserver
  if (doc === undefined || win === undefined || ObserverCtor === undefined) return

  const selectNodes = (): unknown[] => Array.from(doc.querySelectorAll(options.selector))

  // Same node-identity guard as the reply reader: DeepSeek recycles old turns
  // out of the DOM, so comparing counts is unreliable across turns.
  const initialNodes = selectNodes()
  win['__reasoningBase'] = initialNodes.length > 0 ? initialNodes[initialNodes.length - 1] : null

  const readReasoning = (): ReplyReadResult => {
    const nodes = selectNodes()
    // Only reasoning produced by THIS send (never stale history).
    if (nodes.length === 0) return { content: '', format: 'text' }
    const node = nodes[nodes.length - 1] as { textContent?: string | null }
    const base = win['__reasoningBase']
    if (base !== null && base !== undefined && node === base) {
      return { content: '', format: 'text' }
    }
    if ((base === null || base === undefined) && nodes.length <= options.startCount) {
      return { content: '', format: 'text' }
    }
    const rendered = (node.textContent ?? '').trim()

    // Treat a value as Markdown only when it actually carries Markdown syntax —
    // reasoning is plain thinking text in practice.
    const looksLikeMarkdown = (value: string): boolean =>
      /(^|\n)#{1,6} /.test(value) ||
      /\*\*/.test(value) ||
      /(^|\n)\s*[-*] /.test(value) ||
      /(^|\n)\s*\d+\. /.test(value) ||
      /```/.test(value) ||
      /\[[^\]]+\]\([^)]+\)/.test(value)

    // 1) Prefer a raw reasoning prop if DeepSeek exposes one. The fiber layout is
    //    private, so scan a bounded ancestor chain instead of hard-coding a depth.
    const fiberKey = Object.keys(node).find((key) => key.startsWith('__reactFiber$'))
    let fiber: unknown = fiberKey !== undefined ? (node as Record<string, unknown>)[fiberKey] : undefined
    for (let depth = 0; depth < options.maxScan && fiber != null; depth += 1) {
      const props = (fiber as { memoizedProps?: Record<string, unknown> | null }).memoizedProps
      if (props != null) {
        const names = ['reasoning', 'reasoningContent', 'reasoning_content', 'thinking', 'think']
        for (const name of names) {
          const value = props[name]
          if (typeof value === 'string' && value.trim() !== '') {
            return { content: value, format: looksLikeMarkdown(value) ? 'markdown' : 'text' }
          }
        }
      }
      fiber = (fiber as { return?: unknown }).return
    }

    // 2) Fallback: rendered thinking text (Deep Think produces plain text today).
    return { content: rendered, format: looksLikeMarkdown(rendered) ? 'markdown' : 'text' }
  }

  // Same condition-wait helper as the reply reader (Phase 07G hardening).
  const hasNewReasoning = (): boolean => {
    const nodes = selectNodes()
    if (nodes.length === 0) return false
    const base = win['__reasoningBase']
    if (base !== null && base !== undefined && nodes[nodes.length - 1] === base) return false
    if ((base === null || base === undefined) && nodes.length <= options.startCount) return false
    return true
  }
  win['__hasNewReasoning'] = hasNewReasoning

  const observer = new ObserverCtor(() => {
    const onDelta = win['__onReasoningDelta']
    if (typeof onDelta === 'function') (onDelta as (reply: ReplyReadResult) => void)(readReasoning())
  })
  observer.observe(doc.body, { childList: true, subtree: true, characterData: true })
  win['__reasoningObserver'] = observer
  win['__readReasoning'] = readReasoning
}

/**
 * Read the final reasoning and tear the reader down. Used after
 * `response.finished()` so the thinking block ends up complete.
 */
export function readAndCleanupReasoning(payload?: { env?: ReplyEnv }): unknown {
  const env: Partial<ReplyEnv> = payload?.env ?? (globalThis as unknown as Partial<ReplyEnv>)
  const win = env.window
  if (win === undefined) return null
  const read = win['__readReasoning']
  const reasoning = typeof read === 'function' ? (read as () => unknown)() : null
  const observer = win['__reasoningObserver'] as ReplyObserver | undefined
  if (observer !== undefined && typeof observer.disconnect === 'function') observer.disconnect()
  delete win['__reasoningObserver']
  delete win['__readReasoning']
  delete win['__reasoningBase']
  delete win['__hasNewReasoning']
  return reasoning
}

/** Tear the reasoning reader down without reading (error / cleanup path). */
export function cleanupReasoningReader(payload?: { env?: ReplyEnv }): void {
  const env: Partial<ReplyEnv> = payload?.env ?? (globalThis as unknown as Partial<ReplyEnv>)
  const win = env.window
  if (win === undefined) return
  const observer = win['__reasoningObserver'] as ReplyObserver | undefined
  if (observer !== undefined && typeof observer.disconnect === 'function') observer.disconnect()
  delete win['__reasoningObserver']
  delete win['__readReasoning']
  delete win['__reasoningBase']
  delete win['__hasNewReasoning']
}
