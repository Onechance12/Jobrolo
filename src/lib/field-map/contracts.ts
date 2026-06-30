export type GeoCoordinate = {
  lat: number
  lng: number
  accuracyMeters?: number | null
  capturedAt?: string | Date | null
  source?: GeoEventSource | string | null
}

export type GeoEventSource =
  | 'property_address'
  | 'browser_gps'
  | 'manual_pin'
  | 'lead_pin'
  | 'door_attempt'
  | 'field_observation'
  | 'inspection_event'
  | 'photo_evidence'
  | 'document_upload'
  | 'signature_capture'
  | 'material_delivery'
  | 'crew_activity'
  | 'ar_capture'
  | 'system'

export type FieldMapLayerId =
  | 'current_position'
  | 'properties'
  | 'leads'
  | 'door_attempts'
  | 'inspection_events'
  | 'photo_evidence'
  | 'documents'
  | 'signatures'
  | 'materials'
  | 'crew'
  | 'manual_pins'
  | 'ar_captures'

export type FieldMapEntityKind =
  | 'contractor'
  | 'user'
  | 'customer'
  | 'project'
  | 'property'
  | 'canvassing_lead'
  | 'canvassing_activity'
  | 'door_attempt'
  | 'property_observation'
  | 'field_visit'
  | 'document'
  | 'photo'
  | 'signature_request'
  | 'material_order'
  | 'crew_event'

export type FieldMapEntityRef = {
  kind: FieldMapEntityKind
  id: string
  label?: string | null
}

export type FieldMapPointStatus =
  | 'new'
  | 'active'
  | 'needs_review'
  | 'follow_up'
  | 'hot'
  | 'completed'
  | 'blocked'
  | 'do_not_contact'
  | 'hidden'

export type FieldMapPoint = {
  id: string
  layerId: FieldMapLayerId
  coordinate: GeoCoordinate
  title: string
  subtitle?: string | null
  status?: FieldMapPointStatus | string | null
  source: GeoEventSource | string
  entityRefs: FieldMapEntityRef[]
  evidenceType?: string | null
  prompt?: string | null
  metadata?: Record<string, unknown> | null
}

export type FieldMapLayer = {
  id: FieldMapLayerId
  label: string
  purpose: string
  visibleByDefault: boolean
  arRelevant: boolean
}

export type FieldMapViewport = {
  center?: GeoCoordinate | null
  bounds?: {
    minLat: number
    maxLat: number
    minLng: number
    maxLng: number
  } | null
  zoomHint?: 'property' | 'street' | 'neighborhood' | 'territory'
}

export type FieldMapCardActionKind =
  | 'insert_prompt'
  | 'open_full_map'
  | 'drop_pin'
  | 'attach_gps'
  | 'filter_layer'
  | 'open_evidence'

export type FieldMapCardAction = {
  id: string
  label: string
  kind: FieldMapCardActionKind
  promptPattern?: string
  layerId?: FieldMapLayerId
}

export type FieldMapCardContract = {
  cardType: 'field_map_card'
  title: string
  summary: string
  viewport: FieldMapViewport
  layers: FieldMapLayer[]
  points: FieldMapPoint[]
  selectedPointId?: string | null
  counts: {
    totalPoints: number
    pinnedLeads: number
    needsGps: number
    photoEvidence: number
    doorAttempts: number
    signatures: number
  }
  actions: FieldMapCardAction[]
  displayRules: string[]
}

export type FieldMapLeadLike = {
  id: string
  address?: string | null
  homeownerName?: string | null
  phone?: string | null
  notes?: string | null
  status?: string | null
  source?: string | null
  latitude?: number | null
  longitude?: number | null
  updatedAt?: string | Date | null
}

export const FIELD_MAP_DEFAULT_LAYERS: FieldMapLayer[] = [
  { id: 'current_position', label: 'Current position', purpose: 'Where the user is standing now.', visibleByDefault: true, arRelevant: true },
  { id: 'properties', label: 'Properties', purpose: 'Confirmed property/customer/project address locations.', visibleByDefault: true, arRelevant: true },
  { id: 'leads', label: 'Leads', purpose: 'Potential customers, door knocks, and canvassing pins.', visibleByDefault: true, arRelevant: true },
  { id: 'door_attempts', label: 'Door attempts', purpose: 'Knocked, no answer, renter, no soliciting, and follow-up events.', visibleByDefault: true, arRelevant: true },
  { id: 'inspection_events', label: 'Inspection events', purpose: 'Inspection start, observations, and damage notes.', visibleByDefault: true, arRelevant: true },
  { id: 'photo_evidence', label: 'Photos', purpose: 'Photo evidence coordinates tied to inspection/project context.', visibleByDefault: true, arRelevant: true },
  { id: 'documents', label: 'Documents', purpose: 'Uploaded document/signature/source evidence locations.', visibleByDefault: false, arRelevant: true },
  { id: 'signatures', label: 'Signatures', purpose: 'Where signatures or approvals were captured.', visibleByDefault: false, arRelevant: true },
  { id: 'materials', label: 'Materials', purpose: 'Delivery tickets, drops, supplier events, and material readiness.', visibleByDefault: false, arRelevant: false },
  { id: 'crew', label: 'Crew', purpose: 'Crew arrival, production notes, and jobsite actions.', visibleByDefault: false, arRelevant: false },
  { id: 'manual_pins', label: 'Manual pins', purpose: 'Pins manually placed by a user.', visibleByDefault: true, arRelevant: true },
  { id: 'ar_captures', label: 'AR captures', purpose: 'Future glasses/camera/eye-line captures tied to physical context.', visibleByDefault: true, arRelevant: true },
]

