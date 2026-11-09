import assert from 'node:assert/strict'
import test from 'node:test'
import { syncPopoutTheme } from '../src/client/popout-theme.ts'

function fixture() {
  const values = new Map<string, string>([
    ['--dsw-alias-bg-base', '#fff'],
    ['--dsw-alias-label-primary', '#111'],
    ['--dsw-alias-border-l2', '#ddd'],
    ['--ds-font-family-code', 'monospace'],
    ['--dsh-content-font-size', '16px'],
  ])
  const targetValues = new Map<string, string>()
  const style = {
    setProperty: (key: string, value: string) => targetValues.set(key, value),
    removeProperty: (key: string) => targetValues.delete(key),
  }
  let change = () => {}
  let disconnected = false
  const mediaListeners = new Set<() => void>()
  const computed = {
    fontFamily: 'system-ui',
    fontSize: '16px',
    color: '#111',
    backgroundColor: '#fff',
    colorScheme: 'light',
    get length() {
      return values.size
    },
    item: (i: number) => [...values.keys()][i],
    getPropertyValue: (key: string) => values.get(key) ?? '',
  }
  const source = {
    document: { documentElement: {}, body: {} },
    getComputedStyle: () => computed,
    MutationObserver: class {
      constructor(callback: () => void) {
        change = callback
      }
      observe() {}
      disconnect() {
        disconnected = true
      }
    },
    matchMedia: () => ({
      addEventListener: (_name: string, listener: () => void) => mediaListeners.add(listener),
      removeEventListener: (_name: string, listener: () => void) => mediaListeners.delete(listener),
    }),
  }
  const target = { document: { documentElement: { style }, body: { style: {} } } }
  return {
    source,
    target,
    values,
    targetValues,
    computed,
    change: () => change(),
    mediaListeners,
    disconnected: () => disconnected,
  }
}

test('Pop-out 初始化继承 body 上解析后的主题、字体和字号', () => {
  const f = fixture()
  const dispose = syncPopoutTheme(f.source as unknown as Window, f.target as unknown as Window)
  assert.equal(f.targetValues.get('--dsw-alias-border-l2'), '#ddd')
  assert.equal(f.targetValues.get('--dsh-content-font-size'), '16px')
  assert.equal((f.target.document.body.style as Record<string, string>).fontFamily, 'system-ui')
  dispose()
})

test('已打开窗口同步主题字体变化、移除过时 token，dispose 后不再更新', () => {
  const f = fixture()
  const dispose = syncPopoutTheme(f.source as unknown as Window, f.target as unknown as Window)
  f.values.set('--dsw-alias-bg-base', '#151517')
  f.values.delete('--dsw-alias-border-l2')
  f.computed.fontFamily = 'serif'
  f.change()
  assert.equal(f.targetValues.get('--dsw-alias-bg-base'), '#151517')
  assert.equal(f.targetValues.has('--dsw-alias-border-l2'), false)
  assert.equal((f.target.document.body.style as Record<string, string>).fontFamily, 'serif')
  assert.equal(f.mediaListeners.size, 1)
  dispose()
  dispose()
  assert.equal(f.disconnected(), true)
  assert.equal(f.mediaListeners.size, 0)
  f.values.set('--dsw-alias-bg-base', '#fff')
  f.change()
  assert.equal(f.targetValues.get('--dsw-alias-bg-base'), '#151517')
})
