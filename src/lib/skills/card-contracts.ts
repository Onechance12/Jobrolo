import { getJobroloCardTemplateById, JOBROLO_CARD_TEMPLATES, type JobroloCardTemplate } from '../cards/templates'
import type { JobroloSkill, SkillSelection } from './types'

const CARD_TEMPLATE_IDS = new Set(JOBROLO_CARD_TEMPLATES.map(template => template.id))

export type SkillCardContract = {
  skillId: string
  cardId: string
  template: JobroloCardTemplate
}

export function getSkillCardContracts(skill: JobroloSkill): SkillCardContract[] {
  return (skill.output?.cards ?? []).flatMap(cardId => {
    const template = getJobroloCardTemplateById(cardId)
    if (!template) return []
    return [{ skillId: skill.id, cardId, template }]
  })
}

export function getSelectedSkillCardContracts(selections: SkillSelection[]): SkillCardContract[] {
  const contracts = selections.flatMap(selection => getSkillCardContracts(selection.skill))
  const seen = new Set<string>()
  return contracts.filter(contract => {
    const key = `${contract.skillId}:${contract.template.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function getInvalidSkillCardIds(skill: JobroloSkill): string[] {
  return (skill.output?.cards ?? []).filter(cardId => !CARD_TEMPLATE_IDS.has(cardId))
}
