import assert from 'node:assert/strict'
import test from 'node:test'

import {
  chatAttachmentsFromDraft,
  chooseFileInput,
  countPageInputsInPage,
  describeFileInputsInPage,
  diffDraftIdentities,
  draftIdentitiesOf,
  draftRemovedInPage,
  findDraftCardInPage,
  findRemoveControlInPage,
  isDraftIdentity,
  normalizeUploadResponse,
  readDraftIdentitiesInPage,
  REMOVE_CONTROL_OFFSETS,
  type DraftImageEnv,
  type FileInputCandidate,
} from '../src/host/draft-images.ts'
import type { ComposerAttachment } from '../src/shared/state.ts'

/**
 * Phase 18A：DeepSeek 页面草稿（blob 预览）辅助逻辑。
 *
 * 这些都是“注入式”纯函数：测试里用极小的 fake DOM 复现真实结构（img → 最近的
 * div[role=button] 卡片 + 右上角 cursor:pointer 的 <svg>），不启动浏览器。
 */

// --- a tiny fake DOM ----------------------------------------------------------

interface Box {
  left: number
  top: number
  width: number
  height: number
}

interface FakeEl {
  tagName: string
  attrs: Record<string, string>
  parentElement: FakeEl | null
  box: Box
  cursor: string
  /** Mirrors the real `input.multiple` property. */
  multiple?: boolean
  descendants: FakeEl[]
  querySelector(selector: string): FakeEl | null
  contains(other: unknown): boolean
  getAttribute(name: string): string | null
  getBoundingClientRect(): { left: number; top: number; width: number; height: number }
}

function fakeEl(init: {
  tag: string
  attrs?: Record<string, string>
  box?: Box
  cursor?: string
  parent?: FakeEl
  multiple?: boolean
  descendants?: FakeEl[]
}): FakeEl {
  const box = init.box ?? { left: 0, top: 0, width: 0, height: 0 }
  const element: FakeEl = {
    tagName: init.tag.toUpperCase(),
    attrs: init.attrs ?? {},
    parentElement: init.parent ?? null,
    box,
    cursor: init.cursor ?? 'default',
    descendants: init.descendants ?? [],
    ...(init.multiple !== undefined ? { multiple: init.multiple } : {}),
    querySelector(selector) {
      const wanted = selector.replace(/^\./, '').toUpperCase()
      const walk = (nodes: FakeEl[]): FakeEl | null => {
        for (const node of nodes) {
          const byClass = selector.startsWith('.') && (node.attrs.class ?? '').split(/\s+/).includes(selector.slice(1))
          if (node.tagName === wanted || byClass) return node
          const found = walk(node.descendants)
          if (found !== null) return found
        }
        return null
      }
      return walk(element.descendants)
    },
    contains(other) {
      let node: FakeEl | null = other !== null && typeof other === 'object' ? (other as FakeEl) : null
      while (node !== null) {
        if (node === element) return true
        node = node.parentElement
      }
      return false
    },
    getAttribute(name) {
      return Object.hasOwn(element.attrs, name) ? (element.attrs[name] ?? null) : null
    },
    getBoundingClientRect() {
      return { left: box.left, top: box.top, width: box.width, height: box.height }
    },
  }
  return element
}

/** One page draft: an img inside a role=button card, optionally with a remove X. */
function draft(
  identity: string,
  card: { left: number; top: number; width?: number; height?: number },
  control?: Box | null,
) {
  const box: Box = { left: card.left, top: card.top, width: card.width ?? 64, height: card.height ?? 64 }
  const cardEl = fakeEl({ tag: 'div', attrs: { role: 'button' }, box })
  const image = fakeEl({ tag: 'img', attrs: { src: identity }, box, parent: cardEl })
  // 真实结构：草稿卡片与消息输入框同属 composer 容器。
  const textarea = fakeEl({ tag: 'textarea', box, parent: cardEl })
  cardEl.descendants.push(image, textarea)
  const svg =
    control === null || control === undefined
      ? null
      : fakeEl({ tag: 'svg', box: control, cursor: 'pointer', parent: cardEl })
  return { cardEl, image, svg }
}

