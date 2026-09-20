/**
 * Minimal value throttle (Phase 07D).
 *
 * Coalesces rapid `push` calls so `onEmit` fires at most once per `intervalMs`,
 * always with the latest value. `flush` emits the latest pending value
 * immediately (used at reply completion so the final text is never dropped).
 */

export interface Throttle {
  push(value: string): void
  flush(): void
  dispose(): void
}

export function createThrottle(onEmit: (value: string) => void, intervalMs: number): Throttle {
  let lastEmitted = ''
  let pending = ''
  let timer: NodeJS.Timeout | null = null

  const emit = (value: string): void => {
    if (value === lastEmitted) return
    lastEmitted = value
    onEmit(value)
  }

  const flush = (): void => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    emit(pending)
  }

  return {
    push(value: string) {
      pending = value
      if (timer === null) {
        timer = setTimeout(flush, intervalMs)
      }
    },
    flush,
    dispose() {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
    },
  }
}
