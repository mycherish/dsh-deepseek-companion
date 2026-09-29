/** Phase 20B2: classify only the minimal, observed frontend history signal. */
import type { ChatSessionSummary, DeepSeekStatus } from '../shared/state.ts'
import type { SessionLocation } from './sessions.ts'

export type HistorySignal = 'not_found' | 'found' | 'unknown'

export function matchesRecoveryHistoryRequest(value: string, sessionId: string, method: string): boolean {
  try {
    const url = new URL(value)
    const requestedIds = url.searchParams.getAll('chat_session_id')
    return (
      method === 'GET' &&
      url.origin === 'https://chat.deepseek.com' &&
      url.pathname === '/api/v0/chat/history_messages' &&
      requestedIds.length === 1 &&
      requestedIds[0] === sessionId
    )
  } catch {
    return false
  }
}

export function classifyHistoryResponse(status: number, body: unknown): HistorySignal {
  if (status !== 200 || body === null || typeof body !== 'object') return 'unknown'
  const envelope = body as { code?: unknown; data?: unknown }
  if (envelope.code !== 0 || envelope.data === null || typeof envelope.data !== 'object') return 'unknown'
  const data = envelope.data as { biz_code?: unknown; biz_data?: unknown }
  // Observed on 2026-09-27 in the real frontend: deleted/missing session gives
  // HTTP 200 / code 0 / biz_code 1 / biz_data null and redirects to `/`.
  if (data.biz_code === 1 && data.biz_data === null) return 'not_found'
  if (data.biz_code === 0 && data.biz_data !== null && typeof data.biz_data === 'object') return 'found'
  return 'unknown'
}

export interface RecoverySettlement {
  status: DeepSeekStatus
  target: SessionLocation
  location: SessionLocation
  history: HistorySignal
}

export type RecoverySessionVerdict = 'empty' | 'reconcile' | 'deleted' | 'uncertain' | 'unavailable'

export function recoverySessionVerdict(result: RecoverySettlement): RecoverySessionVerdict {
  if (result.status !== 'logged_in') return 'unavailable'
  if (result.target.kind === 'empty') return 'empty'
  if (result.target.kind !== 'session') return 'uncertain'
  if (result.location.kind === 'session' && result.location.id === result.target.id) return 'reconcile'
  if (result.location.kind === 'empty' && result.history === 'not_found') return 'deleted'
  return 'uncertain'
}

/** A title is display data only; require the sidebar's active exact-id entry. */
export function titleForRecoveredSession(sessions: readonly ChatSessionSummary[], id: string): string | null {
  const matches = sessions.filter((entry) => entry.active && entry.id === id && entry.title.trim() !== '')
  return matches.length === 1 ? matches[0]!.title : null
}
