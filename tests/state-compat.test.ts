import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeCompanionState } from '../src/client/api.ts'

/**
 * Phase 08.2 兼容层测试：Client 对 Host 状态的归一化。
 *
 * 1. 新形态（connection / currentSession / composer / message.status）原样保留；
 * 2. 旧形态（只有 deepseek + chat）也能被升级：统一字段由旧字段派生，
 *    绝不会出现 undefined（否则视图渲染会崩）；
 * 3. 垃圾输入降级为初始态，不抛异常。
 */

/** 一个 08.2 之前的 Host 会推出来的状态（无统一字段）。 */
function legacyState(): Record<string, unknown> {
  return {
    status: 'ready',
    revision: 7,
    instanceId: 'legacy-host',
    deepseek: {
      status: 'logged_in',
      deepThink: { available: true, enabled: true },
      search: { available: true, enabled: false },
    },
    chat: {
      sending: true,
      messages: [
        { id: 'm1', role: 'user', content: '你好', format: 'text' },
        {
          id: 'm2',
          role: 'assistant',
          content: '# 标题',
          format: 'markdown',
          reasoning: { content: '思考', format: 'text' },
          citations: [{ marker: 1, url: 'https://a.com', domain: 'a.com' }],
        },
      ],
    },
  }
}

test('兼容层: 旧状态被升级 —— connection 由 deepseek 派生，composer 由 chat 派生', () => {
  const state = normalizeCompanionState(legacyState())

  assert.equal(state.deepseek.status, 'logged_in')
  assert.deepEqual(
    state.connection,
    { status: 'online', browserReady: true },
    '旧状态没有 browserReady 事实 → 只要在推登录状态就认为浏览器存在（error 除外）',
  )
  assert.equal(state.composer.sending, true, 'composer.sending 回退到 chat.sending')
  assert.equal(state.composer.stopping, false)
  assert.deepEqual(state.composer.deepThink, { available: true, enabled: true })
  assert.deepEqual(state.composer.search, { available: true, enabled: false })
  assert.deepEqual(state.currentSession, { id: null, title: null }, '旧状态没有会话字段 → 空会话而不是 undefined')
})

test('兼容层: 旧消息被补上 status=finished（迁移不丢字段）', () => {
  const state = normalizeCompanionState(legacyState())

  assert.equal(state.chat.messages.length, 2)
  assert.equal(state.chat.messages[0]!.status, 'finished')
  assert.equal(state.chat.messages[1]!.status, 'finished')
  assert.equal(state.chat.messages[1]!.sessionId, undefined)
  assert.deepEqual(state.chat.messages[1]!.reasoning, { content: '思考', format: 'text' })
  assert.deepEqual(state.chat.messages[1]!.citations, [{ marker: 1, url: 'https://a.com', domain: 'a.com' }])
})

test('兼容层: 新状态原样保留（统一字段优先，不再回退）', () => {
  const payload = {
    status: 'ready',
    revision: 12,
    instanceId: 'host-1',
    connection: { status: 'online', browserReady: true },
    currentSession: { id: 'a1', title: '会话 A' },
    deepseek: {
      status: 'logged_in',
      deepThink: { available: false, enabled: false },
      search: { available: false, enabled: false },
    },
    composer: {
      sending: false,
      stopping: true,
      deepThink: { available: true, enabled: true },
      search: { available: true, enabled: true },
    },
    chat: {
      sending: false,
      messages: [
        { id: 'm2', role: 'assistant', content: '部分回答', format: 'text', status: 'interrupted', sessionId: 'a1' },
      ],
    },
  }

  const state = normalizeCompanionState(payload)

  assert.deepEqual(state.connection, { status: 'online', browserReady: true })
  assert.deepEqual(state.currentSession, { id: 'a1', title: '会话 A' })
  assert.deepEqual(state.composer.deepThink, { available: true, enabled: true })
  assert.equal(state.composer.stopping, true)
  assert.equal(state.chat.messages[0]!.status, 'interrupted')
  assert.equal(state.chat.messages[0]!.sessionId, 'a1')
})

test('兼容层: 垃圾输入降级为初始态（不抛、不产生 undefined 字段）', () => {
  for (const input of [null, undefined, 42, 'nope', {}, { deepseek: null, chat: 'x', composer: 7 }]) {
    const state = normalizeCompanionState(input)
    assert.equal(state.status, 'ready')
    assert.equal(state.deepseek.status, 'checking')
    assert.deepEqual(state.connection, { status: 'offline', browserReady: false })
    assert.deepEqual(state.currentSession, { id: null, title: null })
    assert.deepEqual(state.composer, {
      sending: false,
      stopping: false,
      deepThink: { available: false, enabled: false },
      search: { available: false, enabled: false },
      attachments: [],
    })
    assert.deepEqual(state.chat, { messages: [], sending: false })
  }
})

