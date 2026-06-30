import { db } from '@/lib/db'
import { createProjectTimelineEvent, getProjectContextByContractor, linkDocumentToJobPacket } from '@/lib/project-context'
import type { TenantContext } from '@/lib/security/context'
import { canDecideAction } from '@/lib/security/permissions'
import type { ChannelType } from '@/lib/types'
import { handleInboxItemCreated } from '@/lib/notifications'

export type FieldMode = 'inspection' | 'adjuster_meeting' | 'signing' | 'production' | 'canvassing' | 'follow_up' | 'field'
export type FieldActionKey =
  | 'en_route'
  | 'arrived'
  | 'inspection_started'
  | 'adjuster_present'
  | 'adjuster_no_show'
  | 'signing_started'
  | 'customer_signed'
  | 'customer_wants_changes'
  | 'production_started'
  | 'crew_arrived'
  | 'materials_delivered'
  | 'need_material'
  | 'issue_found'
  | 'photos_uploaded'
  | 'no_answer'
  | 'completed'

export interface LatLngInput {
  lat?: number | null
  lng?: number | null
  latitude?: number | null
  longitude?: number | null
  accuracyMeters?: number | null
  source?: string | null
}

export interface FieldBriefingOptions {
  projectId: string
  appointmentId?: string | null
  fieldVisitId?: string | null
  mode?: FieldMode | string | null
  location?: LatLngInput | null
}

export interface FieldActionInput {
  projectId: string
  appointmentId?: string | null
  fieldVisitId?: string | null
  action: FieldActionKey | string
  mode?: FieldMode | string | null
  note?: string | null
  materialName?: string | null
  quantity?: string | null
  photoDocumentIds?: string[] | null
  signatureRequestId?: string | null
  location?: LatLngInput | null
  metadata?: Record<string, unknown> | null
}

export interface LocationResolveInput {
  projectId?: string | null
  customerId?: string | null
  appointmentId?: string | null
  fieldVisitId?: string | null
  documentId?: string | null
  canvassingLeadId?: string | null
  currentLocation?: LatLngInput | null
  photoExifLocation?: LatLngInput | null
  mode?: string | null
  takenAt?: string | Date | null
  uploadedAt?: string | Date | null
}

type Candidate = {
  type: 'project' | 'customer' | 'appointment' | 'field_visit' | 'canvassing_lead'
  id: string
  projectId?: string | null
  customerId?: string | null
  appointmentId?: string | null
  fieldVisitId?: string | null
  label: string
  score: number
  distanceMeters?: number | null
  reason: string
}

const MODE_LABELS: Record<string, string> = {
  inspection: 'Inspection',
  adjuster_meeting: 'Adjuster Meeting',
  signing: 'Signing',
  production: 'Production',
  canvassing: 'Canvassing',
  follow_up: 'Follow-up',
  field: 'Field Visit',
}

const ACTION_DEFINITIONS: Record<string, {
  label: string
  eventType: string
  timelineTitle: string
  fieldStatus?: string
  appointmentStatus?: string
  routeTo?: string[]
  createsActionRequest?: boolean
  actionType?: string
  priority?: string
}> = {
  en_route: { label: 'En Route', eventType: 'field_en_route', timelineTitle: 'Field rep is en route', fieldStatus: 'en_route', appointmentStatus: 'en_route' },
  arrived: { label: 'Arrived', eventType: 'field_arrived', timelineTitle: 'Arrived at property', fieldStatus: 'arrived', appointmentStatus: 'arrived' },
  inspection_started: { label: 'Inspection Started', eventType: 'inspection_started', timelineTitle: 'Inspection started', fieldStatus: 'started', appointmentStatus: 'in_progress' },
  adjuster_present: { label: 'Adjuster Present', eventType: 'adjuster_present', timelineTitle: 'Adjuster arrived/present', fieldStatus: 'started', appointmentStatus: 'in_progress' },
  adjuster_no_show: { label: 'Adjuster No-show', eventType: 'adjuster_no_show', timelineTitle: 'Adjuster did not show', fieldStatus: 'no_answer', appointmentStatus: 'no_show', routeTo: ['project_manager', 'coordinator'] },
  signing_started: { label: 'Signing Started', eventType: 'signing_started', timelineTitle: 'Signing started', fieldStatus: 'started', appointmentStatus: 'in_progress' },
  customer_signed: { label: 'Customer Signed', eventType: 'customer_signed', timelineTitle: 'Customer signed documents', fieldStatus: 'completed', appointmentStatus: 'completed' },
  customer_wants_changes: { label: 'Customer Wants Changes', eventType: 'customer_wants_changes', timelineTitle: 'Customer requested document changes', routeTo: ['project_manager', 'sales'], createsActionRequest: true, actionType: 'signature_change_request', priority: 'high' },
  production_started: { label: 'Production Started', eventType: 'production_started', timelineTitle: 'Production started', fieldStatus: 'started', appointmentStatus: 'in_progress' },
  crew_arrived: { label: 'Crew Arrived', eventType: 'crew_arrived', timelineTitle: 'Crew arrived', fieldStatus: 'arrived', appointmentStatus: 'arrived' },
  materials_delivered: { label: 'Materials Delivered', eventType: 'materials_delivered', timelineTitle: 'Materials delivered', routeTo: ['project_manager', 'coordinator'] },
  need_material: { label: 'Need Material', eventType: 'material_request_created', timelineTitle: 'Crew requested additional material', routeTo: ['project_manager', 'coordinator'], createsActionRequest: true, actionType: 'material_request', priority: 'high' },
  issue_found: { label: 'Issue Found', eventType: 'field_issue_reported', timelineTitle: 'Field issue reported', routeTo: ['project_manager', 'coordinator', 'owner'], createsActionRequest: true, actionType: 'issue_report', priority: 'high' },
  photos_uploaded: { label: 'Photos Uploaded', eventType: 'field_photos_uploaded', timelineTitle: 'Field photos uploaded' },
  no_answer: { label: 'No Answer', eventType: 'field_no_answer', timelineTitle: 'No answer at property', fieldStatus: 'no_answer', appointmentStatus: 'no_show', routeTo: ['project_manager', 'sales'] },
  completed: { label: 'Visit Complete', eventType: 'field_visit_completed', timelineTitle: 'Field visit completed', fieldStatus: 'completed', appointmentStatus: 'completed' },
}

