/** Browser-native single Pop-out, sharing Host state through ChatView. */
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { syncPopoutTheme } from './popout-theme.ts'
import { CompanionPopout } from './CompanionPopout.tsx'

/** Fixed window name keeps a single pop-out instance. */
const POPOUT_WINDOW_NAME = 'dsh-deepseek-companion-popout'

/** Initial pop-out size (position/size memory is a later phase). */
const POPOUT_WIDTH = 480
const POPOUT_HEIGHT = 720

let disposePresentation: (() => void) | null = null

let popupWindow: Window | null = null
let popupRoot: ReturnType<typeof createRoot> | null = null

/** True while a pop-out window exists and is still open. */
export function isPopupAlive(): boolean {
  return popupWindow !== null && !popupWindow.closed
}

function closePopout(): void {
  disposePresentation?.()
  disposePresentation = null
  if (popupRoot !== null) {
    try {
      popupRoot.unmount()
    } catch {
      // The window may already be gone; unmount is best-effort here.
    }
    popupRoot = null
  }
  if (popupWindow !== null && !popupWindow.closed) {
    popupWindow.close()
  }
  popupWindow = null
}

/** Build the detached document and mount the shared state view. */
function renderPopout(win: Window): void {
  const doc = win.document
  doc.title = 'DeepSeek Companion'

  doc.documentElement.style.cssText = 'height:100%;margin:0'
  doc.body.style.cssText = 'height:100%;margin:0;overflow:hidden;background:var(--dsw-alias-bg-base)'

  const stopSync = syncPopoutTheme(window, win)
  const onPageHide = () => closePopout()
  win.addEventListener('pagehide', onPageHide)
  disposePresentation = () => {
    stopSync()
    win.removeEventListener('pagehide', onPageHide)
  }

  const container = doc.createElement('div')
  container.style.cssText = 'height:100%'
  doc.body.appendChild(container)

  popupRoot = createRoot(container)
  popupRoot.render(createElement(CompanionPopout, { onClose: closePopout, origin: window.location.origin }))
}

/**
 * Open (or focus) the single Companion pop-out window. `window.open` is called
 * synchronously inside the click handler so the pop-up is not blocked.
 */
export function openPopout(): void {
  const existing = popupWindow
  if (existing !== null && !existing.closed) {
    existing.focus()
    return
  }
  // Drop stale references left by a manually closed window.
  closePopout()

  const win = window.open(
    'about:blank',
    POPOUT_WINDOW_NAME,
    `width=${POPOUT_WIDTH},height=${POPOUT_HEIGHT},resizable=yes,scrollbars=yes`,
  )
  if (win === null) {
    console.warn('[dsh-deepseek-companion] pop-out window was blocked')
    return
  }
  popupWindow = win
  try {
    renderPopout(win)
  } catch (error) {
    console.warn('[dsh-deepseek-companion] failed to render pop-out', error)
    closePopout()
  }
}

/** Close the pop-out and drop all references (plugin dispose / parent unload). */
export function disposePopout(): void {
  closePopout()
}
