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
  primaryPromptPills: Array<{ label: string; promptPattern: string }>
  displayRules: string[]
}

export const JOBROLO_CARD_TEMPLATES: JobroloCardTemplate[] = [
  {
    id: 'company-profile',
    family: 'company',
    cardTypes: ['company_profile'],
    purpose: 'Show saved company profile truth, brand/document readiness, missing setup gaps, and safe update prompts.',
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
]

export function findJobroloCardTemplate(cardType: string | null | undefined) {
  const normalized = String(cardType || '').toLowerCase()
  if (!normalized) return null
  return JOBROLO_CARD_TEMPLATES.find(template => template.cardTypes.some(type => normalized.includes(type))) ?? null
}
