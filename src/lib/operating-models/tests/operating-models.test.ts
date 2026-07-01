import {
  classifyPublicAdjusterWorkflow,
  getOperatingModelInstruction,
  JOBROLO_OPERATING_MODELS,
} from '../index'

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message)
}

export function assertOperatingModelContracts() {
  const pa = JOBROLO_OPERATING_MODELS.find(model => model.id === 'public_adjuster')
  assert(Boolean(pa), 'Public adjuster operating model should exist')
  assert(Boolean(pa?.sharedTruth.includes('claim')), 'Public adjuster model should be claim-first')
  assert(Boolean(pa?.sharedTruth.includes('shared_chats')), 'Public adjuster model should support shared chats')
  assert(Boolean(pa?.defaultSharedRoles.includes('homeowner')), 'Public adjuster model should include homeowner collaboration')
  assert(Boolean(pa?.defaultSharedRoles.includes('contractor')), 'Public adjuster model should include contractor collaboration')

  const network = JOBROLO_OPERATING_MODELS.find(model => model.id === 'multi_trade_partner_network')
  assert(Boolean(network?.defaultSharedRoles.includes('window_trade')), 'Multi-trade model should support window/trade partners')
  assert(Boolean(network?.defaultSharedRoles.includes('public_adjuster')), 'Multi-trade model should support PA collaboration')

  const intake = classifyPublicAdjusterWorkflow({
    status: 'Need Paperwork/Info',
    notesText: 'Waiting on policy and claim number.',
  })
  assert(intake.phase === 'intake_paperwork', `Need paperwork should be intake_paperwork, got ${intake.phase}`)
  assert(intake.ownerLane === 'homeowner', 'Intake missing paperwork should be homeowner-owned first')
  assert(intake.missingInfo.includes('claim number'), 'Intake should identify missing claim number')

  const appraisal = classifyPublicAdjusterWorkflow({
    status: 'Carrier Appraiser Assigned',
    claimNumber: 'CLM-123',
    carrier: 'Example Carrier',
    policyNumber: 'POL-456',
    dateOfLoss: '2026-05-12',
    carrierAdjusterName: 'Jane Adjuster',
    daysInStatus: 3,
  })
  assert(appraisal.phase === 'carrier_appraiser_assigned', `Carrier appraiser status should route to carrier_appraiser_assigned, got ${appraisal.phase}`)
  assert(appraisal.lane === 'appraisal', 'Carrier appraiser assigned should be appraisal lane')
  assert(appraisal.ownerLane === 'carrier_adjuster', 'Carrier appraiser assigned should be carrier-adjuster owned')
  assert(appraisal.recommendedNextAction.includes('Schedule') || appraisal.recommendedNextAction.includes('schedule'), 'Carrier appraiser assigned should recommend scheduling/confirming appraisal')

  const closed = classifyPublicAdjusterWorkflow({
    status: 'Lost / Hold/Closed',
    daysInStatus: 99,
    overdueTasksCount: 0,
  })
  assert(closed.phase === 'closeout_hold', `Closed/lost should route to closeout_hold, got ${closed.phase}`)
  assert(closed.priority === 'low', `Closed/lost without overdue tasks should stay low priority, got ${closed.priority}`)

  const stuck = classifyPublicAdjusterWorkflow({
    status: 'Submitted for Appraisal',
    claimNumber: 'CLM-789',
    carrier: 'Example Carrier',
    policyNumber: 'POL-789',
    dateOfLoss: '2026-04-02',
    overdueTasksCount: 4,
  })
  assert(stuck.priority === 'critical', `Overdue appraisal file should become critical, got ${stuck.priority}`)
  assert(stuck.categories.includes('overdue-task'), 'Overdue PA file should include overdue-task category')

  const instruction = getOperatingModelInstruction('public_adjuster')
  assert(instruction.includes('Public Adjuster'), 'PA operating model instruction should render label')
  assert(instruction.includes('Shared truth'), 'Operating model instruction should render shared truth')
  assert(instruction.length < 1200, 'Operating model instruction should stay compact')

  return true
}

if (process.argv[1]?.endsWith('operating-models.test.ts')) {
  assertOperatingModelContracts()
  console.log('operating model contracts passed')
}

