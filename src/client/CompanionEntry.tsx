import { useSyncExternalStore, type CSSProperties } from 'react'
import type { DockController } from './index.ts'

/** Public sidebar tokens keep the entry aligned with native footer actions. */
function triggerStyle(wide: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: wide ? undefined : 'center',
    gap: wide ? 'var(--dsh-sidebar-label-gap, 8px)' : 0,
    width: wide ? '100%' : 36,
    minWidth: 0,
    height: wide ? 42 : 36,
    margin: 0,
    padding: wide ? '0 calc(var(--dsh-sidebar-row-padding, 11px) - var(--dsh-sidebar-paint-inset, 3px))' : 0,
    boxSizing: 'border-box',
    border: 'none',
    borderInline: wide ? 'var(--dsh-sidebar-paint-inset, 3px) solid transparent' : 'none',
    background: 'var(--dsc-entry-bg, transparent)',
    backgroundClip: wide ? 'padding-box' : 'border-box',
    color: 'var(--dsw-alias-label-primary, inherit)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 14,
    lineHeight: '22px',
    borderRadius: 'var(--dsw-radius-md, 12px)',
  }
}

const entryStyles = `
[data-companion-entry] { outline: none; transition: background-color 120ms ease; }
@media (hover: hover) {
  [data-companion-entry]:hover { --dsc-entry-bg: var(--dsw-alias-interactive-bg-hover); }
}
[data-companion-entry]:active { --dsc-entry-bg: var(--dsw-alias-interactive-bg-active); }
[data-companion-entry]:focus-visible {
  outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, Highlight));
  outline-offset: -2px;
}
@media (prefers-reduced-motion: reduce) {
  [data-companion-entry] { transition: none; }
}
`

const markStyle: CSSProperties = {
  fontWeight: 600,
  letterSpacing: '0.02em',
  lineHeight: 1,
}

/** Sidebar footer entry that toggles the Companion Dock. */
export function CompanionEntry({ wide, dock }: { wide: boolean; dock: DockController }): JSX.Element {
  const open = useSyncExternalStore(dock.subscribe, dock.isOpen)
  const label = open ? '关闭快速聊天' : '打开快速聊天'

  return (
    <>
      <style>{entryStyles}</style>
      <button
        type="button"
        data-companion-entry=""
        title={label}
        aria-label={label}
        aria-expanded={open}
        onClick={dock.toggle}
        style={triggerStyle(wide)}
      >
        <span style={markStyle}>DS</span>
        {wide ? <span>快速聊天</span> : null}
      </button>
    </>
  )
}
