'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { useChatStore } from '@/store/chat-store'
import { useWorkspaceStore } from '@/store/workspace-store'
import { useChat } from '@/hooks/use-chat'
import { useWorkspaceChat } from '@/hooks/use-workspace-chat'
import { useTTS } from '@/hooks/use-tts'
import { WorkspaceSidebar } from '@/components/jobrolo/workspace-sidebar'
import { MessageBubble, StreamingBubble } from '@/components/jobrolo/message-bubble'
import { ChatInput } from '@/components/jobrolo/chat-input'
import { UploadProgressIndicator } from '@/components/jobrolo/upload-progress'
import { cn, getInitials } from '@/lib/utils'
import { ArrowLeft, Plus, Loader2, Menu, Volume2, LogOut, MapPin } from 'lucide-react'
import { ThemeToggle } from '@/components/theme-toggle'
import type { ClientMessage } from '@/lib/types'

export default function Page() {
  const [initialLoading, setInitialLoading] = useState(true)
  const [leftDrawerOpen, setLeftDrawerOpen] = useState(false)
  const [autoTTS, setAutoTTS] = useState(false)
  const proactiveRunKey = useRef<string | null>(null)
  const [userName, setUserName] = useState('')
  const uploadProgress = useChatStore(s => s.uploadProgress)
  const messages = useChatStore(s => s.messages)
  const isTyping = useChatStore(s => s.isTyping)
  const isStreaming = useChatStore(s => s.isStreaming)
  const streamingText = useChatStore(s => s.streamingText)
  const businessContext = useChatStore(s => s.businessContext)
  const setConversations = useChatStore(s => s.setConversations)
  const conversationId = useChatStore(s => s.conversationId)
  const setMessages = useChatStore(s => s.setMessages)
  const addGlobalMessage = useChatStore(s => s.addMessage)
  const setBusinessContext = useChatStore(s => s.setBusinessContext)
  const selectConversation = useChatStore(s => s.selectConversation)
  const setConversationId = useChatStore(s => s.setConversationId)
  const refreshBusinessContext = useChatStore(s => s.refreshBusinessContext)

  const workspaces = useWorkspaceStore(s => s.workspaces)
  const currentWorkspaceId = useWorkspaceStore(s => s.currentWorkspaceId)
  const currentChatId = useWorkspaceStore(s => s.currentChatId)
  const workspaceMessages = useWorkspaceStore(s => s.messages)
  const isWorkspaceTyping = useWorkspaceStore(s => s.isTyping)
  const workspaceStreamingText = useWorkspaceStore(s => s.streamingText)
  const isWorkspaceLoading = useWorkspaceStore(s => s.isLoading)
  const setWorkspaces = useWorkspaceStore(s => s.setWorkspaces)
  const setWorkspaceMessages = useWorkspaceStore(s => s.setMessages)
  const addWorkspaceMessage = useWorkspaceStore(s => s.addMessage)
  const exitWorkspace = useWorkspaceStore(s => s.exitWorkspace)
  const enterWorkspace = useWorkspaceStore(s => s.enterWorkspace)

  const { sendMessage, stopMessage } = useChat()
  const { sendWorkspaceMessage, stopWorkspaceMessage } = useWorkspaceChat()
  const tts = useTTS({ autoPlay: true })

  const isInWorkspace = !!currentWorkspaceId && !!currentChatId
  const currentWorkspace = workspaces.find(w => w.id === currentWorkspaceId)
  const scrollRef = useRef<HTMLDivElement>(null)
  const prevMsgCount = useRef(0)

  // Init
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const meRes = await fetch('/api/auth/me')
        if (meRes.ok) {
          const me = await meRes.json()
          if (!me.authenticated) { window.location.href = '/signup'; return }
          if (!me.onboardingComplete) { window.location.href = '/onboarding'; return }
          setUserName(me.user?.name || 'there')
        }
        const [dr, cr, wr] = await Promise.all([
          fetch('/api/data'), fetch('/api/conversations'), fetch('/api/workspaces'),
        ])
        if (cancelled) return
        if (dr.ok) {
          const d = await dr.json()
          setBusinessContext(d.businessContext)
          if (d.conversationId) setConversationId(d.conversationId)
          if (d.contractor?.name) setUserName(d.contractor.name)
        }
        if (cr.ok) {
          const d = await cr.json()
          setConversations(d.conversations || [])
        }
        if (wr.ok) {
          const d = await wr.json()
          setWorkspaces(d.workspaces || [])
        }
        const cid = useChatStore.getState().conversationId
        if (cid) {
          const mr = await fetch(`/api/conversations/${cid}`)
          if (mr.ok && !cancelled) {
            const md = await mr.json()
            setMessages(
              (md.messages || []).map((m: any) => ({
                id: m.id, role: m.role, content: m.content,
                contextType: m.contextType, contextData: m.contextData,
                attachments: m.attachments, actionResults: m.actionResults,
                createdAt: m.createdAt,
              })) as ClientMessage[]
            )
          }
        } else {
          // No existing conversation — generate a dynamic greeting from live data
          const greetingName = userName || 'there'
          const hour = new Date().getHours()
          const timeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'
          const dataRes = await fetch('/api/data').then(r => r.ok ? r.json() : null).catch(() => null)
          const openProjects = dataRes?.projects?.filter((p: any) => p.status === 'active') ?? []
          const projectLines = openProjects.slice(0, 4).map((p: any) => `• ${p.title}${p.priority === 'high' || p.priority === 'urgent' ? ` — ${p.priority}` : ''}`).join('\n')
          const greetingContent = openProjects.length > 0
            ? `Good ${timeOfDay}, ${greetingName}. Here's what's active right now:\n\n${projectLines}\n\nAsk me anything — "open [job name]", "what am I forgetting?", or just talk to me.`
            : `Good ${timeOfDay}, ${greetingName}. No active projects yet — ask me to create one or upload a document to get started.`
          setMessages([{ id: 'greeting', role: 'assistant', content: greetingContent, createdAt: new Date().toISOString() }])
        }
      } catch (e) {
        console.error('[page] init:', e)
      } finally {
        if (!cancelled) setInitialLoading(false)
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!conversationId || initialLoading) return
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch(`/api/conversations/${conversationId}`)
        if (cancelled) return
        if (r.ok) {
          const d = await r.json()
          setMessages(
            (d.messages || []).map((m: any) => ({
              id: m.id, role: m.role, content: m.content,
              contextType: m.contextType, contextData: m.contextData,
              attachments: m.attachments, actionResults: m.actionResults,
              createdAt: m.createdAt,
            })) as ClientMessage[]
          )
        }
      } catch {}
    })()
    return () => { cancelled = true }
  }, [conversationId, initialLoading, setMessages])

  useEffect(() => {
    if (!currentChatId) { setWorkspaceMessages([]); return }
    let cancelled = false
    useWorkspaceStore.getState().setLoading(true)
    ;(async () => {
      try {
        const r = await fetch(`/api/workspaces/${currentWorkspaceId}/messages?chatId=${currentChatId}`)
        if (cancelled) return
        if (r.ok) {
          const d = await r.json()
          setWorkspaceMessages(
            (d.messages || []).map((m: any) => ({
              id: m.id, role: m.role, content: m.content,
              contextType: m.contextType, contextData: m.contextData,
              attachments: m.attachments, actionResults: m.actionResults,
              createdAt: m.createdAt,
            })) as ClientMessage[]
          )
        } else setWorkspaceMessages([])
      } catch { setWorkspaceMessages([]) }
      finally { if (!cancelled) useWorkspaceStore.getState().setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [currentChatId, currentWorkspaceId, setWorkspaceMessages])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, workspaceMessages, isStreaming, isWorkspaceTyping, streamingText, workspaceStreamingText])

  const handleSend = useCallback((args: { text: string; attachments?: File[] }) => {
    isInWorkspace ? sendWorkspaceMessage(args) : sendMessage(args)
  }, [isInWorkspace, sendWorkspaceMessage, sendMessage])

  const handleStop = useCallback(() => {
    isInWorkspace ? stopWorkspaceMessage() : stopMessage()
  }, [isInWorkspace, stopMessage, stopWorkspaceMessage])

  const appendProactiveMessages = useCallback((newMessages: ClientMessage[]) => {
    if (!newMessages.length) return
    if (isInWorkspace) {
      const existing = new Set(useWorkspaceStore.getState().messages.map(m => m.id))
      newMessages.filter(m => !existing.has(m.id)).forEach(addWorkspaceMessage)
    } else {
      const existing = new Set(useChatStore.getState().messages.map(m => m.id))
      newMessages.filter(m => !existing.has(m.id)).forEach(addGlobalMessage)
    }
  }, [isInWorkspace, addWorkspaceMessage, addGlobalMessage])

  const runProactiveOperator = useCallback(async (force = false) => {
    try {
      const payload = isInWorkspace
        ? { workspaceId: currentWorkspaceId, chatId: currentChatId, projectId: currentWorkspace?.projectId ?? undefined, reason: 'thread_open', force }
        : { conversationId: conversationId ?? undefined, reason: 'app_open', force }
      const res = await fetch('/api/copilot/proactive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) return
      const data = await res.json()
      if (!isInWorkspace && data.conversationId && data.conversationId !== conversationId) {
        setConversationId(data.conversationId)
      }
      appendProactiveMessages((data.messages || []).map((m: any) => ({
        id: m.id, role: m.role, content: m.content, contextType: m.contextType,
        contextData: m.contextData, createdAt: m.createdAt,
      })) as ClientMessage[])
    } catch (e) {
      console.warn('[page] proactive operator:', e)
    }
  }, [isInWorkspace, currentWorkspaceId, currentChatId, currentWorkspace?.projectId, conversationId, setConversationId, appendProactiveMessages])

  useEffect(() => {
    if (initialLoading) return
    if (isInWorkspace && (!currentWorkspaceId || !currentChatId)) return
    const key = isInWorkspace ? `workspace:${currentWorkspaceId}:${currentChatId}` : `global:${conversationId ?? 'default'}`
    if (proactiveRunKey.current === key) return
    proactiveRunKey.current = key
    runProactiveOperator(false)
  }, [initialLoading, isInWorkspace, currentWorkspaceId, currentChatId, conversationId, runProactiveOperator])

  const handleNewChat = useCallback(async () => {
    exitWorkspace()
    setLeftDrawerOpen(false)
    try {
      const r = await fetch('/api/conversations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Chat' }),
      })
      if (r.ok) {
        const d = await r.json()
        selectConversation(d.conversation.id)
        setConversations([{
          id: d.conversation.id, title: 'New Chat', preview: '', messageCount: 0,
          createdAt: d.conversation.createdAt, updatedAt: d.conversation.updatedAt,
        }, ...useChatStore.getState().conversations])
        setMessages([{
          id: 'g-' + Date.now(), role: 'assistant',
          content: 'What can I help you with?', createdAt: new Date().toISOString(),
        }])
      }
    } catch {}
  }, [exitWorkspace, selectConversation, setConversations, setMessages])

  const handleEnterWorkspace = useCallback((id: string) => {
    enterWorkspace(id); setLeftDrawerOpen(false)
  }, [enterWorkspace])

  const handleExitToCommandCenter = useCallback(() => {
    exitWorkspace()
    if (conversationId) selectConversation(conversationId)
  }, [exitWorkspace, conversationId, selectConversation])

  const handleLogout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    window.location.href = '/login'
  }, [])

  useEffect(() => {
    if (leftDrawerOpen) document.body.style.overflow = 'hidden'
    else document.body.style.overflow = ''
    return () => { document.body.style.overflow = '' }
  }, [leftDrawerOpen])

  const displayMessages = isInWorkspace ? workspaceMessages : messages
  const inputDisabled = isInWorkspace ? isWorkspaceTyping : (isStreaming && !uploadProgress.length)
  const isAIWorking = isInWorkspace ? isWorkspaceTyping : (isTyping || isStreaming)

  useEffect(() => {
    if (!autoTTS || isStreaming || isWorkspaceTyping || !displayMessages.length || displayMessages.length === prevMsgCount.current) return
    const last = displayMessages[displayMessages.length - 1]
    if (last.role === 'assistant' && last.id !== 'greeting') {
      const prev = displayMessages[displayMessages.length - 2]
      if (prev?.role === 'user') tts.speak(last.content).catch(() => {})
    }
    prevMsgCount.current = displayMessages.length
  }, [displayMessages, autoTTS, isStreaming, isWorkspaceTyping, tts])

  return (
    <div className="h-dvh flex bg-background text-foreground overflow-hidden">
      {/* LEFT PANEL — Navigation (desktop) */}
      <div className="hidden lg:flex h-full w-64 flex-shrink-0">
        <div className="w-full flex flex-col h-full">
          <WorkspaceSidebar onNewChat={handleNewChat} />
          <div className="p-2 border-t border-border">
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Sign out
            </button>
          </div>
        </div>
      </div>

      {/* LEFT PANEL — Mobile drawer */}
      {leftDrawerOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setLeftDrawerOpen(false)} />
          <div className="relative z-10 h-full w-72 flex flex-col animate-slide-in-right">
            <WorkspaceSidebar onNewChat={handleNewChat} onNavigate={() => setLeftDrawerOpen(false)} />
            <div className="p-2 border-t border-border bg-sidebar">
              <button onClick={handleLogout} className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                <LogOut className="w-4 h-4" /> Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CENTER — Always the conversation */}
      <div className="flex-1 flex flex-col min-w-0 bg-background relative">
        {/* Header — Apple-style glass, refined */}
        <header
          className="sticky top-0 z-10 glass border-b border-border"
          style={{ paddingTop: 'env(safe-area-inset-top)' }}
        >
          <div className="flex items-center justify-between px-3 sm:px-4 py-2.5 gap-2">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {/* Mobile menu */}
              <button
                onClick={() => setLeftDrawerOpen(true)}
                className="lg:hidden p-2 -ml-2 rounded-md hover:bg-muted text-foreground"
                aria-label="Menu"
              >
                <Menu className="w-5 h-5" />
              </button>

              {isInWorkspace && currentWorkspace ? (
                <>
                  <button onClick={handleExitToCommandCenter} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground transition-colors" aria-label="Back to Command Center">
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                  <div className={cn('flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-semibold', currentWorkspace.color ?? 'bg-blue-600')}>
                    {getInitials(currentWorkspace.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-foreground truncate text-[15px] leading-tight">{currentWorkspace.name}</div>
                    <div className="text-[11px] text-muted-foreground truncate leading-tight">
                      Job workspace · actions route automatically
                      {currentWorkspace.project?.customer?.name && <> · {currentWorkspace.project.customer.name}</>}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="relative">
                    <img src="/logo.png" alt="Jobrolo" className="w-9 h-9 rounded-lg object-cover" />
                    {isAIWorking && (
                      <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-blue-500 rounded-full border-2 border-background animate-pulse" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-foreground truncate text-[15px] leading-tight">Jobrolo</div>
                    <div className="text-[11px] text-muted-foreground truncate leading-tight">
                      {isAIWorking ? 'Working…' : 'Mission Control'}
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="flex items-center gap-1 flex-shrink-0">
              {/* AI status indicator */}
              <div className={cn(
                'hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium',
                isAIWorking ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300' : 'bg-muted text-muted-foreground'
              )}>
                <span className={cn(
                  'w-1.5 h-1.5 rounded-full',
                  isAIWorking ? 'bg-blue-600 dark:bg-blue-400 animate-pulse' : 'bg-muted-foreground/40'
                )} />
                {isAIWorking ? 'Active' : 'Idle'}
              </div>

              {isInWorkspace && currentWorkspace?.projectId && (
                <button
                  onClick={() => runProactiveOperator(true)}
                  className="hidden sm:flex items-center gap-1.5 rounded-full bg-blue-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-blue-700"
                  aria-label="Post field briefing to chat"
                >
                  <MapPin className="h-3.5 w-3.5" /> Field brief
                </button>
              )}

              {/* Theme toggle */}
              <ThemeToggle />

              <button
                onClick={() => setAutoTTS(v => !v)}
                className={cn('p-2 rounded-md transition-colors', autoTTS ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300' : 'hover:bg-muted text-muted-foreground')}
                aria-label="Voice toggle"
              >
                <Volume2 className="w-5 h-5" />
              </button>

              {!isInWorkspace && (
                <button onClick={handleNewChat} className="p-2 rounded-md hover:bg-muted text-muted-foreground transition-colors" aria-label="New chat">
                  <Plus className="w-5 h-5" />
                </button>
              )}

              <div className="w-8 h-8 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-xs font-semibold">
                {userName ? getInitials(userName) : 'U'}
              </div>
            </div>
          </div>
        </header>

        {/* Conversation — the heart of the app */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain pb-2">
          {initialLoading ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
              <div className="text-sm">Loading Jobrolo…</div>
            </div>
          ) : (
            <>
              {displayMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full px-6 text-center">
              {isInWorkspace ? (
                <>
                  <div className="w-14 h-14 rounded-2xl bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 flex items-center justify-center text-lg font-bold mb-3 glow-blue">
                    {currentWorkspace ? getInitials(currentWorkspace.name) : 'W'}
                  </div>
                  <h3 className="font-semibold text-foreground mb-1">Jobrolo is listening</h3>
                  <p className="text-sm text-muted-foreground max-w-sm">Tap the mic and talk — Jobrolo routes updates automatically.</p>
                </>
              ) : (
                <>
                  <div className="w-14 h-14 rounded-2xl glow-blue overflow-hidden mb-3">
                    <img src="/logo.png" alt="Jobrolo" className="w-full h-full object-cover" />
                  </div>
                  <h3 className="font-semibold text-foreground mb-1">How can I help today?</h3>
                  <p className="text-sm text-muted-foreground max-w-sm">Ask me anything. I'll route updates to the right people.</p>
                </>
              )}
            </div>
              ) : (
            <div className="py-3">
              {displayMessages.map(m => (
                <MessageBubble
                  key={m.id}
                  message={m}
                  onSpeak={autoTTS ? undefined : (text) => tts.speak(text)}
                  isSpeaking={tts.currentText === m.content && tts.isPlaying}
                />
              ))}
              {!isInWorkspace && (isTyping || isStreaming) && <StreamingBubble text={streamingText} />}
              {isInWorkspace && isWorkspaceTyping && <StreamingBubble text={workspaceStreamingText} />}
            </div>
              )}
            </>
          )}
        </div>

        {/* Upload progress */}
        {!isInWorkspace && uploadProgress.length > 0 && <UploadProgressIndicator uploads={uploadProgress} />}

        {/* Input — always at bottom, always accessible */}
        <div style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <ChatInput
            onSend={handleSend}
            onStop={handleStop}
            disabled={inputDisabled}
            isWorking={isAIWorking}
            placeholder={isInWorkspace ? 'Message Jobrolo about this job…' : 'Message Jobrolo…'}
          />
        </div>
      </div>

    </div>
  )
}
