import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { CompanionEntry } from './CompanionEntry.tsx'

/** Cordis services the browser plugin requires before `apply`. */
export const inject = ['slots']

/**
 * DeepSeek Companion browser half.
 *
 * Phase 03 mounts only a minimal sidebar footer entry. No Dock, chat, browser
 * automation, or business logic is implemented yet.
 */
export function apply(ctx: Context): void {
  try {
    ctx.slots.inject('sidebar.footer.action', () => {
      return ctx.slots.register(
        {
          name: 'sidebar.footer.action',
          id: 'deepseek-companion',
          order: 1000,
        },
        CompanionEntry,
      )
    })
  } catch (error) {
    // Never crash the Web Client because an optional UI slot is unavailable.
    console.warn('[dsh-deepseek-companion] client UI slot unavailable', error)
  }
}
