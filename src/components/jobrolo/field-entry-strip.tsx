'use client'

import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
  const projectTitle = project.title

  async function markArrived() {
    setArriving(true)
    setStatus(null)
    try {
      const location = await getCurrentLocation().catch(() => null)
      const locationBlock = location ? browserLocationBlock(location) : ''
      onSendPrompt?.(
        `I'm here at ${projectTitle}. Log my arrival to the job timeline, attach this GPS if available, and tell me what saved.${locationBlock}`,
      )
      onFieldEvent?.({
        action: 'arrival_prompt_drafted',
        title: `Arrival prompt — ${projectTitle}`,
        summary: location ? 'Arrival prompt drafted with GPS.' : 'Arrival prompt drafted. GPS was unavailable or skipped.',
        mode: 'field',
      })
      setStatus(location ? 'Drafted arrival prompt with GPS.' : 'Drafted arrival prompt. GPS was unavailable or skipped.')
    } catch {
      onSendPrompt?.(`I'm here at ${projectTitle}. Log my arrival to the job timeline and tell me what saved.`)
      setStatus('Drafted arrival prompt without GPS.')
    } finally {
      setArriving(false)
    }
  }

  const fieldPrompt = `Open the field briefing for ${projectTitle}. Tell me what matters before I walk up, what is missing, what documents are pending, and what I should log next.`
  const materialPrompt = `Crew/field update for ${projectTitle}: I need extra material. Ask me for material, quantity, reason, and photos if needed, then create the right material request for PM approval.`
  const signingPrompt = `I am at ${projectTitle} for signing. Show pending signature documents, explain what should be signed, and help me log the outcome.`
  const productionPrompt = `Production update for ${projectTitle}. Show crew/material/scope notes and help me log any issue, extra material, completion item, or customer concern.`
  const openInspectionPhotos = (section?: string) => {
    window.dispatchEvent(new CustomEvent('jobrolo:open-inspection-photo-intake', { detail: { section } }))
  }

  return (
    <div className={cn('border-b border-border/50 bg-background/90 backdrop-blur', compact && 'rounded-2xl border') }>
      <div className="mx-auto flex w-full max-w-3xl items-center gap-2 overflow-x-auto px-3 py-2 sm:px-4">
        <div className="flex shrink-0 items-center gap-1.5 pr-1">
          <Badge variant="secondary" className="gap-1 rounded-full text-[10px]"><Route className="h-3 w-3" /> Field</Badge>
          {project.priority ? <Badge variant={project.priority === 'urgent' || project.priority === 'high' ? 'destructive' : 'outline'} className="rounded-full text-[10px]">{project.priority}</Badge> : null}
          <span className="max-w-[10rem] truncate text-xs font-medium text-foreground sm:max-w-[16rem]">{project.customer?.name || project.title}</span>
        </div>
        <FieldPill disabled={arriving} onClick={markArrived} icon={arriving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MapPin className="h-3.5 w-3.5" />} label="I'm here" />
        <FieldPill onClick={() => openInspectionPhotos()} icon={<Camera className="h-3.5 w-3.5" />} label="Start inspection" />
        <FieldPill onClick={() => openInspectionPhotos('roof_overview')} icon={<Camera className="h-3.5 w-3.5" />} label="Photos" />
        <FieldPill onClick={() => onSendPrompt?.(fieldPrompt)} icon={<ClipboardCheck className="h-3.5 w-3.5" />} label="Brief" />
        <FieldPill onClick={() => onSendPrompt?.(materialPrompt)} icon={<PackagePlus className="h-3.5 w-3.5" />} label="Material" />
        <FieldPill onClick={() => onSendPrompt?.(signingPrompt)} icon={<PenLine className="h-3.5 w-3.5" />} label="Signing" />
        <FieldPill onClick={() => onSendPrompt?.(productionPrompt)} icon={<Wrench className="h-3.5 w-3.5" />} label="Production" />
        <Button size="sm" variant="ghost" onClick={onOpenFieldCopilot} className="h-8 shrink-0 rounded-full px-3 text-xs">
          More
        </Button>
      </div>
      {status ? (
        <div className="mx-auto flex w-full max-w-3xl items-center gap-1.5 px-3 pb-2 text-xs text-muted-foreground sm:px-4">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> {status}
        </div>
      ) : null}
    </div>
  )
}

function FieldPill({ icon, label, onClick, disabled }: { icon: ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 text-xs font-medium text-emerald-900 transition-colors hover:bg-emerald-100 disabled:opacity-60 dark:border-emerald-900/60 dark:bg-emerald-950/25 dark:text-emerald-100 dark:hover:bg-emerald-950/45"
    >
      {icon}
      {label}
    </button>
  )
}

function browserLocationBlock(location: LocationPayload) {
  return `\n\n[BROWSER_LOCATION]\nlatitude: ${location.lat}\nlongitude: ${location.lng}\naccuracyMeters: ${Math.round(Number(location.accuracyMeters || 0))}\nsource: ${location.source}\ncapturedAt: ${new Date().toISOString()}\nUse this location for this field/jobsite action.`
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
