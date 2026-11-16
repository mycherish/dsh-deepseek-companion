import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import type { DeepSeekBrowser, createDeepSeekBrowser } from '../src/host/browser.ts'
import { createCompanionStateStore } from '../src/host/state.ts'

// Runs the real Host wiring, session coordinator, page guard and reconciliation;
// only the external browser boundary is replaced. No Chromium or remote sends.
test('returning from login reconciles under the transition lock before allowing sends', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'companion-restore-lock-'))
  const store = createCompanionStateStore()
  store.setCurrentSession({ id: 'owned-session', title: 'Owned' })
  const user = store.appendChatMessage('user', 'question')
  const assistant = store.appendChatMessage('assistant', 'partial')
  store.applyChatReconcile({
    bindings: [
      { hostId: user.id, deepSeekMessageId: 1 },
      { hostId: assistant.id, deepSeekMessageId: 2 },
    ],
  })
  let changedOnServer = false
  let readingChangedHistory = false
  let releaseHistory!: () => void
  let historyStarted!: () => void
  const historyPending = new Promise<void>((resolve) => {
    releaseHistory = resolve
  })
  const started = new Promise<void>((resolve) => {
    historyStarted = resolve
  })
  const createBrowser: typeof createDeepSeekBrowser = async (
    _profile,
    onStatus,
    _think,
    _search,
    _location,
    _replaced,
    recovery,
    options,
  ) =>
    ({
      async check() {
        onStatus('logged_in')
        if (options?.initialSessionId) {
          recovery?.onMarkKnown?.({ kind: 'session', id: options.initialSessionId })
          await recovery?.onSettled?.({
            status: 'logged_in',
            target: { kind: 'session', id: options.initialSessionId },
            location: { kind: 'session', id: options.initialSessionId },
            history: 'found',
          })
        }
        return 'logged_in'
      },
      ensureReady: async () => 'logged_in',
      showLogin: async () => {
        onStatus('logged_in')
      },
      async readHistorySnapshot() {
        if (changedOnServer) {
          readingChangedHistory = true
          historyStarted()
          await historyPending
        }
        return {
          current: () => true,
          read: {
            kind: 'snapshot',
            sessionId: 'owned-session',
            currentMessageId: 2,
            messages: [
              {
                messageId: 1,
                parentId: null,
                role: 'USER',
                status: 'FINISHED',
                requestText: 'question',
                responseText: null,
                reasoningText: null,
                files: [],
              },
              {
                messageId: 2,
                parentId: 1,
                role: 'ASSISTANT',
                status: 'FINISHED',
                requestText: null,
                responseText: changedOnServer ? 'partial complete' : 'partial',
                reasoningText: null,
                files: [],
              },
            ],
          },
        }
      },
      listSessions: async () => [],
      dispose: async () => {},
    }) satisfies Pick<
      DeepSeekBrowser,
      'check' | 'ensureReady' | 'showLogin' | 'readHistorySnapshot' | 'listSessions' | 'dispose'
    > as unknown as DeepSeekBrowser

  const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8')
  const modules = new Map<string, unknown>()
  for (const match of source.matchAll(/from ['"](.+?)['"]/g)) {
    const id = match[1]!
    if (id.startsWith('.')) modules.set(id, await import(new URL(`../src/${id}`, import.meta.url).href))
  }
  modules.set('./host/browser.ts', { createDeepSeekBrowser: createBrowser })
  modules.set('./host/state.ts', { createCompanionStateStore: () => store })
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const module = { exports: {} as { apply(context: unknown): void } }
  runInNewContext(compiled, {
    module,
    exports: module.exports,
    require: (id: string) => {
      assert(modules.has(id), `unexpected dependency ${id}`)
      return modules.get(id)
    },
    process: { env: {} },
    Response,
    console,
    setTimeout,
    clearTimeout,
  })
  const routes = new Map<string, (request: Request) => Promise<Response>>()
  const cleanup: Array<() => unknown> = []
  const call = (path: string) =>
    routes.get(`/api/deepseek-companion/${path}`)!(
      new Request(`http://localhost/api/deepseek-companion/${path}`, { method: 'POST' }),
    )
  let finishing: Promise<Response> | undefined
  try {
    module.exports.apply({
      baseUrl: pathToFileURL(`${directory}/`).href,
      connection: {
        fetch: {
          register(route: { path: string; fetch: (request: Request) => Promise<Response> }) {
            routes.set(route.path, route.fetch)
            return () => routes.delete(route.path)
          },
        },
      },
      effect(effect: () => unknown) {
        const dispose = effect()
        if (typeof dispose === 'function') cleanup.push(dispose as () => unknown)
      },
    })
    assert.equal((await call('browser/start')).status, 200)
    assert.equal((await call('browser/show')).status, 200)
    changedOnServer = true
    store.markSessionUnverified('owned-session')
    finishing = call('browser/background')
    await Promise.race([started, finishing])
    assert.equal(readingChangedHistory, true, 'return must read server history instead of skipping the held guard')
    assert.equal(store.getState().browserSession?.mode, 'switching')
    assert.equal((await call('chat')).status, 503, 'sends remain blocked while restoration owns the page')
    releaseHistory()
    assert.equal((await finishing).status, 200)
    const state = store.getState()
    assert.equal(state.browserSession?.mode, 'background')
    assert.equal(state.recoveryNotice, null)
    assert.equal(state.chat.messages[1]!.id, assistant.id)
    assert.equal(state.chat.messages[1]!.content, 'partial complete')
    assert.equal(state.chat.messages.length, 2)
    assert.equal((await call('browser/show')).status, 200, 'page guard must be released after restoration')
  } finally {
    releaseHistory()
    await finishing
    for (const dispose of cleanup.reverse()) dispose()
    store.dispose()
    await new Promise<void>((resolve) => setImmediate(resolve))
    await rm(directory, { recursive: true, force: true })
  }
})
