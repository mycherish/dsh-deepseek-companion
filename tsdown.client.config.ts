import { defineConfig } from 'tsdown'

// Browser client bundle: a lazy-CJS factory registered through the DSH
// `window.__ModuleLoader__` table. The host serves this artifact at
// `/plugins/dsh-deepseek-companion/client.js`.
//
// The factory scope provides `module`/`exports` (declared in the banner), so
// tsdown's CJS body can assign `exports.apply` / `exports.inject` and the
// footer can `return module.exports`.
export default defineConfig({
  entry: { client: 'src/client/index.ts' },
  format: ['cjs'],
  dts: true,
  outDir: 'lib',
  clean: false,
  platform: 'browser',
  // Force `.js` / `.d.ts` (not `.cjs` / `.d.cts`) to match package.json exports.
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  // Only wrap the JS artifact; keep the .d.ts a clean declaration file.
  banner: {
    js:
      'window.__ModuleLoader__.load({ id: "dsh-deepseek-companion", factory: (require) => {\n' +
      'var module = { exports: {} };\n' +
      'var exports = module.exports;',
  },
  footer: { js: 'return module.exports;\n}});' },
})
