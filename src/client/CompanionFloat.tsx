import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import type { DockController } from './index.ts'
import { HostStateView } from './HostStateView.tsx'
import {
  clampFloatPosition,
  clampFloatSize,
  FLOAT_DEFAULT_HEIGHT,
  FLOAT_DEFAULT_WIDTH,
  initialFloatPosition,
  resizeFloat,
  type FloatRect,
  type ResizeDirection,
} from './float.ts'

const rootStyle: CSSProperties = {
  position: 'fixed',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  background: 'var(--dsw-alias-bg-base)',
  color: 'var(--dsw-alias-label-primary)',
  border: '1px solid var(--dsw-alias-border-l3)',
  borderRadius: 12,
  boxShadow: '0 12px 32px rgba(0, 0, 0, 0.28)',
  zIndex: 1000,
  fontSize: 14,
}

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '0 8px 0 12px',
  height: 44,
  borderBottom: '1px solid var(--dsw-alias-border-l3)',
  flexShrink: 0,
  cursor: 'grab',
  userSelect: 'none',
  touchAction: 'none',
}

const titleStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--dsw-alias-label-primary)',
  pointerEvents: 'none',
}

const headerActionsStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 2,
}

/** Small header icon button with DSH hover / active feedback. */
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
  color: 'var(--dsw-alias-label-secondary)',
  minHeight: 0,
  overflow: 'hidden',
}

const strongStyle: CSSProperties = {
  color: 'var(--dsw-alias-label-primary)',
  fontWeight: 600,
}

/** Transparent resize handles: four edges (6px) plus four corners (16px). */
const resizeHandleBase: CSSProperties = {
  position: 'absolute',
  touchAction: 'none',
  userSelect: 'none',
}

const RESIZE_EDGES: { direction: ResizeDirection; style: CSSProperties; cursor: string }[] = [
  { direction: 'top', style: { top: 0, left: 0, right: 0, height: 6 }, cursor: 'ns-resize' },
  { direction: 'bottom', style: { bottom: 0, left: 0, right: 0, height: 6 }, cursor: 'ns-resize' },
  { direction: 'left', style: { left: 0, top: 0, bottom: 0, width: 6 }, cursor: 'ew-resize' },
  { direction: 'right', style: { right: 0, top: 0, bottom: 0, width: 6 }, cursor: 'ew-resize' },
  { direction: 'top-left', style: { top: 0, left: 0, width: 16, height: 16 }, cursor: 'nwse-resize' },
  { direction: 'top-right', style: { top: 0, right: 0, width: 16, height: 16 }, cursor: 'nesw-resize' },
  { direction: 'bottom-left', style: { bottom: 0, left: 0, width: 16, height: 16 }, cursor: 'nesw-resize' },
  { direction: 'bottom-right', style: { bottom: 0, right: 0, width: 16, height: 16 }, cursor: 'nwse-resize' },
]

/**
 * In-page floating Companion window (Phase 06D). Draggable by its title bar and
 * resizable from the bottom-right corner. Position/size are in-memory UI state;
 * the window is re-clamped on viewport resize so it never escapes the screen.
 */
export function CompanionFloat({ dock }: { dock: DockController }): JSX.Element {
  const [size, setSize] = useState({ width: FLOAT_DEFAULT_WIDTH, height: FLOAT_DEFAULT_HEIGHT })
  const [position, setPosition] = useState(() =>
    initialFloatPosition(window.innerWidth, window.innerHeight, FLOAT_DEFAULT_WIDTH, FLOAT_DEFAULT_HEIGHT),
  )

  const sizeRef = useRef(size)
  const positionRef = useRef(position)
  sizeRef.current = size
  positionRef.current = position

  const dragRef = useRef<{ startX: number; startY: number; posX: number; posY: number } | null>(null)
  const resizeRef = useRef<{ startX: number; startY: number; rect: FloatRect; direction: ResizeDirection } | null>(null)

  // Keep the window visible when the viewport shrinks/grows.
  useEffect(() => {
    const onResize = () => {
      const nextSize = clampFloatSize(
        sizeRef.current.width,
        sizeRef.current.height,
        window.innerWidth,
        window.innerHeight,
      )
      setSize(nextSize)
      setPosition(
        clampFloatPosition(
          positionRef.current.x,
          positionRef.current.y,
          nextSize.width,
          nextSize.height,
          window.innerWidth,
          window.innerHeight,
        ),
      )
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // --- title-bar drag ---
  const onHeaderPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const p = positionRef.current
    dragRef.current = { startX: event.clientX, startY: event.clientY, posX: p.x, posY: p.y }
  }
  const onHeaderPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (drag === null || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    const s = sizeRef.current
    setPosition(
      clampFloatPosition(
        drag.posX + (event.clientX - drag.startX),
        drag.posY + (event.clientY - drag.startY),
        s.width,
        s.height,
        window.innerWidth,
        window.innerHeight,
      ),
    )
  }
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    dragRef.current = null
  }

  // --- eight-direction resize ---
  const onResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>, direction: ResizeDirection) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const p = positionRef.current
    const s = sizeRef.current
    resizeRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      rect: { x: p.x, y: p.y, width: s.width, height: s.height },
      direction,
    }
  }
  const onResizePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const resize = resizeRef.current
    if (resize === null || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    const next = resizeFloat(
      resize.rect,
      resize.direction,
      event.clientX - resize.startX,
      event.clientY - resize.startY,
      window.innerWidth,
      window.innerHeight,
    )
    setSize({ width: next.width, height: next.height })
    setPosition({ x: next.x, y: next.y })
  }
  const endResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    resizeRef.current = null
  }

  return (
    <section
      aria-label="DeepSeek Companion"
      style={{ ...rootStyle, left: position.x, top: position.y, width: size.width, height: size.height }}
    >
      <header
        style={headerStyle}
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <span style={titleStyle}>DeepSeek Companion</span>
        <div style={headerActionsStyle}>
          <HeaderIconButton label="Dock DeepSeek Companion" onClick={dock.dockBack} fontSize={16}>
            ◧
          </HeaderIconButton>
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
      {RESIZE_EDGES.map((edge) => (
        <div
          key={edge.direction}
          role="separator"
          aria-label="Resize DeepSeek Companion"
          onPointerDown={(event) => onResizePointerDown(event, edge.direction)}
          onPointerMove={onResizePointerMove}
          onPointerUp={endResize}
          onPointerCancel={endResize}
          style={{ ...resizeHandleBase, ...edge.style, cursor: edge.cursor }}
        />
      ))}
    </section>
  )
}
