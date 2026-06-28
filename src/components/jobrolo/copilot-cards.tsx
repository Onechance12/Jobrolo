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
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Clock,
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

type CompanyIntelligenceLike = {
  status?: string
  searchMode?: string
  usageNote?: string
  analyticsNote?: string
  profile?: Record<string, unknown> | null
  profileReadiness?: { score?: number; missing?: string[] }
  kpis?: any
  publicPresence?: any
  recommendations?: Array<{ title?: string; detail?: string; prompt?: string; priority?: string }>
  profileSuggestions?: Record<string, unknown>
}

type CustomerFileDocumentLike = {
  id?: string
  originalName?: string
  fileType?: string
  status?: string
  mimeType?: string
  size?: number
  aiSummary?: string | null
  url?: string | null
  thumbnailUrl?: string | null
  customerId?: string | null
  projectId?: string | null
}

type CustomerFileLike = {
  customer?: {
    id?: string
    name?: string | null
    email?: string | null
    phone?: string | null
    address?: string | null
    customerNumber?: string | null
    clientNumber?: string | null
  } | null
  projects?: Array<{
    id?: string
    title?: string | null
    status?: string | null
    priority?: string | null
    address?: string | null
    projectNumber?: string | null
    customerProjectNumber?: string | null
  }>
  documents?: CustomerFileDocumentLike[]
  photos?: CustomerFileDocumentLike[]
  recentUnlinkedDocuments?: CustomerFileDocumentLike[]
  companyPricingCandidates?: CustomerFileDocumentLike[]
  notes?: Array<{ id?: string; content?: string; type?: string; createdAt?: string }>
  tasks?: Array<{ id?: string; title?: string; status?: string; priority?: string }>
  counts?: Record<string, number>
  guidance?: string
}

type ReportPhotoCandidateLike = {
  documentId?: string
  reportPhotoId?: string | null
  originalName?: string
  thumbnailUrl?: string | null
  url?: string | null
  summary?: string | null
  suggestedCategory?: string
  suggestedCategoryLabel?: string
  suggestedCondition?: string
  suggestedSeverity?: string
  caption?: string | null
  alreadyAttached?: boolean
  isIncluded?: boolean
  defaultSelected?: boolean
}

type ReportPhotoPickerLike = {
  reportId?: string | null
  projectId?: string | null
  customerId?: string | null
  title?: string
  query?: string | null
  totalFound?: number
  shownCount?: number
  selectedCount?: number
  alreadyAttachedCount?: number
  guidance?: string
  photos?: ReportPhotoCandidateLike[]
}

type ReportShareLike = {
  reportId?: string
  title?: string
  audience?: string
  audienceLabel?: string
  shareUrl?: string | null
  projectId?: string | null
  projectTitle?: string | null
  customer?: { name?: string | null; email?: string | null; phone?: string | null; customerNumber?: string | null; clientNumber?: string | null } | null
  propertyAddress?: string | null
  recommendedChatType?: string | null
  workspaceId?: string | null
  chatId?: string | null
  chatUrl?: string | null
  recipientName?: string | null
  recipientEmail?: string | null
  recipientPhone?: string | null
  note?: string | null
}

function insertJobroloPrompt(text: string) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('jobrolo:insert-prompt', { detail: { text } }))
}

function openInspectionPhotoIntake(section?: string | null) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('jobrolo:open-inspection-photo-intake', { detail: { section: section || null } }))
}

function openFieldMap() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event('jobrolo:open-field-map'))
}

