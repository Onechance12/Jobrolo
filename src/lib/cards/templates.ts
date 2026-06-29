export type JobroloCardFamily =
  | 'company'
  | 'customer'
  | 'project'
  | 'files'
  | 'scope'
  | 'report'
  | 'estimate'
  | 'signature'
  | 'approval'
  | 'schedule'
  | 'field'
  | 'chat'
  | 'task'

export type JobroloCardTemplate = {
  id: string
  family: JobroloCardFamily
  cardTypes: string[]
  purpose: string
  glanceLabel: string
  speakableSummary: string
  primaryActionLabel?: string
  primaryPromptPills: Array<{ label: string; promptPattern: string }>
  displayRules: string[]
}

const STRUCTURED_CARD_TYPE_HINTS = [
  'company_profile',
  'company_research',
  'company_intelligence',
  'customer_list',
  'customer_file',
  'scope_breakdown',
  'template_review',
  'document_review',
  'document_link_review',
  'action_center',
  'approval',
  'action_request',
  'report_photo_picker',
  'roof_report',
  'report_share',
  'field_inspection_lead',
  'property_research',
  'canvassing_lead',
  'canvassing_session',
  'property_memory',
  'property_observation',
  'door_attempt',
  'schedule_calendar',
  'schedule_event',
  'calendar_overview',
  'signature_request',
  'signed_document',
  'generated_document_pdf',
  'operator_briefing',
  'radar_alert',
  'created_chat',
  'chat_invite',
]

