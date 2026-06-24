'use client'

import { useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { CheckCircle2, Crosshair, Home, Loader2, MapPin, Navigation, Plus, RefreshCw, Route, ShieldCheck } from 'lucide-react'

type Lead = {
  id: string
  sessionId?: string | null
  projectId?: string | null
  customerId?: string | null
  address?: string | null
  homeownerName?: string | null
  phone?: string | null
  notes?: string | null
  status: string
  latitude?: number | null
  longitude?: number | null
  updatedAt?: string
  createdAt?: string
}

type Session = { id: string; title?: string | null; territoryName?: string | null; status: string; startedAt: string }
type Activity = { id: string; leadId?: string | null; type: string; summary: string; createdAt: string }
type Bounds = { minLat: number; maxLat: number; minLng: number; maxLng: number } | null

type MapPayload = {
  sessions: Session[]
  leads: Lead[]
  activities: Activity[]
  bounds: Bounds
  counts: Record<string, number>
  summary: { activeSessions: number; leadCount: number; knocked: number; interested: number; followUp: number; converted: number; noAnswer: number }
}

const statusOptions = [
  ['new', 'New'],
  ['knocked', 'Knocked'],
  ['interested', 'Interested'],
  ['follow_up', 'Follow-up'],
  ['no_answer', 'No Answer'],
  ['not_interested', 'Not Interested'],
  ['converted', 'Converted'],
]

const statusTone: Record<string, string> = {
  new: 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-900 dark:text-slate-200',
  knocked: 'bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-950 dark:text-blue-200',
  interested: 'bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-200',
  follow_up: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950 dark:text-amber-200',
  no_answer: 'bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-950 dark:text-orange-200',
  not_interested: 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950 dark:text-rose-200',
  converted: 'bg-violet-100 text-violet-800 border-violet-300 dark:bg-violet-950 dark:text-violet-200',
}

export function CanvassingMapMode() {
  const [data, setData] = useState<MapPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number; accuracyMeters?: number | null } | null>(null)
  const [newLead, setNewLead] = useState({ address: '', homeownerName: '', phone: '', notes: '' })
  const [territoryName, setTerritoryName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const leads = data?.leads ?? []
  const sessions = data?.sessions ?? []
  const selectedLead = leads.find(l => l.id === selectedLeadId) ?? leads[0] ?? null
  const bounds = data?.bounds ?? boundsFromCurrentLocation(currentLocation)

  useEffect(() => { refresh() }, [])

  async function refresh() {
    setLoading(true)
    setError(null)
    try {
      const url = activeSessionId ? `/api/canvassing/map?sessionId=${activeSessionId}&includeConverted=1` : '/api/canvassing/map?includeConverted=1'
      const res = await fetch(url)
      if (!res.ok) throw new Error('Could not load canvassing map')
      const json = await res.json()
      setData(json)
      if (!activeSessionId && json.sessions?.[0]?.id) setActiveSessionId(json.sessions[0].id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load canvassing map')
    } finally {
      setLoading(false)
    }
  }

  async function locateMe() {
    setError(null)
    if (!navigator.geolocation) { setError('GPS is not available in this browser.'); return null }
    return new Promise<{ lat: number; lng: number; accuracyMeters?: number | null } | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        pos => {
          const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyMeters: pos.coords.accuracy }
          setCurrentLocation(loc)
          resolve(loc)
        },
        () => { setError('Location permission was denied or unavailable.'); resolve(null) },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
      )
    })
  }

  async function startSession() {
    setSaving('session')
    const loc = currentLocation ?? await locateMe()
    try {
      const res = await fetch('/api/canvassing/sessions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ territoryName: territoryName || undefined, location: loc, title: territoryName ? `${territoryName} canvassing` : undefined }),
      })
      if (!res.ok) throw new Error('Could not start canvassing session')
      const json = await res.json()
      setActiveSessionId(json.session.id)
      setTerritoryName('')
      await refresh()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not start session') }
    finally { setSaving(null) }
  }

  async function endSession() {
    if (!activeSessionId) return
    setSaving('end-session')
    try {
      const res = await fetch(`/api/canvassing/sessions/${activeSessionId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'completed' }) })
      if (!res.ok) throw new Error('Could not complete session')
      setActiveSessionId(null)
      await refresh()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not complete session') }
    finally { setSaving(null) }
  }

  async function createLeadAtLocation() {
    setSaving('lead')
    const loc = currentLocation ?? await locateMe()
    try {
      const res = await fetch('/api/canvassing/leads', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: activeSessionId,
          address: newLead.address || undefined,
          homeownerName: newLead.homeownerName || undefined,
          phone: newLead.phone || undefined,
          notes: newLead.notes || undefined,
          status: 'new',
          location: loc,
          source: 'canvassing_map_mode',
        }),
      })
      if (!res.ok) throw new Error('Could not create lead')
      const json = await res.json()
      setSelectedLeadId(json.lead.id)
      setNewLead({ address: '', homeownerName: '', phone: '', notes: '' })
      await refresh()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not create lead') }
    finally { setSaving(null) }
  }

  async function logLeadStatus(lead: Lead, status: string) {
    setSaving(`lead-${lead.id}-${status}`)
    const loc = currentLocation ?? null
    try {
      const res = await fetch(`/api/canvassing/leads/${lead.id}/activity`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: activeSessionId ?? lead.sessionId, type: status, status, location: loc }),
      })
      if (!res.ok) throw new Error('Could not log canvassing activity')
      await refresh()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not log activity') }
    finally { setSaving(null) }
  }

  async function convertLead(lead: Lead) {
    setSaving(`convert-${lead.id}`)
    try {
      const res = await fetch(`/api/canvassing/leads/${lead.id}/convert`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerName: lead.homeownerName || undefined, projectTitle: lead.address ? `${lead.address} — Canvassing Lead` : undefined }),
      })
      if (!res.ok) throw new Error('Could not convert lead')
      const json = await res.json()
      await refresh()
      if (json.project?.id && confirm('Lead converted. Open the new job thread?')) {
        window.location.href = '/'
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not convert lead') }
    finally { setSaving(null) }
  }

  const plotted = useMemo(() => leads.filter(l => typeof l.latitude === 'number' && typeof l.longitude === 'number'), [leads])

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b bg-background/85 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><MapPin className="h-4 w-4" /> Field assistant / canvassing map mode</div>
            <h1 className="text-xl font-semibold tracking-tight">Canvassing</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={locateMe}><Crosshair className="mr-2 h-4 w-4" /> Locate me</Button>
            <Button variant="outline" onClick={refresh} disabled={loading}><RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} /> Refresh</Button>
            <Button onClick={() => window.location.href = '/'}>Back to chat</Button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-4 p-4 lg:grid-cols-[360px_1fr_360px]">
        <section className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Route className="h-4 w-4" /> Session</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-2">
                <Input value={territoryName} onChange={e => setTerritoryName(e.target.value)} placeholder="Territory / neighborhood name" />
                <div className="flex gap-2">
                  <Button onClick={startSession} disabled={saving === 'session'} className="flex-1">{saving === 'session' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Navigation className="mr-2 h-4 w-4" />} Start</Button>
                  <Button variant="outline" onClick={endSession} disabled={!activeSessionId || saving === 'end-session'}>End</Button>
                </div>
              </div>
              <div className="space-y-2">
                {sessions.length ? sessions.map(s => (
                  <button key={s.id} onClick={() => setActiveSessionId(s.id)} className={cn('w-full rounded-lg border p-2 text-left text-sm transition-colors hover:bg-muted', activeSessionId === s.id && 'border-blue-400 bg-blue-50 dark:bg-blue-950/30')}>
                    <div className="font-medium">{s.title || 'Canvassing session'}</div>
                    <div className="text-xs text-muted-foreground">{s.territoryName || 'No territory'} · {s.status}</div>
                  </button>
                )) : <p className="text-sm text-muted-foreground">No active canvassing sessions yet.</p>}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Plus className="h-4 w-4" /> Create lead/pin</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <Input value={newLead.address} onChange={e => setNewLead(v => ({ ...v, address: e.target.value }))} placeholder="Address if known" />
              <Input value={newLead.homeownerName} onChange={e => setNewLead(v => ({ ...v, homeownerName: e.target.value }))} placeholder="Homeowner name" />
              <Input value={newLead.phone} onChange={e => setNewLead(v => ({ ...v, phone: e.target.value }))} placeholder="Phone" />
              <Textarea value={newLead.notes} onChange={e => setNewLead(v => ({ ...v, notes: e.target.value }))} placeholder="Notes" rows={3} />
              <Button onClick={createLeadAtLocation} disabled={saving === 'lead'} className="w-full">{saving === 'lead' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MapPin className="mr-2 h-4 w-4" />} Add pin here</Button>
              <p className="text-xs text-muted-foreground">GPS is captured only when you tap actions like Locate me or Add pin here.</p>
            </CardContent>
          </Card>

          {error ? <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">{error}</div> : null}
        </section>

        <section className="space-y-4">
          <Card className="overflow-hidden">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 text-sm"><Home className="h-4 w-4" /> Live map surface</CardTitle>
                {currentLocation ? <Badge variant="secondary" className="text-[10px]">GPS ready</Badge> : <Badge variant="outline" className="text-[10px]">GPS off</Badge>}
              </div>
            </CardHeader>
            <CardContent>
              <div className="relative h-[520px] overflow-hidden rounded-xl border bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,.18),transparent_35%),linear-gradient(135deg,rgba(15,23,42,.04),rgba(14,165,233,.05))] dark:bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,.22),transparent_35%),linear-gradient(135deg,rgba(15,23,42,.7),rgba(8,47,73,.45))]">
                <div className="absolute inset-0 opacity-30" style={{ backgroundImage: 'linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)', backgroundSize: '48px 48px' }} />
                {loading ? <div className="absolute inset-0 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-blue-500" /></div> : null}
                {!loading && !plotted.length ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center text-sm text-muted-foreground">
                    <MapPin className="mb-2 h-8 w-8 text-blue-500" />
                    No GPS pins yet. Tap <span className="font-medium text-foreground">Add pin here</span> while standing at a house.
                  </div>
                ) : null}
                {currentLocation ? <MapDot bounds={bounds} lat={currentLocation.lat} lng={currentLocation.lng} className="h-5 w-5 border-blue-700 bg-blue-500 shadow-lg shadow-blue-500/30" title="You are here" /> : null}
                {plotted.map(lead => <MapDot key={lead.id} bounds={bounds} lat={lead.latitude!} lng={lead.longitude!} className={cn('h-4 w-4 cursor-pointer border-background', selectedLead?.id === lead.id ? 'scale-125 ring-2 ring-blue-500' : '', leadColor(lead.status))} title={lead.address || lead.homeownerName || lead.status} onClick={() => setSelectedLeadId(lead.id)} />)}
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Metric label="Leads" value={data?.summary?.leadCount ?? 0} />
            <Metric label="Knocked" value={data?.summary?.knocked ?? 0} />
            <Metric label="Interested" value={data?.summary?.interested ?? 0} />
            <Metric label="Follow-up" value={data?.summary?.followUp ?? 0} />
            <Metric label="Converted" value={data?.summary?.converted ?? 0} />
          </div>
        </section>

        <section className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Selected lead</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {selectedLead ? (
                <>
                  <div>
                    <div className="font-semibold">{selectedLead.address || selectedLead.homeownerName || 'Canvassing lead'}</div>
                    <div className="text-xs text-muted-foreground">{selectedLead.homeownerName || 'No homeowner name'}{selectedLead.phone ? ` · ${selectedLead.phone}` : ''}</div>
                  </div>
                  <Badge className={cn('border', statusTone[selectedLead.status] ?? statusTone.new)}>{humanize(selectedLead.status)}</Badge>
                  {selectedLead.notes ? <div className="rounded-lg border bg-background/70 p-2 text-xs text-muted-foreground">{selectedLead.notes}</div> : null}
                  <div className="grid grid-cols-2 gap-2">
                    {statusOptions.filter(([key]) => key !== 'converted').map(([key, label]) => <Button key={key} size="sm" variant="secondary" disabled={saving === `lead-${selectedLead.id}-${key}`} onClick={() => logLeadStatus(selectedLead, key)}>{label}</Button>)}
                  </div>
                  <Button className="w-full" disabled={!!selectedLead.projectId || saving === `convert-${selectedLead.id}`} onClick={() => convertLead(selectedLead)}>{saving === `convert-${selectedLead.id}` ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />} {selectedLead.projectId ? 'Converted' : 'Convert to job'}</Button>
                </>
              ) : <p className="text-sm text-muted-foreground">Select a lead pin or create one from your location.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Recent activity</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {(data?.activities ?? []).slice(0, 12).map(a => (
                <div key={a.id} className="rounded-lg border bg-background/70 p-2 text-xs">
                  <div className="font-medium">{humanize(a.type)}</div>
                  <div className="text-muted-foreground">{a.summary}</div>
                </div>
              ))}
              {!(data?.activities ?? []).length ? <p className="text-sm text-muted-foreground">No activity yet.</p> : null}
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return <Card><CardContent className="p-3"><div className="text-2xl font-semibold">{value}</div><div className="text-xs text-muted-foreground">{label}</div></CardContent></Card>
}

function MapDot({ bounds, lat, lng, className, title, onClick }: { bounds: Bounds; lat: number; lng: number; className?: string; title?: string; onClick?: () => void }) {
  const pos = useMemo(() => position(bounds, lat, lng), [bounds, lat, lng])
  return <button title={title} onClick={onClick} className={cn('absolute rounded-full border-2 transition-transform hover:scale-125', className)} style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: 'translate(-50%, -50%)' }} />
}

function position(bounds: Bounds, lat: number, lng: number) {
  if (!bounds) return { x: 50, y: 50 }
  const x = ((lng - bounds.minLng) / Math.max(bounds.maxLng - bounds.minLng, 0.000001)) * 100
  const y = (1 - ((lat - bounds.minLat) / Math.max(bounds.maxLat - bounds.minLat, 0.000001))) * 100
  return { x: clamp(x, 4, 96), y: clamp(y, 4, 96) }
}

function boundsFromCurrentLocation(loc: { lat: number; lng: number } | null): Bounds {
  if (!loc) return null
  return { minLat: loc.lat - 0.004, maxLat: loc.lat + 0.004, minLng: loc.lng - 0.004, maxLng: loc.lng + 0.004 }
}

function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)) }
function humanize(value: string) { return value.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) }
function leadColor(status: string) {
  if (status === 'interested') return 'bg-emerald-500'
  if (status === 'follow_up') return 'bg-amber-500'
  if (status === 'no_answer') return 'bg-orange-500'
  if (status === 'not_interested') return 'bg-rose-500'
  if (status === 'converted') return 'bg-violet-500'
  if (status === 'knocked') return 'bg-blue-500'
  return 'bg-slate-500'
}
