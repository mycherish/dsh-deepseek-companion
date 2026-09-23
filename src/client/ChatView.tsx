import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  fetchChatSessions,
  sendChatMessage,
  setDeepThink,
  setSearch,
  showDeepSeekBrowser,
  startNewChat,
  stopChatMessage,
  subscribeCompanionState,
  switchChatSession,
} from './api.ts'
import { remarkCitations } from './remark-citations.ts'
import { STOP_PHASE_LABEL, initialStopUiState, reduceStopUi, stopPhase } from './stop-state.ts'
import type {
  ChatFormat,
  ChatMessage,
  ChatReasoning,
  ChatSessionSummary,
  Citation,
  ComposerToggleState,
  DeepSeekStatus,
  DeepThinkState,
  SearchState,
} from '../shared/state.ts'

const rootStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minHeight: 0,
  width: '100%',
  gap: 8,
}

const hintStyle: CSSProperties = {
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 13,
  textAlign: 'center',
  padding: 8,
  lineHeight: '20px',
}

const messagesStyle: CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  overflowY: 'auto',
  minHeight: 0,
  width: '100%',
  textAlign: 'left',
}

const messageRowStyle = (role: 'user' | 'assistant', format: ChatFormat): CSSProperties => ({
  alignSelf: role === 'user' ? 'flex-end' : 'flex-start',
  // Markdown replies can hold tables/code, so they get the full column width.
  maxWidth: format === 'markdown' ? '100%' : '85%',
  padding: '6px 10px',
  borderRadius: 10,
  background: role === 'user' ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent',
  color: 'var(--dsw-alias-label-primary)',
  whiteSpace: format === 'markdown' ? 'normal' : 'pre-wrap',
  wordBreak: 'break-word',
  fontSize: 13,
  lineHeight: '20px',
})

const errorStyle: CSSProperties = {
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 12,
  textAlign: 'center',
  padding: '2px 8px',
  lineHeight: '18px',
}

const inputRowStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'flex-end',
  flexShrink: 0,
}

const inputStyle: CSSProperties = {
  flex: 1,
  minHeight: 36,
  padding: '8px 10px',
  border: '1px solid var(--dsw-alias-border-l3)',
  borderRadius: 8,
  background: 'transparent',
  color: 'var(--dsw-alias-label-primary)',
  fontSize: 13,
  resize: 'none',
  fontFamily: 'inherit',
}

const sendButtonStyle: CSSProperties = {
  padding: '7px 14px',
  border: 'none',
  borderRadius: 8,
  background: 'var(--dsw-alias-interactive-bg-hover)',
  color: 'var(--dsw-alias-label-primary)',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 500,
}

/**
 * While a reply streams the same slot becomes the stop control (Phase 07J).
 * Bordered rather than filled, so it is clearly actionable without competing
 * with the composer.
 */
const stopButtonStyle: CSSProperties = {
  padding: '7px 14px',
  border: '1px solid var(--dsw-alias-label-primary)',
  borderRadius: 8,
  background: 'transparent',
  color: 'var(--dsw-alias-label-primary)',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 500,
}

// --- Composer switches: Deep Think (07G) + Search (07H) ----------------------
// Quiet pills above the composer. They share one visual language and never
// compete with the send button.

const controlsRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexShrink: 0,
  flexWrap: 'wrap',
}

const togglePillStyle = (enabled: boolean, disabled: boolean): CSSProperties => ({
  padding: '3px 10px',
  borderRadius: 999,
  border: `1px solid ${enabled ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-border-l3)'}`,
  background: enabled ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent',
  color: enabled ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.5 : 1,
  fontSize: 12,
  lineHeight: '18px',
  fontFamily: 'inherit',
})

const toggleHintStyle: CSSProperties = {
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 11,
  lineHeight: '18px',
}

/**
 * 「新建聊天」(Phase 07L): a quiet pill on the far right of the controls row —
 * near the composer, without competing with it. It only asks the Host; the
 * transcript is cleared by the Host's push, never locally.
 */
