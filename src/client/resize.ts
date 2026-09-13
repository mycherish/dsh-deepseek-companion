/**
 * Pure dock-width math for Phase 05A.
 *
 * The Companion dock's right edge is pinned to the viewport's right edge, so
 * its width is fully determined by the horizontal position of its left edge.
 * These helpers stay DOM-free and persistence-free so they can be unit-tested
 * with `node:test` and shared by the overlay resize handle.
 */

/** Width before any user drag (matches the overlay's previous fixed 420px). */
export const DOCK_DEFAULT_WIDTH = 420

/** Narrowest width the dock may assume on a normal viewport. */
export const DOCK_MIN_WIDTH = 320

/** Absolute floor: never narrower than this, even on a tiny viewport. */
export const DOCK_ABSOLUTE_MIN_WIDTH = 280

/** Hard ceiling regardless of viewport. */
export const DOCK_MAX_CAP = 720

/** The dock may occupy at most this fraction of the viewport. */
export const DOCK_MAX_RATIO = 0.6

/**
 * Width ceiling for a given viewport: `min(720, viewport * 0.6)`, but never
 * below the absolute floor (so the dock stays usable on a tiny window instead
 * of collapsing toward zero).
 */
export function dockMaxWidth(viewportWidth: number): number {
  return Math.max(DOCK_ABSOLUTE_MIN_WIDTH, Math.min(DOCK_MAX_CAP, viewportWidth * DOCK_MAX_RATIO))
}

/**
 * Clamp a requested width into the dock's legal range for the current viewport.
 * On a normal viewport this resolves to `[320, min(720, viewport * 0.6)]`;
 * below that the absolute floor of 280 wins.
 */
export function clampDockWidth(px: number, viewportWidth: number): number {
  const max = dockMaxWidth(viewportWidth)
  const min = Math.min(DOCK_MIN_WIDTH, max)
  return Math.round(Math.min(Math.max(px, min), max))
}

/**
 * New width from a left-edge drag. The drag is anchored at its start point, so
 * this is equivalent to `viewportRight - pointerX` (the dock's right edge never
 * moves) while never accumulating rounding drift across pointermove events.
 */
export function widthFromPointer(startWidth: number, startPointerX: number, pointerX: number): number {
  return startWidth + (startPointerX - pointerX)
}
