import { createHash } from 'node:crypto'
import { db } from '@/lib/db'
import { createRoleNotification } from '@/lib/notifications'
import { buildCodyPacket, inferCodyArea, inferCodySeverity, type CodySeverity } from '@/lib/cody/packet'

type CodyObservationInput = {
  contractorId: string
  trigger: string
  content: string
  source?: 'agent_loop' | 'tool_result' | 'document_worker' | 'api'
  severity?: CodySeverity
  area?: string
  relatedType?: string | null
  relatedId?: string | null
  debugContext?: Record<string, unknown>
  recentMessages?: Array<{ role?: string | null; text?: string | null; source?: string | null; createdAt?: unknown }>
}

function safeSummary(text: string, max = 320) {
  return text.replace(/\s+/g, ' ').trim().slice(0, max)
}

function fingerprintFor(input: CodyObservationInput) {
  const basis = [
    input.contractorId,
    input.source ?? 'unknown',
    input.trigger,
    input.area ?? '',
    input.relatedType ?? '',
    input.relatedId ?? '',
    safeSummary(input.content, 500),
  ].join('|')
  return createHash('sha256').update(basis).digest('hex').slice(0, 24)
}

function safeJson(payloadJson: string | null) {
  if (!payloadJson) return {}
  try {
    const parsed = JSON.parse(payloadJson)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

export async function recordCodyObservation(input: CodyObservationInput) {
  const content = input.content.trim()
  if (!content) return null

  const area = inferCodyArea(content, input.area)
  const severity = input.severity ?? inferCodySeverity(content)
  const fingerprint = fingerprintFor({ ...input, area, severity })
  const relatedType = input.relatedType ?? 'cody_observation'
  const relatedId = input.relatedId ?? `cody:${fingerprint}`
  const nowIso = new Date().toISOString()

  const packet = buildCodyPacket({
    content,
    area,
    severity,
    title: `Cody Observation: ${area}`,
    debugContext: input.debugContext ?? null,
    recentMessages: input.recentMessages ?? null,
    relevantIds: {
      contractorId: input.contractorId,
      relatedType,
      relatedId,
      trigger: input.trigger,
      source: input.source ?? 'agent_loop',
    },
  })

  const existing = await db.inboxItem.findFirst({
    where: {
      contractorId: input.contractorId,
      type: 'cody_observation',
      relatedType,
      relatedId,
      status: { in: ['unread', 'read'] },
    },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, payloadJson: true },
  }).catch(() => null)

  const payload = {
    cardType: 'cody_observation',
    source: input.source ?? 'agent_loop',
    trigger: input.trigger,
    content,
    area,
    severity,
    fingerprint,
    firstSeenAt: nowIso,
    lastSeenAt: nowIso,
    occurrenceCount: 1,
    debugContext: input.debugContext ?? null,
    recentMessages: input.recentMessages ?? null,
    codyPacket: packet,
  }

  if (existing) {
    const previous = safeJson(existing.payloadJson)
    const occurrenceCount = Number(previous.occurrenceCount ?? 1) + 1
    return db.inboxItem.update({
      where: { id: existing.id },
      data: {
        summary: safeSummary(content),
        priority: severity,
        payloadJson: JSON.stringify({
          ...previous,
          ...payload,
          firstSeenAt: previous.firstSeenAt ?? payload.firstSeenAt,
          occurrenceCount,
        }),
      },
    }).catch(() => null)
  }

  return createRoleNotification({
    contractorId: input.contractorId,
    role: 'owner',
    type: 'cody_observation',
    title: `Cody Observation: ${area}`,
    summary: safeSummary(content),
    priority: severity,
    relatedType,
    relatedId,
    payload,
  }).catch(() => null)
}