function fakeEnv(options: {
  images: Array<{ src: string }>
  /** Images that already belong to a transcript message (never drafts). */
  sentImages?: string[]
  /** Elements that participate in `elementFromPoint`, in hit-testing order. */
  hitOrder?: FakeEl[]
}): DraftImageEnv {
  const composer = fakeEl({ tag: 'div' })
  const textarea = fakeEl({ tag: 'textarea', parent: composer })
  const cards = options.images.map((entry) => {
    const card = fakeEl({ tag: 'div', attrs: { role: 'button' }, parent: composer })
    const image = fakeEl({ tag: 'img', attrs: { src: entry.src }, parent: card })
    card.descendants.push(image)
    return card
  })
  const transcripts = (options.sentImages ?? []).map((src) => {
    const message = fakeEl({ tag: 'div', attrs: { class: 'ds-message' }, parent: composer.parentElement ?? undefined })
    const image = fakeEl({ tag: 'img', attrs: { src }, parent: message })
    message.descendants.push(image)
    return message
  })
  composer.descendants.push(textarea, ...cards)
  const nodes = [...cards.map((card) => card.descendants[0]!), ...transcripts.map((m) => m.descendants[0]!)]
  const hit = options.hitOrder ?? nodes
  return {
    document: {
      querySelectorAll(selector: string) {
        if (selector === 'img') return nodes
        return []
      },
    },
    elementFromPoint(x: number, y: number) {
      for (const element of hit) {
        const box = element.box
        if (x >= box.left && x <= box.left + box.width && y >= box.top && y <= box.top + box.height) return element
      }
      return null
    },
    getComputedStyle(element: unknown) {
      return { cursor: (element as FakeEl).cursor }
    },
  }
}

const A = 'blob:https://chat.deepseek.com/aaaaaaaa-1111'
const B = 'blob:https://chat.deepseek.com/bbbbbbbb-2222'

// --- identities ---------------------------------------------------------------

test('18A draft: 只读取 blob: 预览，且用 src 属性（DOM 顺序）', () => {
  const env = fakeEnv({
    images: [{ src: A }, { src: 'https://cdn.deepseek.com/x.png' }, { src: B }, { src: 'data:image/png;base64,AA' }],
  })

  assert.deepEqual(readDraftIdentitiesInPage({ env }), [A, B])
  assert.deepEqual(readDraftIdentitiesInPage({ env: {} }), [], '没有 document → 空，不抛错')
})

test('18A draft: identity 形状校验', () => {
  assert.equal(isDraftIdentity(A), true)
  assert.equal(isDraftIdentity('blob:'), false)
  assert.equal(isDraftIdentity('blob:x'), true)
  assert.equal(isDraftIdentity('https://x/blob:1'), false)
  assert.equal(isDraftIdentity(''), false)
  assert.equal(isDraftIdentity(null), false)
  assert.equal(isDraftIdentity(42), false)
})

test('18A draft: 差集恰好一个才算成功；0 / 2 / 有消失都安全失败', () => {
  assert.deepEqual(diffDraftIdentities([], [A]), { ok: true, identity: A })
  assert.deepEqual(diffDraftIdentities([A], [A, B]), { ok: true, identity: B })

  const none = diffDraftIdentities([A], [A])
  assert.equal(none.ok, false)
  if (!none.ok) assert.match(none.error, /exactly one/)

  const two = diffDraftIdentities([], [A, B])
  assert.equal(two.ok, false)

  const lost = diffDraftIdentities([A, B], [B])
  assert.equal(lost.ok, false)
  if (!lost.ok) assert.match(lost.error, /disappeared/, '有草稿在附加过程中消失 → 绝不猜')
})

// --- upload response ----------------------------------------------------------

function uploadBody(overrides: Record<string, unknown> = {}): unknown {
  return {
    code: 0,
    data: {
      biz_code: 0,
      biz_data: {
        id: 'file-3f1a8c22-9d5b-4c7e-8a11-2b3c4d5e6f70',
        status: 'PENDING',
        file_name: 'foo.png',
        file_size: 40083,
        is_image: true,
        ...overrides,
      },
    },
  }
}

