import assert from 'node:assert/strict'
import test from 'node:test'

import { handleChatMessage } from '../src/host/chat.ts'
import {
  normalizeBadges,
  normalizeBlockText,
  parseCitationGroups,
  parseMarkdownBlocks,
  readCitationBadges,
  readDomBlocks,
  resolveCitations,
  resolveCitationsByBlock,
  safeCitationUrl,
} from '../src/host/citations.ts'
import { createCompanionStateStore } from '../src/host/state.ts'
import type { AssistantReply, Citation } from '../src/shared/state.ts'

// --- A. marker parser -------------------------------------------------------

test('A: [reference:N] 与 [citation:N] 都能识别', () => {
  assert.deepEqual(parseCitationGroups('前文[reference:1]中[citation:2]后'), [{ markers: [1] }, { markers: [2] }])
})

test('A: 没有 marker 时返回空数组', () => {
  assert.deepEqual(parseCitationGroups('普通回答，没有任何来源标记。'), [])
  assert.deepEqual(parseCitationGroups(''), [])
})

// --- B / C. grouping --------------------------------------------------------

test('B: 相邻 marker 合成一个 group', () => {
  assert.deepEqual(parseCitationGroups('重要更新[reference:1][reference:2]。'), [{ markers: [1, 2] }])
})

test('B: 相邻允许中间只有空白（含换行）', () => {
  assert.deepEqual(parseCitationGroups('文案[reference:1] [reference:2]'), [{ markers: [1, 2] }])
  assert.deepEqual(parseCitationGroups('文案[reference:1]\n\n[reference:2]'), [{ markers: [1, 2] }])
})

test('B: 三种方言混排在相邻位置也是同一 group', () => {
  assert.deepEqual(parseCitationGroups('[reference:1][citation:2]'), [{ markers: [1, 2] }])
})

test('C: 中间有普通文字则分成两个 group', () => {
  assert.deepEqual(parseCitationGroups('[reference:1] hello [reference:2]'), [{ markers: [1] }, { markers: [2] }])
})

test('C: 中间只有标点也算分开', () => {
  assert.deepEqual(parseCitationGroups('[reference:1]。[reference:2]'), [{ markers: [1] }, { markers: [2] }])
})

// --- D. non-contiguous numbers ---------------------------------------------

test('D: 编号不连续也能正常工作', () => {
  assert.deepEqual(parseCitationGroups('a[reference:3]b[reference:17]c[reference:22]'), [
    { markers: [3] },
    { markers: [17] },
    { markers: [22] },
  ])
})

test('D: 同一 marker 重复出现会被记录多次', () => {
  assert.deepEqual(parseCitationGroups('[reference:5] 文字 [reference:5]'), [{ markers: [5] }, { markers: [5] }])
})

// --- G. url safety ----------------------------------------------------------

test('G: 只接受 http / https', () => {
  assert.deepEqual(safeCitationUrl('https://a.com/x'), { url: 'https://a.com/x', domain: 'a.com' })
  assert.deepEqual(safeCitationUrl('http://a.com'), { url: 'http://a.com', domain: 'a.com' })
  assert.equal(safeCitationUrl('javascript:alert(1)'), null)
  assert.equal(safeCitationUrl('data:text/html,<b>x</b>'), null)
  assert.equal(safeCitationUrl('file:///etc/passwd'), null)
  assert.equal(safeCitationUrl('ftp://a.com'), null)
  assert.equal(safeCitationUrl('不是URL'), null)
  assert.equal(safeCitationUrl(''), null)
  assert.equal(safeCitationUrl(null), null)
})

test('G: 保留原始字符串（含 query / hash），不做规范化', () => {
  const raw = 'https://docs.python.org/3.15/whatsnew/3.14.html#index-52'
  assert.deepEqual(safeCitationUrl(raw), { url: raw, domain: 'docs.python.org' })
})

// --- E / F / H. mapping -----------------------------------------------------

test('E: 一个 group 多个 marker → 同一 URL 写入多个 Citation', () => {
  assert.deepEqual(resolveCitations({ groups: [{ markers: [1, 2] }], badges: ['https://example.com/a'] }), [
    { marker: 1, url: 'https://example.com/a', domain: 'example.com' },
    { marker: 2, url: 'https://example.com/a', domain: 'example.com' },
  ])
})

