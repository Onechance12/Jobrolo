import { JOBROLO_SKILLS, getSkillById } from '../registry'
import { buildSkillRoutingContext } from '../context'
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
  'entity-resolver',
  'customer-creation',
  'project-creation',
  'project-context',
  'project-status',
  'lead-intake',
  'appointment-scheduling',
  'bid-quote',
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
  }

  for (const skillId of RUNTIME_CRITICAL_SKILLS) assertActiveSkill(skillId)

  const codySkills = skillIdsFor('Cody Cody Cody this approval button says approved but nothing happens.')
  assert(codySkills.includes('qa'), `Cody activation should select QA skill, got ${codySkills.join(', ')}`)
  assert(!codySkills.includes('customer-creation'), 'Cody activation should not select normal customer mutation skills')

  const companyHealthSkills = skillIdsFor('Show company health and what we should do this week to grow.')
  assert(companyHealthSkills.includes('company-intelligence'), `Company health should select company-intelligence, got ${companyHealthSkills.join(', ')}`)

  const crewSkills = skillIdsFor('Create a roofing crew chat for this job and give me the invite link.')
  assert(crewSkills.includes('crew-subcontractor'), `Crew chat should select crew-subcontractor, got ${crewSkills.join(', ')}`)

  const productionPlan = orchestrateSkills({ latestText: 'Is this job ready to build?', normalizedText: 'is this job ready to build?' })
  assert(productionPlan.primarySkill === 'production-coordinator', `Ready-to-build should use production-coordinator, got ${productionPlan.primarySkill}`)
  assert(productionPlan.supportingSkills.includes('project-status'), 'Ready-to-build should consult project-status')
  assert(productionPlan.supportingSkills.includes('supplier-order-status'), 'Ready-to-build should consult supplier-order-status')
  const supplierOrderStatus = getSkillById('supplier-order-status')
  assert(supplierOrderStatus?.status === 'experimental', 'Supplier order status should stay experimental until live supplier APIs exist')

  return true
}

if (process.argv[1]?.endsWith('skill-registry.test.ts')) {
  assertSkillRegistryContracts()
  console.log('skill registry contracts passed')
}