test('18A upload: 受理成功（HTTP 200 + code 0 + biz_code 0 + 合法 file id）', () => {
  const result = normalizeUploadResponse({ status: 200, body: uploadBody() })

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.meta.fileId, 'file-3f1a8c22-9d5b-4c7e-8a11-2b3c4d5e6f70')
  assert.equal(result.meta.fileName, 'foo.png')
  assert.equal(result.meta.fileSize, 40083)
  assert.equal(result.meta.status, 'PENDING', 'PENDING 是正常状态：受理成功 ≠ 审核完成')
})

test('18A upload: HTTP 错误 / code 非 0 / biz_code 非 0 都是失败（安全失败，不重试）', () => {
  assert.equal(normalizeUploadResponse({ status: 500, body: uploadBody() }).ok, false)
  assert.equal(normalizeUploadResponse({ status: 200, body: { code: 50000 } }).ok, false)
  assert.equal(
    normalizeUploadResponse({ status: 200, body: { code: 0, data: { biz_code: 7, biz_data: { id: 'file-x' } } } }).ok,
    false,
  )
})

test('18A upload: 非法 file id / 缺少 file_name / 缺少 file_size 都拒绝', () => {
  for (const overrides of [
    { id: 'abc' },
    { id: '' },
    { id: undefined },
    { file_name: undefined },
    { file_size: '40083' },
    { file_size: undefined },
  ]) {
    const result = normalizeUploadResponse({ status: 200, body: uploadBody(overrides) })
    assert.equal(result.ok, false, `${JSON.stringify(overrides)} 必须被拒绝`)
  }
})

test('18A upload: 非对象 / 缺字段的响应安全失败（绝不把垃圾当成功）', () => {
  for (const body of [null, undefined, 42, 'ok', {}, { code: 0 }, { code: 0, data: null }]) {
    assert.equal(normalizeUploadResponse({ status: 200, body }).ok, false)
  }
})

// --- card + control -----------------------------------------------------------

test('18A card: 精确定位 identity 所属卡片，并给出 hover 点（卡片中心）', () => {
  const one = draft(A, { left: 100, top: 200 })
  const env = fakeEnv({ images: [{ src: A }], hitOrder: [one.image, one.cardEl] })
  // The fake document must expose the real tree, so use it directly.
  const treeEnv: DraftImageEnv = {
    ...env,
    document: { querySelectorAll: (selector: string) => (selector === 'img' ? [one.image] : []) },
    elementFromPoint: (x, y) => (x >= 100 && x <= 164 && y >= 200 && y <= 264 ? one.image : null),
  }

  const located = findDraftCardInPage({ identity: A, env: treeEnv })

  assert.equal(located.found, true)
  assert.equal(located.x, 132, '卡片中心 x')
  assert.equal(located.y, 232, '卡片中心 y')
})

test('18A card: identity 不存在 / 没有卡片容器都是安全失败', () => {
  const orphan = fakeEl({ tag: 'img', attrs: { src: A }, box: { left: 0, top: 0, width: 10, height: 10 } })
  const noImage = findDraftCardInPage({ identity: A, env: fakeEnv({ images: [{ src: B }] }) })
  assert.equal(noImage.found, false)
  assert.equal(noImage.reason, 'draft-image-not-found')

  const noCard = findDraftCardInPage({
    identity: A,
    env: { document: { querySelectorAll: () => [orphan] } },
  })
  assert.equal(noCard.found, false)
  assert.equal(noCard.reason, 'draft-card-not-found')

  assert.equal(findDraftCardInPage({ identity: 'nope', env: fakeEnv({ images: [] }) }).found, false)
})

