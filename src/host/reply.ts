/**
 * DeepSeek assistant-reply reader (Phase 07E).
 *
 * The reader prefers the raw Markdown DeepSeek keeps in its React props
 * (`memoizedProps.markdown`, else a matching `memoizedProps.content`) and falls
 * back to the rendered plain text, so a DeepSeek front-end change can never
 * break chat.
 *
 * Both exported functions are deliberately SELF-CONTAINED (they reference no
 * module-level values) because Playwright serializes them into the browser
 * context. They receive the browser surface by injection, which keeps the exact
 * same code unit-testable in Node without a browser.
 *
 * Only `{ content, format }` ever leaves the page: no HTML, no React object, no
 * token, no cookie.
 */

/** The DOM surface the reader needs (`document` inside the page). */
export interface ReplyDom {
  body: unknown
  querySelectorAll(selector: string): ArrayLike<unknown>
}

/** The observer surface the reader needs (`MutationObserver` inside the page). */
export interface ReplyObserver {
  observe(target: unknown, options: { childList?: boolean; subtree?: boolean; characterData?: boolean }): void
  disconnect(): void
}

/** Injectable browser surface (real globals in the page, fakes in tests). */
export interface ReplyEnv {
  document: ReplyDom
  window: Record<string, unknown>
  MutationObserver: new (callback: () => void) => ReplyObserver
}

export interface ReplyReadOptions {
  /** Primary assistant reply selector. */
  selector: string
  /** Selector used when the primary one matches nothing. */
  fallback: string
  /** How many replies existed before the send began (only newer ones are read). */
  startCount: number
  /** How many `fiber.return` hops to scan for the raw Markdown prop. */
  maxScan: number
}

export interface ReplyReadResult {
  content: string
  format: 'text' | 'markdown'
}

/**
 * Install the reply reader into the page: it watches the DOM and pushes the
 * growing reply (raw Markdown when available) through `window.__onReplyDelta`.
 *
 * NOTE: every string key is written inline (not imported) so this function
 * survives Playwright's serialization. `__onReplyDelta` must match the name
 * registered by `context.exposeFunction` in `browser.ts`.
 */
export function installReplyReader(payload: { options: ReplyReadOptions; env?: ReplyEnv }): void {
  const options = payload.options
  const env: Partial<ReplyEnv> = payload.env ?? (globalThis as unknown as Partial<ReplyEnv>)
  const doc = env.document
  const win = env.window
  const ObserverCtor = env.MutationObserver
  if (doc === undefined || win === undefined || ObserverCtor === undefined) return

  const readReply = (): ReplyReadResult => {
    const select = (selector: string): unknown[] => Array.from(doc.querySelectorAll(selector))
    const primary = select(options.selector)
    const nodes = primary.length > 0 ? primary : select(options.fallback)
    // Only the NEW reply (never stale history); '' means "not started yet".
    if (nodes.length <= options.startCount) return { content: '', format: 'text' }

    const node = nodes[nodes.length - 1] as { textContent?: string | null }
    const rendered = (node.textContent ?? '').trim()

    // Strip Markdown markers + whitespace so raw source and rendered text can be
    // compared loosely. Kept inline: this function must stay self-contained.
    const strip = (value: string): string => {
      let out = ''
      for (const ch of value) {
        if ('#*`_~>!|-()[]{}'.includes(ch)) continue
        if (/\s/.test(ch)) continue
        out += ch
      }
      return out
    }

    // 1) Prefer DeepSeek's raw Markdown. Its fiber layout is private, so scan a
    //    bounded ancestor chain instead of hard-coding a depth.
    const fiberKey = Object.keys(node).find((key) => key.startsWith('__reactFiber$'))
    let fiber: unknown = fiberKey !== undefined ? (node as Record<string, unknown>)[fiberKey] : undefined
    for (let depth = 0; depth < options.maxScan && fiber != null; depth += 1) {
      const props = (fiber as { memoizedProps?: Record<string, unknown> | null }).memoizedProps
      if (props != null) {
        const markdown = props['markdown']
        if (typeof markdown === 'string' && markdown.trim() !== '') {
          return { content: markdown, format: 'markdown' }
        }
        // `content` is a generic prop name: only trust it when its visible text
        // clearly matches this reply's rendered text.
        const content = props['content']
        if (typeof content === 'string') {
          const stripped = strip(content)
          const probe = strip(rendered).slice(0, 24)
          if (stripped !== '' && probe !== '' && stripped.includes(probe)) {
            return { content, format: 'markdown' }
          }
        }
      }
      fiber = (fiber as { return?: unknown }).return
    }

    // 2) Fallback: rendered plain text (chat must never break).
    return { content: rendered, format: 'text' }
  }

  const observer = new ObserverCtor(() => {
    const onDelta = win['__onReplyDelta']
    if (typeof onDelta === 'function') (onDelta as (reply: ReplyReadResult) => void)(readReply())
  })
  observer.observe(doc.body, { childList: true, subtree: true, characterData: true })
  win['__replyObserver'] = observer
  win['__readReply'] = readReply
}

/**
 * Read the final reply and tear the reader down (observer + page globals). Used
 * after `response.finished()` so the assistant message ends up with the final
 * raw Markdown.
 */
export function readAndCleanupReply(payload?: { env?: ReplyEnv }): unknown {
  const env: Partial<ReplyEnv> = payload?.env ?? (globalThis as unknown as Partial<ReplyEnv>)
  const win = env.window
  if (win === undefined) return null
  const read = win['__readReply']
  const reply = typeof read === 'function' ? (read as () => unknown)() : null
  const observer = win['__replyObserver'] as ReplyObserver | undefined
  if (observer !== undefined && typeof observer.disconnect === 'function') observer.disconnect()
  delete win['__replyObserver']
  delete win['__readReply']
  return reply
}

/** Tear the reader down without reading (error / cleanup path). */
export function cleanupReplyReader(payload?: { env?: ReplyEnv }): void {
  const env: Partial<ReplyEnv> = payload?.env ?? (globalThis as unknown as Partial<ReplyEnv>)
  const win = env.window
  if (win === undefined) return
  const observer = win['__replyObserver'] as ReplyObserver | undefined
  if (observer !== undefined && typeof observer.disconnect === 'function') observer.disconnect()
  delete win['__replyObserver']
  delete win['__readReply']
}
