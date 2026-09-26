/**
 * Safe transcript reconciliation — pure logic (Phase 20B1).
 *
 * Turns a validated server snapshot plus the Host transcript into ONE plan
 * (`bindings` + `patches` + `appends`) or a `no-op`. Nothing here touches the
 * store or the page: the caller validates freshness (session / epoch /
 * generation) and applies the plan in a single write.
 *
 * The identity strategy is three levels, first hit wins (design §3):
 *
 *   Level 1  every Host message already carries `deepSeekMessageId` → use it
 *   Level 2  a committed `parent_message_id` anchor exists → bind via the chain
 *   Level 3  neither → strict chain alignment over the whole transcript
 *
 * `parent + 1` / `parent + 2` is NEVER used as an authoritative mapping: the
 * realtime request only supplies the anchor, and the ids themselves must be
 * confirmed by the snapshot's own parent chain. Any ambiguity is a safe-fail.
 *
 * Design: `docs/architecture.md` → "Phase 20B — Session Reconciliation" §3–§8.
 */

import type {
  ChatAttachment,
  ChatFormat,
  ChatMessage,
  ChatReasoning,
  MessageStatus,
} from '../shared/state.ts'
import type { DeepSeekHistoryMessage, ReconcileHistoryReader } from './history-idb.ts'

/** The browser capability reconciliation consumes — part of this module's surface. */
export type { ReconcileHistoryReader } from './history-idb.ts'

/** Whole-reconcile wall-clock budget (design §11): read + stability wait + apply. */
export const RECONCILE_TOTAL_BUDGET_MS = 30_000

/** How long two snapshots must agree before a WIP snapshot counts as settled. */
export const RECONCILE_STABILITY_INTERVAL_MS = 500
/**
 * How much of the reconcile budget must remain before the single frontend refresh
 * is spent. The reload + the SPA's own re-fetch settled in ≈6 s on a real page, so
 * this keeps a comfortable margin while letting the server use the rest of the
 * budget to finish its reply (measured `WIP → FINISHED` ≈10 s).
 */
export const REFRESH_HEADROOM_MS = 12_000

// --- committed anchor (Host-only metadata) ------------------------------------

/**
 * The committed turn of the last send (design §3/§5.1). Read from the completion
 * request at the commit point and kept OUT of the shared `ChatMessage` shape:
 * it is Host bookkeeping, not message content. In-memory only — it must survive
 * a page/browser rebuild (same process), which is exactly what reconcile needs.
 */
export interface CommittedAnchor {
  sessionId: string
  /** The completion request's `parent_message_id` (`null` for a new session). */
  parentMessageId: number | null
  /** Host id of this turn's user message. */
  userMessageId: string
  /** Host id of this turn's assistant message. */
  assistantMessageId: string
}

/** Single-slot registry: only the most recent committed turn can be reconciled. */
export interface CommittedAnchorRegistry {
  record(anchor: CommittedAnchor): void
  get(): CommittedAnchor | undefined
  clear(): void
}

export function createCommittedAnchorRegistry(): CommittedAnchorRegistry {
  let anchor: CommittedAnchor | undefined
  return {
    record(next) {
      anchor = next
    },
    get: () => anchor,
    clear() {
      anchor = undefined
    },
  }
}

// --- identity ------------------------------------------------------------------

export type IdentityLevel = 1 | 2 | 3

/** One Host message ↔ server message binding to write (Phase 20B1). */
export interface IdentityBinding {
  hostId: string
  deepSeekMessageId: number
}

export type IdentityResolution =
  | { ok: true; level: IdentityLevel; bindings: IdentityBinding[] }
  | { ok: false; reason: string }

function fail(reason: string): IdentityResolution {
  return { ok: false, reason }
}

/**
 * Resolve Host↔server identity, first hit wins (design §3).
 *
 * A `stale` anchor (different session) is IGNORED rather than fatal — the page
 * moved on, so the strict bootstrap decides instead.
 */