const MODE_QUICK_ACTIONS: Record<string, string[]> = {
  inspection: ['arrived', 'inspection_started', 'photos_uploaded', 'no_answer', 'completed'],
  adjuster_meeting: ['arrived', 'adjuster_present', 'adjuster_no_show', 'photos_uploaded', 'issue_found', 'completed'],
  signing: ['arrived', 'signing_started', 'customer_signed', 'customer_wants_changes', 'no_answer'],
  production: ['crew_arrived', 'production_started', 'materials_delivered', 'need_material', 'issue_found', 'completed'],
  canvassing: ['arrived', 'photos_uploaded', 'no_answer', 'completed'],
  follow_up: ['arrived', 'no_answer', 'completed'],
  field: ['arrived', 'photos_uploaded', 'issue_found', 'completed'],
}

function safeJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try { return JSON.parse(value) as T } catch { return fallback }
}

function normalizeLatLng(input?: LatLngInput | null): { lat: number; lng: number; accuracyMeters?: number | null; source?: string | null } | null {
  if (!input) return null
  const lat = typeof input.lat === 'number' ? input.lat : input.latitude
  const lng = typeof input.lng === 'number' ? input.lng : input.longitude
  if (typeof lat !== 'number' || typeof lng !== 'number') return null
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return { lat, lng, accuracyMeters: input.accuracyMeters, source: input.source }
}

function toDate(value?: string | Date | null): Date | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = 6371000
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const sinLat = Math.sin(dLat / 2)
  const sinLng = Math.sin(dLng / 2)
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng
  return 2 * r * Math.asin(Math.sqrt(h))
}

function inferMode(input: { mode?: string | null; appointment?: any | null; schedule?: any | null; project?: any | null }): FieldMode {
  if (input.mode) return normalizeMode(input.mode)
  const type = String(input.appointment?.type ?? '').toLowerCase()
  const stage = String(input.schedule?.stage ?? input.project?.status ?? '').toLowerCase()
  if (type.includes('adjuster') || stage.includes('adjuster')) return 'adjuster_meeting'
  if (type.includes('sign') || stage.includes('sign') || stage.includes('contract')) return 'signing'
  if (type.includes('production') || type.includes('material') || stage.includes('production')) return 'production'
  if (type.includes('canvass') || stage.includes('canvass')) return 'canvassing'
  if (type.includes('follow') || type.includes('call')) return 'follow_up'
  if (type.includes('inspection') || stage.includes('inspection') || stage.includes('inspected')) return 'inspection'
  return 'field'
}

function normalizeMode(mode: string): FieldMode {
  const m = mode.toLowerCase().replace(/\s+/g, '_')
  if (m.includes('adjuster')) return 'adjuster_meeting'
  if (m.includes('sign')) return 'signing'
  if (m.includes('production') || m.includes('crew') || m.includes('material')) return 'production'
  if (m.includes('canvass')) return 'canvassing'
  if (m.includes('follow')) return 'follow_up'
  if (m.includes('inspection')) return 'inspection'
  return 'field'
}

export function getQuickActionsForMode(mode: string) {
  const keys = MODE_QUICK_ACTIONS[mode] ?? MODE_QUICK_ACTIONS.field
  return keys.map(key => ({ key, label: ACTION_DEFINITIONS[key]?.label ?? key, requiresInput: key === 'need_material' || key === 'issue_found' }))
}

function buildTalkingPoints(mode: FieldMode, context: any, warnings: string[], missingItems: string[]) {
  const customerName = context.project?.customer?.name ?? 'the homeowner'
  if (mode === 'adjuster_meeting') {
    return [
      `Confirm the claim number, carrier, adjuster name, and date of loss before discussing scope.`,
      `Walk the adjuster through documented damage and photos. Do not promise coverage or approval.`,
      missingItems.length ? `Before leaving, try to close these gaps: ${missingItems.slice(0, 3).join(', ')}.` : `Before leaving, confirm what the adjuster needs next and log it immediately.`,
    ]
  }
  if (mode === 'signing') {
    return [
      `Explain what each document is for before asking ${customerName} to sign.`,
      `If the customer wants changes, log it instead of editing terms on the spot.`,
      `Do not make verbal promises that are not reflected in the approved document/template.`,
    ]
  }
  if (mode === 'production') {
    return [
      `Confirm crew, material delivery, scope, exclusions, and customer expectations before work starts.`,
      `Photo-document existing conditions, material delivery, issues, and completion.`,
      warnings.length ? `Resolve the top warning before the crew leaves: ${warnings[0]}.` : `Log any scope/material issue the moment it happens.`,
    ]
  }
  if (mode === 'canvassing') {
    return [
      `Create or update the lead at the address you are standing at.`,
      `Log the door result, photos, and next follow-up before moving to the next house.`,
      `Do not attach a photo to a customer/job unless Jobrolo confirms the match.`,
    ]
  }
  return [
    `Confirm who is home and why you are there.`,
    `Capture overview photos first, then close-ups and interior/attic if relevant.`,
    `Before leaving, log what happened and the next action.`,
  ]
}

