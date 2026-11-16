import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { after, before, test } from 'node:test'
import type { RecoverySettlement } from '../src/host/recovery-settlement.ts'
import type { DeepSeekBrowser } from '../src/host/browser.ts'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const output = mkdtempSync(join(tmpdir(), 'companion-browser-test-'))
const require = createRequire(import.meta.url)
let source: string
before(() => {
  execFileSync(
    'pnpm',
    [
      'exec',
      'tsdown',
      'src/host/browser.ts',
      '--no-config',
      '--deps.never-bundle',
      'playwright',
      '--format',
      'cjs',
      '--no-dts',
      '--out-dir',
      output,
    ],
    {
      cwd: root,
      stdio: 'pipe',
      timeout: 30_000,
    },
  )
  source = readFileSync(join(output, 'browser.cjs'), 'utf8')
})
after(() => rmSync(output, { recursive: true, force: true }))

class Page extends EventEmitter {
  location = 'https://chat.deepseek.com/a/chat/s/owned-session'
  closed = false
  probe: (() => Promise<unknown>) | undefined
  redirectTo: string | undefined
  frame = { url: () => this.location }
  url() {
    return this.location
  }
  mainFrame() {
    return this.frame
  }
  isClosed() {
    return this.closed
  }
  async evaluate(_fn: unknown, input: unknown) {
    if (input === '/api/v0/users/current') return this.probe?.() ?? { code: 0, id: 'test-user' }
    return { available: true, enabled: false }
  }
  async goto(url: string) {
    if (this.location === 'about:blank') this.emit('framenavigated', this.frame)
    this.location = this.redirectTo ?? url
    this.emit('framenavigated', this.frame)
    this.emit('load')
  }
  async waitForLoadState() {}
  async waitForSelector() {}
  async close() {
    this.closed = true
    this.emit('close')
  }
}

async function mount(
  options?: {
    mode: 'background' | 'login'
    initialSessionId?: string
    onLoginWindowClosed?: () => void
  },
  setup?: (page: Page) => void,
) {
  const launchOptions: Array<{ headless?: boolean; channel?: string }> = []
  const initial = new Page()
  setup?.(initial)
  const locations: unknown[] = []
  const settlements: RecoverySettlement[] = []
  const pages = [initial]
  const statuses: string[] = []
  const recovering: boolean[] = []
  let replacements = 0
  let disposed = false
  const events = new EventEmitter()
  const context = Object.assign(events, {
    pages: () => [initial],
    exposeFunction: async () => {},
    browser: () => ({ isConnected: () => !disposed, on() {} }),
    async newPage() {
      const next = new Page()
      next.location = 'about:blank'
      pages.push(next)
      return next
    },
    async close() {
      disposed = true
      events.emit('close')
    },
  })
  let recoveryLaunch: Promise<typeof context> | undefined
  const module = {
    exports: {} as { createDeepSeekBrowser: typeof import('../src/host/browser.ts').createDeepSeekBrowser },
  }
  runInNewContext(source, {
    module,
    exports: module.exports,
    Buffer,
    URL,
    console,
    setTimeout,
    clearTimeout,
    require: (id: string) =>
      id === 'playwright'
        ? {
            chromium: {
              launchPersistentContext: async (_dir: string, config: { headless?: boolean; channel?: string }) => {
                launchOptions.push(config)
                if (launchOptions.length > 1 && recoveryLaunch) return recoveryLaunch
                disposed = false
                return context
              },
            },
          }
        : require(id),
  })
  const create = module.exports.createDeepSeekBrowser as (...args: unknown[]) => Promise<DeepSeekBrowser>
  const browser: DeepSeekBrowser = await create(
    'test-profile',
    (s: string) => statuses.push(s),
    undefined,
    undefined,
    (location: unknown) => locations.push(location),
    () => {
      replacements++
    },
    {
      getRecoverTarget: () => ({ kind: 'session', id: 'owned-session' }),
      onRecovering: (s: boolean) => recovering.push(s),
      onSettled: (s: RecoverySettlement) => {
        settlements.push(s)
      },
    },
    options,
  )
  await browser.check()
  statuses.length = 0
  return {
    browser,
    initial,
    pages,
    statuses,
    recovering,
    replacements: () => replacements,
    launchOptions,
    contextEvents: events,
    context,
    deferRecoveryLaunch(promise: Promise<typeof context>) {
      recoveryLaunch = promise
    },
    locations,
    settlements,
  }
}

for (const url of ['about:blank', 'https://example.test/unusable', 'https://chat.deepseek.com.example.test/']) {
  test(`invalid main-frame navigation recovers without a subsequent route: ${url}`, async () => {
    const h = await mount()
    try {
      await h.initial.goto(url)
      await new Promise<void>((resolve) => setImmediate(resolve))
      assert.ok(
        h.recovering.includes(true),
        'invalid navigation must start recovery before the UI can become unavailable',
      )
      await h.browser.ensureReady()
      assert.equal(h.pages.length, 2)
      assert.equal(h.replacements(), 1)
      assert.equal(h.pages[1]!.url(), 'https://chat.deepseek.com/a/chat/s/owned-session')
      assert.deepEqual(h.recovering, [true, false])
      assert.equal(h.statuses.at(-1), 'logged_in')
    } finally {
      await h.browser.dispose()
    }
  })
}

