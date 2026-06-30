'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Crosshair, ExternalLink, Home, Loader2, MapPin, MessageCircle, Navigation, Plus, RefreshCw, Route, Search, X } from 'lucide-react'

type BrowserLocation = {
  lat: number
  lng: number
  accuracyMeters?: number | null
}

type FieldLead = {
  id: string
  address?: string | null
  homeownerName?: string | null
  phone?: string | null
  notes?: string | null
  status?: string | null
  source?: string | null
  latitude?: number | null
  longitude?: number | null
  updatedAt?: string | null
}

type FieldMapPayload = {
  leads?: FieldLead[]
  summary?: {
    activeSessions?: number
    leadCount?: number
    knocked?: number
    interested?: number
    followUp?: number
    converted?: number
    noAnswer?: number
  }
  counts?: Record<string, number>
}

const MAP_SPAN = 0.006

const STATUS_META: Record<string, { label: string; color: string; pin: string }> = {
  new: { label: 'New', color: 'border-blue-400/35 bg-blue-500/15 text-blue-100', pin: 'border-blue-200 bg-blue-500 shadow-blue-500/40' },
  knocked: { label: 'Knocked', color: 'border-slate-300/30 bg-slate-400/15 text-slate-100', pin: 'border-slate-100 bg-slate-500 shadow-slate-400/35' },
  no_answer: { label: 'No answer', color: 'border-zinc-300/30 bg-zinc-400/15 text-zinc-100', pin: 'border-zinc-100 bg-zinc-600 shadow-zinc-400/35' },
  interested: { label: 'Interested', color: 'border-emerald-300/35 bg-emerald-500/15 text-emerald-100', pin: 'border-emerald-100 bg-emerald-500 shadow-emerald-500/45' },
  follow_up: { label: 'Follow up', color: 'border-amber-300/35 bg-amber-500/15 text-amber-100', pin: 'border-amber-100 bg-amber-500 shadow-amber-500/45' },
  not_interested: { label: 'Not interested', color: 'border-rose-300/35 bg-rose-500/15 text-rose-100', pin: 'border-rose-100 bg-rose-500 shadow-rose-500/40' },
  converted: { label: 'Converted', color: 'border-violet-300/35 bg-violet-500/15 text-violet-100', pin: 'border-violet-100 bg-violet-500 shadow-violet-500/45' },
  inspection_set: { label: 'Inspection', color: 'border-cyan-300/35 bg-cyan-500/15 text-cyan-100', pin: 'border-cyan-100 bg-cyan-500 shadow-cyan-500/45' },
}

function isValidLocation(loc: BrowserLocation | null): loc is BrowserLocation {
  return !!loc
    && Number.isFinite(loc.lat)
    && Number.isFinite(loc.lng)
    && loc.lat >= -90
    && loc.lat <= 90
    && loc.lng >= -180
    && loc.lng <= 180
}

function openStreetMapEmbedUrl(loc: BrowserLocation) {
  const left = loc.lng - MAP_SPAN
  const right = loc.lng + MAP_SPAN
  const top = loc.lat + MAP_SPAN
  const bottom = loc.lat - MAP_SPAN
  return `https://www.openstreetmap.org/export/embed.html?bbox=${left}%2C${bottom}%2C${right}%2C${top}&layer=mapnik&marker=${loc.lat}%2C${loc.lng}`
}

function externalMapUrl(loc: BrowserLocation) {
  return `https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lng}`
}

function exitMapMode() {
  if (typeof window === 'undefined') return
  const returnTo = new URLSearchParams(window.location.search).get('returnTo')
  if (returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//')) {
    window.location.href = returnTo
    return
  }
  if (window.history.length > 1) {
    window.history.back()
    return
  }
  window.location.href = '/'
}

function statusMeta(status?: string | null) {
  return STATUS_META[String(status || 'new').toLowerCase()] ?? STATUS_META.new
}

function labelForLead(lead: FieldLead) {
  return lead.homeownerName || lead.address || lead.notes || 'Dropped lead'
}

function pinPosition(lead: FieldLead, center: BrowserLocation) {
  if (typeof lead.latitude !== 'number' || typeof lead.longitude !== 'number') return null
  const x = ((lead.longitude - (center.lng - MAP_SPAN)) / (MAP_SPAN * 2)) * 100
  const y = (((center.lat + MAP_SPAN) - lead.latitude) / (MAP_SPAN * 2)) * 100
  return {
    left: `${Math.min(Math.max(x, 5), 95)}%`,
    top: `${Math.min(Math.max(y, 8), 92)}%`,
    offscreen: x < 0 || x > 100 || y < 0 || y > 100,
  }
}

