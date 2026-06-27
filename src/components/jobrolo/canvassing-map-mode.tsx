'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Crosshair, ExternalLink, Loader2, MapPin, MessageCircle, Navigation } from 'lucide-react'

type BrowserLocation = {
  lat: number
  lng: number
  accuracyMeters?: number | null
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
  const span = 0.006
  const left = loc.lng - span
  const right = loc.lng + span
  const top = loc.lat + span
  const bottom = loc.lat - span
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

export function CanvassingMapMode() {
  const [location, setLocation] = useState<BrowserLocation | null>(null)
  const [locating, setLocating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mapRefreshKey, setMapRefreshKey] = useState(0)

  async function locateMe() {
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
  }

  useEffect(() => {
    void locateMe()
  }, [])

  const mapUrl = useMemo(() => isValidLocation(location) ? `${openStreetMapEmbedUrl(location)}&refresh=${mapRefreshKey}` : null, [location, mapRefreshKey])
  const directionsUrl = useMemo(() => isValidLocation(location) ? externalMapUrl(location) : null, [location])

  return (
    <main className="fixed inset-0 z-50 flex min-h-dvh flex-col overflow-hidden bg-slate-950 text-white">
      <div className="absolute inset-x-0 top-0 z-10 border-b border-white/10 bg-slate-950/85 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-white/55">
              <MapPin className="h-3.5 w-3.5" />
              Field map
            </div>
            <h1 className="truncate text-base font-semibold">Current location</h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" variant="secondary" onClick={locateMe} disabled={locating}>
              {locating ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Crosshair className="mr-1.5 h-4 w-4" />}
              Locate
            </Button>
            <Button size="sm" onClick={exitMapMode}>
              <MessageCircle className="mr-1.5 h-4 w-4" />
              Back
            </Button>
          </div>
        </div>
      </div>

      <div className="relative flex-1 pt-[72px]">
        {mapUrl ? (
          <iframe
            key={`field-map-${mapRefreshKey}`}
            title="Current field location map"
            src={mapUrl}
            className="h-full w-full border-0"
            loading="eager"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <div className="max-w-sm rounded-3xl border border-white/10 bg-white/10 p-5 shadow-2xl backdrop-blur">
              <Navigation className="mx-auto mb-3 h-8 w-8 text-blue-300" />
              <h2 className="text-lg font-semibold">Show me where you are</h2>
              <p className="mt-2 text-sm text-white/65">
                Tap Locate and allow location. This map is only a quick view — field work stays in the chat.
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

      <div className="absolute inset-x-3 bottom-4 z-10 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-slate-950/85 p-2 text-xs text-white/70 shadow-2xl backdrop-blur">
        <div className="px-2">
          {isValidLocation(location)
            ? <>GPS ready{location.accuracyMeters ? ` · ±${Math.round(location.accuracyMeters)}m` : ''}</>
            : error || 'Waiting for location…'}
        </div>
        <div className="flex gap-2">
          {directionsUrl ? (
            <Button size="sm" variant="secondary" asChild>
              <a href={directionsUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-1.5 h-4 w-4" />
                Open maps
              </a>
            </Button>
          ) : null}
          <Button size="sm" onClick={exitMapMode}>Exit map</Button>
        </div>
      </div>
    </main>
  )
}
