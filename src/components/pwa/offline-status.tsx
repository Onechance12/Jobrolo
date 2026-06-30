'use client'

import { CloudOff, RefreshCcw, Wifi } from 'lucide-react'
import { useOfflineSync } from '@/hooks/use-offline-sync'
import { cn } from '@/lib/utils'

export function OfflineStatus() {
  const { online, pendingCount, syncing, lastError, syncNow } = useOfflineSync()

  if (online && pendingCount === 0 && !lastError) return null

  const label = !online
    ? pendingCount > 0
      ? `${pendingCount} saved on this device`
      : 'Offline'
    : syncing
      ? `Syncing ${pendingCount}`
      : pendingCount > 0
        ? `${pendingCount} waiting to sync`
        : 'Sync needs review'

  return (
    <div className="pointer-events-none fixed left-1/2 top-[max(0.75rem,env(safe-area-inset-top))] z-[80] w-[min(calc(100vw-1.5rem),24rem)] -translate-x-1/2">
      <button
        type="button"
        onClick={() => { if (online) void syncNow() }}
        className={cn(
          'pointer-events-auto mx-auto flex min-h-10 items-center gap-2 rounded-full border px-3 py-2 text-xs font-medium shadow-2xl backdrop-blur-xl',
          online
            ? 'border-blue-400/25 bg-blue-950/80 text-blue-100 shadow-blue-950/30'
            : 'border-amber-300/25 bg-amber-950/80 text-amber-100 shadow-amber-950/30'
        )}
      >
        {!online ? <CloudOff className="h-4 w-4" /> : syncing ? <RefreshCcw className="h-4 w-4 animate-spin" /> : <Wifi className="h-4 w-4" />}
        <span>{label}</span>
        {online && pendingCount > 0 ? <span className="text-[10px] opacity-70">Tap to retry</span> : null}
      </button>
      {lastError ? (
        <div className="mx-auto mt-1 max-w-xs rounded-2xl border border-red-400/20 bg-red-950/80 px-3 py-2 text-center text-[11px] text-red-100 shadow-xl backdrop-blur-xl">
          {lastError}
        </div>
      ) : null}
    </div>
  )
}
