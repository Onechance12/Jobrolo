'use client'
import { useEffect, useRef, useState, useCallback, type ReactNode } from 'react'
import { useChatStore } from '@/store/chat-store'
import { useWorkspaceStore } from '@/store/workspace-store'
import { useChat } from '@/hooks/use-chat'
import { useWorkspaceChat } from '@/hooks/use-workspace-chat'
import { useTTS } from '@/hooks/use-tts'
import { WorkspaceSidebar } from '@/components/jobrolo/workspace-sidebar'
import { MessageBubble, StreamingBubble } from '@/components/jobrolo/message-bubble'
import { ChatInput } from '@/components/jobrolo/chat-input'
import { UploadProgressIndicator } from '@/components/jobrolo/upload-progress'
import { FieldCopilotDrawer } from '@/components/jobrolo/field-copilot-drawer'
import { FieldEntryStrip } from '@/components/jobrolo/field-entry-strip'
import { Button } from '@/components/ui/button'
import { cn, getInitials } from '@/lib/utils'
import { ArrowLeft, Plus, Loader2, Menu, Volume2, LogOut, MapPin, UserPlus, X, Copy, Check, Settings, Bell, MessageCircle, Briefcase, Home, Hammer, Upload, Users, ChevronDown, ChevronRight, ExternalLink, CheckCircle2, XCircle, Trash2 } from 'lucide-react'
import { ThemeToggle } from '@/components/theme-toggle'
import type { ClientMessage } from '@/lib/types'

type ActionNeededItem = {
  id: string
  type?: string
  title?: string
  summary?: string | null
  priority?: string | null
  status?: string | null
  role?: string | null
  projectId?: string | null
  customerId?: string | null
  actionRequestId?: string | null
  relatedType?: string | null
  relatedId?: string | null
  payloadJson?: string | null
  createdAt?: string
  synthetic?: boolean
}

