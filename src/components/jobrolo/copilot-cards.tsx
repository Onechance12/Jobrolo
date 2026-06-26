'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Camera,
  FileText,
  MapPin,
  Home,
  Package,
  Radio,
  RefreshCw,
  Route,
  ShieldCheck,
  Sparkles,
  XCircle,
} from 'lucide-react'

export type QuickAction = { key: string; label: string; requiresInput?: boolean }

export type FieldBriefingLike = {
  mode?: string
  modeLabel?: string
  speakableText?: string
  topThings?: string[]
  warnings?: string[]
  missingItems?: string[]
  talkingPoints?: string[]
  quickActions?: QuickAction[]
  privacyNote?: string
  activeVisit?: { id?: string; status?: string } | null
  project?: { id?: string; title?: string; address?: string | null; customer?: { name?: string | null } | null } | null
}

type InboxLike = {
  id?: string
  type?: string
  title?: string
  summary?: string | null
  priority?: string
  status?: string
  role?: string
  projectId?: string | null
  actionRequestId?: string | null
  payloadJson?: string | null
  payload?: Record<string, unknown> | null
  createdAt?: string
}

type LocationLike = {
  resolutionId?: string
  confidence?: number
  confidenceLabel?: string
  reason?: string
  bestMatch?: { type?: string; id?: string; projectId?: string | null; customerId?: string | null; label?: string; reason?: string; distanceMeters?: number | null } | null
  candidates?: Array<{ type?: string; id?: string; projectId?: string | null; customerId?: string | null; label?: string; score?: number; reason?: string; distanceMeters?: number | null }>
  documentId?: string | null
}

type FieldEventLike = {
  action?: string
  mode?: string
  fieldVisitId?: string
  actionRequestId?: string
  decision?: string
  title?: string
  summary?: string
}

type RoofReportLike = {
  id?: string
  reportId?: string
  title?: string
  status?: string
  projectId?: string
  photoCount?: number
  readyScore?: number
  warnings?: string[]
  builderUrl?: string
  printUrl?: string
  shareUrl?: string | null
  pdfUrl?: string | null
}

type TemplateReviewLike = {
  templateId?: string
  id?: string
  name?: string
  type?: string
  reviewStatus?: string
  status?: string
  warnings?: string[]
  fieldCount?: number
  clauseCount?: number
  signatureFieldCount?: number
  sourceOriginalName?: string
  summary?: string
}

export function CopilotCardFromMessage({ contextType, contextData, content }: { contextType?: string | null; contextData?: Record<string, unknown> | null; content?: string }) {
  if (!contextType && !contextData) return null
  const cardType = String((contextData?.cardType || contextData?.type || contextType || '')).toLowerCase()
  if (!cardType) return null

  if (cardType.includes('field_briefing')) {
    return <FieldBriefingCard briefing={(contextData?.briefing as FieldBriefingLike) ?? (contextData as FieldBriefingLike)} compact />
  }
  if (cardType.includes('field_event')) {
    return <FieldEventCard event={contextData as FieldEventLike} fallbackContent={content} />
  }
  if (cardType.includes('location')) {
    return <LocationConfirmationCard location={contextData as LocationLike} />
  }
  if (cardType.includes('roof_report')) {
    return <RoofReportCard report={contextData as RoofReportLike} />
  }
  if (cardType.includes('template_review')) {
    return <TemplateReviewCard template={contextData as TemplateReviewLike} />
  }
  if (cardType.includes('canvassing_session')) {
    return <CanvassingSessionCard data={contextData as any} />
  }
  if (cardType.includes('canvassing_lead') || cardType.includes('canvassing_activity')) {
    return <CanvassingLeadCard data={contextData as any} />
  }
  if (cardType.includes('property_research')) {
    return <PropertyResearchCard data={contextData as any} />
  }
  if (cardType.includes('street_game_plan') || cardType.includes('street_research')) {
    return <StreetGamePlanCard data={contextData as any} />
  }
  if (cardType.includes('property_memory') || cardType.includes('property_observation') || cardType.includes('door_attempt')) {
    return <PropertyMemoryCard data={contextData as any} />
  }
  if (cardType.includes('canvassing_game_plan')) {
    return <CanvassingGamePlanCard data={contextData as any} />
  }
  if (cardType.includes('schedule_event')) {
    return <ScheduleEventCard data={contextData as any} />
  }
  if (cardType.includes('signature_request')) {
    return <SignatureRequestCard data={contextData as any} />
  }
  if (cardType.includes('signed_document') || cardType.includes('generated_document_pdf')) {
    return <DocumentPdfCard data={contextData as any} />
  }
  if (cardType.includes('document_review')) {
    return <DocumentReviewCard data={contextData as any} />
  }
  if (cardType.includes('radar_alert')) {
    return <RadarAlertCard data={contextData as any} />
  }
  if (cardType.includes('operator_briefing')) {
    return <OperatorBriefingCard data={contextData as any} content={content} />
  }
  if (cardType.includes('approval') || cardType.includes('action_request') || cardType.includes('material_request') || cardType.includes('issue_report') || cardType.includes('supplier_order')) {
    return <InboxActionCard item={contextData as InboxLike} />
  }
  return null
}