export function normalizeGeoCoordinate(input?: GeoCoordinate | null): GeoCoordinate | null {
  if (!input) return null
  const lat = Number(input.lat)
  const lng = Number(input.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return {
    lat,
    lng,
    accuracyMeters: typeof input.accuracyMeters === 'number' && Number.isFinite(input.accuracyMeters) ? input.accuracyMeters : null,
    capturedAt: input.capturedAt ?? null,
    source: input.source ?? null,
  }
}

export function fieldMapPointFromLead(lead: FieldMapLeadLike): FieldMapPoint | null {
  const coordinate = normalizeGeoCoordinate({
    lat: Number(lead.latitude),
    lng: Number(lead.longitude),
    source: 'lead_pin',
    capturedAt: lead.updatedAt ?? null,
  })
  if (!coordinate) return null
  const title = lead.homeownerName || lead.address || lead.notes || 'Field lead'
  return {
    id: `lead:${lead.id}`,
    layerId: 'leads',
    coordinate,
    title,
    subtitle: lead.address || lead.phone || lead.source || null,
    status: lead.status || 'new',
    source: 'lead_pin',
    entityRefs: [{ kind: 'canvassing_lead', id: lead.id, label: title }],
    evidenceType: 'lead',
    prompt: `Open this field lead and show saved context, map location, status, and next actions: ${title}.`,
    metadata: { leadStatus: lead.status ?? null, source: lead.source ?? null },
  }
}

export function buildFieldMapCardContract(input: {
  title?: string
  currentLocation?: GeoCoordinate | null
  leads?: FieldMapLeadLike[]
  points?: FieldMapPoint[]
  selectedPointId?: string | null
}): FieldMapCardContract {
  const leadPoints = (input.leads ?? []).map(fieldMapPointFromLead).filter((point): point is FieldMapPoint => Boolean(point))
  const points = [...leadPoints, ...(input.points ?? [])]
  const center = normalizeGeoCoordinate(input.currentLocation) ?? points[0]?.coordinate ?? null
  const unpinnedLeadCount = (input.leads ?? []).filter(lead => typeof lead.latitude !== 'number' || typeof lead.longitude !== 'number').length

  return {
    cardType: 'field_map_card',
    title: input.title || 'Field map',
    summary: 'Field map truth surface for pins, property evidence, photos, inspections, signatures, and future AR captures.',
    viewport: { center, bounds: computeFieldMapBounds(points.map(point => point.coordinate)), zoomHint: 'property' },
    layers: FIELD_MAP_DEFAULT_LAYERS,
    points,
    selectedPointId: input.selectedPointId ?? null,
    counts: {
      totalPoints: points.length,
      pinnedLeads: leadPoints.length,
      needsGps: unpinnedLeadCount,
      photoEvidence: points.filter(point => point.layerId === 'photo_evidence').length,
      doorAttempts: points.filter(point => point.layerId === 'door_attempts').length,
      signatures: points.filter(point => point.layerId === 'signatures').length,
    },
    actions: [
      { id: 'open-full-map', label: 'Open full map', kind: 'open_full_map' },
      { id: 'drop-pin', label: 'Drop pin', kind: 'drop_pin', promptPattern: 'Drop a field lead pin at my current location and let me add homeowner, address, status, and notes.' },
      { id: 'show-nearby-leads', label: 'Nearby leads', kind: 'insert_prompt', promptPattern: 'Show nearby field leads and door outcomes from saved map records.' },
      { id: 'show-photo-layer', label: 'Photo layer', kind: 'filter_layer', layerId: 'photo_evidence', promptPattern: 'Show photo evidence on this property map, grouped by where each photo was captured.' },
    ],
    displayRules: [
      'A property may have many location events; do not collapse everything into one address pin.',
      'The card is provider-independent: OSM/Google/Mapbox/AR are renderers, not the data model.',
      'Show confirmed customer/project/property truth separately from raw GPS evidence.',
      'Future AR views should consume the same points/layers/actions instead of inventing a separate map model.',
    ],
  }
}

function computeFieldMapBounds(points: GeoCoordinate[]): FieldMapViewport['bounds'] {
  const valid = points.map(normalizeGeoCoordinate).filter((point): point is GeoCoordinate => Boolean(point))
  if (!valid.length) return null
  const lats = valid.map(point => point.lat)
  const lngs = valid.map(point => point.lng)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const minLng = Math.min(...lngs)
  const maxLng = Math.max(...lngs)
  const padLat = Math.max((maxLat - minLat) * 0.15, 0.0002)
  const padLng = Math.max((maxLng - minLng) * 0.15, 0.0002)
  return { minLat: minLat - padLat, maxLat: maxLat + padLat, minLng: minLng - padLng, maxLng: maxLng + padLng }
}
