'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Bell, KeyRound, Loader2, LockKeyhole, LogIn, Menu, Mic, Plus, Send, UserPlus } from 'lucide-react'

type EntryMode = 'signup' | 'login' | 'join'
type LobbyMessage = { role: 'user' | 'assistant'; content: string }

function JobroloChatIcon({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const dim = size === 'sm' ? 'h-8 w-8' : 'h-10 w-10'
  return (
    <div className={`mt-1 flex ${dim} shrink-0 overflow-hidden rounded-full bg-slate-950 shadow-[0_0_18px_rgba(37,99,235,0.45)] ring-1 ring-blue-400/30`}>
      <img src="/logo.png" alt="Jobrolo" className="h-full w-full object-cover" />
    </div>
  )
}

const OUTCOME_PREVIEWS = [
  {
    label: 'Win faster follow-up',
    tone: 'border-blue-300/20 bg-blue-500/10 text-blue-100 hover:border-blue-200/45 hover:bg-blue-500/20',
    prompt: 'Show me how Jobrolo helps a contractor follow up faster, stop leads from slipping, and turn conversations into booked inspections or next steps.',
  },
  {
    label: 'Protect revenue',
    tone: 'border-emerald-300/20 bg-emerald-500/10 text-emerald-100 hover:border-emerald-200/45 hover:bg-emerald-500/20',
    prompt: 'Show me how Jobrolo helps protect revenue by keeping scopes, photos, supplements, approvals, and job details from getting lost.',
  },
  {
    label: 'Run cleaner jobs',
    tone: 'border-cyan-300/20 bg-cyan-500/10 text-cyan-100 hover:border-cyan-200/45 hover:bg-cyan-500/20',
    prompt: 'Show me how Jobrolo helps production, crews, subs, sales reps, and project managers stay aligned without digging through CRM menus.',
  },
  {
    label: 'Look professional',
    tone: 'border-amber-300/20 bg-amber-500/10 text-amber-100 hover:border-amber-200/45 hover:bg-amber-500/20',
    prompt: 'Show me how Jobrolo helps a contractor look more professional with customer updates, photo reports, roof reports, and organized job packets.',
  },
]

const TOOL_PREVIEWS = [
  {
    label: 'AI operator',
    tone: 'border-violet-300/20 bg-violet-500/10 text-violet-100 hover:border-violet-200/45 hover:bg-violet-500/20',
    prompt: 'Explain Jobrolo as an AI operator for a contractor. What can I ask it to do, what needs approval, and what should it save or retrieve?',
  },
  {
    label: 'Client files',
    tone: 'border-blue-300/20 bg-blue-500/10 text-blue-100 hover:border-blue-200/45 hover:bg-blue-500/20',
    prompt: 'Teach me how Jobrolo client files work. Explain the problem it solves, what I can ask in chat, and give a realistic roofing example.',
  },
  {
    label: 'Field notes',
    tone: 'border-emerald-300/20 bg-emerald-500/10 text-emerald-100 hover:border-emerald-200/45 hover:bg-emerald-500/20',
    prompt: 'Teach me how Jobrolo helps in the field with inspections, photos, GPS notes, damage observations, and job-site updates. Give practical examples.',
  },
  {
    label: 'Shared chats',
    tone: 'border-cyan-300/20 bg-cyan-500/10 text-cyan-100 hover:border-cyan-200/45 hover:bg-cyan-500/20',
    prompt: 'Teach me how Jobrolo shared chats work for homeowners, crews, subcontractors, sales reps, and project managers. Explain permissions and examples.',
  },
  {
    label: 'Reports',
    tone: 'border-amber-300/20 bg-amber-500/10 text-amber-100 hover:border-amber-200/45 hover:bg-amber-500/20',
    prompt: 'Teach me how Jobrolo helps create roof reports, scope breakdowns, photo reports, and customer-facing summaries. Explain the workflow and examples.',
  },
  {
    label: 'Approvals',
    tone: 'border-violet-300/20 bg-violet-500/10 text-violet-100 hover:border-violet-200/45 hover:bg-violet-500/20',
    prompt: 'Teach me how Jobrolo approvals work. Explain what actions need approval, why that matters, and how the user stays in control.',
  },
]

function PreviewPillGroup({
  title,
  subtitle,
  items,
  onAsk,
  disabled,
}: {
  title: string
  subtitle: string
  items: typeof TOOL_PREVIEWS
  onAsk: (prompt: string) => void
  disabled?: boolean
}) {
  return (
    <div className="mt-3">
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">{title}</span>
        <span className="text-[10px] text-slate-500">{subtitle}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map(item => (
          <button
            key={item.label}
            type="button"
            onClick={() => onAsk(item.prompt)}
            disabled={disabled}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${item.tone}`}
            aria-label={`Ask about ${item.label}`}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function cleanLobbyText(value: string) {
  return value
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/^\s*[_*•-]\s*/gm, '')
    .replace(/[ \t]+$/gm, '')
    .trim()
}

function extractInviteCode(value: string) {
  const raw = value.trim()
  if (!raw) return ''
  try {
    const parsed = new URL(raw)
    const token = parsed.searchParams.get('token') || parsed.searchParams.get('code') || ''
    if (token) return token.trim()
  } catch {
    // Not a URL; continue with natural-language extraction below.
  }

  const tokenParam = raw.match(/[?&](?:token|code)=([A-Za-z0-9_-]{10,})/)
  if (tokenParam?.[1]) return tokenParam[1].trim()

  const phrases = [
    /(?:one[-\s]?time\s+)?(?:invite\s+)?(?:link\s+)?code\s+(?:is\s+)?([A-Za-z0-9_-]{10,})/i,
    /(?:invite|joining|join)\s+(?:code|token)\s+(?:is\s+)?([A-Za-z0-9_-]{10,})/i,
  ]
  for (const pattern of phrases) {
    const match = raw.match(pattern)
    if (match?.[1]) return match[1].trim()
  }

  const candidates = raw.match(/\b[A-Za-z0-9_-]{20,}\b/g) || []
  return candidates[candidates.length - 1] || ''
}

function mentionsInviteJoin(value: string) {
  return /\b(join|joining|invite|invited|one[-\s]?time|code|token)\b/i.test(value)
}

function isLobbyCodyOpen(value: string) {
  return /^\s*\(?\s*cody[\s,.\-–—:;!]+cody[\s,.\-–—:;!]+cody\b/i.test(value.trim())
}

function isLobbyCodyClose(value: string) {
  return /^\s*end\s+cody\b/i.test(value.trim())
}

function lobbyMessagesForApi(messages: LobbyMessage[]) {
  return messages.slice(-8).map(message => ({
    role: message.role,
    text: message.content.slice(0, 700),
  }))
}

function parseLobbyAnswer(content: string) {
  const lines = content.split(/\r?\n/).map(line => cleanLobbyText(line)).filter(Boolean)
  const intro: string[] = []
  const featureRows: { title: string; body: string }[] = []
  const outro: string[] = []

  let sawFeature = false
  for (const line of lines) {
    const match = line.match(/^([A-Z][A-Za-z /&+-]{2,40}):\s+(.+)$/)
    if (match && !line.toLowerCase().startsWith('to access')) {
      sawFeature = true
      featureRows.push({ title: match[1].trim(), body: match[2].trim() })
      continue
    }

    if (sawFeature) outro.push(line)
    else intro.push(line)
  }

  return { intro, featureRows, outro }
}

function LobbyAnswer({ content }: { content: string }) {
  const { intro, featureRows, outro } = parseLobbyAnswer(content)

  return (
    <div className="space-y-3">
      {intro.map((line, index) => (
        <p key={`intro-${index}`} className="text-[15px] leading-relaxed text-slate-100">
          {line}
        </p>
      ))}

      {featureRows.length ? (
        <div className="grid gap-2">
          {featureRows.slice(0, 7).map((feature, index) => (
            <div
              key={`${feature.title}-${index}`}
              className="rounded-2xl border border-blue-300/15 bg-gradient-to-br from-blue-500/10 via-cyan-500/5 to-transparent p-3 shadow-[0_0_20px_rgba(37,99,235,0.08)]"
            >
              <div className="text-sm font-semibold text-white">{feature.title}</div>
              <div className="mt-1 text-sm leading-relaxed text-slate-300">{feature.body}</div>
            </div>
          ))}
        </div>
      ) : null}

      {outro.map((line, index) => (
        <p key={`outro-${index}`} className="text-[15px] leading-relaxed text-slate-300">
          {line}
        </p>
      ))}
    </div>
  )
}

function EntryActionPills({
  onAsk,
  onMode,
  disabled,
}: {
  onAsk: (prompt: string) => void
  onMode: (mode: EntryMode) => void
  disabled?: boolean
}) {
  const prompts = [
    { label: 'Increase follow-up', prompt: 'Explain how Jobrolo helps improve follow-up, reduce dropped leads, and keep sales conversations moving.' },
    { label: 'Automate busywork', prompt: 'Explain what contractor busywork Jobrolo can reduce through chat, tools, approvals, and saved records.' },
    { label: 'Reports + trust', prompt: 'Explain how Jobrolo creates better customer-facing reports, updates, and job packets that build trust.' },
    { label: 'Invites + roles', prompt: 'Explain how inviting employees, crews, subcontractors, and homeowners works, including permissions.' },
    { label: 'Join with code', prompt: 'I have a Jobrolo invite code or link and need to join an existing company workspace.' },
  ]
  return (
    <div className="mt-3 border-t border-white/10 pt-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Try asking</div>
      <div className="flex flex-wrap gap-2">
        {prompts.map(item => (
          <button
            key={item.label}
            type="button"
            onClick={() => onAsk(item.prompt)}
            disabled={disabled}
            className="rounded-full border border-blue-300/20 bg-blue-500/10 px-3 py-1.5 text-xs font-medium text-blue-100 transition hover:border-blue-200/45 hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {item.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onMode('join')}
          disabled={disabled}
          className="rounded-full border border-emerald-300/35 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-100 transition hover:border-emerald-200/60 hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Join workspace
        </button>
        <button
          type="button"
          onClick={() => onMode('signup')}
          disabled={disabled}
          className="rounded-full border border-cyan-300/35 bg-cyan-500/15 px-3 py-1.5 text-xs font-semibold text-cyan-100 transition hover:border-cyan-200/60 hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Create workspace
        </button>
      </div>
    </div>
  )
}

export default function SignupPage() {
  const router = useRouter()
  const [mode, setMode] = useState<EntryMode | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lockedNotice, setLockedNotice] = useState<string | null>(null)
  const [lobbyInput, setLobbyInput] = useState('')
  const [lobbySending, setLobbySending] = useState(false)
  const [lobbyMessages, setLobbyMessages] = useState<LobbyMessage[]>([])
  const [codyMode, setCodyMode] = useState(false)
  const [codyTranscript, setCodyTranscript] = useState<LobbyMessage[]>([])
  const [inviteCode, setInviteCode] = useState('')
  const [signupForm, setSignupForm] = useState({ name: '', email: '', password: '', companyName: '', website: '' })
  const [loginForm, setLoginForm] = useState({ email: '', password: '' })
  const scrollRef = useRef<HTMLElement | null>(null)
  const messageRefs = useRef<Array<HTMLDivElement | null>>([])
  const previousLobbyMessageCountRef = useRef(0)

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    const previousCount = previousLobbyMessageCountRef.current
    previousLobbyMessageCountRef.current = lobbyMessages.length

    if (lobbyMessages.length <= previousCount) return
    const lastIndex = lobbyMessages.length - 1
    const lastMessage = lobbyMessages[lastIndex]
    if (!lastMessage) return

    requestAnimationFrame(() => {
      const current = scrollRef.current
      if (!current) return
      if (lastMessage.role === 'assistant') {
        const node = messageRefs.current[lastIndex]
        if (!node) return
        const containerRect = current.getBoundingClientRect()
        const nodeRect = node.getBoundingClientRect()
        current.scrollTop += nodeRect.top - containerRect.top - 16
      } else {
        current.scrollTop = current.scrollHeight
      }
    })
  }, [lobbyMessages])

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(signupForm),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Signup failed')
        return
      }
      router.push(data.redirectTo || '/')
      router.refresh()
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Login failed')
        return
      }
      router.push(data.redirectTo || '/')
      router.refresh()
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const chooseMode = (nextMode: EntryMode) => {
    setMode(nextMode)
    setError(null)
    setLockedNotice(null)
  }

  const openInvite = (codeOverride?: string) => {
    const code = extractInviteCode(codeOverride || inviteCode)
    setError(null)
    if (!code) {
      setError('Paste the Jobrolo invite link or one-time invite code first.')
      setMode('join')
      return
    }
    if (code.length < 20) {
      setError('That invite code looks too short. Paste the full one-time code or full invite link from the text/email.')
      setMode('join')
      return
    }
    router.push(`/invite?token=${encodeURIComponent(code)}`)
  }

  const showLocked = (label: string) => {
    setLockedNotice(`${label} unlocks after you sign in and finish setup. For now, I can help you sign in, create a workspace, or explain how Jobrolo works.`)
  }

  const sendLobbyMessage = async (overrideText?: string) => {
    const text = (overrideText ?? lobbyInput).trim()
    if (!text || lobbySending) return

    if (!overrideText) setLobbyInput('')
    setLockedNotice(null)
    const userMessage: LobbyMessage = { role: 'user', content: text }
    const codyOpening = isLobbyCodyOpen(text)
    const codyClosing = isLobbyCodyClose(text)
    const isCodyTurn = codyMode || codyOpening || codyClosing
    const visibleMessages = [...lobbyMessages, userMessage]
    const codySessionMessages = codyOpening
      ? [userMessage]
      : [...codyTranscript, userMessage]
    setLobbyMessages(visibleMessages)

    if (codyOpening) {
      setCodyMode(true)
      setCodyTranscript([userMessage])
    } else if (codyMode && !codyClosing) {
      setCodyTranscript(prev => [...prev, userMessage])
    }

    const inviteFromText = extractInviteCode(text)
    if (!isCodyTurn && (inviteFromText || mentionsInviteJoin(text))) {
      setInviteCode(inviteFromText)
      setMode('join')
      setLobbyMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: inviteFromText
            ? 'Got it — that looks like a Jobrolo invite code. Use Join workspace below and I’ll take you through the secure invite flow for the right company, chat, and permissions.'
            : 'Absolutely. If you were invited to an existing company, paste the invite link or one-time code from the text/email. That is how Jobrolo attaches you to the right workspace, chat, and permissions.',
        },
      ])
      return
    }

    setLobbySending(true)
    try {
      const res = await fetch('/api/public/entry-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          mode: isCodyTurn ? 'cody' : 'normal',
          codyClosing,
          codySessionContent: codyClosing
            ? codySessionMessages.map(message => `${message.role}: ${message.content}`).join('\n').slice(0, 5000)
            : undefined,
          currentUrl: typeof window !== 'undefined' ? window.location.href : undefined,
          recentMessages: lobbyMessagesForApi(visibleMessages),
        }),
      })
      const data = await res.json().catch(() => ({}))
      setLobbyMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: res.ok
            ? data.message || 'I can answer Jobrolo questions here. To access your company workspace, sign in or create a workspace.'
            : data.error || 'I can answer Jobrolo questions here. Try again in a moment.',
        },
      ])
      if (codyClosing) {
        setCodyMode(false)
        setCodyTranscript([])
      }
    } catch {
      setLobbyMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: 'I had trouble answering from the lobby chat. You can still sign in or create a workspace, and I’ll continue setup there.',
        },
      ])
      if (codyClosing) {
        setCodyMode(false)
        setCodyTranscript([])
      }
    } finally {
      setLobbySending(false)
    }
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[#050914] text-slate-100">
      <header className="shrink-0 border-b border-white/10 bg-[#07101d]/95 px-3 py-2.5 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => showLocked('The menu')}
              className="grid h-10 w-10 place-items-center rounded-xl text-slate-300 hover:bg-white/[0.06]"
              aria-label="Menu locked during account entry"
            >
              <Menu className="h-5 w-5" />
            </button>
            <img src="/logo.png" alt="Jobrolo" className="h-10 w-10 rounded-xl object-cover shadow-[0_0_24px_rgba(37,99,235,0.45)]" />
            <div>
              <div className="text-sm font-semibold text-white">Jobrolo</div>
              <div className="text-xs text-slate-400">Account entry</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => showLocked('Notifications')}
              className="hidden h-10 min-w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] px-2 text-slate-300 hover:bg-white/[0.08] sm:inline-flex"
              aria-label="Notifications locked during account entry"
            >
              <Bell className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => showLocked('Create/start')}
              className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]"
              aria-label="Start menu locked during account entry"
            >
              <Plus className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => showLocked('Your profile')}
              className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-blue-500/15 text-xs font-semibold text-blue-100 hover:bg-blue-500/25"
              aria-label="Profile locked during account entry"
            >
              <LockKeyhole className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <main ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <div className="mx-auto flex min-h-full max-w-3xl flex-col justify-end gap-4 pb-4">
          {lockedNotice ? (
            <div className="ml-auto max-w-[88%] rounded-2xl border border-amber-300/20 bg-amber-400/10 px-4 py-3 text-sm leading-relaxed text-amber-100">
              {lockedNotice}
            </div>
          ) : null}

          {codyMode ? (
            <div className="ml-0 flex items-center gap-2 rounded-2xl border border-violet-300/25 bg-violet-500/10 px-4 py-3 text-sm text-violet-100 sm:ml-14">
              <span className="h-2 w-2 rounded-full bg-violet-300 shadow-[0_0_14px_rgba(196,181,253,0.9)]" />
              Cody review mode is open. Talk through the sign-in/onboarding issue, then type “end Cody” when ready to package it.
            </div>
          ) : null}

          <div className="flex items-start gap-3">
            <JobroloChatIcon />
            <div className="max-w-[calc(100%-3.25rem)] rounded-2xl rounded-bl-md border border-white/10 bg-[#0b1220] px-4 py-3 text-[15px] leading-relaxed text-slate-100 shadow-xl shadow-black/20">
              <div className="font-medium text-white">Hey — I’m Jobrolo.</div>
              <div className="mt-1">Are we signing you into an existing workspace, or creating a new company workspace?</div>
              <div className="mt-2 text-sm text-slate-300">
                You can also ask me questions here before creating an account. I can explain what Jobrolo does, how invites work, and how setup flows — real company tools unlock after sign-in.
              </div>
              <PreviewPillGroup
                title="Business wins"
                subtitle="why it matters"
                items={OUTCOME_PREVIEWS}
                onAsk={prompt => void sendLobbyMessage(prompt)}
                disabled={lobbySending}
              />
              <PreviewPillGroup
                title="Tools"
                subtitle="what it does"
                items={TOOL_PREVIEWS}
                onAsk={prompt => void sendLobbyMessage(prompt)}
                disabled={lobbySending}
              />
              <div className="mt-3 rounded-xl border border-amber-300/20 bg-amber-400/10 p-3 text-xs leading-relaxed text-amber-100">
                If someone texted or emailed you an invite, use that invite link instead. That attaches you to the right company, chat, and permissions.
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => chooseMode('join')}
                  className={`inline-flex min-h-[40px] items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition ${mode === 'join' ? 'border-emerald-300/50 bg-emerald-500/20 text-white' : 'border-white/10 bg-white/[0.06] text-slate-200 hover:border-emerald-300/35 hover:bg-emerald-500/15'}`}
                >
                  <KeyRound className="h-4 w-4" />
                  Join workspace
                </button>
                <button
                  type="button"
                  onClick={() => chooseMode('login')}
                  className={`inline-flex min-h-[40px] items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition ${mode === 'login' ? 'border-blue-300/50 bg-blue-500/25 text-white' : 'border-white/10 bg-white/[0.06] text-slate-200 hover:border-blue-300/35 hover:bg-blue-500/15'}`}
                >
                  <LogIn className="h-4 w-4" />
                  Sign in
                </button>
                <button
                  type="button"
                  onClick={() => chooseMode('signup')}
                  className={`inline-flex min-h-[40px] items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition ${mode === 'signup' ? 'border-cyan-300/50 bg-cyan-500/20 text-white' : 'border-white/10 bg-white/[0.06] text-slate-200 hover:border-cyan-300/35 hover:bg-cyan-500/15'}`}
                >
                  <UserPlus className="h-4 w-4" />
                  Create workspace
                </button>
              </div>
            </div>
          </div>

          {lobbyMessages.map((message, index) => (
            <div
              key={`${message.role}-${index}`}
              ref={node => { messageRefs.current[index] = node }}
              className={`flex items-start gap-3 ${message.role === 'user' ? 'justify-end' : ''}`}
            >
              {message.role === 'assistant' ? (
                <JobroloChatIcon />
              ) : null}
              <div
                className={`max-w-[88%] rounded-2xl px-4 py-3 text-[15px] leading-relaxed shadow-xl shadow-black/20 ${
                  message.role === 'user'
                    ? 'whitespace-pre-wrap rounded-br-md bg-blue-600 text-white'
                    : 'rounded-bl-md border border-white/10 bg-[#0b1220] text-slate-100'
                }`}
              >
                {message.role === 'assistant' ? (
                  <>
                    <LobbyAnswer content={message.content} />
                    <EntryActionPills onAsk={prompt => void sendLobbyMessage(prompt)} onMode={chooseMode} disabled={lobbySending} />
                  </>
                ) : message.content}
              </div>
            </div>
          ))}

          {lobbySending ? (
            <div className="flex items-start gap-3">
              <JobroloChatIcon />
              <div className="inline-flex items-center gap-2 rounded-2xl rounded-bl-md border border-white/10 bg-[#0b1220] px-4 py-3 text-sm text-slate-300">
                <Loader2 className="h-4 w-4 animate-spin" />
                Thinking…
              </div>
            </div>
          ) : null}

          {mode === 'login' ? (
            <div className="ml-0 sm:ml-14">
              <form onSubmit={handleLogin} className="rounded-3xl rounded-tl-md border border-blue-400/20 bg-[#08111f] p-4 shadow-2xl shadow-black/30 sm:p-5">
                <div className="mb-4">
                  <div className="text-sm font-semibold text-white">Welcome back.</div>
                  <div className="text-xs text-slate-400">Sign in and I’ll route you to the right place.</div>
                </div>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="login-email" className="text-slate-200">Email</Label>
                    <Input id="login-email" type="email" value={loginForm.email} onChange={e => setLoginForm({ ...loginForm, email: e.target.value })} required disabled={loading} className="mt-1 border-white/10 bg-slate-950 text-white" placeholder="you@company.com" />
                  </div>
                  <div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="login-password" className="text-slate-200">Password</Label>
                      <button type="button" onClick={() => router.push('/reset-password')} className="text-xs text-blue-300 hover:text-blue-200">
                        Forgot password?
                      </button>
                    </div>
                    <Input id="login-password" type="password" value={loginForm.password} onChange={e => setLoginForm({ ...loginForm, password: e.target.value })} required disabled={loading} className="mt-1 border-white/10 bg-slate-950 text-white" placeholder="••••••••" />
                  </div>
                </div>
                {error ? <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-100">{error}</div> : null}
                <Button type="submit" disabled={loading} className="mt-5 w-full bg-blue-600 text-white hover:bg-blue-700">
                  {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Signing in…</> : 'Sign in'}
                </Button>
              </form>
            </div>
          ) : null}

          {mode === 'join' ? (
            <div className="ml-0 sm:ml-14">
              <form
                onSubmit={e => {
                  e.preventDefault()
                  openInvite()
                }}
                className="rounded-3xl rounded-tl-md border border-emerald-400/20 bg-[#08111f] p-4 shadow-2xl shadow-black/30 sm:p-5"
              >
                <div className="mb-4">
                  <div className="text-sm font-semibold text-white">Join an existing workspace.</div>
                  <div className="mt-1 text-xs leading-relaxed text-slate-400">
                    Paste the invite link or one-time code from the text/email. Jobrolo will use it to place you in the right company, chat, and role.
                  </div>
                </div>
                <div className="rounded-2xl border border-emerald-300/15 bg-emerald-500/10 p-3 text-xs leading-relaxed text-emerald-100">
                  You can also type it naturally, like: “My name is [your name] and I’m joining my roofing company. My invite code is …”
                </div>
                <div className="mt-4">
                  <Label htmlFor="invite-code" className="text-slate-200">Invite link or one-time code</Label>
                  <Input
                    id="invite-code"
                    type="text"
                    value={inviteCode}
                    onChange={e => setInviteCode(e.target.value)}
                    disabled={loading}
                    className="mt-1 border-white/10 bg-slate-950 text-white"
                    placeholder="Paste invite link or code"
                  />
                </div>
                {error ? <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-100">{error}</div> : null}
                <Button type="submit" disabled={loading} className="mt-5 w-full bg-emerald-600 text-white hover:bg-emerald-700">
                  Continue with invite
                </Button>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => chooseMode('login')}
                    className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-slate-300 hover:bg-white/[0.08]"
                  >
                    I already have an account
                  </button>
                  <button
                    type="button"
                    onClick={() => chooseMode('signup')}
                    className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-slate-300 hover:bg-white/[0.08]"
                  >
                    Create my own workspace
                  </button>
                </div>
              </form>
            </div>
          ) : null}

          {mode === 'signup' ? (
            <div className="ml-0 sm:ml-14">
              <form onSubmit={handleSignup} className="rounded-3xl rounded-tl-md border border-cyan-400/20 bg-[#08111f] p-4 shadow-2xl shadow-black/30 sm:p-5">
                <div className="mb-4">
                  <div className="text-sm font-semibold text-white">Let’s create your company workspace.</div>
                  <div className="text-xs text-slate-400">After this, Jobrolo opens the real Command Center and helps finish setup from chat.</div>
                </div>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="name" className="text-slate-200">Your name</Label>
                    <Input id="name" type="text" value={signupForm.name} onChange={e => setSignupForm({ ...signupForm, name: e.target.value })} required disabled={loading} className="mt-1 border-white/10 bg-slate-950 text-white" placeholder="Chance Pearson" />
                  </div>
                  <div>
                    <Label htmlFor="email" className="text-slate-200">Email</Label>
                    <Input id="email" type="email" value={signupForm.email} onChange={e => setSignupForm({ ...signupForm, email: e.target.value })} required disabled={loading} className="mt-1 border-white/10 bg-slate-950 text-white" placeholder="you@company.com" />
                  </div>
                  <div>
                    <Label htmlFor="password" className="text-slate-200">Create password</Label>
                    <Input id="password" type="password" value={signupForm.password} onChange={e => setSignupForm({ ...signupForm, password: e.target.value })} required disabled={loading} minLength={8} className="mt-1 border-white/10 bg-slate-950 text-white" placeholder="At least 8 characters" />
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                    <p className="mb-3 text-xs text-slate-400">Optional, but it helps Jobrolo start smarter:</p>
                    <div className="space-y-3">
                      <div>
                        <Label htmlFor="companyName" className="text-slate-200">Company name</Label>
                        <Input id="companyName" type="text" value={signupForm.companyName} onChange={e => setSignupForm({ ...signupForm, companyName: e.target.value })} disabled={loading} className="mt-1 border-white/10 bg-slate-950 text-white" placeholder="Your Roofing Company" />
                      </div>
                      <div>
                        <Label htmlFor="website" className="text-slate-200">Company website</Label>
                        <Input id="website" type="text" value={signupForm.website} onChange={e => setSignupForm({ ...signupForm, website: e.target.value })} disabled={loading} className="mt-1 border-white/10 bg-slate-950 text-white" placeholder="yourcompany.com" />
                      </div>
                    </div>
                  </div>
                </div>
                {error ? <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-100">{error}</div> : null}
                <Button type="submit" disabled={loading} className="mt-5 w-full bg-blue-600 text-white hover:bg-blue-700">
                  {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating workspace…</> : 'Create workspace'}
                </Button>
              </form>
            </div>
          ) : null}

        </div>
      </main>

      <footer className="shrink-0 border-t border-white/10 bg-[#07101d] px-3 py-2.5">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <button
            type="button"
            onClick={() => showLocked('Attachments')}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-slate-400 hover:bg-white/[0.06]"
            aria-label="Attachments locked during account entry"
          >
            <Plus className="h-5 w-5" />
          </button>
          <textarea
            value={lobbyInput}
            onChange={e => setLobbyInput(e.target.value)}
            onKeyDown={e => {
              const desktopEnter = typeof window !== 'undefined' && window.matchMedia('(min-width: 768px) and (pointer: fine)').matches
              if (e.key === 'Enter' && !e.shiftKey && ((e.metaKey || e.ctrlKey) || desktopEnter)) {
                e.preventDefault()
                void sendLobbyMessage()
              }
            }}
            rows={1}
            disabled={lobbySending}
            className="max-h-28 min-h-[44px] flex-1 resize-none rounded-xl border border-white/10 bg-[#0b1220] px-3 py-2.5 text-base leading-6 text-white outline-none placeholder:text-slate-500 focus:border-blue-400/70 focus:ring-2 focus:ring-blue-500/20 disabled:opacity-60"
            placeholder="Ask Jobrolo how it works…"
          />
          <button
            type="button"
            onClick={() => showLocked('Voice')}
            className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-blue-600/80 text-white shadow-lg shadow-blue-950/30"
            aria-label="Voice locked during account entry"
          >
            <Mic className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => void sendLobbyMessage()}
            disabled={!lobbyInput.trim() || lobbySending}
            className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-950/30 transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-slate-500 sm:grid"
            aria-label="Send lobby chat message"
          >
            {lobbySending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </footer>
    </div>
  )
}
