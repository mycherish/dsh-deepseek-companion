import { useEffect, useState, type CSSProperties } from 'react'
import { fetchCompanionState, type CompanionState } from './api.ts'

type Status = 'loading' | 'ready' | 'error'

const rowsStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 2,
  fontSize: 13,
  color: 'var(--dsw-alias-label-secondary)',
  lineHeight: '20px',
}

const instanceStyle: CSSProperties = {
  fontFamily: 'var(--ds-font-family-code, ui-monospace, monospace)',
}

/** Read-only Host-state view shared by the Dock and the Pop-out (Phase 06B). */
export function HostStateView({ origin }: { origin: string }): JSX.Element {
  const [status, setStatus] = useState<Status>('loading')
  const [state, setState] = useState<CompanionState | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setStatus('loading')
    fetchCompanionState(origin, controller.signal)
      .then((value) => {
        setState(value)
        setStatus('ready')
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === 'AbortError') return
        setStatus('error')
      })
    return () => controller.abort()
  }, [origin])

  if (status === 'loading') return <div style={rowsStyle}>Host state loading…</div>
  if (status === 'error' || state === null) return <div style={rowsStyle}>Host state unavailable</div>

  return (
    <div style={rowsStyle}>
      <div>Host: {state.status}</div>
      <div>Revision: {state.revision}</div>
      <div style={instanceStyle}>Instance: {state.instanceId.slice(0, 8)}</div>
    </div>
  )
}