export function resolveIdentity(input: {
  sessionId: string
  messages: readonly DeepSeekHistoryMessage[]
  hostMessages: readonly ChatMessage[]
  anchor?: CommittedAnchor
}): IdentityResolution {
  const byId = new Map<number, DeepSeekHistoryMessage>()
  for (const message of input.messages) byId.set(message.messageId, message)

  // Level 1 — every Host message already carries an id: use it as-is. The ids
  // must still exist in THIS session's history, otherwise the transcript and the
  // server disagree and nothing may be patched.
  if (input.hostMessages.length > 0 && input.hostMessages.every((message) => message.deepSeekMessageId !== undefined)) {
    for (const message of input.hostMessages) {
      if (!byId.has(message.deepSeekMessageId as number)) return fail('existing id is missing from history')
    }
    return { ok: true, level: 1, bindings: [] }
  }

  const anchor =
    input.anchor !== undefined && input.anchor.sessionId === input.sessionId ? input.anchor : undefined
  if (anchor !== undefined) return bindByAnchor(input.messages, input.hostMessages, anchor)

  return bootstrapStrict(input.messages, input.hostMessages)
}

/** Level 2 — parent-anchor binding for the current committed turn (design §5.1). */
function bindByAnchor(
  messages: readonly DeepSeekHistoryMessage[],
  hostMessages: readonly ChatMessage[],
  anchor: CommittedAnchor,
): IdentityResolution {
  const hostUser = hostMessages.find((message) => message.id === anchor.userMessageId)
  const hostAssistant = hostMessages.find((message) => message.id === anchor.assistantMessageId)
  if (hostUser === undefined || hostAssistant === undefined) return fail('anchor messages are not in the transcript')
  if (hostUser.role !== 'user' || hostAssistant.role !== 'assistant') return fail('anchor messages have wrong roles')

  // The anchor IS the parent id — never `parent + 1`.
  let serverUser: DeepSeekHistoryMessage | undefined
  if (anchor.parentMessageId === null) {
    // A brand-new session: the turn hangs off the single root.
    const roots = messages.filter((message) => message.role === 'USER' && message.parentId === null)
    if (roots.length === 0) return fail('root user not found')
    if (roots.length > 1) return fail('root user is ambiguous')
    serverUser = roots[0]
  } else {
    const candidates = messages.filter(
      (message) => message.role === 'USER' && message.parentId === anchor.parentMessageId,
    )
    if (candidates.length === 0) return fail('parent anchor not found in history')
    if (candidates.length > 1) return fail('parent anchor is ambiguous')
    serverUser = candidates[0]
  }
  if (serverUser === undefined) return fail('parent anchor not found')
  if (serverUser.requestText === null || serverUser.requestText !== hostUser.content) {
    return fail('anchor user text mismatch')
  }
  if (!filesMatch(hostUser.attachments, serverUser.files)) return fail('anchor file evidence mismatch')

  const children = messages.filter(
    (message) => message.role === 'ASSISTANT' && message.parentId === serverUser.messageId,
  )
  if (children.length !== 1) return fail('assistant child is not unique')
  const serverAssistant = children[0] as DeepSeekHistoryMessage

  return {
    ok: true,
    level: 2,
    bindings: [
      { hostId: hostUser.id, deepSeekMessageId: serverUser.messageId },
      { hostId: hostAssistant.id, deepSeekMessageId: serverAssistant.messageId },
    ],
  }
}

/**
 * Level 3 — strict chain alignment (design §5.2). Roles and order must line up
 * from the head, finished text must match exactly, and only the LAST assistant
 * may be a strict prefix of the server's (the crash turn). No fuzzy matching, no
 * index-only binding, no arithmetic.
 */