export function FieldBriefingCard({
  briefing,
  onRunAction,
  actionLoading,
  compact = false,
}: {
  briefing: FieldBriefingLike
  onRunAction?: (action: QuickAction) => void | Promise<void>
  actionLoading?: string | null
  compact?: boolean
}) {
  const topThings = briefing.topThings ?? []
  const warnings = briefing.warnings ?? []
  const missingItems = briefing.missingItems ?? []
  const talkingPoints = briefing.talkingPoints ?? []
  const quickActions = (briefing.quickActions ?? []).slice(0, compact ? 4 : 8)

  return (
    <Card className="mt-2 w-full overflow-hidden border-blue-200/70 bg-blue-50/40 shadow-sm dark:border-blue-900/60 dark:bg-blue-950/20 sm:max-w-xl">
      <CardHeader className={cn('pb-2', compact && 'py-3')}>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold text-blue-900 dark:text-blue-100">
            <Radio className="h-4 w-4" /> {briefing.modeLabel ?? 'Field Briefing'}
          </CardTitle>
          <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">field mode</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {topThings.length > 0 ? (
          <div className="space-y-1.5">
            {topThings.slice(0, 3).map((item, index) => (
              <div key={index} className="flex gap-2 text-foreground/90"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" /><span>{item}</span></div>
            ))}
          </div>
        ) : null}

        {(warnings.length > 0 || missingItems.length > 0) ? (
          <div className="flex flex-wrap gap-1.5">
            {warnings.slice(0, 4).map((item, index) => <Badge key={`w-${index}`} variant="destructive" className="text-[10px]">{item}</Badge>)}
            {missingItems.slice(0, 4).map((item, index) => <Badge key={`m-${index}`} variant="outline" className="text-[10px] border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{item}</Badge>)}
          </div>
        ) : null}

        {!compact && talkingPoints.length > 0 ? (
          <div className="rounded-lg border bg-background/70 p-3">
            <div className="mb-1.5 text-xs font-semibold text-muted-foreground">What to say / remember</div>
            <div className="space-y-1 text-xs text-muted-foreground">
              {talkingPoints.slice(0, 4).map((item, index) => <p key={index}>• {item}</p>)}
            </div>
          </div>
        ) : null}

        {quickActions.length > 0 ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {quickActions.map(action => (
              <Button key={action.key} size="sm" variant="secondary" disabled={!onRunAction || !!actionLoading} onClick={() => onRunAction?.(action)} className="justify-start truncate">
                {actionLoading === action.key ? <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                <span className="truncate">{action.label}</span>
              </Button>
            ))}
          </div>
        ) : null}
      </CardContent>
      {briefing.privacyNote && !compact ? <CardFooter className="border-t bg-background/60 py-2 text-xs text-muted-foreground">{briefing.privacyNote}</CardFooter> : null}
    </Card>
  )
}

export function FieldEventCard({ event, fallbackContent }: { event?: FieldEventLike | null; fallbackContent?: string }) {
  const label = humanize(String(event?.action || event?.decision || event?.mode || 'field update'))
  return (
    <Card className="mt-2 w-full overflow-hidden border-slate-200 bg-slate-50/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/40 sm:max-w-md">
      <CardContent className="flex items-start gap-3 p-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-200"><Route className="h-4 w-4" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-semibold">Field update</span>
            <Badge variant="outline" className="text-[10px]">{label}</Badge>
            {event?.mode ? <Badge variant="secondary" className="text-[10px]">{humanize(String(event.mode))}</Badge> : null}
          </div>
          <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{event?.summary || event?.title || fallbackContent || 'This field action was logged to the job timeline.'}</p>
        </div>
      </CardContent>
    </Card>
  )
}

export function LocationConfirmationCard({ location }: { location?: LocationLike | null }) {
  const [status, setStatus] = useState<'idle' | 'saving' | 'confirmed' | 'failed'>('idle')
  const best = location?.bestMatch ?? location?.candidates?.[0]
  const confidence = location?.confidenceLabel ?? (typeof location?.confidence === 'number' ? `${Math.round(location.confidence)}%` : 'unknown')

  async function confirm() {
    if (!location?.resolutionId || !best?.projectId) return
    setStatus('saving')
    try {
      const res = await fetch('/api/field-copilot/confirm-location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolutionId: location.resolutionId, projectId: best.projectId, customerId: best.customerId, documentId: location.documentId, attachDocument: !!location.documentId }),
      })
      setStatus(res.ok ? 'confirmed' : 'failed')
    } catch {
      setStatus('failed')
    }
  }

  return (
    <Card className="mt-2 w-full overflow-hidden border-cyan-200 bg-cyan-50/50 shadow-sm dark:border-cyan-900/60 dark:bg-cyan-950/20 sm:max-w-md">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm"><MapPin className="h-4 w-4 text-cyan-700 dark:text-cyan-300" /> Location match</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {best ? <p><span className="font-medium">Likely match:</span> {best.label ?? best.id}</p> : <p>No confident job/lead match found.</p>}
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="secondary">confidence: {String(confidence)}</Badge>
          {best?.distanceMeters != null ? <Badge variant="outline">{Math.round(Number(best.distanceMeters))}m away</Badge> : null}
        </div>
        {location?.reason || best?.reason ? <p className="text-xs text-muted-foreground">{location?.reason || best?.reason}</p> : null}
      </CardContent>
      <CardFooter className="flex gap-2 border-t bg-background/60 py-2">
        <Button size="sm" disabled={!location?.resolutionId || !best?.projectId || status === 'saving' || status === 'confirmed'} onClick={confirm}>
          {status === 'saving' ? <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}
          {status === 'confirmed' ? 'Attached' : 'Attach'}
        </Button>
        <Button size="sm" variant="outline" disabled>Choose different</Button>
      </CardFooter>
    </Card>
  )
}



