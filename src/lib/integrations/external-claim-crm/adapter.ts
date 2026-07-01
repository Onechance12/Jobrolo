import { classifyPublicAdjusterWorkflow } from '../../operating-models'
import type { ExternalClaimCrmInput, ExternalClaimCrmOpenTask, JobroloClaimPacket } from './types'

function normalizeText(value?: string | null) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function compactNotes(notes?: string[] | null) {
  return (notes ?? [])
    .map(note => normalizeText(note))
    .filter(Boolean)
    .slice(0, 12)
}

function isPastDate(value?: string | null, now = new Date()) {
  if (!value) return false
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return false
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  parsed.setHours(0, 0, 0, 0)
  return parsed.getTime() < today.getTime()
}

function overdueTasks(tasks?: ExternalClaimCrmOpenTask[] | null, now = new Date()) {
  return (tasks ?? []).map(task => ({
    ...task,
    overdue: isPastDate(task.dueDate, now),
  }))
}

function noteTextForWorkflow(input: ExternalClaimCrmInput) {
  return [
    input.status,
    input.recordType,
    input.typeOfLoss,
    ...compactNotes(input.notes),
    ...(input.openTasks ?? []).map(task => `${task.title} ${task.dueDate ?? ''}`),
  ].filter(Boolean).join('\n')
}

function importWarningsFor(input: ExternalClaimCrmInput, packetTasks: ReturnType<typeof overdueTasks>) {
  const warnings: string[] = []
  if (normalizeText(input.recordType).toLowerCase() && normalizeText(input.recordType).toLowerCase() !== 'insurance') {
    warnings.push(`Source record type is ${input.recordType}; confirm this belongs in the public-adjuster/claim workflow.`)
  }
  if (!input.address) warnings.push('Missing property address; create as claim/contact only until property is confirmed.')
  if (!input.claimNumber) warnings.push('Missing claim number.')
  if (!input.carrier) warnings.push('Missing insurance carrier.')
  if (!input.dateOfLoss) warnings.push('Missing date of loss.')
  if (packetTasks.some(task => task.overdue)) warnings.push('One or more source tasks are overdue.')
  return warnings
}

function timelineHintsFor(input: ExternalClaimCrmInput, packetTasks: ReturnType<typeof overdueTasks>) {
  const hints: string[] = []
  if (input.lastActivityDate) hints.push(`Last source activity: ${input.lastActivityDate}.`)
  const status = normalizeText(input.status)
  if (status) hints.push(`Source status: ${status}.`)
  for (const note of compactNotes(input.notes).slice(0, 4)) hints.push(`Source note: ${note}`)
  for (const task of packetTasks.slice(0, 4)) {
    hints.push(`Open task: ${task.title}${task.dueDate ? ` due ${task.dueDate}` : ''}${task.overdue ? ' (overdue)' : ''}.`)
  }
  return hints
}

export function createJobroloClaimPacketFromExternalClaimCrm(input: ExternalClaimCrmInput, options?: { now?: Date }): JobroloClaimPacket {
  const packetTasks = overdueTasks(input.openTasks, options?.now)
  const overdueTasksCount = packetTasks.filter(task => task.overdue).length
  const notesText = noteTextForWorkflow(input)
  const workflow = classifyPublicAdjusterWorkflow({
    status: input.status,
    notesText,
    claimNumber: input.claimNumber,
    policyNumber: input.policyNumber,
    carrier: input.carrier,
    dateOfLoss: input.dateOfLoss,
    deductibleAmount: input.deductibleAmount,
    carrierAdjusterName: input.adjusterName,
    carrierAdjusterPhone: input.adjusterPhone,
    carrierAdjusterEmail: input.adjusterEmail,
    mortgageCompany: input.mortgageCompany,
    paymentsCount: input.payments?.length ?? 0,
    daysInStatus: input.daysInStatus,
    lastClientTouchDays: input.lastClientTouchDays,
    openTasksCount: packetTasks.length,
    overdueTasksCount,
  })

  return {
    sourceSystem: 'external_claim_crm',
    sourceRecordType: input.sourceRecordType ?? 'contact',
    sourceId: input.sourceId,
    operatingModelId: 'public_adjuster',
    customer: {
      name: input.customerName,
    },
    property: {
      address: input.address ?? null,
    },
    claim: {
      carrier: input.carrier ?? null,
      claimNumber: input.claimNumber ?? null,
      policyNumber: input.policyNumber ?? null,
      dateOfLoss: input.dateOfLoss ?? null,
      typeOfLoss: input.typeOfLoss ?? null,
      deductibleAmount: input.deductibleAmount ?? null,
      adjusterName: input.adjusterName ?? null,
      adjusterPhone: input.adjusterPhone ?? null,
      adjusterEmail: input.adjusterEmail ?? null,
      mortgageCompany: input.mortgageCompany ?? null,
    },
    workflow: {
      ...workflow,
      sourceStatus: input.status ?? null,
      sourceRecordTypeName: input.recordType ?? null,
    },
    tasks: packetTasks,
    documents: input.files ?? [],
    payments: input.payments ?? [],
    timelineHints: timelineHintsFor(input, packetTasks),
    importWarnings: importWarningsFor(input, packetTasks),
    codexTestNotes: [
      'Dry-run packet only. Do not mutate the external CRM.',
      'Create Jobrolo customer/project/claim records only through approved Jobrolo import flow.',
      'Keep PA internal notes private unless explicitly shared.',
    ],
  }
}

export function summarizeJobroloClaimPacket(packet: JobroloClaimPacket) {
  const parts = [
    `${packet.customer.name}${packet.property.address ? ` — ${packet.property.address}` : ''}`,
    `Phase: ${packet.workflow.phase}`,
    `Lane: ${packet.workflow.lane} / owner: ${packet.workflow.ownerLane}`,
    `Priority: ${packet.workflow.priority}`,
    `Next: ${packet.workflow.recommendedNextAction}`,
  ]
  if (packet.importWarnings.length) parts.push(`Warnings: ${packet.importWarnings.join(' ')}`)
  return parts.join('\n')
}
