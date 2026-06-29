import { JOBROLO_SKILLS, getSkillById } from '../registry'
import { buildSkillRoutingContext } from '../context'
import { getInvalidSkillCardIds, getSelectedSkillCardContracts } from '../card-contracts'
import { orchestrateSkills } from '../orchestrate-skills'
import { selectSkills } from '../select-skill'

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message)
}

const CANONICAL_CATEGORIES = new Set([
  'core_platform',
  'company_setup',
  'uploads_documents',
  'customers_projects',
  'production',
  'suppliers',
  'homeowner',
  'crews_subs',
  'partners',
  'external_roles',
  'marketing_growth',
  'meta',
])

const RUNTIME_CRITICAL_SKILLS = [
  'command-center',
  'intent-routing',
  'failure-handling',
  'approval',
  'upload-classifier',
  'document-type-routing',
  'file-attachment',
  'price-list',
  'save-scope',
  'company-profile',
  'company-intelligence',
  'brand-assets',
  'user-profile',
  'entity-resolver',
  'customer-creation',
  'project-creation',
  'project-context',
  'project-status',
  'lead-intake',
  'appointment-scheduling',
  'bid-quote',
  'invoice',
  'job-cost',
  'labor-cost',
  'commission',
  'insurance-claim',
  'field-copilot',
  'photo-evidence',
  'roof-report',
  'activity-timeline',
  'communication-routing',
  'role-permissions',
  'integration-provider',
  'crew-subcontractor',
  'supplier',
  'supplier-invoice',
  'qa',
  'codex-packet',
]

function assertActiveSkill(skillId: string) {
  const skill = getSkillById(skillId)
  assert(Boolean(skill), `Expected skill "${skillId}" to exist`)
  assert(skill?.status === 'active', `Expected runtime-critical skill "${skillId}" to be active, got ${skill?.status}`)
}

function skillIdsFor(text: string) {
  return selectSkills(buildSkillRoutingContext({ latestText: text })).map(selection => selection.skill.id)
}

