import assert from 'node:assert/strict'
import test from 'node:test'

import {
  clampFloatPosition,
  clampFloatSize,
  FLOAT_DEFAULT_HEIGHT,
  FLOAT_DEFAULT_WIDTH,
  FLOAT_MIN_HEIGHT,
  FLOAT_MIN_WIDTH,
  initialFloatPosition,
  resizeFloat,
} from '../src/client/float.ts'

test('默认尺寸是 420 x 560', () => {
  assert.equal(FLOAT_DEFAULT_WIDTH, 420)
  assert.equal(FLOAT_DEFAULT_HEIGHT, 560)
})

test('clampFloatSize 限制最小宽高', () => {
  const result = clampFloatSize(100, 100, 1200, 900)
  assert.equal(result.width, FLOAT_MIN_WIDTH)
  assert.equal(result.height, FLOAT_MIN_HEIGHT)
})

test('clampFloatSize 限制最大不超过可视区域（留边距）', () => {
  const result = clampFloatSize(10000, 10000, 1200, 900)
  assert.ok(result.width <= 1200)
  assert.ok(result.height <= 900)
})

test('clampFloatPosition 不允许窗口被拖出可视区域', () => {
  const result = clampFloatPosition(-1000, -1000, 420, 560, 1200, 900)
  assert.equal(result.x, 0)
  assert.equal(result.y, 0)

  const bottomRight = clampFloatPosition(10000, 10000, 420, 560, 1200, 900)
  assert.equal(bottomRight.x, 1200 - 420)
  assert.equal(bottomRight.y, 900 - 560)
})

test('initialFloatPosition 落在可视区域内（右上角）', () => {
  const result = initialFloatPosition(1200, 900, 420, 560)
  assert.ok(result.x >= 0 && result.x + 420 <= 1200)
  assert.ok(result.y >= 0 && result.y + 560 <= 900)
})

// 初始矩形：viewport 1200x900，窗口 420x560 @ (100,100)。右边缘 520，下边缘 660。
const RECT = { x: 100, y: 100, width: 420, height: 560 }

test('右边缩放：宽度增加，位置不变', () => {
  const result = resizeFloat(RECT, 'right', 50, 0, 1200, 900)
  assert.deepEqual(result, { x: 100, y: 100, width: 470, height: 560 })
})

test('左边缩放：向右拖缩小，x 与 width 同时变化（右边缘固定）', () => {
  const result = resizeFloat(RECT, 'left', 50, 0, 1200, 900)
  assert.deepEqual(result, { x: 150, y: 100, width: 370, height: 560 })
  assert.equal(result.x + result.width, 520, '右边缘应保持 520')
})

test('上边缩放：向下拖缩小，y 与 height 同时变化（下边缘固定）', () => {
  const result = resizeFloat(RECT, 'top', 0, 50, 1200, 900)
  assert.deepEqual(result, { x: 100, y: 150, width: 420, height: 510 })
  assert.equal(result.y + result.height, 660, '下边缘应保持 660')
})

test('下边缩放：高度增加，位置不变', () => {
  const result = resizeFloat(RECT, 'bottom', 0, 50, 1200, 900)
  assert.deepEqual(result, { x: 100, y: 100, width: 420, height: 610 })
})

test('左上角缩放：x/y 与 width/height 同时变化', () => {
  const result = resizeFloat(RECT, 'top-left', 50, 50, 1200, 900)
  assert.deepEqual(result, { x: 150, y: 150, width: 370, height: 510 })
})

test('右上角缩放：宽度增加、高度减小，y 变化', () => {
  const result = resizeFloat(RECT, 'top-right', 50, 50, 1200, 900)
  assert.deepEqual(result, { x: 100, y: 150, width: 470, height: 510 })
})

test('左下角缩放：宽度减小、高度增加，x 变化', () => {
  const result = resizeFloat(RECT, 'bottom-left', 50, 50, 1200, 900)
  assert.deepEqual(result, { x: 150, y: 100, width: 370, height: 610 })
})

test('右下角缩放：宽高都增加，位置不变', () => {
  const result = resizeFloat(RECT, 'bottom-right', 50, 50, 1200, 900)
  assert.deepEqual(result, { x: 100, y: 100, width: 470, height: 610 })
})

test('缩到最小宽高后不再继续缩', () => {
  const fromLeft = resizeFloat(RECT, 'left', 1000, 0, 1200, 900)
  assert.equal(fromLeft.width, FLOAT_MIN_WIDTH)
  assert.equal(fromLeft.x, 520 - FLOAT_MIN_WIDTH)

  const fromTop = resizeFloat(RECT, 'top', 0, 1000, 1200, 900)
  assert.equal(fromTop.height, FLOAT_MIN_HEIGHT)
  assert.equal(fromTop.y, 660 - FLOAT_MIN_HEIGHT)
})

test('viewport 边界：向左放大不超过可视区域，位置被 clamp 到 0', () => {
  const result = resizeFloat(RECT, 'left', -1000, 0, 1200, 900)
  assert.ok(result.width <= 1200)
  assert.equal(result.x, 0)
  assert.equal(result.height, 560)
})
