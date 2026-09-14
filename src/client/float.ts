/**
 * Pure in-page float-window geometry (Phase 06D).
 *
 * These helpers stay DOM-free and persistence-free so they can be unit-tested
 * with `node:test`. The float window's position/size are in-memory UI state;
 * they are never written to localStorage in this phase.
 */

export const FLOAT_DEFAULT_WIDTH = 420
export const FLOAT_DEFAULT_HEIGHT = 560
export const FLOAT_MIN_WIDTH = 320
export const FLOAT_MIN_HEIGHT = 360

/** Minimum gap kept between the float and the viewport edges. */
export const FLOAT_EDGE_MARGIN = 16

export interface FloatSize {
  width: number
  height: number
}

export interface FloatPosition {
  x: number
  y: number
}

/**
 * Clamp a requested size into the legal range for the current viewport. The
 * maximum keeps the float fully on-screen (minus the edge margin), and never
 * falls below the minimum so the window stays usable on a tiny viewport.
 */
export function clampFloatSize(width: number, height: number, viewportWidth: number, viewportHeight: number): FloatSize {
  const maxWidth = Math.max(FLOAT_MIN_WIDTH, viewportWidth - FLOAT_EDGE_MARGIN * 2)
  const maxHeight = Math.max(FLOAT_MIN_HEIGHT, viewportHeight - FLOAT_EDGE_MARGIN * 2)
  return {
    width: Math.round(Math.min(Math.max(width, FLOAT_MIN_WIDTH), maxWidth)),
    height: Math.round(Math.min(Math.max(height, FLOAT_MIN_HEIGHT), maxHeight)),
  }
}

/**
 * Clamp a requested top-left position so the whole float stays within the
 * viewport (no margin is added here — position may touch the edges, but never
 * lets the window escape).
 */
export function clampFloatPosition(
  x: number,
  y: number,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
): FloatPosition {
  const maxX = Math.max(0, viewportWidth - width)
  const maxY = Math.max(0, viewportHeight - height)
  return {
    x: Math.round(Math.min(Math.max(x, 0), maxX)),
    y: Math.round(Math.min(Math.max(y, 0), maxY)),
  }
}

/** Initial position: top-right of the viewport, offset by the edge margin. */
export function initialFloatPosition(
  viewportWidth: number,
  viewportHeight: number,
  width: number,
  height: number,
): FloatPosition {
  return clampFloatPosition(
    viewportWidth - width - FLOAT_EDGE_MARGIN,
    FLOAT_EDGE_MARGIN,
    width,
    height,
    viewportWidth,
    viewportHeight,
  )
}

/** Eight resize directions: four edges plus four corners. */
export type ResizeDirection =
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'

/** A float window's full geometry (top-left position plus size). */
export interface FloatRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Resize a float window from one of its eight edges/corners, given the pointer
 * delta since the drag started. The drag is anchored at its start rect, so
 * repeated pointermove events never accumulate drift.
 *
 * Resizing the left/top edges moves the top-left position too; the opposite
 * (fixed) edge is recomputed from the clamped size afterwards, so a size clamp
 * keeps that fixed edge pinned — no size jump, no position drift.
 */
export function resizeFloat(
  rect: FloatRect,
  direction: ResizeDirection,
  dx: number,
  dy: number,
  viewportWidth: number,
  viewportHeight: number,
): FloatRect {
  // The right and bottom edges are the fixed anchors for left/top resizing.
  const right = rect.x + rect.width
  const bottom = rect.y + rect.height

  let width = rect.width
  let height = rect.height
  if (direction.includes('right')) width = rect.width + dx
  if (direction.includes('left')) width = rect.width - dx
  if (direction.includes('bottom')) height = rect.height + dy
  if (direction.includes('top')) height = rect.height - dy

  const clamped = clampFloatSize(width, height, viewportWidth, viewportHeight)
  width = clamped.width
  height = clamped.height

  let x = rect.x
  let y = rect.y
  if (direction.includes('left')) x = right - width
  if (direction.includes('top')) y = bottom - height

  const pos = clampFloatPosition(x, y, width, height, viewportWidth, viewportHeight)
  return { x: pos.x, y: pos.y, width, height }
}
