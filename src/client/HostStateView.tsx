import { useEffect, useState, type CSSProperties } from 'react'
import { subscribeCompanionState, type CompanionState } from './api.ts'
import type { DeepSeekStatus } from '../shared/state.ts'

type Status = 'loading' | 'ready' | 'error'

function deepseekLabel(status: DeepSeekStatus): string {
  switch (status) {
    case 'checking':
      return '检测中'
    case 'logged_in':
      return '已登录'
    case 'logged_out':
      return '未登录'
    case 'error':
      return '检测失败'
  }
}

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

/** Live Host-state view shared by the Dock and the Pop-out (Phase 06C). */
export function HostStateView({ origin }: { origin: string }): JSX.Element {
  const [status, setStatus] = useState<Status>('loading')
  const [state, setState] = useState<CompanionState | null>(null)

  useEffect(() => {
    let active = true
    setStatus('loading')
    const unsubscribe = subscribeCompanionState(
      origin,
      (next) => {
        if (!active) return
        setState(next)
        setStatus('ready')
      },
      () => {
        if (!active) return
        setStatus('error')
      },
    )
    return () => {
      active = false
      unsubscribe()
    }
  }, [origin])

  if (status === 'loading') return <div style={rowsStyle}>Host state loading…</div>
  if (status === 'error' || state === null) return <div style={rowsStyle}>Host state unavailable</div>

  return (
    <div style={rowsStyle}>
      <div>Host: {state.status}</div>
      <div>Revision: {state.revision}</div>
      <div style={instanceStyle}>Instance: {state.instanceId.slice(0, 8)}</div>
      <div>DeepSeek: {deepseekLabel(state.deepseek.status)}</div>
    </div>
  )
}
