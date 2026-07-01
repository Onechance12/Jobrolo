export type JobroloOperatingModelId =
  | 'roofing_retail'
  | 'insurance_restoration'
  | 'public_adjuster'
  | 'multi_trade_partner_network'

export type SharedWorkRole =
  | 'homeowner'
  | 'contractor'
  | 'public_adjuster'
  | 'carrier_adjuster'
  | 'window_trade'
  | 'crew_sub'
  | 'office_admin'
  | 'referral_partner'

export type SharedTruthPrimitive =
  | 'contact'
  | 'property'
  | 'claim'
  | 'project'
  | 'documents'
  | 'photos'
  | 'tasks'
  | 'appointments'
  | 'timeline'
  | 'financials'
  | 'shared_chats'

export type PublicAdjusterPhase =
  | 'intake_paperwork'
  | 'photo_file_estimate_build'
  | 'pa_estimate_review'
  | 'two_key_confirmations'
  | 'carrier_negotiation'
  | 'awaiting_acv_payment_control'
  | 'ready_for_appraisal'
  | 'appraisal_submitted'
  | 'carrier_appraiser_assigned'
  | 'appraisal_meeting_scheduled'
  | 'appraisal_approval_scope_pending'
  | 'umpire'
  | 'finalized_awaiting_appraisal_acv'
  | 'payment_closeout'
  | 'closeout_hold'
  | 'manual_review'

export type ClaimPriority = 'low' | 'normal' | 'high' | 'critical'

export interface OperatingModelDefinition {
  id: JobroloOperatingModelId
  label: string
  purpose: string
  sharedTruth: SharedTruthPrimitive[]
  defaultSharedRoles: SharedWorkRole[]
  operatingRules: string[]
}

export interface PublicAdjusterWorkflowInput {
  status?: string | null
  notesText?: string | null
  claimNumber?: string | null
  policyNumber?: string | null
  carrier?: string | null
  dateOfLoss?: string | null
  deductibleAmount?: number | null
  carrierAdjusterName?: string | null
  carrierAdjusterPhone?: string | null
  carrierAdjusterEmail?: string | null
  mortgageCompany?: string | null
  paymentsCount?: number | null
  daysInStatus?: number | null
  lastClientTouchDays?: number | null
  openTasksCount?: number | null
  overdueTasksCount?: number | null
}

export interface PublicAdjusterWorkflowResult {
  phase: PublicAdjusterPhase
  lane: 'intake' | 'estimating' | 'review' | 'negotiation' | 'appraisal' | 'payment' | 'closeout' | 'manual'
  ownerLane: 'homeowner' | 'public_adjuster' | 'contractor' | 'carrier_adjuster' | 'office_admin'
  priority: ClaimPriority
  categories: string[]
  missingInfo: string[]
  bottleneck: string
  recommendedNextAction: string
  suggestedTask: string
  suggestedInternalNote: string
}

