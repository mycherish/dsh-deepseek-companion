import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { marketInstallTarget, parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const draft = JSON.parse(readFileSync(new URL('../market/index.draft.json', import.meta.url), 'utf8'))
// This URL is a fixture for relative icon resolution, not a published market.
const fixtureUrl = 'https://market.example.test/companion/index.json'

test('市场草案通过官方校验，安装的精确版本与包内声明一致', () => {
  const market = parseMarketIndex(draft, fixtureUrl)
  assert.equal(market.plugins.length, 1)
  const plugin = market.plugins[0]!
  assert.equal(plugin.name, manifest.name)
  assert.equal(plugin.author, manifest.author)
  assert.equal(plugin.homepage, manifest.homepage)
  assert.equal(plugin.repository?.url, manifest.repository.url.replace(/^git\+/, '').replace(/\.git$/, ''))
  assert.equal(plugin.versions.length, 1)
  const version = plugin.versions[0]!
  assert.equal(version.version, manifest.version)
  assert.equal(version.engines.dsh, manifest.engines.dsh)
  assert.deepEqual(marketInstallTarget(plugin.name, version), {
    spec: `${manifest.name}@${manifest.version}`,
    registry: 'https://registry.npmjs.org/',
  })
})

test('市场图标与随包文件为同一资源，部署后按索引相对地址解析', () => {
  const market = parseMarketIndex(draft, fixtureUrl)
  const icon = market.plugins[0]!.icon
  assert.equal(icon, new URL('icons/companion.svg', fixtureUrl).href)
  assert.equal(manifest.icon, 'market/icons/companion.svg')
  assert.ok(manifest.files.includes(manifest.icon), '安装后的 DSH 必须能读取图标')
  const bytes = readFileSync(new URL(`../${manifest.icon}`, import.meta.url))
  assert.ok(bytes.length > 0 && bytes.length < 32 * 1024)
})

test('本地草案明确标记未发布，哨兵日期不能当成实际发布日期', () => {
  const market = parseMarketIndex(draft, fixtureUrl)
  const plugin = market.plugins[0]!
  assert.equal(plugin.versions[0]!.publishTimestamp, 0, '0 仅为本地草案哨兵，发布时必须替换')
  assert.match(JSON.stringify(market.description), /未发布/)
})
