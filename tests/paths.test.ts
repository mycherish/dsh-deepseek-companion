import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

import { browserProfileDir, resolveDshHome } from '../src/host/paths.ts'

test('resolveDshHome 默认返回 ~/.dsh', () => {
  assert.equal(resolveDshHome({}), join(homedir(), '.dsh'))
})

test('resolveDshHome 优先使用 DSH_HOME', () => {
  assert.equal(resolveDshHome({ DSH_HOME: '/tmp/custom-dsh' }), '/tmp/custom-dsh')
})

test('resolveDshHome 忽略空白 DSH_HOME', () => {
  assert.equal(resolveDshHome({ DSH_HOME: '   ' }), join(homedir(), '.dsh'))
})

test('resolveDshHome 展开 ~ 前缀', () => {
  assert.equal(resolveDshHome({ DSH_HOME: '~/mydsh' }), join(homedir(), 'mydsh'))
})

test('browserProfileDir 默认落在 DSH home 下', () => {
  assert.equal(browserProfileDir({}), join(homedir(), '.dsh', 'deepseek-companion-browser'))
})

test('browserProfileDir 跟随 DSH_HOME', () => {
  assert.equal(browserProfileDir({ DSH_HOME: '/tmp/custom-dsh' }), '/tmp/custom-dsh/deepseek-companion-browser')
})

test('browserProfileDir 优先 DEEPSEEK_COMPANION_PROFILE 覆盖', () => {
  assert.equal(browserProfileDir({ DEEPSEEK_COMPANION_PROFILE: '/tmp/test-profile' }), '/tmp/test-profile')
})

test('browserProfileDir 用 ctx.baseUrl（profile 目录）隔离', () => {
  const baseUrl = pathToFileURL('/tmp/.dsh/profiles/companion-test/').href
  assert.equal(
    browserProfileDir({}, baseUrl),
    join('/tmp', '.dsh', 'profiles', 'companion-test', 'deepseek-companion-browser'),
  )
})

test('不同 profile 的 baseUrl 得到不同目录（默认隔离）', () => {
  const a = browserProfileDir({}, pathToFileURL('/tmp/.dsh/profiles/web/').href)
  const b = browserProfileDir({}, pathToFileURL('/tmp/.dsh/profiles/companion-test/').href)
  assert.notEqual(a, b)
})

test('DEEPSEEK_COMPANION_PROFILE 覆盖优先于 baseUrl', () => {
  const baseUrl = pathToFileURL('/tmp/.dsh/profiles/companion-test/').href
  assert.equal(
    browserProfileDir({ DEEPSEEK_COMPANION_PROFILE: '/tmp/test-profile' }, baseUrl),
    '/tmp/test-profile',
  )
})

test('baseUrl 非法时回退到 DSH_HOME', () => {
  assert.equal(browserProfileDir({}, 'not-a-url'), join(homedir(), '.dsh', 'deepseek-companion-browser'))
})