export const JOBROLO_OPERATING_MODELS: OperatingModelDefinition[] = [
  {
    id: 'roofing_retail',
    label: 'Roofing / Retail Contractor',
    purpose: 'Run leads, inspections, estimates, production, collections, job cost, closeout, and customer communication from one chat-first truth system.',
    sharedTruth: ['contact', 'property', 'project', 'documents', 'photos', 'tasks', 'appointments', 'timeline', 'financials', 'shared_chats'],
    defaultSharedRoles: ['homeowner', 'contractor', 'crew_sub', 'office_admin', 'referral_partner'],
    operatingRules: [
      'A customer may have multiple projects; each project owns its documents, photos, financials, schedule, and closeout.',
      'Shared chats are scoped windows into the project, not separate records of truth.',
    ],
  },
  {
    id: 'insurance_restoration',
    label: 'Insurance Restoration Contractor',
    purpose: 'Coordinate claim documentation, estimates/scopes, supplements, mortgage checks, production, job cost, and homeowner/carrier communication.',
    sharedTruth: ['contact', 'property', 'claim', 'project', 'documents', 'photos', 'tasks', 'appointments', 'timeline', 'financials', 'shared_chats'],
    defaultSharedRoles: ['homeowner', 'contractor', 'carrier_adjuster', 'crew_sub', 'office_admin'],
    operatingRules: [
      'Claim facts, scope facts, and supplement opportunities must be separated.',
      'Do not state coverage or legal conclusions; show saved documents, gaps, and recommended next steps.',
    ],
  },
  {
    id: 'public_adjuster',
    label: 'Public Adjuster / Claim Advocate',
    purpose: 'Operate claim files from intake through estimate review, confirmations, appraisal, payment control, and closeout while coordinating with homeowner and contractor partners.',
    sharedTruth: ['contact', 'property', 'claim', 'documents', 'photos', 'tasks', 'appointments', 'timeline', 'financials', 'shared_chats'],
    defaultSharedRoles: ['homeowner', 'public_adjuster', 'contractor', 'carrier_adjuster', 'office_admin'],
    operatingRules: [
      'A PA file is claim-first; contractor work can collaborate through shared chats and explicitly shared documents.',
      'Track two key confirmations before appraisal/payment transitions: homeowner authorization/context and carrier/appraiser/payment-control context.',
      'Use careful PA language: no legal advice, no coverage guarantees, and no private internal notes shared externally by default.',
    ],
  },
  {
    id: 'multi_trade_partner_network',
    label: 'Multi-Trade / Partner Network',
    purpose: 'Coordinate roofers, windows, gutters, PAs, referral partners, homeowners, and crews around one property/project truth without creating separate apps.',
    sharedTruth: ['contact', 'property', 'claim', 'project', 'documents', 'photos', 'tasks', 'appointments', 'timeline', 'financials', 'shared_chats'],
    defaultSharedRoles: ['homeowner', 'contractor', 'public_adjuster', 'window_trade', 'crew_sub', 'referral_partner', 'office_admin'],
    operatingRules: [
      'Each role gets only the shared chat/files/tasks intended for that role.',
      'The property/project/claim truth remains unified even when multiple parties collaborate.',
    ],
  },
]

const PA_STATUS_PHASES: Array<{ pattern: RegExp; phase: PublicAdjusterPhase }> = [
  { pattern: /\b(need paperwork|missing paperwork|need info|new|intake)\b/, phase: 'intake_paperwork' },
  { pattern: /\b(photo file|estimate needed|estimating|estimate build)\b/, phase: 'photo_file_estimate_build' },
  { pattern: /\b(pa review|ready for pa review|estimate review)\b/, phase: 'pa_estimate_review' },
  { pattern: /\b(two confirmations|confirmation|awaiting confirmation)\b/, phase: 'two_key_confirmations' },
  { pattern: /\b(carrier negotiation|final negotiation|negotiat)\b/, phase: 'carrier_negotiation' },
  { pattern: /\b(awaiting acv|acv payment|payment control|mortgage)\b/, phase: 'awaiting_acv_payment_control' },
  { pattern: /\b(ready for appraisal|appraisal interest)\b/, phase: 'ready_for_appraisal' },
  { pattern: /\b(submitted for appraisal|appraisal submitted)\b/, phase: 'appraisal_submitted' },
  { pattern: /\b(carrier appraiser assigned)\b/, phase: 'carrier_appraiser_assigned' },
  { pattern: /\b(appraisal inspection scheduled|appraisal meeting scheduled)\b/, phase: 'appraisal_meeting_scheduled' },
  { pattern: /\b(appraisal approval|awaiting estimate)\b/, phase: 'appraisal_approval_scope_pending' },
  { pattern: /\b(umpire)\b/, phase: 'umpire' },
  { pattern: /\b(appraisal finalized|finalized awaiting acv|awaiting appraisal acv)\b/, phase: 'finalized_awaiting_appraisal_acv' },
  { pattern: /\b(ready for billing|billed|payment|closeout)\b/, phase: 'payment_closeout' },
  { pattern: /\b(lost|hold|closed)\b/, phase: 'closeout_hold' },
]

const PHASE_LANE: Record<PublicAdjusterPhase, PublicAdjusterWorkflowResult['lane']> = {
  intake_paperwork: 'intake',
  photo_file_estimate_build: 'estimating',
  pa_estimate_review: 'review',
  two_key_confirmations: 'review',
  carrier_negotiation: 'negotiation',
  awaiting_acv_payment_control: 'payment',
  ready_for_appraisal: 'appraisal',
  appraisal_submitted: 'appraisal',
  carrier_appraiser_assigned: 'appraisal',
  appraisal_meeting_scheduled: 'appraisal',
  appraisal_approval_scope_pending: 'appraisal',
  umpire: 'appraisal',
  finalized_awaiting_appraisal_acv: 'payment',
  payment_closeout: 'closeout',
  closeout_hold: 'closeout',
  manual_review: 'manual',
}