test('iframe, normal session and login navigation do not start recovery; disposed page events stay inert', async () => {
  const h = await mount()
  h.initial.emit('framenavigated', { url: () => 'about:blank' })
  await h.initial.goto('https://chat.deepseek.com/a/chat/s/another-session')
  await h.initial.goto('https://chat.deepseek.com/sign_in')
  assert.deepEqual(h.recovering, [])
  await h.browser.dispose()
  await h.initial.goto('about:blank')
  h.initial.emit('crash')
  assert.deepEqual(h.recovering, [])
  assert.equal(h.pages.length, 1)
})

test('a late login probe from a replaced page cannot overwrite recovered status', async () => {
  const h = await mount()
  let fail!: (reason: Error) => void
  h.initial.probe = () =>
    new Promise((_resolve, reject) => {
      fail = reject
    })
  h.initial.emit('load')
  h.initial.emit('crash')
  await h.browser.ensureReady()
  assert.equal(h.statuses.at(-1), 'logged_in')
  fail(new Error('old page closed'))
  await new Promise<void>((resolve) => setImmediate(resolve))
  try {
    assert.equal(h.statuses.at(-1), 'logged_in')
  } finally {
    await h.browser.dispose()
  }
})

test('a login probe finishing after dispose publishes nothing', async () => {
  const h = await mount()
  let fail!: (reason: Error) => void
  h.initial.probe = () =>
    new Promise((_resolve, reject) => {
      fail = reject
    })
  h.initial.emit('load')
  await h.browser.dispose()
  fail(new Error('disposed page'))
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.deepEqual(h.statuses, [])
})

test('a genuine current-page login probe error remains visible', async () => {
  const h = await mount()
  h.initial.probe = async () => {
    throw new Error('current page failed')
  }
  h.initial.emit('load')
  await new Promise<void>((resolve) => setImmediate(resolve))
  try {
    assert.equal(h.statuses.at(-1), 'error')
  } finally {
    await h.browser.dispose()
  }
})

test('background mode uses the full matched Chromium without a visible window, including context recovery', async () => {
  const h = await mount({ mode: 'background' })
  try {
    assert.equal(h.launchOptions[0]?.headless, true)
    assert.equal(h.launchOptions[0]?.channel, 'chromium')
    h.contextEvents.emit('close')
    await h.browser.ensureReady()
    assert.equal(h.launchOptions.length, 2)
    assert.equal(h.launchOptions[1]?.headless, true)
    assert.equal(h.launchOptions[1]?.channel, 'chromium')
  } finally {
    await h.browser.dispose()
  }
})

test('explicit login mode keeps the visible browser for manual authentication', async () => {
  const h = await mount({ mode: 'login' })
  try {
    assert.equal(h.launchOptions[0]?.headless, false)
  } finally {
    await h.browser.dispose()
  }
})

test('explicit login window close is reported once and never starts a visible recovery', async () => {
  let closed = 0
  const h = await mount({
    mode: 'login',
    onLoginWindowClosed: () => {
      closed++
    },
  })
  try {
    await h.initial.close()
    h.contextEvents.emit('close')
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(closed, 1)
    assert.equal(h.launchOptions.length, 1)
    assert.deepEqual(h.recovering, [])
  } finally {
    await h.browser.dispose()
  }
})

test('intentional mode replacement restores the Host-owned conversation during check', async () => {
  const h = await mount({ mode: 'background', initialSessionId: 'restored-session' })
  try {
    assert.equal(h.initial.url(), 'https://chat.deepseek.com/a/chat/s/restored-session')
  } finally {
    await h.browser.dispose()
  }
})

test('intentional restore redirected home preserves uncertainty instead of reporting an external clear', async () => {
  const h = await mount({ mode: 'background', initialSessionId: 'missing-session' }, (page) => {
    page.redirectTo = 'https://chat.deepseek.com/'
  })
  try {
    assert.deepEqual(h.locations, [])
    assert.equal(h.settlements.length, 1)
    assert.equal(h.settlements[0]!.target.kind, 'session')
    assert.equal(h.settlements[0]!.location.kind, 'empty')
    assert.equal(h.settlements[0]!.history, 'unknown')
  } finally {
    await h.browser.dispose()
  }
})

test('dispose waits for a pending Level 3 constructor and closes its late context', async () => {
  const h = await mount({ mode: 'background' })
  let release!: (value: typeof h.context) => void
  const pending = new Promise<typeof h.context>((r) => {
    release = r
  })
  let lateClosed = 0
  const late = {
    ...h.context,
    async close() {
      lateClosed++
    },
  }
  h.deferRecoveryLaunch(pending)
  h.contextEvents.emit('close')
  await new Promise<void>((r) => setImmediate(r))
  assert.equal(h.launchOptions.length, 2)
  let finished = false
  const closing = h.browser.dispose().then(() => {
    finished = true
  })
  await new Promise<void>((r) => setImmediate(r))
  try {
    assert.equal(finished, false, 'dispose must not release the profile while a constructor can still own it')
    release(late)
    await closing
    assert.equal(lateClosed, 1)
    assert.deepEqual(h.statuses, [])
  } finally {
    release(late)
    await closing
    await new Promise<void>((r) => setImmediate(r))
    await h.browser.dispose()
  }
})
