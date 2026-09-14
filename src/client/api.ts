/**
 * Client Companion Host-state reader (Phase 06C).
 *
 * One shared reader used by both Dock and Pop-out, so neither view owns its own
 * copy of the state shape. `origin` is the parent DSH page origin (the pop-out
 * is `about:blank`, so it must not rely on its own relative URL).
 */
import type { CompanionState } from '../shared/state.ts'

export type { CompanionState }

/** Read-only Host route returning the shared Companion state. */
const STATE_PATH = '/api/deepseek-companion/state'
/** Read-only SSE stream route. */
const STREAM_PATH = '/api/deepseek-companion/state/stream'

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
