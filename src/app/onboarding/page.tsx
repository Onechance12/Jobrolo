'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Bot, User, Loader2, Send, ArrowRight, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Message { role: 'user' | 'assistant'; content: string; timestamp: string }

export default function OnboardingPage() {
  const router = useRouter()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)  // start true while fetching initial greeting
  const [sending, setSending] = useState(false)
  const [confidence, setConfidence] = useState(0)
  const [completed, setCompleted] = useState(false)
  const [authChecked, setAuthChecked] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Auth check + load existing onboarding state
  useEffect(() => {
    (async () => {
      try {
        const meRes = await fetch('/api/auth/me', { credentials: 'same-origin' })
        if (!meRes.ok) { router.push('/signup'); return }
        const meData = await meRes.json()
        if (!meData.authenticated) { router.push('/signup'); return }
        if (meData.onboardingComplete) { router.push('/'); return }

        // Load existing onboarding conversation
        const statusRes = await fetch('/api/onboarding/status', { credentials: 'same-origin' })
        if (statusRes.ok) {
          const statusData = await statusRes.json()
          if (statusData.messages?.length > 0) {
            setMessages(statusData.messages)
            setConfidence(statusData.confidence ?? 0)
          }
        }
      } catch (err) {
        console.error('[onboarding] init error:', err)
      } finally {
        setAuthChecked(true)
        setLoading(false)
      }
    })()
  }, [router])

  // Auto-scroll on new messages
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, sending])

  // Focus input when ready
  useEffect(() => {
    if (!loading && !sending && inputRef.current) inputRef.current.focus()
  }, [loading, sending])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || sending) return
    setSending(true)
    setInput('')

    // Optimistic: add user message immediately
    const userMsg: Message = { role: 'user', content: text, timestamp: new Date().toISOString() }
    setMessages(prev => [...prev, userMsg])

    try {
      const res = await fetch('/api/onboarding/chat', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      })
      const bodyText = await res.text()
      let data: { message?: string; confidence?: number; completed?: boolean; error?: string } = {}
      try {
        data = bodyText ? JSON.parse(bodyText) : {}
      } catch {
        data = { error: bodyText || 'Invalid onboarding response' }
      }

      if (!res.ok) {
        const serverMessage = data.message || data.error || `Onboarding request failed (${res.status})`
        const errMsg: Message = { role: 'assistant', content: serverMessage, timestamp: new Date().toISOString() }
        setMessages(prev => [...prev, errMsg])
        if (res.status === 401) setTimeout(() => router.push('/login'), 1500)
        return
      }

      const agentMsg: Message = { role: 'assistant', content: data.message ?? 'Got it. Tell me a little more about your business.', timestamp: new Date().toISOString() }
      setMessages(prev => [...prev, agentMsg])
      setConfidence(data.confidence ?? 0)
      if (data.completed) {
        setCompleted(true)
        // Brief delay so user sees the final message
        setTimeout(() => { router.push('/'); router.refresh() }, 2500)
      }
    } catch (err) {
      console.error('[onboarding] send error:', err)
      const errMsg: Message = { role: 'assistant', content: 'I could not reach the onboarding endpoint from this browser. Refresh once and try again. If it keeps happening, check the Render logs for [onboarding/chat].', timestamp: new Date().toISOString() }
      setMessages(prev => [...prev, errMsg])
    } finally {
      setSending(false)
    }
  }, [input, sending, router])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="Jobrolo" className="w-8 h-8 rounded-lg object-cover" />
            <div>
              <div className="font-semibold text-slate-900 text-sm leading-tight">Jobrolo Onboarding</div>
              <div className="text-[11px] text-slate-500 leading-tight">Setting up your workspace</div>
            </div>
          </div>
          {/* Confidence indicator (internal, not for user-facing display) */}
          <div className="flex items-center gap-2">
            <div className="w-24 h-1.5 bg-slate-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-400 to-blue-600 transition-all duration-500"
                style={{ width: `${Math.min(100, confidence)}%` }}
              />
            </div>
            <span className="text-[10px] text-slate-500 font-medium">{Math.round(confidence)}%</span>
          </div>
        </div>
      </header>

      {/* Chat area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
            </div>
          ) : (
            <AnimatePresence>
              {messages.map((m, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn('flex gap-3', m.role === 'user' ? 'flex-row-reverse' : 'flex-row')}
                >
                  <div className={cn(
                    'flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center',
                    m.role === 'user' ? 'bg-slate-200 text-slate-700' : 'bg-gradient-to-br from-blue-600 to-blue-800 text-white'
                  )}>
                    {m.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                  </div>
                  <div className={cn(
                    'rounded-2xl px-4 py-3 max-w-[80%] text-[15px] leading-relaxed whitespace-pre-wrap',
                    m.role === 'user' ? 'bg-blue-600 text-white rounded-tr-md' : 'bg-white border border-slate-200 text-slate-800 rounded-tl-md'
                  )}>
                    {m.content}
                  </div>
                </motion.div>
              ))}
              {sending && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex gap-3">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-blue-600 to-blue-800 text-white flex items-center justify-center">
                    <Bot className="w-4 h-4" />
                  </div>
                  <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-md px-4 py-3 flex items-center gap-2 text-slate-400 text-sm">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>Thinking…</span>
                  </div>
                </motion.div>
              )}
              {completed && (
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="flex items-center gap-2 text-blue-700 bg-blue-50 border border-blue-200 rounded-xl p-4">
                  <Sparkles className="w-5 h-5 flex-shrink-0" />
                  <div>
                    <div className="font-medium">Your workspace is ready!</div>
                    <div className="text-sm text-blue-600">Taking you to your dashboard…</div>
                  </div>
                  <ArrowRight className="w-4 h-4 ml-auto animate-pulse" />
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </div>
      </div>

      {/* Input */}
      {!completed && (
        <div className="border-t border-slate-200 bg-white">
          <div className="max-w-2xl mx-auto px-4 py-3 flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Tell me about your business…"
              rows={1}
              disabled={sending}
              className="flex-1 resize-none bg-white border border-slate-300 rounded-lg px-3 py-2.5 text-[16px] leading-6 text-slate-950 caret-slate-950 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 disabled:opacity-50 max-h-32 min-h-[44px]"
              style={{ height: 'auto' }}
              onInput={e => {
                const ta = e.target as HTMLTextAreaElement
                ta.style.height = 'auto'
                ta.style.height = Math.min(ta.scrollHeight, 128) + 'px'
              }}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || sending}
              className="flex-shrink-0 p-2.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 min-w-[44px] min-h-[44px] flex items-center justify-center"
              aria-label="Send"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
