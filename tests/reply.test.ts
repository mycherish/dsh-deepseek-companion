import assert from 'node:assert/strict'
import test from 'node:test'

import {
  cleanupReplyReader,
  installReplyReader,
  readAndCleanupReply,
  type ReplyDom,
  type ReplyEnv,
  type ReplyObserver,
  type ReplyReadResult,
} from '../src/host/reply.ts'

interface FakeNode {
  textContent: string
  [key: string]: unknown
}

interface Harness {
  env: ReplyEnv
  replies: FakeNode[]
  deltas: ReplyReadResult[]
  emit: () => void
  isDisconnected: () => boolean
}

/** Fake browser surface: `document` over two selector buckets, a manual observer. */
function makeHarness(primary: FakeNode[] = [], fallback: FakeNode[] = []): Harness {
  let callback: (() => void) | null = null
  let disconnected = false

  const document: ReplyDom = {
    body: {},
    querySelectorAll: (selector: string) => {
      if (selector === '.reply') return primary
      if (selector === '.md') return fallback
      return []
    },
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
    window: { __onReplyDelta: (reply: ReplyReadResult) => deltas.push(reply) },
    MutationObserver: FakeObserver,
  }

  return {
    env,
    replies: primary,
    deltas,
    emit: () => callback?.(),
    isDisconnected: () => disconnected,
  }
}

