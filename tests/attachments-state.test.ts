import assert from 'node:assert/strict'
import test from 'node:test'

import { createCompanionStateStore } from '../src/host/state.ts'
import type { CompanionState } from '../src/shared/state.ts'

/**
 * Phase 18A 附件状态测试（Host store 一侧）。
 *
 * 这里只验证“可序列化的元数据”这一层：附件草稿的生命周期、按 id 精确删除、
 * 清理、以及三种 surface 读到同一份快照。页面上传/身份匹配在附件相关测试里。
 */

const add = (store: ReturnType<typeof createCompanionStateStore>, name = 'a.png', bytes = 1024) =>
  store.addComposerAttachment({ name, mimeType: 'image/png', bytes })

test('18A state: 新增草稿默认 uploading，只带元数据', () => {
  const store = createCompanionStateStore()
  const attachment = add(store, '照片.png', 2048)

  assert.match(attachment.id, /^[0-9a-f-]{36}$/)
  assert.equal(attachment.kind, 'image')
  assert.equal(attachment.name, '照片.png')
  assert.equal(attachment.mimeType, 'image/png')
  assert.equal(attachment.bytes, 2048)
  assert.equal(attachment.status, 'uploading')
  assert.deepEqual(store.getState().composer.attachments, [attachment])
})

test('18A state: update 改变状态与错误文案，相同值不重复通知', () => {
  const store = createCompanionStateStore()
  const attachment = add(store)
  let notifies = 0
  store.subscribe(() => {
    notifies += 1
  })
  notifies = 0

  store.updateComposerAttachment(attachment.id, { status: 'ready' })
  assert.equal(store.getState().composer.attachments[0]!.status, 'ready')
  assert.equal(notifies, 1)

  store.updateComposerAttachment(attachment.id, { status: 'ready' })
  assert.equal(notifies, 1, '状态没变 → 不推送')

  store.updateComposerAttachment(attachment.id, { status: 'error', error: 'upload failed' })
  assert.equal(store.getState().composer.attachments[0]!.status, 'error')
  assert.equal(store.getState().composer.attachments[0]!.error, 'upload failed')
  assert.equal(notifies, 2, 'error 文案变化也算变化')
})

test('18A state: update 后恢复 ready 会清掉上次的 error 文案', () => {
  const store = createCompanionStateStore()
  const attachment = add(store)
  store.updateComposerAttachment(attachment.id, { status: 'error', error: 'boom' })

  store.updateComposerAttachment(attachment.id, { status: 'ready' })

  assert.equal(store.getState().composer.attachments[0]!.status, 'ready')
  assert.equal(store.getState().composer.attachments[0]!.error, undefined)
})

test('18A state: 未知 id 的 update / remove 都是安全 no-op', () => {
  const store = createCompanionStateStore()
  const attachment = add(store)

  store.updateComposerAttachment('nope', { status: 'ready' })
  store.removeComposerAttachment('nope')

  assert.equal(store.getState().composer.attachments[0]!.status, 'uploading')
  assert.equal(store.getState().composer.attachments.length, 1)
  assert.equal(store.getState().composer.attachments[0]!.id, attachment.id)
})

test('18A state: 按 id 精确删除 —— 删 A 不动 B，删中间项不动两侧', () => {
  const store = createCompanionStateStore()
  const a = add(store, 'a.png')
  const b = add(store, 'b.png')
  const c = add(store, 'c.png')

  store.removeComposerAttachment(b.id)
  assert.deepEqual(
    store.getState().composer.attachments.map((item) => item.id),
    [a.id, c.id],
    '只删掉中间那一张',
  )

  store.removeComposerAttachments([a.id, c.id])
  assert.deepEqual(store.getState().composer.attachments, [])
})

test('18A state: 批量删除只推送一次，未知 id 与空列表不产生推送', () => {
  const store = createCompanionStateStore()
  const a = add(store, 'a.png')
  const b = add(store, 'b.png')
  let notifies = 0
  store.subscribe(() => {
    notifies += 1
  })
  notifies = 0

  store.removeComposerAttachments(['nope'])
  store.removeComposerAttachments([])
  assert.equal(notifies, 0)

  store.removeComposerAttachments([a.id, b.id, 'nope'])
  assert.equal(notifies, 1, '两张一起删 → 只有一次状态推送')
  assert.deepEqual(store.getState().composer.attachments, [])
})

