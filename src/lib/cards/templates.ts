export type JobroloCardFamily =
  | 'company'
  | 'customer'
  | 'lead'
  | 'project'
  | 'user'
  | 'files'
  | 'scope'
  | 'template'
  | 'report'
  | 'estimate'
  | 'finance'
  | 'signature'
  | 'approval'
  | 'permission'
  | 'schedule'
  | 'field'
  | 'chat'
  | 'supplier'
  | 'integration'
  | 'timeline'
  | 'task'
  | 'claim'
  | 'notification'
  | 'meta'

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
  'lead_intake',
  'scope_breakdown',
  'cash_quote',
  'bid_quote',
  'proposal_draft',
  'estimate_proposal',
  'customer_invoice',
  'invoice',
  'payment_request',
  'payment_record',
  'job_cost',
  'project_financial_summary',
  'financial_ledger',
  'labor_cost',
  'commission',
  'material_order',
  'supplier_quote',
  'price_list',
  'price_sheet_review',
  'template_library',
  'document_template',
  'agreement_template',
  'template_review',
  'document_review',
  'document_link_review',
  'evidence_intake',
  'evidence_packet',
  'intake_decision',
  'user_profile',
  'profile_photo',
  'photo_evidence',
  'photo_gallery',
  'action_center',
  'approval',
  'action_request',
  'permission_review',
  'access_review',
  'visibility_review',
  'report_photo_picker',
  'roof_report',
  'report_share',
  'homeowner_portal',
  'external_share',
  'partner_share',
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
  'production_status',
  'project_readiness',
  'activity_timeline',
  'insurance_claim',
  'claim_summary',
  'supplement_review',
  'integration_readiness',
  'supplier_invoice',
  'delivery_ticket',
  'notification_outbox',
  'message_draft',
  'queued_message',
  'signature_request',
  'signed_document',
  'generated_document_pdf',
  'operator_briefing',
  'radar_alert',
  'created_chat',
  'chat_invite',
  'cody_review',
  'qa_packet',
  'codex_packet',
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
    id: 'lead-intake',
    family: 'lead',
    cardTypes: ['lead_intake', 'potential_lead', 'new_lead'],
    purpose: 'Capture a potential customer from any source before converting it into a customer/job.',
    glanceLabel: 'Lead intake',
    speakableSummary: 'Here’s the lead intake card with known details, missing details, source, and next steps.',
    primaryActionLabel: 'Work lead',
    primaryPromptPills: [
      { label: 'Start inspection', promptPattern: 'Start an inspection workflow for this lead and keep it as a lead until customer/job is confirmed.' },
      { label: 'Add details', promptPattern: 'Help me complete this lead. Ask for only the most useful missing detail next.' },
      { label: 'Create customer/job', promptPattern: 'Convert this lead into a customer/job after showing what will be created.' },
    ],
    displayRules: [
      'Show source, contact, address, urgency, and next step without a bulky form.',
      'Save partial lead truth instead of forcing every field upfront.',
      'Conversion to customer/project should be explicit and approval-aware.',
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
    id: 'cash-quote',
    family: 'estimate',
    cardTypes: ['cash_quote', 'bid_quote', 'proposal_draft'],
    purpose: 'Draft cash bids, proposals, and quotes from saved context without drifting into inspection, report, or lead workflows.',
    glanceLabel: 'Cash quote',
    speakableSummary: 'Here’s the cash quote card with customer/project context, assumptions, totals, and draft actions.',
    primaryActionLabel: 'Draft quote',
    primaryPromptPills: [
      { label: 'Draft bid', promptPattern: 'Draft a cash quote for this job using saved customer/project context. Show assumptions before saving.' },
      { label: 'Add line item', promptPattern: 'Add or adjust a quote line item. Ask what item, quantity, and price before changing anything.' },
      { label: 'Customer version', promptPattern: 'Turn this quote into a customer-facing proposal draft and show it before sending.' },
    ],
    displayRules: [
      'Quote cards must stay tied to a resolved customer/project/address or ask for one.',
      'Do not start field inspection or roof report workflows just because the quote mentions an address.',
      'Show assumptions, exclusions, totals, and approval/share status clearly.',
    ],
  },
  {
    id: 'estimate-proposal',
    family: 'estimate',
    cardTypes: ['estimate_proposal', 'customer_estimate', 'proposal_draft'],
    purpose: 'Create customer-facing estimates/proposals from saved scope, pricing, labor assumptions, company terms, and approval status.',
    glanceLabel: 'Estimate / proposal',
    speakableSummary: 'Here’s the estimate/proposal card with customer context, line-item assumptions, totals, and customer-facing readiness.',
    primaryActionLabel: 'Build estimate',
    primaryPromptPills: [
      { label: 'Build estimate', promptPattern: 'Build an estimate/proposal from the saved project scope, price list, and labor assumptions. Show assumptions before saving.' },
      { label: 'Check margin', promptPattern: 'Check the margin on this estimate using the project financial ledger and show what costs are missing.' },
      { label: 'Customer draft', promptPattern: 'Create a customer-facing proposal draft from this estimate and ask before sending or signing.' },
    ],
    displayRules: [
      'Estimates must reference saved project/customer context and source scope/pricing when possible.',
      'Separate proposed revenue from approved contract/invoice truth.',
      'Show assumptions and missing cost inputs before presenting margin as reliable.',
    ],
  },
  {
    id: 'job-cost',
    family: 'finance',
    cardTypes: ['job_cost', 'project_financial_summary', 'financial_ledger', 'margin_summary', 'profit_summary'],
    purpose: 'Show the project financial truth sheet: revenue, costs, payments, commission, gross profit, margin, missing entries, and source evidence.',
    glanceLabel: 'Job cost sheet',
    speakableSummary: 'Here’s the job cost sheet with revenue, costs, payments, commission, margin, missing data, and source documents.',
    primaryActionLabel: 'Review job cost',
    primaryPromptPills: [
      { label: 'Add material cost', promptPattern: 'Add a material cost entry to this project. Ask for supplier, amount, source document, and approval before saving.' },
      { label: 'Add labor cost', promptPattern: 'Add a labor/subcontractor cost entry to this project. Ask for crew/vendor, amount, and source evidence before saving.' },
      { label: 'Calculate margin', promptPattern: 'Calculate job margin from approved financial entries and list missing or estimated numbers.' },
      { label: 'Show source docs', promptPattern: 'Show the source documents behind this job cost sheet: contract, invoices, payments, supplier bills, labor, and commission.' },
    ],
    displayRules: [
      'Treat documents as evidence and ProjectFinancialEntry rows as financial truth.',
      'Separate candidate, estimated, approved, collected, paid, rejected, and voided entries.',
      'Never present margin as final when material/labor/commission/payment entries are missing or candidate-only.',
    ],
  },
  {
    id: 'invoice',
    family: 'finance',
    cardTypes: ['invoice', 'customer_invoice', 'payment_request', 'payment_record', 'accounts_receivable'],
    purpose: 'Represent customer invoices, payment requests, payments received, balances due, due dates, and source documents.',
    glanceLabel: 'Invoice / payment',
    speakableSummary: 'Here’s the invoice/payment card with amount, status, balance, due date, and source evidence.',
    primaryActionLabel: 'Review invoice',
    primaryPromptPills: [
      { label: 'Create invoice draft', promptPattern: 'Create a customer invoice draft from approved project revenue and show amount, due date, and payment instructions before saving.' },
      { label: 'Record payment', promptPattern: 'Record a customer payment for this project. Ask for amount, date, method, and source evidence before saving.' },
      { label: 'Balance due', promptPattern: 'Show the balance due using approved invoices and payments from the project financial ledger.' },
    ],
    displayRules: [
      'Do not confuse supplier invoices with customer invoices.',
      'Customer invoices and payments affect revenue/collections; supplier invoices affect job cost.',
      'Sending invoices or payment links requires approval and correct customer visibility.',
    ],
  },
  {
    id: 'labor-cost',
    family: 'finance',
    cardTypes: ['labor_cost', 'subcontractor_cost', 'crew_cost', 'labor_quote'],
    purpose: 'Track labor/subcontractor cost assumptions, quotes, invoices, crew assignments, and source evidence for the job cost sheet.',
    glanceLabel: 'Labor cost',
    speakableSummary: 'Here’s the labor cost card with crew/vendor, scope, amount, status, and source evidence.',
    primaryActionLabel: 'Add labor',
    primaryPromptPills: [
      { label: 'Add labor cost', promptPattern: 'Add a labor or subcontractor cost for this project. Ask for crew/vendor, scope, amount, and source evidence.' },
      { label: 'Compare quote', promptPattern: 'Compare this subcontractor quote to the project scope and show what is included, excluded, and missing.' },
      { label: 'Update job cost', promptPattern: 'Prepare to update the job cost sheet with this labor cost after showing what will change.' },
    ],
    displayRules: [
      'Labor costs are project-level cost truth, not customer-facing pricing unless explicitly shared.',
      'Separate quoted, approved, invoiced, and paid labor states.',
      'Tie labor entries to crew/sub chats or documents when available.',
    ],
  },
  {
    id: 'commission',
    family: 'finance',
    cardTypes: ['commission', 'sales_commission', 'rep_commission', 'commission_summary'],
    purpose: 'Calculate and explain sales rep commission from saved rules, project revenue, payments, job cost, and commission status.',
    glanceLabel: 'Commission',
    speakableSummary: 'Here’s the commission card with basis, rate, eligible revenue, deductions, payout estimate, and missing inputs.',
    primaryActionLabel: 'Calculate commission',
    primaryPromptPills: [
      { label: 'Calculate', promptPattern: 'Calculate sales rep commission for this project using saved financial entries and explain the basis and missing inputs.' },
      { label: 'Add commission', promptPattern: 'Add a commission entry to the project financial ledger after showing the rep, basis, rate, and amount.' },
      { label: 'Payment status', promptPattern: 'Show whether commission is estimated, approved, payable, paid, or blocked by missing collection/job-cost data.' },
    ],
    displayRules: [
      'Commission should never be final unless the compensation rule and revenue/cost/payment basis are known.',
      'Keep commission internal-only unless explicitly shared with authorized internal roles.',
      'Show whether the calculation is based on contract amount, collected amount, gross profit, or manual override.',
    ],
  },
  {
    id: 'material-order',
    family: 'supplier',
    cardTypes: ['material_order', 'delivery_ticket', 'supplier_quote', 'material_delivery', 'order_status'],
    purpose: 'Track material quotes, orders, delivery tickets, substitutions, backorders, and invoices as production and job-cost evidence.',
    glanceLabel: 'Material order',
    speakableSummary: 'Here’s the material order card with supplier, order/delivery status, linked costs, and missing evidence.',
    primaryActionLabel: 'Check materials',
    primaryPromptPills: [
      { label: 'Check status', promptPattern: 'Show material order and delivery readiness from saved records. If no supplier API is connected, say what is missing.' },
      { label: 'Attach ticket', promptPattern: 'Attach this delivery ticket or material order document to the correct project and show what it proves.' },
      { label: 'Create cost', promptPattern: 'Prepare a material cost entry from this supplier invoice/order after confirming project, supplier, and amount.' },
    ],
    displayRules: [
      'Material orders are not the same as reusable company price lists.',
      'Delivery tickets prove delivery/status; supplier invoices prove cost.',
      'Never place or change supplier orders without explicit approval and configured provider access.',
    ],
  },
  {
    id: 'price-list',
    family: 'supplier',
    cardTypes: ['price_list', 'price_sheet', 'price_sheet_review', 'material_price_list', 'material_price_rows'],
    purpose: 'Review supplier material pricing as company-level pricing before importing rows.',
    glanceLabel: 'Price list',
    speakableSummary: 'Here’s the supplier price list card with row review, source, status, and import actions.',
    primaryActionLabel: 'Review rows',
    primaryPromptPills: [
      { label: 'Review rows', promptPattern: 'Show the first price list rows with supplier, item, unit, price, and import status.' },
      { label: 'Import prices', promptPattern: 'Prepare to import this price list into company pricing. Show what will change before approval.' },
      { label: 'Supplier source', promptPattern: 'Explain which supplier this price list appears to belong to and how confident Jobrolo is.' },
    ],
    displayRules: [
      'Price sheets are company pricing by default, not customer/project files.',
      'Show row counts and sample rows instead of dumping huge tables.',
      'Import/replace pricing requires explicit approval.',
    ],
  },
  {
    id: 'template-library',
    family: 'template',
    cardTypes: ['template_library', 'document_template', 'agreement_template', 'template_review'],
    purpose: 'Store reusable agreements, estimate templates, invoice templates, warranties, terms, and report templates at the company level.',
    glanceLabel: 'Template library',
    speakableSummary: 'Here’s the company template card with reusable documents, missing template needs, and safe conversion actions.',
    primaryActionLabel: 'Review template',
    primaryPromptPills: [
      { label: 'Review template', promptPattern: 'Review this reusable company template and tell me what fields/placeholders it needs.' },
      { label: 'Save template', promptPattern: 'Save this as a company template after showing the template type and intended use.' },
      { label: 'Create from template', promptPattern: 'Create a customer/job document from this template. Ask for the target customer/project first.' },
    ],
    displayRules: [
      'Templates are company-level unless explicitly tied to a job.',
      'Do not save a customer-signed document as a reusable template without confirmation.',
      'Show template type, placeholders, approval/signature needs, and where it can be used.',
    ],
  },
  {
    id: 'evidence-intake',
    family: 'files',
    cardTypes: ['evidence_intake', 'evidence_packet', 'intake_decision', 'upload_intake'],
    purpose: 'Show what Jobrolo thinks a new upload/photo/field capture/AR capture is, why it thinks that, where it should go, and the one next decision needed.',
    glanceLabel: 'Evidence intake',
    speakableSummary: 'Here’s the evidence intake card with classification, confidence, signals, destination, and the next safe action.',
    primaryActionLabel: 'Decide routing',
    primaryPromptPills: [
      { label: 'Confirm route', promptPattern: 'Confirm where this evidence should be saved after showing classification, confidence, and destination.' },
      { label: 'Change type', promptPattern: 'Change what this evidence is. Let me choose company pricing, template, customer file, project scope, job cost, photo evidence, or profile asset.' },
      { label: 'Ask one question', promptPattern: 'Ask me one clear question needed to route this evidence safely.' },
      { label: 'Show signals', promptPattern: 'Show the evidence signals behind this classification: user intent, extracted content, context, GPS, filename, and confidence.' },
    ],
    displayRules: [
      'This is the universal intake surface for uploads, camera captures, voice notes, field observations, and future AR/glasses evidence.',
      'Show user intent, visible content/structure, app context, GPS, and filename as separate evidence signals.',
      'Filename and PDF metadata are weak evidence and must never be shown as the only reason for confident routing.',
      'If confidence is low or signals conflict, ask one clear question instead of attaching/importing automatically.',
      'Treat GPS/location as evidence until tied to a confirmed customer/project/property.',
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
    id: 'user-profile',
    family: 'user',
    cardTypes: ['user_profile', 'profile_photo', 'avatar'],
    purpose: 'Manage the logged-in user profile, avatar, role hints, and personal setup without mixing it into company or customer records.',
    glanceLabel: 'User profile',
    speakableSummary: 'Here’s the user profile card with profile photo, role, and personal setup actions.',
    primaryActionLabel: 'Update profile',
    primaryPromptPills: [
      { label: 'Update photo', promptPattern: 'Use the selected image as my profile photo after showing me the preview.' },
      { label: 'Edit profile', promptPattern: 'Make edits to my user profile: …' },
      { label: 'My role', promptPattern: 'Show my saved role and what Jobrolo features I should use most.' },
    ],
    displayRules: [
      'User avatars belong to the user profile, not a customer/project file.',
      'Show image preview when available.',
      'Role/persona hints can guide shortcuts but must not override permissions.',
    ],
  },
  {
    id: 'photo-evidence',
    family: 'files',
    cardTypes: ['photo_evidence', 'photo_gallery', 'inspection_photo_set', 'project_photos'],
    purpose: 'Show photos as categorized evidence with thumbnails, context, edit/delete prompts, and report actions.',
    glanceLabel: 'Photo evidence',
    speakableSummary: 'Here’s the photo evidence card with grouped thumbnails, tags, and edit/report actions.',
    primaryActionLabel: 'Review photos',
    primaryPromptPills: [
      { label: 'Group photos', promptPattern: 'Show these photos grouped by exterior, roof, damage, interior, documents, and other.' },
      { label: 'Edit context', promptPattern: 'Help me edit the selected photo context, label, notes, or damage category.' },
      { label: 'Use in report', promptPattern: 'Let me choose which photos to include in a report before attaching them.' },
    ],
    displayRules: [
      'Show thumbnails before long photo descriptions.',
      'Photo actions should insert editable prompts with the real document/photo id behind the card action.',
      'Do not mix company/user profile images into customer/job photo evidence.',
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
    id: 'permission-access',
    family: 'permission',
    cardTypes: ['permission_review', 'access_review', 'visibility_review'],
    purpose: 'Show who can see a record/chat/file/report and what access changes need approval.',
    glanceLabel: 'Access review',
    speakableSummary: 'Here’s the access review card with audience, role, visibility, and permission changes.',
    primaryActionLabel: 'Review access',
    primaryPromptPills: [
      { label: 'Who can see this?', promptPattern: 'Show who can see this item and what role/access each person has.' },
      { label: 'Invite user', promptPattern: 'Invite a user after asking their name, contact, role, and exactly what they should access.' },
      { label: 'Change access', promptPattern: 'Prepare an access change and show exactly who gains or loses access before approval.' },
    ],
    displayRules: [
      'Always separate internal, crew, homeowner, partner, supplier, and public visibility.',
      'Role and membership changes require approval and real record IDs.',
      'Never expose internal-only notes/pricing to external roles by default.',
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
    id: 'production-status',
    family: 'project',
    cardTypes: ['production_status', 'project_readiness', 'job_ready', 'material_readiness'],
    purpose: 'Show job readiness, blockers, material status, approvals, schedule, and next production actions.',
    glanceLabel: 'Production status',
    speakableSummary: 'Here’s the production status card with readiness, blockers, and next actions.',
    primaryActionLabel: 'Check readiness',
    primaryPromptPills: [
      { label: 'Ready to build?', promptPattern: 'Check whether this job is ready to build using saved project records, approvals, materials, schedule, and blockers.' },
      { label: 'Material status', promptPattern: 'Show material order/delivery readiness from saved records and say what is missing.' },
      { label: 'Next blocker', promptPattern: 'Tell me the next blocker to clear for this job and ask before changing records.' },
    ],
    displayRules: [
      'Do not call a job ready unless saved requirements were checked.',
      'Separate ready items, blockers, missing information, and suggested next action.',
      'External crew/customer updates require approval.',
    ],
  },
  {
    id: 'activity-timeline',
    family: 'timeline',
    cardTypes: ['activity_timeline', 'timeline', 'history_log'],
    purpose: 'Show saved activity across chats, uploads, GPS, photos, approvals, tasks, appointments, and project changes.',
    glanceLabel: 'Timeline',
    speakableSummary: 'Here’s the activity timeline card with completed work, failed attempts, pending items, and source context.',
    primaryActionLabel: 'Review activity',
    primaryPromptPills: [
      { label: 'What happened?', promptPattern: 'Show what happened recently using saved activity records only.' },
      { label: 'Failed work', promptPattern: 'Show failed or incomplete actions and what needs to happen next.' },
      { label: 'Next actions', promptPattern: 'Turn the unresolved timeline items into suggested next actions.' },
    ],
    displayRules: [
      'Group activity by date/status/source.',
      'Do not treat chat memory as completed work unless a saved event/tool result confirms it.',
      'Preserve GPS/photo/document source context.',
    ],
  },
  {
    id: 'insurance-claim',
    family: 'claim',
    cardTypes: ['insurance_claim', 'claim_summary', 'supplement_review'],
    purpose: 'Organize insurance claim data, deductible/RCV/ACV math, supplements, adjuster context, mortgage checks, and claim document gaps.',
    glanceLabel: 'Insurance claim',
    speakableSummary: 'Here’s the insurance claim card with claim numbers, financials, documents, gaps, and supplement actions.',
    primaryActionLabel: 'Review claim',
    primaryPromptPills: [
      { label: 'Claim summary', promptPattern: 'Summarize the insurance claim using saved project documents and show missing claim details.' },
      { label: 'Deductible math', promptPattern: 'Explain RCV, ACV, depreciation, deductible, and out-of-pocket math from saved scope data only.' },
      { label: 'Supplement gaps', promptPattern: 'Compare the saved scope/photos against the claim and suggest supplement opportunities.' },
    ],
    displayRules: [
      'Separate saved claim facts from inferred supplement opportunities.',
      'Do not give legal/coverage conclusions; frame findings as document/photo review support.',
      'Show adjuster/carrier/mortgage/supplement gaps when known.',
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
    id: 'external-share',
    family: 'chat',
    cardTypes: ['homeowner_portal', 'external_share', 'partner_share'],
    purpose: 'Prepare homeowner, adjuster, realtor, referral partner, and other external-facing shared views safely.',
    glanceLabel: 'External share',
    speakableSummary: 'Here’s the external share card with recipient, visibility, files, and approval status.',
    primaryActionLabel: 'Prepare share',
    primaryPromptPills: [
      { label: 'Preview access', promptPattern: 'Preview what this external recipient can see before sharing.' },
      { label: 'Draft message', promptPattern: 'Draft a message for this external share and ask before sending.' },
      { label: 'Create share link', promptPattern: 'Create a share link only after showing audience, visibility, and expiration options.' },
    ],
    displayRules: [
      'External shares must show audience and visibility before approval.',
      'Never include internal notes, margin, private supplier pricing, or unrelated customer data.',
      'Use different language for homeowner, adjuster, realtor, and partner recipients.',
    ],
  },
  {
    id: 'integration-readiness',
    family: 'integration',
    cardTypes: ['integration_readiness', 'provider_status', 'external_connection'],
    purpose: 'Show which external providers are configured, missing, degraded, or manual-only.',
    glanceLabel: 'Integration readiness',
    speakableSummary: 'Here’s the integration readiness card with configured providers, missing connections, and safe fallbacks.',
    primaryActionLabel: 'Check connection',
    primaryPromptPills: [
      { label: 'Check provider', promptPattern: 'Check whether this provider/API is configured and ready. If not, say exactly what is missing.' },
      { label: 'Manual fallback', promptPattern: 'Give me the safest manual fallback for this missing integration.' },
      { label: 'Connect later', promptPattern: 'Create a setup note for connecting this provider later, including required credentials and risks.' },
    ],
    displayRules: [
      'Never claim live provider access unless health/config confirms it.',
      'Separate configured, missing, degraded, and planned integrations.',
      'Usage-heavy searches should disclose mode/cost risk when possible.',
    ],
  },
  {
    id: 'supplier-invoice',
    family: 'supplier',
    cardTypes: ['supplier_invoice', 'delivery_ticket', 'job_cost_candidate', 'material_receipt'],
    purpose: 'Route supplier invoices, receipts, and delivery tickets as project/job cost or delivery evidence.',
    glanceLabel: 'Supplier invoice',
    speakableSummary: 'Here’s the supplier invoice card with project candidate, cost/delivery details, and safe attach actions.',
    primaryActionLabel: 'Attach cost',
    primaryPromptPills: [
      { label: 'Attach to job', promptPattern: 'Attach this supplier invoice or delivery ticket to the correct job after confirming the project.' },
      { label: 'Create job cost', promptPattern: 'Prepare a job cost entry from this supplier invoice. Show supplier, total, and project before approval.' },
      { label: 'Material status', promptPattern: 'Update material delivery status from this ticket after showing what will change.' },
    ],
    displayRules: [
      'Supplier invoices and delivery tickets are project-level when a job is known.',
      'Do not import invoices into company price lists unless explicitly confirmed as reusable pricing.',
      'Ask one clarification if invoice content conflicts with user-stated price-list intent.',
    ],
  },
  {
    id: 'notification-outbox',
    family: 'notification',
    cardTypes: ['notification_outbox', 'message_draft', 'queued_message'],
    purpose: 'Show outbound SMS/email/invite drafts, queued notifications, failed sends, and safe retry/approval paths.',
    glanceLabel: 'Notification outbox',
    speakableSummary: 'Here’s the notification outbox card with drafts, recipients, status, and retry actions.',
    primaryActionLabel: 'Review message',
    primaryPromptPills: [
      { label: 'Review draft', promptPattern: 'Review this outbound message draft and show recipient, channel, and visibility before sending.' },
      { label: 'Retry failed', promptPattern: 'Explain why this notification failed and prepare a safe retry if contact details are valid.' },
      { label: 'Edit message', promptPattern: 'Let me edit this message before it is sent.' },
    ],
    displayRules: [
      'Do not send external SMS/email without approval.',
      'Show failed send reasons plainly and avoid duplicate notifications.',
      'Separate copyable links from actual sent notifications.',
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
  {
    id: 'cody-review',
    family: 'meta',
    cardTypes: ['cody_review', 'qa_packet', 'codex_packet'],
    purpose: 'Package tester feedback, screenshots, logs, route context, likely files, and reproduction details into Cody/Codex handoffs.',
    glanceLabel: 'Cody review',
    speakableSummary: 'Here’s the Cody review card with issue evidence, severity, context, and Codex-ready next steps.',
    primaryActionLabel: 'Review packet',
    primaryPromptPills: [
      { label: 'Make packet', promptPattern: 'Create a Cody/Codex packet for this issue with evidence, likely files, safety notes, and tests.' },
      { label: 'Add evidence', promptPattern: 'Add the latest screenshot/log/chat context to this Cody issue before closing it.' },
      { label: 'Archive note', promptPattern: 'Archive this Cody note after confirming the issue is fixed or intentionally deferred.' },
    ],
    displayRules: [
      'Cody cards are owner/admin/dev-only and read-only.',
      'Summaries should be concise: observed issue, evidence, likely area, severity, and next step.',
      'Do not include private customer data unless required and authorized for debugging.',
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

export function getJobroloCardTemplateById(id: string | null | undefined) {
  const normalized = String(id || '').toLowerCase()
  if (!normalized) return null
  return JOBROLO_CARD_TEMPLATES.find(template => template.id === normalized) ?? null
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
