'use client'
import { useState, useMemo } from 'react'
import { useChatStore } from '@/store/chat-store'
import { useWorkspaceStore } from '@/store/workspace-store'
import { cn, getInitials, timeAgo, truncate } from '@/lib/utils'
import { Plus, Search, X, ChevronDown, ChevronRight, LayoutGrid, FileText, MapPin } from 'lucide-react'
import type { ConversationInfo, WorkspaceInfo } from '@/lib/types'

interface Props { onNewChat: () => void; onNavigate?: () => void }

export function WorkspaceSidebar({ onNewChat, onNavigate }: Props) {
  const conversations = useChatStore(s => s.conversations)
  const conversationId = useChatStore(s => s.conversationId)
  const selectConversation = useChatStore(s => s.selectConversation)
  const workspaces = useWorkspaceStore(s => s.workspaces)
  const currentWorkspaceId = useWorkspaceStore(s => s.currentWorkspaceId)
  const enterWorkspace = useWorkspaceStore(s => s.enterWorkspace)
  const exitWorkspace = useWorkspaceStore(s => s.exitWorkspace)
  const [search, setSearch] = useState('')
  const [chatsCollapsed, setChatsCollapsed] = useState(false)
  const [wsCollapsedByType, setWsCollapsedByType] = useState<Record<string, boolean>>({})

  const filteredConvos = useMemo(() =>
    search ? conversations.filter(c => c.title.toLowerCase().includes(search.toLowerCase()) || c.preview.toLowerCase().includes(search.toLowerCase())) : conversations,
    [conversations, search]
  )
  const filteredWorkspaces = useMemo(() =>
    search ? workspaces.filter(w => w.name.toLowerCase().includes(search.toLowerCase()) || (w.project?.customer?.name ?? '').toLowerCase().includes(search.toLowerCase())) : workspaces,
    [workspaces, search]
  )
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
  const wsByType = useMemo(() => {
    const g: Record<string, WorkspaceInfo[]> = {}
    for (const w of filteredWorkspaces) { if (!g[w.type]) g[w.type] = []; g[w.type].push(w) }
    return g
  }, [filteredWorkspaces])
  const typeOrder = ['project', 'customer', 'subcontractor', 'supplier']
  const typeLabel: Record<string, string> = { project: 'Jobs & Projects', customer: 'Customers', subcontractor: 'Subs', supplier: 'Suppliers' }

  const toggleWsType = (type: string) => setWsCollapsedByType(prev => ({ ...prev, [type]: !prev[type] }))
  const insertCommandPrompt = (text: string) => {
    exitWorkspace()
    if (conversationId) selectConversation(conversationId)
    window.dispatchEvent(new CustomEvent('jobrolo:insert-prompt', { detail: { text } }))
    onNavigate?.()
  }

  return (
    <aside className="w-full md:w-64 border-r border-border bg-sidebar flex flex-col h-full">
      {/* Logo + New Chat */}
      <div className="p-3 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="Jobrolo" className="w-8 h-8 rounded-lg object-cover" />
            <div className="font-semibold text-sidebar-foreground text-sm tracking-tight">Jobrolo</div>
          </div>
          {onNavigate && (
            <button onClick={onNavigate} className="md:hidden p-1.5 rounded-md hover:bg-sidebar-accent text-muted-foreground transition-colors">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <button
          onClick={onNewChat}
          className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl bg-card border border-border hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/30 text-sidebar-foreground text-sm font-medium transition-all duration-200 hover:scale-[1.01] active:scale-[0.99]"
        >
          <Plus className="w-4 h-4 text-blue-500" /> New Chat
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60" />
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" suppressHydrationWarning
            className="w-full pl-8 pr-7 py-2 text-[16px] bg-card border border-border rounded-lg placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400 dark:bg-background/50 transition-all"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground hover:text-foreground transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Command Center button — the focal point */}
      <div className="px-3 py-2 border-b border-border">
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

        <div className="mt-3 rounded-2xl border border-border bg-card/70 p-2">
          <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Command shortcuts</div>
          <button
            onClick={() => insertCommandPrompt('Turn an uploaded document into a reusable template.')}
            className="w-full flex items-center gap-2.5 px-2 py-2 rounded-xl text-sm min-h-[40px] transition-colors text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <FileText className="w-4 h-4 text-violet-600 dark:text-violet-400" />
            Start template from chat
          </button>
          <button
            onClick={() => insertCommandPrompt('Start a roof report from chat. Ask me which customer/project and photos to use.')}
            className="w-full flex items-center gap-2.5 px-2 py-2 rounded-xl text-sm min-h-[40px] transition-colors text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <FileText className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
            Start roof report
          </button>
          <button
            onClick={() => insertCommandPrompt('Help me create a canvassing game plan from chat. Ask what street or area I want to work.')}
            className="w-full flex items-center gap-2.5 px-2 py-2 rounded-xl text-sm min-h-[40px] transition-colors text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <MapPin className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            Canvassing game plan
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
        {/* Chats — collapsible */}
        {groupedConvos && Object.values(groupedConvos).flat().length > 0 && (
          <div>
            <button
              onClick={() => setChatsCollapsed(v => !v)}
              className="w-full flex items-center gap-1 px-1 mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground/70 hover:text-muted-foreground transition-colors"
            >
              {chatsCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              Chats ({Object.values(groupedConvos).flat().length})
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
                      <div className="font-medium truncate text-[13px]">{c.title || 'New Chat'}</div>
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

        {/* Workspaces — collapsible by type */}
        <div>
          <div className="px-1 mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">Workspaces</div>
          {typeOrder.map(type => {
            const list = wsByType[type]
            if (!list?.length) return null
            const collapsed = wsCollapsedByType[type]
            return (
              <div key={type} className="mb-1.5">
                <button
                  onClick={() => toggleWsType(type)}
                  className="w-full flex items-center gap-1 px-1 mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 hover:text-muted-foreground transition-colors"
                >
                  {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  {typeLabel[type]} ({list.length})
                </button>
                {!collapsed && list.map(w => (
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
                      {w.project?.customer?.name && <div className="text-[11px] text-muted-foreground truncate">{w.project.customer.name}</div>}
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-muted-foreground/60">Job thread</span>
                        {(w.recentMemory?.length ?? 0) > 0 && (
                          <>
                            <span className="text-[10px] text-muted-foreground/40">·</span>
                            <span className="text-[10px] text-muted-foreground/60 truncate">{truncate(w.recentMemory![0].content, 30)}</span>
                          </>
                        )}
                      </div>
                    </div>
                    {w.type === 'project' && w.project?.priority === 'urgent' && <span className="text-rose-500 text-xs font-bold">!</span>}
                  </button>
                ))}
              </div>
            )
          })}
        </div>

        {!filteredConvos.length && !filteredWorkspaces.length && (
          <div className="text-center py-8 text-sm text-muted-foreground/60">{search ? 'No matches' : 'No chats yet'}</div>
        )}
      </div>
    </aside>
  )
}