const newChatButtonStyle = (disabled: boolean): CSSProperties => ({
  marginLeft: 'auto',
  padding: '3px 10px',
  borderRadius: 999,
  border: '1px solid var(--dsw-alias-border-l3)',
  background: 'transparent',
  color: disabled ? 'var(--dsw-alias-label-secondary)' : 'var(--dsw-alias-label-primary)',
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.5 : 1,
  fontSize: 12,
  lineHeight: '18px',
  fontFamily: 'inherit',
})

// --- History sessions (Phase 08) ---------------------------------------------
// A lightweight list: titles + the current marker, one click to switch. The
// Host stays the only source of the transcript — this view never caches another
// conversation's messages.

const historyButtonStyle = (disabled: boolean): CSSProperties => ({
  padding: '3px 10px',
  borderRadius: 999,
  border: '1px solid var(--dsw-alias-border-l3)',
  background: 'transparent',
  color: disabled ? 'var(--dsw-alias-label-secondary)' : 'var(--dsw-alias-label-primary)',
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.5 : 1,
  fontSize: 12,
  lineHeight: '18px',
  fontFamily: 'inherit',
})

/**
 * Phase 08 UI fix: the history list is an OVERLAY, not a flex sibling — it
 * floats ABOVE the transcript instead of squeezing it, so opening it costs the
 * conversation no height at all. Anchored to the composer row (`bottom: 100%`),
 * which keeps it in place whatever the panel height is; closed by picking an
 * entry, clicking outside, or Esc.
 */
const historyOverlayStyle: CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: '100%',
  marginBottom: 8,
  zIndex: 20,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  maxHeight: 'min(260px, 50vh)',
  overflowY: 'auto',
  padding: 6,
  border: '1px solid var(--dsw-alias-border-l3)',
  borderRadius: 10,
  // DSH's overlay token is opaque in both themes; the fallbacks keep the panel
  // opaque even if a token is ever missing (a see-through list over the
  // transcript would be worse than a plain background).
  background: 'var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1, Canvas))',
  boxShadow: '0 6px 20px rgba(0, 0, 0, 0.22)',
}

/**
 * The composer BLOCK (controls row + input row) is the floating list's
 * positioning context. Anchoring there makes the list open ABOVE the controls,
 * so 「收起历史」 and the rest of the row stay visible — and clickable to close
 * the list — instead of being covered by it.
 */
const composerAreaStyle: CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  flexShrink: 0,
}

const historyItemStyle = (active: boolean, disabled: boolean): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  // The overlay is a flex column with a max height: without this, a long list
  // gets its entries SHRUNK to fit and every label is clipped vertically. The
  // entries keep their height; the overlay scrolls instead.
  flexShrink: 0,
  padding: '4px 8px',
  border: 'none',
  borderRadius: 6,
  background: active ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent',
  color: 'var(--dsw-alias-label-primary)',
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled && !active ? 0.6 : 1,
  fontSize: 12,
  lineHeight: '18px',
  fontFamily: 'inherit',
  textAlign: 'left',
  width: '100%',
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
})

const historyActiveStyle: CSSProperties = {
  marginLeft: 'auto',
  flexShrink: 0,
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 11,
}

const historyTitleStyle: CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const historyHintStyle: CSSProperties = {
  padding: '2px 6px',
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 12,
  lineHeight: '18px',
  flexShrink: 0,
}

/** One DeepSeek composer switch, mirrored from the Host (never optimistic). */
function ComposerTogglePill({
  label,
  state,
  disabled,
  title,
  onToggle,
}: {
  label: string
  state: ComposerToggleState
  disabled: boolean
  title: string
  onToggle: (next: boolean) => void
}): ReactNode {
  return (
    <button
      type="button"
      style={togglePillStyle(state.enabled, disabled)}
      disabled={disabled}
      aria-pressed={state.enabled}
      title={title}
      onClick={() => onToggle(!state.enabled)}
    >
      {label}
    </button>
  )
}

// --- Markdown rendering (Phase 07E) -----------------------------------------
// Only DSH tokens are used; DeepSeek's private classes/CSS are never copied.

const MONO_FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

const markdownRootStyle: CSSProperties = {
  fontSize: 13,
  lineHeight: '21px',
  color: 'var(--dsw-alias-label-primary)',
  overflowWrap: 'anywhere',
}

