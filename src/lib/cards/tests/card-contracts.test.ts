import { findJobroloCardTemplate, isStructuredJobroloCardType } from '../templates'

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export function assertCardContracts() {
  const expectedStructuredTypes = [
    'scope_breakdown',
    'price_sheet_review',
    'job_cost',
    'customer_invoice',
    'commission',
    'material_order',
    'supplier_invoice',
    'roof_report',
    'signature_request',
    'project_closeout',
    'closeout_checklist',
  ]

  for (const cardType of expectedStructuredTypes) {
    assert(isStructuredJobroloCardType(cardType), `${cardType} should be treated as a structured Jobrolo card`)
    assert(Boolean(findJobroloCardTemplate(cardType)), `${cardType} should resolve to a card template`)
  }

  const closeoutTemplate = findJobroloCardTemplate('project_closeout')
  assert(closeoutTemplate?.id === 'production-status', `Project closeout should reuse production/readiness card contract, got ${closeoutTemplate?.id}`)
  assert(Boolean(closeoutTemplate?.primaryPromptPills.some(pill => /ready to close/i.test(pill.label))), 'Closeout card should expose a ready-to-close prompt pill')

  const jobCostTemplate = findJobroloCardTemplate('job_cost')
  assert(Boolean(jobCostTemplate?.primaryPromptPills.some(pill => /margin/i.test(pill.label) || /cost/i.test(pill.label))), 'Job-cost card should expose cost/margin prompt pills')

  return true
}

if (process.argv[1]?.endsWith('card-contracts.test.ts')) {
  assertCardContracts()
  console.log('card contracts passed')
}
