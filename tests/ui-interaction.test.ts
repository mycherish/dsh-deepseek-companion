import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldSubmitMessage, shouldFollowTranscript, uiErrorText } from '../src/client/ui-interaction.ts'

test('中文组合输入不发送，Shift+Enter 保留换行', () => {
  const enter = { key: 'Enter', shiftKey: false, isComposing: false }
  assert.equal(shouldSubmitMessage(enter), true)
  assert.equal(shouldSubmitMessage({ ...enter, isComposing: true }), false)
  assert.equal(shouldSubmitMessage({ ...enter, shiftKey: true }), false)
  assert.equal(shouldSubmitMessage({ ...enter, key: 'a' }), false)
})

test('只有接近底部才跟随新回复，阅读历史时保持位置', () => {
  assert.equal(shouldFollowTranscript({ scrollTop: 600, clientHeight: 400, scrollHeight: 1000 }), true)
  assert.equal(shouldFollowTranscript({ scrollTop: 580, clientHeight: 400, scrollHeight: 1000 }), true)
  assert.equal(shouldFollowTranscript({ scrollTop: 100, clientHeight: 400, scrollHeight: 1000 }), false)
})

test('底层页面调用栈转为可操作提示，业务拒绝原因仍可见', () => {
  assert.equal(
    uiErrorText('page.reload: Target page, context or browser has been closed\nCall log:\n...'),
    '操作未完成，请打开 DeepSeek 网页检查状态后重试。',
  )
  assert.equal(
    uiErrorText('locator.click: Timeout 30000ms exceeded.\nCall log:\n...'),
    '操作未完成，请打开 DeepSeek 网页检查状态后重试。',
  )
  assert.equal(uiErrorText('图片草稿与页面不一致，请新建聊天后重试'), '图片草稿与页面不一致，请新建聊天后重试')
})
