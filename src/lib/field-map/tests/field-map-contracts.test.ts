import {
  FIELD_MAP_DEFAULT_LAYERS,
  buildFieldMapCardContract,
  fieldMapPointFromLead,
  normalizeGeoCoordinate,
  type FieldMapPoint,
} from '../contracts'

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export function assertFieldMapContracts() {
  assert(normalizeGeoCoordinate({ lat: 32.9, lng: -97.2 })?.lat === 32.9, 'Valid coordinates should normalize')
  assert(normalizeGeoCoordinate({ lat: 132.9, lng: -97.2 }) === null, 'Invalid latitude should be rejected')
  assert(normalizeGeoCoordinate({ lat: 32.9, lng: -197.2 }) === null, 'Invalid longitude should be rejected')

  const layerIds = new Set(FIELD_MAP_DEFAULT_LAYERS.map(layer => layer.id))
  for (const required of ['current_position', 'properties', 'leads', 'door_attempts', 'inspection_events', 'photo_evidence', 'signatures', 'ar_captures']) {
    assert(layerIds.has(required as any), `Field map should define ${required} layer`)
  }
  assert(FIELD_MAP_DEFAULT_LAYERS.some(layer => layer.id === 'ar_captures' && layer.arRelevant), 'AR capture layer should be explicitly AR-relevant')

  const leadPoint = fieldMapPointFromLead({
    id: 'lead_1',
    homeownerName: 'Natalie Pearson',
    address: '486 North Charles St',
    status: 'follow_up',
    latitude: 32.95,
    longitude: -97.25,
  })
  assert(leadPoint?.id === 'lead:lead_1', 'Lead point should use stable typed id')
  assert(leadPoint?.layerId === 'leads', 'Lead point should land in leads layer')
  assert(leadPoint?.entityRefs.some(ref => ref.kind === 'canvassing_lead' && ref.id === 'lead_1'), 'Lead point should keep entity ref')

  const photoPoint: FieldMapPoint = {
    id: 'photo:doc_1',
    layerId: 'photo_evidence',
    title: 'West window damage',
    subtitle: 'Uploaded during inspection',
    status: 'needs_review',
    source: 'photo_evidence',
    coordinate: { lat: 32.9501, lng: -97.2501, accuracyMeters: 6, source: 'photo_evidence' },
    entityRefs: [
      { kind: 'document', id: 'doc_1', label: 'Window photo' },
      { kind: 'project', id: 'project_1', label: 'Roof repair' },
    ],
    evidenceType: 'inspection_photo',
  }

  const signaturePoint: FieldMapPoint = {
    id: 'signature:sig_1',
    layerId: 'signatures',
    title: 'Agreement signed onsite',
    status: 'completed',
    source: 'signature_capture',
    coordinate: { lat: 32.9502, lng: -97.2502, accuracyMeters: 12, source: 'signature_capture' },
    entityRefs: [{ kind: 'signature_request', id: 'sig_1' }],
  }

  const contract = buildFieldMapCardContract({
    currentLocation: { lat: 32.95, lng: -97.25, accuracyMeters: 9, source: 'browser_gps' },
    leads: [
      { id: 'lead_1', homeownerName: 'Natalie Pearson', latitude: 32.95, longitude: -97.25 },
      { id: 'lead_2', homeownerName: 'Needs GPS' },
    ],
    points: [photoPoint, signaturePoint],
  })

  assert(contract.cardType === 'field_map_card', 'Field map contract should expose field_map_card')
  assert(contract.counts.pinnedLeads === 1, 'Pinned lead count should use lead coordinates')
  assert(contract.counts.needsGps === 1, 'Unpinned lead count should be preserved')
  assert(contract.counts.photoEvidence === 1, 'Photo evidence count should be layer based')
  assert(contract.counts.signatures === 1, 'Signature count should be layer based')
  assert(contract.points.length === 3, 'One property/workflow should support multiple independent map points')
  assert(Boolean(contract.viewport.bounds), 'Contract should compute bounds from available points')
  assert(contract.displayRules.some(rule => /many location events/i.test(rule)), 'Contract should document many-location-events rule')
  assert(contract.displayRules.some(rule => /renderer/i.test(rule)), 'Contract should keep map provider separate from truth')

  return true
}

if (process.argv[1]?.endsWith('field-map-contracts.test.ts')) {
  assertFieldMapContracts()
  console.log('field map contracts passed')
}
