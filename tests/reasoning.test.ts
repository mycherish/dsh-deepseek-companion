import assert from 'node:assert/strict'
import test from 'node:test'

import {
  cleanupReasoningReader,
  installReasoningReader,
  readAndCleanupReasoning,
  type ReasoningReadOptions,
} from '../src/host/reasoning.ts'
import type { ReplyDom, ReplyEnv, ReplyObserver, ReplyReadResult } from '../src/host/reply.ts'

interface FakeNode {
  textContent: string
  [key: string]: unknown
}

interface Harness {
  env: ReplyEnv
  nodes: FakeNode[]
  deltas: ReplyReadResult[]
  emit: () => void
  isDisconnected: () => boolean
}

/** Fake browser surface: `.think` is the only selector the reader asks for. */
function makeHarness(nodes: FakeNode[] = []): Harness {
  let callback: (() => void) | null = null
  let disconnected = false

  const document: ReplyDom = {
    body: {},
    querySelectorAll: (selector: string) => (selector === '.think' ? nodes : []),
  }

  class FakeObserver implements ReplyObserver {
    constructor(cb: () => void) {
      callback = cb
    }
    observe(): void {}
    disconnect(): void {
      disconnected = true
    }
  }

  const deltas: ReplyReadResult[] = []
  const env: ReplyEnv = {
    document,
    window: { __onReasoningDelta: (reply: ReplyReadResult) => deltas.push(reply) },
    MutationObserver: FakeObserver,
  }

  return { env, nodes, deltas, emit: () => callback?.(), isDisconnected: () => disconnected }
}

const readOptions = (startCount = 0, maxScan = 10): ReasoningReadOptions => ({
  selector: '.think',
  startCount,
  maxScan,
})

/** A fiber chain whose deepest node carries `props` (level = hops from the node). */
function fiberChain(level: number, props: Record<string, unknown>): Record<string, unknown> {
  let fiber: Record<string, unknown> = { memoizedProps: props }
  for (let i = 0; i < level; i += 1) {
    fiber = { memoizedProps: { className: 'wrapper' }, return: fiber }
  }
  return fiber
}

test('C: 从 fiber.return 链找到 reasoning prop（纯文本 → format text）', () => {
  const h = makeHarness()
  installReasoningReader({ options: readOptions(), env: h.env })

  h.nodes.push({ textContent: '思考中', __reactFiber$abc: fiberChain(2, { reasoning: '先算净速率' }) })
  h.emit()

  assert.deepEqual(h.deltas[0], { content: '先算净速率', format: 'text' })
})

test('C: reasoning prop 自身含 Markdown 语法时 format=markdown', () => {
  const h = makeHarness()
  installReasoningReader({ options: readOptions(), env: h.env })

  const markdown = '- 甲 1/6\n- 乙 1/4'
  h.nodes.push({ textContent: '甲 乙', __reactFiber$abc: fiberChain(0, { reasoning: markdown }) })
  h.emit()

  assert.deepEqual(h.deltas[0], { content: markdown, format: 'markdown' })
})

test('C: 不依赖固定 fiber 层数（level 0/1/3/7/9 都能找到）', () => {
  for (const level of [0, 1, 3, 7, 9]) {
    const h = makeHarness()
    installReasoningReader({ options: readOptions(0, 10), env: h.env })

    h.nodes.push({ textContent: 't', __reactFiber$abc: fiberChain(level, { thinking: `思考${level}` }) })
    h.emit()

    assert.deepEqual(h.deltas[0], { content: `思考${level}`, format: 'text' }, `level=${level}`)
  }
})

test('C: 找不到 reasoning prop 时 fallback textContent + text', () => {
  const h = makeHarness()
  installReasoningReader({ options: readOptions(), env: h.env })

  h.nodes.push({ textContent: '  纯文本思考  ', __reactFiber$abc: fiberChain(2, { className: 'x' }) })
  h.emit()

  assert.deepEqual(h.deltas[0], { content: '纯文本思考', format: 'text' })
})

test('C: 没有 reasoning DOM（Deep Think 未开启）时返回空结果，不报错', () => {
  const h = makeHarness()
  installReasoningReader({ options: readOptions(), env: h.env })

  h.emit()

  assert.deepEqual(h.deltas[0], { content: '', format: 'text' })
})

test('C: startCount 只读取本次发送新增的 reasoning', () => {
  const h = makeHarness()
  h.nodes.push({ textContent: '历史思考' })
  installReasoningReader({ options: readOptions(1, 10), env: h.env })

  h.emit()
  assert.deepEqual(h.deltas[0], { content: '', format: 'text' })

  h.nodes.push({ textContent: '新思考' })
  h.emit()
  assert.deepEqual(h.deltas[1], { content: '新思考', format: 'text' })
})

test('缺少浏览器环境时安全 no-op（不抛错）', () => {
  const empty = {} as ReplyEnv
  installReasoningReader({ options: readOptions(), env: empty })
  assert.equal(readAndCleanupReasoning({ env: empty }), null)
  cleanupReasoningReader({ env: empty })
})

test('readAndCleanupReasoning：读取最终值并断开 observer + 清理页面全局', () => {
  const h = makeHarness()
  installReasoningReader({ options: readOptions(), env: h.env })
  h.nodes.push({ textContent: '最终思考' })

  const final = readAndCleanupReasoning({ env: h.env })

  assert.deepEqual(final, { content: '最终思考', format: 'text' })
  assert.equal(h.isDisconnected(), true)
  assert.equal('__reasoningObserver' in h.env.window, false)
  assert.equal('__readReasoning' in h.env.window, false)
})

test('cleanupReasoningReader：不读取也要断开 observer 并清理页面全局', () => {
  const h = makeHarness()
  installReasoningReader({ options: readOptions(), env: h.env })

  cleanupReasoningReader({ env: h.env })

  assert.equal(h.isDisconnected(), true)
  assert.equal('__reasoningObserver' in h.env.window, false)
  assert.equal('__readReasoning' in h.env.window, false)
})

test('reasoning 与正文的页面全局互不干扰（可同时安装两套 reader）', () => {
  const h = makeHarness()
  installReasoningReader({ options: readOptions(), env: h.env })

  // Reasoning reader owns its own keys only.
  assert.equal('__reasoningObserver' in h.env.window, true)
  assert.equal('__replyObserver' in h.env.window, false)
  assert.equal('__readReply' in h.env.window, false)
})

test('__hasNewReasoning：节点出现即可判定，不依赖文本非空', () => {
  const h = makeHarness()
  h.nodes.push({ textContent: '历史思考' })
  installReasoningReader({ options: readOptions(1, 10), env: h.env })

  const probe = h.env.window['__hasNewReasoning'] as () => boolean
  assert.equal(probe(), false)

  h.nodes.push({ textContent: '' })
  assert.equal(probe(), true)
})

test('__hasNewReasoning：Deep Think 未开启（始终没有节点）时保持 false', () => {
  const h = makeHarness()
  installReasoningReader({ options: readOptions(0, 10), env: h.env })

  const probe = h.env.window['__hasNewReasoning'] as () => boolean
  assert.equal(probe(), false)
  h.emit()
  assert.equal(probe(), false)
})

test('__hasNewReasoning：cleanup 后移除探针', () => {
  const h = makeHarness()
  installReasoningReader({ options: readOptions(), env: h.env })
  assert.equal(typeof h.env.window['__hasNewReasoning'], 'function')

  cleanupReasoningReader({ env: h.env })

  assert.equal('__hasNewReasoning' in h.env.window, false)
})
