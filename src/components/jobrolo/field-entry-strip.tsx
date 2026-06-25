'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { WorkspaceInfo } from '@/lib/types'
import { Camera, ClipboardCheck, Loader2, MapPin, PackagePlus, PenLine, Route, ShieldCheck, Wrench } from 'lucide-react'

type FieldEntryStripProps = {
  workspace?: WorkspaceInfo | null
  onOpenFieldCopilot: () => void
  onSendPrompt?: (text: string) => void
  onFieldEvent?: (event: { action: string; title: string; summary?: string; mode?: string }) => void
  compact?: boolean
}

type LocationPayload = {
  lat: number
  lng: number
  accuracyMeters?: number
  source: 'browser_gps'
}

export function FieldEntryStrip({ workspace, onOpenFieldCopilot, onSendPrompt, onFieldEvent, compact }: FieldEntryStripProps) {
  const [arriving, setArriving] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const project = workspace?.project
  const projectId = workspace?.projectId ?? project?.id
  if (!projectId || !project) return null

  async function markArrived() {
    setArriving(true)
    setStatus(null)
    try {
      const location = await getCurrentLocation().catch(() => null)
      const res = await fetch(`/api/projects/${projectId}/field-copilot/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'arrived',
          mode: 'field',
          location: location ?? undefined,
        }),
      })
      if (!res.ok) throw new Error('Could not log arrival')
      onFieldEvent?.({
        action: 'arrived',
        title: `Arrived — ${project!.title}`,
        summary: location ? 'Arrival logged with GPS and added to the job timeline.' : 'Arrival logged and added to the job timeline.',
        mode: 'field',
      })
      setStatus(location ? 'Arrival logged with GPS.' : 'Arrival logged. GPS was unavailable or skipped.')
    } catch {
      setStatus('Could not log arrival. Try again or tell Jobrolo you arrived.')
    } finally {
      setArriving(false)
    }
  }

  const fieldPrompt = `Open the field briefing for ${project.title}. Tell me what matters before I walk up, what is missing, what documents are pending, and what I should log next.`
  const materialPrompt = `Crew/field update for ${project.title}: I need extra material. Ask me for material, quantity, reason, and photos if needed, then create the right material request for PM approval.`
  const photoPrompt = `I am about to upload field photos for ${project.title}. Use the job packet and location context to attach them correctly, then tell me if anything still needs photo documentation.`
  const signingPrompt = `I am at ${project.title} for signing. Show pending signature documents, explain what should be signed, and help me log the outcome.`
  const productionPrompt = `Production update for ${project.title}. Show crew/material/scope notes and help me log any issue, extra material, completion item, or customer concern.`

  return (
    <div className={cn('border-b border-border/60 bg-background/80 backdrop-blur', compact && 'border rounded-2xl') }>
      <div className="mx-auto w-full max-w-3xl px-3 py-2 sm:px-4">
        <Card className="overflow-hidden border-blue-200/70 bg-blue-50/45 shadow-sm dark:border-blue-900/50 dark:bg-blue-950/20">
          <CardContent className="space-y-3 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="secondary" className="gap-1 text-[10px]"><Route className="h-3 w-3" /> Field-ready</Badge>
                  {project.priority ? <Badge variant={project.priority === 'urgent' || project.priority === 'high' ? 'destructive' : 'outline'} className="text-[10px]">{project.priority}</Badge> : null}
                </div>
                <div className="mt-1 truncate text-sm font-semibold">{project.title}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {[project.customer?.name, project.address].filter(Boolean).join(' · ') || 'Job context active'}
                </div>
              </div>
              <Button size="sm" onClick={onOpenFieldCopilot} className="shrink-0">
                <MapPin className="mr-1.5 h-3.5 w-3.5" /> Brief me
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Button size="sm" variant="outline" disabled={arriving} onClick={markArrived} className="justify-start">
                {arriving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <MapPin className="mr-1.5 h-3.5 w-3.5" />}
                I'm here
              </Button>
              <Button size="sm" variant="outline" onClick={() => onSendPrompt?.(fieldPrompt)} className="justify-start">
                <ClipboardCheck className="mr-1.5 h-3.5 w-3.5" /> Next steps
              </Button>
              <Button size="sm" variant="outline" onClick={() => onSendPrompt?.(photoPrompt)} className="justify-start">
                <Camera className="mr-1.5 h-3.5 w-3.5" /> Photos
              </Button>
              <Button size="sm" variant="outline" onClick={() => onSendPrompt?.(materialPrompt)} className="justify-start">
                <PackagePlus className="mr-1.5 h-3.5 w-3.5" /> Need material
              </Button>
              <Button size="sm" variant="outline" onClick={() => onSendPrompt?.(signingPrompt)} className="justify-start">
                <PenLine className="mr-1.5 h-3.5 w-3.5" /> Signing
              </Button>
              <Button size="sm" variant="outline" onClick={() => onSendPrompt?.(productionPrompt)} className="justify-start">
                <Wrench className="mr-1.5 h-3.5 w-3.5" /> Production
              </Button>
            </div>

            {status ? (
              <div className="flex items-center gap-1.5 rounded-lg border bg-background/70 px-2 py-1.5 text-xs text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5 text-blue-600" /> {status}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function getCurrentLocation(): Promise<LocationPayload> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return reject(new Error('GPS unavailable'))
    navigator.geolocation.getCurrentPosition(
      position => resolve({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracyMeters: position.coords.accuracy,
        source: 'browser_gps',
      }),
      reject,
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 },
    )
  })
}
