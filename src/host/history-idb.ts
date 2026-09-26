/**
 * DeepSeek history snapshot reader (Phase 20B1).
 *
 * The authoritative conversation state lives in DeepSeek's OWN IndexedDB cache
 * (`deepseek-chat` → `history-message`, keyed by session id): the frontend keeps
 * it complete, so a plain read is a full snapshot — no accumulator, no network,
 * no token, no cookie, no DOM scraping (design §1/§2).
 *
 * Everything here is read-only. The in-page function is deliberately
 * self-contained: Playwright ships its SOURCE to the browser context, so it may
 * not close over a single module-scope value.
 *
 * Design: `docs/architecture.md` → "Phase 20B — Session Reconciliation" §1/§2.
 */

/** The frontend's IndexedDB database + object store holding conversation caches. */
export const DEEPSEEK_HISTORY_DB = 'deepseek-chat'
export const DEEPSEEK_HISTORY_STORE = 'history-message'

/** Bound for one in-page IDB read: a blocked/hung database must never hang reconcile. */
export const HISTORY_READ_TIMEOUT_MS = 5_000

/**
 * What one `FILE` fragment proves about a message's attachments. Only the two
 * fields the design uses as identity evidence are kept — never a path, never a
 * signed URL (design §6).
 */
export interface HistoryFileEvidence {
  name: string
  size: number
}

/**
 * One server message, reduced to exactly what reconciliation needs: the identity
 * chain (`messageId` / `parentId`), the role, the coarse status, and the text of
 * the REQUEST / RESPONSE / THINK / FILE fragments.
 */
export interface DeepSeekHistoryMessage {
  messageId: number
  parentId: number | null
  role: 'USER' | 'ASSISTANT'
  /** `WIP` is server-side work in progress; anything unrecognised is `UNKNOWN`. */
  status: 'FINISHED' | 'WIP' | 'UNKNOWN'
  /** REQUEST fragment content (user messages only). */
  requestText: string | null
  /** RESPONSE fragment content (assistant messages only). */
  responseText: string | null
  /** THINK fragment content (assistant messages only). */
  reasoningText: string | null
  /** FILE fragment evidence (identity only — Phase 18B is NOT implemented here). */
  files: HistoryFileEvidence[]
}

export type HistoryRead =
  | { kind: 'snapshot'; sessionId: string; currentMessageId: number | null; messages: DeepSeekHistoryMessage[] }
  | { kind: 'unavailable'; reason: 'no-entry' | 'malformed' | 'stale' }

/** What the in-page reader hands back: a probe, never a trusted snapshot. */
export interface HistoryProbe {
  outcome: 'ok' | 'missing' | 'error'
  value?: unknown
}

/**
 * One history read plus the freshness facts that decide whether it may still be
 * applied (Phase 20B1): `current()` re-checks the page/browser epoch at the
 * moment of the write, so a recovery that happened mid-reconcile invalidates the
 * plan instead of letting it land on a rebuilt page.
 */
export interface HistorySnapshotTicket {
  read: HistoryRead
  /** False once the page/browser was replaced (or the plugin disposed). */
  current(): boolean
}

/**
 * The one browser capability reconciliation needs (keeps tests Playwright-free).
 *
 * Every method takes the caller's REMAINING budget: a real step timeout is always
 * `min(its own cap, budgetMs)`, so a whole reconcile can never run past its
 * deadline by spending full step caps back to back (Phase 20B1 review).
 */
export interface ReconcileHistoryReader {
  readHistorySnapshot(sessionId: string, budgetMs?: number): Promise<HistorySnapshotTicket>
  /**
   * Ask the PAGE ITSELF to re-fetch its history (Phase 20B1 review). The frontend
   * writes its own IDB entry from its own request — a bounded `reload()` is all the
   * Host does: it never deletes the DB, never calls the history API and never
   * touches tokens/cookies. Optional so a reader without a page still works.
   *
   * `budgetMs` bounds the WHOLE refresh (reload + the SPA's settle window).
   */
  refreshHistoryView?(budgetMs?: number): Promise<void>
}

/**
 * Read ONE entry from DeepSeek's own cache. Read-only: it never deletes a
 * database, never writes, and never touches a token or cookie. A database that
 * does not exist yet is aborted instead of created (the frontend owns creation).
 */
