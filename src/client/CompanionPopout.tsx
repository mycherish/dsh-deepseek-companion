import type { CSSProperties } from 'react'
import { ChatView } from './ChatView.tsx'

const rootStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  background: 'var(--dsw-alias-bg-base)',
  color: 'var(--dsw-alias-label-primary)',
  fontSize: 14,
}

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
  minHeight: 0,
  padding: 12,
  color: 'var(--dsw-alias-label-secondary)',
}

/** Minimal pop-out shell: header + shared Host-state view. */
export function CompanionPopout({ onClose, origin }: { onClose: () => void; origin: string }): JSX.Element {
  return (
    <div style={rootStyle}>
      <header style={headerStyle}>
        <span style={titleStyle}>DeepSeek Companion</span>
        <button type="button" aria-label="Close DeepSeek Companion" onClick={onClose} style={closeStyle}>
          ×
        </button>
      </header>
      <div style={bodyStyle}>
        <ChatView origin={origin} />
      </div>
    </div>
  )
}
