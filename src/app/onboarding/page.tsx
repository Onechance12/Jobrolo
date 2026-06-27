'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Bot, Loader2, Send, ArrowRight, Sparkles, LockKeyhole, MessageCircleQuestion } from 'lucide-react'
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
  const starterPrompts = [
    'How do I use Jobrolo?',
    'What can Jobrolo do for my roofing company?',
    'I was invited to a company',
    'Start setup',
    'Use my website to help set this up',
    'What info do you need from me?',
  ]

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
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSend()
    }
  }

  const insertPrompt = (prompt: string) => {
    if (sending) return
    setInput(prompt)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#050914]">
        <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#050914] text-slate-100">
      {/* Header */}
      <header className="border-b border-white/10 bg-[#070c18]/92 backdrop-blur-xl sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="Jobrolo" className="w-9 h-9 rounded-xl object-cover shadow-[0_0_24px_rgba(37,99,235,0.45)]" />
            <div>
              <div className="font-semibold text-white text-sm leading-tight">Jobrolo</div>
              <div className="text-[11px] text-slate-400 leading-tight">Onboarding mode</div>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-amber-300/25 bg-amber-400/10 px-3 py-1.5 text-[11px] font-medium text-amber-100">
            <LockKeyhole className="h-3.5 w-3.5" />
            Setup locked
          </div>
        </div>
      </header>

      <div className="border-b border-white/10 bg-[#071120]">
        <div className="max-w-2xl mx-auto px-4 py-3">
          <div className="rounded-2xl border border-blue-400/20 bg-blue-500/10 p-3 text-sm text-slate-200">
            <div className="flex items-center gap-2 font-medium text-white">
              <MessageCircleQuestion className="h-4 w-4 text-blue-300" />
              You’re already talking to Jobrolo.
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              Ask how it works, or let me finish your company setup. Job/chat/file tools unlock after onboarding is complete.
            </p>
          </div>
        </div>
      </div>

      {/* Chat area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-blue-300" />
            </div>
          ) : (
            <AnimatePresence>
              {messages.length <= 1 && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap gap-2 pb-2">
                  {starterPrompts.map(prompt => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => insertPrompt(prompt)}
                      className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-medium text-slate-200 hover:border-blue-300/40 hover:bg-blue-500/15"
                    >
                      {prompt}
                    </button>
                  ))}
                </motion.div>
              )}
              {messages.map((m, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn('flex gap-3', m.role === 'user' ? 'flex-row-reverse' : 'flex-row')}
                >
                  <div className={cn(
                    'flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center',
                    m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gradient-to-br from-cyan-500 to-blue-700 text-white shadow-[0_0_18px_rgba(37,99,235,0.45)]'
                  )}>
                    {m.role === 'user' ? <span className="text-xs font-semibold">You</span> : <Bot className="w-4 h-4" />}
                  </div>
                  <div className={cn(
                    'rounded-2xl px-4 py-3 max-w-[80%] text-[15px] leading-relaxed whitespace-pre-wrap',
                    m.role === 'user' ? 'bg-blue-600 text-white rounded-tr-md' : 'bg-[#0b1220] border border-white/10 text-slate-100 rounded-tl-md'
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
                  <div className="bg-[#0b1220] border border-white/10 rounded-2xl rounded-tl-md px-4 py-3 flex items-center gap-2 text-slate-400 text-sm">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>Thinking…</span>
                  </div>
                </motion.div>
              )}
              {completed && (
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="flex items-center gap-2 text-blue-100 bg-blue-500/10 border border-blue-300/20 rounded-xl p-4">
                  <Sparkles className="w-5 h-5 flex-shrink-0" />
                  <div>
                    <div className="font-medium">Your workspace is ready!</div>
                    <div className="text-sm text-blue-200">Taking you to Jobrolo…</div>
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
        <div className="border-t border-white/10 bg-[#070c18]">
          <div className="max-w-2xl mx-auto px-4 py-3 flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about Jobrolo or tell me about your company…"
              rows={1}
              disabled={sending}
              className="flex-1 resize-none bg-[#0b1220] border border-white/10 rounded-xl px-3 py-2.5 text-[16px] leading-6 text-white caret-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 disabled:opacity-50 max-h-32 min-h-[44px]"
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
