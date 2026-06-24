'use client'

import { useEffect, useMemo, useState } from 'react'
import { sanitizeHtml } from '@/lib/security/html'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Archive, CheckCircle2, ClipboardCheck, Eye, FileText, Loader2, RefreshCw, Save, Sparkles, Wand2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

const TEMPLATE_TYPES = [
  'inspection_authorization',
  'contingency_agreement',
  'work_authorization',
  'roof_replacement_contract',
  'estimate_proposal',
  'supplement_authorization',
  'change_order',
  'completion_certificate',
  'warranty',
  'maintenance_agreement',
  'custom',
]

const COMMON_VARIABLES = [
  '{{company.name}}',
  '{{company.phone}}',
  '{{company.email}}',
  '{{company.address}}',
  '{{company.licenseNumber}}',
  '{{customer.name}}',
  '{{customer.phone}}',
  '{{customer.email}}',
  '{{customer.address}}',
  '{{project.title}}',
  '{{project.address}}',
  '{{claim.carrier}}',
  '{{claim.number}}',
  '{{insurance.deductible}}',
  '{{estimate.rcv}}',
  '{{estimate.acv}}',
  '{{date.today}}',
  '{{signer.name}}',
  '{{signer.signature}}',
  '{{signer.initials}}',
  '{{signer.date}}',
]

type TemplateUpload = {
  id: string
  documentId: string
  originalName: string
  name?: string | null
  templateType: string
  status: string
  templateId?: string | null
  detectedTitle?: string | null
  detectedType?: string | null
  extractionConfidence?: number | null
  ocrConfidence?: number | null
  error?: string | null
  updatedAt: string
  createdAt: string
}

type TemplateRecord = {
  id: string
  name: string
  type: string
  status: string
  reviewStatus?: string | null
  bodyHtml: string
  variablesJson?: string | null
  requiresSignature: boolean
  importedFromUpload?: boolean
  detectedFieldsJson?: string | null
  clausesJson?: string | null
  signatureFieldsJson?: string | null
  parseWarningsJson?: string | null
  sourceOriginalName?: string | null
  updatedAt?: string
  approvedAt?: string | null
}

type TemplateField = {
  fieldKey: string
  label: string
  type: string
  variable?: string | null
  required?: boolean
  defaultValue?: string | null
  mappedSource?: string | null
  instructions?: string | null
  sortOrder?: number
}

type TemplateClause = {
  title?: string | null
  body: string
  clauseType: string
  editable?: boolean
  required?: boolean
  aiNotes?: string | null
  sortOrder?: number
}

type ReviewResponse = {
  template: TemplateRecord
  fields: TemplateField[]
  clauses: TemplateClause[]
  upload?: TemplateUpload | null
  versions?: Array<{ id: string; version: number; status: string; changeSummary?: string | null; createdAt: string }>
}

function parseJsonArray<T>(value?: string | null): T[] {
  if (!value) return []
  try { return Array.isArray(JSON.parse(value)) ? JSON.parse(value) as T[] : [] } catch { return [] }
}

