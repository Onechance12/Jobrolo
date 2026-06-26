import { db } from '@/lib/db'
import type { TenantContext, AuthUser } from '@/lib/security/context'

type JobLike = {
  id: string
  contractorId: string
  type: string
  userId: string | null
}

const USER_REQUIRED_JOB_TYPES = new Set(['chat', 'workspace_chat', 'doc_analysis'])

export class JobAuthorizationError extends Error {
  constructor(message = 'Job is not authorized to run') {
    super(message)
  }
}

export function normalizeIdList(value: unknown, limit = 25): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const ids: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    ids.push(trimmed)
    if (ids.length >= limit) break
  }
  return ids
}

export async function resolveJobExecutionContext(job: JobLike): Promise<TenantContext> {
  const contractor = await db.contractor.findFirst({
    where: { id: job.contractorId, status: 'active', deletedAt: null },
    select: { id: true, name: true, company: true, plan: true, subscriptionStatus: true, status: true },
  })
  if (!contractor) throw new JobAuthorizationError('Contractor is not active')

  let user: AuthUser | null = null
  if (job.userId) {
    const actor = await db.user.findFirst({
      where: { id: job.userId, contractorId: job.contractorId, status: 'active', deletedAt: null },
      select: { id: true, contractorId: true, name: true, email: true, role: true, status: true },
    })
    if (!actor) throw new JobAuthorizationError('Job actor is not active')
    user = actor
  } else if (USER_REQUIRED_JOB_TYPES.has(job.type)) {
    throw new JobAuthorizationError('Job actor is required')
  }

  return {
    contractorId: contractor.id,
    contractor,
    user,
    actor: user ? `user:${user.email}` : 'system',
    authMethod: 'system',
  }
}

export async function assertDocumentsBelongToTenant(contractorId: string, documentIds: string[]) {
  const ids = normalizeIdList(documentIds)
  if (ids.length === 0) return []
  const docs = await db.document.findMany({
    where: { contractorId, id: { in: ids } },
    select: {
      id: true,
      originalName: true,
      fileType: true,
      status: true,
      aiSummary: true,
      customerId: true,
      projectId: true,
      workspaceId: true,
    },
  })
  if (docs.length !== ids.length) {
    throw new JobAuthorizationError('One or more documents are not available')
  }
  const byId = new Map(docs.map(doc => [doc.id, doc]))
  return ids.map(id => byId.get(id)!)
}
