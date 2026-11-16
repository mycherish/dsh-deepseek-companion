import assert from 'node:assert/strict'
import test from 'node:test'
import type { DeepSeekBrowser } from '../src/host/browser.ts'
import { createCompanionStateStore } from '../src/host/state.ts'
import { canSwitchBrowserMode, createBrowserSession } from '../src/host/browser-session.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}
function harness() {
  const events: string[] = []
  const checks: Array<() => boolean> = []
  let allowed = true
  let loggedIn = true
  let held = false
  let delayed: Promise<void> | undefined
  const session = createBrowserSession({
    claim() {
      if (held || !allowed) return false
      held = true
      return true
    },
    release() {
      held = false
    },
    onMode(mode) {
      events.push(mode)
    },
    async create(mode, isCurrent) {
      events.push(`create:${mode}`)
      checks.push(isCurrent)
      if (delayed) await delayed
      return {
        check: async () => (loggedIn ? 'logged_in' : 'logged_out'),
        ensureReady: async () => {
          events.push('ensure')
          return loggedIn ? 'logged_in' : 'logged_out'
        },
        showLogin: async () => {
          events.push('show')
        },
        dispose: async () => {
          events.push(`dispose:${mode}`)
        },
      } as unknown as DeepSeekBrowser
    },
  })
  return {
    session,
    events,
    checks,
    setAllowed(v: boolean) {
      allowed = v
    },
    setLogin(v: boolean) {
      loggedIn = v
    },
    delay(p: Promise<void>) {
      delayed = p
    },
  }
}

test('startup is idle; concurrent activation starts one background instance', async () => {
  const h = harness()
  assert.equal(h.session.mode(), 'idle')
  assert.deepEqual(h.events, [])
  const [a, b] = await Promise.all([h.session.activate(), h.session.activate()])
  assert.ok(a)
  assert.equal(a, b)
  assert.equal(h.events.filter((e) => e === 'create:background').length, 1)
  assert.equal(h.session.mode(), 'background')
  assert.equal(h.session.isCurrent(a), true)
  await h.session.dispose()
})

test('only explicit login opens a visible engine; close old context before reusing its profile', async () => {
  const h = harness()
  await h.session.activate()
  const old = h.checks[0]!
  assert.equal(await h.session.showLogin(), true)
  assert.equal(old(), false)
  assert(h.events.indexOf('dispose:background') < h.events.indexOf('create:login'))
  assert.equal(h.session.mode(), 'login')
  assert.equal(h.events.filter((e) => e === 'show').length, 1)
  assert.equal(await h.session.finishLogin(), true)
  assert(h.events.indexOf('dispose:login') < h.events.lastIndexOf('create:background'))
  assert.equal(h.session.mode(), 'background')
  await h.session.dispose()
})

test('busy page or attachments refuse mode changes without closing the engine', async () => {
  const h = harness()
  await h.session.activate()
  h.setAllowed(false)
  assert.equal(await h.session.showLogin(), false)
  assert.equal(h.events.filter((e) => e.startsWith('dispose:')).length, 0)
  assert.equal(h.session.mode(), 'background')
  await h.session.dispose()
})

test('unfinished login stays visible; manual close returns to background without requiring login', async () => {
  const h = harness()
  h.setLogin(false)
  assert.equal(await h.session.showLogin(), true)
  assert.equal(await h.session.finishLogin(), false)
  assert.equal(h.session.mode(), 'login')
  await h.session.loginClosed()
  assert.equal(h.session.mode(), 'background')
  assert.equal(h.events.filter((e) => e === 'create:login').length, 1)
  await h.session.dispose()
})

test('dispose during a delayed launch destroys the late engine and never reopens', async () => {
  const h = harness()
  const wait = deferred<void>()
  h.delay(wait.promise)
  const start = h.session.activate()
  await Promise.resolve()
  const dispose = h.session.dispose()
  wait.resolve()
  await dispose
  assert.equal(await start, null)
  assert.equal(h.checks[0]!(), false)
  assert.equal(h.events.filter((e) => e === 'dispose:background').length, 1)
  assert.equal(await h.session.activate(), null)
  assert.equal(await h.session.showLogin(), false)
})

test('an in-flight page request pins the context until completion', async () => {
  const h = harness()
  await h.session.activate()
  const wait = deferred<void>()
  const request = h.session.use(async () => {
    await wait.promise
    return 'done'
  })
  assert.equal(await h.session.showLogin(), false)
  assert.equal(h.session.mode(), 'background')
  wait.resolve()
  assert.equal(await request, 'done')
  assert.equal(await h.session.showLogin(), true)
  assert.equal(await h.session.use(async () => 'must not run'), undefined)
  await h.session.dispose()
})

test('reopening an existing background session rechecks readiness without replacing a healthy context', async () => {
  const h = harness()
  await h.session.activate()
  await h.session.activate()
  assert.equal(h.events.filter((e) => e === 'ensure').length, 1)
  assert.equal(h.events.filter((e) => e === 'create:background').length, 1)
  await h.session.dispose()
})

test('recovery blocks login mode switching even before the Client receives its SSE update', () => {
  const store = createCompanionStateStore()
  store.setBrowserReady(true)
  store.setDeepSeekStatus('logged_in')
  assert.equal(canSwitchBrowserMode(store.getState()), true)
  store.setRecovering(true)
  assert.equal(canSwitchBrowserMode(store.getState()), false)
  store.setRecovering(false)
  assert.equal(canSwitchBrowserMode(store.getState()), true)
  store.dispose()
})
