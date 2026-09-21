import assert from 'node:assert/strict'
import test from 'node:test'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/** Render Markdown exactly like ChatView does (react-markdown + remark-gfm). */
const render = (markdown: string): string =>
  renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkGfm] }, markdown))

test('G: 基础结构渲染 — heading / list / bold / italic / inline code / code block / blockquote / table / link', () => {
  const markdown = [
    '# 一级标题',
    '',
    '## 二级标题',
    '',
    '- 无序 A',
    '- 无序 B',
    '',
    '1. 有序一',
    '2. 有序二',
    '',
    '**粗体** 与 *斜体* 与 `inline`',
    '',
    '```go',
    'func main() {',
    '    fmt.Println("hi")',
    '}',
    '```',
    '',
    '> 引用内容',
    '',
    '| 特性 | 说明 |',
    '| --- | --- |',
    '| 并发 | goroutine |',
    '',
    '[Go 官网](https://go.dev)',
  ].join('\n')

  const html = render(markdown)

  assert.match(html, /<h1>一级标题<\/h1>/)
  assert.match(html, /<h2>二级标题<\/h2>/)
  assert.match(html, /<ul>/)
  assert.match(html, /<ol>/)
  assert.match(html, /<li>无序 A<\/li>/)
  assert.match(html, /<strong>粗体<\/strong>/)
  assert.match(html, /<em>斜体<\/em>/)
  assert.match(html, /<code>inline<\/code>/)
  assert.match(html, /<pre><code class="language-go">/)
  assert.match(html, /<blockquote>/)
  assert.match(html, /<table>/)
  assert.match(html, /<th>特性<\/th>/)
  assert.match(html, /<td>并发<\/td>/)
  assert.match(html, /<a href="https:\/\/go\.dev">Go 官网<\/a>/)

  // Markdown syntax itself must never leak through as visible text.
  assert.doesNotMatch(html, /# 一级标题/)
  assert.doesNotMatch(html, /\*\*粗体\*\*/)
  assert.doesNotMatch(html, /```go/)
})

test('GFM：strikethrough / task list / autolink 都能渲染', () => {
  const html = render('~~删除线~~\n\n- [x] 已完成\n- [ ] 未完成\n\nhttps://go.dev\n')

  assert.match(html, /<del>删除线<\/del>/)
  assert.match(html, /type="checkbox"/)
  assert.match(html, /<a href="https:\/\/go\.dev">/)
})

test('链接安全：javascript: 与 data: 协议被过滤，不会成为可点击危险链接', () => {
  const html = render('[x](javascript:alert(1))\n\n[y](data:text/html,<b>x</b>)\n')

  assert.doesNotMatch(html, /javascript:/i)
  assert.doesNotMatch(html, /href="data:/i)
})

test('不允许 raw HTML：script / img 不会被渲染成标签', () => {
  const html = render('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n')

  assert.doesNotMatch(html, /<script/i)
  assert.doesNotMatch(html, /<img/i)
})

test('流式未闭合代码围栏：不报错，渲染为 code block', () => {
  // A mid-stream snapshot: the fence has opened but its closing ``` has not
  // arrived yet.
  const html = render('# 标题\n\n正文\n\n```go\nfunc main() {\n')

  assert.match(html, /<h1>标题<\/h1>/)
  assert.match(html, /<pre><code class="language-go">/)
})

test('流式未闭合行内标记：不报错', () => {
  const html = render('这是 **未闭合粗体')

  assert.match(html, /这是/)
})
