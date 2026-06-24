'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { AlertTriangle, Camera, CheckCircle2, FileText, ImageIcon, Loader2, Share2, Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

function lines(value: string | string[] | undefined | null) {
  if (Array.isArray(value)) return value.join('\n')
  return value || ''
}

function splitLines(value: string) {
  return value.split('\n').map(s => s.trim()).filter(Boolean)
}

function humanize(value?: string | null) {
  return String(value || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export function RoofReportBuilder({ reportId }: { reportId: string }) {
  const [workspace, setWorkspace] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [form, setForm] = useState<any>({})

  async function load() {
    setLoading(true)
    const res = await fetch(`/api/roof-reports/${reportId}/workspace`, { cache: 'no-store' })
    const data = await res.json()
    if (res.ok) {
      setWorkspace(data)
      setForm({
        title: data.report.title || '',
        mode: data.report.mode || 'inspection',
        summaryTone: data.report.summaryTone || 'homeowner',
        inspectionDate: data.report.inspectionDate ? new Date(data.report.inspectionDate).toISOString().slice(0, 16) : '',
        inspectorName: data.report.inspectorName || '',
        propertyAddress: data.report.propertyAddress || '',
        clientName: data.report.clientName || '',
        claimNumber: data.report.claimNumber || '',
        introduction: data.report.introduction || '',
        propertyReviewSummary: data.report.propertyReviewSummary || '',
        observedConditions: lines(data.report.observedConditions),
        recommendations: lines(data.report.recommendations),
        conclusion: data.report.conclusion || '',
        disclaimer: data.report.disclaimer || '',
        internalNotes: data.report.internalNotes || '',
      })
    } else setStatus(data.error || 'Could not load report')
    setLoading(false)
  }

  useEffect(() => { load() }, [reportId])

  const report = workspace?.report
  const readyScore = workspace?.readyScore ?? 0
  const warnings = workspace?.warnings ?? []
  const checklist = workspace?.checklist?.checklist ?? []

  async function save() {
    setSaving(true); setStatus(null)
    const res = await fetch(`/api/roof-reports/${reportId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        inspectionDate: form.inspectionDate ? new Date(form.inspectionDate).toISOString() : null,
        observedConditions: splitLines(form.observedConditions || ''),
        recommendations: splitLines(form.recommendations || ''),
      }),
    })
    const data = await res.json()
    if (!res.ok) setStatus(data.error || 'Save failed')
    else { setStatus('Saved'); await load() }
    setSaving(false)
  }

  async function post(path: string, success: string) {
    setSaving(true); setStatus(null)
    const res = await fetch(path, { method: 'POST' })
    const data = await res.json()
    if (!res.ok) setStatus(data.error || 'Action failed')
    else {
      setStatus(success)
      if (data.workspace) { setWorkspace(data.workspace); setForm((prev: any) => ({ ...prev, propertyReviewSummary: data.workspace.report.propertyReviewSummary || prev.propertyReviewSummary, observedConditions: lines(data.workspace.report.observedConditions), recommendations: lines(data.workspace.report.recommendations), conclusion: data.workspace.report.conclusion || prev.conclusion })) }
      else await load()
    }
    setSaving(false)
  }

  async function updatePhoto(photoId: string, patch: Record<string, unknown>) {
    await fetch(`/api/roof-reports/${reportId}/photos/${photoId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
    await load()
  }

  if (loading) return <div className="flex min-h-[50vh] items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading roof report…</div>
  if (!report) return <div className="p-6 text-sm text-muted-foreground">Report not found.</div>

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-col gap-3 rounded-3xl border bg-card p-4 shadow-sm sm:p-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge variant="secondary">Roof Report</Badge>
            <Badge variant={report.status === 'finalized' ? 'default' : 'outline'}>{humanize(report.status)}</Badge>
            <Badge variant="outline">{readyScore}% ready</Badge>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{report.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{report.propertyAddress || 'No property address'}{report.clientName ? ` · ${report.clientName}` : ''}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => post(`/api/roof-reports/${reportId}/summary`, 'Summary drafted')} disabled={saving}><Sparkles className="mr-2 h-4 w-4" /> Draft summary</Button>
          <Button variant="outline" asChild><Link href={`/api/roof-reports/${reportId}/print`} target="_blank"><FileText className="mr-2 h-4 w-4" /> Preview</Link></Button>
          <Button variant="outline" onClick={() => post(`/api/roof-reports/${reportId}/share`, 'Share link ready')} disabled={saving}><Share2 className="mr-2 h-4 w-4" /> Share</Button>
          <Button variant="outline" onClick={() => post(`/api/roof-reports/${reportId}/pdf`, 'PDF created')} disabled={saving}>Create PDF</Button>
          <Button onClick={() => post(`/api/roof-reports/${reportId}/finalize`, 'Report finalized/marked ready')} disabled={saving}><CheckCircle2 className="mr-2 h-4 w-4" /> Finalize</Button>
        </div>
      </div>

      {status ? <div className="rounded-2xl border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">{status}</div> : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle className="text-base">Report details</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="Title"><Input value={form.title || ''} onChange={e => setForm({ ...form, title: e.target.value })} /></Field>
              <Field label="Mode"><Select value={form.mode || 'inspection'} onValueChange={v => setForm({ ...form, mode: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="inspection">Inspection</SelectItem><SelectItem value="adjuster_meeting">Adjuster meeting</SelectItem><SelectItem value="homeowner_summary">Homeowner summary</SelectItem><SelectItem value="production_closeout">Production closeout</SelectItem><SelectItem value="maintenance">Maintenance</SelectItem></SelectContent></Select></Field>
              <Field label="Inspector"><Input value={form.inspectorName || ''} onChange={e => setForm({ ...form, inspectorName: e.target.value })} /></Field>
              <Field label="Inspection date"><Input type="datetime-local" value={form.inspectionDate || ''} onChange={e => setForm({ ...form, inspectionDate: e.target.value })} /></Field>
              <Field label="Client"><Input value={form.clientName || ''} onChange={e => setForm({ ...form, clientName: e.target.value })} /></Field>
              <Field label="Claim #"><Input value={form.claimNumber || ''} onChange={e => setForm({ ...form, claimNumber: e.target.value })} /></Field>
              <Field label="Property address" className="sm:col-span-2"><Input value={form.propertyAddress || ''} onChange={e => setForm({ ...form, propertyAddress: e.target.value })} /></Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Customer-facing narrative</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <Field label="Introduction"><Textarea rows={3} value={form.introduction || ''} onChange={e => setForm({ ...form, introduction: e.target.value })} /></Field>
              <Field label="Property review summary"><Textarea rows={4} value={form.propertyReviewSummary || ''} onChange={e => setForm({ ...form, propertyReviewSummary: e.target.value })} /></Field>
              <Field label="Observed conditions"><Textarea rows={5} value={form.observedConditions || ''} onChange={e => setForm({ ...form, observedConditions: e.target.value })} placeholder="One condition per line" /></Field>
              <Field label="Recommendations"><Textarea rows={5} value={form.recommendations || ''} onChange={e => setForm({ ...form, recommendations: e.target.value })} placeholder="One recommendation per line" /></Field>
              <Field label="Conclusion"><Textarea rows={3} value={form.conclusion || ''} onChange={e => setForm({ ...form, conclusion: e.target.value })} /></Field>
              <Field label="Internal notes — not public"><Textarea rows={3} value={form.internalNotes || ''} onChange={e => setForm({ ...form, internalNotes: e.target.value })} /></Field>
              <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Save report</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ImageIcon className="h-4 w-4" /> Photo documentation</CardTitle></CardHeader>
            <CardContent className="space-y-5">
              {(workspace.groupedPhotos || []).length ? workspace.groupedPhotos.map((group: any) => (
                <div key={group.group} className="space-y-3">
                  <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">{group.label}</h3><Badge variant="outline">{group.photos.length}</Badge></div>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {group.photos.map((photo: any) => <PhotoCard key={photo.id} photo={photo} categories={workspace.categories} conditions={workspace.conditions} severities={workspace.severities} onUpdate={patch => updatePhoto(photo.id, patch)} />)}
                  </div>
                </div>
              )) : <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground"><Camera className="mx-auto mb-2 h-6 w-6" /> No photos yet. Upload photos in the job thread or Field Copilot, then attach them to this report.</div>}
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-5">
          <Card>
            <CardHeader><CardTitle className="text-base">Missing photo checklist</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {warnings.length ? <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"><AlertTriangle className="mb-1 h-4 w-4" />{warnings.slice(0, 5).map((w: string, i: number) => <div key={i}>• {w}</div>)}</div> : <div className="rounded-xl border bg-emerald-50 p-3 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">Required report basics look complete.</div>}
              <div className="space-y-1.5 pt-2">
                {checklist.map((item: any) => <div key={item.key} className="flex items-center justify-between rounded-lg border px-3 py-2"><span>{item.label}</span><div className="flex gap-1">{item.required ? <Badge variant="secondary" className="text-[10px]">required</Badge> : item.recommended ? <Badge variant="outline" className="text-[10px]">recommended</Badge> : null}<Badge variant={item.present ? 'default' : 'outline'} className="text-[10px]">{item.count}</Badge></div></div>)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Report links</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Button className="w-full justify-start" variant="outline" asChild><Link href={`/api/roof-reports/${reportId}/print`} target="_blank">Open print preview</Link></Button>
              {report.shareUrl ? <Button className="w-full justify-start" variant="outline" asChild><Link href={report.shareUrl} target="_blank">Open public share</Link></Button> : null}
              {report.pdfUrl ? <Button className="w-full justify-start" variant="outline" asChild><Link href={report.pdfUrl} target="_blank">Open saved PDF</Link></Button> : null}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  )
}

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return <div className={className}><Label className="mb-2 block text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</Label>{children}</div>
}

function PhotoCard({ photo, categories, conditions, severities, onUpdate }: { photo: any; categories: any[]; conditions: string[]; severities: string[]; onUpdate: (patch: Record<string, unknown>) => void | Promise<void> }) {
  const [caption, setCaption] = useState(photo.caption || '')
  return (
    <div className="overflow-hidden rounded-2xl border bg-background">
      <div className="aspect-[4/3] bg-muted">{photo.imageUrl ? <img src={photo.imageUrl} alt={photo.caption || photo.category} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-muted-foreground"><ImageIcon className="h-8 w-8" /></div>}</div>
      <div className="space-y-2 p-3">
        <div className="grid grid-cols-2 gap-2">
          <Select value={photo.category || 'other'} onValueChange={v => onUpdate({ category: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{categories.map(c => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}</SelectContent></Select>
          <Select value={photo.severity || 'informational'} onValueChange={v => onUpdate({ severity: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{severities.map(s => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}</SelectContent></Select>
        </div>
        <Select value={photo.condition || 'other'} onValueChange={v => onUpdate({ condition: v })}><SelectTrigger><SelectValue placeholder="Condition" /></SelectTrigger><SelectContent>{conditions.map(c => <SelectItem key={c} value={c}>{humanize(c)}</SelectItem>)}</SelectContent></Select>
        <Textarea rows={3} value={caption} onChange={e => setCaption(e.target.value)} onBlur={() => onUpdate({ caption })} placeholder="Caption" />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={photo.isIncluded ? 'default' : 'outline'} onClick={() => onUpdate({ isIncluded: !photo.isIncluded })}>{photo.isIncluded ? 'Included' : 'Excluded'}</Button>
          <Button size="sm" variant={photo.isCoverPhoto ? 'default' : 'outline'} onClick={() => onUpdate({ isCoverPhoto: !photo.isCoverPhoto })}>Cover</Button>
        </div>
      </div>
    </div>
  )
}
