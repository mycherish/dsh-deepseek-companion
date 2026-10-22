import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { after, before, test } from 'node:test'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const output = mkdtempSync(join(tmpdir(), 'companion-dock-test-'))
const require = createRequire(import.meta.url)
let source: string

before(() => {
  // Exercise the shipped client/controller without mounting a React tree. Build
  // into a test-owned directory, so bare `pnpm test` needs no existing lib/.
  execFileSync('pnpm', ['exec', 'tsdown', '--config', 'tsdown.client.config.ts', '--no-dts', '--out-dir', output], {
    cwd: root,
    stdio: 'pipe',
    timeout: 30_000,
  })
  source = readFileSync(join(output, 'client.js'), 'utf8')
})
after(() => rmSync(output, { recursive: true, force: true }))

interface Dock {
  open(): void
  close(): void
  surface(): string | null
}

function mount(readSnapshot: () => unknown) {
  let plugin: { apply(ctx: unknown): void } | undefined
  let dock: Dock | undefined
  let activeSurface: string | undefined
  const cleanups: (() => void)[] = []
  const window = {
    innerWidth: 1440,
    localStorage: { getItem: () => null },
    addEventListener() {},
    removeEventListener() {},
    __ModuleLoader__: {
      load({ factory }: { factory(require: NodeJS.Require): typeof plugin }) {
        plugin = factory(require)
      },
    },
  }
  runInNewContext(source, { window, console, URL, TextDecoder, TextEncoder, AbortController, setTimeout, clearTimeout })
  assert.ok(plugin)
  plugin.apply({
    sessions: { list: { getSnapshot: readSnapshot } },
    effect(setup: () => () => void) {
      cleanups.push(setup())
    },
    layout: { closeRightbar() {} },
    slots: {
      inject(_name: string, setup: () => void) {
        setup()
      },
      register(options: { name: string; inject(): { dock: Dock } }) {
        if (options.name === 'sidebar.footer.action') dock = options.inject().dock
        else activeSurface = options.name
        return () => {
          activeSurface = undefined
        }
      },
    },
  })
  assert.ok(dock)
  return {
    dock,
    activeSurface: () => activeSurface,
    dispose() {
      for (const cleanup of cleanups) cleanup()
    },
  }
}

const fixtures = [
  { name: 'legacy non-blank current', snapshot: { current: 'a', byId: { a: { blank: false } } }, want: 'rightbar' },
  { name: 'legacy blank current', snapshot: { current: 'a', byId: { a: { blank: true } } }, want: 'overlay' },
  {
    name: 'modern non-blank main view',
    snapshot: { byId: { a: { id: 'a', blank: false, retainedBy: { mainView: 1 } } } },
    want: 'rightbar',
  },
  {
    name: 'modern blank main view',
    snapshot: { byId: { a: { id: 'a', blank: true, retainedBy: { mainView: 1 } } } },
    want: 'overlay',
  },
  {
    name: 'background catalog order does not decide the selected Session',
    snapshot: {
      byId: {
        background: { id: 'background', blank: true, retainedBy: { popout: 1 } },
        main: { id: 'main', blank: false, retainedBy: { mainView: 1 } },
      },
    },
    want: 'rightbar',
  },
  {
    name: 'a released main view is not selected',
    snapshot: { byId: { a: { id: 'a', blank: false, retainedBy: { mainView: 0 } } } },
    want: 'overlay',
  },
  {
    name: 'invalid main view counts are not ownership evidence',
    snapshot: {
      byId: {
        a: { id: 'a', blank: false, retainedBy: { mainView: '1' } },
        b: { id: 'b', blank: false, retainedBy: { mainView: Infinity } },
      },
    },
    want: 'overlay',
  },
  {
    name: 'background retained Session is not the main view',
    snapshot: { byId: { a: { id: 'a', blank: false, retainedBy: { popout: 1 } } } },
    want: 'overlay',
  },
  {
    name: 'ambiguous main views do not guess a Session',
    snapshot: {
      byId: {
        a: { id: 'a', blank: false, retainedBy: { mainView: 1 } },
        b: { id: 'b', blank: false, retainedBy: { mainView: 1 } },
      },
    },
    want: 'overlay',
  },
  {
    name: 'explicit legacy absence does not reuse retained state',
    snapshot: { current: undefined, byId: { a: { id: 'a', blank: false, retainedBy: { mainView: 1 } } } },
    want: 'overlay',
  },
  {
    name: 'modern missing blank remains unknown',
    snapshot: { byId: { a: { id: 'a', retainedBy: { mainView: 1 } } } },
    want: 'overlay',
  },
]

for (const { name, snapshot, want } of fixtures) {
  test(`Dock DSH compatibility: ${name}`, (t) => {
    const view = mount(() => snapshot)
    t.after(view.dispose)
    view.dock.open()
    assert.equal(view.dock.surface(), want)
    assert.equal(view.activeSurface(), want === 'rightbar' ? 'rightbar' : 'shell.overlay')
    view.dock.close()
    assert.equal(view.activeSurface(), undefined)
  })
}

test('Dock DSH compatibility: choose once per open; reopening reads the new main view', (t) => {
  let blank = false
  const view = mount(() => ({ byId: { a: { id: 'a', blank, retainedBy: { mainView: 1 } } } }))
  t.after(view.dispose)
  view.dock.open()
  assert.equal(view.dock.surface(), 'rightbar')
  blank = true
  view.dock.open()
  assert.equal(view.dock.surface(), 'rightbar')
  view.dock.close()
  view.dock.open()
  assert.equal(view.dock.surface(), 'overlay')
  view.dock.close()
})

test('Dock DSH compatibility: unavailable list safely uses overlay', (t) => {
  const view = mount(() => {
    throw new Error('Session list is not available')
  })
  t.after(view.dispose)
  view.dock.open()
  assert.equal(view.dock.surface(), 'overlay')
  view.dock.close()
})
