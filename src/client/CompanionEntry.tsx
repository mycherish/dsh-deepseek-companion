import { useState, useSyncExternalStore, type CSSProperties } from 'react'
import type { DockController } from './index.ts'

/**
 * Interactive background, mirroring the DSH sidebar footer actions (Settings):
 * transparent → `--dsw-alias-interactive-bg-hover` on hover →
 * `--dsw-alias-interactive-bg-active` while pressed. Focus stays on the browser
 * default `:focus-visible` ring, exactly like the DSH Settings trigger.
 */
function triggerStyle(wide: boolean, hovered: boolean, pressed: boolean): CSSProperties {
  const background = pressed
    ? 'var(--dsw-alias-interactive-bg-active)'
    : hovered
      ? 'var(--dsw-alias-interactive-bg-hover)'
      : 'transparent'

  if (wide) {
    return {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      height: 42,
      padding: '0 10px 0 8px',
      border: 'none',
      background,
      color: 'inherit',
      cursor: 'pointer',
      fontSize: 14,
      lineHeight: '22px',
      borderRadius: 12,
      transition: 'background 120ms ease',
    }
  }
  // Collapsed rail: a centered 36px round icon button, matching the footer rail.
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 36,
    height: 36,
    padding: 0,
    border: 'none',
    background,
    color: 'inherit',
    cursor: 'pointer',
    fontSize: 14,
    borderRadius: '50%',
    transition: 'background 120ms ease',
  }
}

const markStyle: CSSProperties = {
  fontWeight: 600,
  letterSpacing: '0.02em',
  lineHeight: 1,
}

/** Sidebar footer entry that toggles the Companion Dock. */
export function CompanionEntry({ wide, dock }: { wide: boolean; dock: DockController }): JSX.Element {
  const open = useSyncExternalStore(dock.subscribe, dock.isOpen)
  const [hovered, setHovered] = useState(false)
  const [pressed, setPressed] = useState(false)

  return (
    <button
      type="button"
      title="DeepSeek Companion"
      aria-label={open ? 'Close DeepSeek Companion' : 'Open DeepSeek Companion'}
      aria-expanded={open}
      onClick={dock.toggle}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => {
        setHovered(false)
        setPressed(false)
      }}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      style={triggerStyle(wide, hovered, pressed)}
    >
      <span style={markStyle}>DS</span>
      {wide ? <span>DeepSeek</span> : null}
    </button>
  )
}
