import type { OfflineQueueInput, OfflineQueueItem, OfflineQueueStatus, OfflineStorageLike } from './types'

export const OFFLINE_QUEUE_STORAGE_KEY = 'jobrolo.offline.queue.v1'

export function getBrowserOfflineStorage(): OfflineStorageLike | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function nowIso() {
  return new Date().toISOString()
}

function toIso(value: string | Date | undefined) {
  if (!value) return nowIso()
  return value instanceof Date ? value.toISOString() : value
}

function safeParseQueue(raw: string | null): OfflineQueueItem[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isQueueItem)
  } catch {
    return []
  }
}

function isQueueItem(value: unknown): value is OfflineQueueItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return typeof item.localId === 'string'
    && typeof item.type === 'string'
    && typeof item.scope === 'string'
    && typeof item.status === 'string'
    && typeof item.payload === 'object'
    && item.payload !== null
}

function writeQueue(storage: OfflineStorageLike | null, key: string, items: OfflineQueueItem[]) {
  if (!storage) return
  storage.setItem(key, JSON.stringify(items))
}

export function createOfflineQueueItem(input: OfflineQueueInput, localId = `offline_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`): OfflineQueueItem {
  const createdAt = toIso(input.createdAt)
  return {
    localId,
    type: input.type,
    scope: input.scope ?? 'unknown',
    status: 'pending_sync',
    payload: input.payload,
    location: input.location ?? null,
    source: input.source ?? 'chat',
    contractorId: input.contractorId ?? null,
    userId: input.userId ?? null,
    customerId: input.customerId ?? null,
    projectId: input.projectId ?? null,
    workspaceId: input.workspaceId ?? null,
    chatId: input.chatId ?? null,
    documentId: input.documentId ?? null,
    propertyMemoryId: input.propertyMemoryId ?? null,
    fieldSessionId: input.fieldSessionId ?? null,
    localOnlyEntityId: input.localOnlyEntityId ?? null,
    createdAt,
    updatedAt: createdAt,
    lastAttemptAt: null,
    attemptCount: 0,
    error: null,
    serverId: null,
    serverEventType: null,
  }
}

export function listOfflineQueue(options: { storage?: OfflineStorageLike | null; storageKey?: string } = {}) {
  const storage = options.storage ?? getBrowserOfflineStorage()
  const key = options.storageKey ?? OFFLINE_QUEUE_STORAGE_KEY
  return safeParseQueue(storage?.getItem(key) ?? null)
}

export function saveOfflineQueue(items: OfflineQueueItem[], options: { storage?: OfflineStorageLike | null; storageKey?: string; maxItems?: number } = {}) {
  const storage = options.storage ?? getBrowserOfflineStorage()
  const key = options.storageKey ?? OFFLINE_QUEUE_STORAGE_KEY
  const maxItems = options.maxItems ?? 500
  const safe = items
    .filter(isQueueItem)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-maxItems)
  writeQueue(storage, key, safe)
  return safe
}

export function enqueueOfflineEvent(input: OfflineQueueInput, options: { storage?: OfflineStorageLike | null; storageKey?: string; maxItems?: number } = {}) {
  const current = listOfflineQueue(options)
  const item = createOfflineQueueItem(input)
  const items = saveOfflineQueue([...current, item], options)
  return { item, items }
}

export function updateOfflineQueueItem(localId: string, patch: Partial<OfflineQueueItem>, options: { storage?: OfflineStorageLike | null; storageKey?: string } = {}) {
  const items = listOfflineQueue(options)
  const updated = items.map(item => item.localId === localId
    ? { ...item, ...patch, localId: item.localId, updatedAt: nowIso() }
    : item)
  saveOfflineQueue(updated, options)
  return updated.find(item => item.localId === localId) ?? null
}

export function markOfflineQueueItem(localId: string, status: OfflineQueueStatus, options: { storage?: OfflineStorageLike | null; storageKey?: string; error?: string | null } = {}) {
  return updateOfflineQueueItem(localId, {
    status,
    error: options.error ?? null,
    lastAttemptAt: status === 'syncing' || status === 'failed' ? nowIso() : undefined,
  }, options)
}

export function removeOfflineQueueItem(localId: string, options: { storage?: OfflineStorageLike | null; storageKey?: string } = {}) {
  const items = listOfflineQueue(options)
  const next = items.filter(item => item.localId !== localId)
  saveOfflineQueue(next, options)
  return next.length !== items.length
}

export function pendingOfflineItems(options: { storage?: OfflineStorageLike | null; storageKey?: string } = {}) {
  return listOfflineQueue(options).filter(item => item.status === 'pending_sync' || item.status === 'failed')
}
