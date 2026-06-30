import {
  applyOfflineSyncResult,
  buildOfflineSyncPayload,
  clearLocalTruthCache,
  createOfflineQueueItem,
  enqueueOfflineEvent,
  listOfflineQueue,
  localTruthCachePrompt,
  pendingOfflineItems,
  readLocalTruthCache,
  shouldAttemptOfflineSync,
  writeLocalTruthCache,
} from '../index'
import type { OfflineStorageLike } from '../types'

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function memoryStorage(): OfflineStorageLike {
  const store = new Map<string, string>()
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => { store.set(key, value) },
    removeItem: (key) => { store.delete(key) },
  }
}

export function assertOfflineFoundationContracts() {
  const storage = memoryStorage()

  const fieldItem = createOfflineQueueItem({
    type: 'field_observation.created',
    scope: 'project',
    source: 'field',
    contractorId: 'contractor_1',
    userId: 'user_1',
    projectId: 'project_1',
    customerId: 'customer_1',
    payload: {
      summary: 'Saw missing shingles and dents to soft metals from the ground.',
      confidence: 0.82,
    },
    location: {
      latitude: 32.9574,
      longitude: -97.2575,
      accuracyMeters: 9,
      source: 'browser_gps',
      capturedAt: '2026-06-29T12:00:00.000Z',
    },
    createdAt: '2026-06-29T12:00:00.000Z',
  }, 'local_field_1')

  assert(fieldItem.status === 'pending_sync', 'New offline queue item should be pending_sync')
  assert(fieldItem.location?.accuracyMeters === 9, 'Offline field queue item should preserve GPS accuracy')
  assert(fieldItem.projectId === 'project_1', 'Offline queue item should preserve project context')

  const enqueued = enqueueOfflineEvent({
    type: 'photo_evidence.captured',
    scope: 'project',
    source: 'camera',
    projectId: 'project_1',
    documentId: 'doc_1',
    payload: { section: 'front_elevation', summary: 'Front elevation photo captured offline.' },
  }, { storage })

  assert(enqueued.item.type === 'photo_evidence.captured', 'Enqueue should return the created item')
  assert(listOfflineQueue({ storage }).length === 1, 'Queue should persist to injected storage')
  assert(pendingOfflineItems({ storage }).length === 1, 'Pending queue should include pending_sync items')

  const payload = buildOfflineSyncPayload([fieldItem, ...listOfflineQueue({ storage })], 10)
  assert(payload.protocolVersion === 1, 'Offline sync payload should use protocol version 1')
  assert(payload.items.length === 2, 'Offline sync payload should include pending/failed items')
  assert(payload.items[0].localId === 'local_field_1', 'Offline sync payload should keep chronological order')

  const offlineDecision = shouldAttemptOfflineSync({ isOnline: false, pendingCount: payload.items.length })
  assert(!offlineDecision.shouldSync, 'Sync should not run while browser reports offline')
  const onlineDecision = shouldAttemptOfflineSync({ isOnline: true, pendingCount: payload.items.length })
  assert(onlineDecision.shouldSync, 'Sync should run when online and pending items exist')

  applyOfflineSyncResult({
    accepted: [{ localId: enqueued.item.localId, status: 'synced', serverId: 'timeline_1', serverEventType: 'photo_evidence' }],
  }, { storage })
  const synced = listOfflineQueue({ storage })[0]
  assert(synced.status === 'synced', 'Sync result should mark accepted items as synced')
  assert(synced.serverId === 'timeline_1', 'Sync result should preserve server id')

  const cached = writeLocalTruthCache({
    scope: 'project',
    key: 'project_1:packet',
    value: { title: 'Roof Repair Project', photos: 3 },
    ttlMs: 60_000,
    entityRefs: { projectId: 'project_1' },
  }, { storage })
  assert(cached.source === 'server', 'Local truth cache should default to server source')
  const read = readLocalTruthCache<{ title: string; photos: number }>('project', 'project_1:packet', { storage })
  assert(read?.value.photos === 3, 'Local truth cache should read typed cached values')
  assert(localTruthCachePrompt(read).includes('offline display only'), 'Local truth prompt should warn against using cache as mutation truth')
  clearLocalTruthCache('project', 'project_1:packet', { storage })
  assert(!readLocalTruthCache('project', 'project_1:packet', { storage }), 'Local truth cache should clear by scope/key')

  return true
}

if (process.argv[1]?.endsWith('offline-foundation.test.ts')) {
  assertOfflineFoundationContracts()
  console.log('offline foundation contracts passed')
}
