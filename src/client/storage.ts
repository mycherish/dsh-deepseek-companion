/**
 * Overlay width persistence (Phase 05B).
 *
 * Only the `shell.overlay` width is persisted; the `details` column width stays
 * fully owned by DSH and is never read, written, or synced here. Storage is an
 * optional UI capability: every read/write degrades to the default width on
 * failure and never throws into the React tree.
 */
import { DOCK_DEFAULT_WIDTH, clampDockWidth } from './resize.ts'

/** Namespaced localStorage key for the persisted overlay width. */
export const OVERLAY_WIDTH_STORAGE_KEY = 'dsh-deepseek-companion:overlay-width'

/** Minimal storage face so parse/read/write stay DOM-free and unit-testable. */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/**
 * Parse and validate a stored width, then re-clamp it against the *current*
 * viewport. Missing, empty, non-finite, or non-positive values fall back to the
 * default; any legal positive number is clamped (a width saved on a wide window
 * re-clamps down when the current window is narrower).
 */
export function parseStoredOverlayWidth(raw: string | null, viewportWidth: number): number {
  if (raw === null || raw === '') return DOCK_DEFAULT_WIDTH
  const value = Number(raw)
  if (!Number.isFinite(value)) return DOCK_DEFAULT_WIDTH
  if (value <= 0) return DOCK_DEFAULT_WIDTH
  return clampDockWidth(value, viewportWidth)
}

/**
 * Read the persisted overlay width, degrading to the default on any storage
 * failure (unavailable, privacy-blocked, malformed, …).
 */
export function readOverlayWidth(storage: StorageLike | null | undefined, viewportWidth: number): number {
  if (!storage) return DOCK_DEFAULT_WIDTH
  try {
    return parseStoredOverlayWidth(storage.getItem(OVERLAY_WIDTH_STORAGE_KEY), viewportWidth)
  } catch {
    return DOCK_DEFAULT_WIDTH
  }
}

/**
 * Persist the overlay width. Failures are swallowed (with a one-line warning)
 * so resize still works for the current page even when persistence is blocked.
 */
export function writeOverlayWidth(storage: StorageLike | null | undefined, width: number): void {
  if (!storage) return
  try {
    storage.setItem(OVERLAY_WIDTH_STORAGE_KEY, String(width))
  } catch {
    console.warn('[dsh-deepseek-companion] failed to persist overlay width')
  }
}

/**
 * The browser's localStorage, or null when unavailable (privacy mode, sandboxed
 * iframe, …). Accessing `window.localStorage` itself can throw, hence the guard.
 */
export function overlayStorage(): StorageLike | null {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage
  } catch {
    return null
  }
}
