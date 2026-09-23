import assert from 'node:assert/strict'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createAttachmentResources } from '../src/host/attachment-resources.ts'
import { handleAttachmentRequest, type AttachmentCapableBrowser } from '../src/host/attachment-route.ts'
import { createPageGuard } from '../src/host/guard.ts'
import { createCompanionStateStore, type CompanionStateStore } from '../src/host/state.ts'
import type { AttachImageResult } from '../src/host/browser.ts'

/**
 * Phase 18A：`/chat/attachment` 的 add / remove 全边界。
 *
 * 这里用真实的 store + 真实的临时文件目录（tmpdir），只把页面替换成 stub ——
 * 也就是真正会在生产里跑的那两条路径。
 */

const PNG = Buffer.concat([
  Buffer.from('89504e470d0a1a0a', 'hex'),
  Buffer.alloc(24, 5),
])

function addBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    action: 'add',
    name: 'foo.png',
    mimeType: 'image/png',
    dataBase64: PNG.toString('base64'),
    ...overrides,
  }
}

const IDENTITY_A = 'blob:https://chat.deepseek.com/aaaa-1111'
const FILE_A = 'file-3f1a8c22-9d5b-4c7e-8a11-2b3c4d5e6f70'

interface Harness {
  store: CompanionStateStore
  resources: ReturnType<typeof createAttachmentResources>
  guard: ReturnType<typeof createPageGuard>
  browser: AttachmentCapableBrowser | null
  calls: { attach: number; remove: number; removedIdentities: string[] }
}

/** A well-behaved page stub: uploads succeed, removals are confirmed. */
function workingBrowser(calls: Harness['calls']): AttachmentCapableBrowser {
  return {
    async attachImage(): Promise<AttachImageResult> {
      calls.attach += 1
      return { ok: true, previewIdentity: IDENTITY_A, deepSeekFileId: FILE_A }
    },
    async removeDraftAttachment(input: { previewIdentity: string }): Promise<boolean> {
      calls.remove += 1
      calls.removedIdentities.push(input.previewIdentity)
      return true
    },
  }
}