function bootstrapStrict(
  messages: readonly DeepSeekHistoryMessage[],
  hostMessages: readonly ChatMessage[],
): IdentityResolution {
  if (messages.length !== hostMessages.length) return fail('transcript length mismatch')
  const bindings: IdentityBinding[] = []
  for (let index = 0; index < hostMessages.length; index += 1) {
    const hostMessage = hostMessages[index] as ChatMessage
    const serverMessage = messages[index] as DeepSeekHistoryMessage
    const expectedRole: DeepSeekHistoryMessage['role'] = hostMessage.role === 'user' ? 'USER' : 'ASSISTANT'
    if (serverMessage.role !== expectedRole) return fail('role mismatch')

    const isCrashTurn =
      index === hostMessages.length - 1 &&
      hostMessage.role === 'assistant' &&
      (hostMessage.status ?? 'finished') !== 'finished'

    if (hostMessage.role === 'user') {
      if (serverMessage.requestText === null || serverMessage.requestText !== hostMessage.content) {
        return fail('user text mismatch')
      }
      if (!filesMatch(hostMessage.attachments, serverMessage.files)) return fail('file evidence mismatch')
    } else {
      const serverContent = serverMessage.responseText ?? ''
      if (hostMessage.content !== serverContent) {
        // A crash turn may have captured only a prefix; anything else must be exact.
        if (!isCrashTurn || !isStrictPrefix(hostMessage.content, serverContent)) {
          return fail('assistant text mismatch')
        }
      }
      const hostReasoning = hostMessage.reasoning?.content
      const serverReasoning = serverMessage.reasoningText
      if (hostReasoning !== undefined && serverReasoning !== null && hostReasoning !== serverReasoning) {
        // Reasoning is read through a FOLDED DOM panel, so the Host's copy is
        // routinely TRUNCATED: measured 8918 chars vs the server's 9261 for the
        // same message, identical prefix. A strict prefix is therefore accepted
        // for historical turns too — anything else still safe-fails.
        if (!isStrictPrefix(hostReasoning, serverReasoning)) return fail('reasoning mismatch')
      }
    }

    if (hostMessage.deepSeekMessageId !== undefined && hostMessage.deepSeekMessageId !== serverMessage.messageId) {
      return fail('existing id conflicts with the chain')
    }
    if (hostMessage.deepSeekMessageId === undefined) {
      bindings.push({ hostId: hostMessage.id, deepSeekMessageId: serverMessage.messageId })
    }
  }
  return { ok: true, level: 3, bindings }
}

/** `host` is a proper prefix of `server` (equal strings are NOT a prefix match). */
function isStrictPrefix(host: string, server: string): boolean {
  return host.length < server.length && server.startsWith(host)
}

/**
 * `FILE` evidence vs the Host's own attachments (design §6): a mismatch is only
 * checkable when the Host actually claims files. A Host message WITHOUT
 * attachments that meets server FILEs is "Host does not know this message" —
 * which for identity purposes is a mismatch, never a silent pass (that history
 * is Phase 18B's business, not 20B1's).
 */
function filesMatch(attachments: ChatAttachment[] | undefined, files: readonly { name: string; size: number }[]): boolean {
  const hostFiles = attachments ?? []
  if (hostFiles.length !== files.length) return false
  if (hostFiles.length === 0) return true
  const hostKeys = new Set<string>()
  for (const file of hostFiles) {
    // A Host attachment with an unknown name or size is not usable evidence —
    // that is a mismatch, never a silent pass (Phase 18B restores such metadata).
    if (file.name === null || file.bytes === undefined) return false
    hostKeys.add(`${file.name}\u0000${file.bytes}`)
  }
  if (hostKeys.size !== hostFiles.length) return false
  return files.every((file) => hostKeys.has(`${file.name}\u0000${file.size}`))
}

// --- plan ----------------------------------------------------------------------

/** Fields the plan may rewrite on ONE existing Host message. */
export interface ReconcilePatch {
  id: string
  content?: string
  format?: ChatFormat
  reasoning?: ChatReasoning
  status?: MessageStatus
}

/** One server message the Host is allowed to add (design §7 table B). */
export interface ReconcileAppend {
  role: 'assistant'
  content: string
  format: ChatFormat
  status: MessageStatus
  deepSeekMessageId: number
  sessionId: string
  reasoning?: ChatReasoning
}

/** Everything one reconcile writes, applied by the store in a single notify. */
export interface ChatReconcilePatch {
  bindings: IdentityBinding[]
  patches: ReconcilePatch[]
  appends: ReconcileAppend[]
}

export type ReconcilePlan =
  | { kind: 'no-op'; reason: string }
  | { kind: 'apply'; level: IdentityLevel; patch: ChatReconcilePatch }

/**
 * Build the ONE plan a reconcile may apply (design §3–§8). Identity first, then
 * per-message patches, then the (tightly restricted) appends. A content
 * divergence anywhere makes the WHOLE plan a `no-op`: identity is then not
 * trustworthy enough to rewrite anything.
 */
