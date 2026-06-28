import { getSkillById } from './registry'
import type { SkillRoutingContext, SkillSelection } from './types'

function select(skillId: string, confidence: number, reason: string): SkillSelection | undefined {
  const skill = getSkillById(skillId)
  if (!skill) return undefined
  return { skill, confidence, reason }
}

function pushUnique(selections: SkillSelection[], selection: SkillSelection | undefined) {
  if (!selection) return
  const existing = selections.find((item) => item.skill.id === selection.skill.id)
  if (existing) {
    if (selection.confidence > existing.confidence) {
      existing.confidence = selection.confidence
      existing.reason = selection.reason
    }
    return
  }
  selections.push(selection)
}

export function selectSkills(context: SkillRoutingContext): SkillSelection[] {
  const selections: SkillSelection[] = []
  const text = context.normalizedText || ''
  const upload = context.uploadClassification

  pushUnique(selections, select('command-center', 0.6, 'Default chat-first operating mode.'))
  pushUnique(selections, select('intent-routing', 0.6, 'Select narrow skills before tools.'))
  pushUnique(selections, select('failure-handling', 0.6, 'Prevent narrated work without tool execution.'))

  if (upload) {
    upload.skillIds.forEach((skillId) => pushUnique(selections, select(skillId, upload.confidence, upload.reason)))
    if (upload.companyLevel) pushUnique(selections, select('company-profile', 0.7, 'Upload is company-level.'))
  }

  if (/(price\s*(sheet|list)|material prices|supplier pricing|review rows|pending import)/.test(text)) {
    pushUnique(selections, select('price-list', 0.95, 'User is asking about material/supplier price list workflow.'))
  }

  if (/(scope breakdown|save scope|xactimate|symbility|carrier estimate|estimate document)/.test(text)) {
    pushUnique(selections, select('save-scope', 0.88, 'Scope/estimate persistence or review request.'))
  }

  if (/(company profile|company info|business info|research my company|website|license|legal footer)/.test(text)) {
    pushUnique(selections, select('company-profile', 0.88, 'Company profile/setup request.'))
  }

  if (/(logo|profile photo|avatar|brand asset|brand color)/.test(text)) {
    pushUnique(selections, select('brand-assets', 0.9, 'Brand/profile asset routing request.'))
  }

  if (/(saved database records|customer file|client file|job packet|show.*(files|photos)|what clients|saved clients)/.test(text)) {
    pushUnique(selections, select('entity-resolver', 0.9, 'Saved record/customer/project retrieval request.'))
    pushUnique(selections, select('project-context', 0.82, 'Project/customer file context may be needed.'))
    pushUnique(selections, select('file-attachment', 0.8, 'File/photo display or attachment context may be needed.'))
  }

  if (/(create customer|add client|new homeowner|save customer)/.test(text)) {
    pushUnique(selections, select('customer-creation', 0.86, 'Customer creation intent.'))
  }

  if (/(create project|create job|new project|job number|project number)/.test(text)) {
    pushUnique(selections, select('project-creation', 0.86, 'Project creation intent.'))
  }

  if (/(crew chat|sub chat|subcontractor|roofer|gutter crew|window crew)/.test(text)) {
    pushUnique(selections, select('crew-subcontractor', 0.86, 'Crew/subcontractor shared chat intent.'))
  }

  if (/(approved|approve|approval|reject|delete|remove|archive)/.test(text)) {
    pushUnique(selections, select('approval', 0.86, 'Approval/destructive or replay-sensitive intent.'))
  }

  if (/(hey cody|note to cody|bug|test failed)/.test(text)) {
    pushUnique(selections, select('qa', 0.9, 'Tester note or QA report.'))
  }

  return selections.sort((a, b) => b.confidence - a.confidence || b.skill.priority - a.skill.priority).slice(0, 6)
}
