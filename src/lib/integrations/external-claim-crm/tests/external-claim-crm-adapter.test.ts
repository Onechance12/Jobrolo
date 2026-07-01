import { createJobroloClaimPacketFromExternalClaimCrm, summarizeJobroloClaimPacket } from '../adapter'
import type { ExternalClaimCrmInput } from '../types'

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message)
}

const FIXED_NOW = new Date('2026-07-01T12:00:00.000Z')

const submittedAwaitingConfirmation: ExternalClaimCrmInput = {
  sourceSystem: 'external_claim_crm',
  sourceRecordType: 'contact',
  sourceId: 'external-contact-two-confirmations',
  customerName: 'Test Homeowner A',
  address: '2414 Summit View St, Grand Prairie, TX, 75050',
  status: 'Submitted Awaiting Confirmation',
  recordType: 'Insurance',
  carrier: 'State Farm',
  claimNumber: 'CLM-430',
  policyNumber: 'POL-58',
  dateOfLoss: '2026-04-26',
  typeOfLoss: 'Hail',
  deductibleAmount: 4800,
  notes: [
    'Claim filed. Adjuster supposed to reach out.',
    'Expedite filing. Confirm check redirection before payment is released.',
  ],
  openTasks: [
    { title: 'Estimate Inspection', dueDate: '2026-05-07', assignee: { name: 'Office Admin' } },
  ],
}

const readyForAppraisal: ExternalClaimCrmInput = {
  sourceSystem: 'external_claim_crm',
  sourceRecordType: 'contact',
  sourceId: 'external-contact-ready-appraisal',
  customerName: 'Test Homeowner B',
  address: '4607 W Red Bird Ln, Dallas, TX, 75236',
  status: 'Ready for Appraisal',
  recordType: 'Insurance',
  carrier: 'Allstate',
  claimNumber: 'CLM-829',
  policyNumber: 'POL-844',
  dateOfLoss: null,
  typeOfLoss: 'Hail',
  deductibleAmount: 5000,
  adjusterName: 'Carrier Adjuster',
  adjusterPhone: '(251) 508-4496',
  adjusterEmail: 'claims@example.com',
  notes: [
    'ACV received.',
    'Ready for appraisal.',
  ],
  openTasks: [
    { title: 'Estimate Inspection', dueDate: '2026-05-22', assignee: { name: 'Appraisal Desk' } },
  ],
}

const submittedForAppraisal: ExternalClaimCrmInput = {
  sourceSystem: 'external_claim_crm',
  sourceRecordType: 'contact',
  sourceId: 'external-contact-appraisal-submitted',
  customerName: 'Test Homeowner C',
  address: '1244 Echols Dr, Frisco, TX, 75036',
  status: 'Submitted for Appraisal',
  recordType: 'Insurance',
  carrier: 'Allstate',
  claimNumber: 'CLM-813',
  policyNumber: 'POL-836',
  dateOfLoss: '2026-03-18',
  typeOfLoss: 'Wind/Hail',
  deductibleAmount: 33231,
  notes: [
    'Initial appraisal file discussed with supervisor.',
    'Review before meeting and confirm demand/status/carrier response.',
  ],
  openTasks: [],
}

export function assertExternalClaimCrmAdapterContracts() {
  const confirmationPacket = createJobroloClaimPacketFromExternalClaimCrm(submittedAwaitingConfirmation, { now: FIXED_NOW })
  assert(confirmationPacket.operatingModelId === 'public_adjuster', 'External claim CRM records should become public-adjuster packets')
  assert(confirmationPacket.workflow.phase === 'two_key_confirmations', `Submitted Awaiting Confirmation should route to two_key_confirmations, got ${confirmationPacket.workflow.phase}`)
  assert(confirmationPacket.workflow.lane === 'review', 'Two-confirmation file should be review lane')
  assert(confirmationPacket.workflow.ownerLane === 'office_admin', 'Two-confirmation file should be office-admin owned')
  assert(confirmationPacket.tasks.some(task => task.overdue), 'Past-due external CRM task should be marked overdue in packet')
  assert(confirmationPacket.importWarnings.some(warning => /overdue/i.test(warning)), 'Packet should warn about overdue source tasks')

  const appraisalPacket = createJobroloClaimPacketFromExternalClaimCrm(readyForAppraisal, { now: FIXED_NOW })
  assert(appraisalPacket.workflow.phase === 'ready_for_appraisal', `Ready for Appraisal should route to ready_for_appraisal, got ${appraisalPacket.workflow.phase}`)
  assert(appraisalPacket.workflow.lane === 'appraisal', 'Ready for appraisal should be appraisal lane')
  assert(appraisalPacket.workflow.missingInfo.includes('date of loss'), 'Missing date of loss should stay visible')
  assert(appraisalPacket.workflow.recommendedNextAction.toLowerCase().includes('appraisal'), 'Ready appraisal file should recommend appraisal packet/checklist')

  const submittedPacket = createJobroloClaimPacketFromExternalClaimCrm(submittedForAppraisal, { now: FIXED_NOW })
  assert(submittedPacket.workflow.phase === 'appraisal_submitted', `Submitted for Appraisal should route to appraisal_submitted, got ${submittedPacket.workflow.phase}`)
  assert(submittedPacket.workflow.ownerLane === 'carrier_adjuster', 'Submitted appraisal should wait on carrier/appraisal response lane')
  assert(submittedPacket.timelineHints.some(hint => /Initial appraisal file/i.test(hint)), 'Source notes should become timeline hints, not raw shared messages')

  const summary = summarizeJobroloClaimPacket(appraisalPacket)
  assert(summary.includes('Test Homeowner B'), 'Summary should include customer')
  assert(summary.includes('Phase: ready_for_appraisal'), 'Summary should include phase')
  assert(summary.length < 900, 'Summary should stay compact for Codex/live QA')

  const noWritebackRule = confirmationPacket.codexTestNotes.join(' ')
  assert(/Do not mutate the external CRM/i.test(noWritebackRule), 'Packet should carry no-writeback safety note')

  return true
}

if (process.argv[1]?.endsWith('external-claim-crm-adapter.test.ts')) {
  assertExternalClaimCrmAdapterContracts()
  console.log('External claim CRM adapter contracts passed')
}