export function buildReconcilePlan(input: {
  sessionId: string
  messages: readonly DeepSeekHistoryMessage[]
  hostMessages: readonly ChatMessage[]
  anchor?: CommittedAnchor
}): ReconcilePlan {
  const identity = resolveIdentity(input)
  if (!identity.ok) return { kind: 'no-op', reason: identity.reason }

  const byId = new Map<number, DeepSeekHistoryMessage>()
  for (const message of input.messages) byId.set(message.messageId, message)

  // Host message id → server message id (already known or newly bound).
  const deepSeekIdByHost = new Map<string, number>()
  for (const message of input.hostMessages) {
    if (message.deepSeekMessageId !== undefined) deepSeekIdByHost.set(message.id, message.deepSeekMessageId)
  }
  for (const binding of identity.bindings) deepSeekIdByHost.set(binding.hostId, binding.deepSeekMessageId)

  const patches: ReconcilePatch[] = []
  for (const hostMessage of input.hostMessages) {
    if (hostMessage.role !== 'assistant') continue
    const deepSeekId = deepSeekIdByHost.get(hostMessage.id)
    if (deepSeekId === undefined) continue
    const server = byId.get(deepSeekId)
    if (server === undefined) continue
    const patch = planAssistantPatch(hostMessage, server)
    if (patch === 'diverged') return { kind: 'no-op', reason: 'assistant content diverged' }
    if (patch !== undefined) patches.push(patch)
  }

  // Appends are restricted to assistants whose parent is an ALREADY BOUND Host
  // user — no chain evidence, no append (design §7).
  const boundUserIds = new Set<number>()
  for (const hostMessage of input.hostMessages) {
    if (hostMessage.role !== 'user') continue
    const deepSeekId = deepSeekIdByHost.get(hostMessage.id)
    if (deepSeekId !== undefined) boundUserIds.add(deepSeekId)
  }
  const knownServerIds = new Set(deepSeekIdByHost.values())
  const appends: ReconcileAppend[] = []
  for (const server of input.messages) {
    if (server.role !== 'ASSISTANT') continue
    if (knownServerIds.has(server.messageId)) continue
    if (server.parentId === null || !boundUserIds.has(server.parentId)) continue
    // Server work in progress → wait for it rather than record half an answer.
    if (server.status === 'WIP') continue
    if (server.responseText === null || server.responseText === '') continue
    appends.push({
      role: 'assistant',
      content: server.responseText,
      format: 'text',
      status: 'finished',
      deepSeekMessageId: server.messageId,
      sessionId: input.sessionId,
      ...(server.reasoningText !== null && server.reasoningText !== ''
        ? { reasoning: { content: server.reasoningText, format: 'text' as ChatFormat } }
        : {}),
    })
  }

  return { kind: 'apply', level: identity.level, patch: { bindings: identity.bindings, patches, appends } }
}

/**
 * What one finished/partial assistant message may become (design §4/§8):
 *
 *   - `interrupted` (a Stop) is authoritative — never auto-finished, never filled
 *   - server `WIP` → no shorten, no upgrade
 *   - server text/reasoning may only EXTEND the Host's (`server >= host`)
 *   - a shorter server message keeps the Host untouched (no going backwards)
 *   - divergence is a safe-fail for the whole plan
 */
function planAssistantPatch(
  host: ChatMessage,
  server: DeepSeekHistoryMessage,
): ReconcilePatch | 'diverged' | undefined {
  if (host.status === 'interrupted') return undefined
  if (server.status === 'WIP') return undefined

  const serverContent = server.responseText ?? ''
  let content: string | undefined
  let contentShorter = false
  if (host.content !== serverContent) {
    if (isStrictPrefix(host.content, serverContent) || host.content === '') content = serverContent
    else if (host.content.startsWith(serverContent)) contentShorter = true
    else return 'diverged'
  }

  const serverReasoning = server.reasoningText
  let reasoning: ChatReasoning | undefined
  let reasoningShorter = false
  const hostReasoning = host.reasoning?.content
  if (serverReasoning !== null && serverReasoning !== '' && serverReasoning !== hostReasoning) {
    if (host.reasoning === undefined) {
      reasoning = { content: serverReasoning, format: 'text' }
    } else if (isStrictPrefix(host.reasoning.content, serverReasoning)) {
      reasoning = { content: serverReasoning, format: host.reasoning.format }
    } else if (host.reasoning.content.startsWith(serverReasoning)) reasoningShorter = true
    else return 'diverged'
  }

  const grew = content !== undefined || reasoning !== undefined
  const shorter = contentShorter || reasoningShorter
  // A shorter server reply means the round ended unexpectedly — keep the Host as
  // it is, status included (design §8 "保持 Host，不倒退").
  const finished = server.status === 'FINISHED' && !shorter && (host.status ?? 'finished') !== 'finished'

  if (!grew && !finished) return undefined
  return {
    id: host.id,
    ...(content !== undefined ? { content } : {}),
    ...(reasoning !== undefined ? { reasoning } : {}),
    ...(finished ? { status: 'finished' as MessageStatus } : {}),
  }
}

