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
})