const readOptions = (startCount = 0, maxScan = 10): Parameters<typeof installReplyReader>[0]['options'] => ({
  selector: '.reply',
  fallback: '.md',
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

test('B: 从 fiber.return 链找到 props.markdown', () => {
  const h = makeHarness()
  installReplyReader({ options: readOptions(), env: h.env })

  const markdown = '# Go 语言\n\n正文'
  h.replies.push({ textContent: 'Go 语言正文', __reactFiber$abc: fiberChain(2, { markdown }) })
  h.emit()

  assert.equal(h.deltas.length, 1)
  assert.deepEqual(h.deltas[0], { content: markdown, format: 'markdown' })
})

test('C: 不依赖固定 fiber 层数（level 0/1/3/7/9 都能找到）', () => {
  for (const level of [0, 1, 3, 7, 9]) {
    const h = makeHarness()
    installReplyReader({ options: readOptions(0, 10), env: h.env })

    const markdown = `# 层级 ${level}`
    h.replies.push({ textContent: '标题', __reactFiber$abc: fiberChain(level, { markdown }) })
    h.emit()

    assert.deepEqual(h.deltas[0], { content: markdown, format: 'markdown' }, `level=${level}`)
  }
})

test('C: 超过 maxScan 层则不再查找，回落 textContent', () => {
  const h = makeHarness()
  installReplyReader({ options: readOptions(0, 10), env: h.env })

  // props sit one hop past the scan budget.
  h.replies.push({ textContent: '纯文本', __reactFiber$abc: fiberChain(10, { markdown: '# X' }) })
  h.emit()

  assert.deepEqual(h.deltas[0], { content: '纯文本', format: 'text' })
})

test('D: 没有 react fiber 时 fallback 到 textContent + text', () => {
  const h = makeHarness()
  installReplyReader({ options: readOptions(), env: h.env })

  h.replies.push({ textContent: '  纯文本回复  ' })
  h.emit()

  assert.deepEqual(h.deltas[0], { content: '纯文本回复', format: 'text' })
})

test('D: 有 fiber 但没有 markdown/content 时 fallback 到 textContent + text', () => {
  const h = makeHarness()
  installReplyReader({ options: readOptions(), env: h.env })

  h.replies.push({ textContent: '只有文本', __reactFiber$k: fiberChain(2, { className: 'x' }) })
  h.emit()

  assert.deepEqual(h.deltas[0], { content: '只有文本', format: 'text' })
})

test('D: content prop 只有与渲染文本匹配时才算 markdown', () => {
  const matched = makeHarness()
  installReplyReader({ options: readOptions(), env: matched.env })
  matched.replies.push({ textContent: 'Go 语言', __reactFiber$k: fiberChain(0, { content: '# Go 语言' }) })
  matched.emit()
  assert.deepEqual(matched.deltas[0], { content: '# Go 语言', format: 'markdown' })

  const mismatched = makeHarness()
  installReplyReader({ options: readOptions(), env: mismatched.env })
  mismatched.replies.push({
    textContent: '完全不同的内容',
    __reactFiber$k: fiberChain(0, { content: '# 无关标题' }),
  })
  mismatched.emit()
  assert.deepEqual(mismatched.deltas[0], { content: '完全不同的内容', format: 'text' })
})

test('startCount：只读取发送后新增的回复，历史回复不参与', () => {
  const h = makeHarness()
  h.replies.push({ textContent: '历史回复' })
  installReplyReader({ options: readOptions(1, 10), env: h.env })

  h.emit()
  assert.deepEqual(h.deltas[0], { content: '', format: 'text' })

  h.replies.push({ textContent: '新回复', __reactFiber$k: fiberChain(0, { markdown: '**新回复**' }) })
  h.emit()
  assert.deepEqual(h.deltas[1], { content: '**新回复**', format: 'markdown' })
})

test('fallback 不会读到 reasoning 容器内的节点（excludeWithin）', () => {
  const fallback: FakeNode[] = [
    // A `.ds-markdown` that lives INSIDE the reasoning container.
    { textContent: '思考内容', closest: (selector: string) => (selector === '.think' ? {} : null) },
  ]
  const h = makeHarness([], fallback)
  installReplyReader({ options: { ...readOptions(), excludeWithin: '.think' }, env: h.env })

  // The real reply node appears (outside any reasoning container) afterwards.
  fallback.push({ textContent: '正文', closest: () => null, __reactFiber$k: fiberChain(0, { markdown: '# 正文' }) })
  h.emit()

  assert.deepEqual(h.deltas[0], { content: '# 正文', format: 'markdown' })
})

test('excludeWithin 过滤掉全部候选时安全返回空', () => {
  const fallback: FakeNode[] = [{ textContent: '思考内容', closest: (selector: string) => (selector === '.think' ? {} : null) }]
  const h = makeHarness([], fallback)
  installReplyReader({ options: { ...readOptions(), excludeWithin: '.think' }, env: h.env })

  h.emit()

  assert.deepEqual(h.deltas[0], { content: '', format: 'text' })
})

test('主选择器无匹配时使用 fallback 选择器', () => {
  const fallback: FakeNode[] = []
  const h = makeHarness([], fallback)
  installReplyReader({ options: readOptions(), env: h.env })

  fallback.push({ textContent: 'MD 正文', __reactFiber$k: fiberChain(0, { markdown: '# MD' }) })
  h.emit()

  assert.deepEqual(h.deltas[0], { content: '# MD', format: 'markdown' })
})

test('readAndCleanupReply：读取最终值并断开 observer + 清理页面全局', () => {
  const h = makeHarness()
  installReplyReader({ options: readOptions(), env: h.env })
  h.replies.push({ textContent: '正文', __reactFiber$k: fiberChain(0, { markdown: '# 正文' }) })

  const final = readAndCleanupReply({ env: h.env })

  assert.deepEqual(final, { content: '# 正文', format: 'markdown' })
  assert.equal(h.isDisconnected(), true)
  assert.equal('__replyObserver' in h.env.window, false)
  assert.equal('__readReply' in h.env.window, false)
})

test('cleanupReplyReader：不读取也要断开 observer 并清理页面全局', () => {
  const h = makeHarness()
  installReplyReader({ options: readOptions(), env: h.env })

  cleanupReplyReader({ env: h.env })

  assert.equal(h.isDisconnected(), true)
  assert.equal('__replyObserver' in h.env.window, false)
  assert.equal('__readReply' in h.env.window, false)
})

test('缺少浏览器环境时安全 no-op（不抛错）', () => {
  const empty = {} as ReplyEnv
  installReplyReader({ options: readOptions(), env: empty })
  assert.equal(readAndCleanupReply({ env: empty }), null)
  cleanupReplyReader({ env: empty })
})

test('__hasNewReply：正文还没写进来也算“新节点已出现”（供 Host 条件等待）', () => {
  const h = makeHarness()
  h.replies.push({ textContent: '历史回复' })
  installReplyReader({ options: readOptions(1, 10), env: h.env })

  const probe = h.env.window['__hasNewReply'] as () => boolean
  assert.equal(probe(), false) // 仍是发送前的那条

  h.replies.push({ textContent: '' }) // 新节点出现，但内容为空
  assert.equal(probe(), true)

  h.replies[h.replies.length - 1]!.textContent = '新回复'
  assert.equal(probe(), true)
})

test('__hasNewReply：首次对话（发送前无回复）新节点出现即为 true', () => {
  const h = makeHarness()
  installReplyReader({ options: readOptions(0, 10), env: h.env })

  const probe = h.env.window['__hasNewReply'] as () => boolean
  assert.equal(probe(), false) // 还没有任何节点
  h.replies.push({ textContent: '' })
  assert.equal(probe(), true)
})

test('__hasNewReply：cleanup / readAndCleanup 都会移除探针', () => {
  const a = makeHarness()
  installReplyReader({ options: readOptions(), env: a.env })
  assert.equal(typeof a.env.window['__hasNewReply'], 'function')
  cleanupReplyReader({ env: a.env })
  assert.equal('__hasNewReply' in a.env.window, false)

  const b = makeHarness()
  installReplyReader({ options: readOptions(), env: b.env })
  readAndCleanupReply({ env: b.env })
  assert.equal('__hasNewReply' in b.env.window, false)
})