async function withHarness(
  options: { browser?: AttachmentCapableBrowser | null },
  run: (h: Harness, dir: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'dsc-attachment-route-'))
  const store = createCompanionStateStore()
  const calls: Harness['calls'] = { attach: 0, remove: 0, removedIdentities: [] }
  const h: Harness = {
    store,
    resources: createAttachmentResources({ dir, store }),
    guard: createPageGuard(),
    browser: options.browser === undefined ? workingBrowser(calls) : options.browser,
    calls,
  }
  try {
    await run(h, dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

// --- add ----------------------------------------------------------------------

test('18A add: 合法图片 → 200 ready，记录里带上页面 identity 与 file id，临时文件真实存在', async () => {
  await withHarness({}, async (h) => {
    const result = await handleAttachmentRequest(
      { store: h.store, resources: h.resources, browser: h.browser, guard: h.guard },
      addBody(),
    )

    assert.equal(result.status, 200)
    assert.equal(result.body.attachment?.status, 'ready')
    assert.equal(result.body.attachment?.name, 'foo.png')
    assert.equal(result.body.attachment?.bytes, PNG.length)

    const record = h.resources.get(result.body.attachment!.id)
    assert.equal(record?.previewIdentity, IDENTITY_A)
    assert.equal(record?.deepSeekFileId, FILE_A)
    const file = await stat(record!.tempPath)
    assert.equal(file.size, PNG.length, '临时文件保存的是校验后的真实字节')
    assert.equal(h.calls.attach, 1)
  })
})

test('18A add: 校验失败（400）时绝不创建 entry / 记录 / 临时文件', async () => {
  await withHarness({}, async (h) => {
    const bad = [
      addBody({ mimeType: 'image/svg+xml' }),
      addBody({ dataBase64: 'not base64!' }),
      addBody({ name: '' }),
      { action: 'add' },
    ]

    for (const body of bad) {
      const result = await handleAttachmentRequest(
        { store: h.store, resources: h.resources, browser: h.browser, guard: h.guard },
        body,
      )
      assert.equal(result.status, 400, JSON.stringify(body))
    }

    assert.deepEqual(h.store.getState().composer.attachments, [])
    assert.deepEqual(h.resources.list(), [])
    assert.equal(h.calls.attach, 0)
  })
})

test('18A add: 超限（400）不触碰页面；browser 未就绪 503；流式/占用中 409', async () => {
  await withHarness({}, async (h) => {
    const deps = { store: h.store, resources: h.resources, browser: h.browser, guard: h.guard }
    const tiny = { maxBytes: 8, maxTotalBytes: 16, maxCount: 1 }

    const tooBig = await handleAttachmentRequest({ ...deps, limits: tiny }, addBody())
    assert.equal(tooBig.status, 400)
    assert.match(tooBig.body.error ?? '', /too large/)

    const noBrowser = await handleAttachmentRequest({ ...deps, browser: null }, addBody())
    assert.equal(noBrowser.status, 503)

    h.store.setChatSending(true)
    const busy = await handleAttachmentRequest(deps, addBody())
    assert.equal(busy.status, 409)
    assert.equal(busy.body.error, 'chat is busy')
    h.store.setChatSending(false)

    h.guard.tryClaim()
    const guarded = await handleAttachmentRequest(deps, addBody())
    assert.equal(guarded.status, 409)
    assert.equal(guarded.body.error, 'page operation in progress')
    h.guard.release()

    assert.equal(h.calls.attach, 0, '一次都没有碰页面')
  })
})

test('18A add: 上传失败但页面已出现卡片 → 200 error，记录保留 identity、临时文件已删', async () => {
  const failing: AttachmentCapableBrowser = {
    async attachImage() {
      return { ok: false, error: 'upload failed (HTTP 500)', previewIdentity: IDENTITY_A }
    },
    async removeDraftAttachment() {
      return true
    },
  }
  await withHarness({ browser: failing }, async (h) => {
    const result = await handleAttachmentRequest(
      { store: h.store, resources: h.resources, browser: h.browser, guard: h.guard },
      addBody(),
    )

    assert.equal(result.status, 200)
    assert.equal(result.body.attachment?.status, 'error')
    assert.equal(result.body.attachment?.error, 'upload failed (HTTP 500)')

    const record = h.resources.get(result.body.attachment!.id)
    assert.equal(record?.previewIdentity, IDENTITY_A, '失败卡片仍可被精确删除')
    assert.equal(record?.deepSeekFileId, undefined)
    assert.equal(
      await stat(record!.tempPath).then(() => true, () => false),
      false,
      '失败的字节立即丢弃（重试是新的 entry）',
    )
  })
})

test('18A add: 卡片都没出现时失败 → 记录里没有 identity', async () => {
  const failing: AttachmentCapableBrowser = {
    async attachImage() {
      return { ok: false, error: 'upload timed out' }
    },
    async removeDraftAttachment() {
      return true
    },
  }
  await withHarness({ browser: failing }, async (h) => {
    const result = await handleAttachmentRequest(
      { store: h.store, resources: h.resources, browser: h.browser, guard: h.guard },
      addBody(),
    )

    assert.equal(result.status, 200)
    assert.equal(result.body.attachment?.status, 'error')
    assert.equal(h.resources.get(result.body.attachment!.id)?.previewIdentity, undefined)
  })
})

// --- remove -------------------------------------------------------------------

test('18A remove: 页面确认删掉卡片后才清 Host（state + 记录 + 临时文件）', async () => {
  await withHarness({}, async (h) => {
    const deps = { store: h.store, resources: h.resources, browser: h.browser, guard: h.guard }
    const added = await handleAttachmentRequest(deps, addBody())
    const id = added.body.attachment!.id
    const tempPath = h.resources.get(id)!.tempPath

    const result = await handleAttachmentRequest(deps, { action: 'remove', id })

    assert.equal(result.status, 200)
    assert.deepEqual(h.store.getState().composer.attachments, [])
    assert.equal(h.resources.get(id), undefined)
    assert.equal(await stat(tempPath).then(() => true, () => false), false)
    assert.deepEqual(h.calls.removedIdentities, [IDENTITY_A], '按 identity 精确删除')
  })
})

test('18A remove: 页面删除失败 → 409，且 Host 三样东西全部保持不动', async () => {
  const refusing: AttachmentCapableBrowser = {
    async attachImage() {
      return { ok: true, previewIdentity: IDENTITY_A, deepSeekFileId: FILE_A }
    },
    async removeDraftAttachment() {
      return false
    },
  }
  await withHarness({ browser: refusing }, async (h) => {
    const deps = { store: h.store, resources: h.resources, browser: h.browser, guard: h.guard }
    const added = await handleAttachmentRequest(deps, addBody())
    const id = added.body.attachment!.id
    const tempPath = h.resources.get(id)!.tempPath

    const result = await handleAttachmentRequest(deps, { action: 'remove', id })

    assert.equal(result.status, 409)
    assert.equal(h.store.getState().composer.attachments.length, 1)
    assert.equal(h.resources.get(id)?.previewIdentity, IDENTITY_A)
    assert.equal(await stat(tempPath).then(() => true, () => false), true)
  })
})

test('18A remove: 没有 identity 的失败条目 → 不点页面，只清 Host（临时文件已不在也成功）', async () => {
  const failing: AttachmentCapableBrowser = {
    async attachImage() {
      return { ok: false, error: 'upload timed out' }
    },
    async removeDraftAttachment() {
      throw new Error('must not be called')
    },
  }
  await withHarness({ browser: failing }, async (h) => {
    const deps = { store: h.store, resources: h.resources, browser: h.browser, guard: h.guard }
    const added = await handleAttachmentRequest(deps, addBody())
    const id = added.body.attachment!.id

    const result = await handleAttachmentRequest(deps, { action: 'remove', id })

    assert.equal(result.status, 200)
    assert.deepEqual(h.store.getState().composer.attachments, [])
    assert.equal(h.resources.get(id), undefined)
    assert.equal(h.calls.remove, 0, '页面从没出现过卡片 → 不点击')
  })
})

test('18A remove: 400 / 409 / 503 边界', async () => {
  await withHarness({}, async (h) => {
    const deps = { store: h.store, resources: h.resources, browser: h.browser, guard: h.guard }

    assert.equal((await handleAttachmentRequest(deps, { action: 'remove' })).status, 400, '缺 id')
    assert.equal((await handleAttachmentRequest(deps, { action: 'remove', id: 'nope' })).status, 400, '未知 id')
    assert.equal((await handleAttachmentRequest(deps, { action: 'nope' })).status, 400, '未知 action')
    assert.equal((await handleAttachmentRequest({ ...deps, browser: null }, { action: 'remove', id: 'x' })).status, 503)

    const added = await handleAttachmentRequest(deps, addBody())
    const id = added.body.attachment!.id

    h.store.setChatSending(true)
    assert.equal((await handleAttachmentRequest(deps, { action: 'remove', id })).status, 409)
    h.store.setChatSending(false)

    h.guard.tryClaim()
    assert.equal((await handleAttachmentRequest(deps, { action: 'remove', id })).status, 409)
    h.guard.release()

    assert.equal(h.store.getState().composer.attachments.length, 1, 'Host 侧始终没被改动')
  })
})

test('18A resources: resetDraft 清空 state + 记录 + 临时文件，且幂等', async () => {
  await withHarness({}, async (h) => {
    const deps = { store: h.store, resources: h.resources, browser: h.browser, guard: h.guard }
    const first = await handleAttachmentRequest(deps, addBody())
    const second = await handleAttachmentRequest(deps, addBody({ name: 'bar.png' }))
    const paths = [first, second].map((result) => h.resources.get(result.body.attachment!.id)!.tempPath)

    await h.resources.resetDraft()
    await h.resources.resetDraft() // 幂等

    assert.deepEqual(h.store.getState().composer.attachments, [])
    assert.deepEqual(h.resources.list(), [])
    for (const path of paths) {
      assert.equal(await stat(path).then(() => true, () => false), false)
    }
  })
})

test('18A resources: consume 只删被消费的那一条，绝不动其它草稿', async () => {
  await withHarness({}, async (h) => {
    const deps = { store: h.store, resources: h.resources, browser: h.browser, guard: h.guard }
    const kept = await handleAttachmentRequest(deps, addBody({ name: 'keep.png' }))
    const consumed = await handleAttachmentRequest(deps, addBody({ name: 'gone.png' }))
    const keptPath = h.resources.get(kept.body.attachment!.id)!.tempPath
    const consumedPath = h.resources.get(consumed.body.attachment!.id)!.tempPath

    await h.resources.consume([consumed.body.attachment!.id])

    assert.equal(h.resources.get(consumed.body.attachment!.id), undefined)
    assert.equal(await stat(consumedPath).then(() => true, () => false), false)
    assert.notEqual(h.resources.get(kept.body.attachment!.id), undefined, '别的草稿仍然在')
    assert.equal(await stat(keptPath).then(() => true, () => false), true, '别的临时文件没被删')
    assert.equal(h.store.getState().composer.attachments.length, 2, 'consume 只清记录与文件，不改草稿 state')
  })
})

test('18A resources: 清理永远幂等（文件已被删掉也不抛错）', async () => {
  await withHarness({}, async (h) => {
    const deps = { store: h.store, resources: h.resources, browser: h.browser, guard: h.guard }
    const added = await handleAttachmentRequest(deps, addBody())
    const id = added.body.attachment!.id

    await h.resources.drop([id])
    await h.resources.drop([id])
    await h.resources.drop(['never-existed'])

    assert.deepEqual(h.resources.list(), [])
  })
})
