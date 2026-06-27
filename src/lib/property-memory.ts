import { db } from '@/lib/db'
import type { TenantContext } from '@/lib/security/context'

export type PropertyLocationInput = {
  lat?: number | null
  lng?: number | null
  latitude?: number | null
  longitude?: number | null
  accuracyMeters?: number | null
  source?: string | null
}

export type PropertyMemoryInput = {
  address?: string | null
  city?: string | null
  state?: string | null
  postalCode?: string | null
  homeownerName?: string | null
  phone?: string | null
  primaryLeadId?: string | null
  customerId?: string | null
  projectId?: string | null
  sessionId?: string | null
  propertyType?: string | null
  occupancyStatus?: string | null
  solicitationStatus?: string | null
  roofCondition?: string | null
  roofAgeSignal?: string | null
  damageSignal?: string | null
  opportunityScore?: number | null
  priority?: string | null
  status?: string | null
  summary?: string | null
  notes?: string | null
  tags?: string[] | null
  location?: PropertyLocationInput | null
  dataSource?: Record<string, unknown> | null
}

export type PropertyObservationInput = {
  propertyMemoryId?: string | null
  canvassingLeadId?: string | null
  sessionId?: string | null
  type: string
  title?: string | null
  summary?: string | null
  roofCondition?: string | null
  damageSignal?: string | null
  severity?: string | null
  confidence?: number | null
  photoDocumentId?: string | null
  location?: PropertyLocationInput | null
  metadata?: Record<string, unknown> | null
}

export type DoorAttemptInput = {
  propertyMemoryId?: string | null
  canvassingLeadId?: string | null
  sessionId?: string | null
  outcome: string
  contactName?: string | null
  contactRole?: string | null
  summary?: string | null
  scriptUsed?: string | null
  objection?: string | null
  nextStep?: string | null
  followUpAt?: string | Date | null
  location?: PropertyLocationInput | null
  metadata?: Record<string, unknown> | null
}

export type FieldObservationInput = {
  propertyMemoryId?: string | null
  canvassingLeadId?: string | null
  sessionId?: string | null
  address?: string | null
  homeownerName?: string | null
  phone?: string | null
  type?: string | null
  outcome?: string | null
  title?: string | null
  summary: string
  roofCondition?: string | null
  damageSignal?: string | null
  severity?: string | null
  confidence?: number | null
  contactName?: string | null
  contactRole?: string | null
  nextStep?: string | null
  location?: PropertyLocationInput | null
  metadata?: Record<string, unknown> | null
}

export type CanvassingGamePlanInput = {
  sessionId?: string | null
  title?: string | null
  territoryName?: string | null
  focusMode?: string | null
  energyLevel?: string | null
  customerFocus?: string | null
  timeBudgetMinutes?: number | null
  goalDoors?: number | null
  goalConversations?: number | null
  goalInspections?: number | null
  location?: PropertyLocationInput | null
  notes?: string | null
}

function safeJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try { return JSON.parse(value) as T } catch { return fallback }
}

export function normalizePropertyAddress(address?: string | null) {
  return (address || '')
    .toLowerCase()
    .replace(/\b(street)\b/g, 'st')
    .replace(/\b(road)\b/g, 'rd')
    .replace(/\b(avenue)\b/g, 'ave')
    .replace(/\b(drive)\b/g, 'dr')
    .replace(/\b(court)\b/g, 'ct')
    .replace(/\b(lane)\b/g, 'ln')
    .replace(/\b(circle)\b/g, 'cir')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function normalizeLocation(input?: PropertyLocationInput | null) {
  if (!input) return null
  const lat = typeof input.lat === 'number' ? input.lat : input.latitude
  const lng = typeof input.lng === 'number' ? input.lng : input.longitude
  if (typeof lat !== 'number' || typeof lng !== 'number') return null
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return { lat, lng, accuracyMeters: input.accuracyMeters ?? null, source: input.source ?? null }
}

function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const earth = 6371000
  const toRad = (value: number) => value * Math.PI / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * earth * Math.asin(Math.sqrt(h))
}

