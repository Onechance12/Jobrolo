'use client'

import { useEffect, useState } from 'react'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerFooter } from '@/components/ui/drawer'
import { Button } from '@/components/ui/button'
import { useSpeakBriefing } from '@/hooks/use-speak-briefing'
import { Loader2, MapPin, Volume2, Square } from 'lucide-react'
import { FieldBriefingCard, type FieldBriefingLike, type QuickAction } from './copilot-cards'

type FieldBriefing = FieldBriefingLike & {
  modeLabel: string
  speakableText: string
  topThings: string[]
  warnings: string[]
  missingItems: string[]
  talkingPoints: string[]
  quickActions: QuickAction[]
  appointment?: { id: string; title: string; startTime: string } | null
  activeVisit?: { id: string; status: string } | null
  privacyNote?: string
}

export function FieldCopilotDrawer({ open, onOpenChange, projectId, appointmentId }: { open: boolean; onOpenChange: (open: boolean) => void; projectId: string; appointmentId?: string | null }) {
  const [briefing, setBriefing] = useState<FieldBriefing | null>(null)
  const [loading, setLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const speaker = useSpeakBriefing()

  useEffect(() => {
    if (!open || !projectId) return
    let cancelled = false
    setLoading(true)
    const query = appointmentId ? `?appointmentId=${encodeURIComponent(appointmentId)}` : ''
    fetch(`/api/projects/${projectId}/field-copilot${query}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (!cancelled) setBriefing(data?.briefing ?? null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, projectId, appointmentId])

  async function runAction(action: QuickAction) {
    if (!projectId) return
    setActionLoading(action.key)
    try {
      const position = await getCurrentPosition().catch(() => null)
      const res = await fetch(`/api/projects/${projectId}/field-copilot/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: action.key,
          appointmentId,
          fieldVisitId: briefing?.activeVisit?.id,
          location: position ? { lat: position.coords.latitude, lng: position.coords.longitude, accuracyMeters: position.coords.accuracy, source: 'browser_gps' } : undefined,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        setBriefing(data?.briefing ?? data?.briefing?.briefing ?? data?.result?.briefing ?? data?.briefing ?? null)
        if (data?.briefing) setBriefing(data.briefing)
      }
    } finally {
      setActionLoading(null)
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[92vh]">
        <DrawerHeader>
          <DrawerTitle className="flex items-center gap-2"><MapPin className="h-4 w-4" /> Field Copilot</DrawerTitle>
          <DrawerDescription>{briefing?.modeLabel ?? 'Mobile job-site briefing and quick actions.'}</DrawerDescription>
        </DrawerHeader>
        <div className="space-y-3 overflow-y-auto px-4 pb-4">
          {loading ? (
            <div className="flex items-center gap-2 rounded-xl border p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading field briefing…</div>
          ) : briefing ? (
            <>
              <FieldBriefingCard briefing={briefing} onRunAction={runAction} actionLoading={actionLoading} />
            </>
          ) : (
            <div className="rounded-xl border p-4 text-sm text-muted-foreground">No field briefing available. Select a project/job first.</div>
          )}
        </div>
        <DrawerFooter className="border-t">
          <div className="flex gap-2">
            <Button className="flex-1" variant="outline" disabled={!briefing?.speakableText || !speaker.supported} onClick={() => speaker.speak(briefing?.speakableText ?? '')}><Volume2 className="mr-2 h-4 w-4" /> Speak Briefing</Button>
            <Button variant="outline" disabled={!speaker.isSpeaking} onClick={speaker.stop}><Square className="mr-2 h-4 w-4" /> Stop</Button>
          </div>
          {briefing?.privacyNote ? <p className="text-xs text-muted-foreground">{briefing.privacyNote}</p> : null}
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return reject(new Error('GPS unavailable'))
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 })
  })
}
