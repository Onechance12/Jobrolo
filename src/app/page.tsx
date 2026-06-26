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
import { Button } from '@/components/ui/button'
import { cn, getInitials } from '@/lib/utils'
import { ArrowLeft, Plus, Loader2, Menu, Volume2, LogOut, MapPin, UserPlus, X, Copy, Check, Settings, Bell } from 'lucide-react'
import { ThemeToggle } from '@/components/theme-toggle'
import type { ClientMessage } from '@/lib/types'

export default function Page() {
  const [initialLoading, setInitialLoading] = useState(true)
  const [leftDrawerOpen, setLeftDrawerOpen] = useState(false)
  const [autoTTS, setAutoTTS] = useState(false)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
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
  const currentChat = currentWorkspace?.chats.find(c => c.id === currentChatId) ?? null
  const scrollRef = useRef<HTMLDivElement>(null)
  const prevMsgCount = useRef(0)

  // Init
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        let currentUserRole = 'owner'
        const meRes = await fetch('/api/auth/me')
        if (meRes.ok) {
          const me = await meRes.json()
          if (!me.authenticated) { window.location.href = '/signup'; return }
          if (!me.onboardingComplete) { window.location.href = '/onboarding'; return }
          setUserName(me.user?.name || 'there')
          currentUserRole = me.user?.role || currentUserRole
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
          const params = new URLSearchParams(window.location.search)
          const linkedWorkspaceId = params.get('workspaceId')
          const linkedChatId = params.get('chatId')
          const linkedWorkspace = linkedWorkspaceId ? d.workspaces?.find((w: any) => w.id === linkedWorkspaceId) : null
          const invitedWorkspaceId = window.localStorage.getItem('jobroloInviteWorkspaceId')
          const invitedChatId = window.localStorage.getItem('jobroloInviteChatId')
          const invitedWorkspace = invitedWorkspaceId ? d.workspaces?.find((w: any) => w.id === invitedWorkspaceId) : null
          if (linkedWorkspace) {
            useWorkspaceStore.getState().enterWorkspace(linkedWorkspace.id, linkedChatId || undefined)
          } else if (invitedWorkspace) {
            useWorkspaceStore.getState().enterWorkspace(invitedWorkspace.id, invitedChatId || undefined)
            window.localStorage.removeItem('jobroloInviteWorkspaceId')
            window.localStorage.removeItem('jobroloInviteChatId')
          } else if (!hasCompanyWideUiRole(currentUserRole) && d.workspaces?.[0]) {
            useWorkspaceStore.getState().enterWorkspace(d.workspaces[0].id)
          }
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
    return isInWorkspace ? sendWorkspaceMessage(args) : sendMessage(args)
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
    <div className="h-dvh w-full max-w-full flex bg-background text-foreground overflow-hidden">
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
      <div className="flex-1 flex flex-col min-w-0 max-w-full bg-background relative overflow-hidden">
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

              {isInWorkspace && currentWorkspace && (
                <button
                  onClick={() => setInviteOpen(true)}
                  className="flex items-center gap-1.5 rounded-full border border-border bg-background p-2 text-xs font-medium text-foreground shadow-sm hover:bg-muted sm:px-3 sm:py-1.5"
                  aria-label="Invite people to this chat"
                >
                  <UserPlus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Invite</span>
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

              <div className="relative">
                <button
                  onClick={() => setProfileMenuOpen(v => !v)}
                  className="w-8 h-8 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-xs font-semibold hover:bg-muted/80"
                  aria-label="Profile menu"
                >
                  {userName ? getInitials(userName) : 'U'}
                </button>
                {profileMenuOpen && (
                  <div className="absolute right-0 top-10 z-30 w-56 overflow-hidden rounded-2xl border border-border bg-popover p-1 text-popover-foreground shadow-xl">
                    <div className="px-3 py-2">
                      <div className="text-sm font-semibold">{userName || 'Jobrolo user'}</div>
                      <div className="text-xs text-muted-foreground">Profile & settings</div>
                    </div>
                    <button
                      onClick={() => { setProfileMenuOpen(false); window.location.href = '/settings/company' }}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-muted"
                    >
                      <Settings className="h-4 w-4" /> Company profile
                    </button>
                    <button
                      onClick={() => { setProfileMenuOpen(false); window.location.href = '/settings/notifications' }}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-muted"
                    >
                      <Bell className="h-4 w-4" /> Notifications
                    </button>
                    <button
                      onClick={() => { setProfileMenuOpen(false); handleLogout() }}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                    >
                      <LogOut className="h-4 w-4" /> Log out
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* Conversation — the heart of the app */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain pb-2">
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

      {inviteOpen && currentWorkspace && (
        <InvitePeopleModal
          workspace={currentWorkspace}
          chat={currentChat}
          onClose={() => setInviteOpen(false)}
        />
      )}

    </div>
  )
}

function hasCompanyWideUiRole(role?: string | null) {
  return ['owner', 'admin', 'manager', 'project_manager'].includes(String(role ?? '').toLowerCase())
}

function InvitePeopleModal({
  workspace,
  chat,
  onClose,
}: {
  workspace: any
  chat: any
  onClose: () => void
}) {
  const [members, setMembers] = useState<any[]>([])
  const [copied, setCopied] = useState(false)
  const [copiedChatLink, setCopiedChatLink] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [chatLink, setChatLink] = useState('')
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    role: defaultInviteRole(chat?.chatType),
    sendEmail: false,
    sendSms: false,
  })

  useEffect(() => {
    setChatLink(`${window.location.origin}/?workspaceId=${encodeURIComponent(workspace.id)}${chat?.id ? `&chatId=${encodeURIComponent(chat.id)}` : ''}`)
  }, [workspace.id, chat?.id])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const res = await fetch(`/api/workspaces/${workspace.id}/members`).catch(() => null)
      if (!res?.ok || cancelled) return
      const data = await res.json().catch(() => ({}))
      setMembers(data.members || [])
    })()
    return () => { cancelled = true }
  }, [workspace.id])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setInviteUrl(null)
    setCopied(false)
    setLoading(true)
    try {
      const res = await fetch(`/api/workspaces/${workspace.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          chatId: chat?.id,
          phone: form.phone.trim() || null,
          note: chat?.chatType === 'crew' ? 'Please use this chat for job notes, crew updates, photos, and questions.' : null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Invite failed')
        return
      }
      setInviteUrl(data.invite?.inviteUrl || null)
      setMembers(prev => [
        ...prev.filter(member => member.user?.id !== data.invite?.user?.id),
        { id: data.invite?.member?.id, role: data.invite?.member?.role, permissions: data.invite?.member?.permissions, user: data.invite?.user },
      ])
      setForm(f => ({ ...f, name: '', email: '', phone: '' }))
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function copyInvite() {
    if (!inviteUrl) return
    await navigator.clipboard?.writeText(inviteUrl).catch(() => null)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  async function copyChatLink() {
    if (!chatLink) return
    await navigator.clipboard?.writeText(chatLink).catch(() => null)
    setCopiedChatLink(true)
    setTimeout(() => setCopiedChatLink(false), 1800)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="w-full max-w-lg rounded-t-3xl border border-border bg-background p-4 shadow-2xl sm:rounded-3xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="text-lg font-semibold">Invite people to this chat</div>
            <div className="text-sm text-muted-foreground">
              {workspace.name}{chat?.title ? ` · ${chat.title}` : ''}
            </div>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-muted-foreground hover:bg-muted" aria-label="Close invite dialog">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-4 rounded-2xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-100">
          <div className="font-medium">Copy-first invite flow</div>
          <p className="mt-1 text-blue-800 dark:text-blue-200">
            Create a secure invite link, then copy it and text it yourself. Email and Twilio SMS are optional add-ons, not required.
          </p>
        </div>

        {chatLink ? (
          <div className="mb-4 rounded-2xl border border-border bg-muted/40 p-3 text-sm">
            <div className="font-medium">Direct chat link for existing members</div>
            <p className="mt-1 text-muted-foreground">
              Use this when someone already has access. It opens this workspace/chat after they log in.
            </p>
            <div className="mt-2 break-all rounded-xl bg-background px-3 py-2 text-xs text-muted-foreground">{chatLink}</div>
            <button onClick={copyChatLink} className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted">
              {copiedChatLink ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copiedChatLink ? 'Copied' : 'Copy chat link'}
            </button>
          </div>
        ) : null}

        <form onSubmit={submit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="font-medium">Name</span>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required className="w-full rounded-xl border border-border bg-background px-3 py-2 outline-none focus:border-blue-500" placeholder="Jose Ramirez" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Role</span>
              <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} className="w-full rounded-xl border border-border bg-background px-3 py-2 outline-none focus:border-blue-500">
                <option value="employee">Employee</option>
                <option value="manager">Manager</option>
                <option value="sales">Sales</option>
                <option value="crew">Crew</option>
                <option value="subcontractor">Subcontractor</option>
                <option value="customer">Customer/Homeowner</option>
              </select>
            </label>
          </div>
          <label className="space-y-1 text-sm block">
            <span className="font-medium">Email for account invite</span>
            <input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required type="email" className="w-full rounded-xl border border-border bg-background px-3 py-2 outline-none focus:border-blue-500" placeholder="name@example.com" />
          </label>
          <label className="space-y-1 text-sm block">
            <span className="font-medium">Phone for SMS invite, optional</span>
            <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className="w-full rounded-xl border border-border bg-background px-3 py-2 outline-none focus:border-blue-500" placeholder="817-555-1212" />
          </label>
          <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.sendEmail} onChange={e => setForm({ ...form, sendEmail: e.target.checked })} />
              Also email this invite
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.sendSms} onChange={e => setForm({ ...form, sendSms: e.target.checked })} />
              Also send SMS if Twilio is configured
            </label>
          </div>
          {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">{error}</div> : null}
          <Button type="submit" disabled={loading} className="w-full bg-blue-600 text-white hover:bg-blue-700">
            {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating invite…</> : 'Create invite'}
          </Button>
        </form>

        {inviteUrl ? (
          <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 p-3 text-sm dark:border-blue-900 dark:bg-blue-950/30">
            <div className="mb-1 font-medium text-blue-900 dark:text-blue-100">Invite link created</div>
            <div className="break-all text-blue-800 dark:text-blue-200">{inviteUrl}</div>
            <button onClick={copyInvite} className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-3 py-1.5 text-xs font-medium text-white">
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy link'}
            </button>
          </div>
        ) : null}

        <div className="mt-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Shared with</div>
          {members.length ? (
            <div className="max-h-36 space-y-2 overflow-y-auto">
              {members.map(member => (
                <div key={member.id ?? member.user?.id} className="flex items-center justify-between rounded-xl border border-border px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{member.user?.name || member.user?.email}</div>
                    <div className="truncate text-xs text-muted-foreground">{member.user?.email} · {member.user?.status}</div>
                  </div>
                  <span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">{member.role || member.user?.role}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border p-3 text-sm text-muted-foreground">No shared members yet.</div>
          )}
        </div>
      </div>
    </div>
  )
}

function defaultInviteRole(chatType?: string | null) {
  if (chatType === 'customer') return 'customer'
  if (chatType === 'crew') return 'crew'
  if (chatType === 'sales') return 'sales'
  return 'employee'
}
