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
    'field_map_card',
    'geo_event',
    'location_event',
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

  const photoTemplate = findJobroloCardTemplate('inspection_photo_set')
  assert(photoTemplate?.id === 'photo-evidence', `Inspection photo sets should use photo evidence card contract, got ${photoTemplate?.id}`)
  assert(Boolean(photoTemplate?.displayRules.some(rule => /thumbnails/i.test(rule))), 'Photo evidence card should require thumbnails before long text')
  assert(Boolean(photoTemplate?.displayRules.some(rule => /remove blurry|remove.*photos/i.test(rule))), 'Photo evidence card should support removing bad photos before finalizing')

  const fieldTemplate = findJobroloCardTemplate('field_inspection_lead')
  assert(fieldTemplate?.id === 'field-inspection', `Field inspection cards should resolve to field-inspection, got ${fieldTemplate?.id}`)
  assert(Boolean(fieldTemplate?.displayRules.some(rule => /remain active/i.test(rule) && /thumbnails/i.test(rule))), 'Field inspection card should keep photo workflow active with thumbnails')

  const fieldMapTemplate = findJobroloCardTemplate('field_map_card')
  assert(fieldMapTemplate?.id === 'field-map', `Field map cards should resolve to field-map, got ${fieldMapTemplate?.id}`)
  assert(Boolean(fieldMapTemplate?.displayRules.some(rule => /many location events/i.test(rule))), 'Field map card should document many location events per property')
  assert(Boolean(fieldMapTemplate?.displayRules.some(rule => /AR|glasses/i.test(rule))), 'Field map card should be AR/glasses-ready')

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
