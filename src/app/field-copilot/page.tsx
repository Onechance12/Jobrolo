'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { FieldCopilotDrawer } from '@/components/jobrolo/field-copilot-drawer'
import { FieldEntryStrip } from '@/components/jobrolo/field-entry-strip'
import type { WorkspaceInfo } from '@/lib/types'
import { Loader2, MapPin, Search, Sparkles } from 'lucide-react'

export default function FieldCopilotPage() {
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<WorkspaceInfo | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/workspaces')
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled) setWorkspaces((data.workspaces ?? []).filter((w: WorkspaceInfo) => w.type === 'project' && (w.projectId || w.project?.id)))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return workspaces
    return workspaces.filter(w => [w.name, w.project?.title, w.project?.customer?.name, w.project?.address].filter(Boolean).join(' ').toLowerCase().includes(q))
  }, [search, workspaces])

  function openWorkspace(workspace: WorkspaceInfo) {
    setSelected(workspace)
    setOpen(true)
  }

  return (
    <main className="min-h-screen bg-background p-4 sm:p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="space-y-2">
          <p className="text-sm uppercase tracking-[0.24em] text-muted-foreground">Jobrolo</p>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">Field Copilot</h1>
              <p className="mt-2 max-w-2xl text-muted-foreground">Pick a job and open the same mobile drawer the main chat uses. No raw project ID required.</p>
            </div>
            <Badge variant="secondary" className="gap-1"><Sparkles className="h-3.5 w-3.5" /> Chat-first field mode</Badge>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Start from a job</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search customer, job, or address…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>

            {loading ? (
              <div className="flex items-center gap-2 rounded-xl border p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading jobs…</div>
            ) : filtered.length ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {filtered.map(w => (
                  <button key={w.id} onClick={() => openWorkspace(w)} className="rounded-2xl border bg-card p-4 text-left transition hover:border-blue-400 hover:bg-blue-50/40 dark:hover:border-blue-700 dark:hover:bg-blue-950/20">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-semibold">{w.project?.title ?? w.name}</div>
                        <div className="mt-1 truncate text-sm text-muted-foreground">{[w.project?.customer?.name, w.project?.address].filter(Boolean).join(' · ') || 'Project workspace'}</div>
                      </div>
                      {w.project?.priority ? <Badge variant={w.project.priority === 'urgent' || w.project.priority === 'high' ? 'destructive' : 'outline'}>{w.project.priority}</Badge> : null}
                    </div>
                    <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><MapPin className="h-3.5 w-3.5" /> Open job-site briefing, quick actions, and speak briefing.</div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border p-4 text-sm text-muted-foreground">No project workspaces found. Create/open a job in the main chat first.</div>
            )}
          </CardContent>
        </Card>

        {selected ? (
          <FieldEntryStrip
            workspace={selected}
            onOpenFieldCopilot={() => setOpen(true)}
            onSendPrompt={() => setOpen(true)}
            compact
          />
        ) : null}
      </div>

      {selected?.projectId ? <FieldCopilotDrawer open={open} onOpenChange={setOpen} projectId={selected.projectId} /> : null}
    </main>
  )
}