const headingStyle = (fontSize: number): CSSProperties => ({
  fontSize,
  fontWeight: 600,
  lineHeight: '24px',
  margin: '12px 0 6px',
  color: 'var(--dsw-alias-label-primary)',
})

const listStyle: CSSProperties = { margin: '6px 0', paddingLeft: 20 }

const codeBlockStyle: CSSProperties = {
  fontFamily: MONO_FONT,
  fontSize: 12,
  lineHeight: '18px',
}

const inlineCodeStyle: CSSProperties = {
  ...codeBlockStyle,
  padding: '1px 4px',
  borderRadius: 4,
  background: 'var(--dsw-alias-interactive-bg-hover)',
}

const preStyle: CSSProperties = {
  margin: '6px 0',
  padding: 10,
  borderRadius: 8,
  background: 'var(--dsw-alias-interactive-bg-hover)',
  overflowX: 'auto',
}

// --- Citation badges (Phase 07I) ---------------------------------------------
// A resolved DeepSeek source marker renders as a small, quiet superscript pill.
// Nothing more: no card, no tooltip, no favicon.

/** Class the remark plugin puts on a resolved citation anchor. */
const CITATION_CLASS = 'dsc-citation'

const citationLinkStyle: CSSProperties = {
  color: 'var(--dsw-alias-label-secondary)',
  background: 'var(--dsw-alias-interactive-bg-hover)',
  borderRadius: 3,
  padding: '0 3px',
  fontSize: 11,
  lineHeight: '15px',
  verticalAlign: 'super',
  textDecoration: 'none',
  whiteSpace: 'nowrap',
}

/**
 * A citation badge is marked by the remark plugin's class; should that attribute
 * ever be dropped we still recognise it by its `[N]` label.
 */
function isCitationAnchor(className: unknown, children: ReactNode): boolean {
  if (typeof className === 'string' && className.split(/\s+/).includes(CITATION_CLASS)) return true
  return typeof children === 'string' && /^\[\d+\]$/.test(children)
}