test('E: 多 group 按位置一一映射', () => {
  assert.deepEqual(
    resolveCitations({
      groups: [{ markers: [3] }, { markers: [5, 6] }],
      badges: ['https://a.com/1', 'https://b.com/2'],
    }),
    [
      { marker: 3, url: 'https://a.com/1', domain: 'a.com' },
      { marker: 5, url: 'https://b.com/2', domain: 'b.com' },
      { marker: 6, url: 'https://b.com/2', domain: 'b.com' },
    ],
  )
})

test('F: group 数与 badge 数不一致 → 不猜，返回空', () => {
  assert.deepEqual(resolveCitations({ groups: [{ markers: [1] }], badges: [] }), [])
  assert.deepEqual(resolveCitations({ groups: [], badges: ['https://a.com'] }), [])
  assert.deepEqual(resolveCitations({ groups: [{ markers: [1] }], badges: ['https://a.com', 'https://b.com'] }), [])
  assert.deepEqual(resolveCitations({ groups: [], badges: [] }), [])
})

test('F: 任一 badge 未水合或非法 → 整次放弃（不影响正文）', () => {
  assert.deepEqual(resolveCitations({ groups: [{ markers: [1] }], badges: [null] }), [])
  assert.deepEqual(
    resolveCitations({ groups: [{ markers: [1] }, { markers: [2] }], badges: ['https://ok.com', 'javascript:x'] }),
    [],
  )
})

test('H: 同 marker 同 URL → 去重为一条', () => {
  assert.deepEqual(
    resolveCitations({ groups: [{ markers: [5] }, { markers: [5] }], badges: ['https://a.com/x', 'https://a.com/x'] }),
    [{ marker: 5, url: 'https://a.com/x', domain: 'a.com' }],
  )
})

test('H: 同 marker 指向两个不同 URL → 保守失败', () => {
  assert.deepEqual(
    resolveCitations({ groups: [{ markers: [5] }, { markers: [5] }], badges: ['https://a.com', 'https://b.com'] }),
    [],
  )
  // 同一 group 内的重复 marker 也一样
  assert.deepEqual(resolveCitations({ groups: [{ markers: [5, 5] }], badges: ['https://a.com'] }), [
    { marker: 5, url: 'https://a.com', domain: 'a.com' },
  ])
})

// --- page-side reader -------------------------------------------------------

function fakeNode(badges: unknown[]): unknown {
  return { querySelectorAll: (selector: string) => (selector === '.ds-markdown-cite' ? badges : []) }
}

test('readCitationBadges：badge 自身就是 a[href]', () => {
  const node = fakeNode([{ tagName: 'A', getAttribute: (n: string) => (n === 'href' ? 'https://a.com' : null) }])
  assert.deepEqual(readCitationBadges(node), ['https://a.com'])
})

test('readCitationBadges：badge 内部包含 a[href]（兼容形态）', () => {
  const node = fakeNode([{ tagName: 'SPAN', querySelector: () => ({ getAttribute: () => 'https://b.com' }) }])
  assert.deepEqual(readCitationBadges(node), ['https://b.com'])
})

test('readCitationBadges：未水合 → null', () => {
  const node = fakeNode([{ tagName: 'SPAN', querySelector: () => null }])
  assert.deepEqual(readCitationBadges(node), [null])
})

test('readCitationBadges：非法输入安全返回空', () => {
  assert.deepEqual(readCitationBadges(null), [])
  assert.deepEqual(readCitationBadges(undefined), [])
  assert.deepEqual(readCitationBadges({}), [])
})

test('normalizeBadges：非数组 / 空串 / 非字符串 → 归一化', () => {
  assert.deepEqual(normalizeBadges(null), [])
  assert.deepEqual(normalizeBadges('x'), [])
  assert.deepEqual(normalizeBadges(['https://a.com', '', null, 3]), ['https://a.com', null, null, null])
})

// --- H2. block-local mapping (Phase 07I-1) ----------------------------------

test('normalizeBlockText：去掉链接目标 / 装饰并合并空白', () => {
  assert.equal(normalizeBlockText('**粗体** 与 [链接](https://x.com) 与 `代码`[reference:1]'), '粗体 与 链接 与 代码')
  assert.equal(normalizeBlockText('- 列表项\n  续行'), '列表项 续行')
  assert.equal(normalizeBlockText('> 引用[reference:2]'), '引用')
  assert.equal(normalizeBlockText('#   标题'), '标题')
  assert.equal(normalizeBlockText('多   个\n\n空白'), '多 个 空白')
})

