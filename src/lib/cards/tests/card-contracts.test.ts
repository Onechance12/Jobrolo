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
    'command_shortcuts',
    'brain_memory_saved',
    'brain_context',
    'brain_reflection',
    'agent_lesson_saved',
    'tester_feedback',
    'connection_onboarding',
    'cody_review',
    'canvassing_game_plan',
    'company_phone_numbers',
    'company_phone_number_search',
    'company_phone_number_provision',
    'phone_auth_setup',
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

  const memoryTemplate = findJobroloCardTemplate('brain_context')
  assert(Boolean(memoryTemplate?.displayRules.some(rule => /database records are truth/i.test(rule))), 'Memory card should warn that database records remain truth')

  const shortcutTemplate = findJobroloCardTemplate('command_shortcuts')
  assert(Boolean(shortcutTemplate?.displayRules.some(rule => /insert prompts/i.test(rule))), 'Shortcut card should explain shortcuts insert prompts')

  const companyPhoneTemplate = findJobroloCardTemplate('company_phone_numbers')
  assert(companyPhoneTemplate?.id === 'company-phone-numbers', `Company phone cards should resolve to company-phone-numbers, got ${companyPhoneTemplate?.id}`)
  assert(Boolean(companyPhoneTemplate?.primaryPromptPills.some(pill => /Jobrolo number/i.test(pill.label))), 'Company phone card should expose Jobrolo-number setup prompts')
  assert(Boolean(companyPhoneTemplate?.displayRules.some(rule => /Provisioning/i.test(rule) && /approval/i.test(rule))), 'Company phone card should document approval-gated provisioning')

  return true
}

if (process.argv[1]?.endsWith('card-contracts.test.ts')) {
  assertCardContracts()
  console.log('card contracts passed')
}
