import { buildSkillRoutingContext, classifyUploadForSkills } from '../context'
import { selectSkills } from '../select-skill'

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message)
}

function skillIdsFor(text: string) {
  return selectSkills({ latestText: text, normalizedText: text.toLowerCase() }).map((selection) => selection.skill.id)
}

function assertSkillSelected(text: string, skillId: string, message: string) {
  const ids = skillIdsFor(text)
  assert(ids.includes(skillId), `${message}. Got: ${ids.join(', ')}`)
}

export const skillRoutingTestCases = [
  'ABC Supply price list routes to company pricing based on user/content evidence',
  'supplier invoice routes to project/job-cost behavior',
  'delivery ticket routes to project/material delivery behavior',
  'estimate template routes to company template behavior',
  'Xactimate estimate routes to project/customer scope behavior',
  'scope of loss routes to project/customer scope behavior',
  'logo routes to brand asset/company profile behavior',
  'profile photo/avatar routes to user profile behavior',
  'ambiguous documents ask one clarification',
  'filename-only price list hints do not auto-route',
  'generic image uploads route as photos, not price sheets',
  'image filename price-list hint does not override image/photo evidence',
  'show price list selects price-list behavior',
  'cash quote requests stay in bid/quote lane',
  'field observations stay in field evidence lane',
  'lead intake routes into lead lane',
  'appointment scheduling does not start field inspection',
  'photo evidence routes into photo lane',
  'roof reports route into report lane',
  'activity timeline routes into timeline lane',
  'integration provider requests route into provider lane',
  'role permission requests route into permission lane',
  'Cody activation stays in read-only QA lane',
  'brain stem detects learning without turning on training/development organ',
]