test('18A remove: 命中右上角 cursor:pointer 的 <svg> → 找到删除控件', () => {
  const one = draft(A, { left: 100, top: 200 }, { left: 150, top: 204, width: 12, height: 12 })
  const env: DraftImageEnv = {
    document: { querySelectorAll: (selector: string) => (selector === 'img' ? [one.image] : []) },
    elementFromPoint: (x, y) => {
      for (const element of [one.svg!, one.image, one.cardEl]) {
        const box = element.box
        if (x >= box.left && x <= box.left + box.width && y >= box.top && y <= box.top + box.height) return element
      }
      return null
    },
    getComputedStyle: (element) => ({ cursor: (element as FakeEl).cursor }),
  }

  const found = findRemoveControlInPage({ identity: A, offsets: REMOVE_CONTROL_OFFSETS, env })

  assert.equal(found.found, true)
  assert.equal(found.x! <= 164 && found.x! > 132, true, '在卡片右上角')
  assert.equal(found.y! >= 200, true)
})

test('18A remove: 命中元素不是 svg / cursor 不是 pointer / 控件在卡片外或左下 → 一律不认', () => {
  const cases: Array<{ label: string; box: Box | null; cursor?: string; tag?: string }> = [
    { label: '没有控件', box: null },
    { label: '控件在左下角', box: { left: 102, top: 240, width: 12, height: 12 } },
    { label: '控件在卡片外（右侧）', box: { left: 200, top: 204, width: 12, height: 12 } },
    { label: '控件比卡片还大', box: { left: 100, top: 200, width: 64, height: 64 } },
    { label: 'cursor 不是 pointer', box: { left: 150, top: 204, width: 12, height: 12 }, cursor: 'default' },
  ]

  for (const item of cases) {
    const one = draft(A, { left: 100, top: 200 }, item.box)
    if (item.cursor !== undefined && one.svg !== null) one.svg.cursor = item.cursor
    const env: DraftImageEnv = {
      document: { querySelectorAll: (selector: string) => (selector === 'img' ? [one.image] : []) },
      elementFromPoint: (x, y) => {
        for (const element of [one.svg, one.image, one.cardEl]) {
          if (element === null) continue
          const box = element.box
          if (x >= box.left && x <= box.left + box.width && y >= box.top && y <= box.top + box.height) return element
        }
        return null
      },
      getComputedStyle: (element) => ({ cursor: (element as FakeEl).cursor }),
    }

    const found = findRemoveControlInPage({ identity: A, offsets: REMOVE_CONTROL_OFFSETS, env })
    assert.equal(found.found, false, item.label)
  }
})

test('18A remove: 命中另一张卡片的 svg 不算（只认本卡片右上角）', () => {
  const target = draft(A, { left: 100, top: 200 })
  const other = draft(B, { left: 300, top: 200 }, { left: 350, top: 204, width: 12, height: 12 })
  const env: DraftImageEnv = {
    document: { querySelectorAll: (selector: string) => (selector === 'img' ? [target.image, other.image] : []) },
    elementFromPoint: (x, y) => {
      for (const element of [other.svg!, other.image, other.cardEl, target.image, target.cardEl]) {
        const box = element.box
        if (x >= box.left && x <= box.left + box.width && y >= box.top && y <= box.top + box.height) return element
      }
      return null
    },
    getComputedStyle: (element) => ({ cursor: (element as FakeEl).cursor }),
  }

  assert.equal(
    findRemoveControlInPage({ identity: A, offsets: REMOVE_CONTROL_OFFSETS, env }).found,
    false,
    '目标卡片没有 X → 安全失败',
  )
})

test('18A remove 确认: 目标消失且其它 identity 全在才算成功', () => {
  const done = fakeEnv({ images: [{ src: B }] })
  const stillThere = fakeEnv({ images: [{ src: A }, { src: B }] })
  const collateral = fakeEnv({ images: [] })

  assert.equal(draftRemovedInPage({ target: A, others: [B], env: done }), true)
  assert.equal(draftRemovedInPage({ target: A, others: [B], env: stillThere }), false, '目标还在 → 失败')
  assert.equal(draftRemovedInPage({ target: A, others: [B], env: collateral }), false, '别的草稿也没了 → 失败')
})

// --- file input selection -----------------------------------------------------

