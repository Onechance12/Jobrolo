'use client'
import { useState, useEffect } from 'react'
import { cn, timeAgo, getInitials } from '@/lib/utils'
import { Bot, Activity, FileText, CheckCircle2, Clock, Zap, ChevronRight, X } from 'lucide-react'
import type { ClientMessage } from '@/lib/types'

interface Props {
  messages: ClientMessage[]
  isTyping: boolean
  streamingText: string
  currentContext: string | null
  onClose?: () => void
}

export function ContextPanel({ messages, isTyping, streamingText, currentContext, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<'actions' | 'context' | 'documents'>('actions')

  // Extract recent actions from messages
  const recentActions = messages
    .flatMap(m => (m.actionResults || []).map(ar => ({ ...ar, timestamp: m.createdAt })))
    .slice(-10)
    .reverse()

  // Extract documents from message attachments
  const recentDocs = messages
    .flatMap(m => m.attachments || [])
    .filter(a => a.documentId)
    .slice(-8)
    .reverse()

  // Active tasks (from action results that are tasks)
  const activeTasks = recentActions.filter(a => a.action === 'task')

  return (
    <aside className="w-full h-full flex flex-col bg-muted/50 border-l border-border">
      {/* AI Status */}
      <div className="p-3 border-b border-border bg-card">
        <div className="flex items-center gap-2">
          <div className="relative">
            <div className={cn(
              'w-8 h-8 rounded-full flex items-center justify-center',
              isTyping ? 'bg-blue-600' : 'bg-muted-foreground/30'
            )}>
              <Bot className="w-4 h-4 text-white" />
            </div>
            {isTyping && (
              <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-blue-400 dark:bg-blue-500 rounded-full border-2 border-white animate-pulse" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-foreground">
              {isTyping ? 'Working…' : 'Ready'}
            </div>
            <div className="text-[11px] text-muted-foreground truncate">
              {isTyping ? (streamingText || 'Processing…') : 'AI operations manager'}
            </div>
          </div>
          {onClose && (
            <button onClick={onClose} className="lg:hidden p-1 rounded hover:bg-muted">
              <X className="w-4 h-4 text-muted-foreground/60" />
            </button>
          )}
        </div>
      </div>

      {/* Current Context */}
      {currentContext && (
        <div className="px-3 py-2 border-b border-border bg-blue-50/50 dark:bg-blue-950/50">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-300 mb-0.5">Current Context</div>
          <div className="text-xs text-muted-foreground line-clamp-2">{currentContext.slice(0, 200)}</div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-border bg-card">
        {[
          { id: 'actions' as const, label: 'Actions', icon: Zap },
          { id: 'context' as const, label: 'Tasks', icon: CheckCircle2 },
          { id: 'documents' as const, label: 'Docs', icon: FileText },
        ].map(tab => {
          const Icon = tab.icon
          const count = tab.id === 'actions' ? recentActions.length : tab.id === 'context' ? activeTasks.length : recentDocs.length
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium border-b-2 transition-colors',
                activeTab === tab.id
                  ? 'border-blue-500 dark:border-blue-400 text-blue-700 dark:text-blue-300'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
              {count > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">{count}</span>
              )}
            </button>
          )
        })}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'actions' && (
          <div className="p-2 space-y-1.5">
            {recentActions.length === 0 ? (
              <div className="text-center py-8 text-xs text-muted-foreground/60">
                <Activity className="w-6 h-6 mx-auto mb-2 opacity-30" />
                No recent actions
              </div>
            ) : (
              recentActions.map((action, i) => (
                <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-card border border-border">
                  <div className={cn(
                    'flex-shrink-0 w-6 h-6 rounded flex items-center justify-center',
                    action.status === 'executed' ? 'bg-blue-100 dark:bg-blue-950/50 text-blue-600 dark:text-blue-300' :
                    action.status === 'failed' ? 'bg-rose-100 text-rose-600' :
                    'bg-muted text-muted-foreground/60'
                  )}>
                    {action.status === 'executed' ? <CheckCircle2 className="w-3.5 h-3.5" /> :
                     action.status === 'failed' ? <X className="w-3.5 h-3.5" /> :
                     <Clock className="w-3.5 h-3.5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-muted-foreground capitalize">
                      {action.action?.replace('_', ' ')}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">{action.detail}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'context' && (
          <div className="p-2 space-y-1.5">
            {activeTasks.length === 0 ? (
              <div className="text-center py-8 text-xs text-muted-foreground/60">
                <CheckCircle2 className="w-6 h-6 mx-auto mb-2 opacity-30" />
                No active tasks
              </div>
            ) : (
              activeTasks.map((task, i) => (
                <div key={i} className="p-2 rounded-lg bg-card border border-border">
                  <div className="text-xs font-medium text-muted-foreground">{task.detail}</div>
                  <div className="text-[11px] text-muted-foreground/60 mt-0.5">{timeAgo(task.timestamp || '')}</div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'documents' && (
          <div className="p-2 space-y-1.5">
            {recentDocs.length === 0 ? (
              <div className="text-center py-8 text-xs text-muted-foreground/60">
                <FileText className="w-6 h-6 mx-auto mb-2 opacity-30" />
                No documents uploaded
              </div>
            ) : (
              recentDocs.map((doc, i) => (
                <a
                  key={i}
                  href={doc.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 p-2 rounded-lg bg-card border border-border hover:border-blue-300 dark:hover:border-blue-700 hover:bg-blue-50/30 dark:hover:bg-blue-950/30 transition-colors"
                >
                  <div className="flex-shrink-0 w-8 h-8 rounded bg-muted flex items-center justify-center">
                    {doc.type === 'image' ? (
                      <img src={doc.thumbnailUrl || doc.url} alt={doc.name} className="w-full h-full object-cover rounded" />
                    ) : (
                      <FileText className="w-4 h-4 text-muted-foreground/60" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-muted-foreground truncate">{doc.name}</div>
                    <div className="text-[10px] text-muted-foreground/60">
                      {doc.documentStatus === 'reviewed' && <span className="text-blue-600 dark:text-blue-300">✓ Analyzed</span>}
                      {doc.documentStatus === 'processing' && <span className="text-amber-600">Analyzing…</span>}
                      {doc.documentStatus === 'queued' && <span className="text-muted-foreground/60">Queued</span>}
                      {doc.documentStatus === 'needs_ocr' && <span className="text-orange-600">Needs OCR</span>}
                      {doc.documentStatus === 'failed' && <span className="text-rose-600">Failed</span>}
                    </div>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40" />
                </a>
              ))
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
