import { useState, type CSSProperties } from 'react'

/** Minimal Phase 03 placeholder entry shown in the DSH sidebar footer. */
export function CompanionEntry({ wide }: { wide: boolean }): JSX.Element {
  const [open, setOpen] = useState(false)

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

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        title="DeepSeek Companion"
        aria-label="DeepSeek Companion"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        style={triggerStyle}
      >
        <span style={markStyle}>DS</span>
        {wide ? <span>DeepSeek</span> : null}
      </button>
      {open ? (
        <div
          style={{
            position: 'absolute',
            right: 0,
            bottom: 'calc(100% + 6px)',
            minWidth: 180,
            padding: '10px 12px',
            border: '1px solid rgba(128, 128, 128, 0.35)',
            borderRadius: 8,
            background: 'rgba(128, 128, 128, 0.12)',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.16)',
            fontSize: 13,
          }}
        >
          <strong>DeepSeek Companion</strong>
          <div style={{ opacity: 0.7, marginTop: 4 }}>Coming soon</div>
        </div>
      ) : null}
    </div>
  )
}
