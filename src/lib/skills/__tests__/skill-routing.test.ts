import { classifyUploadForSkills } from '../context'
import { selectSkills } from '../select-skill'

function skillIdsFor(text: string) {
  return selectSkills({ latestText: text, normalizedText: text.toLowerCase() }).map((selection) => selection.skill.id)
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message)
}

export function assertSkillRoutingContracts() {
  const priceSheet = classifyUploadForSkills({
    filename: 'SUPPLIER_PRICE_LIST_2026.pdf',
    mimeType: 'application/pdf',
  })
  assert(priceSheet.route === 'company_pricing', 'price lists should route to company pricing')
  assert(priceSheet.companyLevel, 'price lists should be company-level')
  assert(priceSheet.skillIds.includes('price-list'), 'price lists should select price-list skill')

  const supplierInvoice = classifyUploadForSkills({
    filename: 'supplier_delivery_ticket_project_address.pdf',
    mimeType: 'application/pdf',
  })
  assert(supplierInvoice.route === 'project_cost', 'supplier delivery tickets should route to project cost')

  const template = classifyUploadForSkills({
    filename: 'Roofing_Agreement_Template.pdf',
    mimeType: 'application/pdf',
  })
  assert(template.route === 'company_template', 'agreement templates should route to company templates')

  const scope = classifyUploadForSkills({
    filename: 'Xactimate_scope_4524_Lakecrest.pdf',
    mimeType: 'application/pdf',
    hasProjectContext: true,
  })
  assert(scope.route === 'project_scope', 'Xactimate scopes should route to project scope')
  assert(scope.storageScope === 'project_file', 'scope with project context should be project scoped')

  const logo = classifyUploadForSkills({
    filename: 'new-company-logo.png',
    mimeType: 'image/png',
    recentUserText: 'I want to add my company logo',
  })
  assert(logo.route === 'brand_asset', 'logo-adjacent images should route to brand assets')
  assert(logo.needsClarification, 'implicit logo uploads should ask before updating profile')

  const companySkills = skillIdsFor('Research my company profile and update missing company information')
  assert(companySkills.includes('company-profile'), 'company profile requests should select company-profile')
  assert(!companySkills.includes('customer-creation'), 'company profile requests should not select customer creation')

  const priceSkills = skillIdsFor('Show my material price list and first 10 rows')
  assert(priceSkills.includes('price-list'), 'show price list should select price-list skill')

  return true
}

export const skillRoutingTestCases = [
  'price sheet classification',
  'supplier invoice classification',
  'estimate template classification',
  'Xactimate/scope classification',
  'filename-as-content guard via project scope routing',
  'company-not-customer guard',
  'show price list routing',
]
