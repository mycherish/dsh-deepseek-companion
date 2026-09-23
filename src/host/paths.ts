/**
 * DeepSeek Harness home / profile path resolution (Phase 07A).
 *
 * DSH boot anchors `ctx.baseUrl` at the current profile directory
 * (`$DSH_HOME/profiles/<name>/`), which is a public Cordis context field. We
 * use it to isolate the browser profile per DSH profile by default, while
 * keeping `DEEPSEEK_COMPANION_PROFILE` as an explicit override for tests.
 */
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Resolve the DeepSeek Harness home directory from `$DSH_HOME` or `~/.dsh`. */
export function resolveDshHome(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.DSH_HOME
  const base = fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : join(homedir(), '.dsh')
  if (base === '~') return homedir()
  if (base.startsWith('~/')) return resolve(join(homedir(), base.slice(2)))
  return resolve(base)
}

/**
 * Resolve the plugin-owned DeepSeek browser profile directory.
 *
 * Priority, highest first:
 * 1. `DEEPSEEK_COMPANION_PROFILE` — explicit override (tests / custom deploy).
 * 2. `<profileDir>/deepseek-companion-browser` — per-profile isolation, derived
 *    from `ctx.baseUrl` so `web` and `companion-test` never share a profile.
 * 3. `$DSH_HOME/deepseek-companion-browser` — fallback when `baseUrl` is absent
 *    (e.g. a composition the DSH CLI did not boot).
 */
export function browserProfileDir(env: NodeJS.ProcessEnv = process.env, baseUrl?: string): string {
  const override = env.DEEPSEEK_COMPANION_PROFILE
  if (override !== undefined && override.trim().length > 0) return resolve(override)

  const profileDir = profileDirFromBaseUrl(baseUrl)
  if (profileDir !== undefined) return join(profileDir, 'deepseek-companion-browser')

  return join(resolveDshHome(env), 'deepseek-companion-browser')
}

/**
 * Resolve the plugin-owned attachment temp directory (Phase 18A).
 *
 * Same priority as `browserProfileDir`, one directory over:
 * 1. `DEEPSEEK_COMPANION_UPLOADS` — explicit override (tests / custom deploy).
 * 2. `<profileDir>/deepseek-companion-uploads` — per-profile isolation, so the
 *    `web` and `companion-test` profiles never share draft files.
 * 3. `$DSH_HOME/deepseek-companion-uploads` — fallback when `baseUrl` is absent.
 */
export function attachmentUploadDir(env: NodeJS.ProcessEnv = process.env, baseUrl?: string): string {
  const override = env.DEEPSEEK_COMPANION_UPLOADS
  if (override !== undefined && override.trim().length > 0) return resolve(override)

  const profileDir = profileDirFromBaseUrl(baseUrl)
  if (profileDir !== undefined) return join(profileDir, 'deepseek-companion-uploads')

  return join(resolveDshHome(env), 'deepseek-companion-uploads')
}

/** Convert `ctx.baseUrl` (a profile directory `file://` URL) to a filesystem path. */
function profileDirFromBaseUrl(baseUrl: string | undefined): string | undefined {
  if (baseUrl === undefined || baseUrl.length === 0) return undefined
  try {
    const path = fileURLToPath(baseUrl)
    return path.length > 0 ? path : undefined
  } catch {
    return undefined
  }
}
