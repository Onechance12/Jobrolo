import type { JobroloSkill } from './types'
import { corePlatformSkills } from './definitions/core-platform'
import { companySetupSkills } from './definitions/company-setup'
import { uploadsDocumentsSkills } from './definitions/uploads-documents'
import { customersProjectsSkills } from './definitions/customers-projects'
import { productionSkills } from './definitions/production'
import { supplierSkills } from './definitions/suppliers'
import { homeownerSkills } from './definitions/homeowner'
import { crewsSubsSkills } from './definitions/crews-subs'
import { partnerSkills } from './definitions/partners'
import { marketingGrowthSkills } from './definitions/marketing-growth'
import { metaJobroloSkills } from './definitions/meta-jobrolo'

export const JOBROLO_SKILLS: JobroloSkill[] = [
  ...corePlatformSkills,
  ...companySetupSkills,
  ...uploadsDocumentsSkills,
  ...customersProjectsSkills,
  ...productionSkills,
  ...supplierSkills,
  ...homeownerSkills,
  ...crewsSubsSkills,
  ...partnerSkills,
  ...marketingGrowthSkills,
  ...metaJobroloSkills,
].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))

const SKILL_MAP = new Map(JOBROLO_SKILLS.map(skill => [skill.id, skill]))

export function getSkillById(id: string) {
  return SKILL_MAP.get(id)
}

export function getSkillLabel(skill: JobroloSkill) {
  return skill.name || skill.title || skill.id
}

export function getSkillsByCategory(category: string) {
  return JOBROLO_SKILLS.filter(skill => skill.category === category)
}

export function getSkillsByIds(ids: string[]) {
  const unique = Array.from(new Set(ids))
  return unique.map(id => SKILL_MAP.get(id)).filter((skill): skill is JobroloSkill => Boolean(skill))
}

export function getActiveSkills() {
  return JOBROLO_SKILLS.filter(skill => skill.status === 'active')
}
