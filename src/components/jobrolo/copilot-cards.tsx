'use client'

import { useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Camera,
  Copy,
  ExternalLink,
  FileText,
  Globe2,
  MapPin,
  Home,
  Mail,
  MessageCircle,
  Package,
  Pencil,
  Phone,
  Radio,
  RefreshCw,
  Route,
  ShieldCheck,
  Sparkles,
  UserPlus,
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

type CreatedChatLike = {
  workspaceId?: string
  chatId?: string
  chatType?: string
  visibility?: string
  title?: string
  chatUrl?: string | null
  projectTitle?: string
  projectNumber?: string | null
  customer?: { name?: string | null; customerNumber?: string | null; clientNumber?: string | null } | null
  attachedTo?: { type?: string; title?: string; address?: string | null } | null
}

type CompanyProfileLike = {
  status?: string
  profile?: Record<string, unknown> | null
} & Record<string, unknown>

function insertJobroloPrompt(text: string) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('jobrolo:insert-prompt', { detail: { text } }))
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
  if (cardType.includes('field_inspection_lead')) {
    return <FieldInspectionLeadCard data={contextData as any} />
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
  if (cardType.includes('document_link_review')) {
    return <DocumentLinkReviewCard data={contextData as any} />
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
  if (cardType.includes('company_profile')) {
    return <CompanyProfileCard data={contextData as CompanyProfileLike} />
  }
  if (cardType.includes('created_chat')) {
    return <CreatedChatCard data={contextData as CreatedChatLike} />
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

export function CreatedChatCard({ data }: { data?: CreatedChatLike | null }) {
  const [copied, setCopied] = useState(false)
  const href = data?.chatUrl || (data?.workspaceId ? `/?workspaceId=${encodeURIComponent(data.workspaceId)}${data.chatId ? `&chatId=${encodeURIComponent(data.chatId)}` : ''}` : null)
  const chatType = humanize(String(data?.chatType || 'shared chat'))
  const customerName = data?.customer?.name
  const customerNumber = data?.customer?.customerNumber || data?.customer?.clientNumber

  function openChat() {
    if (data?.workspaceId) {
      window.dispatchEvent(new CustomEvent('jobrolo:open-workspace-chat', {
        detail: {
          workspaceId: data.workspaceId,
          chatId: data.chatId,
          href,
        },
      }))
      return
    }
    if (href) window.location.assign(href.startsWith('http') ? href : `${window.location.origin}${href}`)
  }

  async function copy() {
    if (!href) return
    const absolute = href.startsWith('http') ? href : `${window.location.origin}${href}`
    await navigator.clipboard?.writeText(absolute).catch(() => null)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  function invite() {
    const target = data?.projectTitle || data?.title || 'this chat'
    window.dispatchEvent(new CustomEvent('jobrolo:insert-prompt', {
      detail: {
        text: `Invite someone to ${target}. Ask me for their name, email, phone, and role, and give me a copyable invite link.`,
      },
    }))
  }

  return (
    <Card className="mt-2 w-full overflow-hidden border-blue-200 bg-blue-50/60 shadow-sm dark:border-blue-900/60 dark:bg-blue-950/20 sm:max-w-xl">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm text-blue-950 dark:text-blue-100">
            <MessageCircle className="h-4 w-4" /> {data?.title || `${chatType} created`}
          </CardTitle>
          <Badge variant="secondary" className="text-[10px]">{chatType}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="grid gap-1.5 text-xs text-muted-foreground sm:grid-cols-2">
          {data?.projectTitle ? <div><span className="font-medium text-foreground">Job:</span> {data.projectTitle}</div> : null}
          {data?.projectNumber ? <div><span className="font-medium text-foreground">Project #:</span> {data.projectNumber}</div> : null}
          {customerName ? <div><span className="font-medium text-foreground">Customer:</span> {customerName}{customerNumber ? ` (${customerNumber})` : ''}</div> : null}
          {data?.visibility ? <div><span className="font-medium text-foreground">Visibility:</span> {humanize(data.visibility)}</div> : null}
          {data?.attachedTo?.address ? <div className="sm:col-span-2"><span className="font-medium text-foreground">Address:</span> {data.attachedTo.address}</div> : null}
        </div>
        <p className="text-xs text-muted-foreground">
          This is saved in Shared chats. Use the link for existing members, or invite someone to create account access.
        </p>
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2 border-t bg-background/60 py-2">
        {href ? <Button size="sm" onClick={openChat}><ExternalLink className="mr-1.5 h-3.5 w-3.5" />Open chat</Button> : null}
        {href ? <Button size="sm" variant="outline" onClick={copy}>{copied ? <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}{copied ? 'Copied' : 'Copy link'}</Button> : null}
        <Button size="sm" variant="outline" onClick={invite}><UserPlus className="mr-1.5 h-3.5 w-3.5" />Invite person</Button>
      </CardFooter>
    </Card>
  )
}

export function CompanyProfileCard({ data }: { data?: CompanyProfileLike | null }) {
  const profile = ((data?.profile && typeof data.profile === 'object') ? data.profile : data) as Record<string, unknown> | null | undefined
  if (!profile) return null

  const name = textValue(profile.displayName) || textValue(profile.companyName) || textValue(profile.legalName) || 'Company profile'
  const legalName = textValue(profile.legalName)
  const website = textValue(profile.website)
  const phone = textValue(profile.phone)
  const email = textValue(profile.email)
  const address = textValue(profile.address)
  const licenseNumber = textValue(profile.licenseNumber)
  const ownerName = textValue(profile.ownerName)
  const contact = [textValue(profile.publicContactName), textValue(profile.publicContactTitle)].filter(Boolean).join(' · ')
  const missing = [
    !website ? 'website' : null,
    !phone ? 'phone' : null,
    !email ? 'email' : null,
    !address ? 'address' : null,
  ].filter(Boolean)

  function insertPrompt(text: string) {
    window.dispatchEvent(new CustomEvent('jobrolo:insert-prompt', { detail: { text } }))
  }

  return (
    <Card className="mt-2 w-full overflow-hidden border-blue-200 bg-blue-50/60 shadow-sm dark:border-blue-900/60 dark:bg-blue-950/20 sm:max-w-xl">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm text-blue-950 dark:text-blue-100">
            <Building2 className="h-4 w-4" /> {name}
          </CardTitle>
          <Badge variant="secondary" className="text-[10px]">{data?.status === 'updated' ? 'updated' : 'saved profile'}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="grid gap-2 text-xs sm:grid-cols-2">
          {legalName && legalName !== name ? <ProfileRow label="Legal name" value={legalName} /> : null}
          {phone ? <ProfileRow icon={<Phone className="h-3.5 w-3.5" />} label="Phone" value={phone} /> : null}
          {email ? <ProfileRow icon={<Mail className="h-3.5 w-3.5" />} label="Email" value={email} /> : null}
          {website ? <ProfileRow icon={<Globe2 className="h-3.5 w-3.5" />} label="Website" value={website} /> : null}
          {address ? <ProfileRow className="sm:col-span-2" icon={<MapPin className="h-3.5 w-3.5" />} label="Address" value={address} /> : null}
          {licenseNumber ? <ProfileRow label="License" value={licenseNumber} /> : null}
          {ownerName ? <ProfileRow label="Owner" value={ownerName} /> : null}
          {contact ? <ProfileRow label="Public contact" value={contact} /> : null}
        </div>
        {missing.length ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
            Missing basics: {missing.join(', ')}. You can update these from chat.
          </div>
        ) : null}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2 border-t bg-background/60 py-2">
        <Button size="sm" variant="outline" onClick={() => insertPrompt('Update my company profile: company name, phone, email, website, and address are ')}>
          <Pencil className="mr-1.5 h-3.5 w-3.5" />Edit from chat
        </Button>
        <Button size="sm" variant="outline" onClick={() => insertPrompt(`Research my company website and suggest updates to my company profile: ${website || ''}`.trim())}>
          <Globe2 className="mr-1.5 h-3.5 w-3.5" />Research website
        </Button>
      </CardFooter>
    </Card>
  )
}

function ProfileRow({ label, value, icon, className }: { label: string; value: string; icon?: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-lg border bg-background/70 p-2', className)}>
      <div className="mb-0.5 flex items-center gap-1.5 font-medium text-foreground">{icon}{label}</div>
      <div className="whitespace-pre-line break-words text-muted-foreground">{value}</div>
    </div>
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

export function DocumentLinkReviewCard({ data }: { data?: any }) {
  const detected = data?.detectedCustomer && typeof data.detectedCustomer === 'object' ? data.detectedCustomer : {}
  const candidates = Array.isArray(data?.candidateCustomers) ? data.candidateCustomers : []
  const documentId = data?.documentId ? String(data.documentId) : ''
  const documentName = data?.documentName || data?.name || 'this document'

  function insertPrompt(text: string) {
    window.dispatchEvent(new CustomEvent('jobrolo:insert-prompt', { detail: { text } }))
  }

  return (
    <Card className="mt-2 w-full overflow-hidden border-amber-200 bg-amber-50/70 shadow-sm dark:border-amber-900/60 dark:bg-amber-950/20 sm:max-w-xl">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <AlertTriangle className="h-4 w-4" /> Review before attaching
          </CardTitle>
          <Badge variant="outline" className="text-[10px]">human check</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-foreground/90">
          Jobrolo found possible customer info in <span className="font-medium">{String(documentName)}</span>, but it needs confirmation before changing a customer file.
        </p>
        <div className="rounded-lg border bg-background/70 p-2 text-xs text-muted-foreground">
          <div className="mb-1 font-semibold text-foreground">Detected in document</div>
          {detected.name ? <div><span className="font-medium text-foreground">Name:</span> {String(detected.name)}</div> : null}
          {detected.phone ? <div><span className="font-medium text-foreground">Phone:</span> {String(detected.phone)}</div> : null}
          {detected.email ? <div><span className="font-medium text-foreground">Email:</span> {String(detected.email)}</div> : null}
          {detected.address ? <div><span className="font-medium text-foreground">Address:</span> {String(detected.address)}</div> : null}
          {!detected.name && !detected.phone && !detected.email && !detected.address ? <div>No readable customer fields were extracted.</div> : null}
        </div>
        {candidates.length ? (
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Possible saved matches</div>
            {candidates.slice(0, 4).map((candidate: any) => {
              const name = String(candidate?.name || 'Saved customer')
              return (
                <div key={String(candidate?.id || name)} className="rounded-lg border bg-background/70 p-2 text-xs">
                  <div className="font-semibold text-foreground">{name}</div>
                  <div className="text-muted-foreground">
                    {candidate?.phone ? <span>{String(candidate.phone)} · </span> : null}
                    {candidate?.address ? <span>{String(candidate.address)}</span> : null}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-2 h-7 text-xs"
                    onClick={() => insertPrompt(`Attach ${documentName} (${documentId ? `documentId ${documentId}` : 'latest upload'}) to ${name}. If there is a phone or address conflict, ask me before changing saved customer info.`)}
                  >
                    Attach to {name}
                  </Button>
                </div>
              )
            })}
          </div>
        ) : null}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2 border-t bg-background/60 py-2">
        <Button
          size="sm"
          onClick={() => insertPrompt(`Create a project/job from ${documentName} (${documentId ? `documentId ${documentId}` : 'latest upload'}). Check for customer conflicts before linking.`)}
        >
          Create job from document
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => insertPrompt(`Leave ${documentName} (${documentId ? `documentId ${documentId}` : 'latest upload'}) unassigned for now.`)}
        >
          Leave unassigned
        </Button>
      </CardFooter>
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


export function FieldInspectionLeadCard({ data }: { data?: any }) {
  const leadId = data?.leadId || data?.lead?.id || data?.id
  const address = data?.address || data?.lead?.address || data?.propertyResearch?.card?.bestCandidate?.address || 'Current GPS location'
  const homeowner = data?.homeownerName || data?.lead?.homeownerName || data?.propertyResearch?.card?.bestCandidate?.ownerName
  const status = data?.status || data?.lead?.status || 'inspection_set'
  const researchCard = data?.propertyResearch?.card || data?.propertyResearch
  const best = researchCard?.bestCandidate || researchCard?.candidate || researchCard?.candidates?.[0]
  const researchSummary = data?.propertyResearch?.summary || researchCard?.summary
  const providerDisabled = String(researchSummary || '').toLowerCase().includes('not configured') || String(data?.propertyResearch?.error || '').toLowerCase().includes('not configured')
  const unverifiedGpsOnly = best && ['gps_unverified', 'manual_unverified'].includes(String(best.source || '').toLowerCase()) && !best.ownerName
  const photoSections = Array.isArray(data?.photoSections) && data.photoSections.length
    ? data.photoSections
    : ['Front elevation', 'All elevations', 'Roof overview', 'Roof slopes/facets', 'Damage closeups', 'Soft metals', 'Interior', 'Attic', 'Detached structures', 'Documents']

  const startPrompt = `Start the inspection workflow for this field lead${leadId ? ` (lead ID: ${leadId})` : ''}. Walk me through the photo sections one at a time: front elevation, all elevations, roof overview, roof slopes/facets, hail/wind damage, soft metals/gutters/vents, interior, attic, detached structures, and documents.`
  const researchPrompt = `Research the property for this field inspection lead${leadId ? ` (lead ID: ${leadId})` : ''} using the saved GPS/address. If public property research is not configured, tell me exactly what provider/API is missing.`
  const convertPrompt = `Convert this field inspection lead${leadId ? ` (lead ID: ${leadId})` : ''} into a customer and project only after confirming the owner/address details.`

  return (
    <Card className="mt-2 w-full overflow-hidden border-emerald-200 bg-emerald-50/50 shadow-sm dark:border-emerald-900/60 dark:bg-emerald-950/20 sm:max-w-xl">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Camera className="h-4 w-4" /> Inspection lead started
          </CardTitle>
          <Badge variant="secondary" className="text-[10px]">field</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="rounded-xl border bg-background/70 p-3">
          <div className="flex items-start gap-2">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <div className="min-w-0">
              <div className="font-semibold text-foreground">{address}</div>
              {homeowner ? <div className="text-xs text-muted-foreground">Possible homeowner: {homeowner}</div> : null}
              <div className="mt-1 text-xs text-muted-foreground">Saved as a field lead. Confirm the property/customer before converting it into a real customer or job.</div>
            </div>
          </div>
        </div>

        {best ? (
          <div className="rounded-xl border bg-background/70 p-3 text-xs">
            <div className="font-semibold text-foreground">Possible property match</div>
            <div className="mt-1 space-y-0.5 text-muted-foreground">
              {best.address ? <div>{best.address}</div> : null}
              {best.ownerName ? <div>Owner: {best.ownerName}</div> : null}
              {typeof best.confidence === 'number' ? <div>Confidence: {Math.round(best.confidence * 100)}%</div> : null}
              {best.reason ? <div>{best.reason}</div> : null}
              {best.sourceUrl ? <a className="mt-1 inline-flex text-emerald-700 underline underline-offset-2 dark:text-emerald-300" href={best.sourceUrl} target="_blank" rel="noreferrer">Open source</a> : null}
              {unverifiedGpsOnly ? <div className="mt-1 text-amber-700 dark:text-amber-300">GPS/address is saved, but public owner lookup still needs a property-data provider before Jobrolo can verify homeowner records automatically.</div> : null}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
            {providerDisabled
              ? 'Property lookup is not configured yet. GPS is saved, but Jobrolo needs a property-data/web-search provider before it can pull county owner records automatically.'
              : researchSummary || 'No confident property match yet. Confirm the address or add a property-data provider for owner lookup.'}
          </div>
        )}

        <div>
          <div className="mb-1.5 text-xs font-semibold text-muted-foreground">First inspection photo set</div>
          <div className="flex flex-wrap gap-1.5">
            {photoSections.slice(0, 12).map((section: string) => (
              <button
                key={section}
                type="button"
                onClick={() => insertJobroloPrompt(`Start the ${section.toLowerCase()} photo section for this inspection${leadId ? ` lead ${leadId}` : ''}. Tell me exactly what photos to capture and let me upload them in small batches.`)}
                className="rounded-full border border-emerald-200 bg-background/80 px-2.5 py-1 text-[11px] font-medium text-emerald-900 hover:bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-100"
              >
                {section}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline" className="text-[10px]">{humanize(String(status))}</Badge>
          {leadId ? <Badge variant="outline" className="text-[10px]">lead saved</Badge> : null}
          {researchCard?.runId ? <Badge variant="outline" className="text-[10px]">research run saved</Badge> : null}
        </div>
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2 border-t bg-background/60 py-2">
        <Button size="sm" onClick={() => insertJobroloPrompt(startPrompt)}>
          Start inspection
        </Button>
        <Button size="sm" variant="outline" onClick={() => insertJobroloPrompt(researchPrompt)}>
          Research property
        </Button>
        <Button size="sm" variant="outline" onClick={() => insertJobroloPrompt(convertPrompt)}>
          Create customer/job
        </Button>
      </CardFooter>
    </Card>
  )
}

export function CanvassingSessionCard({ data }: { data?: any }) {
  return (
    <Card className="mt-2 w-full overflow-hidden border-emerald-200 bg-emerald-50/50 shadow-sm dark:border-emerald-900/60 dark:bg-emerald-950/20 sm:max-w-xl">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm"><Route className="h-4 w-4" /> {data?.title || 'Field run active'}</CardTitle>
          <Badge variant="secondary" className="text-[10px]">field</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-muted-foreground">{data?.summary || data?.territoryName || 'Field run is active. Keep working from chat: log knocks, start inspections, save notes, and convert confirmed leads when ready.'}</p>
        <div className="flex flex-wrap gap-1.5">
          {data?.sessionId ? <Badge variant="outline" className="text-[10px]">session ready</Badge> : null}
          {data?.territoryName ? <Badge variant="outline" className="text-[10px]">{data.territoryName}</Badge> : null}
        </div>
      </CardContent>
      <CardFooter className="border-t bg-background/60 py-2">
        <Button size="sm" onClick={() => insertJobroloPrompt(`Keep this field run in chat${data?.sessionId ? ` (session ID: ${data.sessionId})` : ''}. Ask what I want to do next and offer: log a door, start inspection, research current property, add note, or end run.`)}>Continue in chat</Button>
        <Button size="sm" variant="outline" onClick={() => insertJobroloPrompt('Use my current location and start an inspection lead if I am at a house. Ask me to confirm owner/address before creating a customer or project.')}>Start inspection</Button>
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
          <CardTitle className="flex items-center gap-2 text-sm"><Home className="h-4 w-4" /> {data?.address || data?.homeownerName || 'Field lead'}</CardTitle>
          <Badge variant="outline" className="text-[10px]">{humanize(String(status))}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-muted-foreground">{data?.summary || data?.notes || 'A field lead was logged from chat.'}</p>
        <div className="flex flex-wrap gap-1.5">
          {data?.homeownerName ? <Badge variant="secondary" className="text-[10px]">{data.homeownerName}</Badge> : null}
          {data?.phone ? <Badge variant="outline" className="text-[10px]">{data.phone}</Badge> : null}
          {data?.projectId ? <Badge variant="secondary" className="text-[10px]">converted</Badge> : null}
        </div>
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2 border-t bg-background/60 py-2">
        <Button size="sm" onClick={() => insertJobroloPrompt(`Start an inspection workflow for this field lead${leadId ? ` (lead ID: ${leadId})` : ''}. Walk me through the photo sections and notes in chat.`)}>Start inspection</Button>
        {data?.projectId ? <Button size="sm" variant="outline" onClick={() => insertJobroloPrompt(`Open the job chat/thread for project ${data.projectId} and brief me on what to do next.`)}>Open job chat</Button> : null}
        {leadId && !data?.projectId ? <Button size="sm" variant="outline" onClick={() => insertJobroloPrompt(`Convert this field lead into a customer and project after confirming the owner/address details. Lead ID: ${leadId}`)}>Create customer/job</Button> : null}
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
        <Button size="sm" variant="outline" onClick={() => insertJobroloPrompt(`Use this property memory in the current field chat. Tell me what we know, what is missing, and what I should do next at ${address}.`)}>Use in field chat</Button>
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
          <CardTitle className="flex items-center gap-2 text-sm"><Sparkles className="h-4 w-4" /> {data?.title || 'Field game plan'}</CardTitle>
          <Badge variant="secondary" className="text-[10px]">field partner</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-foreground/90">{data?.strategySummary || 'A supportive field plan based on mindset, property memory, follow-ups, and nearby work history.'}</p>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-lg border bg-background/70 p-2"><div className="font-semibold">Doors</div><div className="text-muted-foreground">{goals?.doors ?? '—'}</div></div>
          <div className="rounded-lg border bg-background/70 p-2"><div className="font-semibold">Talks</div><div className="text-muted-foreground">{goals?.conversations ?? '—'}</div></div>
          <div className="rounded-lg border bg-background/70 p-2"><div className="font-semibold">Inspections</div><div className="text-muted-foreground">{goals?.inspections ?? '—'}</div></div>
        </div>
        {data?.recommendedStart ? <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Start:</span> {data.recommendedStart}</p> : null}
        {recs.length ? <div className="space-y-1 text-xs text-muted-foreground">{recs.slice(0, 3).map((r: any, i: number) => <div key={i}>• {r.label}: {r.count ?? 0}</div>)}</div> : null}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2 border-t bg-background/60 py-2">
        <Button size="sm" onClick={() => insertJobroloPrompt(`Start this field plan in chat${data?.gamePlanId ? ` (plan ID: ${data.gamePlanId})` : ''}. Give me the first three actions and help me log each result.`)}>Start in chat</Button>
        <Button size="sm" variant="outline" onClick={() => insertJobroloPrompt('Adjust this field plan. Ask whether I want fresh hail, follow-ups, higher-value roofs, easy conversations, old damage, or close-to-current-jobs.')}>Adjust focus</Button>
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
              {best.sourceUrl ? <a className="mt-1 inline-flex text-cyan-700 underline underline-offset-2 dark:text-cyan-300" href={best.sourceUrl} target="_blank" rel="noreferrer">Open source</a> : null}
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
        <Button size="sm" variant="outline" onClick={() => insertJobroloPrompt(`Use this property research in the field chat${data?.runId ? ` (research run ID: ${data.runId})` : ''}. Ask me to confirm if this is the correct house before saving or converting.`)}>Use in field chat</Button>
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
        <p className="text-foreground/90">{data?.summary || 'A supportive field plan based on street research, property memory, follow-ups, and your mindset for the day.'}</p>
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
        <Button size="sm" onClick={() => insertJobroloPrompt(`Start this street/field plan in chat${data?.streetRunId ? ` (street run ID: ${data.streetRunId})` : ''}. Give me the first action and let me log each door or inspection.`)}>Start in chat</Button>
        <Button size="sm" variant="outline" onClick={() => insertJobroloPrompt('Adjust this street field plan. Ask me what kind of run I want and update the focus without opening a separate map page.')}>Adjust focus</Button>
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

function textValue(value: unknown) {
  if (typeof value !== 'string') return ''
  return value.trim()
}

function humanize(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}