const PHASE_OWNER: Record<PublicAdjusterPhase, PublicAdjusterWorkflowResult['ownerLane']> = {
  intake_paperwork: 'homeowner',
  photo_file_estimate_build: 'public_adjuster',
  pa_estimate_review: 'public_adjuster',
  two_key_confirmations: 'office_admin',
  carrier_negotiation: 'public_adjuster',
  awaiting_acv_payment_control: 'office_admin',
  ready_for_appraisal: 'public_adjuster',
  appraisal_submitted: 'carrier_adjuster',
  carrier_appraiser_assigned: 'carrier_adjuster',
  appraisal_meeting_scheduled: 'public_adjuster',
  appraisal_approval_scope_pending: 'public_adjuster',
  umpire: 'public_adjuster',
  finalized_awaiting_appraisal_acv: 'office_admin',
  payment_closeout: 'office_admin',
  closeout_hold: 'office_admin',
  manual_review: 'office_admin',
}

function normalize(value?: string | null) {
  return String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function detectPhase(input: PublicAdjusterWorkflowInput): PublicAdjusterPhase {
  const text = normalize(`${input.status ?? ''} ${input.notesText ?? ''}`)
  for (const item of PA_STATUS_PHASES) {
    if (item.pattern.test(text)) return item.phase
  }
  if (input.claimNumber || input.carrier || input.policyNumber) return 'pa_estimate_review'
  return 'manual_review'
}

function missingInfoForPhase(input: PublicAdjusterWorkflowInput, phase: PublicAdjusterPhase) {
  const missing: string[] = []
  if (!input.claimNumber) missing.push('claim number')
  if (!input.carrier) missing.push('insurance carrier')
  if (!input.dateOfLoss) missing.push('date of loss')
  if (phase !== 'intake_paperwork' && !input.policyNumber) missing.push('policy number')
  if (['carrier_negotiation', 'ready_for_appraisal', 'appraisal_submitted', 'carrier_appraiser_assigned', 'appraisal_meeting_scheduled'].includes(phase)) {
    if (!input.carrierAdjusterName) missing.push('carrier adjuster name')
    if (!input.carrierAdjusterPhone && !input.carrierAdjusterEmail) missing.push('carrier adjuster contact')
  }
  if (['awaiting_acv_payment_control', 'finalized_awaiting_appraisal_acv', 'payment_closeout'].includes(phase) && !input.mortgageCompany) {
    missing.push('mortgage/payment-control information')
  }
  return missing
}

function priorityFor(input: PublicAdjusterWorkflowInput, phase: PublicAdjusterPhase, missingInfo: string[]): ClaimPriority {
  const overdueTasks = input.overdueTasksCount ?? 0
  const daysInStatus = input.daysInStatus ?? 0
  const closedLike = phase === 'closeout_hold'

  if (closedLike && overdueTasks === 0) return 'low'
  if (overdueTasks >= 3) return 'critical'
  if (['appraisal_meeting_scheduled', 'umpire', 'awaiting_acv_payment_control'].includes(phase) && overdueTasks > 0) return 'high'
  if (daysInStatus >= 21 && !closedLike) return 'high'
  if (missingInfo.length >= 4 && !closedLike) return 'high'
  if (['ready_for_appraisal', 'carrier_negotiation', 'finalized_awaiting_appraisal_acv'].includes(phase)) return 'normal'
  return 'normal'
}

function describeBottleneck(phase: PublicAdjusterPhase, missingInfo: string[]) {
  if (missingInfo.length) return `Missing ${missingInfo.slice(0, 3).join(', ')}${missingInfo.length > 3 ? '…' : ''}.`
  switch (phase) {
    case 'intake_paperwork': return 'Waiting on intake paperwork and claim basics.'
    case 'photo_file_estimate_build': return 'Photo file or estimate package still needs to be built.'
    case 'pa_estimate_review': return 'PA estimate review is the next control point.'
    case 'two_key_confirmations': return 'Two key confirmations are required before moving the file forward.'
    case 'carrier_negotiation': return 'Carrier negotiation/dispute response is the active bottleneck.'
    case 'awaiting_acv_payment_control': return 'ACV/payment-control details must be tracked before closeout.'
    case 'ready_for_appraisal': return 'File appears ready for appraisal packet/submission review.'
    case 'appraisal_submitted': return 'Waiting for appraisal response or carrier appraiser assignment.'
    case 'carrier_appraiser_assigned': return 'Carrier appraiser is assigned; meeting/inspection scheduling is next.'
    case 'appraisal_meeting_scheduled': return 'Appraisal meeting is scheduled; packet/readiness must be confirmed.'
    case 'appraisal_approval_scope_pending': return 'Appraisal approval exists but estimate/scope details are still pending.'
    case 'umpire': return 'Umpire path needs careful tracking and licensed review.'
    case 'finalized_awaiting_appraisal_acv': return 'Appraisal is finalized; ACV/payment collection is pending.'
    case 'payment_closeout': return 'Billing/payment closeout is the active control point.'
    case 'closeout_hold': return 'Closed/hold/lost file should stay low-noise unless a payment/task is active.'
    default: return 'Needs manual review because the phase is unclear.'
  }
}

function recommendedAction(phase: PublicAdjusterPhase) {
  switch (phase) {
    case 'intake_paperwork': return 'Ask for the missing claim basics and documents before routing to estimating or appraisal.'
    case 'photo_file_estimate_build': return 'Build/review the photo file and estimate package before PA review.'
    case 'pa_estimate_review': return 'Review estimate, documents, photos, and claim gaps before client/carrier communication.'
    case 'two_key_confirmations': return 'Confirm homeowner authorization/context and carrier/payment-control context before advancing.'
    case 'carrier_negotiation': return 'Prepare negotiation notes from saved documents and keep homeowner-facing language separate.'
    case 'awaiting_acv_payment_control': return 'Track ACV/payment-control status and confirm mortgage/company payment handling.'
    case 'ready_for_appraisal': return 'Prepare appraisal packet/readiness checklist and ask before sharing externally.'
    case 'appraisal_submitted': return 'Track submission status, follow-up due date, and carrier appraiser assignment.'
    case 'carrier_appraiser_assigned': return 'Schedule/confirm appraisal inspection and prepare packet notes.'
    case 'appraisal_meeting_scheduled': return 'Show meeting readiness, packet gaps, photos, and speaking points.'
    case 'appraisal_approval_scope_pending': return 'Request/review approved appraisal estimate or scope before billing/payment movement.'
    case 'umpire': return 'Flag for licensed PA/attorney-sensitive review and keep notes factual.'
    case 'finalized_awaiting_appraisal_acv': return 'Track ACV/payment collection and homeowner/mortgage next steps.'
    case 'payment_closeout': return 'Verify invoice/payment records and closeout checklist before closing the file.'
    case 'closeout_hold': return 'Keep the file quiet unless there is an open task, payment issue, or user asks to reopen it.'
    default: return 'Ask one clarifying question to classify the claim file stage.'
  }
}

export function classifyPublicAdjusterWorkflow(input: PublicAdjusterWorkflowInput): PublicAdjusterWorkflowResult {
  const phase = detectPhase(input)
  const missingInfo = missingInfoForPhase(input, phase)
  const priority = priorityFor(input, phase, missingInfo)
  const lane = PHASE_LANE[phase]
  const ownerLane = PHASE_OWNER[phase]
  const categories = [
    'claim-file',
    lane,
    ownerLane,
    ...(input.claimNumber ? ['claim-number-saved'] : []),
    ...(input.paymentsCount ? ['payment-activity'] : []),
    ...(input.overdueTasksCount ? ['overdue-task'] : []),
  ]

  const bottleneck = describeBottleneck(phase, missingInfo)
  const action = recommendedAction(phase)

  return {
    phase,
    lane,
    ownerLane,
    priority,
    categories,
    missingInfo,
    bottleneck,
    recommendedNextAction: action,
    suggestedTask: priority === 'low'
      ? 'No urgent task. Keep available in the claim file unless reopened.'
      : action,
    suggestedInternalNote: `PA workflow: ${phase}. ${bottleneck} ${action}`,
  }
}

export function getOperatingModelInstruction(modelId: JobroloOperatingModelId) {
  const model = JOBROLO_OPERATING_MODELS.find(item => item.id === modelId)
  if (!model) return ''
  return [
    `${model.label}: ${model.purpose}`,
    `Shared truth: ${model.sharedTruth.join(', ')}.`,
    `Default collaboration roles: ${model.defaultSharedRoles.join(', ')}.`,
    `Rules: ${model.operatingRules.join(' ')}`,
  ].join('\n')
}

