import { normalizeActivitySpineEvent, renderActivitySpineMemory } from '../../activity-spine'
import { buildActiveJobroloContext } from '../../jobrolo-context'
import { suggestJobroloNextPaths } from '../../next-paths'
import { buildSkillRoutingContext } from '../../skills/context'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export function assertFoundationContextContracts() {
  const fieldEvent = normalizeActivitySpineEvent({
    contractorId: 'contractor_1',
    projectId: 'project_1',
    customerId: 'customer_1',
    type: 'field_observation',
    source: 'field',
    title: 'Saw missing shingles from the ground',
    summary: 'Soft metal dents visible near front elevation.',
    location: { latitude: 32.95737, longitude: -97.25742, accuracyMeters: 11, source: 'browser_gps' },
    confidence: 0.92,
    confirmed: true,
  })
  assert(fieldEvent.shouldWriteProjectTimeline, 'Project field observations should be timeline-write candidates')
  assert(fieldEvent.memorySummary.includes('GPS'), 'Activity memory should preserve GPS summary')
  assert(fieldEvent.confidence === 0.92, 'Activity confidence should be preserved when valid')

  const noProjectEvent = normalizeActivitySpineEvent({
    contractorId: 'contractor_1',
    type: 'upload_saved',
    source: 'upload',
    title: 'Saved company logo candidate',
  })
  assert(!noProjectEvent.shouldWriteProjectTimeline, 'Company/unresolved uploads should not write project timeline')

  const memory = renderActivitySpineMemory([fieldEvent, noProjectEvent])
  assert(memory.includes('field_observation'), 'Activity memory should render event types')

  const context = buildSkillRoutingContext({
    latestText: 'Upload this logo for my company profile.',
    activeCustomerId: 'customer_1',
    activeProjectId: null,
    activeWorkspaceId: 'workspace_1',
    documentIds: ['doc_1'],
    upload: {
      filename: 'IMG_1234.png',
      mimeType: 'image/png',
      recentUserText: 'Upload this logo for my company profile.',
      uploadPurpose: 'company_logo',
    },
  })
  const active = buildActiveJobroloContext(context)
  assert(active.hasCustomer, 'Active context should detect customer id')
  assert(!active.hasProject, 'Active context should not invent project id')
  assert(active.boundaries.some(boundary => boundary.includes('contractor company')), 'Active context should include company-not-customer boundary')

  const paths = suggestJobroloNextPaths(context)
  assert(paths.some(path => path.id === 'confirm-brand-asset'), 'Company logo uploads should suggest brand confirmation path')
  assert(paths.some(path => path.requiresApproval), 'Brand/profile updates should require approval path')

  const fieldContext = buildSkillRoutingContext({
    latestText: 'Saw roof damage from ground. Missing shingles and dents to soft metals.',
  })
  const fieldPaths = suggestJobroloNextPaths(fieldContext)
  assert(fieldPaths.some(path => path.id === 'save-field-observation'), 'Field observations should suggest saving field note')

  const filesContext = buildSkillRoutingContext({
    latestText: 'Show files for Timothy grouped by photos and documents.',
  })
  const filePaths = suggestJobroloNextPaths(filesContext)
  assert(filePaths.some(path => path.id === 'show-file-hub'), 'File requests should suggest grouped file hub')

  return true
}

if (process.argv[1]?.endsWith('foundation-context.test.ts')) {
  assertFoundationContextContracts()
  console.log('foundation context contracts passed')
}