function promptInMainChat(prompt: string) {
  if (typeof window === 'undefined') return
  const encoded = encodeURIComponent(prompt)
  window.location.href = `/?prompt=${encoded}`
}

export function CanvassingMapMode() {
  const [location, setLocation] = useState<BrowserLocation | null>(null)
  const [locating, setLocating] = useState(false)
  const [loadingMap, setLoadingMap] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mapRefreshKey, setMapRefreshKey] = useState(0)
  const [mapData, setMapData] = useState<FieldMapPayload | null>(null)
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null)
  const [showLeads, setShowLeads] = useState(true)

  const leads = useMemo(() => mapData?.leads ?? [], [mapData?.leads])
  const selectedLead = useMemo(() => leads.find(lead => lead.id === selectedLeadId) ?? null, [leads, selectedLeadId])

  const loadMapData = useCallback(async () => {
    setLoadingMap(true)
    try {
      const res = await fetch('/api/canvassing/map?includeConverted=1&limit=250', { credentials: 'same-origin' })
      if (!res.ok) throw new Error('Map data is unavailable.')
      setMapData(await res.json())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Map data is unavailable.')
    } finally {
      setLoadingMap(false)
    }
  }, [])

  const locateMe = useCallback(async () => {
    setError(null)
    if (!navigator.geolocation) {
      setError('GPS is not available in this browser.')
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      pos => {
        setLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyMeters: pos.coords.accuracy,
        })
        setMapRefreshKey(key => key + 1)
        setLocating(false)
      },
      () => {
        setError('Location permission was denied or unavailable.')
        setLocating(false)
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    )
  }, [])

  useEffect(() => {
    queueMicrotask(() => {
      void locateMe()
      void loadMapData()
    })
  }, [loadMapData, locateMe])

  const mapUrl = useMemo(() => isValidLocation(location) ? `${openStreetMapEmbedUrl(location)}&refresh=${mapRefreshKey}` : null, [location, mapRefreshKey])
  const directionsUrl = useMemo(() => isValidLocation(location) ? externalMapUrl(location) : null, [location])
  const visiblePins = useMemo(() => isValidLocation(location)
    ? leads
      .map(lead => ({ lead, pos: pinPosition(lead, location) }))
      .filter((item): item is { lead: FieldLead; pos: NonNullable<ReturnType<typeof pinPosition>> } => Boolean(item.pos))
    : [], [leads, location])

  async function dropLeadHere() {
    if (!isValidLocation(location)) {
      await locateMe()
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/canvassing/leads', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          status: 'new',
          source: 'field_map',
          notes: 'Dropped from field map. Add homeowner, address, and door result from chat.',
          location: { lat: location.lat, lng: location.lng, accuracyMeters: location.accuracyMeters, source: 'field_map_drop' },
          metadata: { droppedFromMap: true },
        }),
      })
      if (!res.ok) throw new Error('Could not drop lead here.')
      const json = await res.json()
      setSelectedLeadId(json?.lead?.id ?? null)
      await loadMapData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not drop lead here.')
    } finally {
      setSaving(false)
    }
  }

  async function updateLeadStatus(lead: FieldLead, status: string) {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/canvassing/leads/${lead.id}/activity`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: status,
          status,
          summary: `Marked ${status.replace(/_/g, ' ')} from field map.`,
          location: isValidLocation(location) ? { lat: location.lat, lng: location.lng, accuracyMeters: location.accuracyMeters, source: 'field_map_status' } : undefined,
        }),
      })
      if (!res.ok) throw new Error('Could not update lead.')
      await loadMapData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update lead.')
    } finally {
      setSaving(false)
    }
  }

  const summary = mapData?.summary

  return (
    <main className="fixed inset-0 z-50 flex min-h-dvh flex-col overflow-hidden bg-slate-950 text-white">
      <div className="absolute inset-x-0 top-0 z-20 border-b border-white/10 bg-slate-950/90 px-3 pb-3 pt-[calc(1.35rem_+_env(safe-area-inset-top))] shadow-2xl backdrop-blur-xl sm:px-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-200/75">
              <Route className="h-3.5 w-3.5" />
              Field command map
            </div>
            <h1 className="truncate text-lg font-semibold leading-tight">Doors, leads, and field pins</h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" variant="secondary" className="rounded-full bg-white/10 px-3 text-white hover:bg-white/15" onClick={locateMe} disabled={locating}>
              {locating ? <Loader2 className="h-4 w-4 animate-spin sm:mr-1.5" /> : <Crosshair className="h-4 w-4 sm:mr-1.5" />}
              <span className="hidden sm:inline">Locate</span>
            </Button>
            <Button size="sm" className="rounded-full px-3" onClick={exitMapMode}>
              <MessageCircle className="h-4 w-4 sm:mr-1.5" />
              <span className="hidden sm:inline">Chat</span>
            </Button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-4 gap-2 text-center text-[11px]">
          <MapStat label="Leads" value={summary?.leadCount ?? leads.length} />
          <MapStat label="Knocked" value={summary?.knocked ?? 0} />
          <MapStat label="Follow-up" value={summary?.followUp ?? 0} />
          <MapStat label="Hot" value={summary?.interested ?? 0} />
        </div>
      </div>

      <div className="relative flex-1 pt-[calc(138px_+_env(safe-area-inset-top))]">
        {mapUrl ? (
          <>
            <iframe
              key={`field-map-${mapRefreshKey}`}
              title="Current field location map"
              src={mapUrl}
              className="h-full w-full border-0 saturate-[.95]"
              loading="eager"
              referrerPolicy="no-referrer"
            />
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0,transparent_34%,rgba(2,6,23,.12)_70%,rgba(2,6,23,.35)_100%)]" />
            <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
              <div className="h-5 w-5 rounded-full border-2 border-white bg-blue-500 shadow-[0_0_24px_rgba(59,130,246,.9)]" />
              <div className="mx-auto mt-1 h-8 w-px bg-blue-500/70" />
            </div>
            {visiblePins.map(({ lead, pos }) => {
              const meta = statusMeta(lead.status)
              const selected = selectedLeadId === lead.id
              return (
                <button
                  key={lead.id}
                  type="button"
                  onClick={() => setSelectedLeadId(lead.id)}
                  className={`absolute z-10 -translate-x-1/2 -translate-y-full rounded-full border-2 shadow-2xl transition ${meta.pin} ${selected ? 'scale-125 ring-4 ring-white/40' : 'hover:scale-110'} ${pos.offscreen ? 'opacity-60' : ''}`}
                  style={{ left: pos.left, top: pos.top }}
                  title={labelForLead(lead)}
                >
                  <span className="block h-4 w-4 rounded-full" />
                </button>
              )
            })}
          </>
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <div className="max-w-sm rounded-3xl border border-white/10 bg-white/10 p-5 shadow-2xl backdrop-blur">
              <Navigation className="mx-auto mb-3 h-8 w-8 text-blue-300" />
              <h2 className="text-lg font-semibold">Show me where you are</h2>
              <p className="mt-2 text-sm text-white/65">
                Tap Locate and allow location. Jobrolo can save field pins, door outcomes, and follow-up leads from here.
              </p>
              {error ? <p className="mt-3 rounded-xl border border-amber-400/30 bg-amber-400/10 p-2 text-xs text-amber-100">{error}</p> : null}
              <Button className="mt-4 w-full" onClick={locateMe} disabled={locating}>
                {locating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Crosshair className="mr-2 h-4 w-4" />}
                Locate me
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="absolute inset-x-3 bottom-[calc(1rem_+_env(safe-area-inset-bottom))] z-20 space-y-2">
        {error ? (
          <div className="rounded-2xl border border-amber-400/30 bg-amber-500/15 px-3 py-2 text-xs text-amber-100 shadow-2xl backdrop-blur">
            {error}
          </div>
        ) : null}

        {selectedLead ? (
          <LeadCard
            lead={selectedLead}
            saving={saving}
            onClose={() => setSelectedLeadId(null)}
            onStatus={status => { void updateLeadStatus(selectedLead, status) }}
            onPrompt={promptInMainChat}
          />
        ) : null}

        {showLeads ? (
          <div className="max-h-[32dvh] overflow-hidden rounded-3xl border border-white/10 bg-slate-950/90 shadow-2xl backdrop-blur-xl">
            <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/60">Nearby pins</div>
                <div className="text-[11px] text-white/45">{leads.length ? 'Tap a lead to work it.' : 'No saved pins yet.'}</div>
              </div>
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full text-white/70 hover:bg-white/10 hover:text-white" onClick={() => { void loadMapData() }} disabled={loadingMap}>
                  {loadingMap ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full text-white/70 hover:bg-white/10 hover:text-white" onClick={() => setShowLeads(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="flex gap-2 overflow-x-auto px-3 py-3">
              {leads.slice(0, 20).map(lead => {
                const meta = statusMeta(lead.status)
                return (
                  <button
                    key={lead.id}
                    type="button"
                    onClick={() => setSelectedLeadId(lead.id)}
                    className="min-w-[210px] rounded-2xl border border-white/10 bg-white/[0.06] p-3 text-left shadow-lg transition hover:bg-white/10"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-white">{labelForLead(lead)}</div>
                        <div className="truncate text-xs text-white/50">{lead.address || lead.phone || 'No address yet'}</div>
                      </div>
                      <span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] ${meta.color}`}>{meta.label}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-3xl border border-white/10 bg-slate-950/90 p-2 text-xs text-white/70 shadow-2xl backdrop-blur-xl">
          <div className="px-2">
            {isValidLocation(location)
              ? <>GPS ready{location.accuracyMeters ? ` · ±${Math.round(location.accuracyMeters)}m` : ''}</>
              : error || 'Waiting for location…'}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="rounded-full bg-emerald-600 px-3 hover:bg-emerald-500" onClick={dropLeadHere} disabled={saving || locating || !isValidLocation(location)}>
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plus className="mr-1.5 h-4 w-4" />}
              Drop lead
            </Button>
            {!showLeads ? (
              <Button size="sm" variant="secondary" className="rounded-full bg-white/10 px-3 text-white hover:bg-white/15" onClick={() => setShowLeads(true)}>
                <MapPin className="mr-1.5 h-4 w-4" />
                Pins
              </Button>
            ) : null}
            {directionsUrl ? (
              <Button size="sm" variant="secondary" className="rounded-full bg-white/10 px-3 text-white hover:bg-white/15" asChild>
                <a href={directionsUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="mr-1.5 h-4 w-4" />
                  Maps
                </a>
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </main>
  )
}

function MapStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.06] px-2 py-2">
      <div className="text-sm font-semibold leading-none text-white">{value}</div>
      <div className="mt-1 truncate text-[10px] uppercase tracking-wide text-white/45">{label}</div>
    </div>
  )
}