export const JOBROLO_CARD_TEMPLATES: JobroloCardTemplate[] = [
  {
    id: 'company-profile',
    family: 'company',
    cardTypes: ['company_profile'],
    purpose: 'Show saved company profile truth, brand/document readiness, missing setup gaps, and safe update prompts.',
    glanceLabel: 'Company profile',
    speakableSummary: 'Here’s the saved company profile with setup gaps and brand readiness.',
    primaryActionLabel: 'Update profile',
    primaryPromptPills: [
      { label: 'Edit from chat', promptPattern: 'Make edits to company profile: …' },
      { label: 'Research', promptPattern: 'Research my company online and suggest missing company profile updates. Show what is new before saving.' },
      { label: 'Add logo', promptPattern: 'I want to add my company logo to my company profile for estimates, invoices, reports, contracts, and signatures.' },
    ],
    displayRules: [
      'Show saved profile fields as facts, not markdown bullets.',
      'Show logo or brand placeholder in the header.',
      'Missing setup items must include prompt pills that explain how to fix them.',
      'Public research suggestions must not overwrite saved profile data without approval.',
    ],
  },
  {
    id: 'company-intelligence',
    family: 'company',
    cardTypes: ['company_intelligence', 'company_research_review'],
    purpose: 'Separate public web/social evidence from saved Jobrolo KPIs and suggest growth next moves.',
    glanceLabel: 'Company intelligence',
    speakableSummary: 'Here’s the company intelligence snapshot with public evidence, saved KPIs, and next moves.',
    primaryActionLabel: 'Review growth moves',
    primaryPromptPills: [
      { label: 'Next moves', promptPattern: 'What should I do next to grow? Use saved Jobrolo KPIs, public research, and setup gaps.' },
      { label: 'Research deeper', promptPattern: 'Run a deep company research scan and label public-search evidence clearly.' },
      { label: 'Save updates', promptPattern: 'Save company profile updates from the latest research, but show exactly what will change first.' },
    ],
    displayRules: [
      'Label public evidence separately from database truth.',
      'Dedupe sources and show source previews instead of repeated raw links.',
      'Never claim traffic/attribution unless an analytics integration is connected.',
    ],
  },
  {
    id: 'customer-file',
    family: 'customer',
    cardTypes: ['customer_file', 'customer_list'],
    purpose: 'Show customer-owned projects, photos, documents, notes, tasks, and next actions without CRM navigation.',
    glanceLabel: 'Customer file',
    speakableSummary: 'Here’s the saved customer file with projects, photos, files, and next actions.',
    primaryActionLabel: 'Open customer work',
    primaryPromptPills: [
      { label: 'Job packet', promptPattern: 'Create a clean job packet summary for this customer using saved database records.' },
      { label: 'Photos', promptPattern: 'Show photos grouped by exterior, interior, roof, damage, documents, and other.' },
      { label: 'Files', promptPattern: 'Show files as clickable cards grouped by document type.' },
      { label: 'New job', promptPattern: 'Create a new project/job for this customer and ask what the job is for.' },
    ],
    displayRules: [
      'A customer owns one or more projects visually.',
      'Do not show company assets like logos/profile photos as customer files.',
      'Files/photos need edit/delete/context prompt pills.',
      'Price sheets should be flagged as company pricing candidates unless explicitly job-specific.',
    ],
  },
  {
    id: 'scope-breakdown',
    family: 'scope',
    cardTypes: ['scope_breakdown'],
    purpose: 'Turn saved estimate/scope line items into a readable production/finance surface.',
    glanceLabel: 'Scope breakdown',
    speakableSummary: 'Here’s the saved scope breakdown with totals, deductible math, trades, and editable next steps.',
    primaryActionLabel: 'Draft quote',
    primaryPromptPills: [
      { label: 'Cash quote', promptPattern: 'Create a cash quote/bid from this saved scope and show the draft before saving.' },
      { label: 'Deductible pool', promptPattern: 'Explain the deductible pool and out-of-pocket math using saved scope data only.' },
      { label: 'Report summary', promptPattern: 'Create a clean customer-facing scope summary without raw line-item tables.' },
      { label: 'Edit lines', promptPattern: 'Let me choose line items to include, exclude, or explain before changing anything.' },
    ],
    displayRules: [
      'Never render large markdown tables in chat.',
      'Show financial summary first, then trade breakdown, then sampled line items.',
      'Line item edits must be prompt-first and approval-aware.',
    ],
  },
  {
    id: 'document-file',
    family: 'files',
    cardTypes: ['document_review', 'document_link_review', 'generated_document_pdf', 'signed_document'],
    purpose: 'Make uploaded/generated files openable, reviewable, and routable to company/customer/project buckets.',
    glanceLabel: 'File review',
    speakableSummary: 'Here’s the file review card with extracted details, routing, and safe file actions.',
    primaryActionLabel: 'Review file',
    primaryPromptPills: [
      { label: 'Review', promptPattern: 'Review this file and tell me what it is, what data was extracted, and where it belongs.' },
      { label: 'Attach', promptPattern: 'Attach this file to the correct customer/project after confirming the target.' },
      { label: 'Save as template', promptPattern: 'If this is reusable company material, save it as a company template after review.' },
    ],
    displayRules: [
      'File cards must include open/download actions when a URL exists.',
      'Classification should come from user intent, extracted content, structure, and context before filename.',
      'Low-confidence documents ask one clear question.',
    ],
  },
  {
    id: 'roof-report',
    family: 'report',
    cardTypes: ['roof_report', 'report_photo_picker', 'report_share'],
    purpose: 'Guide photo selection, report drafting, previewing, sharing, and customer/sub/partner routing.',
    glanceLabel: 'Roof report',
    speakableSummary: 'Here’s the roof report workspace with photos, missing items, preview, and sharing actions.',
    primaryActionLabel: 'Work report',
    primaryPromptPills: [
      { label: 'Add photos', promptPattern: 'Let me choose which project photos to include in this report before finalizing.' },
      { label: 'Preview', promptPattern: 'Preview this report and tell me what is missing before sharing.' },
      { label: 'Share', promptPattern: 'Prepare this report to share with the selected audience and ask before sending.' },
    ],
    displayRules: [
      'Reports should stay chat-first but can open a larger workspace when needed.',
      'Photo selection should show thumbnails and removal/edit options.',
      'Sharing must show audience, visibility, and destination before approval.',
    ],
  },
  {
    id: 'approval-action',
    family: 'approval',
    cardTypes: ['action_center', 'approval_request', 'action_request'],
    purpose: 'Explain what needs approval, what will happen, and provide safe prompt/action paths.',
    glanceLabel: 'Action needed',
    speakableSummary: 'Here’s what needs attention, what will happen, and what needs approval.',
    primaryActionLabel: 'Review action',
    primaryPromptPills: [
      { label: 'Review', promptPattern: 'Review this pending action and explain what will happen if approved.' },
      { label: 'Approve', promptPattern: 'Approve this pending action if it is safe. Show the exact action first.' },
      { label: 'Reject', promptPattern: 'Reject this pending action and save the reason.' },
    ],
    displayRules: [
      'Approval cards must not hide the mutation being approved.',
      'Archive/delete/hide should be available where permissions allow.',
      'Do not show raw payload JSON unless Cody/dev mode asks for it.',
    ],
  },
  {
    id: 'field-inspection',
    family: 'field',
    cardTypes: ['field_inspection_lead', 'property_research', 'property_memory', 'property_observation', 'door_attempt', 'canvassing_lead', 'canvassing_session'],
    purpose: 'Keep field work chat-first while preserving location, lead, property, inspection, and photo context.',
    glanceLabel: 'Field work',
    speakableSummary: 'Here’s the field card with location, property context, lead status, and inspection next steps.',
    primaryActionLabel: 'Continue field flow',
    primaryPromptPills: [
      { label: 'Start inspection', promptPattern: 'Start the inspection workflow for this field lead and keep the card active until complete.' },
      { label: 'Research property', promptPattern: 'Research this property using saved location/address and show what needs confirmation.' },
      { label: 'Photo checklist', promptPattern: 'Show the inspection photo checklist and let me tag photos before upload.' },
    ],
    displayRules: [
      'Field cards should be sticky/glanceable and avoid form-like navigation.',
      'Location and GPS evidence must be shown separately from confirmed customer/project truth.',
      'Photo and observation actions should draft editable prompts.',
    ],
  },
  {
    id: 'schedule',
    family: 'schedule',
    cardTypes: ['schedule_calendar', 'schedule_event', 'calendar_overview'],
    purpose: 'Show appointments and scheduling actions as a visual card without turning chat into a calendar module.',
    glanceLabel: 'Schedule',
    speakableSummary: 'Here’s the schedule card with appointments, open time, and scheduling prompts.',
    primaryActionLabel: 'Schedule',
    primaryPromptPills: [
      { label: 'Schedule appointment', promptPattern: 'Schedule an appointment. Ask who it is with, what type, what day, and what time.' },
      { label: 'Today', promptPattern: 'Show my appointments today using saved schedule records.' },
      { label: 'Open time', promptPattern: 'Find open time for an inspection or follow-up.' },
    ],
    displayRules: [
      'Show day and appointment count at a glance.',
      'Selecting a day should create an editable scheduling prompt.',
      'Do not create calendar events without confirmation.',
    ],
  },
  {
    id: 'shared-chat',
    family: 'chat',
    cardTypes: ['created_chat', 'chat_invite'],
    purpose: 'Show newly created shared chats, audience, visibility, and invite/link actions clearly.',
    glanceLabel: 'Shared chat',
    speakableSummary: 'Here’s the shared chat card with the audience, link, visibility, and invite actions.',
    primaryActionLabel: 'Open chat',
    primaryPromptPills: [
      { label: 'Invite person', promptPattern: 'Invite someone to this chat. Ask for their name, email or phone, and role.' },
      { label: 'Copy link', promptPattern: 'Give me a copyable link for this chat and explain who can access it.' },
      { label: 'Starter message', promptPattern: 'Draft a starter message for this shared chat before sending.' },
    ],
    displayRules: [
      'Always show who can see the chat.',
      'Link and invite actions must respect role permissions.',
      'Crew/customer/team chats should be visually distinct but still chat-first.',
    ],
  },
  {
    id: 'operations-radar',
    family: 'task',
    cardTypes: ['operator_briefing', 'radar_alert'],
    purpose: 'Surface proactive operational issues, stale work, routed tasks, and suggested next moves.',
    glanceLabel: 'Operations radar',
    speakableSummary: 'Here’s the operations radar card with the issue, why it matters, and suggested next action.',
    primaryActionLabel: 'Decide next step',
    primaryPromptPills: [
      { label: 'Explain', promptPattern: 'Explain this operations item and what caused it using saved Jobrolo records.' },
      { label: 'Next step', promptPattern: 'Recommend the next step for this operations item and ask before changing records.' },
      { label: 'Create task', promptPattern: 'Create a task from this operations item after showing the assignee, due date, and reason.' },
    ],
    displayRules: [
      'Show one operational decision at a time when possible.',
      'Do not bury important warnings in long text.',
      'Mutations from radar must remain approval-aware.',
    ],
  },
]

