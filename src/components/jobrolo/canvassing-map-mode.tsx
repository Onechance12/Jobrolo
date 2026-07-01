'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'
import { Crosshair, Home, Link2, Loader2, MapPin, MessageCircle, Navigation, Plus, RefreshCw, Route, Search, Trash2, X } from 'lucide-react'

type BrowserLocation = {
  lat: number
  lng: number
  accuracyMeters?: number | null
}

type MapDropLocation = BrowserLocation & {
  address?: string | null
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

declare global {
  interface Window {
    google?: any
    __jobroloGoogleMapsPromise?: Promise<any>
    __jobroloGoogleMapsLoaded?: () => void
    __jobroloGoogleMapsRejected?: (message?: string) => void
    gm_authFailure?: () => void
  }
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

const STATUS_META: Record<string, { label: string; color: string; pin: string }> = {
  new: { label: 'New', color: 'border-blue-400/35 bg-blue-500/15 text-blue-100', pin: 'border-blue-200 bg-blue-500 shadow-blue-500/40' },
  knocked: { label: 'Knocked', color: 'border-slate-300/30 bg-slate-400/15 text-slate-100', pin: 'border-slate-100 bg-slate-500 shadow-slate-400/35' },
  no_answer: { label: 'No answer', color: 'border-zinc-300/30 bg-zinc-400/15 text-zinc-100', pin: 'border-zinc-100 bg-zinc-600 shadow-zinc-400/35' },
  conversation: { label: 'Conversation', color: 'border-teal-300/35 bg-teal-500/15 text-teal-100', pin: 'border-teal-100 bg-teal-500 shadow-teal-500/45' },
  interested: { label: 'Interested', color: 'border-emerald-300/35 bg-emerald-500/15 text-emerald-100', pin: 'border-emerald-100 bg-emerald-500 shadow-emerald-500/45' },
  follow_up: { label: 'Follow up', color: 'border-amber-300/35 bg-amber-500/15 text-amber-100', pin: 'border-amber-100 bg-amber-500 shadow-amber-500/45' },
  not_interested: { label: 'Not interested', color: 'border-rose-300/35 bg-rose-500/15 text-rose-100', pin: 'border-rose-100 bg-rose-500 shadow-rose-500/40' },
  converted: { label: 'Converted', color: 'border-violet-300/35 bg-violet-500/15 text-violet-100', pin: 'border-violet-100 bg-violet-500 shadow-violet-500/45' },
  inspection_set: { label: 'Inspection', color: 'border-cyan-300/35 bg-cyan-500/15 text-cyan-100', pin: 'border-cyan-100 bg-cyan-500 shadow-cyan-500/45' },
  renter: { label: 'Renter', color: 'border-orange-300/35 bg-orange-500/15 text-orange-100', pin: 'border-orange-100 bg-orange-500 shadow-orange-500/40' },
  no_soliciting: { label: 'No soliciting', color: 'border-red-300/35 bg-red-500/15 text-red-100', pin: 'border-red-100 bg-red-600 shadow-red-500/45' },
  do_not_knock: { label: 'Do not knock', color: 'border-red-300/35 bg-red-950/70 text-red-100', pin: 'border-red-100 bg-red-950 shadow-red-500/45' },
  new_roof: { label: 'New roof', color: 'border-sky-300/35 bg-sky-500/15 text-sky-100', pin: 'border-sky-100 bg-sky-500 shadow-sky-500/40' },
  other_roofer: { label: 'Other roofer', color: 'border-fuchsia-300/35 bg-fuchsia-500/15 text-fuchsia-100', pin: 'border-fuchsia-100 bg-fuchsia-500 shadow-fuchsia-500/40' },
  bad_fit: { label: 'Bad fit', color: 'border-stone-300/35 bg-stone-500/15 text-stone-100', pin: 'border-stone-100 bg-stone-600 shadow-stone-500/35' },
}

const PRIMARY_OUTCOMES = [
  { status: 'no_answer', label: 'No answer' },
  { status: 'conversation', label: 'Conversation' },
  { status: 'not_interested', label: 'Not interested' },
  { status: 'inspection_set', label: 'Inspection' },
  { status: 'renter', label: 'Renter' },
  { status: 'no_soliciting', label: 'No soliciting' },
]

const SECONDARY_OUTCOMES = [
  { status: 'knocked', label: 'Knocked' },
  { status: 'interested', label: 'Interested' },
  { status: 'follow_up', label: 'Follow up' },
  { status: 'do_not_knock', label: 'Do not knock' },
  { status: 'new_roof', label: 'New roof' },
  { status: 'other_roofer', label: 'Other roofer' },
]

const STATUS_MARKER_COLORS: Record<string, { fill: string; stroke: string; glow: string }> = {
  new: { fill: '#3b82f6', stroke: '#dbeafe', glow: 'rgba(59,130,246,.55)' },
  knocked: { fill: '#64748b', stroke: '#f8fafc', glow: 'rgba(148,163,184,.45)' },
  no_answer: { fill: '#52525b', stroke: '#fafafa', glow: 'rgba(161,161,170,.45)' },
  conversation: { fill: '#14b8a6', stroke: '#ccfbf1', glow: 'rgba(20,184,166,.55)' },
  interested: { fill: '#10b981', stroke: '#d1fae5', glow: 'rgba(16,185,129,.6)' },
  follow_up: { fill: '#f59e0b', stroke: '#fef3c7', glow: 'rgba(245,158,11,.55)' },
  not_interested: { fill: '#f43f5e', stroke: '#ffe4e6', glow: 'rgba(244,63,94,.55)' },
  converted: { fill: '#8b5cf6', stroke: '#ede9fe', glow: 'rgba(139,92,246,.6)' },
  inspection_set: { fill: '#06b6d4', stroke: '#cffafe', glow: 'rgba(6,182,212,.6)' },
  renter: { fill: '#f97316', stroke: '#ffedd5', glow: 'rgba(249,115,22,.55)' },
  no_soliciting: { fill: '#dc2626', stroke: '#fee2e2', glow: 'rgba(220,38,38,.6)' },
  do_not_knock: { fill: '#450a0a', stroke: '#fee2e2', glow: 'rgba(220,38,38,.65)' },
  new_roof: { fill: '#0ea5e9', stroke: '#e0f2fe', glow: 'rgba(14,165,233,.55)' },
  other_roofer: { fill: '#d946ef', stroke: '#fae8ff', glow: 'rgba(217,70,239,.55)' },
  bad_fit: { fill: '#78716c', stroke: '#fafaf9', glow: 'rgba(168,162,158,.45)' },
}

const DEFAULT_FIELD_MAP_CENTER: BrowserLocation = {
  lat: 32.9575,
  lng: -97.2575,
  accuracyMeters: null,
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

function statusMarkerColor(status?: string | null) {
  return STATUS_MARKER_COLORS[String(status || 'new').toLowerCase()] ?? STATUS_MARKER_COLORS.new
}

function shortLabelForLead(lead: FieldLead) {
  if (lead.homeownerName) return lead.homeownerName
  if (lead.address) return lead.address
  if (lead.notes?.toLowerCase().includes('inspection photos')) return 'Inspection photos'
  if (lead.notes?.toLowerCase().includes('map tap')) return 'Dropped map pin'
  if (lead.notes?.toLowerCase().includes('current gps')) return 'Dropped GPS pin'
  return 'Field pin'
}

function leadHasPin(lead: FieldLead) {
  return typeof lead.latitude === 'number' && typeof lead.longitude === 'number'
}

function promptInMainChat(prompt: string) {
  if (typeof window === 'undefined') return
  const encoded = encodeURIComponent(prompt)
  try {
    window.sessionStorage.setItem('jobroloPendingPrompt', prompt)
  } catch {}
  window.location.href = `/?prompt=${encoded}`
}

function stagePromptForMainChat(prompt: string) {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem('jobroloPendingPrompt', prompt)
    window.sessionStorage.setItem('jobroloPendingPromptSource', 'field_map')
  } catch {}
}

const GENERIC_FIELD_PIN_NOTES = new Set([
  'Dropped from map tap. Add homeowner, door result, and notes.',
  'Dropped from current GPS. Add homeowner, door result, and notes.',
  'Dropped from map tap. Add homeowner, address, and door result from chat.',
  'Dropped from current GPS. Add homeowner, address, and door result from chat.',
])

function shouldReplaceFieldPinNote(note: string) {
  const clean = note.trim()
  return !clean || GENERIC_FIELD_PIN_NOTES.has(clean)
}

function noteTemplateForStatus(status: string) {
  switch (status) {
    case 'no_answer':
      return 'No answer at the door. Follow-up needed.'
    case 'conversation':
      return 'Had a conversation at the door. Add who answered, what they said, and the next step.'
    case 'not_interested':
      return 'Not interested at this time. Add reason if they gave one.'
    case 'inspection_set':
      return 'Inspection conversation started. Add appointment time, homeowner details, and what they want inspected.'
    case 'renter':
      return 'Renter answered. Need homeowner or property owner contact before follow-up.'
    case 'no_soliciting':
      return 'No soliciting sign observed. Do not knock again unless instructed.'
    case 'knocked':
      return 'Knocked the door. Add result, who answered, or whether follow-up is needed.'
    case 'interested':
      return 'Interested. Add homeowner details, concern, and next step.'
    case 'follow_up':
      return 'Follow up needed. Add when, who to contact, and why.'
    case 'do_not_knock':
      return 'Do not knock. Keep this property suppressed from door attempts.'
    case 'new_roof':
      return 'New roof observed. Likely not an immediate prospect unless they request other work.'
    case 'other_roofer':
      return 'Homeowner mentioned another roofer or existing roofing relationship. Add details.'
    default:
      return `Marked ${status.replace(/_/g, ' ')}. Add field notes and next step.`
  }
}

function mergeStatusNote(current: string, status: string) {
  const template = noteTemplateForStatus(status)
  const clean = current.trim()
  if (shouldReplaceFieldPinNote(clean)) return template
  if (clean.toLowerCase().includes(template.toLowerCase())) return clean
  return `${clean}\n\n${template}`
}

function loadGoogleMaps(apiKey: string) {
  if (window.google?.maps) return Promise.resolve(window.google)
  if (window.__jobroloGoogleMapsPromise) return window.__jobroloGoogleMapsPromise

  window.__jobroloGoogleMapsPromise = new Promise((resolve, reject) => {
    let settled = false
    let attempts = 0
    const maxRuntimeChecks = 80
    const finish = () => {
      if (settled) return
      if (window.google?.maps) {
        settled = true
        resolve(window.google)
        return
      }
      attempts += 1
      if (attempts >= maxRuntimeChecks) {
        fail('Google Maps loaded, but the map runtime was not available.')
        return
      }
      window.setTimeout(finish, 50)
    }
    const fail = (message = 'Google Maps failed to load.') => {
      if (settled) return
      settled = true
      window.__jobroloGoogleMapsPromise = undefined
      const existing = document.querySelector<HTMLScriptElement>('script[data-jobrolo-google-maps="true"]')
      existing?.remove()
      reject(new Error(message))
    }

    window.__jobroloGoogleMapsLoaded = finish
    window.__jobroloGoogleMapsRejected = fail
    window.gm_authFailure = () => fail('Google Maps rejected this browser or API key. Check API restrictions, billing, and allowed referrers.')

    const existing = document.querySelector<HTMLScriptElement>('script[data-jobrolo-google-maps="true"]')
    if (existing) {
      existing.addEventListener('load', finish, { once: true })
      existing.addEventListener('error', () => fail(), { once: true })
      return
    }

    const script = document.createElement('script')
    script.dataset.jobroloGoogleMaps = 'true'
    script.async = true
    script.defer = true
    script.referrerPolicy = 'origin'
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&callback=__jobroloGoogleMapsLoaded&loading=async`
    script.onload = () => window.setTimeout(finish, 50)
    script.onerror = () => fail()
    document.head.appendChild(script)
    window.setTimeout(() => fail('Google Maps timed out while loading.'), 15000)
  })

  return window.__jobroloGoogleMapsPromise
}

export function CanvassingMapMode() {
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )

  if (!mounted) {
    return (
      <main className="fixed inset-0 z-50 flex min-h-dvh items-center justify-center bg-slate-950 px-6 text-center text-white">
        <div className="max-w-sm rounded-3xl border border-cyan-300/15 bg-cyan-500/10 p-5 shadow-2xl backdrop-blur">
          <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-cyan-200" />
          <h1 className="text-lg font-semibold">Opening field map</h1>
          <p className="mt-2 text-sm text-white/65">Loading Jobrolo’s live map, saved pins, and GPS tools.</p>
        </div>
      </main>
    )
  }

  return <CanvassingMapModeClient />
}

function CanvassingMapModeClient() {
  const [location, setLocation] = useState<BrowserLocation | null>(null)
  const [locating, setLocating] = useState(false)
  const [locationAttempted, setLocationAttempted] = useState(false)
  const [loadingMap, setLoadingMap] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mapRefreshKey, setMapRefreshKey] = useState(0)
  const [mapData, setMapData] = useState<FieldMapPayload | null>(null)
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null)
  const [googleMapUnavailable, setGoogleMapUnavailable] = useState(false)
  const [mapChatOpen, setMapChatOpen] = useState(false)

  const leads = useMemo(() => mapData?.leads ?? [], [mapData?.leads])
  const pinnedLeads = useMemo(() => leads.filter(leadHasPin), [leads])
  const unpinnedLeads = useMemo(() => leads.filter(lead => !leadHasPin(lead)), [leads])
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
    setLocationAttempted(false)
    if (!navigator.geolocation) {
      setLocationAttempted(true)
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
        setLocationAttempted(true)
        setLocating(false)
      },
      () => {
        setLocationAttempted(true)
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

  const googleMapsApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() ?? ''
  const hasMapLocation = isValidLocation(location)
  const firstPinnedLead = pinnedLeads.find(leadHasPin)
  const mapCenter = hasMapLocation
    ? location
    : firstPinnedLead
      ? { lat: firstPinnedLead.latitude!, lng: firstPinnedLead.longitude!, accuracyMeters: null }
      : DEFAULT_FIELD_MAP_CENTER
  const useGoogleMap = Boolean(googleMapsApiKey && !googleMapUnavailable)

  const handleGoogleMapUnavailable = useCallback((message?: string) => {
    setGoogleMapUnavailable(true)
    setError(message || 'Google Maps is unavailable. Jobrolo can still save GPS pins, but tap-to-drop needs the Google map provider.')
  }, [])

  const retryGoogleMap = useCallback(() => {
    setError(null)
    setGoogleMapUnavailable(false)
    setMapRefreshKey(key => key + 1)
  }, [])

  function prependLead(lead: FieldLead) {
    setMapData(prev => ({
      ...(prev ?? {}),
      leads: [lead, ...((prev?.leads ?? []).filter(existing => existing.id !== lead.id))],
    }))
    setSelectedLeadId(lead.id)
  }

  async function createLeadAt(target: MapDropLocation, source: 'field_map_drop' | 'field_map_tap') {
    setSaving(true)
    setError(null)
    try {
      const droppedByTap = source === 'field_map_tap'
      const res = await fetch('/api/canvassing/leads', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          status: 'new',
          source: 'field_map',
          address: target.address || undefined,
          notes: droppedByTap
            ? 'Dropped from map tap. Add homeowner, door result, and notes.'
            : 'Dropped from current GPS. Add homeowner, door result, and notes.',
          location: { lat: target.lat, lng: target.lng, accuracyMeters: target.accuracyMeters, source },
          metadata: { droppedFromMap: true, droppedByTap },
        }),
      })
      if (!res.ok) throw new Error('Could not drop lead here.')
      const json = await res.json()
      if (json?.lead) prependLead(json.lead)
      await loadMapData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not drop lead here.')
    } finally {
      setSaving(false)
    }
  }

  async function dropLeadHere() {
    if (!isValidLocation(location)) {
      await locateMe()
      return
    }
    await createLeadAt(location, 'field_map_drop')
  }

  async function dropLeadAtLocation(target: MapDropLocation) {
    if (!isValidLocation(target)) return
    await createLeadAt(target, 'field_map_tap')
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

  async function archiveLead(lead: FieldLead) {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/canvassing/leads/${lead.id}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      })
      if (!res.ok) throw new Error('Could not remove this pin from the map.')
      setMapData(prev => ({
        ...(prev ?? {}),
        leads: (prev?.leads ?? []).filter(existing => existing.id !== lead.id),
      }))
      setSelectedLeadId(null)
      await loadMapData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove this pin from the map.')
    } finally {
      setSaving(false)
    }
  }

  async function updateLeadNotes(lead: FieldLead, notes: string) {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/canvassing/leads/${lead.id}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ notes }),
      })
      if (!res.ok) throw new Error('Could not save this note.')
      await loadMapData()
      setSelectedLeadId(lead.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this note.')
    } finally {
      setSaving(false)
    }
  }

  async function attachCurrentLocation(lead: FieldLead) {
    if (!isValidLocation(location)) {
      await locateMe()
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/canvassing/leads/${lead.id}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          location: { lat: location.lat, lng: location.lng, accuracyMeters: location.accuracyMeters, source: 'field_map_attach_location' },
          metadata: { locationAttachedFromMap: true },
        }),
      })
      if (!res.ok) throw new Error('Could not attach this lead to your current map location.')
      await loadMapData()
      setSelectedLeadId(lead.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not attach this lead to your current map location.')
    } finally {
      setSaving(false)
    }
  }

  const summary = mapData?.summary
  const waitingForInitialLocation = !hasMapLocation && !locationAttempted && !error

  return (
    <main className="fixed inset-0 z-50 flex min-h-dvh flex-col overflow-hidden bg-slate-950 text-white">
      <div className="absolute inset-x-0 top-0 z-20 border-b border-white/10 bg-slate-950/90 px-3 pb-2.5 pt-[calc(1rem_+_env(safe-area-inset-top))] shadow-2xl backdrop-blur-xl sm:px-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-200/75">
              <Route className="h-3.5 w-3.5" />
              Field command map
            </div>
            <h1 className="truncate text-[15px] font-semibold leading-tight sm:text-lg">Doors, leads + field pins</h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" variant="secondary" className="rounded-full bg-white/10 px-3 text-white hover:bg-white/15" onClick={locateMe} disabled={locating}>
              {locating ? <Loader2 className="h-4 w-4 animate-spin sm:mr-1.5" /> : <Crosshair className="h-4 w-4 sm:mr-1.5" />}
              <span className="hidden sm:inline">Locate</span>
            </Button>
            {googleMapUnavailable ? (
              <Button size="sm" variant="secondary" className="rounded-full bg-cyan-500/15 px-3 text-cyan-50 hover:bg-cyan-500/25" onClick={retryGoogleMap}>
                <RefreshCw className="h-4 w-4 sm:mr-1.5" />
                <span className="hidden sm:inline">Map</span>
              </Button>
            ) : null}
            <Button size="sm" className="rounded-full px-3" onClick={() => setMapChatOpen(open => !open)}>
              <MessageCircle className="h-4 w-4 sm:mr-1.5" />
              <span className="hidden sm:inline">Map chat</span>
            </Button>
          </div>
        </div>

        <div className="mt-2 grid grid-cols-4 gap-2 text-center text-[11px]">
          <MapStat label="Pinned" value={pinnedLeads.length} />
          <MapStat label="Need GPS" value={unpinnedLeads.length} />
          <MapStat label="Follow-up" value={summary?.followUp ?? 0} />
          <MapStat label="Hot" value={summary?.interested ?? 0} />
        </div>
      </div>

      <div className="relative flex-1 pt-[calc(126px_+_env(safe-area-inset-top))]">
        {useGoogleMap || hasMapLocation ? (
          <>
            <div className="absolute inset-x-0 bottom-0 top-[calc(126px_+_env(safe-area-inset-top))]">
              {useGoogleMap ? (
                <GoogleFieldMap
                  apiKey={googleMapsApiKey}
                  center={mapCenter}
                  currentLocation={location}
                  leads={pinnedLeads}
                  selectedLeadId={selectedLeadId}
                  dropMode
                  refreshKey={mapRefreshKey}
                  onSelectLead={setSelectedLeadId}
                  onMapTap={dropLeadAtLocation}
                  onUnavailable={handleGoogleMapUnavailable}
                />
              ) : (
                <JobroloMapProviderFallback
                  location={location ?? mapCenter}
                  pinnedLeads={pinnedLeads}
                  unpinnedLeads={unpinnedLeads}
                  googleMapsConfigured={Boolean(googleMapsApiKey)}
                  googleMapUnavailable={googleMapUnavailable}
                  locating={locating}
                  saving={saving}
                  onLocate={locateMe}
                  onRetryMap={retryGoogleMap}
                  onDropHere={dropLeadHere}
                />
              )}
            </div>
            {!useGoogleMap ? (
              <div className="absolute left-1/2 top-5 z-[15] max-w-[92vw] -translate-x-1/2 rounded-2xl border border-amber-300/35 bg-slate-950/95 px-4 py-2 text-center text-xs font-semibold text-amber-100 shadow-2xl backdrop-blur">
                Tap-to-drop needs Google Maps. Use Drop here for your current GPS until the map provider is configured.
              </div>
            ) : null}
            {!useGoogleMap ? (
              <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
              <div className="h-5 w-5 rounded-full border-2 border-white bg-blue-500 shadow-[0_0_24px_rgba(59,130,246,.9)]" />
              <div className="mx-auto mt-1 h-8 w-px bg-blue-500/70" />
              </div>
            ) : null}
          </>
        ) : waitingForInitialLocation ? (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <div className="max-w-sm rounded-3xl border border-cyan-300/15 bg-cyan-500/10 p-5 shadow-2xl backdrop-blur">
              <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-cyan-200" />
              <h2 className="text-lg font-semibold">Preparing field map</h2>
              <p className="mt-2 text-sm text-white/65">
                Getting GPS and loading saved pins. Jobrolo will keep map records separate from customers and jobs until you convert them.
              </p>
              {loadingMap ? <p className="mt-3 text-xs text-cyan-100/70">Loading saved field records…</p> : null}
            </div>
          </div>
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
            key={`${selectedLead.id}:${selectedLead.notes ?? ''}`}
            lead={selectedLead}
            saving={saving}
            hasLocation={isValidLocation(location)}
            onClose={() => setSelectedLeadId(null)}
            onStatus={status => { void updateLeadStatus(selectedLead, status) }}
            onAttachLocation={() => { void attachCurrentLocation(selectedLead) }}
            onArchive={() => { void archiveLead(selectedLead) }}
            onSaveNotes={notes => { void updateLeadNotes(selectedLead, notes) }}
            onStagePrompt={stagePromptForMainChat}
          />
        ) : null}

        {mapChatOpen ? (
          <MapChatCard
            selectedLead={selectedLead}
            onClose={() => setMapChatOpen(false)}
            onPrompt={promptInMainChat}
            onStagePrompt={stagePromptForMainChat}
            onSavePinNote={async note => {
              if (!selectedLead) return
              const existing = (selectedLead.notes ?? '').trim()
              const next = [existing, note.trim()].filter(Boolean).join('\n\n')
              await updateLeadNotes(selectedLead, next)
            }}
            onExitMap={exitMapMode}
          />
        ) : null}

        {!selectedLead && !mapChatOpen && isValidLocation(location) ? (
          <div className="pointer-events-none ml-auto inline-flex rounded-full border border-white/10 bg-slate-950/70 px-3 py-1.5 text-[11px] text-white/60 shadow-2xl backdrop-blur-xl">
            GPS ready{location.accuracyMeters ? ` · ±${Math.round(location.accuracyMeters)}m` : ''} · tap map to drop
          </div>
        ) : null}
      </div>
    </main>
  )
}

function JobroloMapProviderFallback({
  location,
  pinnedLeads,
  unpinnedLeads,
  googleMapsConfigured,
  googleMapUnavailable,
  locating,
  saving,
  onLocate,
  onRetryMap,
  onDropHere,
}: {
  location: BrowserLocation
  pinnedLeads: FieldLead[]
  unpinnedLeads: FieldLead[]
  googleMapsConfigured: boolean
  googleMapUnavailable: boolean
  locating: boolean
  saving: boolean
  onLocate: () => void
  onRetryMap: () => void
  onDropHere: () => void
}) {
  const providerMessage = googleMapsConfigured && googleMapUnavailable
    ? 'Google Maps did not load. Check the browser key, referrer restrictions, billing, and enabled Maps JavaScript API.'
    : 'Google Maps is not configured for this environment. Jobrolo is showing the field data layer without a street-map provider.'

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_50%_45%,rgba(14,165,233,.18),rgba(2,6,23,.96)_58%,#020617_100%)] px-5">
      <div className="absolute inset-0 opacity-[.22] [background-image:linear-gradient(rgba(45,212,191,.55)_1px,transparent_1px),linear-gradient(90deg,rgba(45,212,191,.55)_1px,transparent_1px)] [background-size:54px_54px]" />
      <div className="absolute left-1/2 top-1/2 h-[38rem] w-[38rem] -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-200/10" />
      <div className="absolute left-1/2 top-1/2 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-200/18 shadow-[0_0_80px_rgba(34,211,238,.08)]" />
      <div className="relative w-full max-w-xl rounded-[2rem] border border-cyan-300/20 bg-slate-950/82 p-4 shadow-2xl shadow-cyan-950/40 backdrop-blur-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-100/65">Jobrolo map surface</div>
            <h2 className="mt-1 text-xl font-semibold text-white">Map provider needed for street placement</h2>
          </div>
          <div className="rounded-full border border-cyan-300/25 bg-cyan-500/10 p-2 text-cyan-100">
            <MapPin className="h-5 w-5" />
          </div>
        </div>

        <p className="mt-3 rounded-2xl border border-amber-300/25 bg-amber-500/10 p-3 text-sm leading-relaxed text-amber-50/90">
          {providerMessage}
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">Current GPS</div>
            <div className="mt-1 font-mono text-xs text-white/75">{location.lat.toFixed(6)}, {location.lng.toFixed(6)}</div>
            <div className="mt-1 text-xs text-white/45">{location.accuracyMeters ? `±${Math.round(location.accuracyMeters)}m accuracy` : 'Accuracy unknown'}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">Saved field data</div>
            <div className="mt-1 text-white/75">{pinnedLeads.length} pinned · {unpinnedLeads.length} need GPS</div>
            <div className="mt-1 text-xs text-white/45">Records are still saved; only street-map placement is paused.</div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" className="rounded-full" onClick={onLocate} disabled={locating}>
            {locating ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Crosshair className="mr-1.5 h-4 w-4" />}
            Refresh GPS
          </Button>
          {googleMapsConfigured ? (
            <Button size="sm" variant="secondary" className="rounded-full bg-cyan-500/15 text-cyan-50 hover:bg-cyan-500/25" onClick={onRetryMap}>
              <RefreshCw className="mr-1.5 h-4 w-4" />
              Retry map
            </Button>
          ) : null}
          <Button size="sm" variant="secondary" className="rounded-full bg-emerald-500/15 text-emerald-50 hover:bg-emerald-500/25" onClick={onDropHere} disabled={saving || locating}>
            {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plus className="mr-1.5 h-4 w-4" />}
            Drop GPS lead
          </Button>
        </div>
      </div>
    </div>
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

const GOOGLE_FIELD_MAP_STYLE = [
  { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
]

type LeadMapCluster = {
  id: string
  leads: FieldLead[]
  lat: number
  lng: number
}

function clusterPrecisionForZoom(zoom: number) {
  if (zoom >= 18) return null
  if (zoom >= 16) return 4
  if (zoom >= 13) return 3
  return 2
}

function clusterPinnedLeads(leads: FieldLead[], zoom: number): LeadMapCluster[] {
  const precision = clusterPrecisionForZoom(zoom)
  if (precision === null) {
    return leads.map(lead => ({
      id: lead.id,
      leads: [lead],
      lat: lead.latitude!,
      lng: lead.longitude!,
    }))
  }
  const groups = new Map<string, FieldLead[]>()
  for (const lead of leads) {
    const key = `${lead.latitude!.toFixed(precision)},${lead.longitude!.toFixed(precision)}`
    groups.set(key, [...(groups.get(key) ?? []), lead])
  }
  return Array.from(groups.entries()).map(([key, group]) => ({
    id: key,
    leads: group,
    lat: group.reduce((sum, lead) => sum + lead.latitude!, 0) / group.length,
    lng: group.reduce((sum, lead) => sum + lead.longitude!, 0) / group.length,
  }))
}

async function reverseGeocodeMapAddress(google: any, lat: number, lng: number): Promise<string | null> {
  if (!google?.maps?.Geocoder) return null
  const geocoder = new google.maps.Geocoder()
  return new Promise(resolve => {
    geocoder.geocode({ location: { lat, lng } }, (results: any[] | null, status: string) => {
      if (status !== 'OK' || !results?.length) {
        resolve(null)
        return
      }
      const streetAddress = results.find(result => result.types?.includes('street_address'))
      const premise = results.find(result => result.types?.includes('premise'))
      resolve((streetAddress ?? premise ?? results[0])?.formatted_address ?? null)
    })
  })
}

function GoogleFieldMap({
  apiKey,
  center,
  currentLocation,
  leads,
  selectedLeadId,
  dropMode,
  refreshKey,
  onSelectLead,
  onMapTap,
  onUnavailable,
}: {
  apiKey: string
  center: BrowserLocation
  currentLocation: BrowserLocation | null
  leads: FieldLead[]
  selectedLeadId: string | null
  dropMode: boolean
  refreshKey: number
  onSelectLead: (leadId: string) => void
  onMapTap: (location: MapDropLocation) => void
  onUnavailable: (message?: string) => void
}) {
  const mapElementRef = useRef<HTMLDivElement | null>(null)
  const googleRef = useRef<any>(null)
  const mapRef = useRef<any>(null)
  const markerRefs = useRef<any[]>([])
  const currentMarkerRef = useRef<any>(null)
  const accuracyCircleRef = useRef<any>(null)
  const clickListenerRef = useRef<any>(null)
  const zoomListenerRef = useRef<any>(null)
  const lastRefreshKeyRef = useRef<number | null>(null)
  const [mapReadyVersion, setMapReadyVersion] = useState(0)
  const [mapZoom, setMapZoom] = useState(19)

  useEffect(() => {
    let cancelled = false

    async function bootMap() {
      if (!mapElementRef.current) return
      try {
        const google = await loadGoogleMaps(apiKey)
        if (cancelled || !mapElementRef.current) return
        googleRef.current = google
        mapRef.current = new google.maps.Map(mapElementRef.current, {
          center: { lat: center.lat, lng: center.lng },
          zoom: 19,
          minZoom: 10,
          maxZoom: 21,
          mapTypeId: google.maps.MapTypeId.SATELLITE,
          clickableIcons: false,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: 'greedy',
          styles: GOOGLE_FIELD_MAP_STYLE,
          backgroundColor: '#020617',
        })
        setMapZoom(mapRef.current.getZoom?.() ?? 19)
        zoomListenerRef.current = mapRef.current.addListener('zoom_changed', () => {
          setMapZoom(mapRef.current?.getZoom?.() ?? 19)
        })
        lastRefreshKeyRef.current = refreshKey
        setMapReadyVersion(version => version + 1)
      } catch (err) {
        if (!cancelled) onUnavailable(err instanceof Error ? err.message : undefined)
      }
    }

    void bootMap()

    return () => {
      cancelled = true
      clickListenerRef.current?.remove?.()
      zoomListenerRef.current?.remove?.()
      markerRefs.current.forEach(marker => marker.setMap?.(null))
      currentMarkerRef.current?.setMap?.(null)
      accuracyCircleRef.current?.setMap?.(null)
      markerRefs.current = []
      mapRef.current = null
    }
  }, [apiKey, onUnavailable])

  useEffect(() => {
    const google = googleRef.current
    const map = mapRef.current
    if (!google || !map) return

    const position = { lat: center.lat, lng: center.lng }
    if (lastRefreshKeyRef.current !== refreshKey) {
      map.panTo(position)
      lastRefreshKeyRef.current = refreshKey
    } else if (!currentLocation) {
      map.setCenter(position)
    }
  }, [center.lat, center.lng, currentLocation, mapReadyVersion, refreshKey])

  useEffect(() => {
    const google = googleRef.current
    const map = mapRef.current
    if (!google || !map || !currentLocation) return

    const position = { lat: currentLocation.lat, lng: currentLocation.lng }

    if (!currentMarkerRef.current) {
      currentMarkerRef.current = new google.maps.Marker({
        map,
        position,
        title: 'Current position',
        zIndex: 999,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 9,
          fillColor: '#06b6d4',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 3,
        },
      })
    } else {
      currentMarkerRef.current.setPosition(position)
    }

    if (!accuracyCircleRef.current) {
      accuracyCircleRef.current = new google.maps.Circle({
        map,
        center: position,
        radius: Math.max(8, currentLocation.accuracyMeters ?? 20),
        strokeColor: '#22d3ee',
        strokeOpacity: 0.45,
        strokeWeight: 1,
        fillColor: '#06b6d4',
        fillOpacity: 0.08,
      })
    } else {
      accuracyCircleRef.current.setCenter(position)
      accuracyCircleRef.current.setRadius(Math.max(8, currentLocation.accuracyMeters ?? 20))
    }
  }, [currentLocation, mapReadyVersion])

  useEffect(() => {
    const google = googleRef.current
    const map = mapRef.current
    if (!google || !map) return

    markerRefs.current.forEach(marker => marker.setMap?.(null))
    const clusters = clusterPinnedLeads(leads, mapZoom)
    markerRefs.current = clusters.map(cluster => {
      const lead = cluster.leads[0]
      const color = statusMarkerColor(lead.status)
      const selected = cluster.leads.some(item => item.id === selectedLeadId)
      const isCluster = cluster.leads.length > 1
      const position = { lat: cluster.lat, lng: cluster.lng }
      const marker = new google.maps.Marker({
        map,
        position,
        title: isCluster ? `${cluster.leads.length} field pins` : shortLabelForLead(lead),
        zIndex: isCluster ? 650 : selected ? 700 : 500,
        optimized: false,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: isCluster ? Math.min(20, 12 + cluster.leads.length) : selected ? 11 : 8,
          fillColor: isCluster ? '#0f172a' : color.fill,
          fillOpacity: 1,
          strokeColor: isCluster ? '#67e8f9' : selected ? '#ffffff' : color.stroke,
          strokeWeight: isCluster ? 3 : selected ? 4 : 2,
        },
        label: isCluster
          ? { text: String(cluster.leads.length), color: '#ffffff', fontSize: '12px', fontWeight: '800' }
          : selected
            ? { text: '•', color: '#ffffff', fontSize: '18px', fontWeight: '900' }
          : undefined,
      })
      marker.addListener('click', () => {
        if (isCluster) {
          map.panTo(position)
          map.setZoom(Math.min(21, Math.max(map.getZoom?.() ?? 16, 16) + 2))
          return
        }
        onSelectLead(lead.id)
      })
      return marker
    })
  }, [leads, mapReadyVersion, mapZoom, onSelectLead, selectedLeadId])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    clickListenerRef.current?.remove?.()
    clickListenerRef.current = null
    if (!dropMode) return

    clickListenerRef.current = map.addListener('click', async (event: any) => {
      const latLng = event?.latLng
      if (!latLng) return
      const lat = latLng.lat()
      const lng = latLng.lng()
      const address = await reverseGeocodeMapAddress(googleRef.current, lat, lng)
      onMapTap({
        lat,
        lng,
        accuracyMeters: currentLocation?.accuracyMeters ?? null,
        address,
      })
    })
  }, [currentLocation?.accuracyMeters, dropMode, mapReadyVersion, onMapTap])

  return (
    <div className="relative h-full w-full overflow-hidden bg-slate-950">
      <div ref={mapElementRef} className="h-full w-full" />
      <div className="pointer-events-none absolute right-3 top-3 z-20 rounded-full border border-emerald-300/25 bg-slate-950/75 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-100/85 backdrop-blur">
        Tap map to drop
      </div>
    </div>
  )
}

function MapChatCard({
  selectedLead,
  onClose,
  onPrompt,
  onStagePrompt,
  onSavePinNote,
  onExitMap,
}: {
  selectedLead: FieldLead | null
  onClose: () => void
  onPrompt: (prompt: string) => void
  onStagePrompt: (prompt: string) => void
  onSavePinNote: (note: string) => Promise<void>
  onExitMap: () => void
}) {
  const [draft, setDraft] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [savedNote, setSavedNote] = useState(false)
  const [stagedPrompt, setStagedPrompt] = useState(false)
  const context = selectedLead
    ? `Lead ID: ${selectedLead.id}. Address: ${selectedLead.address || 'unknown'}. Status: ${selectedLead.status || 'new'}.`
    : 'No field pin selected.'
  const composedPrompt = `${draft.trim()}\n\nMap context: ${context}`.trim()

  async function saveNoteInMap() {
    if (!selectedLead || !draft.trim()) return
    setSavingNote(true)
    setSavedNote(false)
    try {
      await onSavePinNote(draft.trim())
      setDraft('')
      setSavedNote(true)
    } finally {
      setSavingNote(false)
    }
  }

  return (
    <div className="rounded-[1.7rem] border border-cyan-300/15 bg-slate-950/94 p-3 shadow-[0_18px_70px_rgba(0,0,0,.45)] backdrop-blur-xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-100/60">Map chat</div>
          <div className="text-sm font-semibold text-white">Add context without leaving the map.</div>
        </div>
        <button type="button" onClick={onClose} className="rounded-full p-1 text-white/45 hover:bg-white/10 hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>
      <textarea
        value={draft}
        onChange={event => setDraft(event.target.value)}
        rows={2}
        placeholder={selectedLead ? 'Add note: homeowner, roof condition, gate code, follow-up, or anything useful...' : 'Select or drop a pin first, then add notes here...'}
        className="mt-3 min-h-16 w-full resize-none rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none placeholder:text-white/35"
      />
      {savedNote ? <div className="mt-2 text-xs text-emerald-100/75">Saved to this field pin.</div> : null}
      {stagedPrompt ? <div className="mt-2 text-xs text-cyan-100/75">Prompt staged. Exit map when you want to continue in the main chat.</div> : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          size="sm"
          className="rounded-full"
          disabled={!selectedLead || !draft.trim() || savingNote}
          onClick={() => { void saveNoteInMap() }}
        >
          {savingNote ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <MessageCircle className="mr-1.5 h-4 w-4" />}
          Save pin note
        </Button>
        <Button
          size="sm"
          variant="secondary"
          className="rounded-full bg-white/10 text-white hover:bg-white/15"
          disabled={!draft.trim()}
          onClick={() => {
            onStagePrompt(composedPrompt)
            setStagedPrompt(true)
          }}
        >
          Stage for Jobrolo
        </Button>
        <Button
          size="sm"
          variant="secondary"
          className="rounded-full bg-white/10 text-white hover:bg-white/15"
          disabled={!draft.trim()}
          onClick={() => onPrompt(composedPrompt)}
        >
          Open chat
        </Button>
        <Button size="sm" variant="secondary" className="rounded-full bg-white/10 text-white hover:bg-white/15" onClick={onExitMap}>
          Exit map
        </Button>
      </div>
    </div>
  )
}

function LeadCard({
  lead,
  saving,
  hasLocation,
  onClose,
  onStatus,
  onAttachLocation,
  onArchive,
  onSaveNotes,
  onStagePrompt,
}: {
  lead: FieldLead
  saving: boolean
  hasLocation: boolean
  onClose: () => void
  onStatus: (status: string) => void
  onAttachLocation: () => void
  onArchive: () => void
  onSaveNotes: (notes: string) => void
  onStagePrompt: (prompt: string) => void
}) {
  const [moreOpen, setMoreOpen] = useState(false)
  const [notesDraft, setNotesDraft] = useState(lead.notes ?? '')
  const [stagedAction, setStagedAction] = useState<string | null>(null)
  const meta = statusMeta(lead.status)
  const label = shortLabelForLead(lead)
  const hasPin = leadHasPin(lead)
  const details = lead.address || lead.phone || 'Address not found yet'
  const currentStatus = String(lead.status || 'new').toLowerCase()
  const primaryOutcomes = PRIMARY_OUTCOMES.filter(outcome => outcome.status !== currentStatus)
  const secondaryOutcomes = SECONDARY_OUTCOMES.filter(outcome => outcome.status !== currentStatus)
  const editPrompt = `Edit this saved field map pin. Lead ID: ${lead.id}. Address: ${lead.address || 'unknown'}. Current status: ${lead.status || 'new'}. Ask me for the exact homeowner, phone, notes, next step, or conversion details, then update this lead with update_canvassing_lead when I provide them.`
  const researchPrompt = `Research this field map pin/property. Lead ID: ${lead.id}. Address: ${lead.address || 'unknown'}. Tell me what is missing before converting it into a customer, job, or follow-up.`

  function handleStatusSelect(status: string) {
    setNotesDraft(current => mergeStatusNote(current, status))
    onStatus(status)
  }

  function stageMapPrompt(prompt: string, label: string) {
    onStagePrompt(prompt)
    setStagedAction(label)
  }

  return (
    <div className="rounded-[1.7rem] border border-white/10 bg-slate-950/94 p-3 shadow-[0_18px_70px_rgba(0,0,0,.45)] backdrop-blur-xl">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Home className="h-4 w-4 text-emerald-200" />
            <h2 className="truncate text-sm font-semibold">Field pin</h2>
            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${meta.color}`}>{meta.label}</span>
          </div>
          <div className="mt-0.5 truncate text-[11px] text-white/48">{label === 'Field pin' ? details : label}</div>
        </div>
        <button type="button" onClick={onClose} className="rounded-full p-1 text-white/45 hover:bg-white/10 hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        {hasPin ? (
          <span className="rounded-2xl border border-cyan-300/20 bg-cyan-500/10 px-3 py-2 text-center text-xs font-medium text-cyan-100">
            GPS saved
          </span>
        ) : null}
        {primaryOutcomes.map(outcome => (
          <button
            key={outcome.status}
            type="button"
            onClick={() => handleStatusSelect(outcome.status)}
            disabled={saving}
            className="rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-medium text-white/90 hover:bg-white/10"
          >
            {outcome.label}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setMoreOpen(open => !open)}
        className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-white/65 hover:bg-white/10"
      >
        {moreOpen ? 'Hide sub options' : 'Show sub options'}
      </button>

      {moreOpen ? (
        <div className="mt-2 flex gap-1.5 overflow-x-auto rounded-2xl border border-white/8 bg-white/[0.035] p-1.5">
          {secondaryOutcomes.map(outcome => {
            const outcomeMeta = statusMeta(outcome.status)
            return (
              <button
                key={outcome.status}
                type="button"
                onClick={() => handleStatusSelect(outcome.status)}
                disabled={saving}
                className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs ${outcomeMeta.color}`}
              >
                {outcome.label}
              </button>
            )
          })}
        </div>
      ) : null}

      <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.04] p-2">
        <textarea
          value={notesDraft}
          onChange={event => setNotesDraft(event.target.value)}
          rows={2}
          placeholder="Add note: spoke with homeowner, renter, roof looked new, no soliciting sign..."
          className="min-h-16 w-full resize-none bg-transparent text-sm text-white outline-none placeholder:text-white/35"
        />
        <div className="mt-2 flex justify-end">
          <Button
            size="sm"
            variant="secondary"
            className="rounded-full bg-emerald-500/15 text-emerald-50 hover:bg-emerald-500/25"
            onClick={() => onSaveNotes(notesDraft)}
            disabled={saving || notesDraft.trim() === (lead.notes ?? '').trim()}
          >
            Save note
          </Button>
        </div>
      </div>
      {stagedAction ? (
        <div className="mt-2 rounded-2xl border border-cyan-300/15 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-50/80">
          {stagedAction} staged for Jobrolo. Stay on the map, or exit when you want to continue the conversation.
        </div>
      ) : null}

      {!hasPin ? (
        <button
          type="button"
          onClick={onAttachLocation}
          disabled={saving || !hasLocation}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl border border-amber-300/25 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-100 hover:bg-amber-500/15 disabled:opacity-50"
        >
          <Link2 className="h-4 w-4" />
          Attach this lead to my current GPS pin
        </button>
      ) : null}
      <div className="mt-2 grid grid-cols-[1fr_1fr_auto] gap-2">
        <Button size="sm" variant="secondary" className="rounded-full bg-white/10 text-white hover:bg-white/15" onClick={() => stageMapPrompt(editPrompt, 'Edit prompt')}>
          <MessageCircle className="mr-1.5 h-4 w-4" />
          Edit
        </Button>
        <Button size="sm" variant="secondary" className="rounded-full bg-white/10 text-white hover:bg-white/15" onClick={() => stageMapPrompt(researchPrompt, 'Research prompt')}>
          <Search className="mr-1.5 h-4 w-4" />
          Research
        </Button>
        <Button
          size="icon"
          variant="secondary"
          className="h-9 w-10 rounded-full border border-red-300/20 bg-red-500/10 text-red-100 hover:bg-red-500/15"
          onClick={onArchive}
          disabled={saving}
          title="Remove this pin from the visible map"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  )
}
