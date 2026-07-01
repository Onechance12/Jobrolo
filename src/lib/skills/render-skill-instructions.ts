import { getSkillLabel } from './registry'
import type { JobroloSkill, SkillRoutingContext, SkillSelection } from './types'
import { renderBrainInstructions } from '../brain'
import { buildActiveJobroloContext, renderActiveJobroloContext } from '../jobrolo-context'
import { renderJobroloNextPaths, suggestJobroloNextPaths } from '../next-paths'
import { getSelectedSkillCardContracts } from './card-contracts'
import { getOperatingModelInstruction } from '../operating-models'

// Runtime note: `allowedTools` and `forbiddenTools` are compact prompt guidance today.
// Deterministic guards still live in the upload classifier, agent loop, and tools.
// TODO: add a lightweight runtime validator that compares selected skills against
// requested tool calls before execution, without turning skills into a giant policy engine.

function ruleToText(rule: JobroloSkill['decisionRules'][number]): string {
  if (typeof rule === 'string') return rule
  return `If ${rule.if}, then ${rule.then}.`
}

function selectedOperatingModelInstruction(selections: SkillSelection[], context?: SkillRoutingContext): string {
  const selectedIds = new Set(selections.map(selection => selection.skill.id))
  const text = `${context?.normalizedText ?? ''} ${context?.latestText ?? ''}`.toLowerCase()
  const isPublicAdjusterLane =
    context?.requestIntent?.id === 'public_adjuster_claim'
    || (
      selectedIds.has('insurance-claim')
      && /\b(public adjuster|pa file|pa review|appraisal|carrier appraiser|claim advocate|umpire|acv|payment control)\b/.test(text)
    )

  if (isPublicAdjusterLane) {
    return getOperatingModelInstruction('public_adjuster')
  }

  return ''
}

export function renderSkillInstructions(selections: SkillSelection[], context?: SkillRoutingContext): string {
  if (!selections.length) return ''

  const lines: string[] = [
    'JOBROLO SELECTED SKILLS (compact runtime rules)',
    'Use these selected skills for this turn. Do not dump the full skill library into the answer.',
    'Only claim saved/created/updated/imported/deleted after a successful tool/database result.',
  ]

  if (context?.requestIntent) {
    const intent = context.requestIntent
    lines.push(`INTENT LANE: ${intent.id} (${intent.mode}, confidence ${intent.confidence.toFixed(2)}): ${intent.summary}`)
    if (intent.workflowName) lines.push(`Workflow: ${intent.workflowName}. Sticky=${intent.sticky ? 'yes' : 'no'}. Next step=${intent.nextStep ?? 'answer'}.`)
    for (const rule of intent.laneRules.slice(0, 5)) lines.push(`Lane rule: ${rule}`)
    if (intent.allowedTools?.length) lines.push(`Lane allowed tools: ${intent.allowedTools.join(', ')}`)
    if (intent.blockedTools?.length) lines.push(`Lane blocked tools: ${intent.blockedTools.join(', ')}`)
    if (intent.requiredContext?.length) lines.push(`Lane required context: ${intent.requiredContext.join(', ')}`)
  }

  const operatingModelInstruction = selectedOperatingModelInstruction(selections, context)
  if (operatingModelInstruction) {
    lines.push(`OPERATING MODEL\n${operatingModelInstruction}`)
  }

  if (context?.brain) {
    const brainInstruction = renderBrainInstructions(context.brain)
    if (brainInstruction) lines.push(brainInstruction)
  }

  if (context) {
    const activeContext = buildActiveJobroloContext(context)
    lines.push(renderActiveJobroloContext(activeContext))
    const nextPaths = suggestJobroloNextPaths(context)
    const renderedNextPaths = renderJobroloNextPaths(nextPaths)
    if (renderedNextPaths) lines.push(renderedNextPaths)
  }

  for (const selection of selections) {
    const skill = selection.skill
    const rules = skill.decisionRules.slice(0, 4).map(ruleToText)
    lines.push(`- ${skill.id} (${getSkillLabel(skill)}, confidence ${selection.confidence.toFixed(2)}): ${skill.purpose}`)
    if (selection.reason) lines.push(`  Reason: ${selection.reason}`)
    for (const rule of rules) lines.push(`  Rule: ${rule}`)
    if (skill.allowedTools?.length) lines.push(`  Prefer tools: ${skill.allowedTools.join(', ')}`)
    if (skill.forbiddenTools?.length) lines.push(`  Do not use: ${skill.forbiddenTools.join(', ')}`)
    if (skill.approvalRequiredFor?.length) lines.push(`  Approval required for: ${skill.approvalRequiredFor.join(', ')}`)
    if (skill.output?.cards?.length) lines.push(`  Preferred card surfaces: ${skill.output.cards.join(', ')}`)
  }

  const cardContracts = getSelectedSkillCardContracts(selections)
  if (cardContracts.length) {
    const contractSummary = cardContracts
      .slice(0, 6)
      .map(contract => `${contract.skillId}->${contract.template.id} (${contract.template.glanceLabel})`)
      .join('; ')
    lines.push(`Selected skill card contracts: ${contractSummary}. Prefer returning card/cardType context when tools provide structured payloads; otherwise answer normally with concise prompt pills.`)
    const hasFinancialContract = cardContracts.some(contract => contract.template.family === 'finance' || ['job-cost', 'invoice', 'labor-cost', 'commission', 'estimate-proposal', 'supplier-invoice', 'material-order'].includes(contract.template.id))
    if (hasFinancialContract) {
      lines.push('Financial truth rule: for money, margin, invoice, payment, labor, material, commission, and job-cost answers, use ProjectFinancialEntry/database rows as truth. Treat documents, OCR, photos, scopes, and chat as evidence or candidates until approved into financial entries. Clearly label candidate/estimated numbers and list missing inputs before presenting final profit or margin.')
    }
  }

  if (context?.uploadClassification) {
    const route = context.uploadClassification
    lines.push(`Upload route: ${route.documentType} -> ${route.storageScope}. fileType=${route.fileType}. companyLevel=${route.companyLevel}. needsClarification=${route.needsClarification}. reason=${route.reason}`)
    if (route.evidencePacket) {
      const packet = route.evidencePacket
      const signals = packet.signals.slice(0, 5).map(signal => `${signal.label}=${signal.value ?? signal.kind} (${signal.trust})`).join('; ')
      lines.push(`Evidence intake packet: source=${packet.source}. primaryEvidence=${packet.primaryEvidence}. route=${packet.route}. confidence=${packet.confidence.toFixed(2)}. visibleContent=${packet.visibleContentAvailable ? 'yes' : 'no'}. signals=${signals || 'none'}.`)
      if (packet.location) lines.push(`Evidence location: ${packet.location.latitude}, ${packet.location.longitude}${packet.location.accuracyMeters ? ` ±${Math.round(packet.location.accuracyMeters)}m` : ''}. Treat GPS as evidence, not confirmed customer truth.`)
      if (packet.recommendedQuestion) lines.push(`Evidence next question: ${packet.recommendedQuestion}`)
    }
  }

  return lines.join('\n')
}