test('兼容层: 丢弃形状不对的消息，保留可用的（坏数据不拖垮整个视图）', () => {
  const state = normalizeCompanionState({
    status: 'ready',
    chat: {
      sending: false,
      messages: [
        { id: 'ok', role: 'user', content: '保留', format: 'text' },
        { id: '', role: 'user', content: '没有 id', format: 'text' },
        { id: 'm3', role: 'system', content: '角色不对', format: 'text' },
        { id: 'm4', role: 'assistant', content: 42, format: 'text' },
      ],
    },
  })

  assert.deepEqual(state.chat.messages.map((message) => message.id), ['ok'])
})

test('兼容层: 同一份 Host 状态在三个 surface 上归一化结果完全相同（三界面一致）', () => {
  const payload = legacyState()

  const dock = normalizeCompanionState(payload)
  const float = normalizeCompanionState(payload)
  const popout = normalizeCompanionState(payload)

  assert.deepEqual(dock, float)
  assert.deepEqual(float, popout)
  // 并且两个投影同源：composer 的开关就是 deepseek 里的那对值。
  assert.deepEqual(dock.composer.deepThink, dock.deepseek.deepThink)
  assert.deepEqual(dock.composer.search, dock.deepseek.search)
})

// --- Phase 18A: attachment metadata -------------------------------------------

/** A Host state that carries a draft attachment and a sent one. */
function attachmentState(): Record<string, unknown> {
  return {
    status: 'ready',
    revision: 3,
    instanceId: 'host-1',
    deepseek: { status: 'logged_in', deepThink: { available: false, enabled: false }, search: { available: false, enabled: false } },
    composer: {
      sending: false,
      stopping: false,
      deepThink: { available: false, enabled: false },
      search: { available: false, enabled: false },
      attachments: [
        { id: 'att-1', kind: 'image', name: 'a.png', mimeType: 'image/png', bytes: 1024, status: 'ready' },
        { id: 'att-2', kind: 'image', name: 'b.png', mimeType: 'image/jpeg', bytes: 2048, status: 'error', error: 'upload failed' },
      ],
    },
    chat: {
      sending: false,
      messages: [
        {
          id: 'm1',
          role: 'user',
          content: '看这两张',
          format: 'text',
          attachments: [
            { id: 'att-1', kind: 'image', name: 'a.png', mimeType: 'image/png', bytes: 1024 },
            { id: 'att-2', kind: 'image', name: 'b.png' },
          ],
        },
      ],
    },
  }
}

test('18A 兼容层: 旧 Host 没有附件字段 → 空草稿、消息无 attachments（不是 undefined）', () => {
  const state = normalizeCompanionState(legacyState())

  assert.deepEqual(state.composer.attachments, [])
  assert.equal(state.chat.messages[0]!.attachments, undefined)
})

test('18A 兼容层: 附件元数据原样保留（草稿带 status，已发送带 name/bytes）', () => {
  const state = normalizeCompanionState(attachmentState())

  assert.deepEqual(state.composer.attachments, [
    { id: 'att-1', kind: 'image', name: 'a.png', mimeType: 'image/png', bytes: 1024, status: 'ready' },
    {
      id: 'att-2',
      kind: 'image',
      name: 'b.png',
      mimeType: 'image/jpeg',
      bytes: 2048,
      status: 'error',
      error: 'upload failed',
    },
  ])
  assert.deepEqual(state.chat.messages[0]!.attachments, [
    { id: 'att-1', kind: 'image', name: 'a.png', mimeType: 'image/png', bytes: 1024 },
    { id: 'att-2', kind: 'image', name: 'b.png' },
  ])
})

test('18A 兼容层: 垃圾附件条目被丢弃，可用条目保留（坏数据不拖垮视图）', () => {
  const state = normalizeCompanionState({
    status: 'ready',
    composer: {
      attachments: [
        { id: 'ok', name: 'ok.png', mimeType: 'image/png', bytes: 10, status: 'uploading' },
        { id: '', name: 'no-id.png', status: 'ready' },
        { name: 'no-id-at-all.png', status: 'ready' },
        null,
        'nope',
      ],
    },
    chat: {
      messages: [
        {
          id: 'm1',
          role: 'user',
          content: 'hi',
          format: 'text',
          attachments: [{ id: 'a', kind: 'image', name: 'a.png' }, { id: '' }, 42],
        },
      ],
    },
  })

  assert.deepEqual(state.composer.attachments, [
    { id: 'ok', kind: 'image', name: 'ok.png', mimeType: 'image/png', bytes: 10, status: 'uploading' },
  ])
  assert.deepEqual(state.chat.messages[0]!.attachments, [{ id: 'a', kind: 'image', name: 'a.png' }])
})

