import { useSyncExternalStore, type CSSProperties } from 'react'
import type { DockController } from './index.ts'

const triggerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 10px',
  border: 'none',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  fontSize: 13,
  borderRadius: 6,
}

const markStyle: CSSProperties = {
  fontWeight: 600,
  letterSpacing: '0.02em',
  lineHeight: 1,
}

/** Sidebar footer entry that toggles the Companion Dock. */
export function CompanionEntry({ wide, dock }: { wide: boolean; dock: DockController }): JSX.Element {
  const open = useSyncExternalStore(dock.subscribe, dock.isOpen)
  return (
    <button
      type="button"
      title="DeepSeek Companion"
      aria-label={open ? 'Close DeepSeek Companion' : 'Open DeepSeek Companion'}
      aria-expanded={open}
      onClick={dock.toggle}
      style={triggerStyle}
    >
      <span style={markStyle}>DS</span>
      {wide ? <span>DeepSeek</span> : null}
    </button>
  )
}
