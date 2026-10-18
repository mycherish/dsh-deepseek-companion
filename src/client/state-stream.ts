/** Transport state is local to a view; it is independent of Host browser recovery. */
export type StateStreamStatus = 'connecting' | 'connected' | 'reconnecting'

export interface StateStreamRuntime {
  fetch(url: string, init: RequestInit): Promise<Response>
  /** Return a cancellation function so browser and test clocks share one contract. */
  schedule(callback: () => void, delayMs: number): () => void
}

const runtime: StateStreamRuntime = {
  fetch: (url, init) => globalThis.fetch(url, init),
  schedule(callback, delayMs) {
    const timer = setTimeout(callback, delayMs)
    return () => clearTimeout(timer)
  },
}

/** Reconnect a read-only state feed. No action or chat request is ever replayed. */
export function subscribeStateStream<T>(
  options: {
    url: string
    parseEvent(event: string): T | null
    onState(state: T): void
    onError?(error: unknown): void
    onStatus?(status: StateStreamStatus): void
  },
  clock: StateStreamRuntime = runtime,
): () => void {
  let disposed = false
  let failures = 0
  let status: StateStreamStatus | undefined
  let activeController: AbortController | undefined
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let cancelRetry: (() => void) | undefined
  let cancelSnapshotTimeout: (() => void) | undefined

  const publishStatus = (next: StateStreamStatus): void => {
    if (disposed || status === next) return
    status = next
    options.onStatus?.(next)
  }

  const connect = async (): Promise<void> => {
    if (disposed) return
    const controller = new AbortController()
    activeController = controller
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    // A connection must produce a fresh snapshot before the view enables actions.
    const cancelTimeout = clock.schedule(() => {
      controller.abort()
      void reader?.cancel().catch(() => {})
    }, 10_000)
    cancelSnapshotTimeout = cancelTimeout
    try {
      const response = await clock.fetch(options.url, { credentials: 'include', signal: controller.signal })
      if (disposed) {
        await response.body?.cancel().catch(() => {})
        return
      }
      if (controller.signal.aborted) {
        await response.body?.cancel().catch(() => {})
        throw new Error('state stream snapshot timeout')
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {})
        throw new Error(`state stream HTTP ${response.status}`)
      }
      if (!response.body) throw new Error('state stream has no body')
      reader = response.body.getReader()
      activeReader = reader
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (disposed) break
        if (controller.signal.aborted) throw new Error('state stream snapshot timeout')
        if (done) throw new Error('state stream ended')
        buffer += decoder.decode(value, { stream: true })
        for (;;) {
          const separator = /\r?\n\r?\n/.exec(buffer)
          if (separator === null) break
          const event = buffer.slice(0, separator.index)
          buffer = buffer.slice(separator.index + separator[0].length)
          const state = options.parseEvent(event)
          if (state === null) continue
          if (disposed || controller.signal.aborted) break
          cancelTimeout()
          failures = 0
          options.onState(state)
          publishStatus('connected')
        }
      }
    } catch (error) {
      if (!disposed) {
        publishStatus('reconnecting')
        options.onError?.(error)
      }
    } finally {
      cancelTimeout()
      if (cancelSnapshotTimeout === cancelTimeout) cancelSnapshotTimeout = undefined
      controller.abort()
      if (reader !== undefined) {
        await reader.cancel().catch(() => {})
        reader.releaseLock()
      }
      if (activeController === controller) activeController = undefined
      if (activeReader === reader) activeReader = undefined
    }
    if (disposed) return
    publishStatus('reconnecting')
    const delayMs = Math.min(500 * 2 ** Math.min(failures, 4), 5000)
    failures += 1
    cancelRetry = clock.schedule(() => {
      cancelRetry = undefined
      void connect()
    }, delayMs)
  }

  publishStatus('connecting')
  void connect()
  return () => {
    if (disposed) return
    disposed = true
    cancelRetry?.()
    cancelSnapshotTimeout?.()
    activeController?.abort()
    void activeReader?.cancel().catch(() => {})
  }
}
