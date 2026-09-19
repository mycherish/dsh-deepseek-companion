import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { sendChatMessage, showDeepSeekBrowser, subscribeCompanionState } from './api.ts'
import type { DeepSeekStatus } from '../shared/state.ts'

interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
}

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
 * Minimal shared chat view used by the Dock, Float, and Pop-out (Phase 07C).
 * It owns its own message list and talks to the Host over the `/chat` route,
 * so none of the three surfaces duplicate the send/reply logic.
 */
export function ChatView({ origin }: { origin: string }): JSX.Element {
  const [status, setStatus] = useState<DeepSeekStatus>('checking')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => subscribeCompanionState(origin, (state) => setStatus(state.deepseek.status)), [origin])

  // Keep the newest message in view.
  useEffect(() => {
    const list = listRef.current
    if (list !== null) list.scrollTop = list.scrollHeight
  }, [messages, sending])

  const send = async (): Promise<void> => {
    const text = input.trim()
    if (text === '' || sending || status !== 'logged_in') return
    setMessages((prev) => [...prev, { role: 'user', text }])
    setInput('')
    setSending(true)
    setError(null)
    try {
      const reply = await sendChatMessage(origin, text)
      setMessages((prev) => [...prev, { role: 'assistant', text: reply }])
    } catch (e) {
      setError(e instanceof Error ? e.message : '发送失败')
    } finally {
      setSending(false)
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
        {messages.map((message, index) => (
          <div key={index} style={messageRowStyle(message.role)}>
            {message.text}
          </div>
        ))}
        {sending ? <div style={messageRowStyle('assistant')}>正在回复…</div> : null}
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
        <button type="button" style={sendButtonStyle} onClick={() => void send()} disabled={sending}>
          {sending ? '发送中' : '发送'}
        </button>
      </div>
    </div>
  )
}