/** The composer's real input: multiple + the long accept list DeepSeek uses. */
const COMPOSER_INPUT: FileInputCandidate = {
  index: 0,
  multiple: true,
  acceptsImages: true,
  acceptLength: 400,
}

const unique = (candidates: FileInputCandidate[]) => candidates.map((c, index) => ({ ...c, index }))

test('18A input: 整页只有一个候选 → 直接用它', () => {
  const choice = chooseFileInput(unique([COMPOSER_INPUT]))
  assert.deepEqual(choice, { ok: true, index: 0 })
})

test('18A input: 多个候选时选「multiple + 接受图片 + accept 清单最长」的那个', () => {
  const candidates = unique([
    { index: 0, multiple: false, acceptsImages: true, acceptLength: 12 }, // 头像之类
    { index: 0, multiple: true, acceptsImages: false, acceptLength: 20 }, // 只收文档
    { index: 0, multiple: true, acceptsImages: true, acceptLength: 400 }, // 真实 composer 输入
  ])

  assert.deepEqual(chooseFileInput(candidates), { ok: true, index: 2 })
})

test('18A input: 没有可用候选 → 安全失败（绝不乱点别的 input）', () => {
  const none = chooseFileInput([])
  assert.equal(none.ok, false)

  const wrongKinds = chooseFileInput(
    unique([
      { index: 0, multiple: false, acceptsImages: true, acceptLength: 30 },
      { index: 0, multiple: true, acceptsImages: false, acceptLength: 300 },
    ]),
  )
  assert.equal(wrongKinds.ok, false)
})

test('18A input: 两个候选同样「像」→ 歧义，安全失败（不猜）', () => {
  const ambiguous = chooseFileInput(
    unique([
      { index: 0, multiple: true, acceptsImages: true, acceptLength: 400 },
      { index: 0, multiple: true, acceptsImages: true, acceptLength: 400 },
    ]),
  )
  assert.equal(ambiguous.ok, false)
  if (!ambiguous.ok) assert.match(ambiguous.error, /ambiguous/)
})

test('18A input: 页面描述只读取标准 DOM 属性（multiple / accept）', () => {
  const inputs = [
    fakeEl({ tag: 'input', attrs: { type: 'file', accept: '.png,.pdf' }, multiple: true }),
    fakeEl({ tag: 'input', attrs: { type: 'file', accept: '.txt' } }),
    fakeEl({ tag: 'input', attrs: { type: 'file' } }),
  ]
  const env: DraftImageEnv = {
    document: {
      querySelectorAll: (selector: string) => (selector === 'input[type=file]' ? inputs : []),
    },
  }

  const described = describeFileInputsInPage({ env })

  assert.deepEqual(
    described.map((entry) => ({ multiple: entry.multiple, acceptsImages: entry.acceptsImages, index: entry.index })),
    [
      { multiple: true, acceptsImages: true, index: 0 },
      { multiple: false, acceptsImages: false, index: 1 },
      { multiple: false, acceptsImages: true, index: 2 }, // accept 为空 = 任意类型
    ],
  )
})

// --- snapshot helpers ---------------------------------------------------------

test('18A snapshot: 只把 ready 且有 identity 的草稿算进身份集合', () => {
  const attachments: ComposerAttachment[] = [
    { id: 'a', kind: 'image', name: 'a.png', mimeType: 'image/png', bytes: 1, status: 'ready' },
    { id: 'b', kind: 'image', name: 'b.png', mimeType: 'image/png', bytes: 1, status: 'uploading' },
    { id: 'c', kind: 'image', name: 'c.png', mimeType: 'image/png', bytes: 1, status: 'error', error: 'boom' },
    { id: 'd', kind: 'image', name: 'd.png', mimeType: 'image/png', bytes: 1, status: 'ready' },
  ]
  const identities: Record<string, string | undefined> = { a: A, b: B, d: undefined }

  assert.deepEqual(
    draftIdentitiesOf(attachments, (id) => identities[id]),
    [A],
    'uploading / error / 缺 identity 的都不参与页面集合比对',
  )
})

