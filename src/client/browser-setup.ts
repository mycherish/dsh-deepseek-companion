import type { ConnectionState } from '../shared/state.ts'

/** A failed launch needs setup guidance; a running browser's network error does not. */
export function browserSetupHint(connection: ConnectionState): string | null {
  if (connection.status !== 'offline' || connection.browserReady) return null
  return '首次使用请先安装匹配的 Chromium：dsh plugin --profile <profile> exec playwright install chromium。用实际 profile 名替换 <profile>，完成后重启 DSH。若已安装，请检查 DSH 日志。'
}