function normalizeCardType(cardType: string | null | undefined) {
  return String(cardType || '').toLowerCase()
}

export function findJobroloCardTemplate(cardType: string | null | undefined) {
  const normalized = normalizeCardType(cardType)
  if (!normalized) return null
  return JOBROLO_CARD_TEMPLATES.find(template => template.cardTypes.some(type => normalized.includes(type))) ?? null
}

export function isStructuredJobroloCardType(cardType: string | null | undefined) {
  const normalized = normalizeCardType(cardType)
  if (!normalized) return false
  return Boolean(findJobroloCardTemplate(normalized)) || STRUCTURED_CARD_TYPE_HINTS.some(type => normalized.includes(type))
}

export function getJobroloCardSpeechSummary(cardType: string | null | undefined) {
  const normalized = normalizeCardType(cardType)
  const template = findJobroloCardTemplate(normalized)
  if (template) return template.speakableSummary
  if (normalized.includes('company_research')) return 'I found company profile suggestions. Review the card and tell me what to save or change.'
  if (normalized.includes('template_review')) return 'Here’s the document template review card.'
  if (normalized.includes('action_center')) return 'Here’s what needs attention.'
  if (normalized.includes('schedule')) return 'Here’s the schedule card.'
  if (normalized.includes('signature')) return 'Here’s the signature card.'
  if (normalized.includes('report')) return 'Here’s the report workspace.'
  return 'Here’s the Jobrolo card.'
}
