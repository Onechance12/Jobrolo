import { buildSkillRoutingContext, classifyUploadForSkills } from '../context'
import { orchestrateSkills } from '../orchestrate-skills'

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message)
}

function planForText(text: string) {
  return orchestrateSkills({ latestText: text, normalizedText: text.toLowerCase() })
}

export function assertMultiSkillOrchestrationContracts() {
  const priceSheetContext = buildSkillRoutingContext({
    latestText: 'Upload this supplier price sheet.',
    upload: {
      filename: 'download.pdf',
      mimeType: 'application/pdf',
      recentUserText: 'Upload this supplier price sheet.',
      visibleText: 'ABC Supply Price List SKU item unit price branch account pricing',
    },
  })
  const priceSheet = orchestrateSkills(priceSheetContext)
  assert(priceSheet.primarySkill === 'price-list', `Price sheet primary should be price-list, got ${priceSheet.primarySkill}`)
  assert(priceSheet.supportingSkills.includes('upload-classifier'), 'Price sheet should consult upload-classifier')
  assert(priceSheet.supportingSkills.includes('supplier'), 'Price sheet should consult supplier')
  assert(priceSheet.supportingSkills.includes('approval'), 'Price sheet should consult approval')

  const supplierInvoiceContext = buildSkillRoutingContext({
    latestText: 'Upload this supplier invoice to the job.',
    upload: {
      filename: 'abc-price-list.pdf',
      mimeType: 'application/pdf',
      recentUserText: 'Upload this supplier invoice to the job.',
      visibleText: 'Invoice number bill to remit payment subtotal tax total due ABC Supply material order',
      hasProjectContext: true,
    },
  })
  const supplierInvoice = orchestrateSkills(supplierInvoiceContext)
  assert(supplierInvoice.primarySkill === 'supplier-invoice', `Supplier invoice primary should be supplier-invoice, got ${supplierInvoice.primarySkill}`)
  assert(supplierInvoice.supportingSkills.includes('project-context'), 'Supplier invoice should consult project-context')
  assert(supplierInvoice.supportingSkills.includes('approval'), 'Supplier invoice should consult approval')

  const scopeContext = buildSkillRoutingContext({
    latestText: 'Save this estimate to the job file.',
    upload: {
      filename: 'scan.pdf',
      mimeType: 'application/pdf',
      recentUserText: 'Save this estimate to the job file.',
      visibleText: 'Xactimate estimate claim number line items RCV ACV depreciation deductible',
      hasProjectContext: true,
    },
  })
  const scope = orchestrateSkills(scopeContext)
  assert(scope.primarySkill === 'save-scope', `Estimate/scope primary should be save-scope, got ${scope.primarySkill}`)
  assert(scope.supportingSkills.includes('document-type-routing'), 'Scope should consult document-type-routing')
  assert(scope.supportingSkills.includes('project-context'), 'Scope should consult project-context')

  const production = planForText('Is this job ready to build?')
  assert(production.primarySkill === 'production-coordinator', `Ready-to-build primary should be production-coordinator, got ${production.primarySkill}`)
  assert(production.supportingSkills.includes('project-status'), 'Ready-to-build should consult project-status')
  assert(production.supportingSkills.includes('material-ordering'), 'Ready-to-build should consult material-ordering')
  assert(production.supportingSkills.includes('job-cost'), 'Ready-to-build should consult job-cost')

  const closeout = planForText('Is this job ready to close? Check final invoice, payments, job cost, commission, report, signatures, and warranty packet.')
  assert(closeout.primarySkill === 'project-closeout', `Closeout primary should be project-closeout, got ${closeout.primarySkill}`)
  assert(closeout.supportingSkills.includes('project-status'), 'Closeout should consult project-status')
  assert(closeout.supportingSkills.includes('job-cost'), 'Closeout should consult job-cost')
  assert(closeout.supportingSkills.includes('activity-timeline'), 'Closeout should consult activity-timeline')
  assert(closeout.approvalNeeded, 'Closeout should require approval before mutating closeout status or sending packets')
  assert(closeout.blockedTools.includes('create_customer'), 'Closeout should block accidental customer creation')
  assert(closeout.recommendedAction.includes('closeout readiness checklist'), 'Closeout orchestration should explain checklist behavior')

  const simplePriceList = planForText('Show price list')
  assert(simplePriceList.primarySkill === 'price-list', `Show price list primary should be price-list, got ${simplePriceList.primarySkill}`)
  assert(simplePriceList.supportingSkills.length === 0, `Show price list should stay simple, got ${simplePriceList.supportingSkills.join(', ')}`)
  const materialPriceList = orchestrateSkills(buildSkillRoutingContext({ latestText: 'Show material price list' }))
  assert(materialPriceList.primarySkill === 'price-list', `Material price list primary should be price-list, got ${materialPriceList.primarySkill}`)
  assert(materialPriceList.supportingSkills.length === 0, `Material price list should stay simple, got ${materialPriceList.supportingSkills.join(', ')}`)

  const cashQuote = orchestrateSkills(buildSkillRoutingContext({ latestText: 'Create a cash quote for Timothy using saved project files.' }))
  assert(cashQuote.primarySkill === 'bid-quote', `Cash quote primary should be bid-quote, got ${cashQuote.primarySkill}`)
  assert(cashQuote.supportingSkills.includes('entity-resolver'), 'Cash quote should consult entity-resolver')
  assert(cashQuote.supportingSkills.includes('price-list'), 'Cash quote should consult price-list/material pricing context')
  assert(cashQuote.blockedTools.includes('start_field_inspection_lead'), 'Cash quote should block accidental field inspection creation')
  assert(cashQuote.recommendedAction.includes('Cash quote/bid lane'), 'Cash quote orchestration should explain the selected lane')

  const fieldObservation = orchestrateSkills(buildSkillRoutingContext({ latestText: 'No soliciting sign and renters at the door. Saw window screen damage.' }))
  assert(fieldObservation.primarySkill === 'field-copilot', `Field observation primary should be field-copilot, got ${fieldObservation.primarySkill}`)
  assert(fieldObservation.blockedTools.includes('create_customer'), 'Field observation should not create customer records before confirmation')
  assert(fieldObservation.recommendedAction.includes('Field observation lane'), 'Field observation orchestration should explain the selected lane')

  const lead = orchestrateSkills(buildSkillRoutingContext({ latestText: 'Create a lead for Natalie Pearson at 486 North Charles St. Phone 777-661-0334.' }))
  assert(lead.primarySkill === 'lead-intake', `Lead primary should be lead-intake, got ${lead.primarySkill}`)
  assert(lead.supportingSkills.includes('appointment-scheduling'), 'Lead intake should consult scheduling for next-step context')
  assert(lead.supportingSkills.includes('activity-timeline'), 'Lead intake should consult timeline/activity context')

  const appointment = orchestrateSkills(buildSkillRoutingContext({ latestText: 'Schedule an inspection with Natalie tomorrow at 3.' }))
  assert(appointment.primarySkill === 'appointment-scheduling', `Appointment primary should be appointment-scheduling, got ${appointment.primarySkill}`)
  assert(appointment.blockedTools.includes('start_field_inspection_lead'), 'Appointment scheduling should block accidental active inspection creation')
  assert(appointment.supportingSkills.includes('communication-routing'), 'Appointment scheduling should consult communication-routing for invites/notifications')

  const photoEvidence = orchestrateSkills(buildSkillRoutingContext({ latestText: 'Show photos for Timothy grouped by roof photos and damage photos.' }))
  assert(photoEvidence.primarySkill === 'photo-evidence', `Photo primary should be photo-evidence, got ${photoEvidence.primarySkill}`)
  assert(photoEvidence.supportingSkills.includes('project-context'), 'Photo evidence should consult project-context')
  assert(photoEvidence.supportingSkills.includes('activity-timeline'), 'Photo evidence should preserve activity/timeline context')

  const roofReport = orchestrateSkills(buildSkillRoutingContext({ latestText: 'Create a roof report for Timothy and let me pick the photos.' }))
  assert(roofReport.primarySkill === 'roof-report', `Roof report primary should be roof-report, got ${roofReport.primarySkill}`)
  assert(roofReport.supportingSkills.includes('photo-evidence'), 'Roof report should consult photo-evidence')
  assert(roofReport.supportingSkills.includes('approval'), 'Roof report should consult approval before final/share')

  const integration = orchestrateSkills(buildSkillRoutingContext({ latestText: 'Is the ABC Supply API connected and ready?' }))
  assert(integration.primarySkill === 'integration-provider', `Integration primary should be integration-provider, got ${integration.primarySkill}`)
  assert(integration.supportingSkills.includes('failure-handling'), 'Integration provider should consult failure-handling for missing providers/fallbacks')

  const companyPhone = orchestrateSkills(buildSkillRoutingContext({ latestText: 'Get us a Jobrolo company phone number for SMS and customer calls.' }))
  assert(companyPhone.primarySkill === 'company-phone-number', `Company phone primary should be company-phone-number, got ${companyPhone.primarySkill}`)
  assert(companyPhone.supportingSkills.includes('communication-routing'), 'Company phone setup should consult communication-routing')
  assert(companyPhone.supportingSkills.includes('integration-provider'), 'Company phone setup should consult integration-provider')
  assert(companyPhone.supportingSkills.includes('approval'), 'Company phone provisioning should consult approval')
  assert(companyPhone.approvalNeeded, 'Company phone provisioning should require approval before buying/provisioning numbers')
  assert(companyPhone.recommendedAction.includes('Provisioning'), 'Company phone orchestration should explain provisioning approval/risk')

  const permissions = orchestrateSkills(buildSkillRoutingContext({ latestText: 'Who can see this crew chat?' }))
  assert(permissions.primarySkill === 'role-permissions', `Permissions primary should be role-permissions, got ${permissions.primarySkill}`)
  assert(permissions.supportingSkills.includes('communication-routing'), 'Permissions should consult communication-routing for shared-chat visibility')
  assert(permissions.supportingSkills.includes('approval'), 'Permissions should consult approval for access changes')

  const capped = orchestrateSkills(priceSheetContext, { highComplexity: false, supportLimit: 2 })
  assert(capped.supportingSkills.length <= 2, 'Supporting skills should be capped unless high complexity is requested')
  const highComplexity = orchestrateSkills(priceSheetContext, { highComplexity: true })
  assert(highComplexity.highComplexity, 'Explicit high-complexity workflows should be flagged')
  assert(highComplexity.supportingSkills.length >= priceSheet.supportingSkills.length, 'High-complexity workflows may carry more supporting skills')

  assert(priceSheet.consults.every(consult => consult.finding.length < 240), 'Consults should stay compact')
  assert(!priceSheet.allowedTools.includes('auto_execute_without_approval'), 'Orchestration must not invent unsafe tool execution')

  const filenameOnly = classifyUploadForSkills({ filename: 'abc-price-list.pdf', mimeType: 'application/pdf' })
  const filenameOnlyPlan = orchestrateSkills(buildSkillRoutingContext({ latestText: '', upload: { filename: 'abc-price-list.pdf', mimeType: 'application/pdf' } }))
  assert(filenameOnly.route === 'unassigned_review', 'Filename-only upload should remain low-confidence review')
  assert(filenameOnlyPlan.primarySkill === 'upload-classifier', `Filename-only primary should be upload-classifier, got ${filenameOnlyPlan.primarySkill}`)

  return true
}

if (process.argv[1]?.endsWith('multi-skill-orchestration.test.ts')) {
  assertMultiSkillOrchestrationContracts()
  console.log('multi-skill orchestration contracts passed')
}