export function ScheduleEventCard({ data }: { data?: any }) {
  const [status, setStatus] = useState<'idle' | 'logging' | 'logged' | 'failed'>('idle')
  const appointment = data?.appointment ?? data
  const project = data?.project
  const quickActions = Array.isArray(data?.quickActions) ? data.quickActions.slice(0, 4) : []
  const projectId = appointment?.projectId ?? project?.id
  const when = appointment?.startTime ? new Date(appointment.startTime).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null

  async function runAction(action: { key: string; label: string }) {
    if (!projectId) return
    setStatus('logging')
    try {
      const res = await fetch(`/api/projects/${projectId}/field-copilot/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: action.key, mode: appointment?.type || 'field', appointmentId: appointment?.id }),
      })
      setStatus(res.ok ? 'logged' : 'failed')
    } catch {
      setStatus('failed')
    }
  }

  return (
    <Card className="mt-2 w-full overflow-hidden border-blue-200 bg-blue-50/50 shadow-sm dark:border-blue-900/60 dark:bg-blue-950/20 sm:max-w-xl">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm"><ClipboardCheck className="h-4 w-4" /> {appointment?.title || 'Upcoming job action'}</CardTitle>
          {appointment?.type ? <Badge variant="outline" className="text-[10px]">{humanize(String(appointment.type))}</Badge> : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-muted-foreground">
          {when ? `Scheduled ${when}. ` : ''}{project?.title ? `Job: ${project.title}. ` : ''}{project?.address ? `Address: ${project.address}.` : ''}
        </p>
        {quickActions.length ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {quickActions.map((a: any) => <Button key={a.key} size="sm" variant="secondary" disabled={status === 'logging'} onClick={() => runAction(a)}>{a.label}</Button>)}
          </div>
        ) : null}
        {status === 'logged' ? <p className="text-xs text-blue-700 dark:text-blue-300">Logged to the job timeline.</p> : null}
        {status === 'failed' ? <p className="text-xs text-rose-600">Could not log that action.</p> : null}
      </CardContent>
    </Card>
  )
}

export function SignatureRequestCard({ data }: { data?: any }) {
  const token = data?.signatureToken
  return (
    <Card className="mt-2 w-full overflow-hidden border-emerald-200 bg-emerald-50/50 shadow-sm dark:border-emerald-900/60 dark:bg-emerald-950/20 sm:max-w-xl">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm"><FileText className="h-4 w-4" /> {data?.title || 'Signature needed'}</CardTitle>
          <Badge variant="outline" className="text-[10px]">{humanize(String(data?.status || 'pending'))}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-muted-foreground">Pending from {data?.signerName || 'signer'}{data?.signerEmail ? ` · ${data.signerEmail}` : ''}.</p>
      </CardContent>
      {token ? <CardFooter className="border-t bg-background/60 py-2"><Button size="sm" asChild><Link href={`/sign/${token}`}>Open signing</Link></Button></CardFooter> : null}
    </Card>
  )
}


export function DocumentPdfCard({ data }: { data?: any }) {
  const signed = String(data?.cardType || '').includes('signed') || !!data?.signedAt || data?.variant === 'signed'
  const title = data?.title || (signed ? 'Signed document saved' : 'PDF preview ready')
  const url = data?.pdfUrl || data?.signedPdfUrl || data?.unsignedPdfUrl
  return (
    <Card className={cn('mt-2 w-full overflow-hidden shadow-sm sm:max-w-xl', signed ? 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/60 dark:bg-emerald-950/20' : 'border-sky-200 bg-sky-50/50 dark:border-sky-900/60 dark:bg-sky-950/20')}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm"><FileText className="h-4 w-4" /> {title}</CardTitle>
          <Badge variant={signed ? 'secondary' : 'outline'} className="text-[10px]">{signed ? 'final signed pdf' : 'pdf preview'}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {signed ? (
          <p className="text-muted-foreground">Signed by {data?.signerName || 'the signer'}{data?.signedAt ? ` · ${new Date(String(data.signedAt)).toLocaleString()}` : ''}. Final copy was saved to the job packet.</p>
        ) : (
          <p className="text-muted-foreground">A PDF preview was generated and attached to the job packet.</p>
        )}
        {data?.pdfDocumentId ? <Badge variant="outline" className="text-[10px]">file saved</Badge> : null}
      </CardContent>
      {url ? (
        <CardFooter className="flex gap-2 border-t bg-background/60 py-2">
          <Button size="sm" asChild><Link href={String(url)} target="_blank">Preview PDF</Link></Button>
          <Button size="sm" variant="outline" asChild><Link href={String(url)} target="_blank">Download</Link></Button>
        </CardFooter>
      ) : null}
    </Card>
  )
}

export function DocumentReviewCard({ data }: { data?: any }) {
  const confidence = typeof data?.extractionConfidence === 'number' ? `${Math.round(data.extractionConfidence)}% confidence` : null
  return (
    <Card className="mt-2 w-full overflow-hidden border-amber-200 bg-amber-50/60 shadow-sm dark:border-amber-900/60 dark:bg-amber-950/20 sm:max-w-xl">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm"><AlertTriangle className="h-4 w-4" /> {data?.name || 'Document needs review'}</CardTitle>
          {data?.status ? <Badge variant="outline" className="text-[10px]">{humanize(String(data.status))}</Badge> : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-muted-foreground">Jobrolo wants human confirmation before relying on this document.</p>
        <div className="flex flex-wrap gap-1.5">
          {data?.fileType ? <Badge variant="secondary" className="text-[10px]">{humanize(String(data.fileType))}</Badge> : null}
          {confidence ? <Badge variant="outline" className="text-[10px]">{confidence}</Badge> : null}
        </div>
        {data?.aiSummary ? <div className="rounded-lg border bg-background/70 p-2 text-xs text-muted-foreground">{String(data.aiSummary).slice(0, 240)}</div> : null}
      </CardContent>
    </Card>
  )
}

export function RadarAlertCard({ data }: { data?: any }) {
  const actions = Array.isArray(data?.resolutionActions) ? data.resolutionActions : []
  return (
    <Card className="mt-2 w-full overflow-hidden border-rose-200 bg-rose-50/60 shadow-sm dark:border-rose-900/60 dark:bg-rose-950/20 sm:max-w-xl">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm"><AlertTriangle className="h-4 w-4" /> {data?.title || 'Radar alert'}</CardTitle>
          {data?.status ? <Badge variant="destructive" className="text-[10px]">{humanize(String(data.status))}</Badge> : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {data?.detail ? <p className="text-foreground/90">{data.detail}</p> : null}
        {data?.resolutionDetail ? <p className="text-xs italic text-muted-foreground">{data.resolutionDetail}</p> : null}
        {actions.length ? <div className="rounded-lg border bg-background/70 p-2 text-xs text-muted-foreground">{actions.slice(0, 4).map((a: string, i: number) => <div key={i}>→ {a}</div>)}</div> : null}
      </CardContent>
    </Card>
  )
}

export function OperatorBriefingCard({ data, content }: { data?: any; content?: string }) {
  return (
    <Card className="mt-2 w-full overflow-hidden border-slate-200 bg-slate-50/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/40 sm:max-w-xl">
      <CardContent className="flex items-start gap-3 p-3 text-sm">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-200"><Sparkles className="h-4 w-4" /></div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">Jobrolo operator brief</div>
          <p className="mt-1 text-muted-foreground">{content || data?.summary || 'Nothing urgent is routed to you right now.'}</p>
        </div>
      </CardContent>
    </Card>
  )
}


export function RoofReportCard({ report }: { report?: RoofReportLike | null }) {
  if (!report) return null
  const id = report.reportId || report.id
  const builderUrl = report.builderUrl || (id ? `/reports/${id}` : undefined)
  return (
    <Card className="mt-2 w-full overflow-hidden border-cyan-200 bg-cyan-50/50 shadow-sm dark:border-cyan-900/60 dark:bg-cyan-950/20 sm:max-w-xl">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm"><Camera className="h-4 w-4" /> {report.title || 'Roof report ready'}</CardTitle>
          <Badge variant="outline" className="text-[10px]">{humanize(String(report.status || 'draft'))}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-muted-foreground">{typeof report.photoCount === 'number' ? `${report.photoCount} photo${report.photoCount === 1 ? '' : 's'} attached. ` : ''}{typeof report.readyScore === 'number' ? `${report.readyScore}% ready. ` : ''}Review the report before sharing it with a customer.</p>
        {Array.isArray(report.warnings) && report.warnings.length ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
            {report.warnings.slice(0, 3).map((w, i) => <div key={i}>• {w}</div>)}
          </div>
        ) : null}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2 border-t bg-background/60 py-2">
        {builderUrl ? <Button size="sm" asChild><Link href={builderUrl}>Open builder</Link></Button> : null}
        {report.printUrl ? <Button size="sm" variant="outline" asChild><Link href={report.printUrl} target="_blank">Preview</Link></Button> : null}
        {report.shareUrl ? <Button size="sm" variant="outline" asChild><Link href={report.shareUrl} target="_blank">Share</Link></Button> : null}
        {report.pdfUrl ? <Button size="sm" variant="outline" asChild><Link href={report.pdfUrl} target="_blank">PDF</Link></Button> : null}
      </CardFooter>
    </Card>
  )
}

export function TemplateReviewCard({ template }: { template?: TemplateReviewLike | null }) {
  if (!template) return null
  const id = template.templateId || template.id
  const status = template.reviewStatus || template.status || 'needs_review'
  const warnings = template.warnings || []
  return (
    <Card className="mt-2 w-full overflow-hidden border-violet-200 bg-violet-50/50 shadow-sm dark:border-violet-900/60 dark:bg-violet-950/20 sm:max-w-xl">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm"><FileText className="h-4 w-4" /> {template.name || 'Template needs review'}</CardTitle>
          <Badge variant="outline" className="text-[10px]">{humanize(String(status))}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-muted-foreground">{template.summary || 'A contractor-uploaded template is ready for human review before it can be used for customer-facing documents.'}</p>
        <div className="flex flex-wrap gap-1.5">
          {template.type ? <Badge variant="secondary" className="text-[10px]">{humanize(template.type)}</Badge> : null}
          {template.fieldCount != null ? <Badge variant="outline" className="text-[10px]">{template.fieldCount} fields</Badge> : null}
          {template.clauseCount != null ? <Badge variant="outline" className="text-[10px]">{template.clauseCount} clauses</Badge> : null}
          {template.signatureFieldCount != null ? <Badge variant="outline" className="text-[10px]">{template.signatureFieldCount} signature fields</Badge> : null}
        </div>
        {warnings.length ? <div className="rounded-lg border bg-background/70 p-2 text-xs text-muted-foreground">{warnings.slice(0, 3).map((w, i) => <div key={i}>• {w}</div>)}</div> : null}
      </CardContent>
      {id ? <CardFooter className="border-t bg-background/60 py-2"><Button size="sm" asChild><Link href={`/templates/review/${id}`}>Review template</Link></Button></CardFooter> : null}
    </Card>
  )
}


export function CanvassingSessionCard({ data }: { data?: any }) {
  return (
    <Card className="mt-2 w-full overflow-hidden border-emerald-200 bg-emerald-50/50 shadow-sm dark:border-emerald-900/60 dark:bg-emerald-950/20 sm:max-w-xl">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm"><Route className="h-4 w-4" /> {data?.title || 'Canvassing session active'}</CardTitle>
          <Badge variant="secondary" className="text-[10px]">canvassing</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-muted-foreground">{data?.summary || data?.territoryName || 'Use map mode to create pins, log knocks, and convert interested homeowners into jobs.'}</p>
        <div className="flex flex-wrap gap-1.5">
          {data?.sessionId ? <Badge variant="outline" className="text-[10px]">session ready</Badge> : null}
          {data?.territoryName ? <Badge variant="outline" className="text-[10px]">{data.territoryName}</Badge> : null}
        </div>
      </CardContent>
      <CardFooter className="border-t bg-background/60 py-2">
        <Button size="sm" asChild><Link href="/canvassing">Open map mode</Link></Button>
      </CardFooter>
    </Card>
  )
}

export function CanvassingLeadCard({ data }: { data?: any }) {
  const leadId = data?.leadId || data?.id
  const status = data?.status || 'new'
  return (
    <Card className="mt-2 w-full overflow-hidden border-emerald-200 bg-emerald-50/50 shadow-sm dark:border-emerald-900/60 dark:bg-emerald-950/20 sm:max-w-xl">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm"><Home className="h-4 w-4" /> {data?.address || data?.homeownerName || 'Canvassing lead'}</CardTitle>
          <Badge variant="outline" className="text-[10px]">{humanize(String(status))}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-muted-foreground">{data?.summary || data?.notes || 'A canvassing lead was logged from the field.'}</p>
        <div className="flex flex-wrap gap-1.5">
          {data?.homeownerName ? <Badge variant="secondary" className="text-[10px]">{data.homeownerName}</Badge> : null}
          {data?.phone ? <Badge variant="outline" className="text-[10px]">{data.phone}</Badge> : null}
          {data?.projectId ? <Badge variant="secondary" className="text-[10px]">converted</Badge> : null}
        </div>
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2 border-t bg-background/60 py-2">
        <Button size="sm" asChild><Link href="/canvassing">Open map</Link></Button>
        {data?.projectId ? <Button size="sm" variant="outline" asChild><Link href="/">Open job thread</Link></Button> : null}
        {leadId && !data?.projectId ? <Button size="sm" variant="outline" asChild><Link href="/canvassing">Convert in map</Link></Button> : null}
      </CardFooter>
    </Card>
  )
}


export function PropertyMemoryCard({ data }: { data?: any }) {
  const score = data?.opportunityScore ?? data?.property?.opportunityScore
  const address = data?.address || data?.property?.address || 'Property memory'
  const roof = data?.roofCondition || data?.property?.roofCondition
  const damage = data?.damageSignal || data?.property?.damageSignal
  const status = data?.status || data?.property?.status || data?.outcome || 'watch'
  const solicitation = data?.solicitationStatus || data?.property?.solicitationStatus
  const occupancy = data?.occupancyStatus || data?.property?.occupancyStatus
  return (
    <Card className="mt-2 w-full overflow-hidden border-cyan-200 bg-cyan-50/50 shadow-sm dark:border-cyan-900/60 dark:bg-cyan-950/20 sm:max-w-xl">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm"><Home className="h-4 w-4" /> {address}</CardTitle>
          <Badge variant="outline" className="text-[10px]">{humanize(String(status))}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-muted-foreground">{data?.summary || data?.notes || data?.title || 'Jobrolo saved property history for this house without forcing it into the lead/customer pipeline.'}</p>
        <div className="flex flex-wrap gap-1.5">
          {typeof score === 'number' ? <Badge variant="secondary" className="text-[10px]">score {score}</Badge> : null}
          {roof ? <Badge variant="outline" className="text-[10px]">roof: {humanize(String(roof))}</Badge> : null}
          {damage ? <Badge variant="outline" className="text-[10px]">{humanize(String(damage))}</Badge> : null}
          {solicitation && solicitation !== 'ok' ? <Badge variant="destructive" className="text-[10px]">{humanize(String(solicitation))}</Badge> : null}
          {occupancy && occupancy !== 'unknown' ? <Badge variant="outline" className="text-[10px]">{humanize(String(occupancy))}</Badge> : null}
        </div>
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2 border-t bg-background/60 py-2">
        <Button size="sm" variant="outline" asChild><Link href="/canvassing">Open canvassing</Link></Button>
      </CardFooter>
    </Card>
  )
}

export function CanvassingGamePlanCard({ data }: { data?: any }) {
  const goals = data?.goals || { doors: data?.goalDoors, conversations: data?.goalConversations, inspections: data?.goalInspections }
  const recs = Array.isArray(data?.recommendations) ? data.recommendations : []
  return (
    <Card className="mt-2 w-full overflow-hidden border-purple-200 bg-purple-50/50 shadow-sm dark:border-purple-900/60 dark:bg-purple-950/20 sm:max-w-xl">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm"><Sparkles className="h-4 w-4" /> {data?.title || 'Canvassing game plan'}</CardTitle>
          <Badge variant="secondary" className="text-[10px]">partner mode</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-foreground/90">{data?.strategySummary || 'A supportive route plan based on mindset, property memory, follow-ups, and canvassing history.'}</p>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-lg border bg-background/70 p-2"><div className="font-semibold">Doors</div><div className="text-muted-foreground">{goals?.doors ?? '—'}</div></div>
          <div className="rounded-lg border bg-background/70 p-2"><div className="font-semibold">Talks</div><div className="text-muted-foreground">{goals?.conversations ?? '—'}</div></div>
          <div className="rounded-lg border bg-background/70 p-2"><div className="font-semibold">Inspections</div><div className="text-muted-foreground">{goals?.inspections ?? '—'}</div></div>
        </div>
        {data?.recommendedStart ? <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Start:</span> {data.recommendedStart}</p> : null}
        {recs.length ? <div className="space-y-1 text-xs text-muted-foreground">{recs.slice(0, 3).map((r: any, i: number) => <div key={i}>• {r.label}: {r.count ?? 0}</div>)}</div> : null}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2 border-t bg-background/60 py-2">
        <Button size="sm" asChild><Link href="/canvassing">Start run</Link></Button>
        <Button size="sm" variant="outline" asChild><Link href="/canvassing">Adjust plan</Link></Button>
      </CardFooter>
    </Card>
  )
}


export function PropertyResearchCard({ data }: { data?: any }) {
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const best = data?.bestCandidate || data?.candidate || data?.candidates?.[0]
  const candidates = Array.isArray(data?.candidates) ? data.candidates : []
  async function confirm() {
    if (!data?.runId) return
    setState('saving')
    try {
      const res = await fetch(`/api/property-research/${data.runId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateId: best?.id, createMemory: true, notes: data?.summary }),
      })
      setState(res.ok ? 'saved' : 'failed')
    } catch {
      setState('failed')
    }
  }
  return (
    <Card className="mt-2 w-full overflow-hidden border-cyan-200 bg-cyan-50/50 shadow-sm dark:border-cyan-900/60 dark:bg-cyan-950/20 sm:max-w-xl">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm"><MapPin className="h-4 w-4" /> Property research</CardTitle>
          <Badge variant="outline" className="text-[10px]">{humanize(String(data?.status || 'needs_confirmation'))}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">{data?.summary || 'Jobrolo researched this property and found possible matches. Confirm before saving to property memory.'}</p>
        {best ? (
          <div className="rounded-lg border bg-background/70 p-3 text-xs">
            <div className="font-semibold text-foreground">{best.address || 'Possible property match'}</div>
            <div className="mt-1 text-muted-foreground">
              {best.ownerName ? <div>Possible owner: {best.ownerName}</div> : null}
              {typeof best.score === 'number' ? <div>Opportunity score: {best.score}</div> : null}
              {typeof best.confidence === 'number' ? <div>Confidence: {Math.round(best.confidence * 100)}%</div> : null}
              {best.reason ? <div>Reason: {best.reason}</div> : null}
            </div>
          </div>
        ) : null}
        {candidates.length > 1 ? (
          <div className="space-y-1 text-xs text-muted-foreground">
            {candidates.slice(1, 4).map((c: any, i: number) => <div key={i}>• {c.address || c.id}{typeof c.score === 'number' ? ` · score ${c.score}` : ''}</div>)}
          </div>
        ) : null}
        {state === 'saved' ? <p className="text-xs text-blue-700 dark:text-blue-300">Saved to property memory.</p> : null}
        {state === 'failed' ? <p className="text-xs text-rose-600">Could not save this candidate.</p> : null}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2 border-t bg-background/60 py-2">
        <Button size="sm" disabled={!data?.runId || state === 'saving' || state === 'saved'} onClick={confirm}>
          {state === 'saving' ? <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}
          {state === 'saved' ? 'Saved' : 'Confirm & save'}
        </Button>
        <Button size="sm" variant="outline" asChild><Link href="/canvassing">Use in canvassing</Link></Button>
      </CardFooter>
    </Card>
  )
}

