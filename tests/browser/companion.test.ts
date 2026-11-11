import assert from 'node:assert/strict'
import { createServer, type ServerResponse } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import test from 'node:test'
import { build } from 'tsdown'
import { chromium, type Page } from 'playwright'

// Controlled Host-protocol fixture: no credentials, remote DeepSeek access or real sends.
test('FR-3 rendered interactions and detached window lifecycle', { timeout: 90000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'companion-ui-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await build({
    config: false,
    entry: { fixture: 'tests/browser/fixture.ts' },
    outDir: dir,
    platform: 'browser',
    format: 'esm',
    dts: false,
    deps: { alwaysBundle: [/.*/] },
    alias: Object.fromEntries(
      ['process', 'path', 'url'].map((n) => [`node:${n}`, resolve(`src/client/shims/node-${n}.ts`)]),
    ),
  })
  const js = await readFile(join(dir, 'fixture.js'))
  const peers = new Set<ServerResponse>()
  let chatPosts = 0
  let allowStreams = true
  let postError: string | null = null
  let sessionDelayMs = 0
  const mode = { available: true, enabled: false }
  const base = () => ({
    status: 'ready',
    revision: 1,
    instanceId: 'ui-fixture',
    deepseek: { status: 'logged_in', deepThink: mode, search: mode },
    connection: { status: 'online', browserReady: true },
    recoveryNotice: null,
    currentSession: { id: null, title: null },
    composer: { sending: false, stopping: false, deepThink: mode, search: mode, attachments: [] },
    chat: { sending: false, messages: [] },
  })
  let state: Record<string, unknown> = base()
  const publish = (next: Record<string, unknown>) => {
    state = next
    for (const res of peers) res.write(`data: ${JSON.stringify(state)}\n\n`)
  }
  const server = createServer((req, res) => {
    const path = req.url ?? '/'
    if (path === '/fixture.js') {
      res.setHeader('Content-Type', 'text/javascript')
      res.end(js)
      return
    }
    if (path.endsWith('/state/stream')) {
      if (!allowStreams) {
        res.statusCode = 503
        res.end()
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      peers.add(res)
      res.write(`data: ${JSON.stringify(state)}\n\n`)
      req.on('close', () => peers.delete(res))
      return
    }
    if (path.endsWith('/chat/sessions')) {
      res.setHeader('Content-Type', 'application/json')
      const reply = () =>
        res.end(
          JSON.stringify({
            sessions: [
              { id: 'one', title: '历史一', active: false },
              { id: 'two', title: '历史二', active: false },
            ],
          }),
        )
      if (sessionDelayMs > 0) setTimeout(reply, sessionDelayMs)
      else reply()
      return
    }
    if (path.startsWith('/api/')) {
      if (path.endsWith('/chat')) chatPosts++
      res.setHeader('Content-Type', 'application/json')
      if (postError !== null) {
        res.statusCode = 409
        res.end(JSON.stringify({ error: postError }))
        return
      }
      res.end(JSON.stringify({ reply: 'fixture', stopped: true }))
      return
    }
    res.setHeader('Content-Type', 'text/html')
    res.end(`<!doctype html><title>Companion UI fixture</title><style>
      body { margin:0; font-family:system-ui; --dsw-font-family:system-ui; --ds-font-family-code:monospace;
        --dsh-content-font-size:14px; --dsh-code-font-size:12px; --dsw-alias-bg-base:#fff;
        --dsw-alias-label-primary:#111; --dsw-alias-label-secondary:#666; --dsw-alias-border-l3:#ddd;
        --dsw-alias-border-l2:#ccc; --dsw-alias-interactive-bg-hover:#eee; --dsw-alias-interactive-bg-active:#ddd;
        color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-base); }
      @media(prefers-color-scheme:dark) { body { --dsw-alias-bg-base:#151517; --dsw-alias-label-primary:#fafafa; } }
    </style><div id="app"></div><script type="module" src="/fixture.js"></script>`)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  t.after(() => {
    server.closeAllConnections()
    server.close()
  })
  const address = server.address() as { port: number }
  const browser = await chromium.launch({ headless: true, channel: 'chromium' })
  t.after(() => browser.close())
  const context = await browser.newContext({ viewport: { width: 1100, height: 800 }, colorScheme: 'light' })
  const page = await context.newPage()
  const errors: string[] = []
  context.on('page', (p) => p.on('pageerror', (e) => errors.push(e.message)))
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`http://127.0.0.1:${address.port}/`)
  const input = (p: Page) => p.getByRole('textbox', { name: '输入消息', exact: true })
  await input(page).waitFor()

  await t.test('标题栏 hover / active 和输入区焦点提供实际视觉反馈', async () => {
    const button = page.getByRole('button', { name: 'Open DeepSeek Companion in new window', exact: true })
    await button.hover()
    await page.waitForFunction(
      () =>
        getComputedStyle(document.querySelector('[aria-label="Open DeepSeek Companion in new window"]')!)
          .backgroundColor === 'rgb(238, 238, 238)',
    )
    assert.equal(await button.evaluate((n) => getComputedStyle(n).backgroundColor), 'rgb(238, 238, 238)')
    await page.mouse.down()
    await page.waitForFunction(
      () =>
        getComputedStyle(document.querySelector('[aria-label="Open DeepSeek Companion in new window"]')!)
          .backgroundColor === 'rgb(221, 221, 221)',
    )
    assert.equal(await button.evaluate((n) => getComputedStyle(n).backgroundColor), 'rgb(221, 221, 221)')
    await page.mouse.move(10, 10)
    await page.mouse.up()
    await input(page).focus()
    assert.equal(
      await page.locator('[data-companion-input]').evaluate((n) => getComputedStyle(n).borderTopColor),
      'rgb(102, 102, 102)',
    )
  })
  await t.test('IME 不误发；普通 Enter 发送；错误提示不渲染调用栈', async () => {
    await input(page).fill('中文草稿')
    await input(page).dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, bubbles: true })
    await input(page).dispatchEvent('compositionstart', { bubbles: true })
    await input(page).dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: false, bubbles: true })
    await input(page).dispatchEvent('compositionend', { bubbles: true })
    assert.equal(chatPosts, 0)
    assert.equal(await input(page).inputValue(), '中文草稿')
    postError = 'locator.click: Timeout 30000ms exceeded.\nCall log:\nprivate diagnostic'
    await input(page).press('Enter')
    await page.getByRole('alert').filter({ hasText: '操作未完成' }).waitFor()
    assert.equal(chatPosts, 1)
    assert.equal(await page.getByText('private diagnostic').count(), 0)
    postError = null
  })
  await t.test('登录 / 检测 / 安装错误状态可见；断流保留草稿并禁用发送，重连后恢复', async () => {
    const s = base()
    publish({
      ...s,
      deepseek: { ...s.deepseek, status: 'logged_out' },
      connection: { status: 'login_required', browserReady: true },
    })
    await page.getByRole('button', { name: '登录 DeepSeek', exact: true }).waitFor()
    publish({ ...s, deepseek: { ...s.deepseek, status: 'checking' } })
    await page.getByText('检测中…', { exact: true }).waitFor()
    publish({
      ...s,
      deepseek: { ...s.deepseek, status: 'error' },
      connection: { status: 'offline', browserReady: false },
    })
    await page.getByText('检测失败', { exact: true }).waitFor()
    await page.getByRole('status').filter({ hasText: 'Chromium' }).waitFor()
    publish(s)
    await input(page).waitFor()
    await input(page).fill('断流保留草稿')
    allowStreams = false
    for (const peer of peers) peer.end()
    await page.getByRole('status').filter({ hasText: '已中断' }).waitFor()
    assert.equal(await page.getByRole('button', { name: '发送', exact: true }).isDisabled(), true)
    assert.equal(await input(page).inputValue(), '断流保留草稿')
    allowStreams = true
    await page.waitForFunction(
      () => !document.querySelector<HTMLButtonElement>('[data-companion-input] button:last-child')?.disabled,
    )
    assert.equal(await input(page).inputValue(), '断流保留草稿')
  })
  const pending = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Open DeepSeek Companion in new window', exact: true }).click()
  let popup = await pending
  await input(popup).waitFor()
  await t.test('Pop-out 跟随系统主题及已打开后的字体字号变化', async () => {
    const styles = (p: Page) =>
      p.locator('[data-companion-root]').evaluate((n) => {
        const s = getComputedStyle(n)
        return { font: s.fontFamily, size: s.fontSize, bg: s.backgroundColor, color: s.color }
      })
    assert.deepEqual(await styles(popup), await styles(page))
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.waitForTimeout(100)
    assert.equal((await styles(popup)).bg, 'rgb(21, 21, 23)')
    await page.evaluate(() => {
      document.body.style.setProperty('--dsw-font-family', 'serif')
      document.body.style.setProperty('--dsh-content-font-size', '20px')
      document.body.style.setProperty('--ds-font-family-code', 'serif')
    })
    await page.waitForTimeout(100)
    assert.equal((await styles(popup)).size, '20px')
    assert.equal((await styles(popup)).font, 'serif')
  })
  await t.test('Pop-out 自己的历史菜单支持箭头 / Esc / 点击外部，焦点返回', async () => {
    const button = popup.getByRole('button', { name: '历史会话', exact: true })
    sessionDelayMs = 200
    await button.click()
    await popup.getByRole('region').waitFor()
    await popup.keyboard.press('Escape')
    assert.equal(
      await button.evaluate((n) => n === n.ownerDocument.activeElement),
      true,
      'Escape while loading returns focus',
    )
    await popup.waitForTimeout(250)
    sessionDelayMs = 0
    await button.click()
    await popup.getByRole('button', { name: '历史一', exact: true }).waitFor()
    await popup.keyboard.press('ArrowDown')
    assert.equal(
      await popup
        .getByRole('button', { name: '历史一', exact: true })
        .evaluate((n) => n === n.ownerDocument.activeElement),
      true,
    )
    await input(popup).focus()
    await popup.keyboard.press('ArrowDown')
    assert.equal(
      await input(popup).evaluate((n) => n === n.ownerDocument.activeElement),
      true,
      'history must not steal editor arrow keys',
    )
    await popup.keyboard.press('Escape')
    assert.equal(await popup.getByRole('region').count(), 0)
    assert.equal(await button.evaluate((n) => n === n.ownerDocument.activeElement), true)
    await button.click()
    await popup.getByRole('region').waitFor()
    await input(popup).click()
    assert.equal(await popup.getByRole('region').count(), 0)
  })
  await t.test('三窗口状态门控；上传 / 删除 / 错误状态；Float 窄屏与减少动态效果', async () => {
    await input(page).fill('必须保留的草稿')
    const s = base()
    publish({ ...s, recoveryNotice: 'session_unverified' })
    for (const p of [page, popup]) {
      await p.getByRole('alert').filter({ hasText: '无法确认' }).waitFor()
      assert.equal(await p.getByRole('button', { name: '发送', exact: true }).isDisabled(), true)
    }
    await input(page).press('Enter')
    assert.equal(await input(page).inputValue(), '必须保留的草稿')
    assert.equal(chatPosts, 1)
    publish({ ...s, connection: { status: 'recovering', browserReady: false } })
    await page.getByRole('status').filter({ hasText: '正在恢复' }).waitFor()
    publish({ ...s, recoveryNotice: 'session_deleted' })
    await page.getByRole('status').filter({ hasText: '原会话已' }).waitFor()
    publish({
      ...s,
      composer: {
        ...s.composer,
        attachments: [{ id: 'image', name: 'fixture.png', mimeType: 'image/png', bytes: 128, status: 'uploading' }],
      },
    })
    await page.getByText(/fixture.png/).waitFor()
    assert.equal(await page.getByRole('button', { name: '发送', exact: true }).isDisabled(), true)
    publish({
      ...s,
      composer: {
        ...s.composer,
        attachments: [
          {
            id: 'failed',
            name: 'failed.png',
            mimeType: 'image/png',
            bytes: 256,
            status: 'error',
            // The Host stores the internal reason; the card must not show it.
            error: 'page.waitForResponse: Timeout 10000ms exceeded while waiting for event "response"',
          },
        ],
      },
    })
    await page.getByText('failed.png', { exact: true }).waitFor()
    await page.getByText('失败，请重试', { exact: false }).first().waitFor()
    assert.equal(await page.getByText(/waitForResponse/).count(), 0, 'internal error text leaked into the UI')
    // ...but it must still reach the card tooltip, or diagnosis is silently lost.
    assert.equal(await page.getByTitle(/waitForResponse/).count(), 1, 'diagnostic title lost')
    assert.equal(await page.getByRole('button', { name: '移除 failed.png', exact: true }).isEnabled(), true)
    assert.equal(await page.getByRole('button', { name: '发送', exact: true }).isDisabled(), true)
    publish({
      ...s,
      composer: {
        ...s.composer,
        attachments: [{ id: 'ready', name: 'ready.png', mimeType: 'image/png', bytes: 256, status: 'ready' }],
      },
    })
    await page.getByText('ready.png', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: '发送', exact: true }).isEnabled(), true)
    publish(s)
    await page.getByRole('button', { name: '在页面内浮动', exact: true }).click()
    await page.setViewportSize({ width: 390, height: 700 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const root = page.locator('[data-companion-root]')
    await root.waitFor()
    await page.waitForFunction(() => {
      const r = document.querySelector('[data-companion-root]')!.getBoundingClientRect()
      return r.x >= 0 && r.right <= 390
    })
    const rect = await root.boundingBox()
    assert.ok(rect && rect.x >= 0 && rect.x + rect.width <= 390)
    assert.equal(await root.evaluate((n) => getComputedStyle(n).animationName), 'none')
    assert.equal(await input(page).evaluate((n) => n.getBoundingClientRect().width > 50), true)
    publish({ ...s, recoveryNotice: 'session_unverified' })
    await page.getByRole('alert').filter({ hasText: '无法确认' }).waitFor()
    assert.equal(await page.getByRole('button', { name: '发送', exact: true }).isDisabled(), true)
    publish(s)
    await page.getByRole('button', { name: 'Dock DeepSeek Companion', exact: true }).click()
  })
  await t.test('用户阅读历史时流式更新不抢滚动；关闭重开 Pop-out 清理订阅', async () => {
    const s = base()
    const messages = Array.from({ length: 25 }, (_, i) => ({
      id: `m${i}`,
      role: 'assistant',
      format: 'markdown',
      status: 'finished',
      ...(i === 0 ? { reasoning: { format: 'text', content: '可折叠的思考内容' } } : {}),
      content: `${i} ${'正文 '.repeat(100)}\n\n\`\`\`python\n${'x'.repeat(300)}\n\`\`\``,
    }))
    publish({ ...s, chat: { sending: false, messages } })
    const list = page.locator('[data-companion-root] [data-companion-transcript]')
    await list.waitFor()
    await page.waitForTimeout(50)
    const thinking = page.getByText('思考过程', { exact: true })
    await thinking.click()
    assert.equal(
      await page
        .locator('details')
        .first()
        .evaluate((n) => (n as HTMLDetailsElement).open),
      false,
    )
    await thinking.click()
    assert.equal(
      await page
        .locator('details')
        .first()
        .evaluate((n) => (n as HTMLDetailsElement).open),
      true,
    )
    await list.evaluate((n) => {
      n.scrollTop = 100
      n.dispatchEvent(new Event('scroll', { bubbles: true }))
    })
    publish({
      ...s,
      revision: 2,
      chat: {
        sending: true,
        messages: [
          ...messages,
          { id: 'new', role: 'assistant', format: 'text', status: 'streaming', content: '新内容' },
        ],
      },
      composer: { ...s.composer, sending: true },
    })
    await page.getByRole('button', { name: '停止', exact: true }).waitFor()
    assert.equal(await list.evaluate((n) => n.scrollTop), 100)
    await popup.getByRole('button', { name: '停止', exact: true }).click()
    publish({ ...s, chat: { sending: true, messages }, composer: { ...s.composer, sending: true, stopping: true } })
    await page.getByRole('button', { name: '停止中…', exact: true }).waitFor()
    await popup.getByRole('button', { name: '停止中…', exact: true }).waitFor()
    publish({ ...s, chat: { sending: false, messages } })
    await page.getByRole('button', { name: '发送', exact: true }).waitFor()
    const root = page.locator('[data-companion-root]')
    assert.equal(await root.evaluate((n) => n.scrollWidth <= n.clientWidth), true)
    await popup.close()
    const next = page.waitForEvent('popup')
    await page.getByRole('button', { name: 'Open DeepSeek Companion in new window', exact: true }).click()
    popup = await next
    await input(popup).waitFor()
    const closed = popup.waitForEvent('close')
    await popup.getByRole('button', { name: 'Close DeepSeek Companion', exact: true }).click()
    await closed
    await page.waitForTimeout(100)
    assert.equal(peers.size, 1, 'closed popup unsubscribes its state stream')
  })
  assert.deepEqual(errors, [])
})