// --- stability -----------------------------------------------------------------

/** The shape a stability check needs — a snapshot read satisfies it directly. */
export interface HistorySnapshotLike {
  currentMessageId: number | null
  messages: readonly DeepSeekHistoryMessage[]
}

// --- orchestration ------------------------------------------------------------

export interface ReconcileRunDeps {
  browser: ReconcileHistoryReader
  sessionId: string
  hostMessages: readonly ChatMessage[]
  anchor?: CommittedAnchor
  /**
   * Re-checked right before the plan is handed back: the caller's own freshness
   * facts (current session still the target, page epoch unchanged, no newer
   * reconcile started). A stale run returns `skipped` and writes nothing.
   */
  isFresh: () => boolean
  /** Injectable clock / sleep (tests drive the wait deterministically). */
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  budgetMs?: number
  intervalMs?: number
}

export type ReconcileRunResult =
  | { kind: 'plan'; level: IdentityLevel; patch: ChatReconcilePatch }
  | { kind: 'skipped'; reason: string }

/**
 * Read → (bounded stability wait) → validate → plan. The caller owns the page
 * guard and the apply; this function owns every rule that decides WHETHER a plan
 * may exist.
 *
 * The stability wait only runs while the server still reports `WIP`, and it ends
 * as soon as two consecutive reads agree — never a fixed sleep (design §11). When
 * the whole-reconcile budget runs out the run is skipped: the Host transcript is
 * kept exactly as it is (design §11 "超预算 → 保留 Host").
 *
 * The cached IDB entry can be BEHIND the server: the frontend writes it once per
 * page load and never again, so a crash mid-turn leaves a `WIP` assistant frozen
 * in place forever (measured). When the snapshot is measurably behind — the
 * committed turn is absent, or it converged while still `WIP` — the page is asked
 * to re-fetch ONCE (`refreshHistoryView`), then the entry is read again. At most
 * one refresh per run, inside the same budget: never a reload loop.
 */
