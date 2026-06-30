import type { OfflineQueueItem, OfflineStorageLike, OfflineSyncAck, OfflineSyncResult } from './types'
import { listOfflineQueue, saveOfflineQueue } from './queue'

export type OfflineSyncPayload = {
  protocolVersion: 1
  generatedAt: string
  items: OfflineQueueItem[]
}

export type OfflineSyncDecision = {
  shouldSync: boolean
  reason: string
  pendingCount: number
}

function nowIso() {
  return new Date().toISOString()
}

export function buildOfflineSyncPayload(items: OfflineQueueItem[], limit = 50): OfflineSyncPayload {
  return {
    protocolVersion: 1,
    generatedAt: nowIso(),
    items: items
      .filter(item => item.status === 'pending_sync' || item.status === 'failed')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, Math.max(1, Math.min(limit, 200))),
  }
}

export function shouldAttemptOfflineSync(input: { isOnline?: boolean; pendingCount: number; userAllowedSync?: boolean }): OfflineSyncDecision {
  if (input.userAllowedSync === false) {
    return { shouldSync: false, reason: 'sync disabled by caller', pendingCount: input.pendingCount }
  }
  if (input.isOnline === false) {
    return { shouldSync: false, reason: 'browser reports offline', pendingCount: input.pendingCount }
  }
  if (input.pendingCount <= 0) {
    return { shouldSync: false, reason: 'no pending offline events', pendingCount: 0 }
  }
  return { shouldSync: true, reason: 'pending offline events can be synced', pendingCount: input.pendingCount }
}

export function applyOfflineSyncResult(result: OfflineSyncResult, options: { storage?: OfflineStorageLike | null; storageKey?: string } = {}) {
  const items = listOfflineQueue(options)
  const acks = new Map<string, OfflineSyncAck>()
  for (const ack of result.accepted ?? []) acks.set(ack.localId, ack)
  for (const ack of result.rejected ?? []) acks.set(ack.localId, ack)

  const next = items.map(item => {
    const ack = acks.get(item.localId)
    if (!ack) return item
    return {
      ...item,
      status: ack.status,
      serverId: ack.serverId ?? item.serverId ?? null,
      serverEventType: ack.serverEventType ?? item.serverEventType ?? null,
      error: ack.error ?? null,
      updatedAt: nowIso(),
      lastAttemptAt: nowIso(),
      attemptCount: item.attemptCount + 1,
    }
  })
  return saveOfflineQueue(next, options)
}

export function markOfflineSyncAttempt(items: OfflineQueueItem[]) {
  const attemptedAt = nowIso()
  return items.map(item => ({
    ...item,
    status: 'syncing' as const,
    lastAttemptAt: attemptedAt,
    attemptCount: item.attemptCount + 1,
    updatedAt: attemptedAt,
  }))
}

export async function flushOfflineQueue(input: {
  endpoint?: string
  storage?: OfflineStorageLike | null
  storageKey?: string
  fetchImpl?: typeof fetch
  isOnline?: boolean
  limit?: number
} = {}) {
  const items = listOfflineQueue(input)
  const payload = buildOfflineSyncPayload(items, input.limit)
  const decision = shouldAttemptOfflineSync({ isOnline: input.isOnline, pendingCount: payload.items.length })
  if (!decision.shouldSync) return { decision, payload, synced: false }

  const fetcher = input.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : null)
  if (!fetcher) return { decision: { ...decision, shouldSync: false, reason: 'fetch unavailable' }, payload, synced: false }

  const endpoint = input.endpoint ?? '/api/offline/sync'
  const response = await fetcher(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const result = await response.json().catch(() => null) as OfflineSyncResult | null
  if (!response.ok || !result) {
    return { decision: { ...decision, shouldSync: false, reason: `sync endpoint failed: ${response.status}` }, payload, synced: false }
  }
  applyOfflineSyncResult(result, input)
  return { decision, payload, synced: true, result }
}
