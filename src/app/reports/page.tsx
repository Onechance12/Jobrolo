'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { FileText, Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export default function ReportsPage() {
  const [reports, setReports] = useState<any[]>([])
  const [workspaces, setWorkspaces] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [title, setTitle] = useState('Roof Inspection Report')
  const [projectId, setProjectId] = useState('')

  const projectOptions = useMemo(() => workspaces.filter(w => w.type === 'project' && w.project?.id), [workspaces])

  async function load() {
    setLoading(true)
    const [reportsRes, workspacesRes] = await Promise.all([fetch('/api/roof-reports', { cache: 'no-store' }), fetch('/api/workspaces', { cache: 'no-store' })])
    const reportsData = await reportsRes.json().catch(() => ({}))
    const workspaceData = await workspacesRes.json().catch(() => ({}))
    if (reportsRes.ok) setReports(reportsData.reports || [])
    if (workspacesRes.ok) setWorkspaces(workspaceData.workspaces || [])
    setLoading(false)
  }
  useEffect(() => {
    queueMicrotask(() => { void load() })
  }, [])

  async function create() {
    if (!projectId) return alert('Choose a job/project first.')
    const res = await fetch('/api/roof-reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, projectId, mode: 'inspection' }) })
    const data = await res.json()
    if (res.ok) window.location.href = `/reports/${data.report.id}`
    else alert(typeof data.error === 'string' ? data.error : 'Could not create report')
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <div><h1 className="text-3xl font-semibold tracking-tight">Roof Reports</h1><p className="mt-1 text-sm text-muted-foreground">Reports are best created from the active job thread or Field Copilot. This page is the full report review/builder list.</p></div>
      <Card><CardHeader><CardTitle className="text-base">Create report from job</CardTitle></CardHeader><CardContent className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]"><Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Report title" /><Select value={projectId} onValueChange={setProjectId}><SelectTrigger><SelectValue placeholder="Choose job" /></SelectTrigger><SelectContent>{projectOptions.map(w => <SelectItem key={w.project.id} value={w.project.id}>{w.name}{w.project?.customer?.name ? ` · ${w.project.customer.name}` : ''}</SelectItem>)}</SelectContent></Select><Button onClick={create}><Plus className="mr-2 h-4 w-4" />Create</Button></CardContent></Card>
      {loading ? <div className="flex items-center text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading reports…</div> : <div className="grid gap-3">{reports.map(r => <Link key={r.id} href={`/reports/${r.id}`}><Card className="transition hover:bg-muted/40"><CardContent className="flex items-center justify-between p-4"><div className="flex items-center gap-3"><FileText className="h-5 w-5 text-blue-600" /><div><div className="font-medium">{r.title}</div><div className="text-xs text-muted-foreground">{r.propertyAddress || 'No address'} · {r.status}</div></div></div><div className="text-xs text-muted-foreground">{r.photos?.length || 0} photos</div></CardContent></Card></Link>)}</div>}
    </div>
  )
}
