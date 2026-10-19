import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  outDir: 'lib',
  clean: true,
  platform: 'node',
  // 输出 .js / .d.ts（而非 .mjs / .d.mts），与 package.json 的 main/types 对齐。
  fixedExtension: false,
  // Playwright is a large native dependency; keep it external so the Host
  // bundle stays small and resolves it from the profile's node_modules.
  deps: {
    neverBundle: ['playwright'],
  },
})
