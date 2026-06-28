'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InboxStack } from './copilot-cards'
import { RefreshCw } from 'lucide-react'

type InboxItem = {
  id: string
  type: string
  title: string
  summary?: string | null
  priority?: string
  status?: string
  role?: string
  projectId?: string | null
  actionRequestId?: string | null
  payloadJson?: string | null
  createdAt?: string
}

export function CopilotInboxStrip({ projectId, limit = 5 }: { projectId?: string | null; limit?: number }) {
  const [items, setItems] = useState<InboxItem[]>([])
  const [loading, setLoading] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const qs = new URLSearchParams({ limit: String(limit) })
      if (projectId) qs.set('projectId', projectId)
      const res = await fetch(`/api/field-copilot/inbox?${qs.toString()}`)
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      setItems(data.items ?? [])
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    queueMicrotask(() => { void load() })
  }, [projectId, limit])

  if (!items.length && !loading) return null

  return (
    <div className="border-b border-border/60 bg-background/70 backdrop-blur">
      <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-3 pt-2 sm:px-4">
        <div className="text-xs font-medium text-muted-foreground">Role-routed work shows up here automatically.</div>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading} className="h-7 px-2 text-xs">
          <RefreshCw className={loading ? 'mr-1 h-3 w-3 animate-spin' : 'mr-1 h-3 w-3'} /> Refresh
        </Button>
      </div>
      <InboxStack items={items} onChanged={load} />
    </div>
  )
}