function LeadCard({
  lead,
  saving,
  onClose,
  onStatus,
  onPrompt,
}: {
  lead: FieldLead
  saving: boolean
  onClose: () => void
  onStatus: (status: string) => void
  onPrompt: (prompt: string) => void
}) {
  const meta = statusMeta(lead.status)
  const label = labelForLead(lead)
  return (
    <div className="rounded-3xl border border-white/10 bg-slate-950/95 p-3 shadow-2xl backdrop-blur-xl">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Home className="h-4 w-4 text-emerald-200" />
            <h2 className="truncate text-base font-semibold">{label}</h2>
          </div>
          <div className="mt-1 truncate text-xs text-white/50">{lead.address || lead.phone || lead.notes || 'Dropped from field map'}</div>
        </div>
        <button type="button" onClick={onClose} className="rounded-full p-1 text-white/45 hover:bg-white/10 hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <span className={`rounded-full border px-2.5 py-1 text-xs ${meta.color}`}>{meta.label}</span>
        <button type="button" onClick={() => onStatus('knocked')} disabled={saving} className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10">Knocked</button>
        <button type="button" onClick={() => onStatus('no_answer')} disabled={saving} className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10">No answer</button>
        <button type="button" onClick={() => onStatus('interested')} disabled={saving} className="rounded-full border border-emerald-300/25 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-100 hover:bg-emerald-500/20">Interested</button>
        <button type="button" onClick={() => onStatus('follow_up')} disabled={saving} className="rounded-full border border-amber-300/25 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-100 hover:bg-amber-500/20">Follow up</button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button size="sm" variant="secondary" className="rounded-full bg-white/10 text-white hover:bg-white/15" onClick={() => onPrompt(`Update this field lead: ${label}. Add homeowner, phone, address, notes, and next step from chat.`)}>
          <MessageCircle className="mr-1.5 h-4 w-4" />
          Edit in chat
        </Button>
        <Button size="sm" variant="secondary" className="rounded-full bg-white/10 text-white hover:bg-white/15" onClick={() => onPrompt(`Research this field lead/property and tell me what is missing before we convert it: ${label}.`)}>
          <Search className="mr-1.5 h-4 w-4" />
          Research
        </Button>
      </div>
    </div>
  )
}
