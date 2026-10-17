import assert from 'node:assert/strict'
import test from 'node:test'

import { remarkCitations } from '../src/client/remark-citations.ts'

interface AstNode {
  type?: string
  value?: unknown
  url?: unknown
  lang?: unknown
  data?: unknown
  children?: AstNode[]
}

/** Build a `root > paragraph > text` tree around one text value. */
function paragraph(text: string): AstNode {
  return { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', value: text }] }] }
}

function run(tree: AstNode, urls: Map<number, string>): AstNode[] {
  remarkCitations({ urls })(tree)
  return tree.children![0]!.children!
}

// --- J. rendering -----------------------------------------------------------

test('J: 未水合的 marker → 友好的 [N] 文本（不暴露内部语法）', () => {
  const children = run(paragraph('重要更新[reference:3]。'), new Map())
  assert.deepEqual(children, [
    { type: 'text', value: '重要更新' },
    { type: 'text', value: '[3]' },
    { type: 'text', value: '。' },
  ])
})

test('J: 已水合的 marker → link 节点（带 citation class）', () => {
  const children = run(paragraph('重要更新[reference:3]'), new Map([[3, 'https://a.com/x']]))

  assert.equal(children.length, 2)
  assert.deepEqual(children[0], { type: 'text', value: '重要更新' })
  assert.equal(children[1]!.type, 'link')
  assert.equal(children[1]!.url, 'https://a.com/x')
  assert.deepEqual(children[1]!.children, [{ type: 'text', value: '[3]' }])
  assert.deepEqual(children[1]!.data, { hProperties: { className: 'dsc-citation' } })
})

test('J: [citation:N] 方言同样处理', () => {
  assert.deepEqual(run(paragraph('[citation:8]'), new Map()), [{ type: 'text', value: '[8]' }])
  assert.equal(run(paragraph('[citation:8]'), new Map([[8, 'https://b.com']]))[0]!.type, 'link')
})

test('J: 同一段里多个 marker 逐个处理', () => {
  const children = run(paragraph('[reference:1][reference:2] 后文[citation:5]'), new Map([[1, 'https://a.com']]))
  assert.deepEqual(
    children.map((node) => (node.type === 'link' ? `link:${node.url}` : `text:${String(node.value)}`)),
    ['link:https://a.com', 'text:[2]', 'text: 后文', 'text:[5]'],
  )
})

test('J: 没有 marker 的文本原样保留', () => {
  assert.deepEqual(run(paragraph('普通文本'), new Map()), [{ type: 'text', value: '普通文本' }])
})

test('J: 空的 urls map 也不会抛错', () => {
  const tree = paragraph('x[reference:1]')
  remarkCitations({ urls: undefined as unknown as Map<number, string> })(tree)
  assert.equal(tree.children![0]!.children!.length, 2)
})

// --- K. code safety ---------------------------------------------------------

test('K: inlineCode 内的 marker 不被改写', () => {
  const tree: AstNode = {
    type: 'root',
    children: [{ type: 'paragraph', children: [{ type: 'inlineCode', value: '[reference:1]' }] }],
  }
  remarkCitations({ urls: new Map([[1, 'https://a.com']]) })(tree)
  assert.deepEqual(tree.children![0]!.children, [{ type: 'inlineCode', value: '[reference:1]' }])
})

test('K: code block 内的 marker 不被改写', () => {
  const tree: AstNode = {
    type: 'root',
    children: [{ type: 'code', lang: 'go', value: 'x := "[reference:1]"' }],
  }
  remarkCitations({ urls: new Map([[1, 'https://a.com']]) })(tree)
  assert.deepEqual(tree.children![0], { type: 'code', lang: 'go', value: 'x := "[reference:1]"' })
})

test('K: 正文改写，但同一棵树里的 code 保持原样', () => {
  const tree: AstNode = {
    type: 'root',
    children: [
      { type: 'paragraph', children: [{ type: 'text', value: '见 [reference:2]' }] },
      { type: 'code', lang: null, value: 'const a = "[reference:2]"' },
    ],
  }
  remarkCitations({ urls: new Map([[2, 'https://b.com']]) })(tree)

  assert.equal(tree.children![0]!.children![1]!.type, 'link')
  assert.deepEqual(tree.children![1], { type: 'code', lang: null, value: 'const a = "[reference:2]"' })
})

test('K: 嵌套结构（列表 / 引用 / 表格单元）仍会处理，但不进入 code', () => {
  const tree: AstNode = {
    type: 'root',
    children: [
      {
        type: 'list',
        children: [
          {
            type: 'listItem',
            children: [
              { type: 'paragraph', children: [{ type: 'text', value: '项[reference:2]' }] },
              { type: 'code', value: '[reference:9]' },
            ],
          },
        ],
      },
      {
        type: 'blockquote',
        children: [{ type: 'paragraph', children: [{ type: 'text', value: '引用[citation:7]' }] }],
      },
    ],
  }
  remarkCitations({ urls: new Map([[2, 'https://b.com']]) })(tree)

  const item = tree.children![0]!.children![0]!.children!
  assert.equal(item[0]!.children![1]!.type, 'link')
  assert.deepEqual(item[1], { type: 'code', value: '[reference:9]' })

  const quote = tree.children![1]!.children![0]!.children!
  assert.deepEqual(quote, [
    { type: 'text', value: '引用' },
    { type: 'text', value: '[7]' },
  ])
})
