import type { Context } from '@deepseek-ai/cordis'

/** Cordis plugin id, referenced by the bundle patch to insert this plugin. */
export const name = 'deepseek-companion'

/**
 * DeepSeek Web Companion plugin entry point.
 *
 * Phase 01 installs only this minimal skeleton. No tools, routes, settings,
 * client modules, or browser automation are registered yet.
 */
export function apply(ctx: Context): void {
  console.log('[dsh-deepseek-companion] loaded')
}
