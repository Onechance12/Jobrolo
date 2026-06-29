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
  assert(production.supportingSkills.includes('supplier-order-status'), 'Ready-to-build should consult supplier-order-status')

  const simplePriceList = planForText('Show price list')
  assert(simplePriceList.primarySkill === 'price-list', `Show price list primary should be price-list, got ${simplePriceList.primarySkill}`)
  assert(simplePriceList.supportingSkills.length === 0, `Show price list should stay simple, got ${simplePriceList.supportingSkills.join(', ')}`)

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
