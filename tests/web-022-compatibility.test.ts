import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('Web compatibility admits the verified targets without admitting untested prereleases or Desktop', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.deepEqual(manifest.engines.dsh.split(' || '), ['0.1.5-rc.2', '0.2.1-rc.2', '0.2.2-rc.1'])
  assert.equal(manifest.dsh.client.platform, 'web')
})