const markdownComponents: Components = {
  h1: ({ children }) => <h1 style={headingStyle(17)}>{children}</h1>,
  h2: ({ children }) => <h2 style={headingStyle(15)}>{children}</h2>,
  h3: ({ children }) => <h3 style={headingStyle(14)}>{children}</h3>,
  h4: ({ children }) => <h4 style={headingStyle(13)}>{children}</h4>,
  h5: ({ children }) => <h5 style={headingStyle(13)}>{children}</h5>,
  h6: ({ children }) => <h6 style={headingStyle(13)}>{children}</h6>,
  p: ({ children }) => <p style={{ margin: '6px 0' }}>{children}</p>,
  ul: ({ children }) => <ul style={listStyle}>{children}</ul>,
  ol: ({ children }) => <ol style={listStyle}>{children}</ol>,
  li: ({ children }) => <li style={{ margin: '2px 0' }}>{children}</li>,
  blockquote: ({ children }) => (
    <blockquote
      style={{
        margin: '6px 0',
        paddingLeft: 10,
        borderLeft: '2px solid var(--dsw-alias-border-l3)',
        color: 'var(--dsw-alias-label-secondary)',
      }}
    >
      {children}
    </blockquote>
  ),
  a: ({ href, children, className }) => {
    if (isCitationAnchor(className, children)) {
      return (
        <a href={href} target="_blank" rel="noreferrer" style={citationLinkStyle}>
          {children}
        </a>
      )
    }
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        style={{ color: 'var(--dsw-alias-label-primary)', textDecoration: 'underline' }}
      >
        {children}
      </a>
    )
  },
  strong: ({ children }) => <strong style={{ fontWeight: 600 }}>{children}</strong>,
  em: ({ children }) => <em style={{ fontStyle: 'italic' }}>{children}</em>,
  del: ({ children }) => (
    <del style={{ textDecoration: 'line-through', color: 'var(--dsw-alias-label-secondary)' }}>{children}</del>
  ),
  hr: () => (
    <hr style={{ border: 'none', borderTop: '1px solid var(--dsw-alias-border-l3)', margin: '10px 0' }} />
  ),
  pre: ({ children }) => <pre style={preStyle}>{children}</pre>,
  code: ({ className, children }) => {
    const text = typeof children === 'string' ? children : Array.isArray(children) ? children.join('') : ''
    // A fenced block carries a `language-*` class when a language is given and
    // always ends with a newline; inline code has neither.
    const isBlock = /language-/.test(className ?? '') || text.includes('\n')
    if (isBlock) return <code style={codeBlockStyle}>{children}</code>
    return <code style={inlineCodeStyle}>{children}</code>
  },
  table: ({ children }) => (
    <div style={{ overflowX: 'auto', margin: '6px 0' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th
      style={{
        border: '1px solid var(--dsw-alias-border-l3)',
        padding: '4px 8px',
        textAlign: 'left',
        fontWeight: 600,
      }}
    >
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td style={{ border: '1px solid var(--dsw-alias-border-l3)', padding: '4px 8px' }}>{children}</td>
  ),
}

function MarkdownBlock({ content, citations }: { content: string; citations?: Citation[] }): ReactNode {
  // marker number → resolved url. Only rebuilt when the citations change, so a
  // late hydration simply re-renders the same block once (Phase 07I).
  const urls = useMemo(
    () => new Map((citations ?? []).map((entry) => [entry.marker, entry.url] as const)),
    [citations],
  )
  return (
    <div style={markdownRootStyle}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, [remarkCitations, { urls }] as never]}
        components={markdownComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

// --- Reasoning display (Phase 07F) -------------------------------------------
// "Deep Think" output, shown ABOVE the answer with a weaker visual hierarchy.

const reasoningBoxStyle: CSSProperties = {
  marginBottom: 6,
  paddingLeft: 8,
  borderLeft: '2px solid var(--dsw-alias-border-l3)',
}

const reasoningSummaryStyle: CSSProperties = {
  cursor: 'pointer',
  userSelect: 'none',
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 12,
  lineHeight: '18px',
}

const reasoningBodyStyle: CSSProperties = {
  marginTop: 4,
  maxHeight: 220,
  overflowY: 'auto',
  overflowWrap: 'anywhere',
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 12,
  lineHeight: '18px',
}

const reasoningTextStyle: CSSProperties = {
  ...reasoningBodyStyle,
  whiteSpace: 'pre-wrap',
}

function ReasoningBlock({ reasoning }: { reasoning: ChatReasoning }): ReactNode {
  // Starts expanded so the thinking can be watched as it streams in; once the
  // user toggles it we simply follow their choice (no timers, no state machine).
  const [open, setOpen] = useState(true)
  return (
    <details
      open={open}
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
      style={reasoningBoxStyle}
    >
      <summary style={reasoningSummaryStyle}>思考过程</summary>
      {reasoning.format === 'markdown' ? (
        <div style={reasoningBodyStyle}>
          <MarkdownBlock content={reasoning.content} />
        </div>
      ) : (
        <div style={reasoningTextStyle}>{reasoning.content}</div>
      )}
    </details>
  )
}

/**
 * Minimal shared chat view used by the Dock, Float, and Pop-out (Phase 07C.1 →
 * 07E). The Host owns the authoritative message list; this view only mirrors it
 * from the realtime state stream, so all three surfaces always show the same
 * history. Assistant messages carrying `format: 'markdown'` (DeepSeek's raw
 * Markdown) are rendered with react-markdown + remark-gfm — never
 * `dangerouslySetInnerHTML`, and raw HTML stays disabled.
 */
export function ChatView({ origin }: { origin: string }): JSX.Element {
  const [status, setStatus] = useState<DeepSeekStatus>('checking')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  /**
   * Send/stop slot state (Phase 07J). `sending` is the Host's authoritative
   * `chat.sending`, folded in by the reducer below; `stopping` is the local flag
   * that keeps 停止中… on screen until that authoritative end actually arrives.
   */
  const [stopUi, setStopUi] = useState(initialStopUiState)
  const [input, setInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Composer-switch mirrors: the Host owns the truth; these copies only reflect
  // pushes (Search joined Deep Think in Phase 07H).
  const [deepThink, setDeepThinkState] = useState<DeepThinkState>({ available: false, enabled: false })
  const [togglingDeepThink, setTogglingDeepThink] = useState(false)
  const [search, setSearchState] = useState<SearchState>({ available: false, enabled: false })
  const [togglingSearch, setTogglingSearch] = useState(false)
  /** Local in-flight flag for 新建聊天 — blocks a second click until the Host answers (Phase 07L). */
  const [startingNew, setStartingNew] = useState(false)
  /** History panel (Phase 08): read-only list, loaded on demand, never cached. */
  const [historyOpen, setHistoryOpen] = useState(false)
  const [sessions, setSessions] = useState<ChatSessionSummary[] | null>(null)
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [switching, setSwitching] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  /** Floating history list and its trigger: a click inside either must NOT close it. */
  const historyPanelRef = useRef<HTMLDivElement>(null)
  const historyButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(
    () =>
      subscribeCompanionState(origin, (state) => {
        setStatus(state.deepseek.status)
        setMessages(state.chat.messages)
        setDeepThinkState(state.deepseek.deepThink)
        setSearchState(state.deepseek.search)
        // The reducer is the ONLY place that folds the Host's authoritative
        // `chat.sending` into the slot state — and the only thing that can clear
        // 停止中… once a stop was requested (Phase 07J).
        setStopUi((ui) => reduceStopUi(ui, { type: 'host-sending', sending: state.chat.sending }))
      }),
    [origin],
  )

  // `stopUi.sending` is the authoritative send state; `submitting` only covers
  // the short local window before the Host's first SSE push lands, so the button
  // stays disabled between the click and that push.
  const stopping = stopUi.stopping
  const busy = submitting || stopUi.sending
  const phase = stopPhase({ sending: busy, stopping })
  // Any in-flight page operation (sending, new chat, switch) blocks the other
  // entry points — the Host refuses the same combinations with 409.
  const pageBusy = busy || startingNew || switching

  // Keep the newest message in view.
  useEffect(() => {
    const list = listRef.current
    if (list !== null) list.scrollTop = list.scrollHeight
  }, [messages, busy])

  // The history list floats ABOVE the transcript (Phase 08 UI fix), so closing
  // it must be forgiving: an outside click or Esc puts it away, while a click
  // inside the list (an entry) is left to the entry itself. The listeners only
  // exist while the list is open; the 「历史会话」 button keeps toggling as before.
  useEffect(() => {
    if (!historyOpen) return undefined
    const onMouseDown = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (historyPanelRef.current?.contains(target) === true) return
      if (historyButtonRef.current?.contains(target) === true) return
      setHistoryOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setHistoryOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [historyOpen])

  const send = async (): Promise<void> => {
    const text = input.trim()
    if (text === '' || busy || status !== 'logged_in') return
    setInput('')
    setSubmitting(true)
    setError(null)
    try {
      // The Host appends the user + assistant messages; this view only waits.
      await sendChatMessage(origin, text)
    } catch (e) {
      setError(e instanceof Error ? e.message : '发送失败')
    } finally {
      setSubmitting(false)
    }
  }

  /**
   * Ask the Host to stop the current generation. `chat.sending` stays owned by
   * the Host: it flips to false when the send flow returns, and that push turns
   * this button back into 「发送」 on every surface at once.
   */
  const stop = async (): Promise<void> => {
    if (stopping || !busy) return
    setStopUi((ui) => reduceStopUi(ui, { type: 'click' }))
    setError(null)
    try {
      const stopped = await stopChatMessage(origin)
      // A SUCCESS deliberately keeps 停止中… : the Host is still finishing the
      // send (`chat.sending === true`), and the SSE push that reports it is over
      // is what clears the flag. A `stopped: false` answer stopped nothing, so it
      // must clear right away rather than sit on 停止中… .
      setStopUi((ui) => reduceStopUi(ui, { type: stopped ? 'request-succeeded' : 'request-refused' }))
    } catch (e) {
      // A failed request stopped nothing → clear the flag so the user can retry.
      setStopUi((ui) => reduceStopUi(ui, { type: 'request-failed' }))
      setError(e instanceof Error ? e.message : '停止失败')
    }
  }

  // A switch is disabled while a reply streams (the composer mode must not
  // change mid-generation) and when DeepSeek exposes no such switch at all.
  const toggleDisabled = (state: ComposerToggleState, toggling: boolean): boolean =>
    busy || toggling || !state.available

  /**
   * Ask the Host to start a new DeepSeek chat (Phase 07L). Nothing is cleared
   * here: the Host clicks the real DeepSeek control, confirms the switch and
   * then clears the shared transcript — that push empties all three surfaces.
   * `startingNew` only blocks a second click until the Host answers.
   */
  const startNew = async (): Promise<void> => {
    if (busy || startingNew) return
    setStartingNew(true)
    setError(null)
    try {
      await startNewChat(origin)
    } catch (e) {
      setError(e instanceof Error ? e.message : '新建聊天失败')
    } finally {
      setStartingNew(false)
    }
  }

  /** Load (or refresh) the DeepSeek history list. Read-only, never cached. */
  const loadSessions = async (): Promise<void> => {
    setLoadingSessions(true)
    setError(null)
    try {
      setSessions(await fetchChatSessions(origin))
    } catch (e) {
      setError(e instanceof Error ? e.message : '读取历史会话失败')
    } finally {
      setLoadingSessions(false)
    }
  }

  const toggleHistory = (): void => {
    if (pageBusy || loadingSessions) return
    const next = !historyOpen
    setHistoryOpen(next)
    if (next) void loadSessions()
  }

  /**
   * Ask the Host to open a history conversation. The Host clicks the real
   * DeepSeek link and replaces the transcript only after the switch is
   * confirmed — this view waits for the push, so all three surfaces stay in
   * sync. The list is refreshed afterwards so the current marker moves.
   */
  const switchTo = async (conversationId: string): Promise<void> => {
    if (pageBusy) return
    setSwitching(true)
    setError(null)
    try {
      await switchChatSession(origin, conversationId)
      await loadSessions()
      setHistoryOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : '切换会话失败')
    } finally {
      setSwitching(false)
    }
  }

  /**
   * Shared flow for both composer switches: the Host clicks the real DeepSeek
   * toggle and returns the state it read back; the SSE push carries the same
   * value, so nothing here is optimistic.
   */
  const toggleMode = async (mode: 'deepThink' | 'search', next: boolean): Promise<void> => {
    const target =
      mode === 'deepThink'
        ? {
            apply: setDeepThink,
            mirror: setDeepThinkState,
            setToggling: setTogglingDeepThink,
            label: '深度思考',
            state: deepThink,
            toggling: togglingDeepThink,
          }
        : {
            apply: setSearch,
            mirror: setSearchState,
            setToggling: setTogglingSearch,
            label: '智能搜索',
            state: search,
            toggling: togglingSearch,
          }
    if (toggleDisabled(target.state, target.toggling)) return
    target.setToggling(true)
    setError(null)
    try {
      target.mirror(await target.apply(origin, next))
    } catch (e) {
      setError(e instanceof Error ? e.message : `${target.label}切换失败`)
    } finally {
      target.setToggling(false)
    }
  }

  if (status === 'checking') {
    return (
      <div style={rootStyle}>
        <div style={hintStyle}>检测中…</div>
      </div>
    )
  }

  if (status === 'logged_out') {
    return (
      <div style={rootStyle}>
        <div style={hintStyle}>未登录 DeepSeek</div>
        <button
          type="button"
          style={sendButtonStyle}
          onClick={() => {
            void showDeepSeekBrowser(origin).catch(() => {})
          }}
        >
          登录 DeepSeek
        </button>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div style={rootStyle}>
        <div style={hintStyle}>检测失败</div>
      </div>
    )
  }

  return (
    <div style={rootStyle}>
      <div ref={listRef} style={messagesStyle}>
        {messages.length === 0 ? <div style={hintStyle}>输入消息开始对话</div> : null}
        {messages.map((message) => {
          const reasoning = message.role === 'assistant' ? message.reasoning : undefined
          // An assistant message with neither a body nor reasoning only exists
          // transiently while streaming (or right after a pre-send failure); it
          // would render as a stray blank bubble, so skip it — the "replying…"
          // placeholder below already covers the in-flight state.
          if (message.role === 'assistant' && message.content === '' && reasoning === undefined) return null
          return (
            <div key={message.id} style={messageRowStyle(message.role, message.format)}>
              {/* Thinking always sits ABOVE the answer. */}
              {reasoning !== undefined ? <ReasoningBlock reasoning={reasoning} /> : null}
              {message.content !== '' ? (
                message.role === 'assistant' && message.format === 'markdown' ? (
                  <MarkdownBlock content={message.content} citations={message.citations} />
                ) : (
                  message.content
                )
              ) : null}
            </div>
          )
        })}
        {busy ? <div style={messageRowStyle('assistant', 'text')}>正在回复…</div> : null}
      </div>
      {error !== null ? <div style={errorStyle}>{error}</div> : null}
      <div style={composerAreaStyle}>
        {/* History list (Phase 08 UI fix): an OVERLAY floating ABOVE the
            controls row, so opening it costs the transcript no height AND the
            controls stay usable (「收起历史」 keeps toggling it). Every entry is
            disabled while a page operation is in flight; the transcript itself
            is always the Host's push, never a local copy. */}
        {historyOpen ? (
          <div ref={historyPanelRef} style={historyOverlayStyle}>
            {sessions === null ? <div style={historyHintStyle}>{loadingSessions ? '读取中…' : '暂无数据'}</div> : null}
            {sessions !== null && sessions.length === 0 ? (
              <div style={historyHintStyle}>没有可用的历史会话</div>
            ) : null}
            {(sessions ?? []).map((session) => (
              <button
                key={session.id}
                type="button"
                style={historyItemStyle(session.active, pageBusy)}
                disabled={pageBusy || session.active}
                title={session.active ? '当前会话' : session.title}
                onClick={() => void switchTo(session.id)}
              >
                <span style={historyTitleStyle}>{session.title === '' ? '未命名会话' : session.title}</span>
                {session.active ? <span style={historyActiveStyle}>当前</span> : null}
              </button>
            ))}
          </div>
        ) : null}
        <div style={controlsRowStyle}>
          <ComposerTogglePill
            label="深度思考"
            state={deepThink}
            disabled={toggleDisabled(deepThink, togglingDeepThink)}
            title={deepThink.available ? '控制 DeepSeek 网页的「深度思考」开关' : 'DeepSeek 页面当前没有该开关'}
            onToggle={(next) => void toggleMode('deepThink', next)}
          />
          <ComposerTogglePill
            label="智能搜索"
            state={search}
            disabled={toggleDisabled(search, togglingSearch)}
            title={search.available ? '控制 DeepSeek 网页的「智能搜索」开关' : 'DeepSeek 页面当前没有该开关'}
            onToggle={(next) => void toggleMode('search', next)}
          />
          {deepThink.available || search.available ? null : <span style={toggleHintStyle}>开关不可用</span>}
          {/* History sessions (Phase 08): read-only list; switching goes through
              the same Host page guard as new chat. */}
          <button
            ref={historyButtonRef}
            type="button"
            style={historyButtonStyle(pageBusy || loadingSessions)}
            disabled={pageBusy || loadingSessions}
            title="查看并切换 DeepSeek 历史会话"
            onClick={toggleHistory}
          >
            {historyOpen ? '收起历史' : '历史会话'}
          </button>
          {/* New chat (Phase 07L): disabled while a reply streams, so a
              generation is never yanked out from under the page. */}
          <button
            type="button"
            style={newChatButtonStyle(pageBusy)}
            disabled={pageBusy}
            title="开始新的 DeepSeek 会话（清空当前聊天）"
            onClick={() => void startNew()}
          >
            {startingNew ? '新建中…' : '新建聊天'}
          </button>
        </div>
        <div style={inputRowStyle}>
          <textarea
            style={inputStyle}
            value={input}
            placeholder="输入消息…"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void send()
              }
            }}
          />
          {/* One slot, two roles: while a reply streams this is the stop control
              (Phase 07J). Both roles read `chat.sending` from the Host, so Dock /
              Float / Pop-out always agree. */}
          <button
            type="button"
            style={busy ? stopButtonStyle : sendButtonStyle}
            onClick={() => (busy ? void stop() : void send())}
            disabled={busy ? stopping : submitting || status !== 'logged_in'}
          >
            {STOP_PHASE_LABEL[busy ? phase : 'send']}
          </button>
        </div>
      </div>
    </div>
  )
}
