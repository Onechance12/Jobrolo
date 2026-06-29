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
  'production-coordinator': ['project-status', 'material-ordering', 'job-cost', 'approval'],
  'job-cost': ['project-context', 'supplier-invoice', 'approval'],
  'invoice': ['project-context', 'job-cost', 'approval'],
  'labor-cost': ['project-context', 'job-cost', 'approval'],
  'commission': ['project-context', 'job-cost', 'approval'],
  'material-ordering': ['supplier', 'project-context', 'approval'],
  'lead-intake': ['entity-resolver', 'appointment-scheduling', 'activity-timeline'],
  'appointment-scheduling': ['entity-resolver', 'project-context', 'communication-routing'],
  'photo-evidence': ['file-attachment', 'project-context', 'activity-timeline'],
  'roof-report': ['photo-evidence', 'project-context', 'approval'],
  'communication-routing': ['role-permissions', 'approval'],
  'role-permissions': ['approval'],
  'integration-provider': ['failure-handling'],
  'bid-quote': ['entity-resolver', 'price-list', 'job-cost'],
}

const SUPPORT_FINDINGS: Record<string, string> = {
  'activity-timeline': 'Use saved activity/history to separate completed, pending, failed, and recommended next actions.',
  approval: 'Risky or record-changing work must go through the trusted approval/tool layer.',
  'appointment-scheduling': 'Separate future calendar scheduling from active field inspections.',
  'communication-routing': 'Treat chat creation, copyable links, invites, and SMS/email sends as separate actions.',
  'document-type-routing': 'Route documents from user intent, visible extracted content, structure, and context — not filenames alone.',
  'entity-resolver': 'Resolve the customer, project, lead, or property before record-changing actions.',
  'file-attachment': 'Attach files/photos using real IDs and the correct company/customer/project/report context.',
  'integration-provider': 'Check provider readiness before claiming live outside-world access.',
  'photo-evidence': 'Preserve photo section, GPS, damage type, and report usage context.',
  'project-context': 'Confirm the customer/project before attaching, saving, or updating records.',
  'project-status': 'Check saved project readiness before claiming a job is ready to build.',
  'role-permissions': 'Protect visibility and role boundaries before invites, sharing, or external access.',
  supplier: 'Keep supplier documents separate from customer/project files and company pricebook records.',
  'material-ordering': 'Check material order, delivery, and supplier readiness before production-ready claims.',
  'job-cost': 'Use the project financial truth sheet for revenue, costs, payments, commissions, and margin.',
  invoice: 'Separate customer invoices/payments from supplier invoices/job costs.',
  'labor-cost': 'Treat labor/sub cost as internal job-cost truth with source evidence.',
  commission: 'Calculate commission from saved rules and approved financial entries only.',
  'upload-classifier': 'Classify the upload before deciding where it belongs.',
  'brain-stem': 'Use situational brain signals for safer routing and tone without overriding saved database truth.',
}

const PRIMARY_RECOMMENDATIONS: Record<string, string> = {
  'bid-quote': 'Resolve customer/project first, then draft the bid from saved scope, price-list context, labor assumptions, and margin gaps. Do not start inspection/report workflows unless the user changes lanes.',
  commission: 'Read the project financial truth sheet first. Commission is internal-only and should stay estimated until the compensation rule, revenue basis, collections, and job-cost inputs are known.',
  invoice: 'Use the project financial truth sheet before answering. Separate customer invoices/payments from supplier invoices/job costs, and require approval before creating or sending customer-facing payment records.',
  'job-cost': 'Use get_project_financial_summary first. Treat ProjectFinancialEntry rows as the money truth and documents as evidence; show missing contract, cost, payment, or commission inputs before calling margin final.',
  'labor-cost': 'Resolve the project and source evidence, then treat labor/subcontractor amounts as internal job-cost truth. Separate quoted, approved, invoiced, and paid states.',
  'material-ordering': 'Use saved supplier/order/delivery evidence first. If supplier APIs are not configured, say so and offer a manual check instead of pretending live status.',
  'production-coordinator': 'Check project status, material readiness, financial/job-cost completeness, and approvals before saying a job is ready to build.',
  'supplier-invoice': 'Classify supplier invoices/delivery tickets as project-level cost or delivery evidence. Do not import them into company pricing unless the user explicitly confirms reusable price-list intent.',
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
  const intentPrimary = context.requestIntent?.primarySkill

  if (intentPrimary && getSkillById(intentPrimary)) return intentPrimary

  if (upload?.route === 'company_pricing') return 'price-list'
  if (upload?.route === 'project_cost') return 'supplier-invoice'
  if (upload?.route === 'project_scope') return 'save-scope'
  if (upload) return 'upload-classifier'

  if (/(ready to build|build ready|ready for production|production ready)/.test(text)) return 'production-coordinator'
  if (/(job\s*cost|project financial|margin|gross profit|profit|cost to build|what did we make)/.test(text)) return 'job-cost'
  if (/(customer invoice|unpaid invoice|balance due|payment request|record payment|accounts receivable|collect payment)/.test(text)) return 'invoice'
  if (/(labor cost|subcontractor cost|crew cost|installer pay|labor invoice|sub invoice)/.test(text)) return 'labor-cost'
  if (/(commission|sales rep payout|rep pay|sales split)/.test(text)) return 'commission'
  if (/(material order|order status|delivery status|material drop|backorder|substitution)/.test(text)) return 'material-ordering'
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
  const intentSupports = context.requestIntent?.supportingSkills ?? []
  const selected = selectedIds.filter(id => id !== primarySkill && !['command-center', 'intent-routing', 'failure-handling'].includes(id))
  const ordered = primarySkill === 'bid-quote'
    ? [...configured, ...intentSupports, ...selected]
    : [...intentSupports, ...configured, ...selected]
  return unique(ordered).filter(id => Boolean(getSkillById(id)) && id !== primarySkill)
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
  const primaryRecommendation = PRIMARY_RECOMMENDATIONS[primarySkill]
  if (context.requestIntent?.id !== 'general') {
    return `${context.requestIntent?.summary} ${primaryRecommendation ?? `Primary skill: ${primarySkill}.`} Supporting review: ${supportingSkills.join(', ') || 'none'}.`
  }
  if (primaryRecommendation) return `${primaryRecommendation} Supporting review: ${supportingSkills.join(', ') || 'none'}.`
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

  const allowedTools = unique([
    ...(context.requestIntent?.allowedTools ?? []),
    ...allSkillIds.flatMap(skillId => getSkillById(skillId)?.allowedTools ?? []),
  ])
  const blockedTools = unique([
    ...(context.requestIntent?.blockedTools ?? []),
    ...allSkillIds.flatMap(skillId => getSkillById(skillId)?.forbiddenTools ?? []),
  ])
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
