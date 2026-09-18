/**
 * Pop-out window shell (Phase 06A).
 *
 * DSH 0.1.5-rc.2 exposes no pop-out / detached-window API, so we use the
 * browser-native `window.open`. The pop-out is a local UI shell only: it renders
 * the same "Coming soon" placeholder through the host-provided React runtime
 * (`react-dom/client` from the module loader) and shares no state with the dock.
 * Its lifecycle belongs to the Client plugin: closing the dock never closes the
 * pop-out, but disposing the plugin or unloading the parent does.
 */
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { CompanionPopout } from './CompanionPopout.tsx'

/** Fixed window name keeps a single pop-out instance. */
const POPOUT_WINDOW_NAME = 'dsh-deepseek-companion-popout'

/** Initial pop-out size (position/size memory is a later phase). */
const POPOUT_WIDTH = 480
const POPOUT_HEIGHT = 720

/** DSH tokens copied from the parent so the pop-out matches the current theme. */
const POPOUT_TOKENS = [
  '--dsw-alias-bg-base',
  '--dsw-alias-border-l3',
  '--dsw-alias-label-primary',
  '--dsw-alias-label-secondary',
  '--dsw-alias-interactive-bg-hover',
  '--dsw-alias-interactive-bg-active',
] as const

let popupWindow: Window | null = null
let popupRoot: ReturnType<typeof createRoot> | null = null

/** True while a pop-out window exists and is still open. */
export function isPopupAlive(): boolean {
  return popupWindow !== null && !popupWindow.closed
}

function closePopout(): void {
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

/** Copy the parent's DSH theme tokens into the pop-out document (no hard-coded colors). */
function applyTokens(doc: Document): void {
  const parentStyle = getComputedStyle(document.documentElement)
  for (const token of POPOUT_TOKENS) {
    const value = parentStyle.getPropertyValue(token).trim()
    if (value !== '') doc.documentElement.style.setProperty(token, value)
  }
}

/** Build the minimal pop-out document shell and mount the React placeholder. */
function renderPopout(win: Window): void {
  const doc = win.document
  doc.title = 'DeepSeek Companion'

  doc.documentElement.style.cssText = 'height:100%;margin:0'
  doc.body.style.cssText = 'height:100%;margin:0;overflow:hidden;background:var(--dsw-alias-bg-base)'

  applyTokens(doc)

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
  popupWindow = null
  popupRoot = null

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
