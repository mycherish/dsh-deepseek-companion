import { useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import type { CompanionSurface, DockController } from './index.ts'
import { HostStateView } from './HostStateView.tsx'
import { clampDockWidth, widthFromPointer } from './resize.ts'

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

const headerActionsStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 2,
}

/** Small header icon button (↗ / ×) with DSH hover / active feedback. */
function HeaderIconButton({
  label,
  onClick,
  fontSize = 18,
  children,
}: {
  label: string
  onClick: () => void
  fontSize?: number
  children: string
}): JSX.Element {
  const [hovered, setHovered] = useState(false)
  const [pressed, setPressed] = useState(false)
  const background = pressed
    ? 'var(--dsw-alias-interactive-bg-active)'
    : hovered
      ? 'var(--dsw-alias-interactive-bg-hover)'
      : 'transparent'
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => {
        setHovered(false)
        setPressed(false)
      }}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      style={{
        border: 'none',
        background,
        color: 'var(--dsw-alias-label-secondary)',
        cursor: 'pointer',
        fontSize,
        lineHeight: 1,
        padding: '4px 6px',
        borderRadius: 6,
        transition: 'background 120ms ease',
      }}
    >
      {children}
    </button>
  )
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
function surfaceStyle(variant: CompanionSurface, dockWidth: number): CSSProperties {
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
      width: dockWidth,
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

/**
 * Narrow left-edge drag handle for the overlay dock. Pointer capture keeps the
 * drag alive even when the pointer leaves the handle; the drag is anchored at
 * its start so repeated moves never accumulate rounding drift. The handle
 * unmounts with the dock, so no window-level listeners are left behind.
 */
function ResizeHandle({ dock }: { dock: DockController }): JSX.Element {
  const [dragging, setDragging] = useState(false)
  const [hovered, setHovered] = useState(false)
  const startRef = useRef<{ pointerX: number; width: number } | null>(null)

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    startRef.current = { pointerX: event.clientX, width: dock.dockWidth() }
    setDragging(true)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = startRef.current
    if (start === null || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    dock.setDockWidth(
      clampDockWidth(widthFromPointer(start.width, start.pointerX, event.clientX), window.innerWidth),
    )
  }

  const finish = (event: ReactPointerEvent<HTMLDivElement>, persist: boolean) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    startRef.current = null
    setDragging(false)
    // Persist only on a normal release; a cancelled drag keeps the in-memory
    // width but does not force a half-finished value into localStorage.
    if (persist) dock.commitOverlayWidth()
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => finish(event, true)
  const onPointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => finish(event, false)

  const shown = dragging || hovered

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize DeepSeek Companion"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: -4,
        width: 8,
        zIndex: 2,
        cursor: 'col-resize',
        touchAction: 'none',
        userSelect: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          width: 6,
          height: 32,
          borderRadius: 8,
          border: shown ? '0.5px solid var(--dsw-alias-border-l3)' : '0.5px solid transparent',
          background: shown ? 'var(--dsw-alias-button-floating-fill)' : 'transparent',
          transition: 'background 120ms ease, border-color 120ms ease',
        }}
      />
    </div>
  )
}

/** Shared Companion dock body: header + Coming-soon placeholder (+ overlay resize handle). */
export function CompanionDock({ dock, variant }: { dock: DockController; variant: CompanionSurface }): JSX.Element {
  const dockWidth = useSyncExternalStore(dock.subscribe, dock.dockWidth)
  return (
    <aside aria-label="DeepSeek Companion" style={surfaceStyle(variant, dockWidth)}>
      {variant === 'overlay' ? <ResizeHandle dock={dock} /> : null}
      <header style={headerStyle}>
        <span style={titleStyle}>DeepSeek</span>
        <div style={headerActionsStyle}>
          <HeaderIconButton label="Open DeepSeek Companion in new window" onClick={dock.openPopout} fontSize={16}>
            ↗
          </HeaderIconButton>
          <HeaderIconButton label="Close DeepSeek Companion" onClick={dock.close}>
            ×
          </HeaderIconButton>
        </div>
      </header>
      <div style={bodyStyle}>
        <strong style={strongStyle}>DeepSeek Companion</strong>
        <HostStateView origin={window.location.origin} />
      </div>
    </aside>
  )
}