function parseDate(value?: string | Date | null) {
  if (!value) return undefined
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function statusFromAttempt(outcome: string) {
  const key = outcome.toLowerCase()
  if (['interested', 'inspection_set'].includes(key)) return 'prospect'
  if (['follow_up', 'spoke'].includes(key)) return 'follow_up'
  if (['no_soliciting', 'do_not_knock'].includes(key)) return 'do_not_contact'
  if (['not_interested', 'renter'].includes(key)) return 'not_fit'
  return undefined
}

function scoreFromSignals(input: PropertyMemoryInput) {
  let score = typeof input.opportunityScore === 'number' ? input.opportunityScore : 0
  const roof = (input.roofCondition || '').toLowerCase()
  const damage = (input.damageSignal || '').toLowerCase()
  const status = (input.status || '').toLowerCase()
  if (['damaged', 'missing_shingles', 'tarped', 'aged'].some(v => roof.includes(v))) score += 25
  if (damage.includes('hail') || damage.includes('wind') || damage.includes('missing')) score += 20
  if (status === 'follow_up' || status === 'prospect') score += 15
  if ((input.solicitationStatus || '') === 'no_soliciting') score -= 50
  if ((input.occupancyStatus || '') === 'renter') score -= 10
  return Math.max(0, Math.min(100, Math.round(score)))
}

export async function upsertPropertyMemory(ctx: TenantContext, input: PropertyMemoryInput) {
  const normalizedAddress = normalizePropertyAddress(input.address)
  const loc = normalizeLocation(input.location)
  const existing = normalizedAddress
    ? await db.propertyMemory.findFirst({ where: { contractorId: ctx.contractorId, normalizedAddress } })
    : input.primaryLeadId
      ? await db.propertyMemory.findFirst({ where: { contractorId: ctx.contractorId, primaryLeadId: input.primaryLeadId } })
      : null

  const data = {
    createdById: ctx.user?.id,
    primaryLeadId: input.primaryLeadId ?? undefined,
    customerId: input.customerId ?? undefined,
    projectId: input.projectId ?? undefined,
    address: input.address?.trim() || undefined,
    normalizedAddress: normalizedAddress || undefined,
    city: input.city?.trim() || undefined,
    state: input.state?.trim() || undefined,
    postalCode: input.postalCode?.trim() || undefined,
    latitude: loc?.lat,
    longitude: loc?.lng,
    propertyType: input.propertyType ?? undefined,
    occupancyStatus: input.occupancyStatus ?? undefined,
    solicitationStatus: input.solicitationStatus ?? undefined,
    roofCondition: input.roofCondition ?? undefined,
    roofAgeSignal: input.roofAgeSignal ?? undefined,
    damageSignal: input.damageSignal ?? undefined,
    opportunityScore: scoreFromSignals(input),
    priority: input.priority ?? undefined,
    status: input.status ?? undefined,
    summary: input.summary ?? undefined,
    notes: input.notes ?? undefined,
    tagsJson: input.tags ? JSON.stringify(input.tags) : undefined,
    dataSourceJson: JSON.stringify({
      ...(existing ? safeJson(existing.dataSourceJson, {}) : {}),
      ...(input.dataSource ?? {}),
      lastSource: input.dataSource?.source ?? 'manual_or_canvassing',
      homeownerName: input.homeownerName ?? undefined,
      phone: input.phone ?? undefined,
      sessionId: input.sessionId ?? undefined,
    }),
    lastObservedAt: new Date(),
  }

  if (existing) {
    return db.propertyMemory.update({ where: { id: existing.id }, data })
  }

  return db.propertyMemory.create({ data: { contractorId: ctx.contractorId, ...data } })
}

export async function recordPropertyObservation(ctx: TenantContext, input: PropertyObservationInput) {
  let propertyId = input.propertyMemoryId ?? undefined
  if (!propertyId && input.canvassingLeadId) {
    const lead = await db.canvassingLead.findFirst({ where: { id: input.canvassingLeadId, contractorId: ctx.contractorId } })
    if (lead) {
      const memory = await upsertPropertyMemory(ctx, {
        primaryLeadId: lead.id,
        address: lead.address,
        homeownerName: lead.homeownerName,
        phone: lead.phone,
        status: lead.status === 'converted' ? 'converted' : undefined,
        location: typeof lead.latitude === 'number' && typeof lead.longitude === 'number' ? { lat: lead.latitude, lng: lead.longitude, source: 'canvassing_lead' } : undefined,
        dataSource: { source: 'canvassing_lead', leadId: lead.id },
      })
      propertyId = memory.id
    }
  }
  if (!propertyId) throw new Error('propertyMemoryId or canvassingLeadId is required')
  const loc = normalizeLocation(input.location)
  const title = input.title?.trim() || input.type.replace(/_/g, ' ')
  const observation = await db.propertyObservation.create({
    data: {
      contractorId: ctx.contractorId,
      propertyMemoryId: propertyId,
      canvassingLeadId: input.canvassingLeadId ?? undefined,
      sessionId: input.sessionId ?? undefined,
      userId: ctx.user?.id,
      type: input.type,
      title: title.charAt(0).toUpperCase() + title.slice(1),
      summary: input.summary ?? undefined,
      roofCondition: input.roofCondition ?? undefined,
      damageSignal: input.damageSignal ?? undefined,
      severity: input.severity ?? undefined,
      confidence: typeof input.confidence === 'number' ? input.confidence : undefined,
      photoDocumentId: input.photoDocumentId ?? undefined,
      latitude: loc?.lat,
      longitude: loc?.lng,
      metadataJson: input.metadata ? JSON.stringify(input.metadata) : undefined,
    },
  })

  await db.propertyMemory.update({
    where: { id: propertyId },
    data: {
      lastObservedAt: new Date(),
      roofCondition: input.roofCondition ?? undefined,
      damageSignal: input.damageSignal ?? undefined,
      opportunityScore: input.roofCondition || input.damageSignal ? { increment: input.severity === 'high' ? 20 : input.severity === 'moderate' ? 12 : 5 } : undefined,
      summary: input.summary ?? undefined,
    },
  }).catch(() => null)

  return observation
}

export async function recordDoorAttempt(ctx: TenantContext, input: DoorAttemptInput) {
  let propertyId = input.propertyMemoryId ?? undefined
  let lead = input.canvassingLeadId ? await db.canvassingLead.findFirst({ where: { id: input.canvassingLeadId, contractorId: ctx.contractorId } }) : null
  if (!propertyId && lead) {
    const memory = await upsertPropertyMemory(ctx, {
      primaryLeadId: lead.id,
      address: lead.address,
      homeownerName: lead.homeownerName,
      phone: lead.phone,
      location: typeof lead.latitude === 'number' && typeof lead.longitude === 'number' ? { lat: lead.latitude, lng: lead.longitude, source: 'canvassing_lead' } : undefined,
      status: lead.status === 'converted' ? 'converted' : undefined,
      dataSource: { source: 'door_attempt', leadId: lead.id },
    })
    propertyId = memory.id
  }
  if (!propertyId) throw new Error('propertyMemoryId or canvassingLeadId is required')
  const loc = normalizeLocation(input.location)
  const attempt = await db.doorAttempt.create({
    data: {
      contractorId: ctx.contractorId,
      propertyMemoryId: propertyId,
      canvassingLeadId: input.canvassingLeadId ?? undefined,
      sessionId: input.sessionId ?? lead?.sessionId ?? undefined,
      userId: ctx.user?.id,
      outcome: input.outcome,
      contactName: input.contactName ?? undefined,
      contactRole: input.contactRole ?? undefined,
      summary: input.summary ?? undefined,
      scriptUsed: input.scriptUsed ?? undefined,
      objection: input.objection ?? undefined,
      nextStep: input.nextStep ?? undefined,
      followUpAt: parseDate(input.followUpAt),
      latitude: loc?.lat,
      longitude: loc?.lng,
      metadataJson: input.metadata ? JSON.stringify(input.metadata) : undefined,
    },
  })

  const memoryStatus = statusFromAttempt(input.outcome)
  await db.propertyMemory.update({
    where: { id: propertyId },
    data: {
      lastKnockedAt: new Date(),
      nextFollowUpAt: parseDate(input.followUpAt),
      status: memoryStatus ?? undefined,
      solicitationStatus: ['no_soliciting', 'do_not_knock'].includes(input.outcome) ? input.outcome : undefined,
      occupancyStatus: input.outcome === 'renter' ? 'renter' : undefined,
      summary: input.summary ?? undefined,
    },
  }).catch(() => null)

  if (lead && input.outcome && input.outcome !== lead.status) {
    await db.canvassingLead.update({ where: { id: lead.id }, data: { status: input.outcome, notes: input.summary ? [lead.notes, input.summary].filter(Boolean).join('\n') : undefined } }).catch(() => null)
  }

  await updateStreetMemoryFromAttempt(ctx, propertyId, input.outcome)
  return attempt
}

export async function recordFieldObservation(ctx: TenantContext, input: FieldObservationInput) {
  const loc = normalizeLocation(input.location)
  let propertyMemoryId = input.propertyMemoryId ?? undefined
  let canvassingLeadId = input.canvassingLeadId ?? undefined
  let matchedLead: { id: string; sessionId: string | null; address: string | null; homeownerName: string | null; phone: string | null; latitude: number | null; longitude: number | null } | null = null
  let matchedExistingMemory = Boolean(input.propertyMemoryId)

  if (!propertyMemoryId && !canvassingLeadId && loc) {
    const leads = await db.canvassingLead.findMany({
      where: { contractorId: ctx.contractorId, latitude: { not: null }, longitude: { not: null } },
      orderBy: { updatedAt: 'desc' },
      take: 200,
      select: { id: true, sessionId: true, address: true, homeownerName: true, phone: true, latitude: true, longitude: true },
    })
    matchedLead = leads
      .map(lead => ({
        lead,
        distance: typeof lead.latitude === 'number' && typeof lead.longitude === 'number'
          ? distanceMeters(loc, { lat: lead.latitude, lng: lead.longitude })
          : Number.POSITIVE_INFINITY,
      }))
      .filter(candidate => candidate.distance <= 75)
      .sort((a, b) => a.distance - b.distance)[0]?.lead ?? null
    if (matchedLead) canvassingLeadId = matchedLead.id
  }

  if (!propertyMemoryId && !canvassingLeadId && loc) {
    const memories = await db.propertyMemory.findMany({
      where: { contractorId: ctx.contractorId, latitude: { not: null }, longitude: { not: null } },
      orderBy: { lastObservedAt: 'desc' },
      take: 200,
      select: { id: true, latitude: true, longitude: true },
    })
    const nearestMemory = memories
      .map(memory => ({
        memory,
        distance: typeof memory.latitude === 'number' && typeof memory.longitude === 'number'
          ? distanceMeters(loc, { lat: memory.latitude, lng: memory.longitude })
          : Number.POSITIVE_INFINITY,
      }))
      .filter(candidate => candidate.distance <= 75)
      .sort((a, b) => a.distance - b.distance)[0]?.memory ?? null
    if (nearestMemory) {
      propertyMemoryId = nearestMemory.id
      matchedExistingMemory = true
    }
  }

  if (!propertyMemoryId && !canvassingLeadId) {
    if (!loc && !input.address) throw new Error('Location, address, propertyMemoryId, or canvassingLeadId is required')
    const property = await upsertPropertyMemory(ctx, {
      address: input.address,
      homeownerName: input.homeownerName,
      phone: input.phone,
      sessionId: input.sessionId,
      location: input.location,
      roofCondition: input.roofCondition,
      damageSignal: input.damageSignal,
      summary: input.summary,
      status: input.outcome === 'inspection_set' || input.outcome === 'interested' ? 'prospect' : undefined,
      solicitationStatus: input.outcome === 'no_soliciting' || input.outcome === 'do_not_knock' ? input.outcome : undefined,
      occupancyStatus: input.outcome === 'renter' ? 'renter' : undefined,
      dataSource: { source: 'field_observation', userId: ctx.user?.id },
    })
    propertyMemoryId = property.id
  }

  const doorOutcomes = new Set(['knocked', 'no_answer', 'spoke', 'interested', 'inspection_set', 'follow_up', 'not_interested', 'renter', 'no_soliciting', 'do_not_knock'])
  const normalizedOutcome = input.outcome?.trim()
  const result = normalizedOutcome && doorOutcomes.has(normalizedOutcome)
    ? await recordDoorAttempt(ctx, {
        propertyMemoryId,
        canvassingLeadId,
        sessionId: input.sessionId ?? matchedLead?.sessionId,
        outcome: normalizedOutcome,
        contactName: input.contactName,
        contactRole: input.contactRole,
        summary: input.summary,
        nextStep: input.nextStep,
        location: input.location,
        metadata: { ...(input.metadata ?? {}), source: 'field_observation' },
      })
    : await recordPropertyObservation(ctx, {
        propertyMemoryId,
        canvassingLeadId,
        sessionId: input.sessionId ?? matchedLead?.sessionId,
        type: input.type?.trim() || 'field_observation',
        title: input.title,
        summary: input.summary,
        roofCondition: input.roofCondition,
        damageSignal: input.damageSignal,
        severity: input.severity,
        confidence: input.confidence,
        location: input.location,
        metadata: { ...(input.metadata ?? {}), source: 'field_observation' },
      })

  const activitySessionId = input.sessionId ?? matchedLead?.sessionId
  if (canvassingLeadId || activitySessionId) {
    await db.canvassingActivity.create({
      data: {
        contractorId: ctx.contractorId,
        sessionId: activitySessionId ?? undefined,
        leadId: canvassingLeadId ?? undefined,
        userId: ctx.user?.id,
        type: normalizedOutcome ?? input.type?.trim() ?? 'field_observation',
        summary: input.summary.slice(0, 1000),
        latitude: loc?.lat,
        longitude: loc?.lng,
        metadataJson: JSON.stringify({
          ...(input.metadata ?? {}),
          source: 'field_observation',
          propertyMemoryId,
          observationType: input.type,
          outcome: normalizedOutcome,
        }),
      },
    }).catch(() => null)
  }

  if (loc) {
    await db.fieldLocationPing.create({
      data: {
        contractorId: ctx.contractorId,
        userId: ctx.user?.id,
        canvassingLeadId,
        latitude: loc.lat,
        longitude: loc.lng,
        accuracyMeters: loc.accuracyMeters ?? undefined,
        source: loc.source ?? 'field_observation',
        metadataJson: JSON.stringify({
          propertyMemoryId,
          observationType: input.type,
          outcome: normalizedOutcome,
          summary: input.summary.slice(0, 500),
          source: 'field_observation',
        }),
      },
    }).catch(() => null)
  }

  return {
    result,
    propertyMemoryId,
    canvassingLeadId,
    matchedExisting: Boolean(matchedLead || matchedExistingMemory || input.canvassingLeadId),
    locationCaptured: Boolean(loc),
  }
}

async function updateStreetMemoryFromAttempt(ctx: TenantContext, propertyMemoryId: string, outcome: string) {
  const property = await db.propertyMemory.findFirst({ where: { id: propertyMemoryId, contractorId: ctx.contractorId } })
  if (!property?.address) return null
  const streetName = extractStreetName(property.address)
  if (!streetName) return null
  const existing = await db.streetMemory.findFirst({ where: { contractorId: ctx.contractorId, streetName, city: property.city ?? undefined, state: property.state ?? undefined } })
  const increments: Record<string, number> = { totalAttempts: 1 }
  if (['spoke', 'interested', 'inspection_set', 'follow_up'].includes(outcome)) increments.conversations = 1
  if (outcome === 'inspection_set') increments.inspectionsSet = 1
  if (outcome === 'no_answer') increments.noAnswers = 1
  if (['no_soliciting', 'do_not_knock'].includes(outcome)) increments.doNotKnockCount = 1
  if (existing) {
    return db.streetMemory.update({ where: { id: existing.id }, data: { lastWorkedAt: new Date(), lastWorkedById: ctx.user?.id, totalAttempts: { increment: 1 }, conversations: increments.conversations ? { increment: 1 } : undefined, inspectionsSet: increments.inspectionsSet ? { increment: 1 } : undefined, noAnswers: increments.noAnswers ? { increment: 1 } : undefined, doNotKnockCount: increments.doNotKnockCount ? { increment: 1 } : undefined } })
  }
  return db.streetMemory.create({ data: { contractorId: ctx.contractorId, streetName, city: property.city ?? undefined, state: property.state ?? undefined, lastWorkedAt: new Date(), lastWorkedById: ctx.user?.id, totalAttempts: 1, conversations: increments.conversations ?? 0, inspectionsSet: increments.inspectionsSet ?? 0, noAnswers: increments.noAnswers ?? 0, doNotKnockCount: increments.doNotKnockCount ?? 0 } })
}

function extractStreetName(address: string) {
  const withoutNumber = address.replace(/^\s*\d+\s+/, '')
  return withoutNumber.split(',')[0]?.trim() || null
}

export async function getPropertyMemoryContext(ctx: TenantContext, input: { propertyMemoryId?: string | null; canvassingLeadId?: string | null; address?: string | null; status?: string | null; limit?: number | null } = {}) {
  const take = Math.min(Math.max(input.limit ?? 50, 1), 250)
  let where: Record<string, unknown> = { contractorId: ctx.contractorId }
  if (input.propertyMemoryId) where.id = input.propertyMemoryId
  else if (input.canvassingLeadId) where.primaryLeadId = input.canvassingLeadId
  else if (input.address) where.normalizedAddress = normalizePropertyAddress(input.address)
  else if (input.status) where.status = input.status

  const properties = await db.propertyMemory.findMany({ where: where as any, orderBy: [{ priority: 'desc' as any }, { updatedAt: 'desc' }], take })
  const ids = properties.map(p => p.id)
  const [observations, attempts, streets] = await Promise.all([
    ids.length ? db.propertyObservation.findMany({ where: { contractorId: ctx.contractorId, propertyMemoryId: { in: ids } }, orderBy: { observedAt: 'desc' }, take: take * 3 }) : [],
    ids.length ? db.doorAttempt.findMany({ where: { contractorId: ctx.contractorId, propertyMemoryId: { in: ids } }, orderBy: { createdAt: 'desc' }, take: take * 3 }) : [],
    db.streetMemory.findMany({ where: { contractorId: ctx.contractorId }, orderBy: { lastWorkedAt: 'desc' }, take: 50 }),
  ])
  return { properties, observations, attempts, streets, summary: summarizePropertyMemory(properties, observations, attempts) }
}

function summarizePropertyMemory(properties: any[], observations: any[], attempts: any[]) {
  const hot = properties.filter(p => ['hot', 'high'].includes(p.priority) || p.opportunityScore >= 70)
  const followUps = properties.filter(p => p.status === 'follow_up' || p.nextFollowUpAt)
  const doNotKnock = properties.filter(p => ['no_soliciting', 'do_not_knock'].includes(p.solicitationStatus))
  return {
    propertyCount: properties.length,
    hotCount: hot.length,
    followUpCount: followUps.length,
    doNotKnockCount: doNotKnock.length,
    observationCount: observations.length,
    attemptCount: attempts.length,
  }
}

export async function createCanvassingGamePlan(ctx: TenantContext, input: CanvassingGamePlanInput = {}) {
  const focusMode = input.focusMode || 'partner_choice'
  const title = input.title?.trim() || `${humanize(focusMode)} game plan`
  const memory = await getPropertyMemoryContext(ctx, { limit: 150 })
  const recs = buildGamePlanRecommendations(input, memory)
  const plan = await db.canvassingGamePlan.create({
    data: {
      contractorId: ctx.contractorId,
      userId: ctx.user?.id,
      sessionId: input.sessionId ?? undefined,
      title,
      territoryName: input.territoryName ?? undefined,
      focusMode,
      energyLevel: input.energyLevel ?? undefined,
      customerFocus: input.customerFocus ?? undefined,
      timeBudgetMinutes: input.timeBudgetMinutes ?? undefined,
      goalDoors: input.goalDoors ?? recs.goals.doors,
      goalConversations: input.goalConversations ?? recs.goals.conversations,
      goalInspections: input.goalInspections ?? recs.goals.inspections,
      status: 'draft',
      strategySummary: recs.summary,
      recommendedStart: recs.recommendedStart,
      avoidNotes: recs.avoidNotes,
      scriptSuggestion: recs.scriptSuggestion,
      kpiSnapshotJson: JSON.stringify(memory.summary),
      recommendationsJson: JSON.stringify(recs.recommendations),
    },
  })
  return { plan, recommendations: recs, memorySummary: memory.summary }
}

function buildGamePlanRecommendations(input: CanvassingGamePlanInput, memory: Awaited<ReturnType<typeof getPropertyMemoryContext>>) {
  const focus = input.focusMode || 'partner_choice'
  const energy = input.energyLevel || 'medium'
  const warm = energy === 'low' || energy === 'warmup'
  const followUps = memory.properties.filter((p: any) => p.status === 'follow_up' || p.nextFollowUpAt).slice(0, 8)
  const hot = memory.properties.filter((p: any) => p.opportunityScore >= 60 && !['do_not_knock', 'no_soliciting'].includes(p.solicitationStatus)).slice(0, 8)
  const avoid = memory.properties.filter((p: any) => ['do_not_knock', 'no_soliciting'].includes(p.solicitationStatus)).slice(0, 5)
  const goals = warm ? { doors: 12, conversations: 4, inspections: 1 } : { doors: 25, conversations: 8, inspections: 2 }
  const focusLine: Record<string, string> = {
    fresh_hail: 'Focus on homes with recent storm exposure signals and clean first-touch opportunities.',
    follow_ups: 'Start with homeowners who already had a touch, note, or follow-up reason.',
    higher_value: 'Prioritize larger/high-opportunity roof prospects and slower, higher-upside conversations.',
    easy_conversations: 'Warm up with follow-ups and lower-friction conversations before cold doors.',
    old_damage: 'Look for aged roofs, visible wear, missing shingles, tarps, or prior noted damage.',
    close_to_current_jobs: 'Work around active jobs and familiar streets where the company already has context.',
    partner_choice: 'Pick the route based on your mindset, energy, and best nearby opportunity.'
  }
  const recommendations = [
    { label: 'Warm follow-ups', count: followUps.length, properties: followUps.map((p: any) => ({ id: p.id, address: p.address, reason: p.summary || p.damageSignal || 'follow-up opportunity' })) },
    { label: 'Hot property memory', count: hot.length, properties: hot.map((p: any) => ({ id: p.id, address: p.address, score: p.opportunityScore, reason: p.damageSignal || p.roofCondition || 'high opportunity score' })) },
    { label: 'Avoid / respect signs', count: avoid.length, properties: avoid.map((p: any) => ({ id: p.id, address: p.address, reason: p.solicitationStatus })) },
  ]
  return {
    summary: `${focusLine[focus] || focusLine.partner_choice} ${warm ? 'Let’s build momentum first, then move into harder doors.' : 'You have enough energy for a stronger run.'}`,
    recommendedStart: followUps[0]?.address || hot[0]?.address || input.territoryName || 'Start with the nearest high-confidence street and adjust after 10 doors.',
    avoidNotes: avoid.length ? `Respect ${avoid.length} do-not-knock/no-soliciting property memories in this territory.` : 'No do-not-knock property memories found in the current sample.',
    scriptSuggestion: scriptForFocus(focus),
    recommendations,
    goals,
  }
}

function scriptForFocus(focus: string) {
  if (focus === 'fresh_hail') return 'Hey, I’m checking homes in the area after the storm came through. We’re helping homeowners document possible roof and exterior damage before it gets worse.'
  if (focus === 'follow_ups') return 'Hey, I’m circling back from when we were in the area. I had a note to follow up and make sure you had what you needed after the storm.'
  if (focus === 'easy_conversations') return 'Hey, quick question — did you notice anything from the storm, or has anyone checked the roof since it came through?'
  if (focus === 'old_damage') return 'Hey, we’re checking older roofs in the neighborhood because storm damage can be hard to spot from the ground.'
  return 'Hey, we’re working in the neighborhood and helping homeowners understand whether the recent weather affected their roof or exterior.'
}

function humanize(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}