test('18A state: clear 清空草稿；本来就是空的时候不推送', () => {
  const store = createCompanionStateStore()
  let notifies = 0
  store.subscribe(() => {
    notifies += 1
  })
  notifies = 0

  store.clearComposerAttachments()
  assert.equal(notifies, 0, '空草稿 → 无变化')

  add(store, 'a.png')
  add(store, 'b.png')
  store.clearComposerAttachments()
  assert.deepEqual(store.getState().composer.attachments, [])
})

test('18A state: 草稿在 sending / stopping / 开关写入时不会被丢掉', () => {
  const store = createCompanionStateStore()
  const attachment = add(store)

  store.setDeepThinkState({ available: true, enabled: true })
  store.setSearchState({ available: true, enabled: false })
  store.setChatSending(true)
  store.setComposerStopping(true)
  store.setChatSending(false)

  assert.equal(store.getState().composer.attachments.length, 1, '草稿没有被其它写入丢掉')
  assert.equal(store.getState().composer.attachments[0]!.id, attachment.id)
  assert.equal(store.getState().composer.attachments[0]!.status, 'uploading')
})

test('18A state: 附件元数据可被 SSE 序列化，且绝不包含 tempPath / previewIdentity / 字节', () => {
  const store = createCompanionStateStore()
  const attachment = add(store, '照片.png', 4096)
  store.updateComposerAttachment(attachment.id, { status: 'ready' })

  const payload = JSON.stringify(store.getState())

  assert.equal(payload.includes('tempPath'), false)
  assert.equal(payload.includes('previewIdentity'), false)
  assert.equal(payload.includes('deepSeekFileId'), false)
  assert.equal(payload.includes('dataBase64'), false)
  assert.deepEqual(JSON.parse(payload).composer.attachments, [
    { id: attachment.id, kind: 'image', name: '照片.png', mimeType: 'image/png', bytes: 4096, status: 'ready' },
  ])
})

test('18A state: 已发送消息的 attachments 由 Host 写入，且去重', () => {
  const store = createCompanionStateStore()
  const user = store.appendChatMessage('user', '看图')
  const attachments = [{ id: 'att-1', kind: 'image' as const, name: 'a.png', mimeType: 'image/png', bytes: 1024 }]
  let notifies = 0
  store.subscribe(() => {
    notifies += 1
  })
  notifies = 0

  store.setChatMessageAttachments(user.id, attachments)
  assert.deepEqual(store.getState().chat.messages[0]!.attachments, attachments)
  assert.equal(notifies, 1)

  store.setChatMessageAttachments(user.id, attachments)
  assert.equal(notifies, 1, '相同内容 → 不重复推送')

  store.setChatMessageAttachments('nope', attachments)
  assert.equal(notifies, 1, '未知消息 → 安全 no-op')
})

test('18A state: 三界面拿到完全相同的附件快照', () => {
  const store = createCompanionStateStore()
  const snapshot = (state: CompanionState) => JSON.stringify(state.composer.attachments)
  const dock: string[] = []
  const float: string[] = []
  const popout: string[] = []
  store.subscribe((state) => dock.push(snapshot(state)))
  store.subscribe((state) => float.push(snapshot(state)))
  store.subscribe((state) => popout.push(snapshot(state)))

  const a = add(store, 'a.png')
  const b = add(store, 'b.png')
  store.updateComposerAttachment(a.id, { status: 'ready' })
  store.updateComposerAttachment(b.id, { status: 'error', error: 'boom' })
  store.removeComposerAttachment(b.id)

  assert.deepEqual(dock, float)
  assert.deepEqual(float, popout)
  assert.deepEqual(store.getState().composer.attachments, [
    { id: a.id, kind: 'image', name: 'a.png', mimeType: 'image/png', bytes: 1024, status: 'ready' },
  ])
})
