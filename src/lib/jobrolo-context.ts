import type { SkillRoutingContext } from './skills/types'

export type JobroloActiveContext = {
  hasCustomer: boolean
  hasProject: boolean
  hasWorkspace: boolean
  hasDocuments: boolean
  customerId?: string | null
  projectId?: string | null
  workspaceId?: string | null
  documentIds: string[]
  channelType?: string
  role?: string
  confidence: number
  boundaries: string[]
  summary: string
}

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`
}

export function buildActiveJobroloContext(context: SkillRoutingContext): JobroloActiveContext {
  const documentIds = context.documentIds?.filter(Boolean).slice(0, 20) ?? []
  const hasCustomer = Boolean(context.activeCustomerId)
  const hasProject = Boolean(context.activeProjectId)
  const hasWorkspace = Boolean(context.activeWorkspaceId)
  const hasDocuments = documentIds.length > 0
  const confidence =
    (hasProject ? 0.34 : 0) +
    (hasCustomer ? 0.24 : 0) +
    (hasWorkspace ? 0.18 : 0) +
    (hasDocuments ? 0.14 : 0) +
    (context.channelType ? 0.1 : 0)

  const parts = [
    hasProject ? `project ${context.activeProjectId}` : '',
    hasCustomer ? `customer ${context.activeCustomerId}` : '',
    hasWorkspace ? `workspace ${context.activeWorkspaceId}` : '',
    hasDocuments ? countLabel(documentIds.length, 'document') : '',
    context.channelType ? `${context.channelType} channel` : '',
  ].filter(Boolean)

  const boundaries = [
    'Database records beat chat memory.',
    'The contractor company is never a customer.',
    'Mutation tools need resolved entity IDs, not names or filenames.',
  ]
  if (!hasProject) boundaries.push('Project-level actions must resolve or ask for a project before saving/linking.')
  if (hasDocuments) boundaries.push('Document IDs are references only; they are not extracted document content.')

  return {
    hasCustomer,
    hasProject,
    hasWorkspace,
    hasDocuments,
    customerId: context.activeCustomerId,
    projectId: context.activeProjectId,
    workspaceId: context.activeWorkspaceId,
    documentIds,
    channelType: context.channelType,
    role: context.role,
    confidence: Math.min(1, confidence),
    boundaries,
    summary: parts.length ? `Active context: ${parts.join(', ')}.` : 'No resolved customer/project/workspace context yet.',
  }
}

export function renderActiveJobroloContext(activeContext: JobroloActiveContext) {
  const lines = [activeContext.summary]
  if (activeContext.confidence < 0.5) lines.push('Context confidence is low; ask or resolve before record-changing work.')
  for (const boundary of activeContext.boundaries.slice(0, 4)) lines.push(`Context boundary: ${boundary}`)
  return lines.join('\n')
}
