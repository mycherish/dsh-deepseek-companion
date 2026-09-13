import type { CSSProperties } from 'react'
import type { CompanionSurface, DockController } from './index.ts'

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '0 12px',
  height: 44,
  borderBottom: '1px solid var(--dsw-alias-border-l3)',
  flexShrink: 0,
}

const titleStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--dsw-alias-label-primary)',
}

const closeStyle: CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: 'var(--dsw-alias-label-secondary)',
  cursor: 'pointer',
  fontSize: 18,
  lineHeight: 1,
  padding: '4px 6px',
  borderRadius: 6,
}

const bodyStyle: CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  padding: 24,
  fontSize: 14,
  color: 'var(--dsw-alias-label-secondary)',
}

const strongStyle: CSSProperties = {
  color: 'var(--dsw-alias-label-primary)',
  fontWeight: 600,
}

/** Frame-right shell for the overlay fallback; details uses the column's own bounds. */
function surfaceStyle(variant: CompanionSurface): CSSProperties {
  const base: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    overflow: 'hidden',
  }
  if (variant === 'overlay') {
    return {
      ...base,
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      width: 420,
      pointerEvents: 'auto',
      background: 'var(--dsw-alias-bg-base)',
      borderLeft: '1px solid var(--dsw-alias-border-l3)',
    }
  }
  return {
    ...base,
    height: '100%',
  }
}

/** Shared Companion dock body: header + Coming-soon placeholder. */
export function CompanionDock({ dock, variant }: { dock: DockController; variant: CompanionSurface }): JSX.Element {
  return (
    <aside aria-label="DeepSeek Companion" style={surfaceStyle(variant)}>
      <header style={headerStyle}>
        <span style={titleStyle}>DeepSeek</span>
        <button
          type="button"
          aria-label="Close DeepSeek Companion"
          onClick={dock.close}
          style={closeStyle}
        >
          ×
        </button>
      </header>
      <div style={bodyStyle}>
        <strong style={strongStyle}>DeepSeek Companion</strong>
        <div>Coming soon</div>
      </div>
    </aside>
  )
}
