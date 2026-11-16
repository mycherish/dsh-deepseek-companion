import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
const read = (file: string): string => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
test('renamed package and client registration agree while stable identity remains', () => {
  const pkg = JSON.parse(read('package.json'))
  assert.equal(pkg.name, 'dsh-chat-buddy')
  assert.match(read('cordis.patch.yml'), /name: 'dsh-chat-buddy'/)
  assert.match(read('cordis.patch.yml'), /id: deepseek-companion/)
  assert.ok(read('tsdown.client.config.ts').includes('id: "dsh-chat-buddy"'))
  assert.match(read('src/index.ts'), /export const name = 'deepseek-companion'/)
  assert.match(read('src/host/paths.ts'), /deepseek-companion-browser/)
  assert.match(read('src/client/storage.ts'), /dsh-deepseek-companion:overlay-width/)
  assert.match(read('src/client/popout.ts'), /dsh-deepseek-companion-popout/)
})
test('all visible surfaces use the new brand', () => {
  for (const file of [
    'CompanionDock.tsx',
    'CompanionEntry.tsx',
    'CompanionFloat.tsx',
    'CompanionPopout.tsx',
    'popout.ts',
  ]) {
    const source = read(`src/client/${file}`)
    // The sidebar uses a localized action label; window titles retain the product brand.
    if (file !== 'CompanionEntry.tsx') assert.match(source, /DSH Chat Buddy/)
    assert.doesNotMatch(source, /DeepSeek Companion/)
  }
})