export function readHistoryEntryInPage(args: {
  db: string
  store: string
  key: string
  timeoutMs: number
}): Promise<HistoryProbe> {
  return new Promise<HistoryProbe>((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout>
    const done = (probe: HistoryProbe): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(probe)
    }
    timer = setTimeout(() => done({ outcome: 'error' }), args.timeoutMs)

    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(args.db)
    } catch {
      done({ outcome: 'error' })
      return
    }

    request.onupgradeneeded = () => {
      // The database did not exist: this open would CREATE it. Abort instead —
      // the Host never leaves artifacts inside the user's browser profile.
      try {
        request.transaction?.abort()
      } catch {
        // an aborted upgrade is exactly what we want
      }
      try {
        request.result?.close()
      } catch {
        // the connection is unusable either way
      }
      done({ outcome: 'missing' })
    }
    request.onerror = () => done({ outcome: 'error' })
    request.onblocked = () => done({ outcome: 'error' })

    request.onsuccess = () => {
      const db = request.result
      let get: IDBRequest
      try {
        get = db.transaction(args.store, 'readonly').objectStore(args.store).get(args.key)
      } catch {
        // No such object store → this session was never cached here.
        try {
          db.close()
        } catch {
          // closing a broken handle is best-effort
        }
        done({ outcome: 'missing' })
        return
      }
      get.onsuccess = () => {
        const value: unknown = get.result
        try {
          db.close()
        } catch {
          // closing a broken handle is best-effort
        }
        done(value === undefined ? { outcome: 'missing' } : { outcome: 'ok', value })
      }
      get.onerror = () => {
        try {
          db.close()
        } catch {
          // closing a broken handle is best-effort
        }
        done({ outcome: 'error' })
      }
    }
  })
}

/**
 * Turn one probe into a snapshot the reconciler may trust (design §2).
 *
 * Structure is checked BEFORE anything is used: the entry must belong to THIS
 * session, `message_id` must be unique, `parent_id` must form a single legal
 * chain (first `null`, then the previous id) and roles must alternate starting
 * with USER. Any violation is `malformed` — never a partially trusted snapshot.
 */
export function parseHistoryEntry(probe: unknown, sessionId: string): HistoryRead {
  if (probe === null || typeof probe !== 'object') return { kind: 'unavailable', reason: 'malformed' }
  const { outcome, value } = probe as { outcome?: unknown; value?: unknown }
  if (outcome === 'missing') return { kind: 'unavailable', reason: 'no-entry' }
  if (outcome !== 'ok') return { kind: 'unavailable', reason: 'malformed' }

  const entry = readEntryData(value)
  if (entry === null) return { kind: 'unavailable', reason: 'malformed' }
  // A cache entry for a DIFFERENT conversation is stale, not malformed: the page
  // may simply have moved on between the read and this parse.
  if (entry.sessionId !== sessionId) return { kind: 'unavailable', reason: 'stale' }

  // Parse every message first: the ARRAY ORDER is not the chain order. A real
  // `MERGE` entry puts the fresh increment at the HEAD of the array (measured:
  // ids `7,8,9,10,1,2,3,4,5,6` with parents `6,7,8,9,null,1,2,3,4,5`), so the
  // order is rebuilt from the parent chain below instead of trusted.
  const parsed: DeepSeekHistoryMessage[] = []
  const seen = new Set<number>()
  for (const raw of entry.rawMessages) {
    const message = parseMessage(raw)
    if (message === null) return { kind: 'unavailable', reason: 'malformed' }
    if (seen.has(message.messageId)) return { kind: 'unavailable', reason: 'malformed' }
    seen.add(message.messageId)
    parsed.push(message)
  }

  const childrenOf = new Map<number | null, DeepSeekHistoryMessage[]>()
  for (const message of parsed) {
    const siblings = childrenOf.get(message.parentId)
    if (siblings === undefined) childrenOf.set(message.parentId, [message])
    else siblings.push(message)
  }

  // Single root, single child per node, every message reachable: a chain.
  const roots = childrenOf.get(null) ?? []
  if (parsed.length > 0 && roots.length !== 1) return { kind: 'unavailable', reason: 'malformed' }
  const messages: DeepSeekHistoryMessage[] = []
  let cursor: DeepSeekHistoryMessage | undefined = roots[0]
  while (cursor !== undefined) {
    messages.push(cursor)
    const children = childrenOf.get(cursor.messageId) ?? []
    // Two children (a fork) can never be reconciled against one linear Host chain.
    if (children.length > 1) return { kind: 'unavailable', reason: 'malformed' }
    cursor = children[0]
  }
  // Anything left over is an orphan or a cycle: the entry is not the full chain.
  if (messages.length !== parsed.length) return { kind: 'unavailable', reason: 'malformed' }

  for (let index = 0; index < messages.length; index += 1) {
    const expectedRole: DeepSeekHistoryMessage['role'] = index % 2 === 0 ? 'USER' : 'ASSISTANT'
    if (messages[index]!.role !== expectedRole) return { kind: 'unavailable', reason: 'malformed' }
  }

  return { kind: 'snapshot', sessionId, currentMessageId: entry.currentMessageId, messages }
}

