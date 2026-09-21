/**
 * Client Companion Host-state reader (Phase 06C).
 *
 * One shared reader used by both Dock and Pop-out, so neither view owns its own
 * copy of the state shape. `origin` is the parent DSH page origin (the pop-out
 * is `about:blank`, so it must not rely on its own relative URL).
 */
import type { CompanionState, DeepThinkState } from '../shared/state.ts'

export type { CompanionState }

/** Read-only Host route returning the shared Companion state. */
const STATE_PATH = '/api/deepseek-companion/state'
/** Read-only SSE stream route. */
const STREAM_PATH = '/api/deepseek-companion/state/stream'
/** POST route to focus/reopen the DeepSeek login page. */
const SHOW_PATH = '/api/deepseek-companion/browser/show'
/** POST route to send one chat message and await the final reply. */
const CHAT_PATH = '/api/deepseek-companion/chat'
/** POST route to flip DeepSeek's Deep Think toggle (Phase 07G). */
const DEEP_THINK_PATH = '/api/deepseek-companion/deep-think'

/**
 * Ask the Host to switch DeepSeek's Deep Think toggle and resolve with the REAL
 * state it read back from the page (the Client never keeps its own truth).
 */
export async function setDeepThink(origin: string, enabled: boolean): Promise<DeepThinkState> {
  const response = await fetch(`${origin}${DEEP_THINK_PATH}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  })
  const body = (await response.json().catch(() => null)) as
    | { available?: unknown; enabled?: unknown; error?: unknown }
    | null
  if (!response.ok) {
    throw new Error(typeof body?.error === 'string' ? body.error : `HTTP ${response.status}`)
  }
  return { available: body?.available === true, enabled: body?.enabled === true }
}

/** Ask the Host to focus (or reopen) the DeepSeek login page. */
export async function showDeepSeekBrowser(origin: string): Promise<void> {
  const response = await fetch(`${origin}${SHOW_PATH}`, {
    method: 'POST',
    credentials: 'include',
  })
  if (!response.ok) throw new Error(`show browser failed (HTTP ${response.status})`)
}

/** Send one message and resolve with the final complete reply text. */
export async function sendChatMessage(origin: string, message: string): Promise<string> {
  const response = await fetch(`${origin}${CHAT_PATH}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  })
  if (!response.ok) {
    let detail = `HTTP ${response.status}`
    try {
      const body = (await response.json()) as { error?: unknown }
      if (typeof body.error === 'string') detail = body.error
    } catch {
      // keep the HTTP detail
    }
    throw new Error(detail)
  }
  const body = (await response.json()) as { reply?: unknown }
  if (typeof body.reply !== 'string') throw new Error('invalid reply from Host')
  return body.reply
}

/** One-shot snapshot (still used for simple/fallback reads). */
export async function fetchCompanionState(origin: string, signal?: AbortSignal): Promise<CompanionState> {
  const response = await fetch(`${origin}${STATE_PATH}`, {
    credentials: 'include',
    signal,
  })
  if (!response.ok) throw new Error(`host state unavailable (HTTP ${response.status})`)
  return (await response.json()) as CompanionState
}

/**
 * Subscribe to the Host SSE stream. The Host pushes the current state on
 * connect and then every revision bump. Returns an unsubscribe function that
 * aborts the connection; no auto-reconnect in this phase.
 */
export function subscribeCompanionState(
  origin: string,
  onState: (state: CompanionState) => void,
  onError?: (error: unknown) => void,
): () => void {
  const controller = new AbortController()
  let disposed = false

  void (async () => {
    try {
      const response = await fetch(`${origin}${STREAM_PATH}`, {
        credentials: 'include',
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      if (!response.body) throw new Error('no stream body')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        let separator: number
        while ((separator = buffer.indexOf('\n\n')) !== -1) {
          const rawEvent = buffer.slice(0, separator)
          buffer = buffer.slice(separator + 2)
          const state = parseSseData(rawEvent)
          if (state !== null) onState(state)
        }
      }
    } catch (error) {
      if (disposed || (error instanceof Error && error.name === 'AbortError')) return
      onError?.(error)
    }
  })()

  return () => {
    disposed = true
    controller.abort()
  }
}

/** Parse one `data: {...}` SSE event body into a CompanionState, or null. */
function parseSseData(rawEvent: string): CompanionState | null {
  for (const line of rawEvent.split('\n')) {
    if (!line.startsWith('data: ')) continue
    const text = line.slice('data: '.length).trim()
    if (text === '') return null
    try {
      return JSON.parse(text) as CompanionState
    } catch {
      return null
    }
  }
  return null
}