function buildSpeakableText(input: { mode: FieldMode; context: any; warnings: string[]; missingItems: string[]; pendingSignatureCount: number; openFollowUps: number; quickActions: Array<{ label: string }> }) {
  const project = input.context.project
  const customerFirst = project?.customer?.name ? String(project.customer.name).split(' ')[0] : 'the customer'
  const address = project?.address ?? project?.customer?.address ?? 'the property'
  const modeLabel = MODE_LABELS[input.mode] ?? 'Field Visit'
  const bits = [
    `${modeLabel} briefing for ${customerFirst} at ${address}.`,
    input.warnings.length ? `Top warning: ${input.warnings[0]}.` : `No critical warnings found in the job packet.`,
    input.missingItems.length ? `Missing item: ${input.missingItems[0]}.` : `No required missing item is flagged right now.`,
    input.pendingSignatureCount ? `${input.pendingSignatureCount} signature item is still pending.` : `No pending signature count is flagged.`,
    input.openFollowUps ? `${input.openFollowUps} follow-up item is open.` : `No open follow-up item is flagged.`,
    `Recommended actions are ${input.quickActions.slice(0, 4).map(a => a.label).join(', ')}.`,
  ]
  return bits.join(' ')
}

export async function getFieldBriefing(ctx: TenantContext, options: FieldBriefingOptions) {
  const project = await db.project.findFirst({
    where: { id: options.projectId, contractorId: ctx.contractorId },
    include: { customer: true },
  })
  if (!project) return null

  const [context, currentAppointment, activeVisit] = await Promise.all([
    getProjectContextByContractor(options.projectId, ctx.contractorId),
    options.appointmentId ? db.appointment.findFirst({ where: { id: options.appointmentId, contractorId: ctx.contractorId, projectId: options.projectId } }) : Promise.resolve(null),
    options.fieldVisitId ? db.fieldVisit.findFirst({ where: { id: options.fieldVisitId, contractorId: ctx.contractorId, projectId: options.projectId } }) : Promise.resolve(null),
  ])
  if (!context) return null

  const appointment = currentAppointment ?? context.upcomingAppointments?.[0] ?? null
  const mode = inferMode({ mode: options.mode, appointment, schedule: context.schedule, project })
  const packet = context.packet
  const pendingSignatures = context.packet?.signatureRequests?.filter((s: any) => !['signed', 'voided', 'expired', 'declined'].includes(s.status)) ?? []
  const missingItems: string[] = []
  const warnings: string[] = []

  if (!packet?.roofReports?.length && (mode === 'inspection' || mode === 'adjuster_meeting')) missingItems.push('roof report not created')
  if (!packet?.documents?.length) missingItems.push('no documents/files in job packet')
  if (context.ocrReview?.required) warnings.push(`${context.ocrReview.required} document(s) need OCR review`)
  if (pendingSignatures.length) warnings.push(`${pendingSignatures.length} signature request(s) pending`)
  if (context.openTasks?.length) warnings.push(`${context.openTasks.length} open task(s)`) 
  if (context.followUps?.length) warnings.push(`${context.followUps.length} follow-up item(s)`) 

  const quickActions = getQuickActionsForMode(mode)
  const talkingPoints = buildTalkingPoints(mode, context, warnings, missingItems)
  const topThings = [
    `${MODE_LABELS[mode] ?? 'Field'} mode for ${project.title}`,
    appointment ? `Current appointment: ${appointment.title} at ${appointment.startTime.toLocaleString()}` : 'No appointment selected; confirm the job before logging actions.',
    warnings[0] ?? missingItems[0] ?? 'Job packet looks clear enough for field work.',
  ]

  const speakableText = buildSpeakableText({
    mode,
    context,
    warnings,
    missingItems,
    pendingSignatureCount: pendingSignatures.length,
    openFollowUps: context.followUps?.length ?? 0,
    quickActions,
  })

  return {
    project: context.project,
    mode,
    modeLabel: MODE_LABELS[mode] ?? 'Field Visit',
    appointment,
    activeVisit,
    customer: context.project?.customer,
    schedule: context.schedule,
    topThings,
    warnings,
    missingItems,
    pendingSignatures,
    openFollowUps: context.followUps ?? [],
    ocrReview: context.ocrReview,
    relevantFiles: packet?.documents?.slice(0, 12) ?? [],
    recentTimeline: context.timelineEvents?.slice(0, 12) ?? [],
    talkingPoints,
    quickActions,
    speakableText,
    privacyNote: 'Speak Briefing intentionally redacts claim financials, policy numbers, mortgage info, and private notes.',
  }
}

