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

  if (/\b(cody cody cody|note to cody|hey cody|end cody|codex packet)\b/.test(text)) {
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
      : upload.route === 'project_scope'
        ? ['document-type-routing', 'project-context', 'approval']
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
          : upload.route === 'project_cost'
            ? 'supplier-invoice'
            : 'upload-classifier',
      supportingSkills: uploadSupports,
      workflowName: 'Upload routing',
      sticky: true,
      allowedTools: ['get_upload_status', 'get_document_content', 'link_document_to_customer', 'link_document_to_project', 'create_scope_from_document', 'review_price_sheet_items', 'create_template_upload_from_document', 'update_contractor_profile'],
      blockedTools: upload.companyLevel ? ['create_customer', 'create_project_for_customer'] : [],
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

  if (/\b(cash\s+quote|cash\s+bid|\bbid\b|quote|proposal)\b/.test(text) && /\b(create|make|build|draft|start|need|generate|prepare|write|put together|price|pricing|research)\b/.test(text)) {
    return buildIntent({
      id: 'cash_quote_bid',
      mode: 'workflow',
      confidence: 0.94,
      primarySkill: 'bid-quote',
      supportingSkills: ['entity-resolver', 'project-context', 'price-list', 'file-attachment', 'approval'],
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

  if (/\b(company health|company intelligence|business health|how are our leads|how are my leads|growth|grow|revenue|marketing kpis?|public research)\b/.test(text)) {
    return buildIntent({
      id: 'company_intelligence',
      mode: 'workflow',
      confidence: 0.86,
      primarySkill: 'company-intelligence',
      supportingSkills: ['company-profile'],
      workflowName: 'Company intelligence',
      sticky: false,
      allowedTools: ['get_company_intelligence', 'research_contractor_website'],
      blockedTools: ['update_contractor_profile'],
      nextStep: 'call_tool',
      summary: 'Company intelligence lane: use DB truth for KPIs and label public web/social evidence clearly.',
      laneRules: [
        'Do not overwrite company profile from public research without approval.',
        'Use saved Jobrolo data for lead/project counts.',
        'Label online/social findings as public evidence, not private analytics.',
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
      supportingSkills: ['approval'],
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
