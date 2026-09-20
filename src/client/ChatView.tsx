import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { sendChatMessage, showDeepSeekBrowser, subscribeCompanionState } from './api.ts'
import type { ChatMessage, DeepSeekStatus } from '../shared/state.ts'

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

const messageRowStyle = (role: 'user' | 'assistant'): CSSProperties => ({
  alignSelf: role === 'user' ? 'flex-end' : 'flex-start',
  maxWidth: '85%',
  padding: '6px 10px',
  borderRadius: 10,
  background: role === 'user' ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent',
  color: 'var(--dsw-alias-label-primary)',
  whiteSpace: 'pre-wrap',
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
 * Minimal shared chat view used by the Dock, Float, and Pop-out (Phase 07C.1).
 * The Host owns the authoritative message list; this view only mirrors it from
 * the realtime state stream, so all three surfaces always show the same history.
 */
export function ChatView({ origin }: { origin: string }): JSX.Element {
  const [status, setStatus] = useState<DeepSeekStatus>('checking')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [hostSending, setHostSending] = useState(false)
  const [input, setInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(
    () =>
      subscribeCompanionState(origin, (state) => {
        setStatus(state.deepseek.status)
        setMessages(state.chat.messages)
        setHostSending(state.chat.sending)
      }),
    [origin],
  )

  // `hostSending` is the authoritative send state; `submitting` only covers the
  // short local window before the Host's first SSE push lands, so the button
  // stays disabled between the click and that push.
  const busy = submitting || hostSending

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
          // An empty assistant message only exists transiently while the reply
          // is streaming (or right after a pre-send failure); it would render
          // as a stray blank bubble, so skip it — the "replying…" placeholder
          // below already covers the in-flight state.
          if (message.role === 'assistant' && message.content === '') return null
          return (
            <div key={message.id} style={messageRowStyle(message.role)}>
              {message.content}
            </div>
          )
        })}
        {busy ? <div style={messageRowStyle('assistant')}>正在回复…</div> : null}
      </div>
      {error !== null ? <div style={errorStyle}>{error}</div> : null}
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
        <button type="button" style={sendButtonStyle} onClick={() => void send()} disabled={busy}>
          {busy ? '发送中' : '发送'}
        </button>
      </div>
    </div>
  )
}