test('parseMarkdownBlocks：只保留含 marker 的块，并跳过代码围栏', () => {
  const markdown = [
    '开头[reference:1]',
    '',
    '- 列表项[reference:2]',
    '- 无 marker 项',
    '',
    '```go',
    'x := "[reference:99]"',
    '```',
    '',
    '结尾[citation:3]',
  ].join('\n')

  assert.deepEqual(
    parseMarkdownBlocks(markdown).map((block) => block.groups),
    [[[1]], [[2]], [[3]]],
  )
})

test('readDomBlocks：取最内层块、剥离 badge 文本、从父级 a[href] 取 URL', () => {
  const badge = {
    tagName: 'SPAN',
    closest: (selector: string) => (selector === 'a[href]' ? { getAttribute: () => 'https://a.com' } : null),
    querySelector: () => null,
  }
  const paragraph = {
    textContent: '内容-1',
    querySelectorAll: (selector: string) => (selector === '.ds-markdown-cite' ? [badge] : []),
    querySelector: () => null,
    closest: () => null,
    cloneNode: () => ({ querySelectorAll: () => [{ remove: () => {} }], textContent: '内容' }),
  }
  const node = { querySelectorAll: (selector: string) => (selector.includes('p, li') ? [paragraph] : []) }

  assert.deepEqual(readDomBlocks(node), [{ text: '内容', badges: ['https://a.com'] }])
  assert.deepEqual(readDomBlocks(null), [])
})

test('block: 逐块独立解析 —— 数量不等的块放弃，其他块不受影响', () => {
  const markdown = [
    'A 段内容[reference:1]', // 1 group / 1 badge → 成功
    'B 段内容[reference:2][reference:3]', // 1 group（相邻）→ 成功，共用 URL
    'C 段内容[reference:4] 中[reference:5]', // 2 groups / 1 badge → 放弃
  ].join('\n\n')

  const citations = resolveCitationsByBlock({
    markdown,
    domBlocks: [
      { text: 'A 段内容', badges: ['https://a.com'] },
      { text: 'B 段内容', badges: ['https://b.com'] },
      { text: 'C 段内容 中', badges: ['https://c.com'] },
    ],
  })

  assert.deepEqual(
    citations.map((c) => [c.marker, c.url]),
    [
      [1, 'https://a.com'],
      [2, 'https://b.com'],
      [3, 'https://b.com'],
    ],
  )
})

test('block: 文本不一致 → 该块放弃（不做任何模糊匹配）', () => {
  const markdown = '第一段[reference:1]\n\n第二段[reference:2]'
  const citations = resolveCitationsByBlock({
    markdown,
    domBlocks: [
      { text: '完全不同的文字', badges: ['https://x.com'] },
      { text: '第二段', badges: ['https://b.com'] },
    ],
  })
  assert.deepEqual(citations, [{ marker: 2, url: 'https://b.com', domain: 'b.com' }])
})

test('block: marker 无 badge → 保留 [N]，不产生 citation', () => {
  assert.deepEqual(
    resolveCitationsByBlock({ markdown: '只有 marker[reference:1]', domBlocks: [{ text: '只有 marker', badges: [] }] }),
    [],
  )
})

test('block: badge 无 marker → 不映射', () => {
  assert.deepEqual(
    resolveCitationsByBlock({
      markdown: '没有引用的段落',
      domBlocks: [{ text: '没有引用的段落', badges: ['https://a.com'] }],
    }),
    [],
  )
})

test('block: 部分成功 —— 只有确定的项被写入', () => {
  const markdown = [
    '可解析[reference:1]',
    '数量不等[reference:2] 中[reference:3]',
    'URL 非法[reference:4]',
    '未渲染[reference:5]',
  ].join('\n\n')

  const citations = resolveCitationsByBlock({
    markdown,
    domBlocks: [
      { text: '可解析', badges: ['https://ok.com'] },
      { text: '数量不等 中', badges: ['https://x.com'] },
      { text: 'URL 非法', badges: ['javascript:alert(1)'] },
    ],
  })

  assert.deepEqual(citations, [{ marker: 1, url: 'https://ok.com', domain: 'ok.com' }])
})

test('block: 同一 DOM 块不会被两个 Markdown 块重复占用', () => {
  const markdown = '相同文字[reference:1]\n\n相同文字[reference:2]'
  const citations = resolveCitationsByBlock({
    markdown,
    domBlocks: [{ text: '相同文字', badges: ['https://a.com'] }],
  })
  // Only the first block may claim it; the second has nothing left.
  assert.deepEqual(citations, [{ marker: 1, url: 'https://a.com', domain: 'a.com' }])
})