export function assertSkillRegistryContracts() {
  const ids = new Set<string>()
  for (const skill of JOBROLO_SKILLS) {
    assert(!ids.has(skill.id), `Duplicate skill id found: ${skill.id}`)
    ids.add(skill.id)
    assert(CANONICAL_CATEGORIES.has(skill.category), `Skill "${skill.id}" uses non-canonical category "${skill.category}"`)
    assert(skill.purpose.trim().length > 0, `Skill "${skill.id}" must have a purpose`)
    assert(skill.whenToUse.length > 0, `Skill "${skill.id}" must describe when to use it`)
    assert(skill.decisionRules.length > 0, `Skill "${skill.id}" must include decision rules`)
    const invalidCardIds = getInvalidSkillCardIds(skill)
    assert(invalidCardIds.length === 0, `Skill "${skill.id}" references unknown card template(s): ${invalidCardIds.join(', ')}`)
  }

  for (const skillId of RUNTIME_CRITICAL_SKILLS) assertActiveSkill(skillId)

  const codySkills = skillIdsFor('Cody Cody Cody this approval button says approved but nothing happens.')
  assert(codySkills.includes('qa'), `Cody activation should select QA skill, got ${codySkills.join(', ')}`)
  assert(!codySkills.includes('customer-creation'), 'Cody activation should not select normal customer mutation skills')

  const companyHealthSkills = skillIdsFor('Show company health and what we should do this week to grow.')
  assert(companyHealthSkills.includes('company-intelligence'), `Company health should select company-intelligence, got ${companyHealthSkills.join(', ')}`)
  const companyHealthContracts = getSelectedSkillCardContracts(selectSkills(buildSkillRoutingContext({ latestText: 'Show company health and what we should do this week to grow.' })))
  assert(companyHealthContracts.some(contract => contract.template.id === 'company-intelligence'), 'Company health should carry the company-intelligence card contract')

  const crewSkills = skillIdsFor('Create a roofing crew chat for this job and give me the invite link.')
  assert(crewSkills.includes('crew-subcontractor'), `Crew chat should select crew-subcontractor, got ${crewSkills.join(', ')}`)
  const crewContracts = getSelectedSkillCardContracts(selectSkills(buildSkillRoutingContext({ latestText: 'Create a roofing crew chat for this job and give me the invite link.' })))
  assert(crewContracts.some(contract => contract.template.id === 'shared-chat'), 'Crew chat should carry the shared-chat card contract')

  const quoteContracts = getSelectedSkillCardContracts(selectSkills(buildSkillRoutingContext({ latestText: 'Create a cash quote for this project from the saved scope.' })))
  assert(quoteContracts.some(contract => contract.template.id === 'cash-quote'), 'Cash quote workflow should carry the cash-quote card contract')
  assert(quoteContracts.some(contract => contract.template.id === 'estimate-proposal'), 'Cash quote workflow should carry the estimate-proposal card contract')
  const quoteSkillIds = skillIdsFor('Create a cash quote for this project from the saved scope.')
  assert(quoteSkillIds.includes('price-list'), `Cash quote should select price-list support, got ${quoteSkillIds.join(', ')}`)
  const quotePlan = orchestrateSkills(buildSkillRoutingContext({ latestText: 'Create a cash quote for this project from the saved scope.' }))
  assert(quotePlan.supportingSkills.includes('job-cost'), `Cash quote orchestrator should consult job-cost, got ${quotePlan.supportingSkills.join(', ')}`)

  const jobCostContracts = getSelectedSkillCardContracts(selectSkills(buildSkillRoutingContext({ latestText: 'Show the job cost, gross profit, and margin for this project.' })))
  assert(jobCostContracts.some(contract => contract.template.id === 'job-cost'), 'Job cost workflow should carry the job-cost card contract')

  const invoiceContracts = getSelectedSkillCardContracts(selectSkills(buildSkillRoutingContext({ latestText: 'Show unpaid customer invoices and balance due for this job.' })))
  assert(invoiceContracts.some(contract => contract.template.id === 'invoice'), 'Invoice workflow should carry the invoice card contract')

  const commissionContracts = getSelectedSkillCardContracts(selectSkills(buildSkillRoutingContext({ latestText: 'Calculate sales rep commission for this project.' })))
  assert(commissionContracts.some(contract => contract.template.id === 'commission'), 'Commission workflow should carry the commission card contract')

  const materialOrderContracts = getSelectedSkillCardContracts(selectSkills(buildSkillRoutingContext({ latestText: 'Show material order delivery status and backorders.' })))
  assert(materialOrderContracts.some(contract => contract.template.id === 'material-order'), 'Material order workflow should carry the material-order card contract')

  const claimContracts = getSelectedSkillCardContracts(selectSkills(buildSkillRoutingContext({ latestText: 'Explain the deductible, RCV, ACV, and supplement gaps for this insurance claim.' })))
  assert(claimContracts.some(contract => contract.template.id === 'insurance-claim'), 'Claim/supplement workflow should carry the insurance-claim card contract')

  const templateContracts = getSelectedSkillCardContracts(selectSkills(buildSkillRoutingContext({ latestText: 'Upload this agreement as a reusable company template.' })))
  assert(templateContracts.some(contract => contract.template.id === 'template-library'), 'Template intake should carry the template-library card contract')

  const profileContracts = getSelectedSkillCardContracts(selectSkills(buildSkillRoutingContext({ latestText: 'Use this uploaded image as my profile photo.' })))
  assert(profileContracts.some(contract => contract.template.id === 'user-profile'), 'User profile photo workflow should carry the user-profile card contract')

  const codyContracts = getSelectedSkillCardContracts(selectSkills(buildSkillRoutingContext({ latestText: 'Cody Cody Cody this onboarding card is broken.' })))
  assert(codyContracts.some(contract => contract.template.id === 'cody-review'), 'Cody workflow should carry the Cody review card contract')

  const productionPlan = orchestrateSkills({ latestText: 'Is this job ready to build?', normalizedText: 'is this job ready to build?' })
  assert(productionPlan.primarySkill === 'production-coordinator', `Ready-to-build should use production-coordinator, got ${productionPlan.primarySkill}`)
  assert(productionPlan.supportingSkills.includes('project-status'), 'Ready-to-build should consult project-status')
  assert(productionPlan.supportingSkills.includes('material-ordering'), 'Ready-to-build should consult material-ordering')
  assert(productionPlan.supportingSkills.includes('job-cost'), 'Ready-to-build should consult job-cost')
  assert(productionPlan.recommendedAction.includes('financial/job-cost completeness'), 'Ready-to-build orchestration should mention financial/job-cost completeness')
  const jobCostPlan = orchestrateSkills({ latestText: 'Show job cost, gross profit, margin, and balance due.', normalizedText: 'show job cost, gross profit, margin, and balance due.' })
  assert(jobCostPlan.recommendedAction.includes('ProjectFinancialEntry'), 'Job-cost orchestration should name ProjectFinancialEntry as the money truth')
  const materialOrdering = getSkillById('material-ordering')
  assert(materialOrdering?.status === 'experimental', 'Material ordering should stay experimental until live supplier APIs exist')

  return true
}

if (process.argv[1]?.endsWith('skill-registry.test.ts')) {
  assertSkillRegistryContracts()
  console.log('skill registry contracts passed')
}
