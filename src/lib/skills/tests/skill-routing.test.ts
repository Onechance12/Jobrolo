import { classifyUploadForSkills } from '../context'
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
  'show price list selects price-list behavior',
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

  assertSkillSelected('Show my material price list and first 10 rows', 'price-list', 'Show price list should select price-list behavior')
  const showPriceListSkills = skillIdsFor('Show my material price list and first 10 rows')
  assert(!showPriceListSkills.includes('file-attachment'), 'Show price list should not primarily route as generic file listing')

  return true
}

if (process.argv[1]?.endsWith('skill-routing.test.ts')) {
  assertSkillRoutingContracts()
  console.log('skill routing contracts passed')
}
