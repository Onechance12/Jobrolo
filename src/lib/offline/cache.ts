import type { OfflineEntityRefs, OfflineLocalScope, OfflineStorageLike, OfflineTruthCacheEntry } from './types'
import { getBrowserOfflineStorage } from './queue'

export const OFFLINE_TRUTH_CACHE_PREFIX = 'jobrolo.localTruth.v1'

function nowIso() {
  return new Date().toISOString()
}

function cacheStorageKey(scope: OfflineLocalScope, key: string) {
  return `${OFFLINE_TRUTH_CACHE_PREFIX}:${scope}:${encodeURIComponent(key)}`
}

function safeParseEntry<TValue>(raw: string | null): OfflineTruthCacheEntry<TValue> | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    if (typeof parsed.key !== 'string' || typeof parsed.scope !== 'string') return null
    return parsed as OfflineTruthCacheEntry<TValue>
  } catch {
    return null
  }
}

export function writeLocalTruthCache<TValue>(input: {
  scope: OfflineLocalScope
  key: string
  value: TValue
  source?: OfflineTruthCacheEntry['source']
  ttlMs?: number
  entityRefs?: OfflineEntityRefs
}, options: { storage?: OfflineStorageLike | null } = {}) {
  const storage = options.storage ?? getBrowserOfflineStorage()
  const createdAt = nowIso()
  const entry: OfflineTruthCacheEntry<TValue> = {
    key: input.key,
    scope: input.scope,
    value: input.value,
    source: input.source ?? 'server',
    createdAt,
    updatedAt: createdAt,
    expiresAt: input.ttlMs ? new Date(Date.now() + input.ttlMs).toISOString() : null,
    entityRefs: input.entityRefs,
  }
  storage?.setItem(cacheStorageKey(input.scope, input.key), JSON.stringify(entry))
  return entry
}

export function readLocalTruthCache<TValue>(scope: OfflineLocalScope, key: string, options: { storage?: OfflineStorageLike | null; allowExpired?: boolean } = {}) {
  const storage = options.storage ?? getBrowserOfflineStorage()
  const entry = safeParseEntry<TValue>(storage?.getItem(cacheStorageKey(scope, key)) ?? null)
  if (!entry) return null
  if (!options.allowExpired && entry.expiresAt && Date.parse(entry.expiresAt) < Date.now()) return null
  return entry
}

export function clearLocalTruthCache(scope: OfflineLocalScope, key: string, options: { storage?: OfflineStorageLike | null } = {}) {
  const storage = options.storage ?? getBrowserOfflineStorage()
  storage?.removeItem(cacheStorageKey(scope, key))
}

export function isLocalTruthCacheFresh(entry: OfflineTruthCacheEntry | null) {
  if (!entry) return false
  if (!entry.expiresAt) return true
  return Date.parse(entry.expiresAt) >= Date.now()
}

export function localTruthCachePrompt(entry: OfflineTruthCacheEntry | null) {
  if (!entry) return 'No local cached truth is available.'
  const freshness = isLocalTruthCacheFresh(entry) ? 'fresh' : 'stale'
  return `Local ${entry.scope} cache is ${freshness}. Use it for offline display only; verify against server/database before mutating records.`
}
