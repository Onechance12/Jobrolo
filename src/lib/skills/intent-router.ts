import type { JobroloRequestIntent, SkillRoutingContext } from './types'

function compact(text: string) {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

function buildIntent(input: JobroloRequestIntent): JobroloRequestIntent {
  return input
}

export function resolveJobroloIntent(context: SkillRoutingContext): JobroloRequestIntent {
  const text = compact(`${context.normalizedText || ''} ${context.latestText || ''}`)
  const upload = context.uploadClassification

  if (/\b(cody cody cody|cody cody note|note to cody|hey cody|end cody|codex packet)\b/.test(text)) {
    return buildIntent({
      id: 'cody_review',
      mode: 'qa',
      confidence: 0.98,
      primarySkill: 'qa',
      supportingSkills: ['failure-handling'],
      workflowName: 'Cody review',
      sticky: /\bcody cody cody\b/.test(text),
      allowedTools: ['record_tester_feedback'],
      blockedTools: ['create_customer', 'create_project_for_customer', 'link_document_to_customer', 'link_document_to_project', 'update_contractor_profile'],
      nextStep: 'answer',
      summary: 'Cody review lane: capture product/debug feedback without mutating customer/job data.',
      laneRules: [
        'Cody is read-only and developer-facing.',
        'Do not run normal customer/project/company mutations from Cody review text.',
        'Preserve exact tester wording plus recent chat context for Codex.',
      ],
    })
  }

  if (upload) {
    const uploadSupports = upload.route === 'company_pricing'
      ? ['upload-classifier', 'supplier', 'approval']
      : upload.route === 'user_profile'
        ? ['upload-classifier', 'brand-assets', 'approval']
      : upload.route === 'project_scope'
        ? ['document-type-routing', 'project-context', 'approval']
        : upload.route === 'project_invoice'
          ? ['document-type-routing', 'project-context', 'job-cost', 'approval']
        : upload.route === 'project_cost'
          ? ['upload-classifier', 'project-context', 'approval']
        : ['upload-classifier', 'document-type-routing', upload.companyLevel ? 'company-profile' : 'project-context', 'approval']
    return buildIntent({
      id: 'upload_routing',
      mode: 'workflow',
      confidence: Math.max(0.72, upload.confidence),
      primarySkill: upload.route === 'company_pricing'
        ? 'price-list'
        : upload.route === 'project_scope'
          ? 'save-scope'
          : upload.route === 'project_invoice'
            ? 'invoice'
          : upload.route === 'project_cost'
            ? 'supplier-invoice'
            : 'upload-classifier',
      supportingSkills: uploadSupports,
      workflowName: 'Upload routing',
      sticky: true,
      allowedTools: ['get_upload_status', 'get_document_content', 'link_document_to_customer', 'link_document_to_project', 'create_scope_from_document', 'review_price_sheet_items', 'create_template_upload_from_document', 'update_contractor_profile'],
      blockedTools: upload.companyLevel || upload.route === 'user_profile' ? ['create_customer', 'create_project_for_customer', 'link_document_to_customer', 'link_document_to_project'] : [],
      requiredContext: upload.needsClarification ? ['confirmed destination'] : undefined,
      nextStep: upload.needsClarification ? 'ask_clarification' : 'call_tool',
      summary: `Upload lane: ${upload.documentType} routed toward ${upload.storageScope}.`,
      laneRules: [
        'Do not use filenames or PDF metadata as primary content.',
        'If analysis is still processing, say the file is saved and analysis is processing.',
        'Do not attach company pricing/templates/logos to a customer unless the user explicitly says it is job-specific.',
      ],
    })
  }

  if (/\b(price\s*(sheet|list)|material prices?|supplier pricing|review rows|pending import|pricebook|price book)\b/.test(text)) {
    return buildIntent({
      id: 'price_list',
      mode: 'workflow',
      confidence: 0.9,
      primarySkill: 'price-list',
      supportingSkills: [],
      workflowName: 'Price list',
      sticky: false,
      allowedTools: ['review_price_sheet_items', 'import_price_sheet_items', 'list_documents'],
      blockedTools: ['create_customer', 'create_project_for_customer', 'start_field_inspection_lead', 'create_scope_from_text'],
      nextStep: 'call_tool',
      summary: 'Price list lane: show or review saved company material pricing without drifting into customer files.',
      laneRules: [
        'Treat material price lists as company pricing unless the user clearly says the file is a job-specific quote or invoice.',
        'For simple show/list requests, stay lightweight and do not consult unrelated skills.',
        'Importing rows or changing company pricing still requires approval.',
      ],
    })
  }

  if (/\b(public adjuster|pa file|pa review|claim file|thresher|appraisal|umpire|carrier appraiser|appraisal inspection|appraisal meeting|awaiting acv|appraisal acv|payment control|two confirmations|carrier negotiation|policy number|claim number|date of loss|carrier da|carrier adjuster|mortgage check|mortgage company|denial|underpayment)\b/.test(text)) {
    return buildIntent({
      id: 'public_adjuster_claim',
      mode: 'workflow',
      confidence: 0.94,
      primarySkill: 'insurance-claim',
      supportingSkills: ['communication-routing', 'role-permissions', 'project-context', 'activity-timeline'],
      workflowName: 'Public adjuster claim file',
      sticky: true,
      allowedTools: ['get_customer_file', 'get_project_document_packet', 'get_scope_breakdown', 'list_schedule', 'show_calendar', 'consult_orchestrator'],
      blockedTools: ['create_customer', 'create_project_for_customer', 'send_external_message', 'finalize_roof_report'],
      requiredContext: ['claim/customer/project or claim file context'],
      nextStep: 'call_tool',
      summary: 'Public adjuster claim-file lane: organize claim status, paperwork, estimate review, appraisal, payment control, and shared collaboration without becoming a separate app.',
      laneRules: [
        'Treat PA files as claim-first records that can collaborate with contractors, homeowners, carrier adjusters, and trades through scoped shared chats.',
        'Track claim number, policy number, date of loss, carrier, carrier adjuster, documents, photos, appointment/appraisal status, payments, and missing paperwork as separate facts.',
        'Do not give legal advice, coverage guarantees, or bad-faith conclusions; frame work as file organization, document review, and next-step support.',
        'Never expose internal PA notes, pricing, or strategy to homeowner/contractor/carrier chats unless explicitly shared and approved.',
      ],
    })
  }

  if (/\b(cash\s+quote|cash\s+bid|\bbid\b|quote|proposal)\b/.test(text) && /\b(create|make|build|draft|start|need|generate|prepare|write|put together|price|pricing|research)\b/.test(text)) {
    return buildIntent({
      id: 'cash_quote_bid',
      mode: 'workflow',
      confidence: 0.94,
      primarySkill: 'bid-quote',
      supportingSkills: ['entity-resolver', 'price-list', 'job-cost', 'project-context', 'file-attachment', 'approval'],
      workflowName: 'Cash quote / bid',
      sticky: true,
      allowedTools: ['get_customer_file', 'list_customers', 'get_project_document_packet', 'get_document_content', 'review_price_sheet_items', 'consult_orchestrator'],
      blockedTools: ['create_customer', 'create_project_for_customer', 'start_field_inspection_lead', 'create_roof_report'],
      requiredContext: ['customer or property', 'project/job context', 'scope/photos/material assumptions'],
      nextStep: context.documentIds?.length ? 'call_tool' : 'ask_clarification',
      summary: 'Cash quote/bid lane: resolve the job context and source documents before drafting or claiming a bid exists.',
      laneRules: [
        'Stay in bid/quote/proposal workflow unless the user explicitly changes tasks.',
        'First gather customer/project/address/document context; do not jump into lead, inspection, roof report, or generic CRM flows.',
        'If the customer/project/address is ambiguous, ask one clear question.',
        'Do not claim a quote/proposal was created until a real quote/document/template tool succeeds.',
      ],
    })
  }

  if (/\b(field map|map pin|field pin|dropped pin|drop pin|tap map|nearby pins|door outcome|gps pin|canvass map|territory map|save note.*pin|edit.*pin|mark.*lead)\b/.test(text)) {
    return buildIntent({
      id: 'field_map',
      mode: 'workflow',
      confidence: 0.92,
      primarySkill: 'field-map',
      supportingSkills: ['lead-intake', 'field-copilot', 'activity-timeline'],
      workflowName: 'Field map',
      sticky: true,
      allowedTools: ['get_canvassing_map', 'create_canvassing_lead_at_location', 'log_canvassing_activity', 'update_canvassing_lead', 'resolve_field_location', 'record_field_observation_at_location', 'research_property_now'],
      blockedTools: ['create_customer', 'create_project_for_customer', 'send_external_message'],
      requiredContext: ['leadId or GPS/location for updates when applicable'],
      nextStep: 'call_tool',
      summary: 'Field map lane: use saved map pins, GPS evidence, property memory, door outcomes, appointments, and field observations as one truth surface.',
      laneRules: [
        'A property can have many saved coordinates; do not collapse them into one vague address point.',
        'Map edits should update the lead/pin/activity trail while keeping the user in map context.',
        'Do not convert a pin to a customer/job or send external messages unless explicitly confirmed.',
      ],
    })
  }

  if (/\b(new lead|create a lead|create lead|lead came in|phone call|called about|text came in|door knock|d2d|referral|met .* at|potential customer|leak call|online lead)\b/.test(text)) {
    return buildIntent({
      id: 'lead_intake',
      mode: 'workflow',
      confidence: 0.9,
      primarySkill: 'lead-intake',
      supportingSkills: ['entity-resolver', 'field-map', 'activity-timeline', 'appointment-scheduling'],
      workflowName: 'Lead intake',
      sticky: true,
      allowedTools: ['start_field_inspection_lead', 'create_canvassing_lead_at_location', 'update_canvassing_lead', 'log_canvassing_activity', 'create_customer', 'create_project_for_customer', 'consult_orchestrator'],
      blockedTools: ['create_roof_report', 'import_price_sheet_items'],
      requiredContext: ['lead source/contact/address/next step when available'],
      nextStep: 'call_tool',
      summary: 'Lead intake lane: capture an opportunity first, then schedule/convert only after context is clear.',
      laneRules: [
        'Save known lead details without forcing every AccuLynx-style field up front.',
        'Ask one useful next question for missing contact, address, source, urgency, or next step.',
        'Do not convert into a customer/job unless explicitly requested or confirmed.',
      ],
    })
  }

  if (
    /\b(draft|write|prepare|compose|word|make)\b[\s\S]{0,80}\b(follow[- ]?up|customer update|homeowner|customer|client|sms|text|email|message)\b/.test(text) ||
    /\b(friendly|short|polite)\b[\s\S]{0,80}\b(follow[- ]?up|customer update|homeowner|customer|client|sms|text|email|message)\b/.test(text) ||
    /\b(customer update|homeowner update|crew message|sms draft|text draft|email draft|message draft)\b/.test(text)
  ) {
    return buildIntent({
      id: 'communication_draft',
      mode: 'workflow',
      confidence: 0.88,
      primarySkill: 'communication-routing',
      supportingSkills: ['role-permissions', 'approval'],
      workflowName: 'Communication draft',
      sticky: false,
      allowedTools: ['consult_orchestrator'],
      blockedTools: ['create_appointment', 'update_project_schedule'],
      nextStep: 'answer',
      summary: 'Communication lane: draft customer/homeowner/crew wording without scheduling or sending unless explicitly requested.',
      laneRules: [
        'Drafting a follow-up message is not the same as scheduling a follow-up appointment.',
        'Do not send SMS/email or invite anyone without explicit approval.',
        'If the user asks to schedule a time, switch into appointment scheduling.',
      ],
    })
  }

  if (/\b(schedule|calendar|appointment|book|reschedule|adjuster meeting|site visit|inspection time|what.*calendar|what.*scheduled)\b/.test(text) || /\b(follow[- ]?up)\b[\s\S]{0,50}\b(call|appointment|meeting|time|date|tomorrow|today|next week|calendar|schedule|book)\b/.test(text)) {
    return buildIntent({
      id: 'appointment_scheduling',
      mode: 'workflow',
      confidence: 0.88,
      primarySkill: 'appointment-scheduling',
      supportingSkills: ['entity-resolver', 'project-context', 'communication-routing', 'field-map'],
      workflowName: 'Appointment scheduling',
      sticky: false,
      allowedTools: ['list_schedule', 'show_calendar', 'create_appointment', 'update_project_schedule', 'resolve_field_location', 'get_canvassing_map', 'consult_orchestrator'],
      blockedTools: ['start_field_inspection_lead'],
      requiredContext: ['date/time/person/project or request to view calendar'],
      nextStep: 'call_tool',
      summary: 'Appointment lane: schedule or review calendar items without confusing future appointments with active field inspections.',
      laneRules: [
        'If creating an appointment, resolve date/time and customer/project/lead.',
        'Only show appointments on the map from a saved location ping or resolved address; do not invent coordinates.',
        'If showing schedule, use saved appointments/calendar records.',
        'External calendar invites or notifications require explicit approval.',
      ],
    })
  }

  if (/\b(start|landed|walking up|inspection|inspect|photo workflow)\b/.test(text) && /\b(inspection|where i am|current location|at this house|here)\b/.test(text)) {
    return buildIntent({
      id: 'field_inspection',
      mode: 'workflow',
      confidence: 0.9,
      primarySkill: 'field-copilot',
      supportingSkills: ['project-context', 'entity-resolver'],
      workflowName: 'Field inspection',
      sticky: true,
      allowedTools: ['start_field_inspection_lead', 'resolve_field_location', 'research_property_now', 'record_field_observation_at_location'],
      blockedTools: ['create_customer', 'create_project_for_customer'],
      nextStep: 'call_tool',
      summary: 'Field inspection lane: start or continue an inspection lead using location/context before converting to customer/job.',
      laneRules: [
        'Start as a field inspection lead until property/customer/project is confirmed.',
        'Use browser GPS/location context when present.',
        'Do not require homeowner phone/name before starting the inspection lead.',
      ],
    })
  }

  if (/\b(roof report|property report|damage report|report builder|preview report|finalize report|share report|report pdf|photo documentation)\b/.test(text)) {
    return buildIntent({
      id: 'roof_report',
      mode: 'workflow',
      confidence: 0.9,
      primarySkill: 'roof-report',
      supportingSkills: ['photo-evidence', 'project-context', 'approval', 'communication-routing'],
      workflowName: 'Roof/property report',
      sticky: true,
      allowedTools: ['create_roof_report', 'get_project_document_packet', 'review_roof_report_photos', 'add_photos_to_roof_report', 'update_roof_report_photo_selection', 'finalize_roof_report', 'consult_orchestrator'],
      blockedTools: ['import_price_sheet_items'],
      requiredContext: ['customer/project or existing report draft'],
      nextStep: 'call_tool',
      summary: 'Roof report lane: select photos, conditions, recommendations, and recipient before finalizing or sharing.',
      laneRules: [
        'Reports should be completed through chat/cards first; builder pages are support surfaces.',
        'Do not finalize/share until required sections/photos are ready and approved.',
        'Recipient type controls visibility and wording.',
      ],
    })
  }

  if (/\b(my profile|profile photo|avatar|user icon|account photo|my role)\b/.test(text)) {
    return buildIntent({
      id: 'user_profile',
      mode: 'workflow',
      confidence: 0.9,
      primarySkill: 'user-profile',
      supportingSkills: ['brand-assets', 'approval'],
      workflowName: 'User profile',
      sticky: false,
      allowedTools: ['get_upload_status', 'consult_orchestrator'],
      blockedTools: ['create_customer', 'create_project_for_customer', 'link_document_to_customer', 'link_document_to_project', 'update_contractor_profile'],
      nextStep: 'ask_clarification',
      summary: 'User profile lane: keep profile photos and personal setup on the user account, not customer/project/company files.',
      laneRules: [
        'User avatars belong to the logged-in user profile.',
        'Do not attach profile photos to customer/project files.',
        'Ask before applying an uploaded image as the account avatar.',
      ],
    })
  }

  if (/\b(company\s+logo|business\s+logo|company\s+brand|brand\s+asset|brand\s+mark|use .*logo|uploaded .*logo)\b/.test(text)) {
    return buildIntent({
      id: 'company_profile',
      mode: 'workflow',
      confidence: 0.9,
      primarySkill: 'brand-assets',
      supportingSkills: ['company-profile', 'approval'],
      workflowName: 'Company brand assets',
      sticky: false,
      allowedTools: ['get_contractor_profile', 'get_upload_status', 'update_contractor_profile', 'consult_orchestrator'],
      blockedTools: ['create_customer', 'create_project_for_customer', 'link_document_to_customer', 'link_document_to_project', 'import_price_sheet_items'],
      nextStep: 'ask_clarification',
      summary: 'Company logo lane: keep uploaded logo/brand assets on the company profile, not customer/project files.',
      laneRules: [
        'Company logos belong to contractor profile/brand assets.',
        'Do not attach logo uploads to customer/project files.',
        'Ask before applying an uploaded image as the active company logo.',
      ],
    })
  }

  if (/\b(photo|photos|picture|image|thumbnail|front elevation|all elevations|roof photos|damage photo|interior photo|attic photo|detached|add .*report|remove .*photo|caption)\b/.test(text)) {
    return buildIntent({
      id: 'photo_evidence',
      mode: 'workflow',
      confidence: 0.86,
      primarySkill: 'photo-evidence',
      supportingSkills: ['file-attachment', 'project-context', 'activity-timeline'],
      workflowName: 'Photo evidence',
      sticky: false,
      allowedTools: ['link_document_to_project', 'record_field_observation_at_location', 'review_roof_report_photos', 'add_photos_to_roof_report', 'update_roof_report_photo_selection', 'consult_orchestrator'],
      blockedTools: ['import_price_sheet_items'],
      nextStep: 'call_tool',
      summary: 'Photo evidence lane: group/tag photos as jobsite evidence instead of dumping generic file text.',
      laneRules: [
        'Preserve selected inspection/photo section context when present.',
        'Group photo displays by exterior, roof, damage, interior, documents, and other.',
        'Ask before deleting or externally sharing photos.',
      ],
    })
  }

  if (/\b(missing shingles|soft metals?|no soliciting|renters?|window screen|roof damage|hail damage|wind damage|saw .*damage)\b/.test(text)) {
    return buildIntent({
      id: 'field_observation',
      mode: 'workflow',
      confidence: 0.84,
      primarySkill: 'field-copilot',
      supportingSkills: ['project-context'],
      workflowName: 'Field observation',
      sticky: false,
      allowedTools: ['record_field_observation_at_location', 'resolve_field_location'],
      blockedTools: ['create_customer', 'create_project_for_customer'],
      nextStep: 'call_tool',
      summary: 'Field observation lane: save observed site/property evidence with location when available.',
      laneRules: [
        'Treat this as an observation first, not a new customer/project.',
        'Attach GPS/location context when present.',
        'Ask before converting observations into a lead, customer, or job.',
      ],
    })
  }

  if (/\b(timeline|activity log|history|what happened|last time|recent updates|what changed|audit trail|log this|record this)\b/.test(text)) {
    return buildIntent({
      id: 'activity_timeline',
      mode: 'workflow',
      confidence: 0.84,
      primarySkill: 'activity-timeline',
      supportingSkills: ['project-context', 'entity-resolver'],
      workflowName: 'Activity timeline',
      sticky: false,
      allowedTools: ['get_customer_file', 'get_project_document_packet', 'consult_orchestrator'],
      nextStep: 'call_tool',
      summary: 'Activity timeline lane: explain saved history, recent changes, failed attempts, and next actions from real records.',
      laneRules: [
        'Separate completed events, pending approvals, failures, and recommendations.',
        'Use saved activity/project/customer records when available.',
        'Do not treat timeline review as permission to mutate records.',
      ],
    })
  }

  if (/\b(company health|company intelligence|business health|how are our leads|how are my leads|growth|grow|revenue|marketing kpis?|public research)\b/.test(text)) {
    return buildIntent({
      id: 'company_intelligence',
      mode: 'workflow',
      confidence: 0.86,
      primarySkill: 'company-intelligence',
      supportingSkills: ['company-profile'],
      workflowName: 'Company intelligence',
      sticky: false,
      allowedTools: ['get_company_intelligence', 'get_company_kpis', 'get_contractor_profile', 'research_company_presence', 'research_contractor_website'],
      blockedTools: ['update_contractor_profile'],
      nextStep: 'call_tool',
      summary: 'Company intelligence lane: use DB truth for KPIs and label public web/social evidence clearly.',
      laneRules: [
        'Do not overwrite company profile from public research without approval.',
        'Use saved Jobrolo data for lead/project counts.',
        'Use saved contractor profile data for setup gaps and document-readiness fields.',
        'Label online/social findings as public evidence, not private analytics.',
      ],
    })
  }

  if (/\b(api|integration|connect|provider|abc supply|srs|qxo|home depot|lowe'?s|twilio|google business|google analytics|openai web search|web search|maps api|provider missing)\b/.test(text)) {
    return buildIntent({
      id: 'integration_provider',
      mode: 'workflow',
      confidence: 0.82,
      primarySkill: 'integration-provider',
      supportingSkills: ['failure-handling'],
      workflowName: 'Integration provider',
      sticky: false,
      allowedTools: ['get_integration_status', 'consult_orchestrator'],
      nextStep: 'call_tool',
      summary: 'Integration lane: check provider readiness before promising live outside-world actions.',
      laneRules: [
        'Do not claim live provider access unless configured and healthy.',
        'If missing, name the missing provider/API and offer a manual fallback.',
        'External provider actions require approval and should go through the integration layer.',
      ],
    })
  }

  if (/\b(company profile|company info|business info|license|legal footer|logo|brand|website|phone|email)\b/.test(text)) {
    return buildIntent({
      id: 'company_profile',
      mode: 'workflow',
      confidence: 0.82,
      primarySkill: 'company-profile',
      supportingSkills: ['brand-assets'],
      workflowName: 'Company profile',
      sticky: false,
      allowedTools: ['get_contractor_profile', 'research_contractor_website', 'update_contractor_profile'],
      nextStep: 'call_tool',
      summary: 'Company profile lane: read or update saved contractor profile/document readiness.',
      laneRules: [
        'Company profile is not a customer file.',
        'Show missing fields with chat prompt pills where possible.',
        'Ask before applying researched or uploaded changes.',
      ],
    })
  }

  if (/\b(closeout|close out|close the job|close this job|job complete|completed job|final invoice|warranty packet|closeout packet|final walkthrough|ready to close)\b/.test(text)) {
    return buildIntent({
      id: 'project_closeout',
      mode: 'workflow',
      confidence: 0.9,
      primarySkill: 'project-closeout',
      supportingSkills: ['project-status', 'job-cost', 'activity-timeline', 'approval'],
      workflowName: 'Project closeout',
      sticky: true,
      allowedTools: ['get_project_context', 'get_project_document_packet', 'get_project_financial_summary', 'list_schedule', 'show_calendar', 'consult_orchestrator'],
      blockedTools: ['create_customer', 'create_project_for_customer', 'import_price_sheet_items'],
      requiredContext: ['project/customer'],
      nextStep: 'show_card',
      summary: 'Closeout lane: verify project stage, documents, report/signature status, invoices, payments, job cost, warranty, and final tasks before closing.',
      laneRules: [
        'Use saved project, document, schedule, activity, and financial records before claiming a job is closed.',
        'Treat closeout as a checklist/readiness workflow, not a generic chat answer.',
        'Changing stage to closed, sending closeout packets, or recording financial truth requires approval.',
      ],
    })
  }

  if (/\b(role|permission|access|who can see|visibility|owner|admin|employee|sales rep|project manager|homeowner access|crew access|sub access|delete chats?)\b/.test(text)) {
    return buildIntent({
      id: 'role_permissions',
      mode: 'workflow',
      confidence: 0.82,
      primarySkill: 'role-permissions',
      supportingSkills: ['communication-routing', 'approval'],
      workflowName: 'Role permissions',
      sticky: false,
      allowedTools: ['get_workspace_memory', 'invite_user_to_chat', 'consult_orchestrator'],
      blockedTools: ['delete_customer', 'delete_project'],
      nextStep: 'ask_clarification',
      summary: 'Role/permission lane: protect visibility boundaries before adding users, sharing data, or changing access.',
      laneRules: [
        'Resolve user role, company/workspace, and scope before changing access.',
        'Customers, partners, crews, and subs only see explicitly shared content.',
        'Permission changes require owner/admin authority and approval.',
      ],
    })
  }

  if (/\b(create|start|open|make|add|set up)\s+(a\s+|new\s+|the\s+)?(project|job)\b/.test(text)) {
    return buildIntent({
      id: 'project_creation',
      mode: 'workflow',
      confidence: 0.9,
      primarySkill: 'project-creation',
      supportingSkills: ['entity-resolver', 'project-context', 'approval'],
      workflowName: 'Project/job creation',
      sticky: false,
      allowedTools: ['list_customers', 'get_customer_file', 'create_project_for_customer', 'create_project_from_document', 'consult_orchestrator'],
      blockedTools: ['import_price_sheet_items', 'create_roof_report'],
      requiredContext: ['resolved customer or clear customer name'],
      nextStep: 'call_tool',
      summary: 'Project creation lane: resolve the customer first, then create the job/project with real saved IDs.',
      laneRules: [
        'Do not treat project creation as a generic project list/read request.',
        'Resolve or create the customer before creating the project.',
        'Do not create a roof report, inspection, or price import unless the user asks for that workflow.',
      ],
    })
  }

  if (/\b(save|create|import|attach|review)\b[\s\S]{0,80}\b(scope|scope of loss|xactimate|estimate)\b/.test(text)) {
    return buildIntent({
      id: 'scope_save',
      mode: 'workflow',
      confidence: 0.9,
      primarySkill: 'save-scope',
      supportingSkills: ['document-type-routing', 'project-context', 'approval'],
      workflowName: 'Scope/estimate save',
      sticky: false,
      allowedTools: ['get_document_content', 'get_customer_file', 'get_project_document_packet', 'create_scope_from_document', 'consult_orchestrator'],
      blockedTools: ['create_scope_from_text', 'import_price_sheet_items', 'update_contractor_profile'],
      requiredContext: ['document ID or extracted document content', 'customer/project context'],
      nextStep: context.documentIds?.length ? 'call_tool' : 'ask_clarification',
      summary: 'Scope save lane: save uploaded scopes/estimates from document IDs and project context, never from filenames.',
      laneRules: [
        'Never pass a PDF/image filename, upload path, or document ID as raw scope text.',
        'Use create_scope_from_document when a document ID exists.',
        'If extraction is pending or the project is unclear, ask one clear question.',
      ],
    })
  }

  if (/\b(create|start|open|make)\b[\s\S]{0,50}\b(crew|sub|subcontractor|roofing crew|gutter crew|window crew)\b[\s\S]{0,30}\b(chat|thread|room)\b/.test(text) || /\b(crew|subcontractor|roofing crew|gutter crew|window crew)\s+chat\b/.test(text)) {
    return buildIntent({
      id: 'crew_chat',
      mode: 'workflow',
      confidence: 0.88,
      primarySkill: 'crew-subcontractor',
      supportingSkills: ['project-context', 'role-permissions', 'approval'],
      workflowName: 'Crew/subcontractor chat',
      sticky: false,
      allowedTools: ['get_customer_file', 'get_project_document_packet', 'create_project_chat', 'invite_user_to_chat', 'consult_orchestrator'],
      requiredContext: ['project/job or customer'],
      nextStep: 'call_tool',
      summary: 'Crew chat lane: create a job-scoped crew/subcontractor chat and return the chat card/link actions.',
      laneRules: [
        'Resolve the project/customer before creating the chat.',
        'Keep crew/sub visibility job-scoped.',
        'Return open, copy link, and invite actions after creation.',
      ],
    })
  }

  if (/\b(saved clients?|what clients?|customer file|client file|job packet|show .*files|show .*photos|projects?)\b/.test(text)) {
    return buildIntent({
      id: 'customer_project_inventory',
      mode: 'workflow',
      confidence: 0.82,
      primarySkill: 'entity-resolver',
      supportingSkills: ['project-context', 'file-attachment'],
      workflowName: 'Customer/project inventory',
      sticky: false,
      allowedTools: ['list_customers', 'get_customer_file', 'get_project_document_packet', 'list_documents'],
      nextStep: 'call_tool',
      summary: 'Customer/project inventory lane: show saved database records grouped by customer and project.',
      laneRules: [
        'Use saved database records only when requested.',
        'Visually group customers with their projects/jobs and action pills.',
        'Do not mix company assets/price sheets into customer files unless explicitly linked.',
      ],
    })
  }

  if (/\b(invite|add user|add employee|add crew|share chat|copy link|join workspace)\b/.test(text)) {
    return buildIntent({
      id: 'chat_invite',
      mode: 'workflow',
      confidence: 0.8,
      primarySkill: 'crew-subcontractor',
      supportingSkills: ['communication-routing', 'role-permissions', 'approval'],
      workflowName: 'Chat invite',
      sticky: false,
      allowedTools: ['create_project_chat', 'invite_user_to_chat'],
      nextStep: 'ask_clarification',
      summary: 'Invite lane: create/share chat links with role and visibility boundaries.',
      laneRules: [
        'Resolve chat type and project/customer before inviting.',
        'Return copyable link by default.',
        'Only send SMS/email when explicitly requested and contact info exists.',
      ],
    })
  }

  return buildIntent({
    id: 'general',
    mode: 'chat',
    confidence: 0.45,
    primarySkill: 'command-center',
    workflowName: 'General Jobrolo chat',
    sticky: false,
    nextStep: 'answer',
    summary: 'General chat lane: answer briefly or ask one clarifying question before operational work.',
    laneRules: [
      'If the user asks for real saved data or mutation, route into a workflow/tool lane.',
      'Do not claim work was completed unless a tool succeeded.',
    ],
  })
}