function inspectionSectionId(label: string) {
  const value = String(label || '').toLowerCase()
  if (value.includes('front')) return 'front_elevation'
  if (value.includes('elevation')) return 'all_elevations'
  if (value.includes('roof') || value.includes('slope') || value.includes('facet')) return 'roof_overview'
  if (value.includes('hail') || value.includes('wind') || value.includes('damage')) return 'damage'
  if (value.includes('soft') || value.includes('metal') || value.includes('gutter') || value.includes('vent')) return 'soft_metals'
  if (value.includes('interior')) return 'interior'
  if (value.includes('attic')) return 'attic'
  if (value.includes('detached')) return 'detached'
  if (value.includes('document') || value.includes('scope') || value.includes('estimate')) return 'documents'
  return null
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
  if (cardType.includes('report_photo_picker')) {
    return <ReportPhotoPickerCard data={contextData as ReportPhotoPickerLike} />
  }
  if (cardType.includes('report_share')) {
    return <ReportShareCard data={contextData as ReportShareLike} />
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
  if (cardType.includes('canvassing_session') || cardType.includes('field_session')) {
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
  if (cardType.includes('schedule_calendar') || cardType.includes('calendar_overview')) {
    return <ScheduleCalendarCard data={contextData as any} />
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
  if (cardType.includes('customer_file')) {
    return <CustomerFileCard data={contextData as CustomerFileLike} />
  }
  if (cardType.includes('scope_breakdown')) {
    return <ScopeBreakdownCard data={contextData as any} />
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
  if (cardType.includes('company_research')) {
    return <CompanyResearchReviewCard data={contextData as any} />
  }
  if (cardType.includes('company_intelligence')) {
    return <CompanyIntelligenceCard data={contextData as CompanyIntelligenceLike} />
  }
  if (cardType.includes('company_profile')) {
    return <CompanyProfileCard data={contextData as CompanyProfileLike} />
  }
  if (cardType.includes('action_center')) {
    return <ActionCenterCard data={contextData as any} />
  }
  if (cardType.includes('created_chat')) {
    return <CreatedChatCard data={contextData as CreatedChatLike} />
  }
  if (cardType.includes('approval') || cardType.includes('action_request') || cardType.includes('material_request') || cardType.includes('issue_report') || cardType.includes('supplier_order')) {
    return <InboxActionCard item={contextData as InboxLike} />
  }
  return null
}

function CustomerFileCard({ data }: { data?: CustomerFileLike | null }) {
  if (!data?.customer) return null
  const customer = data.customer
  const projects = data.projects ?? []
  const photos = (data.photos ?? []).filter(doc => doc.fileType !== 'company_logo' && doc.fileType !== 'user_avatar')
  const documents = (data.documents ?? []).filter(doc => doc.fileType !== 'company_logo' && doc.fileType !== 'user_avatar')
  const pricing = data.companyPricingCandidates ?? []
  const notes = data.notes ?? []
  const customerLabel = textValue(customer.name) || 'Customer file'
  const customerNumber = textValue(customer.customerNumber || customer.clientNumber)
  const primaryProject = projects[0]
  const groupedPhotos = groupPhotosForCustomerFile(photos)

  return (
    <Card className="mt-2 w-full overflow-hidden border-blue-200 bg-blue-50/60 shadow-sm dark:border-blue-900/60 dark:bg-blue-950/20 sm:max-w-xl">
      <CardHeader className="border-b border-blue-200/70 bg-gradient-to-br from-blue-500/10 via-transparent to-cyan-500/10 pb-3 dark:border-blue-900/60">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="truncate text-base text-blue-950 dark:text-blue-100">{customerLabel}</CardTitle>
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
              {[textValue(customer.phone), textValue(customer.email), textValue(customer.address)].filter(Boolean).join(' · ') || 'Saved customer record'}
            </p>
          </div>
          {customerNumber ? <Badge variant="secondary" className="shrink-0 text-[10px]">ID {customerNumber}</Badge> : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="grid grid-cols-3 gap-2 text-xs">
          <MetricTile label="Jobs" value={String(projects.length)} />
          <MetricTile label="Photos" value={String(photos.length)} />
          <MetricTile label="Files" value={String(documents.length)} />
        </div>

        <section className="rounded-xl border bg-background/70 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Projects / jobs</div>
              <div className="text-[11px] text-muted-foreground">One customer can have multiple jobs, side work, or future projects.</div>
            </div>
            <Button size="sm" variant="outline" onClick={() => insertJobroloPrompt(`Create a new project/job for ${customerLabel}. Ask what this job is for, then use the next customer project number.`)}>
              Create job
            </Button>
          </div>
          {projects.length ? (
            <div className="space-y-2">
              {projects.slice(0, 4).map((project, index) => (
                <div key={project.id || index} className="rounded-lg border bg-background/70 p-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-foreground">{textValue(project.title) || `Project ${index + 1}`}</div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">{textValue(project.address) || textValue(customer.address) || 'No job address saved'}</div>
                    </div>
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      {textValue(project.customerProjectNumber) || textValue(project.projectNumber) || `Job ${index + 1}`}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No projects are saved yet. Create one before saving scopes, reports, crew chats, or job-specific photos.</p>
          )}
        </section>

        <section className="rounded-xl border bg-background/70 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Photos</div>
              <div className="text-[11px] text-muted-foreground">Grouped so you can review, edit context, or delete without knowing file names.</div>
            </div>
            <Button size="sm" variant="outline" onClick={() => insertJobroloPrompt(`Show photos for ${customerLabel} grouped by exterior, interior, roof, damage, documents, and other. Use saved database records only.`)}>
              Show all
            </Button>
          </div>
          {photos.length ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {groupedPhotos.map(group => (
                  <Button key={group.label} size="sm" variant="secondary" className="h-7 rounded-full px-2.5 text-xs" onClick={() => insertJobroloPrompt(`Show ${group.label.toLowerCase()} photos for ${customerLabel}. Let me select photos to remove, edit notes/context, or add to a report.`)}>
                    {group.label} · {group.items.length}
                  </Button>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {photos.slice(0, 9).map(photo => (
                  <CustomerPhotoTile key={photo.id || photo.url || photo.originalName} photo={photo} customerName={customerLabel} />
                ))}
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No job photos are attached to this customer/project yet.</p>
          )}
        </section>

        <section className="rounded-xl border bg-background/70 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Files</div>
              <div className="text-[11px] text-muted-foreground">Scopes, estimates, contracts, invoices, reports, and other job documents.</div>
            </div>
            <Button size="sm" variant="outline" onClick={() => insertJobroloPrompt(`Show files for ${customerLabel} as clickable cards grouped by document type. Use saved database records only.`)}>
              Open files
            </Button>
          </div>
          {documents.length ? (
            <div className="space-y-2">
              {documents.slice(0, 6).map(doc => <CustomerDocumentRow key={doc.id || doc.url || doc.originalName} doc={doc} customerName={customerLabel} />)}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No job files are attached yet.</p>
          )}
        </section>

        {pricing.length ? (
          <section className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-amber-950 dark:border-amber-900/70 dark:bg-amber-950/20 dark:text-amber-100">
            <div className="mb-2 flex items-start gap-2">
              <Package className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide">Company pricing candidates</div>
                <p className="mt-0.5 text-xs opacity-80">Price sheets belong in company pricing/material costs by default, not buried inside a customer file.</p>
              </div>
            </div>
            <div className="space-y-2">
              {pricing.slice(0, 4).map(doc => <CustomerDocumentRow key={doc.id || doc.url || doc.originalName} doc={doc} customerName={customerLabel} pricing />)}
            </div>
          </section>
        ) : null}

        {notes.length ? (
          <section className="rounded-xl border bg-background/70 p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recent notes</div>
            <div className="space-y-1.5">
              {notes.slice(0, 3).map(note => <p key={note.id || note.content} className="line-clamp-2 text-xs text-muted-foreground">{note.content}</p>)}
            </div>
          </section>
        ) : null}

        {data.guidance ? <p className="rounded-lg border bg-background/70 p-2 text-xs text-muted-foreground">{data.guidance}</p> : null}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2 border-t bg-background/60 py-2">
        <Button size="sm" onClick={() => insertJobroloPrompt(`Create a clean job packet summary for ${customerLabel}. Include customer info, projects, photos, files, price sheets that need company-pricing review, notes, and missing next steps.`)}>
          Job packet
        </Button>
        <Button size="sm" variant="outline" onClick={() => insertJobroloPrompt(primaryProject?.id ? `Create a roof/property report for ${customerLabel}'s project ${primaryProject.customerProjectNumber || primaryProject.projectNumber || primaryProject.title}. Let me choose which photos to include before finalizing.` : `Create a project for ${customerLabel}, then start a roof/property report.`)}>
          Property report
        </Button>
      </CardFooter>
    </Card>
  )
}

function groupPhotosForCustomerFile(photos: CustomerFileDocumentLike[]) {
  const groups = [
    { label: 'Exterior', test: /(exterior|elevation|front|side|back)/i },
    { label: 'Roof', test: /(roof|slope|facet|ridge|valley|shingle)/i },
    { label: 'Damage', test: /(damage|hail|wind|dent|crease|soft metal|gutter|vent)/i },
    { label: 'Interior', test: /(interior|ceiling|wall|drywall|room|leak)/i },
    { label: 'Documents', test: /(scope|estimate|invoice|contract|paper|document)/i },
  ]
  const used = new Set<CustomerFileDocumentLike>()
  const result = groups.map(group => {
    const items = photos.filter(photo => {
      const text = `${photo.originalName ?? ''} ${photo.fileType ?? ''} ${photo.aiSummary ?? ''}`.toLowerCase()
      const match = group.test.test(text)
      if (match) used.add(photo)
      return match
    })
    return { label: group.label, items }
  }).filter(group => group.items.length > 0)
  const other = photos.filter(photo => !used.has(photo))
  if (other.length) result.push({ label: 'Other', items: other })
  return result
}

function CustomerPhotoTile({ photo, customerName }: { photo: CustomerFileDocumentLike; customerName: string }) {
  const imageUrl = textValue(photo.thumbnailUrl) || textValue(photo.url)
  const name = textValue(photo.originalName) || 'Photo'
  const id = textValue(photo.id)
  return (
    <div className="group overflow-hidden rounded-lg border bg-background/70">
      <a href={textValue(photo.url) || imageUrl || '#'} target="_blank" rel="noopener noreferrer" className="block aspect-square bg-muted">
        {imageUrl ? <img src={imageUrl} alt={name} className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-muted-foreground"><Camera className="h-5 w-5" /></div>}
      </a>
      <div className="flex border-t">
        <button className="flex-1 px-1.5 py-1 text-[10px] text-muted-foreground hover:bg-muted" onClick={() => insertJobroloPrompt(`Edit notes/context for photo "${name}"${id ? ` (documentId: ${id})` : ''} in ${customerName}'s file: `)}>
          Edit
        </button>
        <button className="flex-1 border-l px-1.5 py-1 text-[10px] text-muted-foreground hover:bg-muted" onClick={() => insertJobroloPrompt(`Delete photo "${name}"${id ? ` (documentId: ${id})` : ''} from ${customerName}'s file. Tell me exactly what will be deleted and ask for approval before deleting.`)}>
          Delete
        </button>
      </div>
    </div>
  )
}

function CustomerDocumentRow({ doc, customerName, pricing = false }: { doc: CustomerFileDocumentLike; customerName: string; pricing?: boolean }) {
  const name = textValue(doc.originalName) || 'Saved file'
  const id = textValue(doc.id)
  const url = textValue(doc.url)
  const type = humanize(textValue(doc.fileType) || 'file')
  return (
    <div className="rounded-lg border bg-background/70 p-2">
      <div className="flex items-start gap-2">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-300">
          {pricing ? <Package className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground">{name}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            <span>{type}</span>
            {doc.status ? <span>· {doc.status}</span> : null}
          </div>
          {doc.aiSummary ? <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{doc.aiSummary}</p> : null}
        </div>
        {url ? (
          <a href={url} target="_blank" rel="noopener noreferrer" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <ExternalLink className="h-4 w-4" />
          </a>
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {pricing ? (
          <>
            <Button size="sm" variant="secondary" className="h-7 rounded-full px-2.5 text-xs" onClick={() => insertJobroloPrompt(`Review the first 10 material price rows from "${name}"${id ? ` (documentId: ${id})` : ''}. Tell me whether they are pending import or already saved.`)}>
              Review rows
            </Button>
            <Button size="sm" variant="outline" className="h-7 rounded-full px-2.5 text-xs" onClick={() => insertJobroloPrompt(`Move "${name}"${id ? ` (documentId: ${id})` : ''} to company pricing/material costs. Do not import rows until I confirm.`)}>
              Move to pricing
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="secondary" className="h-7 rounded-full px-2.5 text-xs" onClick={() => insertJobroloPrompt(`Open and summarize "${name}"${id ? ` (documentId: ${id})` : ''} from ${customerName}'s file.`)}>
              Review
            </Button>
            <Button size="sm" variant="outline" className="h-7 rounded-full px-2.5 text-xs" onClick={() => insertJobroloPrompt(`Edit notes/context for "${name}"${id ? ` (documentId: ${id})` : ''} in ${customerName}'s file: `)}>
              Edit
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

function money(value: unknown) {
  const num = typeof value === 'number' ? value : Number(value ?? 0)
  if (!Number.isFinite(num)) return '$0.00'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num)
}

function ScopeBreakdownCard({ data }: { data: any }) {
  const lineItems = Array.isArray(data.lineItems) ? data.lineItems : []
  const trades = Array.isArray(data.trades) ? data.trades : []
  const shownItems = lineItems.slice(0, 8)
  const customerName = textValue(data.customer?.name)
  const projectTitle = textValue(data.project?.title)
  const title = textValue(data.filename) || projectTitle || customerName || 'Scope breakdown'
  return (
    <Card className="mt-2 w-full overflow-hidden border-emerald-200 bg-emerald-50/50 shadow-sm dark:border-emerald-900/60 dark:bg-emerald-950/20 sm:max-w-xl">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-sm text-emerald-950 dark:text-emerald-100">
              <ClipboardCheck className="h-4 w-4 shrink-0" />
              <span className="min-w-0 truncate">Scope Breakdown</span>
            </CardTitle>
            <p className="mt-1 truncate text-xs text-muted-foreground">{title}</p>
          </div>
          <Badge variant="secondary" className="text-[10px]">{lineItems.length} items</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <MetricTile label="Selected RCV" value={money(data.selectedRcv)} />
          <MetricTile label="Deductible" value={money(data.deductible)} />
          <MetricTile label="Offset pool" value={money(data.offsetPoolTotal)} />
          <MetricTile label="Out of pocket" value={money(data.remainingOutOfPocket)} />
        </div>
        {trades.length ? (
          <div className="rounded-xl border bg-background/70 p-3">
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Trade breakdown</div>
            <div className="space-y-2">
              {trades.slice(0, 5).map((trade: any) => (
                <div key={String(trade.trade)} className="flex items-center justify-between gap-3 text-xs">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-foreground">{trade.trade || 'General'}</div>
                    <div className="text-muted-foreground">{trade.selectedCount ?? trade.itemCount ?? 0} included{trade.excludedCount ? ` · ${trade.excludedCount} excluded` : ''}</div>
                  </div>
                  <div className="shrink-0 font-semibold text-foreground">{money(trade.rcv)}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {shownItems.length ? (
          <div className="rounded-xl border bg-background/70 p-3">
            <div className="mb-2 flex items-center justify-between gap-2 text-xs">
              <span className="font-medium uppercase tracking-wide text-muted-foreground">Included line items</span>
              {lineItems.length > shownItems.length ? <span className="text-muted-foreground">Showing {shownItems.length} of {lineItems.length}</span> : null}
            </div>
            <div className="space-y-2">
              {shownItems.map((item: any, index: number) => (
                <div key={item.id ?? `${item.lineNumber}-${index}`} className="rounded-lg border bg-background/60 p-2 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-foreground">#{item.lineNumber ?? index + 1} {item.description || 'Line item'}</div>
                      <div className="mt-0.5 text-muted-foreground">{[item.quantity, item.unit, item.trade, item.category].filter(Boolean).join(' · ')}</div>
                    </div>
                    <div className="shrink-0 font-semibold text-foreground">{money(item.rcv ?? item.total)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2 border-t bg-background/60 py-2 text-xs text-muted-foreground">
        Ask “exclude line 4” or “what’s my deductible pool?” and I’ll update this from saved scope data.
      </CardFooter>
    </Card>
  )
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-background/70 p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-semibold text-foreground">{value}</div>
    </div>
  )
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
  const logoUrl = textValue(profile.logoUrl)
  const logoDocumentId = textValue(profile.logoDocumentId)
  const hasLogo = Boolean(logoUrl || logoDocumentId)
  const licenseNumber = textValue(profile.licenseNumber)
  const ownerName = textValue(profile.ownerName)
  const contact = [textValue(profile.publicContactName), textValue(profile.publicContactTitle)].filter(Boolean).join(' · ')
  const missing = [
    !website ? 'website' : null,
    !phone ? 'phone' : null,
    !email ? 'email' : null,
    !address ? 'address' : null,
    !hasLogo ? 'logo' : null,
  ].filter(Boolean)
  const setupActions = [
    !phone ? { label: 'Add phone', prompt: 'Update my company profile phone number to ' } : null,
    !email ? { label: 'Add email', prompt: 'Update my company profile email to ' } : null,
    !website ? { label: 'Research company', prompt: 'Research my company online and suggest missing company profile updates. Show what is new before saving.' } : null,
    !address ? { label: 'Add address', prompt: 'Update my company profile address to ' } : null,
    !hasLogo ? { label: 'Add logo', prompt: 'I want to add my company logo to my company profile for estimates, invoices, reports, contracts, and signatures.' } : null,
    !licenseNumber ? { label: 'Add license', prompt: 'Update my company profile license number to ' } : null,
    { label: 'Upload price list', prompt: 'I want to upload a material price list for company pricing. Keep it company-level, review extracted rows, and ask before importing.' },
    { label: 'Upload agreement', prompt: 'I want to upload my current agreement or contract so Jobrolo can help create a reusable document template.' },
  ].filter(Boolean) as Array<{ label: string; prompt: string }>

  function insertPrompt(text: string) {
    window.dispatchEvent(new CustomEvent('jobrolo:insert-prompt', { detail: { text } }))
  }

  return (
    <Card className="mt-2 w-full overflow-hidden border-blue-200 bg-blue-50/60 shadow-sm dark:border-blue-900/60 dark:bg-blue-950/20 sm:max-w-xl">
      <CardHeader className="border-b border-blue-200/70 bg-gradient-to-br from-blue-500/10 via-transparent to-cyan-500/10 pb-3 dark:border-blue-900/60">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {logoUrl ? (
              <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border bg-white p-2 shadow-sm">
                <img src={logoUrl} alt={`${name} logo`} className="max-h-full max-w-full object-contain" />
              </div>
            ) : (
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-blue-200 bg-blue-100 text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200">
                <Building2 className="h-6 w-6" />
              </div>
            )}
            <div className="min-w-0">
              <CardTitle className="truncate text-base text-blue-950 dark:text-blue-100">{name}</CardTitle>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                Company profile for estimates, invoices, reports, contracts, and signatures
              </p>
            </div>
          </div>
          <Badge variant="secondary" className="shrink-0 text-[10px]">{data?.status === 'updated' ? 'updated' : 'saved'}</Badge>
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
          <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/70 p-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
            <div>
              Missing document profile items: {missing.join(', ')}. These help estimates, invoices, reports, contracts, and signatures look complete.
            </div>
            <div className="flex flex-wrap gap-1.5">
              {setupActions.slice(0, 8).map(action => (
                <button
                  key={action.label}
                  type="button"
                  onClick={() => insertPrompt(action.prompt)}
                  className="rounded-full border border-amber-300/70 bg-amber-100/80 px-2.5 py-1 text-[11px] font-semibold text-amber-950 transition hover:bg-amber-200 dark:border-amber-700/70 dark:bg-amber-900/40 dark:text-amber-50 dark:hover:bg-amber-900/70"
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2 border-t bg-background/60 py-2">
        <Button size="sm" variant="outline" onClick={() => insertPrompt('Make edits to company profile: ')}>
          <Pencil className="mr-1.5 h-3.5 w-3.5" />Edit from chat
        </Button>
        <Button size="sm" variant="outline" onClick={() => insertPrompt(`Research my company online and suggest missing company profile updates. Show what is new before saving.${website ? ` Website: ${website}` : ''}`)}>
          <Globe2 className="mr-1.5 h-3.5 w-3.5" />Research
        </Button>
        {!hasLogo ? (
          <Button size="sm" variant="outline" onClick={() => insertPrompt('I want to add my company logo to my company profile for estimates, invoices, reports, contracts, and signatures.')}>
            Add logo
          </Button>
        ) : null}
      </CardFooter>
    </Card>
  )
}

export function CompanyResearchReviewCard({ data }: { data?: any }) {
  const [status, setStatus] = useState<'idle' | 'drafted' | 'hidden'>('idle')
  if (status === 'hidden') return null

  const research = data?.research ?? {}
  const suggested = data?.suggestedProfileUpdate ?? {}
  const existingProfile = data?.existingProfile ?? data?.profile ?? {}
  const webPresence = research?.webPresence ?? suggested?.metadata?.websiteResearch?.webPresence ?? {}
  const name = textValue(suggested.displayName) || textValue(suggested.companyName) || textValue(research.companyName) || 'Company research'
  const website = textValue(suggested.website) || textValue(research.website)
  const phone = textValue(suggested.phone) || textValue(research.phone)
  const email = textValue(suggested.email) || textValue(research.email)
  const logoUrl = textValue(suggested.logoUrl) || textValue(research.logoUrl) || textValue(webPresence.logoUrl)
  const description = textValue(research.description) || textValue(webPresence.summary)
  const services = Array.isArray(research.services) ? research.services.filter(Boolean).slice(0, 6) : []
  const serviceAreas = Array.isArray(research.serviceAreas) ? research.serviceAreas.filter(Boolean).slice(0, 5) : []
  const reviews = Array.isArray(webPresence.reviews) ? webPresence.reviews : []
  const googleReviews = webPresence.googleReviews || reviews.find((r: any) => /google/i.test(String(r?.source || r?.url || r?.notes || '')))
  const bbb = webPresence.bbb
  const sources = dedupeResearchSources([
    ...(Array.isArray(webPresence.sources) ? webPresence.sources : []),
    ...(Array.isArray(webPresence.mentions) ? webPresence.mentions : []),
    ...(Array.isArray(webPresence.directoryListings) ? webPresence.directoryListings : []),
    ...(Array.isArray(webPresence.backlinksOrBlogs) ? webPresence.backlinksOrBlogs : []),
  ].filter(Boolean))
  const changes = companyResearchChanges(existingProfile, { name, phone, email, website, location: textValue(research.location), logoUrl })

  function save() {
    const compact = {
      companyName: textValue(suggested.companyName) || name,
      displayName: textValue(suggested.displayName) || name,
      phone,
      email,
      website,
      location: textValue(research.location),
      logoUrl,
      services,
      serviceAreas,
    }
    insertJobroloPrompt(`Review and save these company profile updates from the latest research. Show me what will change before saving:\n${JSON.stringify(compact, null, 2)}`)
    setStatus('drafted')
  }

  function editInChat() {
    insertJobroloPrompt(`Update my company profile from the research, but apply these corrections: company name is ${name}. `)
  }

  return (
    <Card className="mt-2 w-full overflow-hidden border-blue-200 bg-blue-50/60 shadow-sm dark:border-blue-900/60 dark:bg-blue-950/20 sm:max-w-xl">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex min-w-0 items-center gap-2 text-sm text-blue-950 dark:text-blue-100">
            {logoUrl ? (
              <img src={logoUrl} alt={`${name} logo`} className="h-10 w-10 flex-shrink-0 rounded-xl border bg-white object-contain p-1" />
            ) : (
              <Building2 className="h-4 w-4 flex-shrink-0" />
            )}
            <span className="min-w-0 truncate">Review company research</span>
          </CardTitle>
          <Badge variant="secondary" className="text-[10px]">suggested</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div>
          <div className="font-semibold text-foreground">{name}</div>
          {description ? <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p> : null}
        </div>
        {changes.length ? (
          <div className="rounded-lg border border-blue-200 bg-background/70 p-2 text-xs dark:border-blue-900/60">
            <div className="mb-1 font-medium text-foreground">Suggested changes</div>
            <div className="space-y-1">
              {changes.map(change => (
                <div key={change.label} className="flex gap-2">
                  <span className="w-16 shrink-0 text-muted-foreground">{change.label}</span>
                  <span className="min-w-0 flex-1 text-foreground">{change.next}</span>
                  {change.previous ? <span className="hidden max-w-[120px] truncate text-muted-foreground sm:block">was {change.previous}</span> : <Badge variant="secondary" className="text-[10px]">new</Badge>}
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <div className="grid gap-2 text-xs sm:grid-cols-2">
          {phone ? <ProfileRow icon={<Phone className="h-3.5 w-3.5" />} label="Phone" value={phone} /> : null}
          {email ? <ProfileRow icon={<Mail className="h-3.5 w-3.5" />} label="Email" value={email} /> : null}
          {website ? <ProfileRow icon={<Globe2 className="h-3.5 w-3.5" />} label="Website" value={website} /> : null}
          {textValue(research.location) ? <ProfileRow icon={<MapPin className="h-3.5 w-3.5" />} label="Location" value={textValue(research.location)} /> : null}
        </div>
        {(googleReviews || bbb) ? (
          <div className="grid gap-2 text-xs sm:grid-cols-2">
            {googleReviews ? <ReviewSignal title="Google reviews" data={googleReviews} /> : null}
            {bbb ? <ReviewSignal title="BBB" data={bbb} /> : null}
          </div>
        ) : null}
        {services.length || serviceAreas.length ? (
          <div className="grid gap-2 text-xs sm:grid-cols-2">
            {services.length ? <TagBox title="Services" items={services} /> : null}
            {serviceAreas.length ? <TagBox title="Service areas" items={serviceAreas} /> : null}
          </div>
        ) : null}
        {sources.length ? <ResearchSourceList sources={sources} /> : null}
        <div className="rounded-lg border border-blue-200 bg-background/70 p-2 text-xs text-muted-foreground dark:border-blue-900/60">
          If something is wrong, just tell me in chat — for example: “phone is wrong, use…” or “don’t use that BBB link.” I’ll update the profile from your correction.
        </div>
        {status === 'drafted' ? <p className="text-xs text-blue-700 dark:text-blue-300">I drafted the save request in chat so you can review it before anything changes.</p> : null}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2 border-t bg-background/60 py-2">
        <Button size="sm" disabled={status === 'drafted'} onClick={save}>
          <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
          {status === 'drafted' ? 'Drafted' : 'Save updates'}
        </Button>
        <Button size="sm" variant="outline" onClick={editInChat}><Pencil className="mr-1.5 h-3.5 w-3.5" />Edit in chat</Button>
        <Button size="sm" variant="ghost" onClick={() => setStatus('hidden')}><XCircle className="mr-1.5 h-3.5 w-3.5" />Remove</Button>
      </CardFooter>
    </Card>
  )
}

export function CompanyIntelligenceCard({ data }: { data?: CompanyIntelligenceLike | null }) {
  if (!data) return null
  const profile = data.profile ?? {}
  const publicPresence = data.publicPresence ?? {}
  const kpis = data.kpis ?? {}
  const readiness = data.profileReadiness ?? {}
  const recommendations = Array.isArray(data.recommendations) ? data.recommendations : []
  const name = textValue(profile.displayName) || textValue(profile.companyName) || textValue(profile.legalName) || 'Company intelligence'
  const logoUrl = textValue(profile.logoUrl) || textValue(publicPresence.logoUrl)
  const missing = Array.isArray(readiness.missing) ? readiness.missing.filter(Boolean).slice(0, 6) : []
  const sources = dedupeResearchSources(Array.isArray(publicPresence.sources) ? publicPresence.sources : [])
  const socialSignals = Array.isArray(publicPresence.socialSignals) ? publicPresence.socialSignals.slice(0, 5) : []
  const contentSignals = Array.isArray(publicPresence.contentSignals) ? publicPresence.contentSignals.slice(0, 4) : []
  const googleReviews = publicPresence.googleReviews
  const bbb = publicPresence.bbb

  function prompt(text?: string) {
    if (text) insertJobroloPrompt(text)
  }

  return (
    <Card className="mt-2 w-full overflow-hidden border-cyan-200 bg-cyan-50/60 shadow-sm dark:border-cyan-900/60 dark:bg-cyan-950/20 sm:max-w-xl">
      <CardHeader className="border-b border-cyan-200/70 bg-gradient-to-br from-cyan-500/10 via-blue-500/5 to-violet-500/10 pb-3 dark:border-cyan-900/60">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {logoUrl ? (
              <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border bg-white p-2 shadow-sm">
                <img src={logoUrl} alt={`${name} logo`} className="max-h-full max-w-full object-contain" />
              </div>
            ) : (
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-cyan-200 bg-cyan-100 text-cyan-700 dark:border-cyan-900 dark:bg-cyan-950 dark:text-cyan-200">
                <Sparkles className="h-6 w-6" />
              </div>
            )}
            <div className="min-w-0">
              <CardTitle className="truncate text-base text-cyan-950 dark:text-cyan-100">{name}</CardTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">Company health · public presence · Jobrolo KPIs</p>
            </div>
          </div>
          <Badge variant="secondary" className="shrink-0 text-[10px]">{textValue(data.status) || 'snapshot'}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <KpiTile label="Profile ready" value={`${Number(readiness.score ?? 0)}%`} />
          <KpiTile label="Leads" value={String(kpis.leads?.thisPeriod ?? 0)} hint={`last ${kpis.periodDays ?? 7}d`} />
          <KpiTile label="Active jobs" value={String(kpis.projects?.active ?? 0)} />
          <KpiTile label="Needs attention" value={String((kpis.operations?.pendingActions ?? 0) + (kpis.operations?.failedOrReviewItems ?? 0))} />
        </div>

        {missing.length ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
            <div className="font-medium">Setup gaps</div>
            <div className="mt-1">Missing: {missing.join(', ')}.</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Button size="sm" variant="outline" className="h-7 rounded-full px-2.5 text-xs" onClick={() => prompt('Show my company profile setup gaps and give me chat prompts to fill each one.')}>Fix setup</Button>
              <Button size="sm" variant="outline" className="h-7 rounded-full px-2.5 text-xs" onClick={() => prompt('Research my company online and suggest missing company profile updates. Show what is new before saving.')}>Research</Button>
            </div>
          </div>
        ) : null}

        <div className="grid gap-2 sm:grid-cols-2">
          <SignalBox
            title="Internal Jobrolo KPIs"
            items={[
              `${kpis.leads?.thisPeriod ?? 0} new lead(s) this period`,
              `${kpis.customers?.addedThisPeriod ?? 0} customer(s) added`,
              `${kpis.appointments?.inspectionsUpcoming14Days ?? 0} inspection(s) scheduled soon`,
              `${kpis.files?.priceSheetsPendingReview ?? 0} price sheet(s) pending review`,
            ]}
          />
          <SignalBox
            title="Public web/social"
            items={[
              publicPresence.summary || (publicPresence.researched ? 'Public search completed.' : 'No fresh public research in this card yet.'),
              googleReviews?.found ? `Google reviews: ${[googleReviews.rating, googleReviews.reviewCount ? `${googleReviews.reviewCount} reviews` : null].filter(Boolean).join(' · ')}` : 'Google review details not verified',
              bbb?.found ? `BBB: ${[bbb.rating, bbb.notes].filter(Boolean).join(' · ')}` : 'BBB not verified',
            ]}
          />
        </div>

        {socialSignals.length ? (
          <div className="rounded-lg border bg-background/70 p-2 text-xs">
            <div className="mb-1 font-medium text-foreground">Social/content signals</div>
            <div className="space-y-1.5">
              {socialSignals.map((signal: any, index: number) => {
                const url = textValue(signal.url)
                const label = [textValue(signal.platform), textValue(signal.status)].filter(Boolean).join(' · ') || 'Social signal'
                const notes = textValue(signal.recentActivity) || textValue(signal.notes)
                return (
                  <a key={`${url || label}-${index}`} href={url || '#'} target={url ? '_blank' : undefined} rel="noreferrer" className="block rounded-md border bg-muted/30 p-2 hover:bg-muted/50">
                    <div className="flex items-center justify-between gap-2 font-medium text-foreground">
                      <span className="truncate">{label}</span>
                      {url ? <ExternalLink className="h-3.5 w-3.5 shrink-0 text-cyan-600 dark:text-cyan-300" /> : null}
                    </div>
                    {notes ? <div className="mt-0.5 line-clamp-2 text-muted-foreground">{notes}</div> : null}
                  </a>
                )
              })}
            </div>
          </div>
        ) : null}

        {contentSignals.length ? <TagBox title="Content opportunities" items={contentSignals.map((item: any) => textValue(item.title) || textValue(item.channel) || textValue(item.notes)).filter(Boolean)} /> : null}

        {recommendations.length ? (
          <div className="space-y-1.5 text-xs">
            <div className="font-medium text-foreground">Recommended next moves</div>
            {recommendations.map((item, index) => (
              <button key={`${item.title}-${index}`} type="button" onClick={() => prompt(item.prompt)} className="block w-full rounded-lg border bg-background/70 p-2 text-left transition hover:bg-muted/50">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-foreground">{item.title}</span>
                  <Badge variant={item.priority === 'high' ? 'destructive' : 'secondary'} className="text-[10px]">{item.priority || 'normal'}</Badge>
                </div>
                {item.detail ? <div className="mt-1 text-muted-foreground">{item.detail}</div> : null}
              </button>
            ))}
          </div>
        ) : null}

        {sources.length ? <ResearchSourceList sources={sources} /> : null}

        <div className="rounded-lg border border-cyan-200 bg-background/70 p-2 text-xs text-muted-foreground dark:border-cyan-900/60">
          {textValue(data.analyticsNote) || 'Traffic, attribution, ad performance, and exact private analytics require future integrations.'}
          {data.usageNote ? <div className="mt-1 font-medium text-foreground">{data.usageNote}</div> : null}
        </div>
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2 border-t bg-background/60 py-2">
        <Button size="sm" onClick={() => prompt('What should I do next to grow? Use my saved Jobrolo KPIs, public company research, and setup gaps.')}>
          <Sparkles className="mr-1.5 h-3.5 w-3.5" />Next moves
        </Button>
        <Button size="sm" variant="outline" onClick={() => prompt('Run a deep company research scan. Include website, Google-visible reviews, BBB, Facebook, Instagram, TikTok, YouTube, LinkedIn, directories, blogs, and mentions. Label public-search evidence clearly.')}>
          <Globe2 className="mr-1.5 h-3.5 w-3.5" />Research deeper
        </Button>
        <Button size="sm" variant="outline" onClick={() => prompt('How many leads did we get this week? Only use saved Jobrolo database records.')}>Show leads</Button>
        {data.profileSuggestions ? (
          <Button size="sm" variant="outline" onClick={() => prompt('Save the company profile updates from the latest company intelligence research, but show me exactly what will change first.')}>
            Save profile updates
          </Button>
        ) : null}
      </CardFooter>
    </Card>
  )
}

function KpiTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border bg-background/70 p-2">
      <div className="text-lg font-semibold leading-none text-foreground">{value}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">{label}{hint ? ` · ${hint}` : ''}</div>
    </div>
  )
}

function SignalBox({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border bg-background/70 p-2 text-xs">
      <div className="mb-1 font-medium text-foreground">{title}</div>
      <div className="space-y-1 text-muted-foreground">
        {items.filter(Boolean).slice(0, 5).map((item, index) => <div key={`${item}-${index}`}>{item}</div>)}
      </div>
    </div>
  )
}

function ReviewSignal({ title, data }: { title: string; data: any }) {
  const rating = textValue(data?.rating)
  const reviewCount = textValue(data?.reviewCount)
  const notes = textValue(data?.notes)
  const url = textValue(data?.url)
  return (
    <div className="rounded-lg border bg-background/70 p-2">
      <div className="mb-0.5 flex items-center justify-between gap-2 font-medium text-foreground">
        <span>{title}</span>
        {url ? <a href={url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline dark:text-blue-300"><ExternalLink className="h-3.5 w-3.5" /></a> : null}
      </div>
      <div className="text-muted-foreground">
        {[rating, reviewCount ? `${reviewCount} reviews` : null].filter(Boolean).join(' · ') || notes || 'Found in web research'}
      </div>
      {notes && (rating || reviewCount) ? <div className="mt-1 text-muted-foreground">{notes}</div> : null}
    </div>
  )
}

function TagBox({ title, items }: { title: string; items: unknown[] }) {
  return (
    <div className="rounded-lg border bg-background/70 p-2">
      <div className="mb-1 font-medium text-foreground">{title}</div>
      <div className="flex flex-wrap gap-1">
        {items.slice(0, 8).map((item, i) => <Badge key={`${String(item)}-${i}`} variant="secondary" className="text-[10px]">{String(item)}</Badge>)}
      </div>
    </div>
  )
}

function sourceLabel(source: any) {
  const title = textValue(source?.title)
  if (title && !/^(url|saved file)$/i.test(title)) return title
  const sourceName = textValue(source?.source)
  if (sourceName && !/^(url|saved file)$/i.test(sourceName)) return sourceName
  const url = textValue(source?.url)
  if (url) {
    try { return new URL(url).hostname.replace(/^www\./, '') } catch {}
  }
  return 'Web source'
}

function ResearchSourceList({ sources }: { sources: any[] }) {
  const items = dedupeResearchSources(sources).slice(0, 6)
  if (!items.length) return null
  return (
    <div className="space-y-1.5 text-xs">
      <div className="font-medium text-foreground">Source previews</div>
      {items.map((source, i) => {
        const url = textValue(source?.url)
        const notes = textValue(source?.notes) || textValue(source?.snippet)
        const label = sourceLabel(source)
        return (
          <a key={`${url || label}-${i}`} href={url || '#'} target={url ? '_blank' : undefined} rel="noreferrer" className="block rounded-lg border bg-background/70 p-2 transition hover:bg-muted/50">
            <div className="flex items-center gap-1.5 font-medium text-foreground">
              <ExternalLink className="h-3.5 w-3.5 flex-shrink-0 text-blue-600 dark:text-blue-300" />
              <span className="min-w-0 truncate">{label}</span>
            </div>
            {notes ? <div className="mt-1 line-clamp-2 text-muted-foreground">{notes}</div> : null}
            {url ? <div className="mt-1 truncate text-muted-foreground/70">{url}</div> : null}
          </a>
        )
      })}
    </div>
  )
}

function dedupeResearchSources(sources: any[]) {
  const seen = new Set<string>()
  return sources.filter(source => {
    const key = canonicalSourceKey(source)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function canonicalSourceKey(source: any) {
  const url = textValue(source?.url)
  if (url) {
    try {
      const parsed = new URL(url)
      for (const key of Array.from(parsed.searchParams.keys())) {
        if (/^(utm_|fbclid|gclid|msclkid)/i.test(key)) parsed.searchParams.delete(key)
      }
      parsed.hash = ''
      parsed.pathname = parsed.pathname.replace(/\/$/, '') || '/'
      return parsed.toString().toLowerCase()
    } catch {
      return url.replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase()
    }
  }
  return `${sourceLabel(source)}:${textValue(source?.notes) || textValue(source?.snippet)}`.toLowerCase()
}

function companyResearchChanges(existing: any, next: Record<string, string>) {
  const rows = [
    { label: 'Name', previous: textValue(existing?.displayName) || textValue(existing?.companyName), next: next.name },
    { label: 'Phone', previous: textValue(existing?.phone), next: next.phone },
    { label: 'Email', previous: textValue(existing?.email), next: next.email },
    { label: 'Website', previous: textValue(existing?.website), next: next.website },
    { label: 'Address', previous: [textValue(existing?.city), textValue(existing?.state)].filter(Boolean).join(', '), next: next.location },
    { label: 'Logo', previous: textValue(existing?.logoUrl), next: next.logoUrl },
  ]
  return rows
    .filter(row => row.next && normalizeComparable(row.previous) !== normalizeComparable(row.next))
    .slice(0, 6)
}

function normalizeComparable(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function ProfileRow({ label, value, icon, className }: { label: string; value: string; icon?: ReactNode; className?: string }) {
  const normalizedUrl = /^https?:\/\//i.test(value) ? value : /^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(value) ? `https://${value}` : null
  const href = label.toLowerCase().includes('website') && normalizedUrl
    ? normalizedUrl
    : label.toLowerCase().includes('email')
      ? `mailto:${value}`
      : label.toLowerCase().includes('phone')
        ? `tel:${value.replace(/[^\d+]/g, '')}`
        : null
  return (
    <div className={cn('rounded-lg border bg-background/70 p-2', className)}>
      <div className="mb-0.5 flex items-center gap-1.5 font-medium text-foreground">{icon}{label}</div>
      {href ? (
        <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel={href.startsWith('http') ? 'noopener noreferrer' : undefined} className="block break-words text-muted-foreground underline-offset-2 hover:text-blue-500 hover:underline">
          {value}
        </a>
      ) : (
        <div className="whitespace-pre-line break-words text-muted-foreground">{value}</div>
      )}
    </div>
  )
}

export function LocationConfirmationCard({ location }: { location?: LocationLike | null }) {
  const [status, setStatus] = useState<'idle' | 'drafted'>('idle')
  const best = location?.bestMatch ?? location?.candidates?.[0]
  const confidence = location?.confidenceLabel ?? (typeof location?.confidence === 'number' ? `${Math.round(location.confidence)}%` : 'unknown')

  function confirm() {
    if (!location?.resolutionId || !best?.projectId) return
    insertJobroloPrompt(
      `Confirm this location match and tell me what will be attached before saving. Resolution ID: ${location.resolutionId}. Project ID: ${best.projectId}. Customer ID: ${best.customerId || 'unknown'}. ${location.documentId ? `Uploaded document/photo ID: ${location.documentId}. Attach it if the match is correct.` : 'No uploaded document is attached to this location check.'}`,
    )
    setStatus('drafted')
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
        <Button size="sm" disabled={!location?.resolutionId || !best?.projectId || status === 'drafted'} onClick={confirm}>
          <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
          {status === 'drafted' ? 'Drafted in chat' : 'Attach in chat'}
        </Button>
        <Button size="sm" variant="outline" disabled>Choose different</Button>
      </CardFooter>
    </Card>
  )
}



export function ScheduleEventCard({ data }: { data?: any }) {
  const [status, setStatus] = useState<'idle' | 'drafted'>('idle')
  const appointment = data?.appointment ?? data
  const project = data?.project
  const quickActions = Array.isArray(data?.quickActions) ? data.quickActions.slice(0, 4) : []
  const projectId = appointment?.projectId ?? project?.id
  const when = appointment?.startTime ? new Date(appointment.startTime).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null

  function runAction(action: { key: string; label: string }) {
    if (!projectId) return
    insertJobroloPrompt(
      `Log "${action.label}" for this scheduled job/appointment in chat. Project ID: ${projectId}. Appointment ID: ${appointment?.id || 'unknown'}. Mode: ${appointment?.type || 'field'}. Ask for anything missing, then tell me what saved.`,
    )
    setStatus('drafted')
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
            {quickActions.map((a: any) => <Button key={a.key} size="sm" variant="secondary" onClick={() => runAction(a)}>{a.label}</Button>)}
          </div>
        ) : null}
        {status === 'drafted' ? <p className="text-xs text-blue-700 dark:text-blue-300">Drafted that job action in chat so you can review and send it.</p> : null}
      </CardContent>
    </Card>
  )
}

function dateLabelFromKey(dateKey: string) {
  const date = new Date(`${dateKey}T12:00:00`)
  if (Number.isNaN(date.getTime())) return dateKey
  return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

function shortTime(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function ScheduleCalendarCard({ data }: { data?: any }) {
  const monthLabel = String(data?.monthLabel || 'Calendar')
  const days = Array.isArray(data?.days) ? data.days : []
  const appointments = Array.isArray(data?.appointments) ? data.appointments : []
  const todayKey = new Date().toISOString().slice(0, 10)
  const selectedDay = data?.selectedDate ? String(data.selectedDate) : todayKey
  const selected = days.find((d: any) => String(d.date) === selectedDay) ?? days.find((d: any) => Number(d.count) > 0) ?? null
  const selectedAppointments = Array.isArray(selected?.appointments) ? selected.appointments : appointments.filter((a: any) => String(a.date) === String(selected?.date || selectedDay))

  const insertPrompt = (text: string) => {
    window.dispatchEvent(new CustomEvent('jobrolo:insert-prompt', { detail: { text } }))
  }

  return (
    <Card className="mt-2 w-full overflow-hidden border-cyan-200 bg-cyan-50/50 shadow-sm dark:border-cyan-900/60 dark:bg-cyan-950/20 sm:max-w-xl">
      <CardHeader className="border-b bg-gradient-to-br from-cyan-500/10 via-transparent to-blue-500/10 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="h-4 w-4 text-cyan-700 dark:text-cyan-300" />
              {monthLabel}
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {Number(data?.count || appointments.length)} scheduled item{Number(data?.count || appointments.length) === 1 ? '' : 's'}. Tap a day to ask Jobrolo about it.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => insertPrompt('Schedule an appointment. Ask me what day, time, customer/project, and who it is with.')}
          >
            Schedule
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-3">
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => <div key={`${day}-${index}`}>{day}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {days.map((day: any) => {
            const count = Number(day?.count || 0)
            const dateKey = String(day?.date || '')
            const inMonth = day?.inMonth !== false
            const isToday = dateKey === todayKey
            return (
              <button
                key={dateKey}
                type="button"
                onClick={() => insertPrompt(`What appointments do I have on ${dateLabelFromKey(dateKey)}? If I need to schedule one, ask me what time and who it is with.`)}
                className={cn(
                  'relative min-h-10 rounded-xl border p-1.5 text-left text-xs transition hover:border-cyan-300 hover:bg-cyan-500/10',
                  inMonth ? 'border-border bg-background/70 text-foreground' : 'border-transparent bg-transparent text-muted-foreground/45',
                  isToday ? 'ring-1 ring-cyan-400/60' : ''
                )}
              >
                <span className="font-semibold">{dateKey ? Number(dateKey.slice(-2)) : ''}</span>
                {count ? (
                  <span className="absolute bottom-1 right-1 rounded-full bg-cyan-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                    {count}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>

        <section className="rounded-xl border bg-background/70 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {selected ? dateLabelFromKey(String(selected.date)) : 'Today'}
              </div>
              <div className="text-[11px] text-muted-foreground">Quick view, not a separate calendar page.</div>
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => insertPrompt(`Schedule an appointment on ${selected ? dateLabelFromKey(String(selected.date)) : 'this day'}. Ask me what time and who it is with.`)}
            >
              Add
            </Button>
          </div>
          {selectedAppointments.length ? (
            <div className="space-y-2">
              {selectedAppointments.slice(0, 4).map((appt: any) => (
                <button
                  key={appt.id || `${appt.title}-${appt.startTime}`}
                  type="button"
                  onClick={() => insertPrompt(`Tell me about the appointment "${appt.title || 'appointment'}" on ${dateLabelFromKey(String(appt.date || selected?.date || selectedDay))}.`)}
                  className="flex w-full items-start gap-2 rounded-lg border bg-background/80 p-2 text-left hover:bg-muted/60"
                >
                  <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-700 dark:text-cyan-300" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{appt.title || 'Appointment'}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[shortTime(appt.startTime), appt.customerName, appt.projectTitle, appt.location].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing scheduled on this day yet.</p>
          )}
        </section>
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

function absoluteHref(value?: string | null) {
  if (!value) return null
  if (value.startsWith('http')) return value
  if (typeof window === 'undefined') return value
  return `${window.location.origin}${value.startsWith('/') ? value : `/${value}`}`
}

export function ReportPhotoPickerCard({ data }: { data?: ReportPhotoPickerLike | null }) {
  const photos = data?.photos || []
  const initialSelected = useMemo(() => new Set(photos.filter(p => p.defaultSelected || (p.alreadyAttached && p.isIncluded !== false)).map(p => String(p.documentId || p.reportPhotoId)).filter(Boolean)), [photos])
  const [selected, setSelected] = useState<Set<string>>(initialSelected)
  const [message, setMessage] = useState<string | null>(null)
  const reportId = data?.reportId || null

  function keyFor(photo: ReportPhotoCandidateLike) {
    return String(photo.documentId || photo.reportPhotoId || '')
  }

  function toggle(photo: ReportPhotoCandidateLike) {
    const key = keyFor(photo)
    if (!key) return
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function saveSelection() {
    if (!reportId) {
      insertJobroloPrompt('Create or choose a roof report first, then help me add these selected photos to it.')
      return
    }
    const selectedPhotos = photos
      .filter(p => selected.has(keyFor(p)))
      .map((p, i) => ({
        documentId: p.documentId,
        reportPhotoId: p.reportPhotoId,
        category: p.suggestedCategory || 'other',
        condition: p.suggestedCondition || 'other',
        severity: p.suggestedSeverity || 'informational',
        caption: p.caption || p.summary || p.originalName,
        sortOrder: i,
      }))
    insertJobroloPrompt(
      `Update roof report ${reportId} with this photo selection. Include the selected photos below. Exclude unselected photos from the report only; do not delete them from the job file. Confirm what changed after saving:\n${JSON.stringify(selectedPhotos, null, 2)}`,
    )
    setMessage('Drafted the report photo update in chat. Review it, add notes if needed, then send it.')
  }

  const selectedCount = photos.filter(p => selected.has(keyFor(p))).length
  return (
    <Card className="mt-2 w-full overflow-hidden border-emerald-200 bg-emerald-50/50 shadow-sm dark:border-emerald-900/60 dark:bg-emerald-950/20 sm:max-w-xl">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm"><Camera className="h-4 w-4" /> {data?.title || 'Choose report photos'}</CardTitle>
          <Badge variant="secondary" className="text-[10px]">{selectedCount} selected</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">{data?.guidance || 'Select the photos that belong in this report. Removing one here does not delete the original file.'}</p>
        <div className="flex flex-wrap gap-1.5">
          {typeof data?.totalFound === 'number' ? <Badge variant="outline" className="text-[10px]">{data.totalFound} saved photos found</Badge> : null}
          {typeof data?.alreadyAttachedCount === 'number' ? <Badge variant="outline" className="text-[10px]">{data.alreadyAttachedCount} already attached</Badge> : null}
          {data?.query ? <Badge variant="secondary" className="text-[10px]">matching: {data.query}</Badge> : null}
        </div>
        {photos.length ? (
          <div className="grid max-h-96 grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
            {photos.map(photo => {
              const key = keyFor(photo)
              const isSelected = selected.has(key)
              const thumb = absoluteHref(photo.thumbnailUrl || photo.url)
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggle(photo)}
                  className={cn(
                    'overflow-hidden rounded-xl border bg-background text-left transition',
                    isSelected ? 'border-emerald-400 ring-2 ring-emerald-400/40' : 'border-border hover:border-emerald-300',
                  )}
                >
                  <div className="relative aspect-[4/3] bg-muted">
                    {thumb ? <img src={thumb} alt={photo.originalName || 'Report photo'} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-muted-foreground"><Camera className="h-6 w-6" /></div>}
                    <span className={cn('absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-semibold', isSelected ? 'bg-emerald-500 text-white' : 'bg-background/90 text-muted-foreground')}>
                      {isSelected ? 'Included' : 'Excluded'}
                    </span>
                  </div>
                  <div className="space-y-1 p-2">
                    <div className="line-clamp-1 text-xs font-semibold">{photo.originalName || 'Saved photo'}</div>
                    <div className="flex flex-wrap gap-1">
                      {photo.suggestedCategoryLabel ? <Badge variant="secondary" className="text-[9px]">{photo.suggestedCategoryLabel}</Badge> : null}
                      {photo.suggestedCondition ? <Badge variant="outline" className="text-[9px]">{humanize(photo.suggestedCondition)}</Badge> : null}
                    </div>
                    {photo.summary ? <p className="line-clamp-2 text-[10px] text-muted-foreground">{photo.summary}</p> : null}
                  </div>
                </button>
              )
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed bg-background/70 p-4 text-center text-xs text-muted-foreground">
            No saved photos matched yet. Upload roof/gutter/interior photos in this job thread, then ask me to review report photos again.
          </div>
        )}
        {message ? <div className="rounded-lg border bg-background/80 p-2 text-xs text-muted-foreground">{message}</div> : null}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2 border-t bg-background/60 py-2">
        <Button size="sm" onClick={saveSelection} disabled={!photos.length}>Save selection in chat</Button>
        <Button size="sm" variant="outline" onClick={() => insertJobroloPrompt(`${reportId ? `For roof report ${reportId}, ` : ''}help me choose the best report photos. I want roof/gutter/hail/wind markings and only strong customer-facing photos.`)}>Ask Jobrolo</Button>
        <Button size="sm" variant="outline" onClick={() => insertJobroloPrompt(`${reportId ? `Share roof report ${reportId}. ` : 'Share this roof report. '}Ask who it should go to: homeowner, crew/subcontractor, referral partner/realtor, insurance agent/adjuster, or internal team.`)}>Route/share</Button>
      </CardFooter>
    </Card>
  )
}

export function ReportShareCard({ data }: { data?: ReportShareLike | null }) {
  const [copied, setCopied] = useState(false)
  const shareUrl = absoluteHref(data?.shareUrl)
  const chatUrl = absoluteHref(data?.chatUrl)

  async function copyShare() {
    if (!shareUrl) return
    await navigator.clipboard?.writeText(shareUrl).catch(() => null)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  function openChat() {
    if (data?.workspaceId) {
      window.dispatchEvent(new CustomEvent('jobrolo:open-workspace-chat', {
        detail: { workspaceId: data.workspaceId, chatId: data.chatId, href: chatUrl },
      }))
      return
    }
    if (chatUrl) window.location.assign(chatUrl)
  }

  const target = data?.audienceLabel || humanize(String(data?.audience || 'recipient'))
  return (
    <Card className="mt-2 w-full overflow-hidden border-blue-200 bg-blue-50/60 shadow-sm dark:border-blue-900/60 dark:bg-blue-950/20 sm:max-w-xl">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm"><MessageCircle className="h-4 w-4" /> Share report</CardTitle>
          <Badge variant="secondary" className="text-[10px]">{target}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="font-semibold">{data?.title || 'Roof report'}</div>
        <div className="grid gap-1.5 text-xs text-muted-foreground sm:grid-cols-2">
          {data?.projectTitle ? <div><span className="font-medium text-foreground">Job:</span> {data.projectTitle}</div> : null}
          {data?.customer?.name ? <div><span className="font-medium text-foreground">Client:</span> {data.customer.name}</div> : null}
          {data?.propertyAddress ? <div className="sm:col-span-2"><span className="font-medium text-foreground">Address:</span> {data.propertyAddress}</div> : null}
          {data?.recommendedChatType ? <div><span className="font-medium text-foreground">Best chat:</span> {humanize(data.recommendedChatType)}</div> : null}
        </div>
        <p className="text-xs text-muted-foreground">
          Use this to route the report to the right person. For outside people, create/invite them to the right shared chat so they only see the chat/report they are meant to see.
        </p>
        {shareUrl ? <div className="truncate rounded-lg border bg-background/70 p-2 text-xs text-muted-foreground">{shareUrl}</div> : null}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2 border-t bg-background/60 py-2">
        {shareUrl ? <Button size="sm" onClick={copyShare}>{copied ? <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}{copied ? 'Copied' : 'Copy link'}</Button> : null}
        {chatUrl ? <Button size="sm" variant="outline" onClick={openChat}>Open chat</Button> : (
          <Button size="sm" variant="outline" onClick={() => insertJobroloPrompt(`Create or open the ${humanize(String(data?.recommendedChatType || 'shared'))} chat for this report, then share the report link there.`)}>Create chat</Button>
        )}
        <Button size="sm" variant="outline" onClick={() => insertJobroloPrompt(`Invite someone to view this report in the right shared chat. Ask for their name, email, phone, and whether they are a homeowner, crew/subcontractor, referral partner, insurance agent, adjuster, or employee.`)}>Invite person</Button>
      </CardFooter>
    </Card>
  )
}


export function RoofReportCard({ report }: { report?: RoofReportLike | null }) {
  if (!report) return null
  const id = report.reportId || report.id
  const askJobroloToEdit = () => {
    const prompt = id
      ? `Help me finish this roof report in chat. Review roof report ${id}, tell me what is missing, and ask me for the next piece of information or photos.`
      : `Help me finish this roof report in chat. Tell me what is missing and ask me for the next piece of information or photos.`
    window.dispatchEvent(new CustomEvent('jobrolo:insert-prompt', { detail: { text: prompt } }))
  }
  const reviewPhotos = () => {
    insertJobroloPrompt(id
      ? `Review photos for roof report ${id}. Let me select which roof, gutter, hail, wind, interior, or overview photos to include or remove from the report.`
      : 'Review photos for this roof report and let me select which photos to include or remove.')
  }
  const routeReport = () => {
    insertJobroloPrompt(id
      ? `Share roof report ${id}. Ask who it should go to: homeowner, crew/subcontractor, referral partner/realtor, insurance agent/adjuster, or internal team.`
      : 'Share this roof report. Ask who it should go to: homeowner, crew/subcontractor, referral partner/realtor, insurance agent/adjuster, or internal team.')
  }
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
        <Button size="sm" onClick={askJobroloToEdit}>Finish in chat</Button>
        <Button size="sm" variant="outline" onClick={reviewPhotos}>Review photos</Button>
        <Button size="sm" variant="outline" onClick={routeReport}>Route/share</Button>
        {report.printUrl ? <Button size="sm" variant="outline" asChild><Link href={report.printUrl} target="_blank">Preview report</Link></Button> : null}
        {report.shareUrl ? <Button size="sm" variant="outline" asChild><Link href={report.shareUrl} target="_blank">Open share</Link></Button> : null}
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
                onClick={() => openInspectionPhotoIntake(inspectionSectionId(section))}
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
        <Button size="sm" onClick={() => openInspectionPhotoIntake(null)}>
          Start inspection
        </Button>
        <Button size="sm" variant="outline" onClick={openFieldMap}>
          Open map
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
        <Button size="sm" variant="outline" onClick={() => openInspectionPhotoIntake(null)}>Start inspection</Button>
        <Button size="sm" variant="outline" onClick={openFieldMap}>Open map</Button>
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
        <Button size="sm" onClick={() => openInspectionPhotoIntake(null)}>Start inspection</Button>
        <Button size="sm" variant="outline" onClick={openFieldMap}>Open map</Button>
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
  const [state, setState] = useState<'idle' | 'drafted'>('idle')
  const best = data?.bestCandidate || data?.candidate || data?.candidates?.[0]
  const candidates = Array.isArray(data?.candidates) ? data.candidates : []
  const providerSources = Array.isArray(data?.providerSources) ? data.providerSources : []
  const providerWarnings = Array.isArray(data?.providerWarnings) ? data.providerWarnings : []
  const unverifiedOnly = Boolean(data?.unverifiedOnly)
  function confirm() {
    if (!data?.runId) return
    insertJobroloPrompt(
      `Review and confirm property research run ${data.runId}. Candidate ID: ${best?.id || 'unknown'}. Address: ${best?.address || 'unknown'}. Possible owner: ${best?.ownerName || 'unknown'}. If this is the correct property, save it to property memory and tell me what saved. If it is uncertain, ask me before saving.`,
    )
    setState('drafted')
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
        {unverifiedOnly ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
            GPS/address context is saved, but no verified public property-owner record was found yet. Confirm the property before creating a customer or job.
          </div>
        ) : null}
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
        {data?.providerSummary ? (
          <div className="rounded-lg border bg-background/60 p-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Lookup status:</span> {data.providerSummary}
          </div>
        ) : null}
        {providerWarnings.length ? (
          <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50/70 p-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
            {providerWarnings.slice(0, 3).map((warning: string, i: number) => <div key={i}>• {warning}</div>)}
          </div>
        ) : null}
        {providerSources.length ? (
          <div className="space-y-1 text-xs">
            <div className="font-medium text-foreground">Sources checked</div>
            {providerSources.slice(0, 3).map((source: any, i: number) => (
              <a key={`${source.url || source.title || i}`} href={source.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 truncate text-cyan-700 underline-offset-2 hover:underline dark:text-cyan-300">
                <ExternalLink className="h-3 w-3 flex-shrink-0" />
                <span className="truncate">{source.title || source.url}</span>
              </a>
            ))}
          </div>
        ) : null}
        {candidates.length > 1 ? (
          <div className="space-y-1 text-xs text-muted-foreground">
            {candidates.slice(1, 4).map((c: any, i: number) => <div key={i}>• {c.address || c.id}{typeof c.score === 'number' ? ` · score ${c.score}` : ''}</div>)}
          </div>
        ) : null}
        {state === 'drafted' ? <p className="text-xs text-blue-700 dark:text-blue-300">Drafted the property confirmation in chat so you can review it before saving.</p> : null}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2 border-t bg-background/60 py-2">
        <Button size="sm" disabled={!data?.runId || state === 'drafted'} onClick={confirm}>
          <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
          {state === 'drafted' ? 'Drafted' : 'Confirm in chat'}
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

export function ActionCenterCard({ data }: { data?: any }) {
  const items = Array.isArray(data?.items) ? data.items.slice(0, 8) : []
  const count = Number(data?.count ?? items.length)
  return (
    <Card className="mt-2 w-full overflow-hidden border-blue-200 bg-blue-50/50 shadow-sm dark:border-blue-900/60 dark:bg-blue-950/20 sm:max-w-xl">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm text-blue-950 dark:text-blue-100">
            <ClipboardCheck className="h-4 w-4" />
            Action needed
          </CardTitle>
          <Badge variant="secondary" className="text-[10px]">{count}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {!items.length ? (
          <p className="text-muted-foreground">Nothing urgent is routed to you right now.</p>
        ) : (
          items.map((item: InboxLike, i: number) => {
            const payload = parsePayload(item)
            const title = item.title || humanize(String(item.type || 'Action'))
            const id = item.id || item.actionRequestId || payload?.actionRequestId
            return (
              <div key={`${String(id || title)}-${i}`} className="rounded-xl border bg-background/70 p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-foreground">{title}</div>
                    {item.summary ? <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.summary}</div> : null}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {item.priority ? <Badge variant={item.priority === 'urgent' || item.priority === 'high' ? 'destructive' : 'secondary'} className="text-[10px]">{humanize(item.priority)}</Badge> : null}
                    {item.role ? <Badge variant="outline" className="text-[10px]">{humanize(item.role)}</Badge> : null}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => insertJobroloPrompt(`Review this action item and show me what I need to decide: ${title}${id ? ` (${id})` : ''}`)}>
                    Review
                  </Button>
                  {item.actionRequestId ? (
                    <Button size="sm" variant="outline" onClick={() => insertJobroloPrompt(`Show approval request ${item.actionRequestId}. Tell me exactly what will happen if I approve it.`)}>
                      Approval details
                    </Button>
                  ) : null}
                </div>
              </div>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}

export function InboxActionCard({ item, onChanged, className }: { item?: InboxLike | null; onChanged?: () => void; className?: string }) {
  const [decisionState, setDecisionState] = useState<'idle' | 'done'>('idle')
  const [decisionMessage, setDecisionMessage] = useState<string | null>(null)
  const payload = useMemo(() => parsePayload(item), [item])
  if (!item) return null
  const currentItem = item
  const type = String(currentItem.type ?? '').toLowerCase()
  const isMaterial = type.includes('material') || String(currentItem.title ?? '').toLowerCase().includes('material')
  const isApproval = !!currentItem.actionRequestId && !['actioned', 'archived', 'approved', 'rejected', 'completed', 'cancelled'].includes(String(item.status ?? '').toLowerCase())
  const Icon = isMaterial ? Package : type.includes('location') ? MapPin : type.includes('signature') ? FileText : type.includes('issue') ? AlertTriangle : ClipboardCheck
  const tone = isMaterial ? 'border-orange-200 bg-orange-50/60 dark:border-orange-900/60 dark:bg-orange-950/20' : 'border-blue-200 bg-blue-50/50 dark:border-blue-900/60 dark:bg-blue-950/20'

  function decide(decision: 'approved' | 'rejected') {
    if (!currentItem.actionRequestId) return
    const verb = decision === 'approved' ? 'Approve' : 'Reject'
    const safety = decision === 'approved'
      ? 'Show me exactly what will happen first, then run it only if it is still pending and safe.'
      : 'Show me exactly what this request is, then reject it if it is still pending.'
    insertJobroloPrompt(`${verb} action request ${currentItem.actionRequestId}. ${safety}`)
    setDecisionMessage(decision === 'approved' ? 'Drafted an approval prompt in chat. Review or send it to continue.' : 'Drafted a rejection prompt in chat. Review or send it to continue.')
    setDecisionState('done')
    onChanged?.()
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
        {decisionState === 'done' ? <p className="flex items-center gap-1 text-xs text-blue-700 dark:text-blue-300"><ShieldCheck className="h-3.5 w-3.5" /> {decisionMessage || 'Decision logged.'}</p> : null}
      </CardContent>
      {isApproval ? (
        <CardFooter className="flex flex-wrap gap-2 border-t bg-background/60 py-2">
          <Button size="sm" disabled={decisionState === 'done'} onClick={() => decide('approved')}>
            <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
            Approve
          </Button>
          <Button size="sm" variant="outline" disabled={decisionState === 'done'} onClick={() => decide('rejected')}>
            <XCircle className="mr-1.5 h-3.5 w-3.5" />
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

function approvalRowsFromPayload(payload: Record<string, unknown>) {
  const approvalDetails = (payload.approvalDetails && typeof payload.approvalDetails === 'object')
    ? payload.approvalDetails as Record<string, any>
    : null
  const rows: Array<{ label: string; value: string }> = []

  if (approvalDetails?.targetLabel) {
    rows.push({ label: 'Target', value: String(approvalDetails.targetLabel) })
  }
  if (approvalDetails?.destructive) {
    rows.push({ label: 'Warning', value: 'This is a destructive action. Review the target before approving.' })
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