export async function resolveFieldEntity(ctx: TenantContext, input: LocationResolveInput) {
  const now = new Date()
  const candidates: Candidate[] = []
  const currentLocation = normalizeLatLng(input.currentLocation) ?? normalizeLatLng(input.photoExifLocation)

  if (input.projectId) {
    const project = await db.project.findFirst({ where: { id: input.projectId, contractorId: ctx.contractorId }, include: { customer: true } })
    if (project) {
      candidates.push({ type: 'project', id: project.id, projectId: project.id, customerId: project.customerId, label: project.title, score: 100, reason: 'Project was explicitly selected.' })
    }
  }

  if (input.fieldVisitId) {
    const visit = await db.fieldVisit.findFirst({ where: { id: input.fieldVisitId, contractorId: ctx.contractorId } })
    if (visit) candidates.push({ type: 'field_visit', id: visit.id, projectId: visit.projectId, customerId: visit.customerId, appointmentId: visit.appointmentId, fieldVisitId: visit.id, label: visit.title ?? `${MODE_LABELS[visit.type] ?? 'Field Visit'} visit`, score: 95, reason: 'Active field visit was supplied.' })
  }

  if (input.appointmentId) {
    const appt = await db.appointment.findFirst({ where: { id: input.appointmentId, contractorId: ctx.contractorId } })
    if (appt) candidates.push({ type: 'appointment', id: appt.id, projectId: appt.projectId, customerId: appt.customerId, appointmentId: appt.id, label: appt.title, score: 92, reason: 'Appointment was supplied.' })
  }

  const windowStart = new Date(now.getTime() - 1000 * 60 * 180)
  const windowEnd = new Date(now.getTime() + 1000 * 60 * 180)

  const activeVisits = await db.fieldVisit.findMany({
    where: {
      contractorId: ctx.contractorId,
      ...(ctx.user?.id ? { createdById: ctx.user.id } : {}),
      status: { in: ['planned', 'en_route', 'arrived', 'started'] },
      createdAt: { gte: new Date(now.getTime() - 1000 * 60 * 60 * 12) },
    },
    take: 10,
    orderBy: { updatedAt: 'desc' },
  })
  for (const visit of activeVisits) {
    let score = 78
    let distance: number | null = null
    if (currentLocation && typeof visit.latitude === 'number' && typeof visit.longitude === 'number') {
      distance = distanceMeters(currentLocation, { lat: visit.latitude, lng: visit.longitude })
      score = distance < 75 ? 92 : distance < 200 ? 84 : 65
    }
    candidates.push({ type: 'field_visit', id: visit.id, projectId: visit.projectId, customerId: visit.customerId, appointmentId: visit.appointmentId, fieldVisitId: visit.id, label: visit.title ?? `${MODE_LABELS[visit.type] ?? 'Field Visit'} visit`, score, distanceMeters: distance, reason: distance === null ? 'Recent active field visit for this user.' : `Recent active visit within ${Math.round(distance)}m.` })
  }

  const appointments = await db.appointment.findMany({
    where: {
      contractorId: ctx.contractorId,
      status: { in: ['scheduled', 'en_route', 'arrived', 'in_progress'] },
      startTime: { lte: windowEnd },
      endTime: { gte: windowStart },
    },
    take: 20,
    orderBy: { startTime: 'asc' },
  })
  for (const appt of appointments) {
    candidates.push({ type: 'appointment', id: appt.id, projectId: appt.projectId, customerId: appt.customerId, appointmentId: appt.id, label: appt.title, score: 62, reason: 'Appointment is within the current field-time window.' })
  }

  if (currentLocation) {
    const pings = await db.fieldLocationPing.findMany({
      where: { contractorId: ctx.contractorId, projectId: { not: null } },
      orderBy: { capturedAt: 'desc' },
      take: 250,
    })
    const byProject = new Map<string, Candidate>()
    for (const ping of pings) {
      if (!ping.projectId) continue
      const d = distanceMeters(currentLocation, { lat: ping.latitude, lng: ping.longitude })
      if (d > 300) continue
      const score = d < 50 ? 88 : d < 150 ? 78 : 68
      const existing = byProject.get(ping.projectId)
      if (!existing || score > existing.score) {
        byProject.set(ping.projectId, { type: 'project', id: ping.projectId, projectId: ping.projectId, customerId: ping.customerId, label: `Project ${ping.projectId}`, score, distanceMeters: d, reason: `GPS is near a saved job-site location (${Math.round(d)}m).` })
      }
    }
    candidates.push(...byProject.values())

    const leads = await db.canvassingLead.findMany({ where: { contractorId: ctx.contractorId, latitude: { not: null }, longitude: { not: null } }, take: 250, orderBy: { updatedAt: 'desc' } })
    for (const lead of leads) {
      if (typeof lead.latitude !== 'number' || typeof lead.longitude !== 'number') continue
      const d = distanceMeters(currentLocation, { lat: lead.latitude, lng: lead.longitude })
      if (d <= 150) candidates.push({ type: 'canvassing_lead', id: lead.id, projectId: lead.projectId, customerId: lead.customerId, label: lead.address ?? `Canvassing lead ${lead.id}`, score: d < 50 ? 82 : 70, distanceMeters: d, reason: `GPS is near an existing canvassing lead (${Math.round(d)}m).` })
    }
  }

  const deduped = Array.from(candidates.reduce((map, c) => {
    const key = `${c.type}:${c.id}`
    const existing = map.get(key)
    if (!existing || c.score > existing.score) map.set(key, c)
    return map
  }, new Map<string, Candidate>()).values()).sort((a, b) => b.score - a.score).slice(0, 8)

  const best = deduped[0] ?? null
  const confidence = best?.score ?? 0
  const confidenceLabel = confidence >= 88 ? 'high' : confidence >= 65 ? 'medium' : 'low'
  const reason = best ? best.reason : currentLocation ? 'No matching job, appointment, field visit, or canvassing lead was found near this location.' : 'No GPS/project/appointment context was supplied.'

  const resolution = await db.locationResolution.create({
    data: {
      contractorId: ctx.contractorId,
      userId: ctx.user?.id,
      documentId: input.documentId ?? undefined,
      projectId: best?.projectId ?? undefined,
      customerId: best?.customerId ?? undefined,
      appointmentId: best?.appointmentId ?? undefined,
      fieldVisitId: best?.fieldVisitId ?? undefined,
      canvassingLeadId: best?.type === 'canvassing_lead' ? best.id : undefined,
      confidence,
      confidenceLabel,
      reason,
      source: input.mode ?? 'field_resolver',
      status: confidenceLabel === 'high' ? 'suggested' : 'suggested',
      candidatesJson: JSON.stringify(deduped),
    },
  })

  if (currentLocation) {
    await db.fieldLocationPing.create({
      data: {
        contractorId: ctx.contractorId,
        userId: ctx.user?.id,
        projectId: best?.projectId ?? undefined,
        customerId: best?.customerId ?? undefined,
        appointmentId: best?.appointmentId ?? undefined,
        fieldVisitId: best?.fieldVisitId ?? undefined,
        documentId: input.documentId ?? undefined,
        canvassingLeadId: best?.type === 'canvassing_lead' ? best.id : undefined,
        latitude: currentLocation.lat,
        longitude: currentLocation.lng,
        accuracyMeters: currentLocation.accuracyMeters ?? undefined,
        source: currentLocation.source ?? (input.photoExifLocation ? 'photo_exif' : 'browser_gps'),
        capturedAt: toDate(input.takenAt) ?? toDate(input.uploadedAt) ?? now,
        metadataJson: JSON.stringify({ confidenceLabel, confidence, reason }),
      },
    })
  }

  return {
    resolutionId: resolution.id,
    bestMatch: best,
    confidence,
    confidenceLabel,
    reason,
    candidates: deduped,
    recommendedAction: confidenceLabel === 'high'
      ? 'confirm_or_auto_attach_with_undo'
      : confidenceLabel === 'medium'
        ? 'ask_user_to_confirm'
        : 'ask_user_to_choose_or_create_lead',
  }
}

