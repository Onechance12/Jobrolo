import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { recordActivitySpineEvent } from '@/lib/activity-spine'
import { requireContext } from '@/lib/security/context'

type OfflineSyncAccepted = {
  localId: string
  status: 'synced'
  serverId: string | null
  serverEventType: string
}

type OfflineSyncRejected = {
  localId: string
  status: 'failed'
  error: string
}

const LocationSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  accuracyMeters: z.number().optional(),
  source: z.string().optional(),
  capturedAt: z.string(),
}).optional().nullable()

const EntityRefsSchema = z.object({
  contractorId: z.string().optional().nullable(),
  userId: z.string().optional().nullable(),
  customerId: z.string().optional().nullable(),
  projectId: z.string().optional().nullable(),
  workspaceId: z.string().optional().nullable(),
  chatId: z.string().optional().nullable(),
  documentId: z.string().optional().nullable(),
  propertyMemoryId: z.string().optional().nullable(),
  fieldSessionId: z.string().optional().nullable(),
  localOnlyEntityId: z.string().optional().nullable(),
})

const OfflineItemSchema = EntityRefsSchema.extend({
  localId: z.string().min(1).max(160),
  type: z.enum([
    'chat_draft.created',
    'field_observation.created',
    'lead.created',
    'door_attempt.recorded',
    'inspection.started',
    'photo_evidence.captured',
    'document_intake.captured',
    'activity_note.created',
  ]),
  scope: z.string().max(80),
  status: z.string().max(80),
  payload: z.record(z.string(), z.unknown()).default({}),
  location: LocationSchema,
  source: z.enum(['chat', 'field', 'upload', 'camera', 'voice', 'ar_capture', 'system']).default('chat'),
  createdAt: z.string(),
  updatedAt: z.string(),
  attemptCount: z.number().int().min(0).max(100).default(0),
})

const SyncSchema = z.object({
  protocolVersion: z.literal(1),
  generatedAt: z.string(),
  items: z.array(OfflineItemSchema).max(100),
})

function titleFor(item: z.infer<typeof OfflineItemSchema>) {
  const payloadTitle = typeof item.payload.title === 'string' ? item.payload.title.trim() : ''
  const payloadSummary = typeof item.payload.summary === 'string' ? item.payload.summary.trim() : ''
  if (payloadTitle) return payloadTitle.slice(0, 160)
  if (payloadSummary) return payloadSummary.slice(0, 160)
  return item.type.replace(/[._]/g, ' ')
}

function summaryFor(item: z.infer<typeof OfflineItemSchema>) {
  const summary = typeof item.payload.summary === 'string' ? item.payload.summary.trim() : ''
  const note = typeof item.payload.note === 'string' ? item.payload.note.trim() : ''
  const text = summary || note || `Offline ${item.type.replace(/[._]/g, ' ')} synced from ${item.source}.`
  return text.slice(0, 500)
}

function activityTypeFor(itemType: z.infer<typeof OfflineItemSchema>['type']) {
  switch (itemType) {
    case 'field_observation.created':
      return 'field_observation'
    case 'lead.created':
      return 'lead_created'
    case 'inspection.started':
      return 'inspection_started'
    case 'photo_evidence.captured':
      return 'photo_evidence'
    case 'document_intake.captured':
      return 'upload_saved'
    default:
      return 'proactive_suggestion'
  }
}

export async function POST(req: NextRequest) {
  const ctx = await requireContext(req)
  const body = await req.json().catch(() => null)
  const parsed = SyncSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid offline sync payload', details: parsed.error.flatten() }, { status: 400 })
  }

  const accepted: OfflineSyncAccepted[] = []
  const rejected: OfflineSyncRejected[] = []

  for (const item of parsed.data.items) {
    if (item.contractorId && item.contractorId !== ctx.contractorId) {
      rejected.push({ localId: item.localId, status: 'failed', error: 'Offline event contractor mismatch.' })
      continue
    }

    try {
      const hasWritableTimelineContext = Boolean(item.projectId)
      if (!hasWritableTimelineContext) {
        accepted.push({
          localId: item.localId,
          status: 'synced',
          serverId: null,
          serverEventType: 'offline_ack_only',
        })
        continue
      }

      const result = await recordActivitySpineEvent({
        contractorId: ctx.contractorId,
        userId: ctx.user?.id ?? item.userId ?? null,
        customerId: item.customerId ?? null,
        projectId: item.projectId ?? null,
        workspaceId: item.workspaceId ?? null,
        chatId: item.chatId ?? null,
        documentId: item.documentId ?? null,
        relatedType: item.documentId ? 'document' : 'offline_event',
        relatedId: item.documentId ?? item.localOnlyEntityId ?? item.localId,
        type: activityTypeFor(item.type),
        source: item.source === 'upload' ? 'upload' : item.source === 'field' || item.source === 'camera' || item.source === 'ar_capture' ? 'field' : 'chat',
        title: titleFor(item),
        summary: summaryFor(item),
        location: item.location ?? null,
        confidence: typeof item.payload.confidence === 'number' ? item.payload.confidence : 0.7,
        confirmed: false,
        metadata: {
          offlineLocalId: item.localId,
          offlineEventType: item.type,
          offlineSource: item.source,
          payload: item.payload,
        },
      })
      accepted.push({
        localId: item.localId,
        status: 'synced',
        serverId: result.timelineEvent?.id ?? null,
        serverEventType: result.normalized.timelineEventType,
      })
    } catch (err) {
      rejected.push({
        localId: item.localId,
        status: 'failed',
        error: err instanceof Error ? err.message.slice(0, 500) : 'Offline sync failed.',
      })
    }
  }

  return NextResponse.json({ accepted, rejected })
}
