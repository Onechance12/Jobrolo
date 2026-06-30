'use client'

import { useCallback, useEffect, useState } from 'react'
import { flushOfflineQueue, pendingOfflineItems } from '@/lib/offline'

export type OfflineSyncState = {
  online: boolean
  pendingCount: number
  syncing: boolean
  lastSyncedAt: string | null
  lastError: string | null
  refresh: () => void
  syncNow: () => Promise<void>
}

function getOnlineState() {
  if (typeof navigator === 'undefined') return true
  return navigator.onLine
}

function getPendingCount() {
  return pendingOfflineItems().length
}

export function useOfflineSync(): OfflineSyncState {
  const [online, setOnline] = useState(getOnlineState)
  const [pendingCount, setPendingCount] = useState(getPendingCount)
  const [syncing, setSyncing] = useState(false)
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    setOnline(getOnlineState())
    setPendingCount(getPendingCount())
  }, [])

  const syncNow = useCallback(async () => {
    if (!getOnlineState()) {
      refresh()
      return
    }
    const pending = pendingOfflineItems()
    if (!pending.length) {
      refresh()
      return
    }

    setSyncing(true)
    setLastError(null)
    try {
      await flushOfflineQueue()
      setLastSyncedAt(new Date().toISOString())
    } catch (err) {
      setLastError(err instanceof Error ? err.message : 'Offline sync failed.')
    } finally {
      setSyncing(false)
      refresh()
    }
  }, [refresh])

  useEffect(() => {
    const handleOnline = () => {
      refresh()
      void syncNow()
    }
    const handleOffline = () => refresh()
    const handleQueueChanged = () => refresh()

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    window.addEventListener('jobrolo:offline-queue-changed', handleQueueChanged)

    const timer = window.setInterval(() => {
      refresh()
      if (getOnlineState() && pendingOfflineItems().length) void syncNow()
    }, 30_000)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('jobrolo:offline-queue-changed', handleQueueChanged)
      window.clearInterval(timer)
    }
  }, [refresh, syncNow])

  return { online, pendingCount, syncing, lastSyncedAt, lastError, refresh, syncNow }
}
