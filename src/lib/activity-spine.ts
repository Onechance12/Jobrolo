export type ActivitySpineEventType =
  | 'upload_saved'
  | 'upload_classified'
  | 'photo_evidence'
  | 'field_observation'
  | 'lead_created'
  | 'inspection_started'
  | 'approval_requested'
  | 'approval_completed'
  | 'report_created'
  | 'cody_note'
  | 'context_resolved'
  | 'proactive_suggestion'

export type ActivitySpineSource = 'chat' | 'upload' | 'field' | 'cody' | 'agent' | 'system'

export type ActivitySpineLocation = {
  latitude?: number | null
  longitude?: number | null
  accuracyMeters?: number | null
  source?: string | null
  capturedAt?: string | Date | null
}

export type ActivitySpineEntityContext = {
  contractorId: string
  customerId?: string | null
  projectId?: string | null
  workspaceId?: string | null
  chatId?: string | null
  documentId?: string | null
  userId?: string | null
  relatedType?: string | null
  relatedId?: string | null
}

export type ActivitySpineEvent = ActivitySpineEntityContext & {
  type: ActivitySpineEventType
  source: ActivitySpineSource
  title: string
  summary?: string | null
  location?: ActivitySpineLocation | null
  confidence?: number | null
  confirmed?: boolean
  metadata?: Record<string, unknown> | null
}

export type NormalizedActivitySpineEvent = ActivitySpineEvent & {
  activityKey: string
  timelineEventType: string
  shouldWriteProjectTimeline: boolean
  memorySummary: string
}

function compactText(value: string | null | undefined, fallback = '') {
  const compact = String(value ?? fallback).replace(/\s+/g, ' ').trim()
  return compact.length > 420 ? `${compact.slice(0, 417)}...` : compact
}

function boundedConfidence(value: number | null | undefined) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0.65
  return Math.max(0, Math.min(1, value))
}

function locationSummary(location: ActivitySpineLocation | null | undefined) {
  if (!location?.latitude || !location?.longitude) return ''
  const accuracy = typeof location.accuracyMeters === 'number'
    ? ` ±${Math.round(location.accuracyMeters)}m`
    : ''
  return ` GPS ${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}${accuracy}`
}

export function normalizeActivitySpineEvent(event: ActivitySpineEvent): NormalizedActivitySpineEvent {
  const title = compactText(event.title, event.type)
  const summary = compactText(event.summary, title)
  const confidence = boundedConfidence(event.confidence)
  const location = event.location ?? null
  const relatedType = event.relatedType ?? (event.documentId ? 'document' : undefined)
  const relatedId = event.relatedId ?? event.documentId ?? undefined
  const projectContext = Boolean(event.projectId)
  const shouldWriteProjectTimeline = projectContext && event.type !== 'context_resolved'
  const activityKey = [
    event.contractorId,
    event.projectId ?? 'no-project',
    event.customerId ?? 'no-customer',
    event.documentId ?? relatedId ?? 'no-related',
    event.type,
    event.source,
  ].join(':')

  return {
    ...event,
    title,
    summary,
    confidence,
    location,
    relatedType,
    relatedId,
    activityKey,
    timelineEventType: event.type,
    shouldWriteProjectTimeline,
    memorySummary: `${title}${summary && summary !== title ? ` — ${summary}` : ''}${locationSummary(location)}`,
  }
}

export function activitySpineEventToTimelineInput(event: NormalizedActivitySpineEvent) {
  if (!event.projectId) return null
  return {
    contractorId: event.contractorId,
    projectId: event.projectId,
    customerId: event.customerId,
    eventType: event.timelineEventType,
    title: event.title,
    body: event.summary ?? undefined,
    relatedType: event.relatedType ?? undefined,
    relatedId: event.relatedId ?? undefined,
    source: event.source,
    actorUserId: event.userId ?? undefined,
    metadata: {
      ...(event.metadata ?? {}),
      activityKey: event.activityKey,
      confidence: event.confidence,
      confirmed: event.confirmed ?? false,
      workspaceId: event.workspaceId ?? undefined,
      chatId: event.chatId ?? undefined,
      documentId: event.documentId ?? undefined,
      location: event.location ?? undefined,
    },
  }
}

export async function recordActivitySpineEvent(event: ActivitySpineEvent) {
  const normalized = normalizeActivitySpineEvent(event)
  const timelineInput = activitySpineEventToTimelineInput(normalized)
  if (!timelineInput || !normalized.shouldWriteProjectTimeline) {
    return { normalized, timelineEvent: null }
  }
  const { createProjectTimelineEvent } = await import('./project-context')
  const timelineEvent = await createProjectTimelineEvent(timelineInput)
  return { normalized, timelineEvent }
}

export function renderActivitySpineMemory(events: ActivitySpineEvent[], limit = 5) {
  const normalized = events.map(normalizeActivitySpineEvent).slice(0, limit)
  if (!normalized.length) return ''
  return normalized
    .map(event => `- ${event.type} from ${event.source}: ${event.memorySummary}`)
    .join('\n')
}