test('18A snapshot: 已发送附件只保留元数据（无预览、无路径、无 blob）', () => {
  const attachments = chatAttachmentsFromDraft([
    { id: 'att-1', name: 'a.png', mimeType: 'image/png', bytes: 1024 },
    { id: 'att-2', name: 'b.jpg', mimeType: 'image/jpeg', bytes: 2048 },
  ])

  assert.deepEqual(attachments, [
    { id: 'att-1', kind: 'image', name: 'a.png', mimeType: 'image/png', bytes: 1024 },
    { id: 'att-2', kind: 'image', name: 'b.jpg', mimeType: 'image/jpeg', bytes: 2048 },
  ])
  assert.equal(JSON.stringify(attachments).includes('blob:'), false)
})

// --- the serialization contract -----------------------------------------------

test('18A 页面函数必须自包含：不得引用任何模块级标识符（Playwright 会序列化它们）', () => {
  const inPage = [
    readDraftIdentitiesInPage,
    findDraftCardInPage,
    findRemoveControlInPage,
    draftRemovedInPage,
    describeFileInputsInPage,
    countPageInputsInPage,
  ]
  const serialized = inPage.map((fn) => fn.toString()).join('\n')

  // 模块级 helper / 常量一旦出现在函数体里，页面内执行时就是 ReferenceError，
  // page.evaluate 会 reject —— 之前的实现正是这样静默地“看不到任何草稿”。
  for (const leak of [
    'attributeOf(',
    'locateCard(',
    'boxOf(',
    'closestByTag(',
    'closestByRoleButton(',
    'isDraftIdentity(',
    'asRecord(',
    'IMAGE_EXTENSIONS',
    'DRAFT_IDENTITY_PREFIX',
    'REMOVE_CONTROL_OFFSETS',
  ]) {
    assert.equal(serialized.includes(leak), false, `${leak} 不能被序列化进页面函数`)
  }

  // 一个页面函数调用另一个页面函数同样会在页面里炸掉（那边没有这个符号）。
  for (const fn of inPage) {
    const source = fn.toString()
    for (const other of inPage) {
      if (other === fn) continue
      assert.equal(source.includes(`${other.name}(`), false, `${fn.name} 不能调用 ${other.name}（必须各自内联）`)
    }
  }
})

test('18A 页面函数：注入 fake env 时真的能读出草稿 identity（序列化契约的行为面）', () => {
  const one = draft(A, { left: 10, top: 20 })
  const env: DraftImageEnv = {
    document: { querySelectorAll: (selector: string) => (selector === 'img' ? [one.image, one.cardEl] : []) },
  }

  assert.deepEqual(readDraftIdentitiesInPage({ env }), [A])
  assert.equal(draftRemovedInPage({ target: A, others: [], env }), false)
})

// --- composer scoping (真实实机验收抓到的缺陷) ---------------------------------

test('18A scope: 已发送消息里的 blob 图片绝不算草稿（图片发送后再发消息不会被误拦）', () => {
  const env = fakeEnv({ images: [{ src: A }], sentImages: [B] })

  assert.deepEqual(readDraftIdentitiesInPage({ env, messageSelector: '.ds-message' }), [A], '只看到 composer 里的草稿')

  // 删除确认同样只看 composer：消息里那张图的存在与否不影响结果。
  assert.equal(draftRemovedInPage({ target: A, others: [], env, messageSelector: '.ds-message' }), false)
  assert.equal(
    draftRemovedInPage({ target: B, others: [A], env, messageSelector: '.ds-message' }),
    true,
    'B 不是草稿 → 目标“已从 composer 消失”且 A 仍在',
  )
})

test('18A scope: 不在 composer 里的图片（无 textarea 祖先）不算草稿', () => {
  const orphan = fakeEl({ tag: 'img', attrs: { src: A } })
  const env: DraftImageEnv = {
    document: { querySelectorAll: (selector: string) => (selector === 'img' ? [orphan] : []) },
  }

  assert.deepEqual(readDraftIdentitiesInPage({ env, messageSelector: '.ds-message' }), [])
})
