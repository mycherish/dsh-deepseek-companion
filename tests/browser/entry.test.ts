import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { build } from 'tsdown'
import { chromium } from 'playwright'

test('侧栏入口中文提示、原生主题几何与交互状态', { timeout: 45000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'companion-entry-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await build({
    config: false,
    entry: { entry: 'tests/browser/entry-fixture.ts' },
    outDir: dir,
    platform: 'browser',
    format: 'esm',
    dts: false,
    deps: { alwaysBundle: [/.*/] },
  })
  const js = await readFile(join(dir, 'entry.js'))
  const server = createServer((req, res) => {
    if (req.url === '/entry.js') {
      res.setHeader('Content-Type', 'text/javascript')
      res.end(js)
    } else {
      res.setHeader('Content-Type', 'text/html')
      res.end(`<!doctype html><title>Sidebar entry fixture</title><style>
        body { margin:20px; font-family:system-ui; background:#fff; color:#111;
          --dsw-radius-md:9px; --dsh-sidebar-row-padding:14px; --dsh-sidebar-paint-inset:3px;
          --dsh-sidebar-label-gap:8px; --dsw-alias-label-primary:#111;
          --dsw-alias-interactive-bg-hover:#eee; --dsw-alias-interactive-bg-active:#ddd;
          --dsw-focus-ring-color:#1567de; }
        @media(prefers-color-scheme:dark) { body { background:#151517; color:#fafafa;
          --dsw-alias-label-primary:#fafafa; --dsw-alias-interactive-bg-hover:#303036;
          --dsw-alias-interactive-bg-active:#45454c; } }
      </style><div id="app"></div><script type="module" src="/entry.js"></script>`)
    }
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  t.after(() => {
    server.closeAllConnections()
    server.close()
  })
  const browser = await chromium.launch({ channel: 'chromium' })
  t.after(() => browser.close())
  const context = await browser.newContext({ viewport: { width: 800, height: 600 } })
  const page = await context.newPage()
  const proofDir = process.env.COMPANION_UI_PROOF_DIR
  if (proofDir) await mkdir(proofDir, { recursive: true })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/`)
  const entry = page.locator('button[aria-expanded]')
  await entry.waitFor()
  assert.equal(await entry.getAttribute('title'), '打开快速聊天')
  assert.equal(await entry.getAttribute('aria-label'), '打开快速聊天')
  await entry.click()
  assert.equal(await entry.getAttribute('title'), '关闭快速聊天')
  assert.equal(await entry.getAttribute('aria-expanded'), 'true')
  assert.equal(await entry.evaluate((n) => n.matches(':focus-visible')), false)

  for (const colorScheme of ['light', 'dark'] as const) {
    await t.test(`${colorScheme} 展开与收起背景跟随宿主 token`, async () => {
      await page.emulateMedia({ colorScheme })
      for (const wide of [true, false]) {
        if (!wide) await page.getByRole('button', { name: '切换侧栏宽度' }).click()
        const geometry = await entry.evaluate((n) => {
          const s = getComputedStyle(n)
          return {
            width: n.getBoundingClientRect().width,
            radius: s.borderRadius,
            padding: s.paddingLeft,
            clip: s.backgroundClip,
          }
        })
        assert.equal(geometry.width, wide ? 280 : 36)
        assert.equal(geometry.radius, '9px')
        assert.equal(geometry.padding, wide ? '11px' : '0px')
        assert.equal(geometry.clip, wide ? 'padding-box' : 'border-box')
        await entry.hover()
        await page.waitForFunction(
          (color) => getComputedStyle(document.querySelector('button[aria-expanded]')!).backgroundColor === color,
          colorScheme === 'light' ? 'rgb(238, 238, 238)' : 'rgb(48, 48, 54)',
        )
        if (proofDir)
          await page.screenshot({ path: join(proofDir, `entry-${colorScheme}-${wide ? 'wide' : 'rail'}.png`) })
        await page.mouse.down()
        await page.waitForFunction(
          (color) => getComputedStyle(document.querySelector('button[aria-expanded]')!).backgroundColor === color,
          colorScheme === 'light' ? 'rgb(221, 221, 221)' : 'rgb(69, 69, 76)',
        )
        await page.mouse.up()
        await page.mouse.move(700, 500)
        await page.waitForFunction(
          () =>
            getComputedStyle(document.querySelector('button[aria-expanded]')!).backgroundColor === 'rgba(0, 0, 0, 0)',
        )
      }
      await page.getByRole('button', { name: '切换侧栏宽度' }).click()
    })
  }
  await t.test('键盘焦点可见，Enter 激活，减少动效生效', async () => {
    await page.keyboard.press('Shift+Tab')
    assert.equal(await entry.evaluate((n) => n === document.activeElement && n.matches(':focus-visible')), true)
    assert.equal(await entry.evaluate((n) => getComputedStyle(n).outlineWidth), '2px')
    const before = await entry.getAttribute('aria-expanded')
    await page.keyboard.press('Enter')
    assert.notEqual(await entry.getAttribute('aria-expanded'), before)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    assert.equal(await entry.evaluate((n) => getComputedStyle(n).transitionDuration), '0s')
  })
  await t.test('旧宿主缺少几何 token 时仍有可用回退', async () => {
    await page.addStyleTag({
      content:
        'body { --dsw-radius-md: initial; --dsh-sidebar-row-padding: initial; --dsh-sidebar-paint-inset: initial; }',
    })
    const style = await entry.evaluate((n) => {
      const s = getComputedStyle(n)
      return { radius: s.borderRadius, padding: s.paddingLeft, width: n.getBoundingClientRect().width }
    })
    assert.deepEqual(style, { radius: '12px', padding: '8px', width: 280 })
  })
  assert.deepEqual(errors, [])
})