export async function confirmLocationResolution(ctx: TenantContext, resolutionId: string, options: { projectId?: string | null; customerId?: string | null; canvassingLeadId?: string | null; documentId?: string | null; attachDocument?: boolean }) {
  const resolution = await db.locationResolution.findFirst({ where: { id: resolutionId, contractorId: ctx.contractorId } })
  if (!resolution) return null
  const projectId = options.projectId ?? resolution.projectId
  const customerId = options.customerId ?? resolution.customerId
  const canvassingLeadId = options.canvassingLeadId ?? resolution.canvassingLeadId
  const documentId = options.documentId ?? resolution.documentId

  const updated = await db.locationResolution.update({
    where: { id: resolution.id },
    data: { projectId: projectId ?? undefined, customerId: customerId ?? undefined, canvassingLeadId: canvassingLeadId ?? undefined, status: 'confirmed', confirmedAt: new Date(), confirmedById: ctx.user?.id },
  })

  if (options.attachDocument && documentId && projectId) {
    await db.document.update({ where: { id: documentId }, data: { projectId, customerId: customerId ?? undefined } }).catch(() => null)
    await linkDocumentToJobPacket({ contractorId: ctx.contractorId, documentId, projectId, customerId, entityType: 'project', entityId: projectId, role: 'inspection_photo', source: 'location_resolver', confidence: resolution.confidence / 100, metadata: { resolutionId: resolution.id } }).catch(() => null)
  }

  return updated
}

async function ensureProjectWorkspaceChat(projectId: string, contractorId: string, chatType: ChannelType = 'main') {
  const workspace = await db.workspace.findFirst({ where: { contractorId, projectId }, select: { id: true } })
  if (!workspace) return null
  let chat = await db.workspaceChat.findFirst({ where: { workspaceId: workspace.id, chatType }, select: { id: true } })
  if (!chat) {
    chat = await db.workspaceChat.create({ data: { workspaceId: workspace.id, chatType, title: chatType.charAt(0).toUpperCase() + chatType.slice(1), visibility: chatType === 'customer' ? 'customer' : 'internal' }, select: { id: true } })
  }
  return { workspaceId: workspace.id, chatId: chat.id }
}

async function postWorkspaceEvent(input: { contractorId: string; projectId?: string | null; channel?: ChannelType; content: string; userId?: string | null; contextType?: string; context?: Record<string, unknown> }) {
  if (!input.projectId) return null
  const target = await ensureProjectWorkspaceChat(input.projectId, input.contractorId, input.channel ?? 'main')
  if (!target) return null
  const message = await db.workspaceMessage.create({
    data: {
      chatId: target.chatId,
      role: 'system',
      content: input.content,
      contextType: input.contextType ?? 'field_event',
      contextData: input.context ? JSON.stringify(input.context) : undefined,
      createdById: input.userId ?? undefined,
    },
  }).catch(() => null)
  await db.workspaceChat.update({ where: { id: target.chatId }, data: { lastActivity: new Date() } }).catch(() => null)
  return message
}

