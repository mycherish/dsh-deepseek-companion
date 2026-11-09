import type { CSSProperties } from 'react'
import { CompanionStyles } from './CompanionStyles.tsx'
import { HeaderIconButton } from './HeaderIconButton.tsx'
import { ChatView } from './ChatView.tsx'

const rootStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  background: 'var(--dsw-alias-bg-base)',
  color: 'var(--dsw-alias-label-primary)',
  fontSize: 'var(--dsh-content-font-size, 14px)',
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
  fontSize: 'var(--dsh-content-font-size, 14px)',
  fontWeight: 600,
  color: 'var(--dsw-alias-label-primary)',
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
    <div data-companion-root="" style={rootStyle}>
      <CompanionStyles />
      <header style={headerStyle}>
        <span style={titleStyle}>DeepSeek Companion</span>
        <HeaderIconButton label="Close DeepSeek Companion" onClick={onClose}>
          ×
        </HeaderIconButton>
      </header>
      <div style={bodyStyle}>
        <ChatView origin={origin} />
      </div>
    </div>
  )
}
