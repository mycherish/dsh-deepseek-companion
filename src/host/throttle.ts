/**
 * Minimal value throttle (Phase 07D / 07E).
 *
 * Coalesces rapid `push` calls so `onEmit` fires at most once per `intervalMs`,
 * always with the latest value. `flush` emits the latest pending value
 * immediately (used at reply completion so the final value is never dropped).
 * Generic over the value type; `isEqual` decides whether an emit is redundant.
 */

export interface Throttle<T> {
  push(value: T): void
  flush(): void
  dispose(): void
}

export function createThrottle<T>(
  onEmit: (value: T) => void,
  intervalMs: number,
  isEqual: (a: T, b: T) => boolean,
): Throttle<T> {
  let lastEmitted: T | null = null
  let pending: T | null = null
  let timer: NodeJS.Timeout | null = null

  const emit = (value: T): void => {
    if (lastEmitted !== null && isEqual(value, lastEmitted)) return
    lastEmitted = value
    onEmit(value)
  }

  const flush = (): void => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    if (pending !== null) emit(pending)
  }

  return {
    push(value: T) {
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
