export type OfflineEventType =
  | 'chat_draft.created'
  | 'field_observation.created'
  | 'lead.created'
  | 'door_attempt.recorded'
  | 'inspection.started'
  | 'photo_evidence.captured'
  | 'document_intake.captured'
  | 'activity_note.created'

export type OfflineQueueStatus = 'pending_sync' | 'syncing' | 'synced' | 'failed' | 'conflict'

export type OfflineLocalScope =
  | 'contractor'
  | 'user'
  | 'customer'
  | 'project'
  | 'workspace'
  | 'property'
  | 'field_session'
  | 'unknown'

export type OfflineLocationSnapshot = {
  latitude: number
  longitude: number
  accuracyMeters?: number
  source?: string
  capturedAt: string
}

export type OfflineEntityRefs = {
  contractorId?: string | null
  userId?: string | null
  customerId?: string | null
  projectId?: string | null
  workspaceId?: string | null
  chatId?: string | null
  documentId?: string | null
  propertyMemoryId?: string | null
  fieldSessionId?: string | null
  localOnlyEntityId?: string | null
}

export type OfflineQueueItem<TPayload extends Record<string, unknown> = Record<string, unknown>> = OfflineEntityRefs & {
  localId: string
  type: OfflineEventType
  scope: OfflineLocalScope
  status: OfflineQueueStatus
  payload: TPayload
  location?: OfflineLocationSnapshot | null
  source: 'chat' | 'field' | 'upload' | 'camera' | 'voice' | 'ar_capture' | 'system'
  createdAt: string
  updatedAt: string
  lastAttemptAt?: string | null
  attemptCount: number
  error?: string | null
  serverId?: string | null
  serverEventType?: string | null
}

export type OfflineQueueInput<TPayload extends Record<string, unknown> = Record<string, unknown>> = OfflineEntityRefs & {
  type: OfflineEventType
  scope?: OfflineLocalScope
  payload: TPayload
  location?: OfflineLocationSnapshot | null
  source?: OfflineQueueItem['source']
  createdAt?: string | Date
}

export type OfflineTruthCacheEntry<TValue = unknown> = {
  key: string
  scope: OfflineLocalScope
  value: TValue
  source: 'server' | 'local' | 'system'
  createdAt: string
  updatedAt: string
  expiresAt?: string | null
  entityRefs?: OfflineEntityRefs
}

export type OfflineStorageLike = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export type OfflineSyncAck = {
  localId: string
  status: 'synced' | 'failed' | 'conflict'
  serverId?: string | null
  serverEventType?: string | null
  error?: string | null
}

export type OfflineSyncResult = {
  accepted: OfflineSyncAck[]
  rejected?: OfflineSyncAck[]
}