interface EntryData {
  sessionId: string
  currentMessageId: number | null
  rawMessages: unknown[]
}

/** Read the `data` envelope the frontend writes around one conversation cache. */
function readEntryData(value: unknown): EntryData | null {
  if (value === null || typeof value !== 'object') return null
  const data = (value as { data?: unknown }).data
  if (data === null || typeof data !== 'object') return null
  const record = data as { chat_session?: unknown; chat_messages?: unknown }
  const session = record.chat_session
  if (session === null || typeof session !== 'object') return null
  const { id, current_message_id } = session as { id?: unknown; current_message_id?: unknown }
  if (typeof id !== 'string' || id === '') return null
  if (!Array.isArray(record.chat_messages)) return null
  const currentMessageId =
    typeof current_message_id === 'number' && Number.isFinite(current_message_id) ? current_message_id : null
  return { sessionId: id, currentMessageId, rawMessages: record.chat_messages }
}

/** Reduce one raw server message; `null` means "structurally unusable". */
function parseMessage(raw: unknown): DeepSeekHistoryMessage | null {
  if (raw === null || typeof raw !== 'object') return null
  const record = raw as {
    message_id?: unknown
    parent_id?: unknown
    role?: unknown
    status?: unknown
    fragments?: unknown
  }
  if (typeof record.message_id !== 'number' || !Number.isFinite(record.message_id)) return null
  if (record.parent_id !== null && (typeof record.parent_id !== 'number' || !Number.isFinite(record.parent_id))) {
    return null
  }
  if (record.role !== 'USER' && record.role !== 'ASSISTANT') return null
  if (!Array.isArray(record.fragments)) return null

  const status: DeepSeekHistoryMessage['status'] =
    record.status === 'FINISHED' ? 'FINISHED' : record.status === 'WIP' ? 'WIP' : 'UNKNOWN'

  let requestText: string | null = null
  let responseText: string | null = null
  let reasoningText: string | null = null
  const files: HistoryFileEvidence[] = []
  for (const fragment of record.fragments) {
    if (fragment === null || typeof fragment !== 'object') continue
    const { type, content, files: rawFiles } = fragment as { type?: unknown; content?: unknown; files?: unknown }
    if (typeof content === 'string') {
      if (type === 'REQUEST' && requestText === null) requestText = content
      else if (type === 'RESPONSE' && responseText === null) responseText = content
      else if (type === 'THINK' && reasoningText === null) reasoningText = content
    }
    if (type === 'FILE' && Array.isArray(rawFiles)) {
      for (const file of rawFiles) {
        if (file === null || typeof file !== 'object') continue
        const { file_name, file_size } = file as { file_name?: unknown; file_size?: unknown }
        if (typeof file_name !== 'string' || file_name === '') continue
        if (typeof file_size !== 'number' || !Number.isFinite(file_size)) continue
        files.push({ name: file_name, size: file_size })
      }
    }
  }

  return {
    messageId: record.message_id,
    parentId: record.parent_id,
    role: record.role,
    status,
    requestText,
    responseText,
    reasoningText,
    files,
  }
}
