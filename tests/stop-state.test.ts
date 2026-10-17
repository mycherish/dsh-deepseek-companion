import assert from 'node:assert/strict'
import test from 'node:test'

import {
  STOP_PHASE_LABEL,
  initialStopUiState,
  reduceStopUi,
  stopPhase,
  type StopEvent,
  type StopUiState,
} from '../src/client/stop-state.ts'

/** Replays an event sequence from the initial state. */
function replay(events: StopEvent[]): StopUiState {
  return events.reduce(reduceStopUi, initialStopUiState)
}

/** The label ChatView shows for a state. */
function label(state: StopUiState): string {
  return STOP_PHASE_LABEL[stopPhase({ sending: state.sending, stopping: state.stopping })]
}

/** The events of one ordinary, successful stop of one send. */
const STOP_ONE_SEND: StopEvent[] = [
  { type: 'host-sending', sending: true },
  { type: 'click' },
  { type: 'request-succeeded' },
]

// --- the target state table -------------------------------------------------

test('目标状态表: chat.sending 与 stopping 的组合 → 标签', () => {
  assert.equal(stopPhase({ sending: false, stopping: false }), 'send')
  assert.equal(stopPhase({ sending: false, stopping: true }), 'send') // sending 优先
  assert.equal(stopPhase({ sending: true, stopping: false }), 'stop')
  assert.equal(stopPhase({ sending: true, stopping: true }), 'stopping')

  assert.deepEqual(STOP_PHASE_LABEL, { send: '发送', stop: '停止', stopping: '停止中…' })
})

// --- A / B. the flash-back window -------------------------------------------

test('A: sending=true 点击停止 → 停止中…；API 成功返回后仍保持 停止中…', () => {
  let state = replay([{ type: 'host-sending', sending: true }])
  assert.equal(label(state), '停止')

  state = reduceStopUi(state, { type: 'click' })
  assert.equal(label(state), '停止中…')

  // The Stop API already answered `stopped: true`, but the Host is still
  // finishing the send — the label must NOT fall back to 「停止」 here.
  state = reduceStopUi(state, { type: 'request-succeeded' })
  assert.equal(state.stopping, true)
  assert.equal(label(state), '停止中…')
})

test('B: 随后 Host 推来 sending=false → stopping 自动清除 → 发送', () => {
  const state = replay([...STOP_ONE_SEND, { type: 'host-sending', sending: false }])

  assert.deepEqual(state, { sending: false, stopping: false })
  assert.equal(label(state), '发送')
})

test('B: SSE 在停止期间反复推送 sending=true 也不会清掉 停止中…', () => {
  const state = replay([
    ...STOP_ONE_SEND,
    { type: 'host-sending', sending: true }, // 生成仍在收尾
    { type: 'host-sending', sending: true },
  ])

  assert.equal(label(state), '停止中…')
})

// --- C / D. request did not stop anything -----------------------------------

test('C: Stop API 失败 → stopping 清除 → 恢复 停止，且可以再点一次', () => {
  const state = replay([{ type: 'host-sending', sending: true }, { type: 'click' }, { type: 'request-failed' }])

  assert.equal(state.stopping, false)
  assert.equal(label(state), '停止')

  // The user must be able to retry.
  assert.equal(reduceStopUi(state, { type: 'click' }).stopping, true)
})

test('D: API 返回 stopped:false → stopping 清除（不永久停在 停止中…）', () => {
  const state = replay([{ type: 'host-sending', sending: true }, { type: 'click' }, { type: 'request-refused' }])

  assert.equal(state.stopping, false)
  assert.equal(label(state), '停止')
})

// --- E. the next round never inherits the flag -------------------------------

test('E: 下一轮 sending=true → 显示 停止，不继承上一轮的 停止中…', () => {
  const state = replay([
    ...STOP_ONE_SEND,
    { type: 'host-sending', sending: false }, // 本轮结束
    { type: 'host-sending', sending: true }, // 新一轮开始
  ])

  assert.equal(state.stopping, false)
  assert.equal(label(state), '停止')
})

test('E: 正常结束（未点停止）的下一轮同样干净', () => {
  const state = replay([
    { type: 'host-sending', sending: true },
    { type: 'host-sending', sending: false },
    { type: 'host-sending', sending: true },
  ])

  assert.deepEqual(state, { sending: true, stopping: false })
  assert.equal(label(state), '停止')
})