async function routeInboxItems(input: { contractorId: string; projectId?: string | null; customerId?: string | null; actionRequestId?: string | null; roles: string[]; type: string; title: string; summary?: string | null; priority?: string; payload?: unknown }) {
  const created: Awaited<ReturnType<typeof db.inboxItem.create>>[] = []
  for (const role of input.roles) {
    const item = await db.inboxItem.create({
      data: {
        contractorId: input.contractorId,
        projectId: input.projectId ?? undefined,
        customerId: input.customerId ?? undefined,
        role,
        type: input.type,
        title: input.title,
        summary: input.summary ?? undefined,
        priority: input.priority ?? 'normal',
        actionRequestId: input.actionRequestId ?? undefined,
        payloadJson: input.payload ? JSON.stringify(input.payload) : undefined,
      },
    })
    handleInboxItemCreated(item.id).catch(err => console.error('[field-copilot] notification delivery queue failed:', err))
    created.push(item)
  }
  return created
}

export async function executeFieldAction(ctx: TenantContext, input: FieldActionInput) {
  const project = await db.project.findFirst({ where: { id: input.projectId, contractorId: ctx.contractorId }, include: { customer: true } })
  if (!project) return null
  const actionKey = String(input.action).toLowerCase().replace(/\s+/g, '_')
  const def = ACTION_DEFINITIONS[actionKey] ?? { label: input.action, eventType: `field_${actionKey}`, timelineTitle: String(input.action) }
  const location = normalizeLatLng(input.location)
  const appointment = input.appointmentId ? await db.appointment.findFirst({ where: { id: input.appointmentId, contractorId: ctx.contractorId, projectId: project.id } }) : null
  const mode = inferMode({ mode: input.mode, appointment, schedule: null, project })

  let visit = input.fieldVisitId ? await db.fieldVisit.findFirst({ where: { id: input.fieldVisitId, contractorId: ctx.contractorId, projectId: project.id } }) : null
  if (!visit) {
    visit = await db.fieldVisit.create({
      data: {
        contractorId: ctx.contractorId,
        projectId: project.id,
        customerId: project.customerId,
        appointmentId: appointment?.id ?? input.appointmentId ?? undefined,
        type: mode,
        mode,
        title: `${MODE_LABELS[mode] ?? 'Field Visit'} — ${project.title}`,
        createdById: ctx.user?.id,
        latitude: location?.lat,
        longitude: location?.lng,
        accuracyMeters: location?.accuracyMeters ?? undefined,
        metadataJson: input.metadata ? JSON.stringify(input.metadata) : undefined,
      },
    })
  }

  const now = new Date()
  const visitUpdate: Record<string, unknown> = { updatedAt: now }
  if (def.fieldStatus) visitUpdate.status = def.fieldStatus
  if (def.fieldStatus === 'arrived') visitUpdate.arrivedAt = visit.arrivedAt ?? now
  if (def.fieldStatus === 'started') visitUpdate.startedAt = visit.startedAt ?? now
  if (def.fieldStatus === 'completed' || actionKey === 'completed') visitUpdate.completedAt = visit.completedAt ?? now
  if (location) {
    visitUpdate.latitude = location.lat
    visitUpdate.longitude = location.lng
    visitUpdate.accuracyMeters = location.accuracyMeters ?? undefined
  }
  if (input.note) visitUpdate.notes = [visit.notes, input.note].filter(Boolean).join('\n')

  visit = await db.fieldVisit.update({ where: { id: visit.id }, data: visitUpdate })

  if (appointment && def.appointmentStatus) {
    await db.appointment.update({ where: { id: appointment.id }, data: { status: def.appointmentStatus } }).catch(() => null)
  }

  if (location) {
    await db.fieldLocationPing.create({
      data: {
        contractorId: ctx.contractorId,
        userId: ctx.user?.id,
        projectId: project.id,
        customerId: project.customerId ?? undefined,
        appointmentId: appointment?.id ?? undefined,
        fieldVisitId: visit.id,
        latitude: location.lat,
        longitude: location.lng,
        accuracyMeters: location.accuracyMeters ?? undefined,
        source: location.source ?? 'field_action',
        metadataJson: JSON.stringify({ action: actionKey }),
      },
    }).catch(() => null)
  }

  if (input.photoDocumentIds?.length) {
    for (const documentId of input.photoDocumentIds) {
      await linkDocumentToJobPacket({ contractorId: ctx.contractorId, documentId, projectId: project.id, customerId: project.customerId, entityType: 'field_visit', entityId: visit.id, role: 'inspection_photo', source: 'field_copilot', confidence: 1, metadata: { action: actionKey } }).catch(() => null)
    }
  }

  const eventBody = input.note ?? (actionKey === 'need_material' ? `Material requested: ${input.quantity ?? ''} ${input.materialName ?? ''}`.trim() : undefined)
  await createProjectTimelineEvent({
    contractorId: ctx.contractorId,
    projectId: project.id,
    customerId: project.customerId,
    eventType: def.eventType,
    title: def.timelineTitle,
    body: eventBody,
    relatedType: 'field_visit',
    relatedId: visit.id,
    actorUserId: ctx.user?.id,
    source: 'field_copilot',
    metadata: { action: actionKey, mode, appointmentId: appointment?.id, photoDocumentIds: input.photoDocumentIds, materialName: input.materialName, quantity: input.quantity, ...input.metadata },
  })

  const compactMessage = `${def.timelineTitle}${project.title ? ` — ${project.title}` : ''}${eventBody ? `\n${eventBody}` : ''}`
  await postWorkspaceEvent({ contractorId: ctx.contractorId, projectId: project.id, channel: 'main', content: compactMessage, userId: ctx.user?.id, context: { action: actionKey, mode, fieldVisitId: visit.id } })
  if (mode === 'production' || actionKey === 'need_material' || actionKey === 'issue_found') {
    await postWorkspaceEvent({ contractorId: ctx.contractorId, projectId: project.id, channel: 'crew', content: compactMessage, userId: ctx.user?.id, context: { action: actionKey, mode, fieldVisitId: visit.id } })
  }

  let actionRequest: any = null
  let inboxItems: any[] = []
  if (def.createsActionRequest) {
    const title = actionKey === 'need_material'
      ? `Material request: ${input.quantity ?? ''} ${input.materialName ?? 'material'}`.trim()
      : def.timelineTitle
    const summary = eventBody ?? input.note ?? title
    actionRequest = await db.actionRequest.create({
      data: {
        contractorId: ctx.contractorId,
        projectId: project.id,
        customerId: project.customerId ?? undefined,
        fieldVisitId: visit.id,
        appointmentId: appointment?.id ?? undefined,
        createdByUserId: ctx.user?.id,
        requestedRole: def.routeTo?.[0] ?? 'project_manager',
        type: def.actionType ?? 'approval_needed',
        title,
        summary,
        status: 'needs_approval',
        priority: def.priority ?? 'normal',
        payloadJson: JSON.stringify({ action: actionKey, materialName: input.materialName, quantity: input.quantity, note: input.note, photoDocumentIds: input.photoDocumentIds, signatureRequestId: input.signatureRequestId, mode }),
      },
    })
    await db.approvalRequest.create({ data: { contractorId: ctx.contractorId, actionRequestId: actionRequest.id, approverRole: def.routeTo?.[0] ?? 'project_manager' } })
    const actionPayload = { actionRequestId: actionRequest.id, fieldVisitId: visit.id, action: actionKey, materialName: input.materialName, quantity: input.quantity, note: input.note, photoDocumentIds: input.photoDocumentIds, mode }
    inboxItems = await routeInboxItems({ contractorId: ctx.contractorId, projectId: project.id, customerId: project.customerId, roles: def.routeTo ?? ['project_manager'], type: actionRequest.type, title, summary, priority: actionRequest.priority, actionRequestId: actionRequest.id, payload: actionPayload })
    await postWorkspaceEvent({
      contractorId: ctx.contractorId,
      projectId: project.id,
      channel: 'main',
      content: `Action needed: ${title}`,
      userId: ctx.user?.id,
      contextType: actionRequest.type,
      context: { cardType: actionRequest.type, id: actionRequest.id, actionRequestId: actionRequest.id, type: actionRequest.type, title, summary, priority: actionRequest.priority, status: actionRequest.status, role: actionRequest.requestedRole, projectId: project.id, payload: actionPayload },
    })
  } else if (def.routeTo?.length) {
    inboxItems = await routeInboxItems({ contractorId: ctx.contractorId, projectId: project.id, customerId: project.customerId, roles: def.routeTo, type: def.eventType, title: def.timelineTitle, summary: eventBody, priority: def.priority ?? 'normal', payload: { action: actionKey, fieldVisitId: visit.id } })
  }

  const briefing = await getFieldBriefing(ctx, { projectId: project.id, appointmentId: appointment?.id, fieldVisitId: visit.id, mode })
  return { visit, action: { key: actionKey, definition: def }, actionRequest, inboxItems, briefing }
}

