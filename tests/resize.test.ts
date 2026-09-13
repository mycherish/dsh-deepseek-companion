import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DOCK_ABSOLUTE_MIN_WIDTH,
  DOCK_DEFAULT_WIDTH,
  DOCK_MAX_CAP,
  DOCK_MIN_WIDTH,
  clampDockWidth,
  dockMaxWidth,
  widthFromPointer,
} from '../src/client/resize.ts'

test('dock defaults to 420px', () => {
  assert.equal(DOCK_DEFAULT_WIDTH, 420)
})

test('dockMaxWidth caps at 720 and at 60% of the viewport', () => {
  assert.equal(dockMaxWidth(2000), DOCK_MAX_CAP)
  assert.equal(dockMaxWidth(1200), DOCK_MAX_CAP)
  assert.equal(dockMaxWidth(1000), 600)
})

test('dockMaxWidth never drops below the absolute floor', () => {
  assert.equal(dockMaxWidth(400), DOCK_ABSOLUTE_MIN_WIDTH)
})

test('clampDockWidth applies min and max on a normal viewport', () => {
  assert.equal(clampDockWidth(100, 2000), DOCK_MIN_WIDTH)
  assert.equal(clampDockWidth(9999, 2000), DOCK_MAX_CAP)
  assert.equal(clampDockWidth(500, 2000), 500)
})

test('clampDockWidth respects the viewport ratio ceiling', () => {
  assert.equal(clampDockWidth(700, 1000), 600)
})

test('clampDockWidth clamps to the floor on a tiny viewport', () => {
  assert.equal(clampDockWidth(100, 400), DOCK_ABSOLUTE_MIN_WIDTH)
})

test('widthFromPointer grows when dragging left and shrinks when dragging right', () => {
  assert.equal(widthFromPointer(420, 800, 800), 420)
  assert.equal(widthFromPointer(420, 800, 700), 520)
  assert.equal(widthFromPointer(420, 800, 900), 320)
})

test('widthFromPointer stays anchored at the drag start across moves', () => {
  const startWidth = 420
  const startX = 800
  // Every move is computed from the same origin, so there is no drift.
  assert.equal(widthFromPointer(startWidth, startX, 750), 470)
  assert.equal(widthFromPointer(startWidth, startX, 700), 520)
  assert.equal(widthFromPointer(startWidth, startX, 900), 320)
})
