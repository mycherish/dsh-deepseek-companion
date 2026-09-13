import assert from 'node:assert/strict'
import test from 'node:test'

import {
  OVERLAY_WIDTH_STORAGE_KEY,
  parseStoredOverlayWidth,
  readOverlayWidth,
  writeOverlayWidth,
  type StorageLike,
} from '../src/client/storage.ts'

const WIDE = 2000 // max = 720, min = 320

test('exposes a namespaced storage key', () => {
  assert.equal(OVERLAY_WIDTH_STORAGE_KEY, 'dsh-deepseek-companion:overlay-width')
})

test('parseStoredOverlayWidth falls back to default for missing/invalid values', () => {
  for (const raw of [null, '', 'abc', 'NaN', 'Infinity', '-Infinity', '-1', '0']) {
    assert.equal(parseStoredOverlayWidth(raw, WIDE), 420, `raw=${JSON.stringify(raw)}`)
  }
})

test('parseStoredOverlayWidth accepts legal positive values', () => {
  assert.equal(parseStoredOverlayWidth('420', WIDE), 420)
  assert.equal(parseStoredOverlayWidth('560', WIDE), 560)
})

test('parseStoredOverlayWidth clamps oversized values to the viewport max', () => {
  assert.equal(parseStoredOverlayWidth('99999', WIDE), 720)
})

test('parseStoredOverlayWidth re-clamps against the current viewport', () => {
  // Saved 650 on a wide window; current window max is 600 (1000 * 0.6).
  assert.equal(parseStoredOverlayWidth('650', 1000), 600)
})

function fakeStorage(overrides: Partial<StorageLike> = {}): StorageLike {
  let value: string | null = null
  return {
    getItem: () => value,
    setItem: (_key, v) => {
      value = v
    },
    ...overrides,
  }
}

test('readOverlayWidth degrades to default when storage is unavailable', () => {
  assert.equal(readOverlayWidth(null, WIDE), 420)
  assert.equal(readOverlayWidth(undefined, WIDE), 420)
})

test('readOverlayWidth degrades to default when storage throws', () => {
  const storage = fakeStorage({
    getItem: () => {
      throw new Error('SecurityError')
    },
  })
  assert.equal(readOverlayWidth(storage, WIDE), 420)
})

test('readOverlayWidth reads and clamps a stored value', () => {
  const storage = fakeStorage()
  storage.setItem(OVERLAY_WIDTH_STORAGE_KEY, '560')
  assert.equal(readOverlayWidth(storage, WIDE), 560)
})

test('writeOverlayWidth writes the width under the namespaced key', () => {
  const storage = fakeStorage()
  writeOverlayWidth(storage, 560)
  assert.equal(storage.getItem(OVERLAY_WIDTH_STORAGE_KEY), '560')
})

test('writeOverlayWidth does not throw when storage is unavailable or throws', () => {
  assert.doesNotThrow(() => writeOverlayWidth(null, 560))
  assert.doesNotThrow(() =>
    writeOverlayWidth(
      fakeStorage({
        setItem: () => {
          throw new Error('QuotaExceededError')
        },
      }),
      560,
    ),
  )
})
