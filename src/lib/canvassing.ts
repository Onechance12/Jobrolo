import { db } from '@/lib/db'
import type { TenantContext } from '@/lib/security/context'
import { createProjectTimelineEvent } from '@/lib/project-context'
import { upsertPropertyMemory, recordDoorAttempt, recordPropertyObservation } from '@/lib/property-memory'

export type CanvassingLocationInput = {
  lat?: number | null
  lng?: number | null
  latitude?: number | null
  longitude?: number | null
  accuracyMeters?: number | null
  source?: string | null
}

export type StartCanvassingSessionInput = {
  title?: string | null
  territoryName?: string | null
  notes?: string | null
  mode?: 'field' | 'canvassing' | null
  location?: CanvassingLocationInput | null
}

export type CreateCanvassingLeadInput = {
  sessionId?: string | null
  address?: string | null
  homeownerName?: string | null
  phone?: string | null
  notes?: string | null
  status?: string | null
  source?: string | null
  location?: CanvassingLocationInput | null
  metadata?: Record<string, unknown> | null
}

export type LogCanvassingActivityInput = {
  leadId?: string | null
  sessionId?: string | null
  type: string
  summary?: string | null
  status?: string | null
  notes?: string | null
  location?: CanvassingLocationInput | null
  metadata?: Record<string, unknown> | null
}

function safeJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try { return JSON.parse(value) as T } catch { return fallback }
}

function normalizeLocation(input?: CanvassingLocationInput | null) {
  if (!input) return null
  const lat = typeof input.lat === 'number' ? input.lat : input.latitude
  const lng = typeof input.lng === 'number' ? input.lng : input.longitude
  if (typeof lat !== 'number' || typeof lng !== 'number') return null
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return { lat, lng, accuracyMeters: input.accuracyMeters ?? null, source: input.source ?? null }
}