// --- regression: the label must never flash back -----------------------------

test('回归: 整个停止过程标签序列为 停止 → 停止中… → … → 发送（无闪回）', () => {
  const events: StopEvent[] = [
    { type: 'host-sending', sending: true },
    { type: 'click' },
    { type: 'request-succeeded' }, // ← 旧实现在这里闪回「停止」
    { type: 'host-sending', sending: true }, // SSE 仍报生成中
    { type: 'host-sending', sending: false },
  ]

  const labels: string[] = []
  let state = initialStopUiState
  for (const event of events) {
    state = reduceStopUi(state, event)
    labels.push(label(state))
  }

  assert.deepEqual(labels, ['停止', '停止中…', '停止中…', '停止中…', '发送'])
  // 「停止」只在最开始出现一次，之后再没回来过。
  assert.equal(labels.filter((item) => item === '停止').length, 1)
})

// --- misc -------------------------------------------------------------------

test('stopping=true 时按钮禁用（不允许重复点击）', () => {
  const state = replay([{ type: 'host-sending', sending: true }, { type: 'click' }])

  // ChatView disables the button exactly while the phase is 停止中… .
  assert.equal(stopPhase({ sending: state.sending, stopping: state.stopping }) === 'stopping', true)
})

test('未生成时的 click 不会显示 停止中…（sending 优先）', () => {
  const state = reduceStopUi(initialStopUiState, { type: 'click' })

  assert.equal(label(state), '发送')
})

test('未知事件之外的重复 click 幂等（stopping 保持 true）', () => {
  const state = replay([{ type: 'host-sending', sending: true }, { type: 'click' }, { type: 'click' }])

  assert.deepEqual(state, { sending: true, stopping: true })
})

test('sending 状态为唯一事实来源：停止后不会残留 sending=true', () => {
  const state = replay([
    { type: 'host-sending', sending: true },
    { type: 'click' },
    { type: 'request-refused' },
    { type: 'host-sending', sending: false },
  ])

  assert.deepEqual(state, { sending: false, stopping: false })
  assert.equal(label(state), '发送')
})

// --- Phase 08.2: the Host's stopping flag keeps three surfaces in step --------

test('08.2 三界面一致: 只有 Dock 点了停止，Float / Pop-out 也显示「停止中…」', () => {
  const hostSending: StopEvent = { type: 'host-sending', sending: true }
  const hostStopping: StopEvent = { type: 'host-stopping', stopping: true }

  // Only Dock clicked; every surface folds the SAME Host pushes.
  const dock = replay([hostSending, { type: 'click' }, hostStopping])
  const float = replay([hostSending, hostStopping])
  const popout = replay([hostSending, hostStopping])

  assert.equal(label(dock), '停止中…')
  assert.equal(label(float), '停止中…')
  assert.equal(label(popout), '停止中…')
  assert.deepEqual(dock, float)
  assert.deepEqual(float, popout)
})

test('08.2 host-stopping:false 是 no-op —— 本地的 停止中… 只由 send 结束清除', () => {
  const clicked = replay([{ type: 'host-sending', sending: true }, { type: 'click' }])

  // The push that arrives between the click and the Host recording the stop
  // reports `stopping: false`; it must NOT wipe the local flag (that flash-back
  // is exactly what Phase 07J removed).
  const after = reduceStopUi(clicked, { type: 'host-stopping', stopping: false })

  assert.deepEqual(after, clicked)
  assert.equal(label(after), '停止中…')
})

test('08.2 三界面一致: 同一轮停止在点击方与未点击方收敛到同一状态', () => {
  const events: StopEvent[] = [
    { type: 'host-sending', sending: true },
    { type: 'click' }, // 仅点击方发出的本地事件
    { type: 'host-stopping', stopping: true },
    { type: 'request-succeeded' },
    { type: 'host-sending', sending: false },
  ]

  let dock = initialStopUiState
  for (const event of events) dock = reduceStopUi(dock, event)

  let float = initialStopUiState
  for (const event of events) {
    if (event.type === 'click') continue // 未点击的界面收不到这个事件
    float = reduceStopUi(float, event)
  }

  assert.deepEqual(dock, { sending: false, stopping: false })
  assert.deepEqual(float, { sending: false, stopping: false })
  assert.equal(label(dock), label(float))
  assert.equal(label(dock), '发送')
})