export function StreetGamePlanCard({ data }: { data?: any }) {
  const goals = data?.goals || {}
  const hot = Array.isArray(data?.hot) ? data.hot : []
  const followUps = Array.isArray(data?.followUps) ? data.followUps : []
  return (
    <Card className="mt-2 w-full overflow-hidden border-purple-200 bg-purple-50/50 shadow-sm dark:border-purple-900/60 dark:bg-purple-950/20 sm:max-w-xl">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm"><Sparkles className="h-4 w-4" /> {data?.title || 'Street game plan'}</CardTitle>
          <Badge variant="secondary" className="text-[10px]">partner plan</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-foreground/90">{data?.summary || 'A supportive canvassing plan based on street research, property memory, follow-ups, and your mindset for the day.'}</p>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-lg border bg-background/70 p-2"><div className="font-semibold">Doors</div><div className="text-muted-foreground">{goals.doors ?? '—'}</div></div>
          <div className="rounded-lg border bg-background/70 p-2"><div className="font-semibold">Talks</div><div className="text-muted-foreground">{goals.conversations ?? '—'}</div></div>
          <div className="rounded-lg border bg-background/70 p-2"><div className="font-semibold">Inspections</div><div className="text-muted-foreground">{goals.inspections ?? '—'}</div></div>
        </div>
        {data?.recommendedStart ? <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Recommended start:</span> {data.recommendedStart}</p> : null}
        {data?.avoidNotes ? <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Heads up:</span> {data.avoidNotes}</p> : null}
        {data?.scriptSuggestion ? <div className="rounded-lg border bg-background/70 p-2 text-xs text-muted-foreground"><span className="font-medium text-foreground">Opener:</span> {data.scriptSuggestion}</div> : null}
        {(hot.length || followUps.length) ? (
          <div className="grid gap-2 text-xs sm:grid-cols-2">
            {hot.length ? <div className="rounded-lg border bg-background/70 p-2"><div className="font-semibold text-foreground">Stronger candidates</div>{hot.slice(0, 3).map((c: any, i: number) => <div key={i} className="text-muted-foreground">• {c.address || c.id}{typeof c.score === 'number' ? ` · ${c.score}` : ''}</div>)}</div> : null}
            {followUps.length ? <div className="rounded-lg border bg-background/70 p-2"><div className="font-semibold text-foreground">Warm follow-ups</div>{followUps.slice(0, 3).map((c: any, i: number) => <div key={i} className="text-muted-foreground">• {c.address || c.id}</div>)}</div> : null}
          </div>
        ) : null}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2 border-t bg-background/60 py-2">
        <Button size="sm" asChild><Link href="/canvassing">Start run</Link></Button>
        <Button size="sm" variant="outline" asChild><Link href="/canvassing">Adjust focus</Link></Button>
      </CardFooter>
    </Card>
  )
}