function activitySummary(type: string, summary?: string | null) {
  if (summary?.trim()) return summary.trim()
  const label = type.replace(/_/g, ' ')
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function cleanFieldText(value?: string | null) {
  const cleaned = value
    ?.trim()
    .replace(/\b(speech|period|comma|dot)\b/gi, '')
    .replace(/^[\s.:-]+|[\s.:-]+$/g, '')
    .replace(/\s{2,}/g, ' ')
  if (/You said "|MUST call|Common recovery examples|Respond as JSON only|Tool results:|narrated operational work|correct tool or include the correct action/i.test(cleaned ?? '')) return undefined
  return cleaned && cleaned !== '.' ? cleaned : undefined
}

function sessionMetadata(input: StartCanvassingSessionInput) {
  const loc = normalizeLocation(input.location)
  return JSON.stringify({
    notes: input.notes ?? null,
    startLocation: loc,
    startedFrom: input.mode === 'field' ? 'field_chat' : 'canvassing_map_mode',
  })
}

function isFieldLeadInput(input: CreateCanvassingLeadInput) {
  const source = String(input.source ?? '').toLowerCase()
  const status = String(input.status ?? '').toLowerCase()
  return source.includes('field') || source.includes('inspection') || status === 'inspection_set' || Boolean(input.metadata?.fieldInspection)
}

async function createSessionActivity(ctx: TenantContext, sessionId: string, input: { type: string; summary: string; location?: CanvassingLocationInput | null; metadata?: Record<string, unknown> | null }) {
  const loc = normalizeLocation(input.location)
  return db.canvassingActivity.create({
    data: {
      contractorId: ctx.contractorId,
      sessionId,
      userId: ctx.user?.id,
      type: input.type,
      summary: input.summary,
      latitude: loc?.lat,
      longitude: loc?.lng,
      metadataJson: input.metadata ? JSON.stringify(input.metadata) : undefined,
    },
  }).catch(() => null)
}

export async function startCanvassingSession(ctx: TenantContext, input: StartCanvassingSessionInput = {}) {
  const title = input.title?.trim() || `${input.territoryName?.trim() || 'Canvassing'} session`
  const isFieldMode = input.mode === 'field' || /field inspection|inspection run/i.test(title)
  const cardType = isFieldMode ? 'field_session' : 'canvassing_session'
  const session = await db.canvassingSession.create({
    data: {
      contractorId: ctx.contractorId,
      userId: ctx.user?.id,
      title,
      territoryName: input.territoryName?.trim() || undefined,
      status: 'active',
      metadataJson: sessionMetadata(input),
    },
  })
  await createSessionActivity(ctx, session.id, { type: 'session_started', summary: `Started ${title}`, location: input.location })
  await createGlobalCanvassingInbox(ctx, {
    type: cardType,
    title: isFieldMode ? `Field started: ${title}` : `Canvassing started: ${title}`,
    summary: isFieldMode
      ? 'Field mode is active in chat.'
      : input.territoryName ? `Territory: ${input.territoryName}` : 'A canvassing session is active.',
    payload: { sessionId: session.id, title, territoryName: input.territoryName ?? null, cardType },
  })
  return session
}

export async function updateCanvassingSession(ctx: TenantContext, sessionId: string, input: { status?: string | null; title?: string | null; territoryName?: string | null; notes?: string | null }) {
  const existing = await db.canvassingSession.findFirst({ where: { id: sessionId, contractorId: ctx.contractorId } })
  if (!existing) return null
  const existingMeta = safeJson<any>(existing.metadataJson, {})
  const isFieldMode = existingMeta?.startedFrom === 'field_chat' || /field/i.test(existing.title ?? '')
  const status = input.status ?? undefined
  const session = await db.canvassingSession.update({
    where: { id: existing.id },
    data: {
      status,
      title: input.title ?? undefined,
      territoryName: input.territoryName ?? undefined,
      endedAt: status && ['completed', 'cancelled'].includes(status) ? new Date() : undefined,
      metadataJson: input.notes ? JSON.stringify({ ...safeJson(existing.metadataJson, {}), notes: input.notes }) : undefined,
    },
  })
  if (status) {
    await createSessionActivity(ctx, session.id, { type: `session_${status}`, summary: `${isFieldMode ? 'Field session' : 'Canvassing session'} ${status}` })
  }
  return session
}

export async function createCanvassingLead(ctx: TenantContext, input: CreateCanvassingLeadInput) {
  const loc = normalizeLocation(input.location)
  const isFieldLead = isFieldLeadInput(input)
  const leadLabel = isFieldLead ? 'field inspection lead' : 'canvassing lead'
  if (input.sessionId) {
    const session = await db.canvassingSession.findFirst({ where: { id: input.sessionId, contractorId: ctx.contractorId } })
    if (!session) throw new Error(`${isFieldLead ? 'Field session' : 'Canvassing session'} not found`)
  }
  const lead = await db.canvassingLead.create({
    data: {
      contractorId: ctx.contractorId,
      sessionId: input.sessionId ?? undefined,
      createdById: ctx.user?.id,
      address: cleanFieldText(input.address),
      homeownerName: cleanFieldText(input.homeownerName),
      phone: cleanFieldText(input.phone),
      notes: cleanFieldText(input.notes),
      status: input.status ?? 'new',
      source: input.source ?? (isFieldLead ? 'field_chat' : 'canvassing_map'),
      latitude: loc?.lat,
      longitude: loc?.lng,
      metadataJson: input.metadata ? JSON.stringify(input.metadata) : undefined,
    },
  })

  const propertyMemory = await upsertPropertyMemory(ctx, {
    primaryLeadId: lead.id,
    address: lead.address,
    homeownerName: lead.homeownerName,
    phone: lead.phone,
    status: lead.status === 'follow_up' ? 'follow_up' : 'watch',
    notes: lead.notes,
    location: loc ? { lat: loc.lat, lng: loc.lng, accuracyMeters: loc.accuracyMeters ?? undefined, source: loc.source ?? (isFieldLead ? 'field_lead' : 'canvassing_lead') } : undefined,
    dataSource: { source: isFieldLead ? 'field_lead_created' : 'canvassing_lead_created', leadId: lead.id, sessionId: input.sessionId ?? null },
  }).catch(() => null)

  if (propertyMemory && lead.notes) {
    await recordPropertyObservation(ctx, {
      propertyMemoryId: propertyMemory.id,
      canvassingLeadId: lead.id,
      sessionId: input.sessionId,
      type: 'note',
      title: isFieldLead ? 'Initial field note' : 'Initial canvassing note',
      summary: lead.notes,
      location: loc ? { lat: loc.lat, lng: loc.lng, accuracyMeters: loc.accuracyMeters ?? undefined, source: loc.source ?? (isFieldLead ? 'field_lead' : 'canvassing_lead') } : undefined,
      metadata: { leadId: lead.id },
    }).catch(() => null)
  }

  await db.canvassingActivity.create({
    data: {
      contractorId: ctx.contractorId,
      sessionId: input.sessionId ?? undefined,
      leadId: lead.id,
      userId: ctx.user?.id,
      type: 'lead_created',
      summary: `Created ${leadLabel}${lead.address ? ` at ${lead.address}` : ''}`,
      latitude: loc?.lat,
      longitude: loc?.lng,
      metadataJson: JSON.stringify({ source: input.source ?? (isFieldLead ? 'field_chat' : 'canvassing_map') }),
    },
  }).catch(() => null)

  if (loc) {
    await db.fieldLocationPing.create({
      data: {
        contractorId: ctx.contractorId,
        userId: ctx.user?.id,
        canvassingLeadId: lead.id,
        latitude: loc.lat,
        longitude: loc.lng,
        accuracyMeters: loc.accuracyMeters ?? undefined,
        source: loc.source ?? (isFieldLead ? 'field_lead' : 'canvassing_lead'),
        metadataJson: JSON.stringify({ leadId: lead.id, sessionId: input.sessionId ?? null }),
      },
    }).catch(() => null)
  }

  await createGlobalCanvassingInbox(ctx, {
    type: isFieldLead ? 'field_inspection_lead' : 'canvassing_lead',
    title: `${isFieldLead ? 'New field inspection lead' : 'New canvassing lead'}${lead.address ? `: ${lead.address}` : ''}`,
    summary: lead.homeownerName ? `${lead.homeownerName}${lead.phone ? ` · ${lead.phone}` : ''}` : (lead.notes || `A new ${leadLabel} was created.`),
    payload: { cardType: isFieldLead ? 'field_inspection_lead' : 'canvassing_lead', leadId: lead.id, sessionId: lead.sessionId, address: lead.address, homeownerName: lead.homeownerName, phone: lead.phone, status: lead.status, latitude: lead.latitude, longitude: lead.longitude },
  })

  return lead
}

export async function updateCanvassingLead(ctx: TenantContext, leadId: string, input: Partial<CreateCanvassingLeadInput> & { status?: string | null }) {
  const existing = await db.canvassingLead.findFirst({ where: { id: leadId, contractorId: ctx.contractorId } })
  if (!existing) return null
  const loc = normalizeLocation(input.location)
  const lead = await db.canvassingLead.update({
    where: { id: existing.id },
    data: {
      sessionId: input.sessionId ?? undefined,
      address: input.address === undefined ? undefined : cleanFieldText(input.address),
      homeownerName: input.homeownerName === undefined ? undefined : cleanFieldText(input.homeownerName),
      phone: input.phone === undefined ? undefined : cleanFieldText(input.phone),
      notes: input.notes === undefined ? undefined : cleanFieldText(input.notes),
      status: input.status ?? undefined,
      latitude: loc?.lat,
      longitude: loc?.lng,
      metadataJson: input.metadata ? JSON.stringify({ ...safeJson(existing.metadataJson, {}), ...input.metadata }) : undefined,
    },
  })
  if (input.status && input.status !== existing.status) {
    await logCanvassingActivity(ctx, { leadId: lead.id, sessionId: lead.sessionId, type: input.status, summary: `Lead marked ${input.status.replace(/_/g, ' ')}`, location: input.location })
  }
  return lead
}

export async function logCanvassingActivity(ctx: TenantContext, input: LogCanvassingActivityInput) {
  const loc = normalizeLocation(input.location)
  let lead = input.leadId ? await db.canvassingLead.findFirst({ where: { id: input.leadId, contractorId: ctx.contractorId } }) : null
  if (!lead && !input.sessionId) throw new Error('Lead or session is required')
  if (input.sessionId) {
    const session = await db.canvassingSession.findFirst({ where: { id: input.sessionId, contractorId: ctx.contractorId } })
    if (!session) throw new Error('Canvassing session not found')
  }
  const activity = await db.canvassingActivity.create({
    data: {
      contractorId: ctx.contractorId,
      sessionId: input.sessionId ?? lead?.sessionId ?? undefined,
      leadId: lead?.id ?? undefined,
      userId: ctx.user?.id,
      type: input.type,
      summary: activitySummary(input.type, input.summary ?? input.notes),
      latitude: loc?.lat,
      longitude: loc?.lng,
      metadataJson: input.metadata ? JSON.stringify(input.metadata) : undefined,
    },
  })
  if (lead && input.status) {
    lead = await db.canvassingLead.update({ where: { id: lead.id }, data: { status: input.status, notes: input.notes ? [lead.notes, input.notes].filter(Boolean).join('\n') : undefined } })
  }

  if (lead) {
    const doorOutcomes = new Set(['knock', 'knocked', 'no_answer', 'spoke', 'interested', 'inspection_set', 'follow_up', 'not_interested', 'renter', 'no_soliciting', 'do_not_knock'])
    const normalizedType = input.status || input.type
    if (doorOutcomes.has(normalizedType)) {
      await recordDoorAttempt(ctx, {
        canvassingLeadId: lead.id,
        sessionId: input.sessionId ?? lead.sessionId,
        outcome: normalizedType === 'knock' ? 'knocked' : normalizedType,
        summary: input.summary ?? input.notes ?? activity.summary,
        nextStep: input.status === 'follow_up' ? 'Follow up with homeowner' : undefined,
        location: input.location,
        metadata: { canvassingActivityId: activity.id, source: 'canvassing_activity' },
      }).catch(() => null)
    } else {
      await recordPropertyObservation(ctx, {
        canvassingLeadId: lead.id,
        sessionId: input.sessionId ?? lead.sessionId,
        type: input.type,
        title: activitySummary(input.type),
        summary: input.summary ?? input.notes ?? activity.summary,
        location: input.location,
        metadata: { canvassingActivityId: activity.id, source: 'canvassing_activity' },
      }).catch(() => null)
    }
  }

  return { activity, lead }
}

export async function convertCanvassingLead(ctx: TenantContext, leadId: string, input: { customerName?: string | null; projectTitle?: string | null; projectValue?: number | null; notes?: string | null } = {}) {
  const lead = await db.canvassingLead.findFirst({ where: { id: leadId, contractorId: ctx.contractorId } })
  if (!lead) return null
  if (lead.projectId) {
    const project = await db.project.findFirst({ where: { id: lead.projectId, contractorId: ctx.contractorId }, include: { customer: true } })
    return { lead, customer: project?.customer ?? null, project, alreadyConverted: true }
  }

  const customerName = input.customerName?.trim() || lead.homeownerName?.trim() || lead.address?.trim() || 'Canvassing Lead'
  const customer = await db.customer.create({
    data: {
      contractorId: ctx.contractorId,
      name: customerName,
      phone: lead.phone ?? undefined,
      address: lead.address ?? undefined,
      notes: [lead.notes, input.notes, 'Created from canvassing lead'].filter(Boolean).join('\n'),
    },
  })
  const project = await db.project.create({
    data: {
      contractorId: ctx.contractorId,
      customerId: customer.id,
      title: input.projectTitle?.trim() || `${customerName} — Canvassing Lead`,
      address: lead.address ?? undefined,
      value: typeof input.projectValue === 'number' ? input.projectValue : undefined,
      status: 'active',
      priority: 'medium',
    },
  })
  const converted = await db.canvassingLead.update({ where: { id: lead.id }, data: { status: 'converted', customerId: customer.id, projectId: project.id } })
  await upsertPropertyMemory(ctx, {
    primaryLeadId: lead.id,
    customerId: customer.id,
    projectId: project.id,
    address: lead.address,
    homeownerName: lead.homeownerName,
    phone: lead.phone,
    status: 'converted',
    priority: 'high',
    summary: `Converted to project: ${project.title}`,
    location: typeof lead.latitude === 'number' && typeof lead.longitude === 'number' ? { lat: lead.latitude, lng: lead.longitude, source: 'lead_converted' } : undefined,
    dataSource: { source: 'canvassing_lead_converted', leadId: lead.id, customerId: customer.id, projectId: project.id },
  }).catch(() => null)
  await ensureProjectWorkspace(ctx, project.id, project.title, customer.id)
  await logCanvassingActivity(ctx, { leadId: lead.id, sessionId: lead.sessionId, type: 'converted', status: 'converted', summary: `Converted lead to project: ${project.title}`, metadata: { customerId: customer.id, projectId: project.id } })
  await createProjectTimelineEvent({
    contractorId: ctx.contractorId,
    projectId: project.id,
    customerId: customer.id,
    eventType: 'canvassing_lead_converted',
    title: 'Canvassing lead converted to job',
    body: lead.address ?? lead.notes,
    relatedType: 'canvassing_lead',
    relatedId: lead.id,
    actorUserId: ctx.user?.id,
    source: 'canvassing',
    metadata: { sessionId: lead.sessionId, latitude: lead.latitude, longitude: lead.longitude },
  })
  await createWorkspaceMessageForProject(ctx, project.id, {
    content: `Canvassing lead converted to project: ${project.title}`,
    contextType: 'canvassing_lead',
    contextData: { cardType: 'canvassing_lead', leadId: lead.id, projectId: project.id, customerId: customer.id, address: lead.address, status: 'converted', homeownerName: lead.homeownerName, phone: lead.phone },
  })
  return { lead: converted, customer, project, alreadyConverted: false }
}

export async function getCanvassingMap(ctx: TenantContext, options: { sessionId?: string | null; status?: string | null; includeConverted?: boolean; limit?: number } = {}) {
  const take = Math.min(Math.max(options.limit ?? 250, 1), 500)
  const leadWhere: Record<string, unknown> = { contractorId: ctx.contractorId }
  if (options.sessionId) leadWhere.sessionId = options.sessionId
  if (options.status) leadWhere.status = options.status
  if (!options.includeConverted && !options.status) leadWhere.status = { not: 'converted' }

  const [sessions, leads, activities] = await Promise.all([
    db.canvassingSession.findMany({ where: { contractorId: ctx.contractorId, status: { in: ['active', 'paused'] } }, orderBy: { startedAt: 'desc' }, take: 50 }),
    db.canvassingLead.findMany({ where: leadWhere as any, orderBy: { updatedAt: 'desc' }, take }),
    db.canvassingActivity.findMany({ where: { contractorId: ctx.contractorId, ...(options.sessionId ? { sessionId: options.sessionId } : {}) }, orderBy: { createdAt: 'desc' }, take: 100 }),
  ])

  const bounds = computeBounds(leads.filter(l => typeof l.latitude === 'number' && typeof l.longitude === 'number').map(l => ({ lat: l.latitude!, lng: l.longitude! })))
  const counts = leads.reduce<Record<string, number>>((acc, lead) => { acc[lead.status] = (acc[lead.status] ?? 0) + 1; return acc }, {})

  return {
    sessions,
    leads,
    activities,
    bounds,
    counts,
    summary: {
      activeSessions: sessions.length,
      leadCount: leads.length,
      knocked: counts.knocked ?? 0,
      interested: counts.interested ?? 0,
      followUp: counts.follow_up ?? 0,
      converted: counts.converted ?? 0,
      noAnswer: counts.no_answer ?? 0,
    },
  }
}

function computeBounds(points: Array<{ lat: number; lng: number }>) {
  if (!points.length) return null
  const lats = points.map(p => p.lat)
  const lngs = points.map(p => p.lng)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const minLng = Math.min(...lngs)
  const maxLng = Math.max(...lngs)
  const padLat = Math.max((maxLat - minLat) * 0.15, 0.0005)
  const padLng = Math.max((maxLng - minLng) * 0.15, 0.0005)
  return { minLat: minLat - padLat, maxLat: maxLat + padLat, minLng: minLng - padLng, maxLng: maxLng + padLng }
}

async function createGlobalCanvassingInbox(ctx: TenantContext, input: { type: string; title: string; summary?: string | null; payload?: Record<string, unknown> }) {
  const roles = ['sales', 'project_manager', 'owner']
  const relatedId = typeof input.payload?.leadId === 'string'
    ? input.payload.leadId
    : typeof input.payload?.sessionId === 'string'
      ? input.payload.sessionId
      : undefined

  await Promise.all(roles.map(async role => {
    if (relatedId) {
      const existing = await db.inboxItem.findFirst({
        where: {
          contractorId: ctx.contractorId,
          role,
          type: input.type,
          relatedId,
          status: { in: ['unread', 'read'] },
        },
        select: { id: true },
      }).catch(() => null)
      if (existing) return
    }

    await db.inboxItem.create({
      data: {
        contractorId: ctx.contractorId,
        userId: role === ctx.user?.role ? ctx.user?.id : undefined,
        role,
        type: input.type,
        title: input.title,
        summary: input.summary ?? undefined,
        priority: input.type === 'canvassing_lead' || input.type === 'field_inspection_lead' ? 'normal' : 'low',
        relatedType: relatedId ? input.type : undefined,
        relatedId,
        payloadJson: input.payload ? JSON.stringify(input.payload) : undefined,
      },
    }).catch(() => null)
  }))
}

async function ensureProjectWorkspace(ctx: TenantContext, projectId: string, projectTitle: string, customerId?: string | null) {
  const existing = await db.workspace.findFirst({ where: { contractorId: ctx.contractorId, projectId } })
  if (existing) return existing
  return db.workspace.create({
    data: {
      contractorId: ctx.contractorId,
      projectId,
      customerId: customerId ?? undefined,
      name: projectTitle,
      type: 'project',
      description: 'Created from canvassing lead',
      color: 'bg-emerald-600',
      chats: { create: [
        { chatType: 'main', title: 'Main', visibility: 'internal' },
        { chatType: 'sales', title: 'Sales', visibility: 'internal' },
        { chatType: 'customer', title: 'Customer', visibility: 'customer' },
      ] },
    },
  })
}

async function createWorkspaceMessageForProject(ctx: TenantContext, projectId: string, input: { content: string; contextType: string; contextData?: Record<string, unknown> }) {
  const workspace = await db.workspace.findFirst({ where: { contractorId: ctx.contractorId, projectId }, include: { chats: true } })
  const chat = workspace?.chats.find(c => c.chatType === 'main')
  if (!chat) return null
  const message = await db.workspaceMessage.create({ data: { chatId: chat.id, role: 'system', content: input.content, contextType: input.contextType, contextData: input.contextData ? JSON.stringify(input.contextData) : undefined, createdById: ctx.user?.id } }).catch(() => null)
  await db.workspaceChat.update({ where: { id: chat.id }, data: { lastActivity: new Date() } }).catch(() => null)
  return message
}
