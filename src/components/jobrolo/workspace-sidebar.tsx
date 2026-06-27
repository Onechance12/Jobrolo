'use client'
import { useEffect, useState, useMemo } from 'react'
import { useChatStore } from '@/store/chat-store'
import { useWorkspaceStore } from '@/store/workspace-store'
import { cn, getInitials, timeAgo, truncate } from '@/lib/utils'
import { Plus, Search, X, ChevronDown, ChevronRight, LayoutGrid, FileText, MapPin, Building2, Globe2, Users, AlertCircle, Briefcase, UserPlus, Pencil, Trash2, RotateCcw, Check, MessageCircle } from 'lucide-react'
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

interface Props { onNewChat: () => void; onNavigate?: () => void }

export function WorkspaceSidebar({ onNewChat, onNavigate }: Props) {
  const conversations = useChatStore(s => s.conversations)
  const conversationId = useChatStore(s => s.conversationId)
  const selectConversation = useChatStore(s => s.selectConversation)
  const workspaces = useWorkspaceStore(s => s.workspaces)
  const currentWorkspaceId = useWorkspaceStore(s => s.currentWorkspaceId)
  const currentChatId = useWorkspaceStore(s => s.currentChatId)
  const enterWorkspace = useWorkspaceStore(s => s.enterWorkspace)
  const exitWorkspace = useWorkspaceStore(s => s.exitWorkspace)
  const [search, setSearch] = useState('')
  const [chatsCollapsed, setChatsCollapsed] = useState(false)
  const [clientChatsCollapsed, setClientChatsCollapsed] = useState(false)
  const [otherChatsCollapsed, setOtherChatsCollapsed] = useState(false)
  const [clientCollapsedByKey, setClientCollapsedByKey] = useState<Record<string, boolean>>({})
  const [workspaceCollapsedById, setWorkspaceCollapsedById] = useState<Record<string, boolean>>({})
  const [shortcutsCollapsed, setShortcutsCollapsed] = useState(true)
  const [shortcuts, setShortcuts] = useState<CommandShortcut[]>(DEFAULT_COMMAND_SHORTCUTS)
  const [editingShortcuts, setEditingShortcuts] = useState(false)

  const filteredConvos = useMemo(() => {
    if (!search) return conversations
    const q = search.toLowerCase()
    return conversations.filter(c =>
      c.title.toLowerCase().includes(q) || c.preview.toLowerCase().includes(q)
    )
  }, [conversations, search])

  const filteredWorkspaces = useMemo(() => {
    if (!search) return workspaces
    const q = search.toLowerCase()
    return workspaces.filter(w => [
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
  }, [workspaces, search])

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

  const otherSharedWorkspaces = useMemo(() =>
    filteredWorkspaces.filter(w => !isClientLinkedWorkspace(w)).sort((a, b) => workspaceSortDate(b) - workspaceSortDate(a)),
    [filteredWorkspaces]
  )

  useEffect(() => {
    const load = () => {
      setShortcuts(parseStoredCommandShortcuts(
        window.localStorage.getItem(COMMAND_SHORTCUTS_KEY),
        window.localStorage.getItem(LEGACY_CUSTOM_SHORTCUTS_KEY),
      ))
    }
    load()
    window.addEventListener(COMMAND_SHORTCUTS_UPDATED_EVENT, load)
    window.addEventListener('storage', load)
    return () => {
      window.removeEventListener(COMMAND_SHORTCUTS_UPDATED_EVENT, load)
      window.removeEventListener('storage', load)
    }
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
    const prompt = window.prompt('Prompt to insert into chat', shortcut.prompt)?.trim()
    if (!prompt) return
    persistShortcuts(shortcuts.map(item => item.id === shortcut.id ? { ...item, label, prompt } : item))
  }

  const deleteShortcut = (shortcut: CommandShortcut) => {
    if (!window.confirm(`Delete shortcut "${shortcut.label}"?`)) return
    persistShortcuts(shortcuts.filter(item => item.id !== shortcut.id))
  }

  const resetShortcuts = () => {
    if (!window.confirm('Reset command shortcuts back to the Jobrolo defaults?')) return
    persistShortcuts(DEFAULT_COMMAND_SHORTCUTS)
  }

  const visiblePrivateChatCount = Object.values(groupedConvos).flat().length

  return (
    <aside className="flex h-full min-h-0 w-full flex-col overflow-hidden border-r border-border bg-sidebar md:w-64">
      <div className="flex-shrink-0 border-b border-border p-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="Jobrolo" className="w-8 h-8 rounded-lg object-cover" />
            <div>
              <div className="font-semibold text-sidebar-foreground text-sm tracking-tight">Jobrolo</div>
              <div className="text-[10px] leading-tight text-muted-foreground">Command Center</div>
            </div>
          </div>
          {onNavigate && (
            <button onClick={onNavigate} className="md:hidden p-1.5 rounded-md hover:bg-sidebar-accent text-muted-foreground transition-colors">
              <X className="w-4 h-4" />
            </button>
          )}
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

        <div className="rounded-2xl border border-border bg-card/70 p-2">
          <div className="flex items-center justify-between gap-2 px-1">
            <button
              onClick={() => setShortcutsCollapsed(v => !v)}
              className="flex min-h-[34px] min-w-0 flex-1 items-center gap-1 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 hover:text-sidebar-foreground"
            >
              {shortcutsCollapsed && !editingShortcuts ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              Command shortcuts
              <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] normal-case tracking-normal text-muted-foreground">{shortcuts.length}</span>
            </button>
            <button
              onClick={() => { setShortcutsCollapsed(false); setEditingShortcuts(v => !v) }}
              className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
            >
              {editingShortcuts ? <Check className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
              {editingShortcuts ? 'Done' : 'Edit'}
            </button>
          </div>
          {(!shortcutsCollapsed || editingShortcuts) ? (
            <>
              {shortcuts.slice(0, editingShortcuts ? 24 : 8).map(shortcut => (
                <div key={shortcut.id} className="group flex items-center gap-1">
                  <button
                    onClick={() => insertCommandPrompt(shortcut.prompt)}
                    className="flex min-h-[40px] min-w-0 flex-1 items-center gap-2.5 rounded-xl px-2 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  >
                    {shortcutIcon(shortcut)}
                    <span className="truncate">{shortcut.label}</span>
                  </button>
                  {editingShortcuts ? (
                    <div className="flex shrink-0 items-center gap-0.5">
                      <button onClick={() => editShortcut(shortcut)} className="rounded-lg p-2 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground" aria-label={`Edit shortcut ${shortcut.label}`}>
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => deleteShortcut(shortcut)} className="rounded-lg p-2 text-muted-foreground hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30" aria-label={`Delete shortcut ${shortcut.label}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : null}
                </div>
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
            <button
              onClick={() => setChatsCollapsed(v => !v)}
              className="w-full flex items-center gap-1 px-1 mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground/70 hover:text-muted-foreground transition-colors"
            >
              {chatsCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              My chats ({visiblePrivateChatCount})
            </button>
            {!chatsCollapsed && (Object.entries(groupedConvos) as Array<[string, ConversationInfo[]]>).map(([label, items]) => (
              items.length > 0 ? (
                <div key={label} className="mb-1.5">
                  <div className="px-1 mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">{label}</div>
                  {items.map(c => (
                    <button
                      key={c.id}
                      onClick={() => { exitWorkspace(); selectConversation(c.id); onNavigate?.() }}
                      className={cn(
                        'w-full text-left px-2.5 py-2 rounded-lg text-sm min-h-[40px] transition-all duration-150',
                        c.id === conversationId && !currentWorkspaceId
                          ? 'bg-blue-100 text-blue-900 dark:bg-blue-950/50 dark:text-blue-100'
                          : 'hover:bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-foreground'
                      )}
                    >
                      <div className="font-medium truncate text-[13px]">{c.title || 'New private chat'}</div>
                      <div className="flex items-center justify-between mt-0.5">
                        {c.preview ? <div className="text-[11px] text-muted-foreground truncate flex-1 mr-2">{c.preview}</div> : <div className="flex-1" />}
                        <span className="text-[10px] text-muted-foreground/60 flex-shrink-0">{timeAgo(c.updatedAt)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              ) : null
            ))}
          </div>
        )}

        <div>
          <button
            onClick={() => setClientChatsCollapsed(v => !v)}
            className="w-full flex items-center gap-1 px-1 mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground/70 hover:text-muted-foreground transition-colors"
          >
            {clientChatsCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            Client / job chats ({clientChatGroups.length})
          </button>
          {!clientChatsCollapsed && clientChatGroups.map(group => {
            const clientCollapsed = clientCollapsedByKey[group.key] ?? false
            const isActiveClient = group.workspaces.some(w => w.id === currentWorkspaceId)
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
                      const workspaceCollapsed = workspaceCollapsedById[workspace.id] ?? false
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
                              {workspace.chats.map(chat => (
                                <button
                                  key={chat.id}
                                  onClick={() => { enterWorkspace(workspace.id, chat.id); onNavigate?.() }}
                                  className={cn(
                                    'flex min-h-[36px] w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors',
                                    workspace.id === currentWorkspaceId && chat.id === currentChatId
                                      ? 'bg-blue-100 text-blue-900 dark:bg-blue-950/50 dark:text-blue-100'
                                      : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground'
                                  )}
                                >
                                  <MessageCircle className="h-3.5 w-3.5 shrink-0" />
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate font-medium">{chatTitle(chat.title, chat.chatType)}</div>
                                    <div className="truncate text-[10px] opacity-75">{chatMeta(chat)}</div>
                                  </div>
                                </button>
                              ))}
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

        {otherSharedWorkspaces.length > 0 ? (
          <div>
            <button
              onClick={() => setOtherChatsCollapsed(v => !v)}
              className="w-full flex items-center gap-1 px-1 mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground/70 hover:text-muted-foreground transition-colors"
            >
              {otherChatsCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              Other shared chats ({otherSharedWorkspaces.length})
            </button>
            {!otherChatsCollapsed && otherSharedWorkspaces.map(w => (
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
                  <div className="font-medium truncate text-[13px]">{w.name}</div>
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
  return workspace.customer?.name
    ?? workspace.project?.customer?.name
    ?? workspace.name
    ?? 'Unassigned client'
}

function workspaceClientSubtitle(workspace: WorkspaceInfo) {
  const address = workspace.customer?.address ?? workspace.project?.address
  if (address) return address
  if (workspace.project?.title) return workspace.project.title
  return 'Client file'
}

function workspaceSortDate(workspace: WorkspaceInfo) {
  return new Date(workspace.lastActivity ?? workspace.chats?.[0]?.lastActivity ?? 0).getTime()
}

function groupChatCount(workspaces: WorkspaceInfo[]) {
  return workspaces.reduce((sum, workspace) => sum + Math.max(workspace.chats.length, 1), 0)
}

function workspaceListTitle(workspace: WorkspaceInfo) {
  if (workspace.project?.title) return workspace.project.title
  if (workspace.type === 'customer') return 'Customer file'
  if (workspace.type === 'subcontractor') return workspace.subcontractor?.company ?? workspace.subcontractor?.name ?? workspace.name
  return workspace.name
}

function workspaceDescriptor(workspace: WorkspaceInfo) {
  const pieces = [sharedChatLabel(workspace)]
  if (workspace.project?.status) pieces.push(workspace.project.status)
  if (workspace.project?.address) pieces.push(workspace.project.address)
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
