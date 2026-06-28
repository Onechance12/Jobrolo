'use client'
import { useState, useEffect, useCallback } from 'react'
import { cn, timeAgo } from '@/lib/utils'
import { Radar, AlertTriangle, TrendingUp, Lightbulb, Clock, CheckCircle2, XCircle, Loader2, ChevronDown, ChevronRight } from 'lucide-react'

interface Insight {
  id: string
  type: string
  title: string
  detail: string
  confidence: number
  source: string
  sourceName: string | null
  status: string
  resolutionDetail: string | null
  resolutionActions: string | null
  createdAt: string
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: any }> = {
  handled: { label: 'Handled', color: 'text-blue-700 dark:text-blue-300', bg: 'bg-blue-50 dark:bg-blue-950/40', icon: CheckCircle2 },
  needs_attention: { label: 'Need Attention', color: 'text-rose-700 dark:text-rose-300', bg: 'bg-rose-50 dark:bg-rose-950/40', icon: AlertTriangle },
  needs_approval: { label: 'Need Approval', color: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-50 dark:bg-amber-950/40', icon: Lightbulb },
  waiting_customer: { label: 'Waiting on Customer', color: 'text-violet-700 dark:text-violet-300', bg: 'bg-violet-50 dark:bg-violet-950/40', icon: Clock },
  waiting_carrier: { label: 'Waiting on Carrier', color: 'text-blue-700 dark:text-blue-300', bg: 'bg-blue-50 dark:bg-blue-950/40', icon: Clock },
  waiting_internal: { label: 'Waiting on Team', color: 'text-slate-700 dark:text-slate-300', bg: 'bg-slate-100 dark:bg-slate-800/40', icon: Clock },
}

const STATUS_ORDER = ['handled', 'needs_attention', 'needs_approval', 'waiting_customer', 'waiting_carrier', 'waiting_internal']

export function RadarPanel({ onClose }: { onClose?: () => void }) {
  const [grouped, setGrouped] = useState<Record<string, Insight[]>>({})
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [report, setReport] = useState<string | null>(null)
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({})

  const loadInsights = useCallback(async () => {
    try {
      const res = await fetch('/api/insights')
      if (res.ok) {
        const data = await res.json()
        setGrouped(data.grouped || {})
      }
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => {
    queueMicrotask(() => { void loadInsights() })
  }, [loadInsights])

  const handleScan = async () => {
    setScanning(true)
    setReport(null)
    try {
      const res = await fetch('/api/insights', { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        if (data.report) setReport(data.report)
      }
      await loadInsights()
    } catch {}
    setScanning(false)
  }

  const handleFeedback = async (id: string, status: string) => {
    // Optimistic update
    setGrouped(prev => {
      const updated: Record<string, Insight[]> = {}
      for (const [key, items] of Object.entries(prev) as Array<[string, Insight[]]>) {
        updated[key] = items.filter(i => i.id !== id)
      }
      return updated
    })
    try {
      await fetch('/api/insights', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ insightId: id, status }),
      })
    } catch {}
  }

  const totalHandled = grouped.handled?.length || 0
  const totalEscalated = (Object.entries(grouped) as Array<[string, Insight[]]>)
    .filter(([k]) => k !== 'handled')
    .reduce((sum, [, items]) => sum + items.length, 0)
  const total = totalHandled + totalEscalated

  const toggleSection = (status: string) =>
    setCollapsedSections(prev => ({ ...prev, [status]: !prev[status] }))

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="p-3 border-b border-border glass">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Radar className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <span className="text-sm font-semibold text-foreground">Operations Radar</span>
          </div>
          <button
            onClick={handleScan}
            disabled={scanning}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm shadow-blue-600/20"
          >
            {scanning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Radar className="w-3 h-3" />}
            {scanning ? 'Working…' : 'Run Scan'}
          </button>
        </div>
        {/* Summary */}
        {!loading && total > 0 && (
          <div className="flex gap-2 text-[11px]">
            <span className="text-blue-600 dark:text-blue-400 font-medium">{totalHandled} handled</span>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-rose-600 font-medium">{totalEscalated} need help</span>
          </div>
        )}
      </div>

      {/* Report (after scan) */}
      {report && (
        <div className="p-3 border-b border-border bg-blue-50/50 dark:bg-blue-950/20">
          <div className="text-[11px] font-semibold uppercase text-blue-600 dark:text-blue-400 mb-1">Report</div>
          <div className="text-xs text-foreground/80 whitespace-pre-wrap">{report}</div>
        </div>
      )}

      {/* Insights by status */}
      <div className="flex-1 overflow-y-auto p-2 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/60" />
          </div>
        ) : total === 0 ? (
          <div className="text-center py-8">
            <Radar className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
            <div className="text-xs text-muted-foreground/60">All clear</div>
            <button onClick={handleScan} className="mt-2 text-[11px] text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium">Run scan</button>
          </div>
        ) : (
          STATUS_ORDER.map(status => {
            const items = grouped[status]
            if (!items?.length) return null
            const config = STATUS_CONFIG[status] || STATUS_CONFIG.needs_attention
            const Icon = config.icon
            const collapsed = collapsedSections[status]

            return (
              <div key={status}>
                <button
                  onClick={() => toggleSection(status)}
                  className={cn('w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] font-semibold uppercase tracking-wide', config.bg, config.color)}
                >
                  {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  <Icon className="w-3 h-3" />
                  {config.label} ({items.length})
                </button>
                {!collapsed && (
                  <div className="mt-1 space-y-1.5">
                    {items.map(insight => {
                      const actions = insight.resolutionActions ? JSON.parse(insight.resolutionActions) : []
                      return (
                        <div key={insight.id} className={cn('rounded-lg border p-2.5', config.bg, 'border-border')}>
                          <div className="text-xs font-medium text-foreground">{insight.title}</div>
                          <div className="text-[11px] text-muted-foreground mt-0.5">{insight.detail}</div>
                          {insight.resolutionDetail && (
                            <div className="text-[11px] text-muted-foreground/80 mt-1 italic">{insight.resolutionDetail}</div>
                          )}
                          {actions.length > 0 && (
                            <div className="mt-1 space-y-0.5">
                              {actions.map((a: string, i: number) => (
                                <div key={i} className="text-[10px] text-blue-600 dark:text-blue-400">→ {a}</div>
                              ))}
                            </div>
                          )}
                          <div className="flex items-center gap-2 mt-1">
                            {insight.sourceName && <span className="text-[9px] text-muted-foreground/50">{insight.sourceName}</span>}
                            <span className="text-[9px] text-muted-foreground/50">{timeAgo(insight.createdAt)}</span>
                          </div>
                          {/* Feedback */}
                          <div className="flex gap-1 mt-1.5">
                            <button onClick={() => handleFeedback(insight.id, 'resolved')} className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-muted-foreground hover:bg-blue-100 hover:text-blue-700 dark:hover:bg-blue-900/40 dark:hover:text-blue-300 transition-colors">
                              <CheckCircle2 className="w-2.5 h-2.5" /> Resolved
                            </button>
                            <button onClick={() => handleFeedback(insight.id, 'dismissed')} className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-muted-foreground hover:bg-rose-100 hover:text-rose-700 dark:hover:bg-rose-900/40 dark:hover:text-rose-300 transition-colors">
                              <XCircle className="w-2.5 h-2.5" /> Dismiss
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
