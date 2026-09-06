import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useLang } from '../i18n/LangContext'
import { ApiError, sendAiChat, type AiChatMessage } from '../lib/api'

const ACCENT = '#22D3EE'

interface DisplayMessage extends AiChatMessage {
  actions?: string[]
}

export default function AiAssistant() {
  const { t, dir } = useLang()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, sending])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text || sending) return

    const nextMessages: DisplayMessage[] = [...messages, { role: 'user', content: text }]
    setMessages(nextMessages)
    setInput('')
    setSending(true)
    setError(null)

    try {
      const res = await sendAiChat(nextMessages.map(({ role, content }) => ({ role, content })))
      setMessages((prev) => [...prev, { role: 'assistant', content: res.reply, actions: res.actions }])
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) setError(t.aiChat.notConfigured)
      else if (err instanceof ApiError) setError(err.message)
      else setError(t.aiChat.genericError)
    } finally {
      setSending(false)
    }
  }

  function handleClear() {
    setMessages([])
    setError(null)
  }

  return (
    <div dir={dir} className="fixed bottom-6 end-6 z-50 flex flex-col items-end gap-3">
      {open && (
        <div className="flex h-[32rem] w-96 max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-2xl border border-cyan-400/20 bg-slate-950/95 shadow-2xl backdrop-blur">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <span className="text-sm font-bold text-slate-100">{t.aiChat.title}</span>
            <div className="flex items-center gap-3">
              {messages.length > 0 && (
                <button onClick={handleClear} className="text-xs text-slate-400 hover:underline">
                  {t.aiChat.clearChat}
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="text-slate-400 hover:text-slate-200"
                aria-label="close"
              >
                ✕
              </button>
            </div>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {messages.length === 0 && (
              <div className="mt-6 text-center text-xs leading-6 text-slate-500">{t.aiChat.emptyState}</div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-2 text-sm ${
                    m.role === 'user' ? 'text-slate-950' : 'border border-white/10 bg-white/5 text-slate-100'
                  }`}
                  style={m.role === 'user' ? { backgroundColor: ACCENT } : undefined}
                >
                  {m.content}
                  {m.actions && m.actions.length > 0 && (
                    <div className="mt-2 border-t border-white/10 pt-2 text-[11px] text-slate-400">
                      <div className="mb-1 font-bold">{t.aiChat.actionsLabel}</div>
                      <ul className="list-inside list-disc space-y-0.5">
                        {m.actions.map((a, ai) => (
                          <li key={ai}>{a}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {sending && <div className="text-xs text-slate-500">{t.aiChat.thinking}</div>}
            {error && <div className="text-xs text-red-400">{error}</div>}
          </div>

          <form onSubmit={handleSubmit} className="flex items-center gap-2 border-t border-white/10 p-3">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t.aiChat.placeholder}
              className="flex-1 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/60"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              className="rounded-lg px-4 py-2 text-sm font-bold text-slate-950 disabled:opacity-50"
              style={{ backgroundColor: ACCENT }}
            >
              {t.aiChat.send}
            </button>
          </form>
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={t.aiChat.buttonLabel}
        className="flex h-14 w-14 items-center justify-center rounded-full text-2xl text-slate-950 shadow-lg transition-transform hover:scale-105"
        style={{ background: `linear-gradient(135deg, ${ACCENT}, #0891b2)` }}
      >
        {open ? '✕' : '✦'}
      </button>
    </div>
  )
}