function humanize(value?: string | null) {
  return (value || 'custom').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function statusTone(status?: string | null) {
  const s = (status || '').toLowerCase()
  if (s.includes('approved') || s === 'active') return 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-900'
  if (s.includes('review') || s.includes('parsed') || s.includes('uploaded')) return 'bg-amber-100 text-amber-900 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900'
  if (s.includes('failed')) return 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-900'
  return 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-900 dark:text-slate-200 dark:border-slate-800'
}

export function TemplateReviewWorkspace({ templateId }: { templateId?: string }) {
  const router = useRouter()
  const [uploads, setUploads] = useState<TemplateUpload[]>([])
  const [templates, setTemplates] = useState<TemplateRecord[]>([])
  const [review, setReview] = useState<ReviewResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [newDocumentId, setNewDocumentId] = useState('')
  const [newTemplateName, setNewTemplateName] = useState('')
  const [newTemplateType, setNewTemplateType] = useState('contingency_agreement')

  const [name, setName] = useState('')
  const [type, setType] = useState('custom')
  const [bodyHtml, setBodyHtml] = useState('')
  const [fields, setFields] = useState<TemplateField[]>([])
  const [clauses, setClauses] = useState<TemplateClause[]>([])
  const [signatureFields, setSignatureFields] = useState<TemplateField[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [requiresSignature, setRequiresSignature] = useState(true)
  const [previewOpen, setPreviewOpen] = useState(true)

  const pendingTemplates = useMemo(() => templates.filter(t => ['needs_review', 'parsed', 'uploaded'].includes(String(t.reviewStatus || t.status).toLowerCase())), [templates])
  const approvedTemplates = useMemo(() => templates.filter(t => String(t.reviewStatus || '').toLowerCase() === 'approved' || t.status === 'active'), [templates])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [uRes, tRes] = await Promise.all([
        fetch('/api/document-templates/uploads?status=all'),
        fetch('/api/document-templates?status=all&imported=1'),
      ])
      if (uRes.ok) setUploads((await uRes.json()).uploads || [])
      if (tRes.ok) setTemplates((await tRes.json()).templates || [])
      if (templateId) await loadReview(templateId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load templates')
    } finally {
      setLoading(false)
    }
  }

  async function loadReview(id: string) {
    const res = await fetch(`/api/document-templates/${id}`)
    if (!res.ok) throw new Error('Could not load template review')
    const data = await res.json() as ReviewResponse
    setReview(data)
    const t = data.template
    setName(t.name || '')
    setType(t.type || 'custom')
    setBodyHtml(t.bodyHtml || '')
    setRequiresSignature(!!t.requiresSignature)
    setFields(data.fields?.length ? data.fields : parseJsonArray<TemplateField>(t.detectedFieldsJson))
    setClauses(data.clauses?.length ? data.clauses : parseJsonArray<TemplateClause>(t.clausesJson))
    setSignatureFields(parseJsonArray<TemplateField>(t.signatureFieldsJson))
    setWarnings(parseJsonArray<string>(t.parseWarningsJson))
  }

  useEffect(() => { load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [templateId])

  async function createUpload() {
    if (!newDocumentId.trim()) return
    setBusy('create-upload')
    setError(null)
    try {
      const res = await fetch('/api/document-templates/uploads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId: newDocumentId.trim(), templateType: newTemplateType, name: newTemplateName.trim() || undefined }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Could not create template upload')
      setNewDocumentId('')
      setNewTemplateName('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create template upload')
    } finally {
      setBusy(null)
    }
  }

  async function analyzeUpload(uploadId: string) {
    setBusy(`analyze-${uploadId}`)
    setError(null)
    try {
      const res = await fetch(`/api/document-templates/uploads/${uploadId}/analyze`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Template analysis failed')
      await load()
      if (data.template?.id) router.push(`/templates/review/${data.template.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Template analysis failed')
    } finally {
      setBusy(null)
    }
  }

  async function saveReview() {
    if (!review?.template?.id) return
    setBusy('save')
    setError(null)
    try {
      const variables = [...new Set([
        ...fields.map(f => f.variable).filter(Boolean) as string[],
        ...signatureFields.map(f => f.variable).filter(Boolean) as string[],
      ])]
      const res = await fetch(`/api/document-templates/${review.template.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          type,
          bodyHtml,
          requiresSignature,
          fields,
          clauses,
          signatureFields,
          parseWarnings: warnings,
          variables,
          changeSummary: 'Saved from Template Review UI',
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Could not save template')
      await loadReview(review.template.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save template')
    } finally {
      setBusy(null)
    }
  }

  async function approveTemplate() {
    if (!review?.template?.id) return
    await saveReview()
    setBusy('approve')
    setError(null)
    try {
      const res = await fetch(`/api/document-templates/${review.template.id}/approve`, { method: 'POST' })
      if (!res.ok) throw new Error((await res.json()).error || 'Could not approve template')
      await loadReview(review.template.id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not approve template')
    } finally {
      setBusy(null)
    }
  }

  async function archiveTemplate() {
    if (!review?.template?.id) return
    setBusy('archive')
    setError(null)
    try {
      const res = await fetch(`/api/document-templates/${review.template.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'archived', reviewStatus: 'archived', changeSummary: 'Archived from Template Review UI' }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Could not archive template')
      await loadReview(review.template.id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not archive template')
    } finally {
      setBusy(null)
    }
  }

  function updateField(index: number, patch: Partial<TemplateField>) {
    setFields(prev => prev.map((field, i) => i === index ? { ...field, ...patch } : field))
  }
  function updateSignatureField(index: number, patch: Partial<TemplateField>) {
    setSignatureFields(prev => prev.map((field, i) => i === index ? { ...field, ...patch } : field))
  }
  function updateClause(index: number, patch: Partial<TemplateClause>) {
    setClauses(prev => prev.map((clause, i) => i === index ? { ...clause, ...patch } : clause))
  }

  if (loading) {
    return <div className="flex min-h-[60vh] items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading template review...</div>
  }

  if (templateId && review) {
    const templateStatus = review.template.reviewStatus || review.template.status
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-4 py-6 text-foreground sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 rounded-3xl border bg-card/70 p-5 shadow-sm lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <button className="text-sm text-muted-foreground hover:text-foreground" onClick={() => router.push('/templates')}>← Back to templates</button>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Review template</h1>
              <Badge variant="outline" className={cn('border', statusTone(templateStatus))}>{humanize(templateStatus)}</Badge>
              {review.template.importedFromUpload ? <Badge variant="secondary">Imported from contractor form</Badge> : null}
            </div>
            <p className="max-w-3xl text-sm text-muted-foreground">
              Verify Jobrolo preserved the contractor's language, mapped the right merge fields, detected signatures, and flagged anything a human should review before this is used with customers.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={saveReview} disabled={!!busy}><Save className="mr-2 h-4 w-4" /> Save</Button>
            <Button onClick={approveTemplate} disabled={!!busy || String(templateStatus).toLowerCase() === 'approved'}><CheckCircle2 className="mr-2 h-4 w-4" /> Approve</Button>
            <Button variant="outline" onClick={archiveTemplate} disabled={!!busy}><Archive className="mr-2 h-4 w-4" /> Archive</Button>
          </div>
        </div>

        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">{error}</div> : null}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Template identity</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label>Name</Label>
                  <Input value={name} onChange={e => setName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select value={type} onValueChange={setType}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{TEMPLATE_TYPES.map(t => <SelectItem key={t} value={t}>{humanize(t)}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Signature required?</Label>
                  <Select value={requiresSignature ? 'yes' : 'no'} onValueChange={v => setRequiresSignature(v === 'yes')}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="yes">Yes</SelectItem><SelectItem value="no">No</SelectItem></SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            <Tabs defaultValue="fields" className="space-y-4">
              <TabsList className="grid h-auto w-full grid-cols-2 sm:grid-cols-4">
                <TabsTrigger value="fields">Fields</TabsTrigger>
                <TabsTrigger value="clauses">Clauses</TabsTrigger>
                <TabsTrigger value="signatures">Signatures</TabsTrigger>
                <TabsTrigger value="body">Body HTML</TabsTrigger>
              </TabsList>

              <TabsContent value="fields" className="space-y-3">
                <ReviewSectionIntro title="Merge fields" body="Confirm fields map to the right customer, project, company, claim, estimate, or signer data before approval." />
                {fields.length ? fields.map((field, index) => (
                  <FieldEditor key={`${field.fieldKey}-${index}`} field={field} index={index} onChange={updateField} onRemove={() => setFields(prev => prev.filter((_, i) => i !== index))} />
                )) : <EmptyCard title="No fields detected" body="Add fields manually if this template needs customer, project, claim, or signer data." />}
                <Button variant="outline" onClick={() => setFields(prev => [...prev, { fieldKey: `field_${prev.length + 1}`, label: 'New Field', type: 'text', variable: '{{customer.name}}', required: false }])}>Add field</Button>
              </TabsContent>

              <TabsContent value="clauses" className="space-y-3">
                <ReviewSectionIntro title="Clauses" body="These are the important sections Jobrolo detected. Keep the contractor's actual language unless a human intentionally edits it." />
                {clauses.length ? clauses.map((clause, index) => (
                  <ClauseEditor key={`${clause.title || 'clause'}-${index}`} clause={clause} index={index} onChange={updateClause} onRemove={() => setClauses(prev => prev.filter((_, i) => i !== index))} />
                )) : <EmptyCard title="No clauses detected" body="This can happen if OCR was sparse. Review the body HTML and extracted text before approval." />}
                <Button variant="outline" onClick={() => setClauses(prev => [...prev, { title: 'New clause', body: '', clauseType: 'general', editable: true, required: false }])}>Add clause</Button>
              </TabsContent>

              <TabsContent value="signatures" className="space-y-3">
                <ReviewSectionIntro title="Signature fields" body="Confirm where customers, reps, or company representatives sign or initial before using this template with a real job." />
                {signatureFields.length ? signatureFields.map((field, index) => (
                  <FieldEditor key={`${field.fieldKey}-${index}`} field={field} index={index} onChange={updateSignatureField} onRemove={() => setSignatureFields(prev => prev.filter((_, i) => i !== index))} signature />
                )) : <EmptyCard title="No signature fields detected" body="Add signature/date fields if this document will be sent for signing." />}
                <Button variant="outline" onClick={() => setSignatureFields(prev => [...prev, { fieldKey: `signature_${prev.length + 1}`, label: 'Signer Signature', type: 'signature', variable: '{{signer.signature}}', required: true, mappedSource: 'signer' }])}>Add signature field</Button>
              </TabsContent>

              <TabsContent value="body" className="space-y-3">
                <ReviewSectionIntro title="Template body" body="This is the reusable HTML Jobrolo will merge with customer/project data. Preserve legal wording unless intentionally edited." />
                <Textarea value={bodyHtml} onChange={e => setBodyHtml(e.target.value)} className="min-h-[420px] font-mono text-xs" />
              </TabsContent>
            </Tabs>
          </div>

          <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
            <Card className="overflow-hidden">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-2 text-base"><Eye className="h-4 w-4" /> Preview</CardTitle>
                  <Button size="sm" variant="ghost" onClick={() => setPreviewOpen(v => !v)}>{previewOpen ? 'Hide' : 'Show'}</Button>
                </div>
              </CardHeader>
              {previewOpen ? <CardContent><div className="max-h-[620px] overflow-auto rounded-xl border bg-background p-4 text-sm leading-6" dangerouslySetInnerHTML={{ __html: sanitizeHtml(bodyHtml || '<p>No body yet.</p>') }} /></CardContent> : null}
            </Card>

            <WarningsCard warnings={warnings} onChange={setWarnings} />

            <Card>
              <CardHeader><CardTitle className="text-base">Source + versions</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <div><span className="font-medium text-foreground">Original:</span> {review.upload?.originalName || review.template.sourceOriginalName || 'Manual template'}</div>
                <div><span className="font-medium text-foreground">OCR confidence:</span> {review.upload?.extractionConfidence != null ? `${Math.round(review.upload.extractionConfidence * 100)}%` : 'unknown'}</div>
                <div className="space-y-1">
                  <div className="font-medium text-foreground">Recent snapshots</div>
                  {(review.versions || []).slice(0, 5).map(v => <div key={v.id} className="rounded-lg border p-2 text-xs">v{v.version} · {humanize(v.status)}<br />{v.changeSummary || 'Snapshot'}</div>)}
                </div>
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-4 py-6 text-foreground sm:px-6 lg:px-8">
      <section className="rounded-3xl border bg-card/80 p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-blue-600 dark:text-blue-300">Phase 5</p>
            <h1 className="text-3xl font-bold tracking-tight">Template Review UI</h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              Review contractor-uploaded agreements, estimate/proposal templates, warranties, and authorization forms before Jobrolo can use them for customer-facing documents.
            </p>
          </div>
          <Button variant="outline" onClick={() => router.push('/')}>Back to Jobrolo</Button>
        </div>
      </section>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">{error}</div> : null}

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" /> Create template upload from existing document</CardTitle></CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-[1fr_220px_1fr_auto]">
          <div className="space-y-2">
            <Label>Document ID</Label>
            <Input value={newDocumentId} onChange={e => setNewDocumentId(e.target.value)} placeholder="doc_... from uploaded PDF/agreement" />
          </div>
          <div className="space-y-2">
            <Label>Template type</Label>
            <Select value={newTemplateType} onValueChange={setNewTemplateType}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{TEMPLATE_TYPES.map(t => <SelectItem key={t} value={t}>{humanize(t)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Display name</Label>
            <Input value={newTemplateName} onChange={e => setNewTemplateName(e.target.value)} placeholder="Optional" />
          </div>
          <div className="flex items-end">
            <Button onClick={createUpload} disabled={busy === 'create-upload' || !newDocumentId.trim()} className="w-full lg:w-auto">
              {busy === 'create-upload' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />} Create
            </Button>
          </div>
        </CardContent>
        <CardFooter className="border-t text-xs text-muted-foreground">
          Upload the PDF through the normal chat/document flow first. This creates the review record from that private stored document.
        </CardFooter>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <TemplateList title="Needs review" templates={pendingTemplates} empty="No templates are waiting for review." onOpen={id => router.push(`/templates/review/${id}`)} />
        <TemplateList title="Approved templates" templates={approvedTemplates} empty="No approved imported templates yet." onOpen={id => router.push(`/templates/review/${id}`)} />
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Wand2 className="h-5 w-5" /> Template uploads</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {uploads.length ? uploads.map(upload => (
            <div key={upload.id} className="flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="truncate font-medium">{upload.name || upload.detectedTitle || upload.originalName}</div>
                  <Badge variant="outline" className={cn('border', statusTone(upload.status))}>{humanize(upload.status)}</Badge>
                  <Badge variant="secondary">{humanize(upload.detectedType || upload.templateType)}</Badge>
                </div>
                <div className="text-xs text-muted-foreground">{upload.originalName} · document {upload.documentId}</div>
                {upload.error ? <div className="text-xs text-rose-600">{upload.error}</div> : null}
              </div>
              <div className="flex gap-2">
                {upload.templateId ? <Button variant="outline" onClick={() => router.push(`/templates/review/${upload.templateId}`)}>Review</Button> : null}
                <Button disabled={!!busy || upload.status === 'processing'} onClick={() => analyzeUpload(upload.id)}>
                  {busy === `analyze-${upload.id}` ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />} Analyze
                </Button>
              </div>
            </div>
          )) : <EmptyCard title="No template uploads yet" body="Upload a contractor agreement/template PDF, then create a template upload from the document ID." />}
        </CardContent>
      </Card>
    </div>
  )
}

function TemplateList({ title, templates, empty, onOpen }: { title: string; templates: TemplateRecord[]; empty: string; onOpen: (id: string) => void }) {
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5" /> {title}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {templates.length ? templates.map(t => (
          <button key={t.id} onClick={() => onOpen(t.id)} className="w-full rounded-xl border p-3 text-left transition hover:border-blue-300 hover:bg-blue-50/50 dark:hover:border-blue-900 dark:hover:bg-blue-950/20">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{t.name}</span>
              <Badge variant="outline" className={cn('border', statusTone(t.reviewStatus || t.status))}>{humanize(t.reviewStatus || t.status)}</Badge>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{humanize(t.type)} {t.sourceOriginalName ? `· ${t.sourceOriginalName}` : ''}</div>
          </button>
        )) : <EmptyCard title={empty} body="When Jobrolo parses a contractor form, it will appear here for human approval." />}
      </CardContent>
    </Card>
  )
}

function ReviewSectionIntro({ title, body }: { title: string; body: string }) {
  return <div className="rounded-xl border bg-muted/30 p-3"><div className="font-medium">{title}</div><p className="mt-1 text-sm text-muted-foreground">{body}</p></div>
}

function EmptyCard({ title, body }: { title: string; body: string }) {
  return <div className="rounded-xl border border-dashed p-4 text-sm"><div className="font-medium">{title}</div><p className="mt-1 text-muted-foreground">{body}</p></div>
}

function FieldEditor({ field, index, onChange, onRemove, signature }: { field: TemplateField; index: number; onChange: (index: number, patch: Partial<TemplateField>) => void; onRemove: () => void; signature?: boolean }) {
  return (
    <Card>
      <CardContent className="grid gap-3 p-4 sm:grid-cols-2">
        <div className="space-y-2"><Label>Label</Label><Input value={field.label || ''} onChange={e => onChange(index, { label: e.target.value })} /></div>
        <div className="space-y-2"><Label>Field key</Label><Input value={field.fieldKey || ''} onChange={e => onChange(index, { fieldKey: e.target.value })} /></div>
        <div className="space-y-2"><Label>Type</Label><Input value={field.type || (signature ? 'signature' : 'text')} onChange={e => onChange(index, { type: e.target.value })} /></div>
        <div className="space-y-2"><Label>Variable</Label><VariableSelect value={field.variable || ''} onChange={variable => onChange(index, { variable })} /></div>
        <div className="space-y-2"><Label>Mapped source</Label><Input value={field.mappedSource || ''} onChange={e => onChange(index, { mappedSource: e.target.value })} placeholder="customer, project, claim, signer..." /></div>
        <div className="space-y-2"><Label>Required</Label><Select value={field.required ? 'yes' : 'no'} onValueChange={v => onChange(index, { required: v === 'yes' })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="yes">Yes</SelectItem><SelectItem value="no">No</SelectItem></SelectContent></Select></div>
        <div className="space-y-2 sm:col-span-2"><Label>Instructions</Label><Input value={field.instructions || ''} onChange={e => onChange(index, { instructions: e.target.value })} placeholder="Optional human note" /></div>
        <div className="sm:col-span-2"><Button variant="ghost" size="sm" onClick={onRemove}>Remove</Button></div>
      </CardContent>
    </Card>
  )
}

function ClauseEditor({ clause, index, onChange, onRemove }: { clause: TemplateClause; index: number; onChange: (index: number, patch: Partial<TemplateClause>) => void; onRemove: () => void }) {
  return (
    <Card>
      <CardContent className="grid gap-3 p-4 sm:grid-cols-2">
        <div className="space-y-2"><Label>Title</Label><Input value={clause.title || ''} onChange={e => onChange(index, { title: e.target.value })} /></div>
        <div className="space-y-2"><Label>Clause type</Label><Input value={clause.clauseType || 'general'} onChange={e => onChange(index, { clauseType: e.target.value })} /></div>
        <div className="space-y-2 sm:col-span-2"><Label>Clause body</Label><Textarea value={clause.body || ''} onChange={e => onChange(index, { body: e.target.value })} className="min-h-28" /></div>
        <div className="space-y-2 sm:col-span-2"><Label>AI notes</Label><Input value={clause.aiNotes || ''} onChange={e => onChange(index, { aiNotes: e.target.value })} /></div>
        <div className="sm:col-span-2"><Button variant="ghost" size="sm" onClick={onRemove}>Remove</Button></div>
      </CardContent>
    </Card>
  )
}

function VariableSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const known = COMMON_VARIABLES.includes(value)
  return (
    <div className="flex gap-2">
      <Select value={known ? value : 'custom'} onValueChange={v => onChange(v === 'custom' ? value : v)}>
        <SelectTrigger className="w-full"><SelectValue placeholder="Choose variable" /></SelectTrigger>
        <SelectContent>{COMMON_VARIABLES.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}<SelectItem value="custom">Custom / manual</SelectItem></SelectContent>
      </Select>
      {!known ? <Input value={value} onChange={e => onChange(e.target.value)} placeholder="{{custom.variable}}" className="min-w-44" /> : null}
    </div>
  )
}

function WarningsCard({ warnings, onChange }: { warnings: string[]; onChange: (warnings: string[]) => void }) {
  const [newWarning, setNewWarning] = useState('')
  return (
    <Card className="border-amber-200 bg-amber-50/40 dark:border-amber-900 dark:bg-amber-950/20">
      <CardHeader><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4" /> Human review warnings</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {warnings.length ? warnings.map((warning, index) => (
          <div key={`${warning}-${index}`} className="flex gap-2 rounded-lg border bg-background/70 p-2 text-xs"><span className="flex-1">{warning}</span><button className="text-muted-foreground hover:text-foreground" onClick={() => onChange(warnings.filter((_, i) => i !== index))}>Remove</button></div>
        )) : <p className="text-sm text-muted-foreground">No warnings yet.</p>}
        <div className="flex gap-2"><Input value={newWarning} onChange={e => setNewWarning(e.target.value)} placeholder="Add warning" /><Button variant="outline" onClick={() => { if (newWarning.trim()) { onChange([...warnings, newWarning.trim()]); setNewWarning('') } }}>Add</Button></div>
      </CardContent>
    </Card>
  )
}
