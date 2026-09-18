/**
 * DeepSeek login-state detection from the "current user" API (Phase 07A fix).
 *
 * We stopped treating a non-empty `localStorage.userToken` as "logged in",
 * because chat.deepseek.com now issues an anonymous/device token to visitors
 * (and on some machines a local WeChat client can auto-authorize). Instead we
 * call DeepSeek's own `GET /api/v0/users/current` and read the server's
 * authoritative answer.
 *
 * Security: this module only ever receives the minimal signal `{ code, id }`
 * extracted from the response — never the user token or any personal data. The
 * token stays inside the browser page context where it is used as the request
 * credential.
 */
import type { DeepSeekStatus } from '../shared/state.ts'

/** Minimal, token-free signal extracted from `/api/v0/users/current`. */
export interface CurrentUserSignal {
  code?: unknown
  id?: unknown
}

/**
 * Map the extracted `{ code, id }` signal to a login state.
 *
 * Observed `/api/v0/users/current` responses:
 * - logged in:  `{ code: 0, data: { biz_data: { id: "<uuid>", ... } } }`
 * - logged out: `{ code: 40002, msg: "Missing Token", data: null }`
 *
 * Only the stable, server-owned user id decides `logged_in`; any non-zero
 * `code` without a user id means the server rejected the session (`logged_out`).
 * Anything unparseable is `error`.
 */
export function loginStatusFromCurrentUser(signal: unknown): DeepSeekStatus {
  if (typeof signal !== 'object' || signal === null) return 'error'
  const { code, id } = signal as CurrentUserSignal
  if (typeof id === 'string' && id.length > 0) return 'logged_in'
  if (typeof code === 'number' && code !== 0) return 'logged_out'
  return 'error'
}