function isOpenMapRequest(text: string) {
  const firstLine = text.split('\n')[0]?.toLowerCase().replace(/[’']/g, "'").replace(/[?.!]/g, '').trim() || ''
  return /^(open|show|pull up|bring up|launch)\s+(the\s+)?(field\s+|job\s+|current\s+)?map\b/.test(firstLine)
    || /^(map)(\s+where i am|\s+where i'm at|\s+my location|\s+current location|\s+here)?$/.test(firstLine)
}

function isInspectionPhotoWorkflowRequest(text: string) {
  const firstLine = text.split('\n')[0]?.toLowerCase().replace(/[’']/g, "'").replace(/[?.!]/g, '').trim() || ''
  if (!firstLine) return false
  return (
    /\b(start|open|launch|begin|show|get|give me)\b.{0,80}\b(inspection photo workflow|inspection photos|photo checklist|inspection checklist|roof photo capture|roof photos)\b/.test(firstLine) ||
    /\binspection\b.{0,80}\b(photo workflow|photo checklist|photo capture|photos first|capture first)\b/.test(firstLine)
  )
}

export default function Page() {
  const [initialLoading, setInitialLoading] = useState(true)
  const [leftDrawerOpen, setLeftDrawerOpen] = useState(false)
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(false)
  const [autoTTS, setAutoTTS] = useState(false)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [startMenuOpen, setStartMenuOpen] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [actionCenterOpen, setActionCenterOpen] = useState(false)
  const [actionItems, setActionItems] = useState<ActionNeededItem[]>([])
  const [actionItemsLoading, setActionItemsLoading] = useState(false)
  const [fieldCopilotOpen, setFieldCopilotOpen] = useState(false)
  const proactiveRunKey = useRef<string | null>(null)
  const [userName, setUserName] = useState('')
  const [userAvatar, setUserAvatar] = useState<string | null>(null)
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

  const loadActionItems = useCallback(async () => {
    setActionItemsLoading(true)
    try {
      const res = await fetch('/api/notifications?limit=50')
      if (!res.ok) return
      const data = await res.json().catch(() => ({}))
      setActionItems(Array.isArray(data.items) ? data.items : [])
    } catch (err) {
      console.warn('[page] action needed load failed:', err)
    } finally {
      setActionItemsLoading(false)
    }
  }, [])

  const isInWorkspace = !!currentWorkspaceId && !!currentChatId
  const currentWorkspace = workspaces.find(w => w.id === currentWorkspaceId)
  const currentChat = currentWorkspace?.chats.find(c => c.id === currentChatId) ?? null
  const actionNeededCount = actionItems.filter(item => !['actioned', 'archived'].includes(String(item.status ?? ''))).length
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
          setUserAvatar(me.user?.avatar || null)
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
    if (initialLoading) return
    void loadActionItems()
    const timer = window.setInterval(() => { void loadActionItems() }, 60_000)
    return () => window.clearInterval(timer)
  }, [initialLoading, loadActionItems])

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

  const openFieldMap = useCallback(() => {
    const current = `${window.location.pathname}${window.location.search}` || '/'
    const returnTo = current.startsWith('/canvassing') ? '/' : current
    window.location.assign(`/canvassing?returnTo=${encodeURIComponent(returnTo)}`)
  }, [])

  const handleSend = useCallback((args: { text: string; displayText?: string; attachments?: File[]; uploadFields?: Record<string, string> }) => {
    const visibleText = (args.displayText ?? args.text).trim()
    if (visibleText && !args.attachments?.length && isOpenMapRequest(visibleText)) {
      const userMessage: ClientMessage = { id: crypto.randomUUID(), role: 'user', content: visibleText, createdAt: new Date().toISOString() }
      const assistantMessage: ClientMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'Opening the field map. This is just the map overlay — I am not starting a canvassing run or creating a lead.',
        contextType: 'field_event',
        contextData: {
          cardType: 'field_event',
          action: 'open_map',
          mode: 'field',
          title: 'Opening field map',
          summary: 'Map opened without creating a field lead, canvassing run, customer, or project.',
          projectId: currentWorkspace?.projectId ?? null,
        },
        createdAt: new Date().toISOString(),
      }
      if (isInWorkspace) {
        addWorkspaceMessage(userMessage)
        addWorkspaceMessage(assistantMessage)
      } else {
        addGlobalMessage(userMessage)
        addGlobalMessage(assistantMessage)
      }
      window.setTimeout(openFieldMap, 80)
      return { ok: true }
    }
    if (isInWorkspace && currentWorkspace?.projectId && visibleText && !args.attachments?.length && isInspectionPhotoWorkflowRequest(visibleText)) {
      const userMessage: ClientMessage = { id: crypto.randomUUID(), role: 'user', content: visibleText, createdAt: new Date().toISOString() }
      const assistantMessage: ClientMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'Inspection photo workflow is ready. Pick the section you are capturing first — front elevation, roof, damage, soft metals, interior, attic, detached structures, or documents — then take/upload photos. I will tag them to this job instead of guessing later.',
        contextType: 'field_event',
        contextData: {
          cardType: 'field_event',
          action: 'start_inspection_photo_workflow',
          mode: 'inspection',
          title: 'Inspection photo workflow ready',
          summary: 'Use the photo intake card below to capture photos by section and save them to this job.',
          projectId: currentWorkspace.projectId,
        },
        createdAt: new Date().toISOString(),
      }
      addWorkspaceMessage(userMessage)
      addWorkspaceMessage(assistantMessage)
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent('jobrolo:open-inspection-photo-intake', { detail: {} }))
      }, 80)
      return { ok: true }
    }
    return isInWorkspace ? sendWorkspaceMessage(args) : sendMessage(args)
  }, [addGlobalMessage, addWorkspaceMessage, currentWorkspace?.projectId, isInWorkspace, openFieldMap, sendWorkspaceMessage, sendMessage])

  const handleStop = useCallback(() => {
    isInWorkspace ? stopWorkspaceMessage() : stopMessage()
  }, [isInWorkspace, stopMessage, stopWorkspaceMessage])

  const insertPrompt = useCallback((text: string) => {
    window.dispatchEvent(new CustomEvent('jobrolo:insert-prompt', { detail: { text } }))
  }, [])

  const handleFieldEvent = useCallback((event: { action: string; title: string; summary?: string; mode?: string }) => {
    if (!isInWorkspace) return
    addWorkspaceMessage({
      id: `field-local-${Date.now()}`,
      role: 'system',
      content: event.summary ? `${event.title}\n${event.summary}` : event.title,
      contextType: 'field_event',
      contextData: {
        cardType: 'field_event',
        action: event.action,
        mode: event.mode ?? 'field',
        title: event.title,
        summary: event.summary,
        projectId: currentWorkspace?.projectId ?? null,
      },
      createdAt: new Date().toISOString(),
    })
  }, [isInWorkspace, addWorkspaceMessage, currentWorkspace?.projectId])

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
    setStartMenuOpen(false)
    try {
      const r = await fetch('/api/conversations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New private chat' }),
      })
      if (r.ok) {
        const d = await r.json()
        selectConversation(d.conversation.id)
        setConversations([{
          id: d.conversation.id, title: 'New private chat', preview: '', messageCount: 0,
          createdAt: d.conversation.createdAt, updatedAt: d.conversation.updatedAt,
        }, ...useChatStore.getState().conversations])
        setMessages([{
          id: 'g-' + Date.now(), role: 'assistant',
          content: 'What can I help you with?', createdAt: new Date().toISOString(),
        }])
      }
    } catch {}
  }, [exitWorkspace, selectConversation, setConversations, setMessages])

  const handleStartPrompt = useCallback((text: string) => {
    setStartMenuOpen(false)
    exitWorkspace()
    if (conversationId) selectConversation(conversationId)
    insertPrompt(text)
  }, [conversationId, exitWorkspace, insertPrompt, selectConversation])

  const handleStartUpload = useCallback(() => {
    setStartMenuOpen(false)
    window.dispatchEvent(new Event('jobrolo:open-file-picker'))
  }, [])

  const handleStartMap = useCallback(() => {
    setStartMenuOpen(false)
    openFieldMap()
  }, [openFieldMap])

  const openWorkspaceChat = useCallback(async (workspaceId: string, chatId?: string | null, opts?: { updateUrl?: boolean }) => {
    if (!workspaceId) return
    setStartMenuOpen(false)
    setProfileMenuOpen(false)
    setLeftDrawerOpen(false)

    let workspaceList = useWorkspaceStore.getState().workspaces
    let workspace = workspaceList.find(w => w.id === workspaceId)
    let hasRequestedChat = !chatId || !!workspace?.chats?.some(chat => chat.id === chatId)

    if (!workspace || !hasRequestedChat) {
      const res = await fetch('/api/workspaces').catch(() => null)
      if (res?.ok) {
        const data = await res.json().catch(() => ({}))
        if (Array.isArray(data.workspaces)) {
          setWorkspaces(data.workspaces)
          workspaceList = data.workspaces
          workspace = workspaceList.find((w: any) => w.id === workspaceId)
          hasRequestedChat = !chatId || !!workspace?.chats?.some((chat: any) => chat.id === chatId)
        }
      }
    }

    if (!workspace) {
      const href = `/?workspaceId=${encodeURIComponent(workspaceId)}${chatId ? `&chatId=${encodeURIComponent(chatId)}` : ''}`
      window.location.assign(href)
      return
    }

    enterWorkspace(workspaceId, hasRequestedChat ? chatId ?? undefined : undefined)
    if (opts?.updateUrl !== false) {
      const href = `/?workspaceId=${encodeURIComponent(workspaceId)}${chatId ? `&chatId=${encodeURIComponent(chatId)}` : ''}`
      window.history.pushState({ jobroloWorkspaceId: workspaceId, jobroloChatId: chatId ?? null }, '', href)
    }
  }, [enterWorkspace, setWorkspaces])

  useEffect(() => {
    function onOpenWorkspaceChat(event: Event) {
      const detail = (event as CustomEvent<{ workspaceId?: string; chatId?: string | null }>).detail
      if (!detail?.workspaceId) return
      void openWorkspaceChat(String(detail.workspaceId), detail.chatId ? String(detail.chatId) : undefined)
    }

    function onOpenFieldMap() {
      openFieldMap()
    }

    function onPopState() {
      const params = new URLSearchParams(window.location.search)
      const workspaceId = params.get('workspaceId')
      const chatId = params.get('chatId')
      if (workspaceId) void openWorkspaceChat(workspaceId, chatId, { updateUrl: false })
      else exitWorkspace()
    }

    window.addEventListener('jobrolo:open-workspace-chat', onOpenWorkspaceChat)
    window.addEventListener('jobrolo:open-field-map', onOpenFieldMap)
    window.addEventListener('popstate', onPopState)
    return () => {
      window.removeEventListener('jobrolo:open-workspace-chat', onOpenWorkspaceChat)
      window.removeEventListener('jobrolo:open-field-map', onOpenFieldMap)
      window.removeEventListener('popstate', onPopState)
    }
  }, [exitWorkspace, openFieldMap, openWorkspaceChat])

  const handleExitToCommandCenter = useCallback(() => {
    exitWorkspace()
    if (conversationId) selectConversation(conversationId)
    window.history.pushState({ jobroloCommandCenter: true }, '', '/')
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

  useEffect(() => {
    function onUserAvatarUpdated(event: Event) {
      const avatarUrl = (event as CustomEvent<{ avatarUrl?: string }>).detail?.avatarUrl
      if (avatarUrl) setUserAvatar(avatarUrl)
    }
    window.addEventListener('jobrolo:user-avatar-updated', onUserAvatarUpdated)
    return () => window.removeEventListener('jobrolo:user-avatar-updated', onUserAvatarUpdated)
  }, [])

  const displayMessages = isInWorkspace ? workspaceMessages : messages
  const inputDisabled = isInWorkspace ? isWorkspaceTyping : (isStreaming && !uploadProgress.length)
  const isAIWorking = isInWorkspace ? isWorkspaceTyping : (isTyping || isStreaming)
  const recentFieldContext = displayMessages.slice(-8).some(message => {
    const cardType = String((message.contextData as any)?.cardType || message.contextType || '').toLowerCase()
    return cardType.includes('field') || cardType.includes('canvassing') || cardType.includes('property_research') || cardType.includes('property_memory') || cardType.includes('street_game_plan')
  })
  const inputMode = (isInWorkspace && currentWorkspace?.projectId) || recentFieldContext ? 'field' : 'command'

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
      {!desktopSidebarCollapsed && (
      <div className="hidden lg:flex h-full w-64 flex-shrink-0">
        <div className="w-full flex flex-col h-full">
          <WorkspaceSidebar onNewChat={handleNewChat} onCollapse={() => setDesktopSidebarCollapsed(true)} />
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
      )}

      {/* LEFT PANEL — Mobile drawer */}
      {leftDrawerOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setLeftDrawerOpen(false)} />
          <div className="relative z-10 h-full w-[min(92vw,22rem)] min-w-0 flex flex-col animate-slide-in-right">
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
              {/* Menu: mobile opens drawer, desktop collapses/expands sidebar */}
              <button
                onClick={() => {
                  if (window.matchMedia('(min-width: 1024px)').matches) setDesktopSidebarCollapsed(v => !v)
                  else setLeftDrawerOpen(true)
                }}
                className="p-2 -ml-2 rounded-md hover:bg-muted text-foreground"
                aria-label={desktopSidebarCollapsed ? 'Expand menu' : 'Menu'}
                title={desktopSidebarCollapsed ? 'Expand menu' : 'Menu'}
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
                      Job chat · actions route automatically
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
                  onClick={() => setFieldCopilotOpen(true)}
                  className="hidden sm:flex items-center gap-1.5 rounded-full bg-blue-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-blue-700"
                  aria-label="Open field briefing"
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

              <div className="relative">
                <button
                  onClick={() => setActionCenterOpen(v => !v)}
                  className={cn(
                    'relative p-2 rounded-md transition-colors',
                    actionCenterOpen ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300' : 'hover:bg-muted text-muted-foreground',
                  )}
                  aria-label="Action needed"
                  aria-expanded={actionCenterOpen}
                >
                  <Bell className="w-5 h-5" />
                  {actionNeededCount > 0 ? (
                    <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold leading-none text-white">
                      {actionNeededCount > 9 ? '9+' : actionNeededCount}
                    </span>
                  ) : null}
                </button>
                {actionCenterOpen ? (
                  <ActionNeededMenu
                    items={actionItems}
                    loading={actionItemsLoading}
                    onRefresh={loadActionItems}
                    onClose={() => setActionCenterOpen(false)}
                  />
                ) : null}
              </div>

              {!isInWorkspace && (
                <div className="relative">
                  <button
                    onClick={() => setStartMenuOpen(v => !v)}
                    className="flex items-center gap-1 rounded-md px-2 py-2 text-muted-foreground transition-colors hover:bg-muted"
                    aria-label="Start or create"
                    aria-expanded={startMenuOpen}
                  >
                    <Plus className="w-5 h-5" />
                    <span className="hidden text-xs font-medium sm:inline">Start</span>
                  </button>
                  {startMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-20" onClick={() => setStartMenuOpen(false)} />
                      <StartCreateMenu
                        onPrivateChat={handleNewChat}
                        onPrompt={handleStartPrompt}
                        onUpload={handleStartUpload}
                        onOpenMap={handleStartMap}
                      />
                    </>
                  )}
                </div>
              )}

              <div className="relative">
                <button
                  onClick={() => setProfileMenuOpen(v => !v)}
                  className="w-8 h-8 overflow-hidden rounded-full bg-muted text-muted-foreground flex items-center justify-center text-xs font-semibold hover:bg-muted/80"
                  aria-label="Profile menu"
                >
                  {userAvatar ? (
                    <img src={userAvatar} alt={userName || 'Profile'} className="h-full w-full object-cover" />
                  ) : (
                    userName ? getInitials(userName) : 'U'
                  )}
                </button>
                {profileMenuOpen && (
                  <div className="absolute right-0 top-10 z-30 w-56 overflow-hidden rounded-2xl border border-border bg-popover p-1 text-popover-foreground shadow-xl">
                    <div className="px-3 py-2">
                      <div className="text-sm font-semibold">{userName || 'Jobrolo user'}</div>
                      <div className="text-xs text-muted-foreground">Profile & settings</div>
                    </div>
                    <button
                      onClick={() => { setProfileMenuOpen(false); handleStartPrompt('I want to update my account profile photo/avatar.') }}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-muted"
                    >
                      <Upload className="h-4 w-4" /> Profile photo
                    </button>
                    <button
                      onClick={() => { setProfileMenuOpen(false); handleStartPrompt('Show my saved company profile. If anything important is missing for estimates, invoices, roof reports, contracts, signatures, or customer-facing documents, show it as a company profile card.') }}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-muted"
                    >
                      <Settings className="h-4 w-4" /> Company profile
                    </button>
                    <button
                      onClick={() => { setProfileMenuOpen(false); handleStartPrompt('What needs attention right now? Show pending approvals, review items, invites, failed work, routed tasks, and anything I need to decide.') }}
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

        {isInWorkspace && currentWorkspace?.projectId && (
          <FieldEntryStrip
            workspace={currentWorkspace}
            onOpenFieldCopilot={() => setFieldCopilotOpen(true)}
            onSendPrompt={insertPrompt}
            onFieldEvent={handleFieldEvent}
          />
        )}

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
                  userAvatar={userAvatar}
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
            mode={inputMode}
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

      {currentWorkspace?.projectId ? (
        <FieldCopilotDrawer
          open={fieldCopilotOpen}
          onOpenChange={setFieldCopilotOpen}
          projectId={currentWorkspace.projectId}
        />
      ) : null}

    </div>
  )
}

function hasCompanyWideUiRole(role?: string | null) {
  return ['owner', 'admin', 'manager', 'project_manager'].includes(String(role ?? '').toLowerCase())
}

function parseActionPayload(item: ActionNeededItem): Record<string, any> {
  if (!item.payloadJson) return {}
  try {
    const parsed = JSON.parse(item.payloadJson)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function actionLabel(value?: string | null) {
  return String(value || 'item').replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function ActionNeededMenu({
  items,
  loading,
  onRefresh,
  onClose,
}: {
  items: ActionNeededItem[]
  loading: boolean
  onRefresh: () => void | Promise<void>
  onClose: () => void
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())
  const [busyDecisionId, setBusyDecisionId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const hiddenStatuses = new Set(['actioned', 'archived', 'completed', 'rejected', 'cancelled'])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem('jobrolo.actionCenter.dismissed.v1')
      if (raw) setDismissedIds(new Set(JSON.parse(raw)))
    } catch {}
  }, [])

  function saveDismissed(next: Set<string>) {
    setDismissedIds(next)
    if (typeof window !== 'undefined') {
      try { window.localStorage.setItem('jobrolo.actionCenter.dismissed.v1', JSON.stringify([...next].slice(-200))) } catch {}
    }
  }

  const visible = items
    .filter(item => !hiddenStatuses.has(String(item.status ?? '').toLowerCase()))
    .filter(item => !dismissedIds.has(item.id))
    .slice(0, 12)

  async function mark(id: string, status: 'read' | 'actioned' | 'archived') {
    await fetch(`/api/notifications/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }).catch(() => null)
    await onRefresh()
  }

  async function hideItem(item: ActionNeededItem) {
    setMessage(null)
    if (item.synthetic || item.id.startsWith('synthetic:')) {
      saveDismissed(new Set([...dismissedIds, item.id]))
      return
    }
    await mark(item.id, 'archived')
  }

  async function deleteItem(item: ActionNeededItem) {
    setMessage(null)
    if (!window.confirm('Remove this item from Action Needed? This only clears the notification/card, not the underlying job file unless you approve a destructive action separately.')) return
    if (item.synthetic || item.id.startsWith('synthetic:')) {
      saveDismissed(new Set([...dismissedIds, item.id]))
      return
    }
    await mark(item.id, 'archived')
  }

  async function hideVisible() {
    setMessage(null)
    const synthetic = visible.filter(item => item.synthetic || item.id.startsWith('synthetic:')).map(item => item.id)
    const real = visible.filter(item => !item.synthetic && !item.id.startsWith('synthetic:')).map(item => item.id)
    if (synthetic.length) saveDismissed(new Set([...dismissedIds, ...synthetic]))
    await Promise.all(real.map(id => mark(id, 'archived').catch(() => null)))
    await onRefresh()
  }

  async function decide(item: ActionNeededItem, decision: 'approved' | 'rejected') {
    if (!item.actionRequestId) return
    setBusyDecisionId(`${item.id}:${decision}`)
    setMessage(null)
    try {
      const res = await fetch(`/api/action-requests/${item.actionRequestId}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(String(data?.error || 'Decision failed'))
      setMessage(decision === 'approved' ? 'Approved. If this action can run now, Jobrolo is running it.' : 'Rejected. Jobrolo will not run this action.')
      saveDismissed(new Set([...dismissedIds, item.id]))
      await onRefresh()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not update this request.')
    } finally {
      setBusyDecisionId(null)
    }
  }

  function openItem(item: ActionNeededItem) {
    const payload = parseActionPayload(item)
    if (payload.workspaceId) {
      window.dispatchEvent(new CustomEvent('jobrolo:open-workspace-chat', {
        detail: { workspaceId: String(payload.workspaceId), chatId: payload.chatId ? String(payload.chatId) : undefined },
      }))
      onClose()
      return
    }
    if (typeof payload.chatUrl === 'string' && payload.chatUrl) {
      window.location.assign(payload.chatUrl)
      return
    }
    const prompt = payload.documentId
      ? `Review document ${payload.documentId}. Tell me what is saved, what needs review, and what actions are available.`
      : item.actionRequestId
      ? `Show me the pending approval/action request ${item.actionRequestId} and tell me exactly what will happen before I approve it.`
      : `Show me this Action Needed item and what I should do next: ${item.title || item.type || item.id}`
    window.dispatchEvent(new CustomEvent('jobrolo:insert-prompt', { detail: { text: prompt } }))
    onClose()
  }

  return (
    <div className="fixed inset-x-3 top-[4.75rem] z-50 max-h-[calc(100dvh-9rem)] w-auto overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-10 sm:max-h-none sm:w-[min(24rem,calc(100vw-1.5rem))]">
      <div className="flex min-w-0 items-start justify-between gap-3 border-b border-border p-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold">Action Needed</div>
          <div className="text-xs text-muted-foreground">Tap an item to review, approve, open, or hide it.</div>
        </div>
        <button onClick={onClose} className="shrink-0 rounded-full p-1.5 text-muted-foreground hover:bg-muted" aria-label="Close action needed">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="max-h-[calc(100dvh-14rem)] overflow-y-auto overflow-x-hidden p-2 sm:max-h-[60vh]">
        {message ? <div className="mb-2 rounded-xl border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-xs text-blue-700 dark:text-blue-200">{message}</div> : null}
        {loading && !visible.length ? (
          <div className="flex items-center gap-2 rounded-xl px-3 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading action items…
          </div>
        ) : null}
        {!loading && !visible.length ? (
          <div className="rounded-xl px-3 py-4 text-sm text-muted-foreground">Nothing needs your attention right now.</div>
        ) : null}
        {visible.map(item => {
          const payload = parseActionPayload(item)
          const expanded = expandedId === item.id
          const fileUrl = typeof payload.fileUrl === 'string' ? payload.fileUrl : null
          const thumbnailUrl = typeof payload.thumbnailUrl === 'string' ? payload.thumbnailUrl : null
          const mimeType = typeof payload.mimeType === 'string' ? payload.mimeType : ''
          const fileType = typeof payload.fileType === 'string' ? payload.fileType : ''
          const isImage = mimeType.startsWith('image/') || fileType === 'photo'
          const approvalDetails = payload.approvalDetails && typeof payload.approvalDetails === 'object' ? payload.approvalDetails as Record<string, any> : null
          const detailRows = Array.isArray(approvalDetails?.details) ? approvalDetails.details.slice(0, 8) as Array<{ label?: string; value?: unknown }> : []
          return (
            <div key={item.id} className="mb-2 min-w-0 overflow-hidden rounded-xl border border-border bg-card">
              <button
                type="button"
                onClick={() => setExpandedId(expanded ? null : item.id)}
                className="flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-muted/40"
              >
                <span className="mt-0.5 shrink-0 text-muted-foreground">{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{item.title || actionLabel(item.type)}</span>
                  <span className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
                    <span className="rounded-full bg-muted px-2 py-0.5">{actionLabel(item.type)}</span>
                    {item.priority ? <span className="rounded-full bg-muted px-2 py-0.5">{actionLabel(item.priority)}</span> : null}
                    {item.role ? <span className="rounded-full bg-muted px-2 py-0.5">{actionLabel(item.role)}</span> : null}
                  </span>
                </span>
              </button>
              {expanded ? (
                <div className="border-t border-border px-3 py-3">
                  {thumbnailUrl && isImage ? (
                    <a href={fileUrl || thumbnailUrl} target="_blank" rel="noopener noreferrer" className="mb-3 block overflow-hidden rounded-xl border border-border bg-muted">
                      <img src={thumbnailUrl} alt={String(payload.filename || item.title || 'Document preview')} className="h-32 w-full object-cover" />
                    </a>
                  ) : null}
                  {item.summary ? <p className="break-words text-xs leading-5 text-muted-foreground">{item.summary}</p> : null}
                  {approvalDetails ? (
                    <div className="mt-3 rounded-xl border border-border bg-background/60 p-2 text-xs">
                      {approvalDetails.destructive ? <div className="mb-2 rounded-lg bg-rose-500/10 px-2 py-1 font-medium text-rose-600">This is destructive. Review before approving.</div> : null}
                      {approvalDetails.targetLabel ? <div className="mb-1"><span className="text-muted-foreground">Target:</span> <span className="font-medium">{String(approvalDetails.targetLabel)}</span></div> : null}
                      {detailRows.map((row, idx) => (
                        <div key={idx} className="flex gap-2 border-t border-border/60 py-1 first:border-t-0">
                          <span className="w-20 shrink-0 text-muted-foreground">{row.label || 'Detail'}</span>
                          <span className="min-w-0 flex-1 break-words font-medium">{row.value == null ? '—' : String(row.value)}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {fileUrl ? (
                      <Button size="sm" variant="outline" asChild>
                        <a href={fileUrl} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> {isImage ? 'View image' : 'View file'}
                        </a>
                      </Button>
                    ) : null}
                    {item.actionRequestId ? (
                      <>
                        <Button size="sm" disabled={!!busyDecisionId} onClick={() => decide(item, 'approved')}>
                          {busyDecisionId === `${item.id}:approved` ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}
                          Approve
                        </Button>
                        <Button size="sm" variant="outline" disabled={!!busyDecisionId} onClick={() => decide(item, 'rejected')}>
                          {busyDecisionId === `${item.id}:rejected` ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <XCircle className="mr-1.5 h-3.5 w-3.5" />}
                          Reject
                        </Button>
                      </>
                    ) : null}
                    <Button size="sm" variant="ghost" onClick={() => openItem(item)}>Ask Jobrolo</Button>
                    <Button size="sm" variant="ghost" onClick={() => hideItem(item)}>{item.synthetic ? 'Hide' : 'Archive'}</Button>
                    <Button size="sm" variant="ghost" className="text-rose-600 hover:text-rose-700 dark:text-rose-300 dark:hover:text-rose-200" onClick={() => deleteItem(item)}>
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete
                    </Button>
                    {!item.synthetic && !item.id.startsWith('synthetic:') ? <Button size="sm" variant="ghost" onClick={() => mark(item.id, 'read')}>Mark read</Button> : null}
                  </div>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border p-2">
        <button onClick={() => onRefresh()} className="rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
          Refresh
        </button>
        {visible.length ? (
          <button onClick={() => hideVisible()} className="rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
            Hide shown
          </button>
        ) : null}
        <button onClick={() => window.location.assign('/settings/notifications')} className="rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
          Notification settings
        </button>
      </div>
    </div>
  )
}

function StartCreateMenu({
  onPrivateChat,
  onPrompt,
  onUpload,
  onOpenMap,
}: {
  onPrivateChat: () => void
  onPrompt: (prompt: string) => void
  onUpload: () => void
  onOpenMap: () => void
}) {
  return (
    <div className="absolute right-0 top-11 z-30 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-border bg-popover p-2 text-popover-foreground shadow-2xl">
      <div className="px-2 pb-2 pt-1">
        <div className="text-sm font-semibold">Start or create</div>
        <div className="text-xs text-muted-foreground">Choose what kind of chat/workflow this is before Jobrolo starts doing work.</div>
      </div>
      <div className="grid gap-1">
        <StartMenuItem
          icon={<MessageCircle className="h-4 w-4 text-blue-600 dark:text-blue-300" />}
          title="Command Center chat"
          detail="Private chat with Jobrolo/operator."
          onClick={onPrivateChat}
        />
        <StartMenuItem
          icon={<Briefcase className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />}
          title="Project / Job chat"
          detail="Attach a chat to a real job file."
          onClick={() => onPrompt('Create a project/job chat for ')}
        />
        <StartMenuItem
          icon={<Home className="h-4 w-4 text-pink-600 dark:text-pink-300" />}
          title="Customer chat"
          detail="Homeowner/client-facing shared chat."
          onClick={() => onPrompt('Create a customer-facing chat for ')}
        />
        <StartMenuItem
          icon={<Hammer className="h-4 w-4 text-violet-600 dark:text-violet-300" />}
          title="Crew / Sub chat"
          detail="Roofer, subcontractor, or field crew coordination."
          onClick={() => onPrompt('Create a crew/subcontractor chat for ')}
        />
        <StartMenuItem
          icon={<Users className="h-4 w-4 text-amber-600 dark:text-amber-300" />}
          title="Team chat"
          detail="Internal employee, sales, PM, or office coordination."
          onClick={() => onPrompt('Create an internal team chat. If this should be attached to a customer or project, ask me which one.')}
        />
        <StartMenuItem
          icon={<MapPin className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />}
          title="Open map"
          detail="Map overlay only. Does not create a lead or canvassing run."
          onClick={onOpenMap}
        />
        <StartMenuItem
          icon={<MapPin className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />}
          title="Field check-in"
          detail="Use current location for inspections, door notes, photos, and jobsite work."
          onClick={() => onPrompt('Help me in the field where I am right now. If I am at a job, brief me and help me log the visit. If I just landed an inspection, use my location, research the property if configured, confirm the owner/address with me, then start the inspection photo workflow.')}
        />
        <StartMenuItem
          icon={<Upload className="h-4 w-4 text-slate-600 dark:text-slate-300" />}
          title="Upload / Add file"
          detail="Pick a file and keep it in this message."
          onClick={onUpload}
        />
      </div>
    </div>
  )
}

function StartMenuItem({ icon, title, detail, onClick }: { icon: ReactNode; title: string; detail: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-muted">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-muted">{icon}</div>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{detail}</span>
      </span>
    </button>
  )
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
              Use this when someone already has access. It opens this shared chat after they log in.
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