function cleanInboxSummary(value: string | null | undefined, max = 220) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  const withoutBrowserLocation = raw
    .replace(/\[BROWSER_LOCATION\][\s\S]*?(?=(?:\n\n|$))/gi, 'Current GPS location was captured.')
    .replace(/latitude:\s*-?\d+(?:\.\d+)?/gi, '')
    .replace(/longitude:\s*-?\d+(?:\.\d+)?/gi, '')
    .replace(/accuracyMeters:\s*\d+/gi, '')
    .replace(/capturedAt:\s*[^\n]+/gi, '')
    .replace(/source:\s*browser_gps/gi, '')
  const compacted = withoutBrowserLocation.replace(/\s+/g, ' ').trim()
  return compacted.length > max ? `${compacted.slice(0, max - 1).trim()}…` : compacted
}

function inboxDedupeKey(item: {
  actionRequestId?: string | null
  relatedType?: string | null
  relatedId?: string | null
  type?: string | null
  title?: string | null
  summary?: string | null
  projectId?: string | null
  customerId?: string | null
}) {
  if (item.actionRequestId) return `action:${item.actionRequestId}`
  if (item.relatedType && item.relatedId) return `related:${item.relatedType}:${item.relatedId}:${item.type ?? ''}`
  const title = String(item.title ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
  const summary = cleanInboxSummary(item.summary, 100).toLowerCase()
  return `fallback:${item.type ?? ''}:${item.projectId ?? ''}:${item.customerId ?? ''}:${title}:${summary}`
}

function dedupeInboxItems<T extends {
  id: string
  role?: string | null
  priority?: string | null
  summary?: string | null
  title?: string | null
  actionRequestId?: string | null
  relatedType?: string | null
  relatedId?: string | null
  type?: string | null
  projectId?: string | null
  customerId?: string | null
  createdAt?: Date | null
}>(items: T[]) {
  const byKey = new Map<string, T & { roles?: string[]; duplicateCount?: number }>()
  for (const item of items) {
    const key = inboxDedupeKey(item)
    const existing = byKey.get(key)
    const cleaned = { ...item, summary: cleanInboxSummary(item.summary) } as T & { roles?: string[]; duplicateCount?: number }
    if (!existing) {
      cleaned.roles = item.role ? [item.role] : []
      cleaned.duplicateCount = 1
      byKey.set(key, cleaned)
      continue
    }
    existing.duplicateCount = (existing.duplicateCount ?? 1) + 1
    if (item.role && !existing.roles?.includes(item.role)) existing.roles = [...(existing.roles ?? []), item.role]
  }
  return Array.from(byKey.values())
}

export async function listCopilotInbox(ctx: TenantContext, options: { role?: string | null; projectId?: string | null; status?: string | null; limit?: number } = {}) {
  const role = options.role ?? ctx.user?.role ?? undefined
  const restrictToRole = role && !(ctx.user?.role === 'owner' && !options.role)
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200)
  const items = await db.inboxItem.findMany({
    where: {
      contractorId: ctx.contractorId,
      ...(restrictToRole ? { OR: [{ role }, { userId: ctx.user?.id ?? '__none__' }] } : {}),
      ...(options.projectId ? { projectId: options.projectId } : {}),
      ...(options.status ? { status: options.status } : { status: { in: ['unread', 'read'] } }),
    },
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    take: Math.min(limit * 3, 200),
  })
  const deduped = dedupeInboxItems(items).slice(0, limit)
  return { count: deduped.length, totalRawCount: items.length, items: deduped }
}