// --- I. Host state ----------------------------------------------------------

const CITATION: Citation = { marker: 1, url: 'https://a.com', domain: 'a.com' }

test('I: updateChatCitations 只写 citations，不动 content / format / reasoning', () => {
  const store = createCompanionStateStore()
  store.appendChatMessage('user', '问题')
  const assistant = store.appendChatMessage('assistant', '# 正文', 'markdown')
  store.updateChatReasoning(assistant.id, '思考', 'text')

  store.updateChatCitations(assistant.id, [CITATION])

  const message = store.getState().chat.messages[1]!
  assert.deepEqual(message.citations, [CITATION])
  assert.equal(message.content, '# 正文')
  assert.equal(message.format, 'markdown')
  assert.deepEqual(message.reasoning, { content: '思考', format: 'text' })
})

test('I: 等值 citations 不重复 notify；空数组不 notify', () => {
  const store = createCompanionStateStore()
  const assistant = store.appendChatMessage('assistant', '正文')
  let notifies = 0
  store.subscribe(() => {
    notifies += 1
  })
  notifies = 0

  store.updateChatCitations(assistant.id, [CITATION])
  assert.equal(notifies, 1)

  store.updateChatCitations(assistant.id, [{ ...CITATION }]) // equal, new object
  assert.equal(notifies, 1)

  store.updateChatCitations(assistant.id, [])
  assert.equal(notifies, 1)
})

test('I: 找不到 message 时安全 no-op', () => {
  const store = createCompanionStateStore()
  store.appendChatMessage('assistant', '正文')
  const before = store.getState().chat.messages

  store.updateChatCitations('missing-id', [CITATION])

  assert.deepEqual(store.getState().chat.messages, before)
})

// --- L. background task semantics ------------------------------------------

test('L: citations 在正文完成之后才写入，且从不影响 sending / content', async () => {
  const store = createCompanionStateStore()
  let late: ((citations: Citation[]) => void) | null = null

  const result = await handleChatMessage(
    store,
    async (_message, onDelta, _onReasoning, onCitations) => {
      onDelta({ content: '正文[reference:1]', format: 'markdown' })
      late = onCitations
      return { content: '正文[reference:1]', format: 'markdown' } satisfies AssistantReply
    },
    'hi',
  )

  assert.equal(result.status, 200)
  // The reply is fully delivered — and the chat is already usable again — with
  // no citations yet.
  assert.equal(store.getState().chat.sending, false)
  assert.equal(store.getState().chat.messages[1]!.citations, undefined)
  assert.equal(store.getState().chat.messages[1]!.content, '正文[reference:1]')

  // …then the best-effort hydration lands.
  late!([CITATION])

  const message = store.getState().chat.messages[1]!
  assert.deepEqual(message.citations, [CITATION])
  assert.equal(message.content, '正文[reference:1]')
  assert.equal(store.getState().chat.sending, false)
})

test('L: 上一轮迟到的 citations 不会写进下一轮', async () => {
  const store = createCompanionStateStore()
  const lateCallbacks: ((citations: Citation[]) => void)[] = []
  const send = async (
    _message: string,
    onDelta: (reply: AssistantReply) => void,
    _r: unknown,
    onCitations: (c: Citation[]) => void,
  ) => {
    onDelta({ content: '回答', format: 'markdown' })
    lateCallbacks.push(onCitations)
    return { content: '回答', format: 'markdown' } satisfies AssistantReply
  }

  await handleChatMessage(store, send, '第一条')
  await handleChatMessage(store, send, '第二条')

  lateCallbacks[0]!([CITATION])

  const messages = store.getState().chat.messages
  assert.deepEqual(messages[1]!.citations, [CITATION]) // first assistant only
  assert.equal(messages[3]!.citations, undefined) // second assistant untouched
  assert.equal(store.getState().chat.sending, false)
})

test('L: 没有 onCitations（普通回答）时聊天完全不受影响', async () => {
  const store = createCompanionStateStore()
  const result = await handleChatMessage(
    store,
    async (_message, onDelta) => {
      onDelta({ content: '普通回答', format: 'markdown' })
      return { content: '普通回答', format: 'markdown' }
    },
    'hi',
  )

  assert.equal(result.status, 200)
  assert.equal(store.getState().chat.messages[1]!.citations, undefined)
  assert.equal(store.getState().chat.sending, false)
})
