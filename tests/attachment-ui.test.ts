import assert from 'node:assert/strict'
import test from 'node:test'

import {
  IMAGE_MIME_TYPES,
  attachmentStatusText,
  canPickAttachment,
  canSendRound,
  formatBytes,
} from '../src/client/attachment-ui.ts'
import type { ComposerAttachment } from '../src/shared/state.ts'

/**
 * Phase 18A：三界面共用的附件 UI 规则。
 *
 * 渲染本身在实机验收里验证（仓库没有 DOM 测试设施，也不为此新增依赖）；
 * 这里覆盖卡片文案与「这一轮能不能发」这唯一一个客户端决策。
 */

const attachment = (
  status: ComposerAttachment['status'],
  extra: { bytes?: number; error?: string; name?: string } = {},
): ComposerAttachment => ({
  id: `att-${status}`,
  kind: 'image',
  name: extra.name ?? 'foo.png',
  mimeType: 'image/png',
  bytes: extra.bytes ?? 1887436,
  status,
  ...(extra.error !== undefined ? { error: extra.error } : {}),
})

const base = { attachments: [] as ComposerAttachment[], busy: false, attaching: false, connection: 'online' as const }

// --- 卡片文案 -----------------------------------------------------------------

test('18A card: 字节数按 1.8 MB 这样的可读格式展示', () => {
  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(999), '999 B')
  assert.equal(formatBytes(2048), '2.0 KB')
  assert.equal(formatBytes(1887436), '1.8 MB')
  assert.equal(formatBytes(Number.NaN), '0 B')
})

test('18A card: 三种状态各有明确文案，失败带原因', () => {
  assert.equal(attachmentStatusText(attachment('uploading')), '上传中…')
  assert.equal(attachmentStatusText(attachment('ready')), '已就绪')
  assert.equal(attachmentStatusText(attachment('error', { error: 'upload failed (HTTP 500)' })), '失败 · upload failed (HTTP 500)')
  assert.equal(attachmentStatusText(attachment('error')), '失败')
})

test('18A card: 选择器只接受四种图片类型', () => {
  assert.deepEqual([...IMAGE_MIME_TYPES], ['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
})

// --- 发送门禁 -----------------------------------------------------------------

test('18A send: 纯文本（无附件）可发；空文本 + 无附件不可发', () => {
  assert.equal(canSendRound({ ...base, text: '你好' }), true)
  assert.equal(canSendRound({ ...base, text: '   ' }), false)
})

test('18A send: 只发图片（空文本 + ready 附件）可以发送', () => {
  assert.equal(canSendRound({ ...base, text: '', attachments: [attachment('ready')] }), true)
  assert.equal(canSendRound({ ...base, text: '看图', attachments: [attachment('ready')] }), true)
})

test('18A send: uploading / error 的草稿挡住整轮（哪怕有文本）', () => {
  assert.equal(canSendRound({ ...base, text: '看图', attachments: [attachment('uploading')] }), false)
  assert.equal(canSendRound({ ...base, text: '看图', attachments: [attachment('error', { error: 'x' })] }), false)
  assert.equal(
    canSendRound({ ...base, text: '看图', attachments: [attachment('ready'), attachment('uploading')] }),
    false,
    '一张没好就不能发',
  )
})

test('18A send: 生成中 / 本地提交中 / 上传中 / 未登录 一律不可发', () => {
  const ready = [attachment('ready')]
  assert.equal(canSendRound({ ...base, text: 'x', attachments: ready, busy: true }), false)
  assert.equal(canSendRound({ ...base, text: 'x', attachments: ready, attaching: true }), false)
  assert.equal(canSendRound({ ...base, text: 'x', attachments: ready, connection: 'login_required' }), false)
  assert.equal(canSendRound({ ...base, text: 'x', attachments: ready, connection: 'offline' }), false)
})

test('18A picker: 页面繁忙 / 上传中时不能再选图', () => {
  assert.equal(canPickAttachment({ pageBusy: false, attaching: false, attachments: [] }), true)
  assert.equal(canPickAttachment({ pageBusy: true, attaching: false, attachments: [] }), false)
  assert.equal(canPickAttachment({ pageBusy: false, attaching: true, attachments: [] }), false)
  assert.equal(
    canPickAttachment({ pageBusy: false, attaching: false, attachments: [attachment('uploading')] }),
    false,
    '一次只上传一张',
  )
  assert.equal(
    canPickAttachment({ pageBusy: false, attaching: false, attachments: [attachment('ready'), attachment('error')] }),
    true,
    '失败卡片不阻塞继续选图',
  )
})