export function InboxActionCard({ item, onChanged, className }: { item?: InboxLike | null; onChanged?: () => void; className?: string }) {
  const [decisionState, setDecisionState] = useState<'idle' | 'approving' | 'rejecting' | 'done' | 'failed'>('idle')
  const [decisionMessage, setDecisionMessage] = useState<string | null>(null)
  const payload = useMemo(() => parsePayload(item), [item])
  if (!item) return null
  const currentItem = item
  const type = String(currentItem.type ?? '').toLowerCase()
  const isMaterial = type.includes('material') || String(currentItem.title ?? '').toLowerCase().includes('material')
  const isApproval = !!currentItem.actionRequestId && !['actioned', 'archived', 'approved', 'rejected', 'completed', 'cancelled'].includes(String(item.status ?? '').toLowerCase())
  const Icon = isMaterial ? Package : type.includes('location') ? MapPin : type.includes('signature') ? FileText : type.includes('issue') ? AlertTriangle : ClipboardCheck
  const tone = isMaterial ? 'border-orange-200 bg-orange-50/60 dark:border-orange-900/60 dark:bg-orange-950/20' : 'border-blue-200 bg-blue-50/50 dark:border-blue-900/60 dark:bg-blue-950/20'

  async function decide(decision: 'approved' | 'rejected') {
    if (!currentItem.actionRequestId) return
    setDecisionState(decision === 'approved' ? 'approving' : 'rejecting')
    setDecisionMessage(null)
    try {
      const res = await fetch(`/api/action-requests/${currentItem.actionRequestId}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(String(data?.error || 'Decision failed'))
      const replay = data?.replayResult
      if (decision === 'rejected') {
        setDecisionMessage('Rejected. Jobrolo will not run this action.')
      } else if (replay && typeof replay === 'object') {
        if (replay.success) {
          const msg = replayMessage(replay)
          setDecisionMessage(msg ? `Approved and completed: ${msg}` : 'Approved and completed.')
        } else {
          setDecisionMessage(`Approved, but it did not complete: ${String(replay.error || 'the saved action failed to run')}`)
        }
      } else {
        setDecisionMessage('Decision logged. This request is waiting for its routed workflow.')
      }
      setDecisionState('done')
      onChanged?.()
    } catch (err) {
      setDecisionMessage(err instanceof Error ? err.message : 'Could not update this request. Try again.')
      setDecisionState('failed')
    }
  }

  return (
    <Card className={cn('w-full overflow-hidden shadow-sm sm:max-w-xl', tone, className)}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Icon className="h-4 w-4" /> {currentItem.title ?? humanize(type || 'Action needed')}
          </CardTitle>
          <div className="flex shrink-0 gap-1">
            {currentItem.priority ? <Badge variant={currentItem.priority === 'urgent' || currentItem.priority === 'high' ? 'destructive' : 'secondary'} className="text-[10px]">{currentItem.priority}</Badge> : null}
            {currentItem.role ? <Badge variant="outline" className="text-[10px]">{humanize(currentItem.role)}</Badge> : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {currentItem.summary ? <p className="text-foreground/90">{currentItem.summary}</p> : null}
        {payload ? <PayloadSummary payload={payload} /> : null}
        {decisionState === 'failed' ? <p className="text-xs text-rose-600">{decisionMessage || 'Could not update this request. Try again.'}</p> : null}
        {decisionState === 'done' ? <p className="flex items-center gap-1 text-xs text-blue-700 dark:text-blue-300"><ShieldCheck className="h-3.5 w-3.5" /> {decisionMessage || 'Decision logged.'}</p> : null}
      </CardContent>
      {isApproval ? (
        <CardFooter className="flex flex-wrap gap-2 border-t bg-background/60 py-2">
          <Button size="sm" disabled={decisionState === 'approving' || decisionState === 'rejecting' || decisionState === 'done'} onClick={() => decide('approved')}>
            {decisionState === 'approving' ? <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}
            Approve
          </Button>
          <Button size="sm" variant="outline" disabled={decisionState === 'approving' || decisionState === 'rejecting' || decisionState === 'done'} onClick={() => decide('rejected')}>
            {decisionState === 'rejecting' ? <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <XCircle className="mr-1.5 h-3.5 w-3.5" />}
            Reject
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  )
}

export function InboxStack({ items, onChanged }: { items: InboxLike[]; onChanged?: () => void }) {
  if (!items.length) return null
  return (
    <div className="mx-auto w-full max-w-3xl space-y-2 px-3 py-2 sm:px-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Sparkles className="h-3.5 w-3.5" /> Needs your attention</div>
      {items.map(item => <InboxActionCard key={String(item.id ?? item.actionRequestId ?? item.title ?? Math.random())} item={item} onChanged={onChanged} className="sm:max-w-none" />)}
    </div>
  )
}

function PayloadSummary({ payload }: { payload: Record<string, unknown> }) {
  const approvalRows = approvalRowsFromPayload(payload)
  const material = [payload.quantity, payload.materialName].filter(Boolean).join(' ')
  const note = typeof payload.note === 'string' ? payload.note : null
  const photoCount = Array.isArray(payload.photoDocumentIds) ? payload.photoDocumentIds.length : 0
  if (!approvalRows.length && !material && !note && !photoCount) return null
  return (
    <div className="rounded-lg border bg-background/70 p-2 text-xs text-muted-foreground">
      {approvalRows.length ? (
        <div className="space-y-1">
          <div className="font-semibold text-foreground">You’re approving:</div>
          {approvalRows.map((row, index) => (
            <div key={`${row.label}-${index}`}>
              {row.label ? <span className="font-medium text-foreground">{row.label}:</span> : null} {row.value}
            </div>
          ))}
        </div>
      ) : null}
      {material ? <div><span className="font-medium text-foreground">Material:</span> {material}</div> : null}
      {note ? <div><span className="font-medium text-foreground">Note:</span> {note}</div> : null}
      {photoCount ? <div><span className="font-medium text-foreground">Photos:</span> {photoCount} attached</div> : null}
    </div>
  )
}

function parsePayload(item?: InboxLike | null): Record<string, unknown> | null {
  if (!item) return null
  if (item.payload && typeof item.payload === 'object') return item.payload
  if (item.payloadJson) {
    try { return JSON.parse(item.payloadJson) as Record<string, unknown> } catch {}
  }
  const direct = item as Record<string, unknown>
  if (direct.approvalDetails || direct.toolName || direct.args || direct.actionRequestId) return direct
  return null
}

function replayMessage(replay: any): string | null {
  const data = replay?.data
  const nested = data?.replayResult?.data
  const candidates = [
    data?.message,
    nested?.message,
    data?.replayResult?.message,
    replay?.message,
  ]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  return null
}

function approvalRowsFromPayload(payload: Record<string, unknown>) {
  const approvalDetails = (payload.approvalDetails && typeof payload.approvalDetails === 'object')
    ? payload.approvalDetails as Record<string, any>
    : null
  const rows: Array<{ label: string; value: string }> = []

  if (approvalDetails?.targetLabel) {
    rows.push({ label: 'Target', value: String(approvalDetails.targetLabel) })
  }
  if (Array.isArray(approvalDetails?.details)) {
    for (const detail of approvalDetails.details.slice(0, 10)) {
      if (!detail || detail.value === null || typeof detail.value === 'undefined' || String(detail.value).trim() === '') continue
      rows.push({ label: String(detail.label || 'Detail'), value: String(detail.value) })
    }
  }
  if (rows.length) return dedupeRows(rows)

  const toolName = typeof payload.toolName === 'string' ? payload.toolName : null
  const args = payload.args && typeof payload.args === 'object' ? payload.args as Record<string, unknown> : payload
  if (toolName) rows.push({ label: 'Action', value: humanize(toolName) })

  const preferredKeys = ['customerName', 'customerId', 'documentId', 'nameFilter', 'filename', 'title', 'projectId', 'mode']
  for (const key of preferredKeys) {
    const value = args[key]
    if (value !== null && typeof value !== 'undefined' && String(value).trim() !== '') {
      rows.push({ label: humanize(key), value: String(value) })
    }
  }

  if (!rows.length && toolName) rows.push({ label: 'Tool', value: humanize(toolName) })
  return dedupeRows(rows).slice(0, 8)
}

function dedupeRows(rows: Array<{ label: string; value: string }>) {
  const seen = new Set<string>()
  return rows.filter(row => {
    const key = `${row.label}:${row.value}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function humanize(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}