export function assertSkillRoutingContracts() {
  const abcPriceList = classifyUploadForSkills({
    filename: 'download (4).pdf',
    mimeType: 'application/pdf',
    recentUserText: 'Upload this ABC Supply price list.',
    visibleText: 'ABC Supply Price List branch account pricing SKU item unit price roofing materials shingles underlayment',
  })
  assert(abcPriceList.route === 'company_pricing', 'ABC/Supplier price list should route to company pricing')
  assert(abcPriceList.storageScope === 'company_pricing', 'Price list should use company_pricing storage scope')
  assert(abcPriceList.evidence !== 'filename_fallback', 'Price list classification should not rely on filename evidence')
  assert(abcPriceList.skillIds.includes('price-list'), 'Price list should select price-list skill')

  const supplierInvoice = classifyUploadForSkills({
    filename: 'abc-price-list.pdf',
    mimeType: 'application/pdf',
    recentUserText: 'Upload this supplier invoice for the job.',
    visibleText: 'Invoice number bill to remit payment subtotal tax total due ABC Supply material order',
    hasProjectContext: true,
  })
  assert(supplierInvoice.route === 'project_cost', 'Supplier invoice should route to project/job cost, not company pricebook')
  assert(supplierInvoice.storageScope === 'project_file', 'Supplier invoice should be project-level')

  const deliveryTicket = classifyUploadForSkills({
    filename: 'scan.pdf',
    mimeType: 'application/pdf',
    visibleText: 'Delivery Ticket order number delivery address shipped quantities received by branch',
    hasProjectContext: true,
  })
  assert(deliveryTicket.route === 'project_cost', 'Delivery ticket should route to project/material delivery behavior')

  const estimateTemplate = classifyUploadForSkills({
    filename: 'estimate_ccf0f302.pdf',
    mimeType: 'application/pdf',
    visibleText: 'Estimate template blank form customer name project address signature line terms and conditions',
  })
  assert(estimateTemplate.route === 'company_template', 'Estimate template should route to company template behavior')
  assert(estimateTemplate.storageScope === 'company_template', 'Estimate template should be company-level')

  const xactimateEstimate = classifyUploadForSkills({
    filename: 'download.pdf',
    mimeType: 'application/pdf',
    visibleText: 'Xactimate estimate claim number line items RCV ACV depreciation deductible roof covering',
    hasProjectContext: true,
  })
  assert(xactimateEstimate.route === 'project_scope', 'Xactimate estimate should route to project/customer scope')
  assert(xactimateEstimate.storageScope === 'project_file', 'Xactimate estimate should be project-level')

  const scopeOfLoss = classifyUploadForSkills({
    filename: 'document.pdf',
    mimeType: 'application/pdf',
    visibleText: 'Scope of Loss line items quantities unit price total RCV deductible interior drywall roof',
  })
  assert(scopeOfLoss.route === 'project_scope', 'Scope of loss should route to project/customer scope behavior')
  assert(scopeOfLoss.needsClarification, 'Scope without project/customer context should ask for where to attach')

  const logo = classifyUploadForSkills({
    filename: 'IMG_4920.png',
    mimeType: 'image/png',
    recentUserText: 'I want to add my company logo to my profile.',
  })
  assert(logo.route === 'brand_asset', 'Logo should route to brand asset/company profile behavior')
  assert(logo.needsClarification, 'Implicit logo should ask before applying to profile')

  const avatar = classifyUploadForSkills({
    filename: 'photo.jpg',
    mimeType: 'image/jpeg',
    recentUserText: 'Use this as my profile photo.',
  })
  assert(avatar.route === 'user_profile', 'Profile photo/avatar should route to user profile behavior')
  assert(avatar.needsClarification, 'Implicit avatar should ask before applying to account')

  const ambiguous = classifyUploadForSkills({
    filename: 'download (5).pdf',
    mimeType: 'application/pdf',
  })
  assert(ambiguous.route === 'unassigned_review', 'Ambiguous documents should not be routed silently')
  assert(ambiguous.needsClarification, 'Ambiguous documents should ask one clarification')
  assert(ambiguous.confidence < 0.5, 'Ambiguous documents should be low confidence')

  const filenameOnly = classifyUploadForSkills({
    filename: 'abc-price-list.pdf',
    mimeType: 'application/pdf',
  })
  assert(filenameOnly.route === 'unassigned_review', 'Filename-only price list hint should not auto-route')
  assert(filenameOnly.evidence === 'filename_fallback', 'Filename-only classification must be marked weak')
  assert(filenameOnly.needsClarification, 'Filename-only classification should ask or wait for extraction')

  const roofPhoto = classifyUploadForSkills({
    filename: 'roof-photo.png',
    mimeType: 'image/png',
    recentUserText: 'Upload this roof photo.',
  })
  assert(roofPhoto.fileType === 'photo', 'Generic roof image upload should stay a photo')
  assert(roofPhoto.route === 'unassigned_review', 'Untyped roof photo should wait for customer/project/section confirmation')
  assert(!roofPhoto.skillIds.includes('price-list'), 'Generic roof photo should not select price-list skill')

  const misleadingImageName = classifyUploadForSkills({
    filename: 'abc-price-list.png',
    mimeType: 'image/png',
  })
  assert(misleadingImageName.fileType === 'photo', 'Image MIME type should beat misleading price-list filename')
  assert(misleadingImageName.documentType === 'photo', 'Image with price-list filename should not become a price sheet without content or user intent')
  assert(misleadingImageName.route === 'unassigned_review', 'Misleading image filename should stay in review/confirmation path')

  assertSkillSelected('Show my material price list and first 10 rows', 'price-list', 'Show price list should select price-list behavior')
  const showPriceListSkills = skillIdsFor('Show my material price list and first 10 rows')
  assert(!showPriceListSkills.includes('file-attachment'), 'Show price list should not primarily route as generic file listing')

  const bidContext = buildSkillRoutingContext({ latestText: 'Create a cash quote for Timothy using the saved project photos.' })
  assert(bidContext.requestIntent?.id === 'cash_quote_bid', `Cash quote should resolve to cash_quote_bid intent, got ${bidContext.requestIntent?.id}`)
  const bidSkills = selectSkills(bidContext).map((selection) => selection.skill.id)
  assert(bidSkills.includes('bid-quote'), `Cash quote should select bid-quote, got ${bidSkills.join(', ')}`)
  assert(bidSkills.includes('entity-resolver'), 'Cash quote should select entity resolver before drafting')
  assert(!bidSkills.includes('field-copilot'), 'Cash quote should not drift into field/inspection lane')

  const observationContext = buildSkillRoutingContext({ latestText: 'Saw roof damage from ground. Missing shingles and dents to soft metals.' })
  assert(observationContext.requestIntent?.id === 'field_observation', `Field observation should resolve to field_observation intent, got ${observationContext.requestIntent?.id}`)
  const observationSkills = selectSkills(observationContext).map((selection) => selection.skill.id)
  assert(observationSkills.includes('field-copilot'), `Field observation should select field-copilot, got ${observationSkills.join(', ')}`)
  assert(!observationSkills.includes('customer-creation'), 'Field observation should not jump into customer creation')

  const leadContext = buildSkillRoutingContext({ latestText: 'Create a lead for Natalie Pearson at 486 North Charles St. Phone 777-661-0334.' })
  assert(leadContext.requestIntent?.id === 'lead_intake', `Lead creation should resolve to lead_intake intent, got ${leadContext.requestIntent?.id}`)
  const leadSkills = selectSkills(leadContext).map((selection) => selection.skill.id)
  assert(leadSkills.includes('lead-intake'), `Lead creation should select lead-intake, got ${leadSkills.join(', ')}`)
  assert(!leadSkills.includes('roof-report'), 'Lead intake should not drift into roof report workflow')

  const appointmentContext = buildSkillRoutingContext({ latestText: 'Schedule an inspection with Natalie tomorrow at 3.' })
  assert(appointmentContext.requestIntent?.id === 'appointment_scheduling', `Future inspection should resolve to appointment_scheduling intent, got ${appointmentContext.requestIntent?.id}`)
  assert(Boolean(appointmentContext.requestIntent?.blockedTools?.includes('start_field_inspection_lead')), 'Appointment scheduling should block active inspection lead creation')
  const appointmentSkills = selectSkills(appointmentContext).map((selection) => selection.skill.id)
  assert(appointmentSkills.includes('appointment-scheduling'), `Appointment scheduling should select appointment-scheduling, got ${appointmentSkills.join(', ')}`)

  const photoContext = buildSkillRoutingContext({ latestText: 'Show photos for Timothy grouped by roof photos and damage photos.' })
  assert(photoContext.requestIntent?.id === 'photo_evidence', `Photo request should resolve to photo_evidence intent, got ${photoContext.requestIntent?.id}`)
  const photoSkills = selectSkills(photoContext).map((selection) => selection.skill.id)
  assert(photoSkills.includes('photo-evidence'), `Photo request should select photo-evidence, got ${photoSkills.join(', ')}`)

  const reportContext = buildSkillRoutingContext({ latestText: 'Create a roof report for Timothy and let me pick the photos.' })
  assert(reportContext.requestIntent?.id === 'roof_report', `Roof report should resolve to roof_report intent, got ${reportContext.requestIntent?.id}`)
  const reportSkills = selectSkills(reportContext).map((selection) => selection.skill.id)
  assert(reportSkills.includes('roof-report'), `Roof report should select roof-report, got ${reportSkills.join(', ')}`)
  assert(reportSkills.includes('photo-evidence'), 'Roof report should consult photo-evidence')

  const timelineContext = buildSkillRoutingContext({ latestText: 'What happened last time at this job? Show the activity log.' })
  assert(timelineContext.requestIntent?.id === 'activity_timeline', `Activity request should resolve to activity_timeline intent, got ${timelineContext.requestIntent?.id}`)
  const timelineSkills = selectSkills(timelineContext).map((selection) => selection.skill.id)
  assert(timelineSkills.includes('activity-timeline'), `Timeline request should select activity-timeline, got ${timelineSkills.join(', ')}`)

  const integrationContext = buildSkillRoutingContext({ latestText: 'Is the ABC Supply API connected and ready?' })
  assert(integrationContext.requestIntent?.id === 'integration_provider', `Integration request should resolve to integration_provider intent, got ${integrationContext.requestIntent?.id}`)
  const integrationSkills = selectSkills(integrationContext).map((selection) => selection.skill.id)
  assert(integrationSkills.includes('integration-provider'), `Integration request should select integration-provider, got ${integrationSkills.join(', ')}`)

  const permissionContext = buildSkillRoutingContext({ latestText: 'Who can see this crew chat?' })
  assert(permissionContext.requestIntent?.id === 'role_permissions', `Permission request should resolve to role_permissions intent, got ${permissionContext.requestIntent?.id}`)
  const permissionSkills = selectSkills(permissionContext).map((selection) => selection.skill.id)
  assert(permissionSkills.includes('role-permissions'), `Permission request should select role-permissions, got ${permissionSkills.join(', ')}`)

  const codyContext = buildSkillRoutingContext({ latestText: 'Cody Cody Cody this button says approved but nothing happens.' })
  assert(codyContext.requestIntent?.id === 'cody_review', `Cody activation should resolve to cody_review intent, got ${codyContext.requestIntent?.id}`)
  assert(Boolean(codyContext.requestIntent?.blockedTools?.includes('create_customer')), 'Cody lane should block normal customer mutations')

  const learningContext = buildSkillRoutingContext({ latestText: 'Help me practice my sales pitch and roleplay homeowner objections.' })
  assert(Boolean(learningContext.brain?.signals.some(signal => signal.id === 'learning_needed')), 'Learning/coaching requests should be noticed by brain context')
  assert(learningContext.requestIntent?.id === 'general', `Training/development organ should not route yet, got ${learningContext.requestIntent?.id}`)
  const learningSkills = selectSkills(learningContext).map((selection) => selection.skill.id)
  assert(learningSkills.includes('brain-stem'), `Learning requests should select brain-stem context, got ${learningSkills.join(', ')}`)
  assert(!learningSkills.includes('personal-brain'), 'Personal/training brain skill should not exist or route before supporting data connections are ready')

  return true
}

if (process.argv[1]?.endsWith('skill-routing.test.ts')) {
  assertSkillRoutingContracts()
  console.log('skill routing contracts passed')
}
