import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import { CompanionDock } from './CompanionDock.tsx'
import { CompanionEntry } from './CompanionEntry.tsx'
import { CompanionFloat } from './CompanionFloat.tsx'
import { disposePopout, openPopout as openPopoutWindow } from './popout.ts'
import { overlayStorage, readOverlayWidth, writeOverlayWidth } from './storage.ts'

/** Cordis services the browser plugin requires before `apply`. */
export const inject = ['slots', 'layout', 'sessions']

/** The surface a Companion dock currently occupies. */
export type CompanionSurface = 'rightbar' | 'overlay' | 'float'

/**
 * Minimal shared UI state for the Companion dock.
 *
 * The surface is decided once per open: a non-blank session uses the official
 * `rightbar` column (the conversation genuinely narrows); a blank session falls
 * back to the frame-wide `shell.overlay` (root scope, available with no session
 * content). The surface stays stable until close, so the UI never jumps between
 * rightbar and overlay mid-session.
 */
export interface DockController {
  isOpen(): boolean
  surface(): CompanionSurface | null
  dockWidth(): number
  setDockWidth(px: number): void
  /** Persist the current overlay width (no-op on rightbar / when closed). */
  commitOverlayWidth(): void
  /** Open (or focus) the single Companion pop-out window. */
  openPopout(): void
  /** Report the rightbar surface as open (called after the dock mounts). */
  openRightbarSurface(): void
  /** Switch from the docked surface to the in-page floating window. */
  enterFloat(): void
  /** Switch from the floating window back to the docked surface. */
  dockBack(): void
  subscribe(listener: () => void): () => void
  toggle(): void
  open(): void
  close(): void
}

/** Read the current session's blank flag through the official `ISessions.list` read face. */
function currentSessionBlank(ctx: Context): boolean | null {
  try {
    const list = ctx.sessions.list.getSnapshot()
    const current = list.current
    if (current === undefined) return null
    return list.byId[current]?.blank ?? null
  } catch {
    return null
  }
}

function createDockController(ctx: Context): DockController {
  let open = false
  let surface: CompanionSurface | null = null
  let disposer: (() => void) | null = null
  // Read the persisted overlay preference once at client init; running width
  // stays in memory and is only written back on resize end.
  let dockWidth = readOverlayWidth(overlayStorage(), window.innerWidth)
  const listeners = new Set<() => void>()
  const emit = () => {
    for (const listener of listeners) listener()
  }

  /** Docked surface for the current session: non-blank → rightbar, else overlay. */
  const decideDockSurface = (): CompanionSurface =>
    currentSessionBlank(ctx) === false ? 'rightbar' : 'overlay'

  const unmount = (): void => {
    if (disposer) {
      disposer()
      disposer = null
    }
  }

  /** Register the given surface. Throws on failure; callers reset state. */
  const mount = (variant: CompanionSurface): void => {
    if (variant === 'rightbar') {
      // Transiently shadow the shipped right Sidebar (same pattern as the old
      // `details` seat); disposing the registration restores it untouched.
      disposer = ctx.slots.register(
        { name: 'rightbar', priority: -1, inject: () => ({ dock: controller, variant }) },
        CompanionDock,
      )
      // `openRightbar` is reported from CompanionDock's mount effect instead of
      // here: shadowing ui-sidebar-right unmounts its RightbarSeat, whose
      // cleanup reports `shown: false` (closeRightbar) and would overwrite a
      // synchronous open in this same tick.
    } else if (variant === 'overlay') {
      disposer = ctx.slots.register(
        { name: 'shell.overlay', id: 'deepseek-companion', order: 100, inject: () => ({ dock: controller, variant }) },
        CompanionDock,
      )
    } else {
      disposer = ctx.slots.register(
        { name: 'shell.overlay', id: 'deepseek-companion', order: 100, inject: () => ({ dock: controller, variant }) },
        CompanionFloat,
      )
    }
  }

  const openRightbarSurface = (): void => {
    try {
      // Normal docked presentation: reserve the grid track (conversation
      // narrows), fullscreen off. Arguments mirror ui-sidebar-right's own
      // `syncPresentation({ shown: true, track: true, fullscreen: false })`.
      ctx.layout.openRightbar(true, false)
    } catch (error) {
      console.warn('[dsh-deepseek-companion] failed to open rightbar', error)
    }
  }

  const closeRightbar = (): void => {
    try {
      ctx.layout.closeRightbar()
    } catch (error) {
      console.warn('[dsh-deepseek-companion] failed to close rightbar', error)
    }
  }

  const controller: DockController = {
    isOpen: () => open,
    surface: () => surface,
    dockWidth: () => dockWidth,
    setDockWidth(px) {
      if (dockWidth === px) return
      dockWidth = px
      emit()
    },
    commitOverlayWidth() {
      // Only the overlay is Companion-owned; rightbar width is DSH's.
      if (surface !== 'overlay') return
      writeOverlayWidth(overlayStorage(), dockWidth)
    },
    openPopout() {
      openPopoutWindow()
    },
    openRightbarSurface() {
      openRightbarSurface()
    },
    enterFloat() {
      if (!open || surface === 'float') return
      const activeSurface = surface
      if (activeSurface === 'rightbar') closeRightbar()
      unmount()
      surface = 'float'
      try {
        mount('float')
      } catch (error) {
        open = false
        surface = null
        console.warn('[dsh-deepseek-companion] failed to open float window', error)
        emit()
        return
      }
      emit()
    },
    dockBack() {
      if (!open || surface !== 'float') return
      unmount()
      surface = decideDockSurface()
      try {
        mount(surface)
      } catch (error) {
        open = false
        surface = null
        console.warn('[dsh-deepseek-companion] failed to dock companion', error)
        emit()
        return
      }
      emit()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    open() {
      if (open) return
      open = true
      // Decide once: non-blank → rightbar (narrows); blank/unknown → overlay (always available).
      surface = decideDockSurface()
      try {
        mount(surface)
      } catch (error) {
        open = false
        surface = null
        console.warn('[dsh-deepseek-companion] failed to open companion', error)
        emit()
        return
      }
      emit()
    },
    close() {
      if (!open) return
      open = false
      const activeSurface = surface
      surface = null
      if (activeSurface === 'rightbar') closeRightbar()
      unmount()
      emit()
    },
    toggle() {
      if (open) controller.close()
      else controller.open()
    },
  }
  return controller
}

/**
 * DeepSeek Companion browser half.
 *
 * Only the sidebar entry is registered at load. On open the dock transiently
 * occupies `rightbar` (non-blank session) or `shell.overlay` (blank session),
 * and disposes that registration on close — the shipped right Sidebar and the
 * overlay roster both recover untouched.
 */
export function apply(ctx: Context): void {
  const dock = createDockController(ctx)

  // The pop-out is a local UI shell owned by the Client plugin: it closes when
  // the plugin disposes or the parent page unloads.
  ctx.effect(() => {
    const onPageHide = () => disposePopout()
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      disposePopout()
    }
  })

  ctx.slots.inject('sidebar.footer.action', () => {
    return ctx.slots.register(
      {
        name: 'sidebar.footer.action',
        id: 'deepseek-companion',
        order: 1000,
        inject: () => ({ dock }),
      },
      CompanionEntry,
    )
  })
}
