import { getSkillLabel } from './registry'
import type { JobroloSkill, SkillRoutingContext, SkillSelection } from './types'

function ruleToText(rule: JobroloSkill['decisionRules'][number]): string {
  if (typeof rule === 'string') return rule
  return `If ${rule.if}, then ${rule.then}.`
}

export function renderSkillInstructions(selections: SkillSelection[], context?: SkillRoutingContext): string {
  if (!selections.length) return ''

  const lines: string[] = [
    'JOBROLO SELECTED SKILLS (compact runtime rules)',
    'Use these selected skills for this turn. Do not dump the full skill library into the answer.',
    'Only claim saved/created/updated/imported/deleted after a successful tool/database result.',
  ]

  for (const selection of selections) {
    const skill = selection.skill
    const rules = skill.decisionRules.slice(0, 4).map(ruleToText)
    lines.push(`- ${skill.id} (${getSkillLabel(skill)}, confidence ${selection.confidence.toFixed(2)}): ${skill.purpose}`)
    if (selection.reason) lines.push(`  Reason: ${selection.reason}`)
    for (const rule of rules) lines.push(`  Rule: ${rule}`)
    if (skill.allowedTools?.length) lines.push(`  Prefer tools: ${skill.allowedTools.join(', ')}`)
    if (skill.forbiddenTools?.length) lines.push(`  Do not use: ${skill.forbiddenTools.join(', ')}`)
    if (skill.approvalRequiredFor?.length) lines.push(`  Approval required for: ${skill.approvalRequiredFor.join(', ')}`)
  }

  if (context?.uploadClassification) {
    const route = context.uploadClassification
    lines.push(`Upload route: ${route.documentType} -> ${route.storageScope}. fileType=${route.fileType}. companyLevel=${route.companyLevel}. needsClarification=${route.needsClarification}. reason=${route.reason}`)
  }

  return lines.join('\n')
}