test('18A 兼容层: 未知附件字段不会进入 Client 状态（无像素、无 blob URL、无 Host 路径）', () => {
  const state = normalizeCompanionState({
    status: 'ready',
    composer: {
      attachments: [
        {
          id: 'att-1',
          kind: 'image',
          name: 'a.png',
          mimeType: 'image/png',
          bytes: 1024,
          status: 'ready',
          // A Host from the future (or a hostile one) may send these — they must not survive.
          dataBase64: 'AAAA',
          previewUrl: 'blob:https://chat.deepseek.com/abc',
          tempPath: '/tmp/att-1.png',
          deepSeekFileId: 'file-123',
        },
      ],
    },
  })

  const attachment = state.composer.attachments[0]!
  assert.deepEqual(Object.keys(attachment).sort(), ['bytes', 'id', 'kind', 'mimeType', 'name', 'status'])
  const payload = JSON.stringify(state.composer.attachments)
  assert.equal(payload.includes('dataBase64'), false)
  assert.equal(payload.includes('blob:'), false)
  assert.equal(payload.includes('tempPath'), false)
})

test('18A 兼容层: 三界面归一化出完全相同的附件元数据', () => {
  const payload = attachmentState()

  const dock = normalizeCompanionState(payload)
  const float = normalizeCompanionState(payload)
  const popout = normalizeCompanionState(payload)

  assert.deepEqual(dock.composer.attachments, float.composer.attachments)
  assert.deepEqual(float.composer.attachments, popout.composer.attachments)
  assert.deepEqual(dock.chat.messages[0]!.attachments, popout.chat.messages[0]!.attachments)
})

test('20A 兼容层: 新 Host 的 connection.status=recovering 原样保留（不降级）', () => {
  const state = normalizeCompanionState({
    status: 'ready',
    revision: 9,
    instanceId: 'host-1',
    connection: { status: 'recovering', browserReady: true },
    deepseek: { status: 'error', deepThink: { available: false, enabled: false }, search: { available: false, enabled: false } },
    composer: { sending: false, stopping: false, deepThink: { available: false, enabled: false }, search: { available: false, enabled: false } },
    chat: { sending: false, messages: [] },
  })

  // recovering 属于白名单 → 不退回 deepseek 派生（否则会变成 offline）。
  assert.deepEqual(state.connection, { status: 'recovering', browserReady: true })
})

test('20B1 兼容层: deepSeekMessageId 原样保留（identity 不丢）', () => {
  const state = normalizeCompanionState({
    status: 'ready',
    revision: 3,
    instanceId: 'host-1',
    connection: { status: 'online', browserReady: true },
    deepseek: {
      status: 'logged_in',
      deepThink: { available: false, enabled: false },
      search: { available: false, enabled: false },
    },
    composer: {
      sending: false,
      stopping: false,
      deepThink: { available: false, enabled: false },
      search: { available: false, enabled: false },
    },
    chat: {
      sending: false,
      messages: [
        { id: 'h1', role: 'user', content: 'q', format: 'text', status: 'finished', deepSeekMessageId: 5 },
        { id: 'h2', role: 'assistant', content: 'a', format: 'text', status: 'finished', deepSeekMessageId: 6 },
      ],
    },
  })

  assert.equal(state.chat.messages[0]!.deepSeekMessageId, 5)
  assert.equal(state.chat.messages[1]!.deepSeekMessageId, 6)
})

test('20B1 兼容层: 旧 Host 无 deepSeekMessageId → 字段缺失（不是 0 / null）', () => {
  const state = normalizeCompanionState({
    status: 'ready',
    revision: 4,
    instanceId: 'host-1',
    connection: { status: 'online', browserReady: true },
    deepseek: {
      status: 'logged_in',
      deepThink: { available: false, enabled: false },
      search: { available: false, enabled: false },
    },
    composer: {
      sending: false,
      stopping: false,
      deepThink: { available: false, enabled: false },
      search: { available: false, enabled: false },
    },
    chat: { sending: false, messages: [{ id: 'h1', role: 'user', content: 'q', format: 'text' }] },
  })

  assert.equal(state.chat.messages[0]!.deepSeekMessageId, undefined)
  assert.equal('deepSeekMessageId' in state.chat.messages[0]!, false)
})