export async function decideActionRequest(ctx: TenantContext, actionRequestId: string, decision: 'approved' | 'rejected', notes?: string | null) {
  const req = await db.actionRequest.findFirst({ where: { id: actionRequestId, contractorId: ctx.contractorId } })
  if (!req) return null
  if (!canDecideAction(ctx, req.requestedRole)) throw new Error('Your role cannot approve this request')
  const now = new Date()
  const approved = decision === 'approved'
  const updated = await db.actionRequest.update({
    where: { id: req.id },
    data: approved
      ? { status: 'approved', approvedAt: now, approvedById: ctx.user?.id }
      : { status: 'rejected', rejectedAt: now, rejectedById: ctx.user?.id },
  })
  await db.approvalRequest.updateMany({ where: { contractorId: ctx.contractorId, actionRequestId: req.id, status: 'pending' }, data: { status: decision, decidedAt: now, decidedById: ctx.user?.id, decisionNotes: notes ?? undefined } })
  await db.inboxItem.updateMany({ where: { contractorId: ctx.contractorId, actionRequestId: req.id }, data: { status: 'actioned', actionedAt: now } })

  await createProjectTimelineEvent({
    contractorId: ctx.contractorId,
    projectId: req.projectId,
    customerId: req.customerId,
    eventType: approved ? 'action_request_approved' : 'action_request_rejected',
    title: `${approved ? 'Approved' : 'Rejected'}: ${req.title}`,
    body: notes ?? req.summary,
    relatedType: 'action_request',
    relatedId: req.id,
    actorUserId: ctx.user?.id,
    source: 'field_copilot',
    metadata: { type: req.type, decision },
  })

  if (approved && req.type === 'material_request') {
    await routeInboxItems({ contractorId: ctx.contractorId, projectId: req.projectId, customerId: req.customerId, roles: ['supplier'], type: 'supplier_order', title: `Order needed: ${req.title}`, summary: req.summary, priority: req.priority, actionRequestId: req.id, payload: safeJson(req.payloadJson, {}) })
  }

  if (req.projectId) {
    await postWorkspaceEvent({ contractorId: ctx.contractorId, projectId: req.projectId, channel: 'main', content: `${approved ? 'Approved' : 'Rejected'} action request: ${req.title}${notes ? `\n${notes}` : ''}`, userId: ctx.user?.id, contextType: 'action_request_decision', context: { cardType: 'action_request_decision', actionRequestId: req.id, type: req.type, title: req.title, summary: notes ?? req.summary, priority: req.priority, status: updated.status, decision } })
  }

  return updated
}

export async function createCanvassingLeadFromLocation(ctx: TenantContext, input: { sessionId?: string | null; address?: string | null; location?: LatLngInput | null; notes?: string | null; status?: string | null }) {
  const loc = normalizeLatLng(input.location)
  const lead = await db.canvassingLead.create({
    data: {
      contractorId: ctx.contractorId,
      sessionId: input.sessionId ?? undefined,
      createdById: ctx.user?.id,
      address: input.address ?? undefined,
      latitude: loc?.lat,
      longitude: loc?.lng,
      status: input.status ?? 'new',
      notes: input.notes ?? undefined,
      source: 'field_copilot',
    },
  })
  if (loc) {
    await db.fieldLocationPing.create({ data: { contractorId: ctx.contractorId, userId: ctx.user?.id, canvassingLeadId: lead.id, latitude: loc.lat, longitude: loc.lng, accuracyMeters: loc.accuracyMeters ?? undefined, source: 'canvassing_lead' } }).catch(() => null)
  }
  return lead
}