export async function readAndPlanReconcile(deps: ReconcileRunDeps): Promise<ReconcileRunResult> {
  const now = deps.now ?? ((): number => Date.now())
  const sleep = deps.sleep ?? ((ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)))
  const budgetMs = deps.budgetMs ?? RECONCILE_TOTAL_BUDGET_MS
  const intervalMs = deps.intervalMs ?? RECONCILE_STABILITY_INTERVAL_MS
  const deadline = now() + budgetMs
  let refreshed = false

  for (;;) {
    // ONE deadline for everything below: every read and the refresh itself receive
    // whatever is LEFT, so their real timeout is min(their cap, remaining) and no
    // sequence of steps can push the run past the reconcile budget.
    const firstBudget = deadline - now()
    if (firstBudget <= 0) return { kind: 'skipped', reason: 'reconcile budget exhausted' }
    let ticket = await deps.browser.readHistorySnapshot(deps.sessionId, firstBudget)
    if (deadline - now() <= 0) return { kind: 'skipped', reason: 'reconcile budget exhausted' }
    let previous: string | undefined
    while (ticket.read.kind === 'snapshot' && hasPendingServerWork(ticket.read.messages)) {
      const fingerprint = snapshotFingerprint(ticket.read)
      // Two identical reads in a row: the server stopped moving — plan from it.
      if (fingerprint === previous) break
      const remaining = deadline - now()
      if (remaining <= 0) return { kind: 'skipped', reason: 'reconcile budget exhausted' }
      previous = fingerprint
      await sleep(Math.min(intervalMs, remaining))
      const readBudget = deadline - now()
      if (readBudget <= 0) return { kind: 'skipped', reason: 'reconcile budget exhausted' }
      ticket = await deps.browser.readHistorySnapshot(deps.sessionId, readBudget)
      if (deadline - now() <= 0) return { kind: 'skipped', reason: 'reconcile budget exhausted' }
    }

    if (ticket.read.kind !== 'snapshot') {
      // `malformed` / `no-entry` describe the ENTRY, not its age — a reload cannot
      // change that, so no refresh is spent on it.
      return { kind: 'skipped', reason: `history unavailable (${ticket.read.reason})` }
    }

    const suspicion = snapshotBehindServer(ticket.read, deps.anchor)
    const refresh = deps.browser.refreshHistoryView
    if (suspicion !== null && !refreshed && refresh !== undefined) {
      const remaining = deadline - now()
      if (remaining <= 0) {
        // Nothing left to spend — plan from what we have (every rule still applies).
      } else if (remaining > REFRESH_HEADROOM_MS) {
        // The cached entry is FROZEN, so waiting on it observes nothing. Waiting is
        // still the only way to let the SERVER finish, and the single refresh is our
        // only window onto it — so hold the refresh back until just enough budget
        // remains for it, then spend it.
        await sleep(Math.min(intervalMs, remaining - REFRESH_HEADROOM_MS))
        continue
      } else {
        refreshed = true
        try {
          // The refresh — reload AND the settle window — lives inside what is left.
          await refresh(remaining)
        } catch {
          // A refresh that fails leaves exactly the snapshot we already had — the
          // run continues and every safety rule below still applies.
        }
        continue
      }
    }

    // Freshness LAST: everything above was read-only, this is the first write.
    if (!deps.isFresh() || !ticket.current()) return { kind: 'skipped', reason: 'stale snapshot' }

    const plan = buildReconcilePlan({
      sessionId: deps.sessionId,
      messages: ticket.read.messages,
      hostMessages: deps.hostMessages,
      anchor: deps.anchor,
    })
    if (deadline - now() <= 0) return { kind: 'skipped', reason: 'reconcile budget exhausted' }
    if (plan.kind !== 'apply') return { kind: 'skipped', reason: plan.reason }
    return { kind: 'plan', level: plan.level, patch: plan.patch }
  }
}

/**
 * Why the cached snapshot cannot be trusted as the CURRENT server state, or
 * `null` when it looks settled. Two measurable symptoms (Phase 20B1 review):
 *
 *   - the committed turn is not in the entry at all (the page was loaded before
 *     the server wrote it), or
 *   - the last message is still `WIP` although two reads agreed (the frontend
 *     cached the work-in-progress and never updated it).
 */
export function snapshotBehindServer(
  snapshot: HistorySnapshotLike,
  anchor: CommittedAnchor | undefined,
): string | null {
  if (anchor !== undefined) {
    const found = snapshot.messages.some(
      (message) => message.role === 'USER' && message.parentId === anchor.parentMessageId,
    )
    if (!found) return 'committed turn missing from the cached snapshot'
  }
  const last = snapshot.messages[snapshot.messages.length - 1]
  if (last !== undefined && last.status === 'WIP') return 'cached snapshot still WIP'
  return null
}

/** Whether the server still reports unfinished work (design §8/§11). */
export function hasPendingServerWork(messages: readonly DeepSeekHistoryMessage[]): boolean {
  return messages.some((message) => message.status === 'WIP')
}

/**
 * What a stability wait compares between two consecutive reads: the session's
 * `current_message_id`, the message count, and the last message's length. Equal
 * fingerprints twice in a row mean the server stopped moving (design §11).
 */
export function snapshotFingerprint(snapshot: HistorySnapshotLike): string {
  const last = snapshot.messages[snapshot.messages.length - 1]
  const lastLength = last === undefined ? 0 : (last.responseText?.length ?? 0)
  return `${snapshot.currentMessageId ?? 'null'}|${snapshot.messages.length}|${lastLength}`
}
