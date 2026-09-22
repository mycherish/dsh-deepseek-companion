import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  sendChatMessage,
  setDeepThink,
  setSearch,
  showDeepSeekBrowser,
  stopChatMessage,
  subscribeCompanionState,
} from './api.ts'
import { remarkCitations } from './remark-citations.ts'
import { STOP_PHASE_LABEL, initialStopUiState, reduceStopUi, stopPhase } from './stop-state.ts'
import type {
  ChatFormat,
  ChatMessage,
  ChatReasoning,
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
  const listRef = useRef<HTMLDivElement>(null)

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

  // Keep the newest message in view.
  useEffect(() => {
    const list = listRef.current
    if (list !== null) list.scrollTop = list.scrollHeight
  }, [messages, busy])

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
  )
}
