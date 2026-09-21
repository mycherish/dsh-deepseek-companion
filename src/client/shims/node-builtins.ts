/**
 * Browser shims for the Node builtins the Markdown ecosystem reaches for
 * (Phase 07E).
 *
 * `vfile` (pulled in by react-markdown → unified) resolves `node:path`,
 * `node:process` and `node:url` through Node's `imports` conditions. When a
 * bundler picks those Node branches the client bundle ends up `require`-ing
 * `node:*`, which the DSH client module loader cannot resolve — the whole
 * plugin then fails to load.
 *
 * react-markdown never exercises those code paths in the browser, so minimal
 * no-op shims are enough. `tsdown.client.config.ts` aliases the three builtins
 * here.
 */

/** `node:process` shim. */
export const processShim = {
  env: {} as Record<string, string | undefined>,
  argv: [] as string[],
  platform: 'browser',
  version: '',
  versions: {} as Record<string, string>,
  cwd: (): string => '/',
  nextTick: (callback: (...args: unknown[]) => void, ...args: unknown[]): void => {
    queueMicrotask(() => callback(...args))
  },
}

/** `node:path` shim (POSIX-only; the browser always uses `/`). */
export const pathShim = {
  sep: '/',
  join: (...parts: string[]): string => parts.filter((part) => part !== '').join('/'),
  dirname: (value: string): string => value.slice(0, Math.max(0, value.lastIndexOf('/'))),
  basename: (value: string): string => value.slice(value.lastIndexOf('/') + 1),
  extname: (value: string): string => {
    const base = value.slice(value.lastIndexOf('/') + 1)
    const dot = base.lastIndexOf('.')
    return dot <= 0 ? '' : base.slice(dot)
  },
  normalize: (value: string): string => value,
  resolve: (...parts: string[]): string => parts.filter((part) => part !== '').join('/'),
  isAbsolute: (value: string): boolean => value.startsWith('/'),
}

/** `node:url` shim. */
export const urlShim = {
  fileURLToPath: (value: string | URL): string => String(value).replace(/^file:\/\//, ''),
  pathToFileURL: (value: string): URL => new URL(`file://${value}`),
}
