'use client'
import { useEffect, useState, useMemo, type ReactNode } from 'react'
import { useChatStore } from '@/store/chat-store'
import { useWorkspaceStore } from '@/store/workspace-store'
import { cn, getInitials, timeAgo, truncate } from '@/lib/utils'
import { Plus, Search, X, ChevronDown, ChevronRight, LayoutGrid, FileText, MapPin, Building2, Globe2, Users, AlertCircle, Briefcase, UserPlus, Pencil, Trash2, RotateCcw, Check, MessageCircle, PanelLeftClose } from 'lucide-react'
import type { ConversationInfo, WorkspaceInfo } from '@/lib/types'
import {
  COMMAND_SHORTCUTS_KEY,
  COMMAND_SHORTCUTS_UPDATED_EVENT,
  DEFAULT_COMMAND_SHORTCUTS,
  LEGACY_CUSTOM_SHORTCUTS_KEY,
  makeCommandShortcut,
  parseStoredCommandShortcuts,
  type CommandShortcut,
} from '@/lib/command-shortcuts'

interface Props { onNewChat: () => void; onNavigate?: () => void; onCollapse?: () => void }

export function WorkspaceSidebar({ onNewChat, onNavigate, onCollapse }: Props) {
  const conversations = useChatStore(s => s.conversations)
  const conversationId = useChatStore(s => s.conversationId)
  const selectConversation = useChatStore(s => s.selectConversation)
  const deleteConversationLocally = useChatStore(s => s.deleteConversationLocally)
  const workspaces = useWorkspaceStore(s => s.workspaces)
  const currentWorkspaceId = useWorkspaceStore(s => s.currentWorkspaceId)
  const currentChatId = useWorkspaceStore(s => s.currentChatId)
  const enterWorkspace = useWorkspaceStore(s => s.enterWorkspace)
  const exitWorkspace = useWorkspaceStore(s => s.exitWorkspace)
  const deleteWorkspaceChatLocally = useWorkspaceStore(s => s.deleteWorkspaceChatLocally)
  const [search, setSearch] = useState('')
  const [chatsCollapsed, setChatsCollapsed] = useState(true)
  const [clientChatsCollapsed, setClientChatsCollapsed] = useState(true)
  const [otherChatsCollapsed, setOtherChatsCollapsed] = useState(true)
  const [clientCollapsedByKey, setClientCollapsedByKey] = useState<Record<string, boolean>>({})
  const [workspaceCollapsedById, setWorkspaceCollapsedById] = useState<Record<string, boolean>>({})
  const [shortcutsCollapsed, setShortcutsCollapsed] = useState(true)
  const [shortcuts, setShortcuts] = useState<CommandShortcut[]>(DEFAULT_COMMAND_SHORTCUTS)
  const [editingShortcuts, setEditingShortcuts] = useState(false)
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null)
  const [deletingChatId, setDeletingChatId] = useState<string | null>(null)

  const filteredConvos = useMemo(() => {
    if (!search) return conversations
    const q = search.toLowerCase()
    return conversations.filter(c =>
      c.title.toLowerCase().includes(q) || c.preview.toLowerCase().includes(q)
    )
  }, [conversations, search])

  const visibleWorkspaces = useMemo(() => workspaces.filter(w => !isHiddenSidebarWorkspace(w)), [workspaces])

  const filteredWorkspaces = useMemo(() => {
    if (!search) return visibleWorkspaces
    const q = search.toLowerCase()
    return visibleWorkspaces.filter(w => [
      w.name,
      w.description,
      w.customer?.name,
      w.customer?.phone,
      w.customer?.email,
      w.customer?.address,
      w.project?.title,
      w.project?.address,
      w.project?.customer?.name,
      w.project?.customer?.phone,
      w.project?.customer?.email,
      w.subcontractor?.name,
      w.subcontractor?.company,
      w.subcontractor?.specialty,
      ...w.chats.flatMap(chat => [chat.title, chat.chatType, chat.lastMessage]),
    ].some(value => String(value ?? '').toLowerCase().includes(q)))
  }, [visibleWorkspaces, search])

  const groupedConvos = useMemo(() => {
    const groups: Record<string, ConversationInfo[]> = { Today: [], Yesterday: [], 'Previous 7 Days': [], Older: [] }
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const yesterday = new Date(today.getTime() - 86400000)
    const weekAgo = new Date(today.getTime() - 7 * 86400000)
    for (const item of filteredConvos) {
      const d = new Date(item.updatedAt)
      if (d >= today) groups.Today.push(item)
      else if (d >= yesterday) groups.Yesterday.push(item)
      else if (d >= weekAgo) groups['Previous 7 Days'].push(item)
      else groups.Older.push(item)
    }
    return groups
  }, [filteredConvos])

  const sidebarGroupedConvos = useMemo(() => {
    if (search) return groupedConvos
    let remaining = 8
    const next: Record<string, ConversationInfo[]> = { Today: [], Yesterday: [], 'Previous 7 Days': [], Older: [] }
    for (const label of Object.keys(next)) {
      const items = groupedConvos[label] || []
      next[label] = items.slice(0, remaining)
      remaining -= next[label].length
      if (remaining <= 0) break
    }
    return next
  }, [groupedConvos, search])

  const clientChatGroups = useMemo(() => {
    const groups = new Map<string, { key: string; label: string; subtitle: string; workspaces: WorkspaceInfo[] }>()
    for (const workspace of filteredWorkspaces) {
      if (!isClientLinkedWorkspace(workspace)) continue
      const key = workspaceClientKey(workspace)
      const existing = groups.get(key)
      if (existing) {
        existing.workspaces.push(workspace)
      } else {
        groups.set(key, {
          key,
          label: workspaceClientLabel(workspace),
          subtitle: workspaceClientSubtitle(workspace),
          workspaces: [workspace],
        })
      }
    }

    return Array.from(groups.values())
      .map(group => ({
        ...group,
        workspaces: group.workspaces.slice().sort((a, b) => workspaceSortDate(b) - workspaceSortDate(a)),
      }))
      .sort((a, b) => {
        const aActive = a.workspaces.some(w => w.id === currentWorkspaceId)
        const bActive = b.workspaces.some(w => w.id === currentWorkspaceId)
        if (aActive !== bActive) return aActive ? -1 : 1
        return workspaceSortDate(b.workspaces[0]) - workspaceSortDate(a.workspaces[0])
      })
  }, [filteredWorkspaces, currentWorkspaceId])

  const partnerWorkspaces = useMemo(() =>
    filteredWorkspaces.filter(w => !isClientLinkedWorkspace(w)).sort((a, b) => workspaceSortDate(b) - workspaceSortDate(a)),
    [filteredWorkspaces]
  )

  useEffect(() => {
    const load = () => {
      const local = parseStoredCommandShortcuts(
          window.localStorage.getItem(COMMAND_SHORTCUTS_KEY),
          window.localStorage.getItem(LEGACY_CUSTOM_SHORTCUTS_KEY),
        )
      setShortcuts(local)
      fetch('/api/command-shortcuts')
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (!data?.shortcuts?.length) return
          const remote = parseStoredCommandShortcuts(JSON.stringify(data.shortcuts))
          setShortcuts(remote)
          window.localStorage.setItem(COMMAND_SHORTCUTS_KEY, JSON.stringify(remote))
          if (data.source === 'defaults' && local.some(shortcut => !DEFAULT_COMMAND_SHORTCUTS.some(base => base.id === shortcut.id))) {
            fetch('/api/command-shortcuts', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ shortcuts: local, scope: 'user' }),
            }).catch(() => null)
          }
        })
        .catch(() => null)
    }
    load()
    window.addEventListener(COMMAND_SHORTCUTS_UPDATED_EVENT, load)
    window.addEventListener('storage', load)
    return () => {
      window.removeEventListener(COMMAND_SHORTCUTS_UPDATED_EVENT, load)
      window.removeEventListener('storage', load)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/me')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (!cancelled) setCurrentUserRole(data?.user?.role ?? null)
      })
      .catch(() => {
        if (!cancelled) setCurrentUserRole(null)
      })
    return () => { cancelled = true }
  }, [])

  const toggleClient = (key: string) => setClientCollapsedByKey(prev => ({ ...prev, [key]: !prev[key] }))
  const toggleWorkspace = (workspaceId: string) => setWorkspaceCollapsedById(prev => ({ ...prev, [workspaceId]: !prev[workspaceId] }))

  const insertCommandPrompt = (text: string) => {
    exitWorkspace()
    if (conversationId) selectConversation(conversationId)
    window.dispatchEvent(new CustomEvent('jobrolo:insert-prompt', { detail: { text } }))
    onNavigate?.()
  }

  const persistShortcuts = (next: CommandShortcut[]) => {
    const safe = next.slice(0, 24)
    setShortcuts(safe)
    window.localStorage.setItem(COMMAND_SHORTCUTS_KEY, JSON.stringify(safe))
    window.dispatchEvent(new Event(COMMAND_SHORTCUTS_UPDATED_EVENT))
    fetch('/api/command-shortcuts', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shortcuts: safe, scope: 'user' }),
    }).catch(() => null)
  }

  const addShortcut = () => {
    const label = window.prompt('Shortcut label, like “Create crew chat”')?.trim()
    if (!label) return
    const prompt = window.prompt('Prompt to insert into chat')?.trim()
    if (!prompt) return
    persistShortcuts([makeCommandShortcut(label, prompt), ...shortcuts])
  }

  const editShortcut = (shortcut: CommandShortcut) => {
    const label = window.prompt('Shortcut label', shortcut.label)?.trim()
    if (!label) return
    const prompt = window.prompt('Prompt text Jobrolo should insert into chat', shortcut.prompt)?.trim()
    if (!prompt) return
    persistShortcuts(shortcuts.map(item => item.id === shortcut.id ? { ...item, label, prompt } : item))
  }

  const deleteShortcut = (shortcut: CommandShortcut) => {
    if (!window.confirm(`Delete shortcut "${shortcut.label}"?`)) return
    persistShortcuts(shortcuts.filter(item => item.id !== shortcut.id))
  }

  const canDeleteChats = hasCompanyWideUiRole(currentUserRole)

  const deletePrivateChat = async (conversation: ConversationInfo) => {
    if (deletingChatId) return
    const title = conversation.title || 'New private chat'
    if (!window.confirm(`Delete private chat "${title}"? This removes the chat thread and its messages.`)) return
    setDeletingChatId(conversation.id)
    try {
      const res = await fetch(`/api/conversations/${conversation.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not delete this private chat.')
      deleteConversationLocally(conversation.id)
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not delete this private chat.')
    } finally {
      setDeletingChatId(null)
    }
  }

  const deleteSharedChat = async (workspace: WorkspaceInfo, chat: WorkspaceInfo['chats'][number]) => {
    if (deletingChatId) return
    const label = chatTitle(chat.title, chat.chatType)
    if (!window.confirm(`Delete "${label}" from ${workspaceClientLabel(workspace)}? This removes the chat thread and its messages.`)) return
    setDeletingChatId(chat.id)
    try {
      const res = await fetch(`/api/workspaces/${workspace.id}/chats/${chat.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not delete this shared chat.')
      deleteWorkspaceChatLocally(workspace.id, chat.id, data.fallbackChatId ?? null)
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not delete this shared chat.')
    } finally {
      setDeletingChatId(null)
    }
  }

  const resetShortcuts = () => {
    if (!window.confirm('Reset command shortcuts back to the Jobrolo defaults?')) return
    persistShortcuts(DEFAULT_COMMAND_SHORTCUTS)
  }

  const visiblePrivateChatCount = Object.values(groupedConvos).flat().length
  const shownPrivateChatCount = Object.values(sidebarGroupedConvos).flat().length
  const hiddenPrivateChatCount = Math.max(0, visiblePrivateChatCount - shownPrivateChatCount)

  return (
    <aside className="flex h-full min-h-0 w-full flex-col overflow-hidden border-r border-border bg-sidebar pt-[calc(0.65rem_+_env(safe-area-inset-top))] md:w-64">
      <div className="flex-shrink-0 border-b border-border p-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/logo-512.png" alt="Jobrolo" className="w-8 h-8 rounded-lg object-cover" />
            <div>
              <div className="font-semibold text-sidebar-foreground text-sm tracking-tight">Jobrolo</div>
              <div className="text-[10px] leading-tight text-muted-foreground">Command Center</div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {onCollapse && (
              <button onClick={onCollapse} className="hidden lg:grid h-8 w-8 place-items-center rounded-lg border border-border bg-sidebar-accent/30 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground" aria-label="Hide full menu" title="Hide full menu">
                <PanelLeftClose className="w-3.5 h-3.5" />
              </button>
            )}
            {onNavigate && (
              <button onClick={onNavigate} className="md:hidden p-1.5 rounded-md hover:bg-sidebar-accent text-muted-foreground transition-colors" aria-label="Close menu">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60" />
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search chats…" suppressHydrationWarning
            className="w-full pl-8 pr-7 py-2 text-[16px] bg-card border border-border rounded-lg placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400 dark:bg-background/50 transition-all"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground hover:text-foreground transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <button
          onClick={() => { exitWorkspace(); if (conversationId) selectConversation(conversationId); onNavigate?.() }}
          className={cn(
            'w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-xl text-sm font-medium min-h-[44px] transition-all duration-200',
            !currentWorkspaceId
              ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/20 dark:shadow-blue-500/30'
              : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground border border-transparent hover:border-border'
          )}
        >
          <div className={cn(
            'flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center',
            !currentWorkspaceId ? 'bg-white/20' : 'bg-blue-100 dark:bg-blue-950/50'
          )}>
            <LayoutGrid className={cn('w-4 h-4', !currentWorkspaceId ? 'text-white' : 'text-blue-600 dark:text-blue-400')} />
          </div>
          Command Center
        </button>

        <button
          onClick={onNewChat}
          className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl bg-card border border-border hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/30 text-sidebar-foreground text-sm font-medium transition-all duration-200 hover:scale-[1.01] active:scale-[0.99]"
        >
          <Plus className="w-4 h-4 text-blue-500" /> New private chat
        </button>

        <div className="space-y-1">
          <SectionToggle
            icon={<FileText className="h-4 w-4" />}
            label="Command shortcuts"
            count={shortcuts.length}
            color="violet"
            hint="Quick prompts"
            collapsed={shortcutsCollapsed}
            onClick={() => setShortcutsCollapsed(v => !v)}
          />
          {!shortcutsCollapsed ? (
            <>
              <div className="mb-1 flex items-center justify-between px-1">
                <div className="text-[10px] text-muted-foreground">Tap to insert. Edit when you want your own prompts.</div>
                <button
                  onClick={() => setEditingShortcuts(v => !v)}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
                >
                  {editingShortcuts ? <Check className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
                  {editingShortcuts ? 'Done' : 'Edit'}
                </button>
              </div>
              {shortcuts.slice(0, editingShortcuts ? 24 : 8).map(shortcut => (
                editingShortcuts ? (
                  <div key={shortcut.id} className="rounded-xl border border-border bg-sidebar-accent/20 p-2">
                    <div className="flex items-start gap-2">
                      <div className="mt-0.5 shrink-0">{shortcutIcon(shortcut)}</div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-sidebar-foreground">{shortcut.label}</div>
                        <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">{shortcut.prompt}</div>
                      </div>
                    </div>
                    <div className="mt-2 flex gap-1.5">
                      <button onClick={() => editShortcut(shortcut)} className="flex-1 rounded-lg border border-border px-2 py-1.5 text-[11px] font-medium text-sidebar-foreground hover:bg-sidebar-accent">
                        Edit title + prompt
                      </button>
                      <button onClick={() => deleteShortcut(shortcut)} className="rounded-lg border border-border px-2 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30" aria-label={`Delete shortcut ${shortcut.label}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div key={shortcut.id} className="group flex items-center gap-1">
                    <button
                      onClick={() => insertCommandPrompt(shortcut.prompt)}
                      className="flex min-h-[40px] min-w-0 flex-1 items-center gap-2.5 rounded-xl px-2 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
                    >
                      {shortcutIcon(shortcut)}
                      <span className="truncate">{shortcut.label}</span>
                    </button>
                  </div>
                )
              ))}
              {editingShortcuts ? (
                <div className="mt-1 grid grid-cols-2 gap-1 border-t border-border pt-2">
                  <button onClick={addShortcut} className="rounded-xl border border-border px-2 py-2 text-xs font-medium hover:bg-sidebar-accent">Add shortcut</button>
                  <button onClick={resetShortcuts} className="inline-flex items-center justify-center gap-1 rounded-xl border border-border px-2 py-2 text-xs font-medium hover:bg-sidebar-accent">
                    <RotateCcw className="h-3 w-3" /> Reset
                  </button>
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        {visiblePrivateChatCount > 0 && (
          <div>
            <SectionToggle
              icon={<MessageCircle className="h-4 w-4" />}
              label="Private chats"
              count={visiblePrivateChatCount}
              color="blue"
              hint="Ideas, training, notes"
              collapsed={chatsCollapsed}
              onClick={() => setChatsCollapsed(v => !v)}
            />
            {!chatsCollapsed && (Object.entries(sidebarGroupedConvos) as Array<[string, ConversationInfo[]]>).map(([label, items]) => (
              items.length > 0 ? (
                <div key={label} className="mb-1.5">
                  <div className="px-1 mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">{label}</div>
                  {items.map(c => (
                    <div
                      key={c.id}
                      className={cn(
                        'group flex items-center gap-1 rounded-lg transition-all duration-150',
                        c.id === conversationId && !currentWorkspaceId
                          ? 'bg-blue-100 text-blue-900 dark:bg-blue-950/50 dark:text-blue-100'
                          : 'hover:bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-foreground'
                      )}
                    >
                      <button
                        onClick={() => { exitWorkspace(); selectConversation(c.id); onNavigate?.() }}
                        className="min-h-[40px] min-w-0 flex-1 px-2.5 py-2 text-left text-sm"
                      >
                        <div className="font-medium truncate text-[13px]">{c.title || 'New private chat'}</div>
                        <div className="flex items-center justify-between mt-0.5">
                          {c.preview ? <div className="text-[11px] text-muted-foreground truncate flex-1 mr-2">{c.preview}</div> : <div className="flex-1" />}
                          <span className="text-[10px] text-muted-foreground/60 flex-shrink-0">{timeAgo(c.updatedAt)}</span>
                        </div>
                      </button>
                      {canDeleteChats ? (
                        <button
                          onClick={(event) => { event.stopPropagation(); deletePrivateChat(c) }}
                          disabled={deletingChatId === c.id}
                          className="mr-1 rounded-lg p-2 text-muted-foreground hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 dark:hover:bg-rose-950/30"
                          aria-label={`Delete private chat ${c.title || 'New private chat'}`}
                          title="Delete chat"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null
            ))}
            {!chatsCollapsed && hiddenPrivateChatCount > 0 ? (
              <div className="px-2 py-1 text-[11px] text-muted-foreground">
                Showing recent private chats. Use search for {hiddenPrivateChatCount} older one{hiddenPrivateChatCount === 1 ? '' : 's'}.
              </div>
            ) : null}
          </div>
        )}

        <div>
          <SectionToggle
            icon={<Briefcase className="h-4 w-4" />}
            label="Job files"
            count={clientChatGroups.length}
            color="cyan"
            hint="Clients, jobs, crews"
            collapsed={clientChatsCollapsed}
            onClick={() => setClientChatsCollapsed(v => !v)}
          />
          {!clientChatsCollapsed && clientChatGroups.map(group => {
            const isActiveClient = group.workspaces.some(w => w.id === currentWorkspaceId)
            const clientCollapsed = clientCollapsedByKey[group.key] ?? !isActiveClient
            return (
              <div key={group.key} className={cn('mb-1 rounded-2xl border p-1.5', isActiveClient ? 'border-blue-400/60 bg-blue-50/70 dark:border-blue-500/40 dark:bg-blue-950/20' : 'border-border bg-card/40')}>
                <button
                  onClick={() => toggleClient(group.key)}
                  className="flex min-h-[42px] w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left hover:bg-sidebar-accent"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">
                    {getInitials(group.label)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-sidebar-foreground">{group.label}</div>
                    <div className="truncate text-[11px] text-muted-foreground">{group.subtitle}</div>
                  </div>
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{groupChatCount(group.workspaces)}</span>
                  {clientCollapsed ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                </button>

                {!clientCollapsed ? (
                  <div className="mt-1 space-y-1">
                    {group.workspaces.map(workspace => {
                      const workspaceCollapsed = workspaceCollapsedById[workspace.id] ?? workspace.id !== currentWorkspaceId
                      return (
                        <div key={workspace.id} className="rounded-xl bg-background/50">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => { enterWorkspace(workspace.id); onNavigate?.() }}
                              className={cn(
                                'flex min-h-[40px] min-w-0 flex-1 items-center gap-2 rounded-xl px-2 py-1.5 text-left text-sm transition-colors',
                                workspace.id === currentWorkspaceId
                                  ? 'bg-blue-100 text-blue-900 dark:bg-blue-950/50 dark:text-blue-100'
                                  : 'hover:bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-foreground'
                              )}
                            >
                              <Briefcase className="h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-[13px] font-medium">{workspaceListTitle(workspace)}</div>
                                <div className="truncate text-[10px] text-muted-foreground">{workspaceDescriptor(workspace)}</div>
                              </div>
                            </button>
                            {workspace.chats.length > 1 ? (
                              <button
                                onClick={() => toggleWorkspace(workspace.id)}
                                className="rounded-lg p-2 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
                                aria-label={`Toggle chats for ${workspace.name}`}
                              >
                                {workspaceCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                              </button>
                            ) : null}
                          </div>

                          {!workspaceCollapsed ? (
                            <div className="space-y-0.5 pb-1 pl-5 pr-1">
                              {workspace.chats.map(chat => {
                                const canDeleteThisSharedChat = canDeleteChats && workspace.chats.length > 1 && String(chat.chatType).toLowerCase() !== 'main'
                                return (
                                  <div
                                    key={chat.id}
                                    className={cn(
                                      'group flex items-center gap-1 rounded-lg transition-colors',
                                      workspace.id === currentWorkspaceId && chat.id === currentChatId
                                        ? 'bg-blue-100 text-blue-900 dark:bg-blue-950/50 dark:text-blue-100'
                                        : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground'
                                    )}
                                  >
                                    <button
                                      onClick={() => { enterWorkspace(workspace.id, chat.id); onNavigate?.() }}
                                      className="flex min-h-[36px] min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs"
                                    >
                                      <MessageCircle className="h-3.5 w-3.5 shrink-0" />
                                      <div className="min-w-0 flex-1">
                                        <div className="truncate font-medium">{chatTitle(chat.title, chat.chatType)}</div>
                                        <div className="truncate text-[10px] opacity-75">{chatMeta(chat)}</div>
                                      </div>
                                    </button>
                                    {canDeleteThisSharedChat ? (
                                      <button
                                        onClick={(event) => { event.stopPropagation(); deleteSharedChat(workspace, chat) }}
                                        disabled={deletingChatId === chat.id}
                                        className="mr-1 rounded-lg p-1.5 text-muted-foreground hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 dark:hover:bg-rose-950/30"
                                        aria-label={`Delete ${chatTitle(chat.title, chat.chatType)}`}
                                        title="Delete chat"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    ) : null}
                                  </div>
                                )
                              })}
                            </div>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>

        {partnerWorkspaces.length > 0 ? (
          <div>
            <SectionToggle
              icon={<Users className="h-4 w-4" />}
              label="Partner chats"
              count={partnerWorkspaces.length}
              color="emerald"
              hint="Realtors, agents, subs"
              collapsed={otherChatsCollapsed}
              onClick={() => setOtherChatsCollapsed(v => !v)}
            />
            {!otherChatsCollapsed && partnerWorkspaces.map(w => (
              <button
                key={w.id}
                onClick={() => { enterWorkspace(w.id); onNavigate?.() }}
                className={cn(
                  'w-full text-left px-2.5 py-2 rounded-lg text-sm flex items-start gap-2 min-h-[40px] transition-all duration-150',
                  w.id === currentWorkspaceId
                    ? 'bg-blue-100 text-blue-900 dark:bg-blue-950/50 dark:text-blue-100'
                    : 'hover:bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-foreground'
                )}
              >
                <div className={cn('flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-semibold mt-0.5', w.color ?? 'bg-blue-600')}>
                  {getInitials(w.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate text-[13px]">{cleanSidebarText(w.name)}</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-muted-foreground/60">{sharedChatLabel(w)}</span>
                    {(w.recentMemory?.length ?? 0) > 0 && (
                      <>
                        <span className="text-[10px] text-muted-foreground/40">·</span>
                        <span className="text-[10px] text-muted-foreground/60 truncate">{truncate(w.recentMemory![0].content, 30)}</span>
                      </>
                    )}
                    {(w.recentMemory?.length ?? 0) === 0 && w.chats?.length ? (
                      <>
                        <span className="text-[10px] text-muted-foreground/40">·</span>
                        <span className="text-[10px] text-muted-foreground/60 truncate">{w.chats.map(chat => chatLabel(chat.chatType)).slice(0, 3).join(', ')}</span>
                      </>
                    ) : null}
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : null}

        {!filteredConvos.length && !filteredWorkspaces.length && (
          <div className="text-center py-8 text-sm text-muted-foreground/60">{search ? 'No matches' : 'No chats yet'}</div>
        )}
      </div>
    </aside>
  )
}

function isClientLinkedWorkspace(workspace: WorkspaceInfo) {
  return Boolean(workspace.customerId || workspace.customer || workspace.projectId || workspace.project?.customer)
}

function cleanSidebarText(value?: string | null) {
  return String(value || '')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .trim()
}

function isHiddenSidebarWorkspace(workspace: WorkspaceInfo) {
  const text = [
    workspace.type,
    workspace.name,
    workspace.description,
    workspace.project?.title,
  ].map(cleanSidebarText).join(' ').toLowerCase()
  if (String(workspace.type) === 'onboarding') return true
  if (!isClientLinkedWorkspace(workspace) && /\b(onboarding|setting up your workspace|welcome to jobrolo)\b/.test(text)) return true
  if (!isClientLinkedWorkspace(workspace) && /\blet'?s keep building\b/.test(text)) return true
  return false
}

function SectionToggle({
  icon,
  label,
  count,
  color,
  hint,
  collapsed,
  onClick,
}: {
  icon: ReactNode
  label: string
  count: number
  color: 'blue' | 'cyan' | 'emerald' | 'violet'
  hint?: string
  collapsed: boolean
  onClick: () => void
}) {
  const palette: Record<'blue' | 'cyan' | 'emerald' | 'violet', { wrap: string; icon: string; text: string }> = {
    blue: {
      wrap: 'border-blue-500/20 bg-gradient-to-r from-blue-500/15 to-blue-500/5 hover:from-blue-500/20',
      icon: 'bg-blue-500/20 text-blue-600 dark:text-blue-300',
      text: 'text-blue-700 dark:text-blue-200',
    },
    cyan: {
      wrap: 'border-cyan-500/20 bg-gradient-to-r from-cyan-500/15 to-cyan-500/5 hover:from-cyan-500/20',
      icon: 'bg-cyan-500/20 text-cyan-600 dark:text-cyan-300',
      text: 'text-cyan-700 dark:text-cyan-200',
    },
    emerald: {
      wrap: 'border-emerald-500/20 bg-gradient-to-r from-emerald-500/15 to-emerald-500/5 hover:from-emerald-500/20',
      icon: 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300',
      text: 'text-emerald-700 dark:text-emerald-200',
    },
    violet: {
      wrap: 'border-violet-500/20 bg-gradient-to-r from-violet-500/15 to-violet-500/5 hover:from-violet-500/20',
      icon: 'bg-violet-500/20 text-violet-600 dark:text-violet-300',
      text: 'text-violet-700 dark:text-violet-200',
    },
  }
  const selected = palette[color]
  return (
    <button
      onClick={onClick}
      className={cn('mb-1 flex min-h-[46px] w-full items-center gap-2 rounded-2xl border px-2.5 py-2 text-left shadow-sm transition-colors', selected.wrap)}
    >
      <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-xl', selected.icon)}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-sm font-semibold', selected.text)}>{label}</span>
        <span className="block truncate text-[10px] uppercase tracking-wide text-muted-foreground">{collapsed ? (hint || 'Tap to expand') : 'Tap to collapse'}</span>
      </span>
      <span className="rounded-full bg-background/70 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">{count}</span>
      {collapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
    </button>
  )
}

function workspaceClientKey(workspace: WorkspaceInfo) {
  return workspace.customer?.id
    ?? workspace.project?.customer?.id
    ?? workspace.customerId
    ?? workspace.project?.customer?.name
    ?? workspace.customer?.name
    ?? workspace.projectId
    ?? workspace.id
}

function workspaceClientLabel(workspace: WorkspaceInfo) {
  return cleanSidebarText(workspace.customer?.name
    ?? workspace.project?.customer?.name
    ?? workspace.name
    ?? 'Unassigned client')
}

function workspaceClientSubtitle(workspace: WorkspaceInfo) {
  const address = cleanSidebarText(workspace.customer?.address ?? workspace.project?.address)
  if (address) return address
  if (workspace.project?.title) return cleanSidebarText(workspace.project.title)
  return 'Client file'
}

function workspaceSortDate(workspace: WorkspaceInfo) {
  return new Date(workspace.lastActivity ?? workspace.chats?.[0]?.lastActivity ?? 0).getTime()
}

function groupChatCount(workspaces: WorkspaceInfo[]) {
  return workspaces.reduce((sum, workspace) => sum + Math.max(workspace.chats.length, 1), 0)
}

function workspaceListTitle(workspace: WorkspaceInfo) {
  if (workspace.project?.title) return cleanSidebarText(workspace.project.title)
  if (workspace.type === 'customer') return 'Customer file'
  if (workspace.type === 'subcontractor') return cleanSidebarText(workspace.subcontractor?.company ?? workspace.subcontractor?.name ?? workspace.name)
  return cleanSidebarText(workspace.name)
}

function workspaceDescriptor(workspace: WorkspaceInfo) {
  const pieces = [sharedChatLabel(workspace)]
  if (workspace.project?.status) pieces.push(workspace.project.status)
  if (workspace.project?.address) pieces.push(cleanSidebarText(workspace.project.address))
  return pieces.filter(Boolean).join(' · ')
}

function chatTitle(title: string, chatType: string) {
  if (title && !/^main$/i.test(title.trim())) return title
  return chatLabel(chatType)
}

function chatMeta(chat: { chatType: string; visibility?: string; messageCount?: number; lastActivity?: string; lastMessage?: string }) {
  const pieces = [chatLabel(chat.chatType)]
  if (chat.visibility) pieces.push(chat.visibility)
  if (typeof chat.messageCount === 'number') pieces.push(`${chat.messageCount} msg${chat.messageCount === 1 ? '' : 's'}`)
  if (chat.lastActivity) pieces.push(timeAgo(chat.lastActivity))
  return pieces.join(' · ')
}

function sharedChatLabel(workspace: WorkspaceInfo) {
  if (workspace.type === 'project') return 'Job chat'
  if (workspace.type === 'customer') return 'Customer chat'
  if (workspace.type === 'subcontractor') return 'Crew/Sub chat'
  if (workspace.type === 'supplier') return 'Supplier chat'
  return 'Shared chat'
}

function chatLabel(chatType: string) {
  const labels: Record<string, string> = {
    main: 'Internal',
    customer: 'Customer',
    crew: 'Crew',
    roofing_crew: 'Roofing crew',
    gutter_crew: 'Gutter crew',
    window_crew: 'Window crew',
    siding_crew: 'Siding crew',
    field_crew: 'Field crew',
    subcontractor: 'Subcontractor',
    supplier: 'Supplier',
    finance: 'Finance',
    management: 'Management',
    sales: 'Sales',
    insurance: 'Insurance',
    production: 'Production',
  }
  return labels[chatType] ?? chatType
}

function hasCompanyWideUiRole(role?: string | null) {
  return ['owner', 'admin', 'manager', 'project_manager'].includes(String(role ?? '').toLowerCase())
}

function shortcutIcon(shortcut: CommandShortcut) {
  const cls = 'w-4 h-4 shrink-0'
  switch (shortcut.icon) {
    case 'attention': return <AlertCircle className={cn(cls, 'text-amber-600 dark:text-amber-400')} />
    case 'building': return <Building2 className={cn(cls, 'text-blue-600 dark:text-blue-400')} />
    case 'globe': return <Globe2 className={cn(cls, 'text-emerald-600 dark:text-emerald-400')} />
    case 'field': return <MapPin className={cn(cls, 'text-emerald-600 dark:text-emerald-400')} />
    case 'client': return <Users className={cn(cls, 'text-blue-600 dark:text-blue-400')} />
    case 'job': return <Briefcase className={cn(cls, 'text-cyan-600 dark:text-cyan-400')} />
    case 'crew': return <Users className={cn(cls, 'text-violet-600 dark:text-violet-400')} />
    case 'customer': return <Users className={cn(cls, 'text-pink-600 dark:text-pink-400')} />
    case 'invite': return <UserPlus className={cn(cls, 'text-violet-600 dark:text-violet-400')} />
    case 'template': return <FileText className={cn(cls, 'text-violet-600 dark:text-violet-400')} />
    case 'roof': return <FileText className={cn(cls, 'text-cyan-600 dark:text-cyan-400')} />
    default: return <FileText className={cn(cls, 'text-blue-600 dark:text-blue-400')} />
  }
}
