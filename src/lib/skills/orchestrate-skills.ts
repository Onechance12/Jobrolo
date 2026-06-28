import { getSkillById } from './registry'
import { selectSkills } from './select-skill'
import type {
  JobroloSkillRisk,
  SkillConsult,
  SkillOrchestrationPlan,
  SkillRoutingContext,
} from './types'

const SUPPORT_LIMIT = 3

const RISK_RANK: Record<JobroloSkillRisk, number> = {
  read: 0,
  low: 1,
  medium: 2,
  high: 3,
  external: 4,
}

const WORKFLOW_SUPPORTS: Record<string, string[]> = {
  'price-list': ['upload-classifier', 'supplier', 'approval'],
  'supplier-invoice': ['upload-classifier', 'project-context', 'approval'],
  'save-scope': ['document-type-routing', 'project-context', 'approval'],
  'upload-classifier': ['document-type-routing', 'project-context', 'approval'],
  'production-coordinator': ['project-status', 'supplier-order-status', 'approval'],
}

const SUPPORT_FINDINGS: Record<string, string> = {
  approval: 'Risky or record-changing work must go through the trusted approval/tool layer.',
  'document-type-routing': 'Route documents from user intent, visible extracted content, structure, and context — not filenames alone.',
  'project-context': 'Confirm the customer/project before attaching, saving, or updating records.',
  'project-status': 'Check saved project readiness before claiming a job is ready to build.',
  supplier: 'Keep supplier documents separate from customer/project files and company pricebook records.',
  'supplier-order-status': 'Check material readiness before production-ready claims.',
  'upload-classifier': 'Classify the upload before deciding where it belongs.',
}

function unique(values: Array<string | undefined | null>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))))
}

function maxRisk(skillIds: string[]): JobroloSkillRisk {
  let risk: JobroloSkillRisk = 'read'
  for (const skillId of skillIds) {
    const skill = getSkillById(skillId)
    const candidate = skill?.riskLevel ?? skill?.risk ?? 'read'
    if (RISK_RANK[candidate] > RISK_RANK[risk]) risk = candidate
  }
  return risk
}

function findPrimarySkill(context: SkillRoutingContext, selectedIds: string[]): string {
  const text = context.normalizedText || ''
  const upload = context.uploadClassification

  if (upload?.route === 'company_pricing') return 'price-list'
  if (upload?.route === 'project_cost') return 'supplier-invoice'
  if (upload?.route === 'project_scope') return 'save-scope'
  if (upload) return 'upload-classifier'

  if (/(ready to build|build ready|ready for production|production ready)/.test(text)) return 'production-coordinator'
  if (/(price\s*(sheet|list)|material prices|supplier pricing|review rows|pending import)/.test(text)) return 'price-list'

  return selectedIds.find(id => !['command-center', 'intent-routing', 'failure-handling'].includes(id)) ?? selectedIds[0] ?? 'command-center'
}

function supportFor(primarySkill: string, selectedIds: string[], context: SkillRoutingContext): string[] {
  const text = context.normalizedText || ''
  const upload = context.uploadClassification

  if (primarySkill === 'price-list' && !upload && /show|list|first\s+\d+|review rows/.test(text)) {
    return []
  }

  const configured = WORKFLOW_SUPPORTS[primarySkill] ?? []
  const selected = selectedIds.filter(id => id !== primarySkill && !['command-center', 'intent-routing', 'failure-handling'].includes(id))
  return unique([...configured, ...selected]).filter(id => Boolean(getSkillById(id)) && id !== primarySkill)
}

function buildConsult(skillId: string, role: 'primary' | 'supporting', confidence: number): SkillConsult {
  const skill = getSkillById(skillId)
  return {
    skillId,
    role,
    finding: role === 'primary'
      ? `${skill?.title ?? skill?.name ?? skillId} owns this workflow.`
      : SUPPORT_FINDINGS[skillId] ?? `${skill?.title ?? skill?.name ?? skillId} should advise only.`,
    confidence,
    suggestedAction: role === 'primary' ? skill?.purpose : undefined,
    requiredContext: skill?.requiredContext,
    approvalNeeded: Boolean(skill?.approvalRequiredFor?.length || (skill?.riskLevel ?? skill?.risk) === 'high'),
    allowedTools: skill?.allowedTools,
    blockedTools: skill?.forbiddenTools,
    userVisible: false,
  }
}

function summarize(primarySkill: string, supportingSkills: string[], context: SkillRoutingContext) {
  const upload = context.uploadClassification
  if (upload) return `${upload.documentType} routed as ${upload.storageScope}. Primary skill: ${primarySkill}. Supporting review: ${supportingSkills.join(', ') || 'none'}.`
  if (primarySkill === 'production-coordinator') return `Production readiness check. Primary skill: production-coordinator. Supporting review: ${supportingSkills.join(', ') || 'none'}.`
  return `Primary skill: ${primarySkill}. Supporting review: ${supportingSkills.join(', ') || 'none'}.`
}

export function orchestrateSkills(
  context: SkillRoutingContext,
  options?: { highComplexity?: boolean; supportLimit?: number },
): SkillOrchestrationPlan {
  const selections = selectSkills(context)
  const selectedIds = selections.map(selection => selection.skill.id)
  const primarySkill = findPrimarySkill(context, selectedIds)
  const requestedSupports = supportFor(primarySkill, selectedIds, context)
  const highComplexity = Boolean(options?.highComplexity)
  const supportLimit = highComplexity ? Math.max(options?.supportLimit ?? SUPPORT_LIMIT, requestedSupports.length) : options?.supportLimit ?? SUPPORT_LIMIT
  const supportingSkills = requestedSupports.slice(0, supportLimit)
  const allSkillIds = unique([primarySkill, ...supportingSkills])
  const riskLevel = maxRisk(allSkillIds)
  const consults = [
    buildConsult(primarySkill, 'primary', selections.find(selection => selection.skill.id === primarySkill)?.confidence ?? 0.8),
    ...supportingSkills.map(skillId => buildConsult(skillId, 'supporting', selections.find(selection => selection.skill.id === skillId)?.confidence ?? 0.72)),
  ]

  const allowedTools = unique(allSkillIds.flatMap(skillId => getSkillById(skillId)?.allowedTools ?? []))
  const blockedTools = unique(allSkillIds.flatMap(skillId => getSkillById(skillId)?.forbiddenTools ?? []))
  const requiredContext = unique(consults.flatMap(consult => consult.requiredContext ?? []))
  const approvalNeeded = consults.some(consult => consult.approvalNeeded) || RISK_RANK[riskLevel] >= RISK_RANK.high
  const summary = summarize(primarySkill, supportingSkills, context)

  return {
    primarySkill,
    supportingSkills,
    consults,
    selectedEntities: {
      customerId: context.activeCustomerId,
      projectId: context.activeProjectId,
      workspaceId: context.activeWorkspaceId,
      documentIds: context.documentIds,
    },
    requiredContext,
    riskLevel,
    approvalNeeded,
    allowedTools,
    blockedTools,
    recommendedAction: summary,
    userFacingSummary: summary,
    highComplexity,
  }
}
