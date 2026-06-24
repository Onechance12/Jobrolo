// =============================================================================
// Memory Service v2 — layered memory: Customer / Project / Contractor / Agent
// Each layer has typed categories, importance scoring, and source tracking.
// =============================================================================

import { db } from '@/lib/db'

// ---------------------------------------------------------------------------
// Customer Memory
// ---------------------------------------------------------------------------

export async function addCustomerMemory(args: {
  contractorId: string
  customerId: string
  category: 'preference' | 'history' | 'complaint' | 'compliment' | 'lifecycle' | 'contact_note'
  content: string
  source?: 'ai' | 'user' | 'system' | 'import'
  importance?: number // 1-10
  metadata?: Record<string, unknown>
}) {
  return db.customerMemory.create({
    data: {
      contractorId: args.contractorId,
      customerId: args.customerId,
      category: args.category,
      content: args.content.slice(0, 2000),
      source: args.source ?? 'ai',
      importance: args.importance ?? 5,
      metadataJson: args.metadata ? JSON.stringify(args.metadata) : null,
    },
  })
}

export async function getCustomerMemory(contractorId: string, customerId: string, limit = 30) {
  // Verify ownership
  const customer = await db.customer.findUnique({ where: { id: customerId }, select: { contractorId: true } })
  if (!customer || customer.contractorId !== contractorId) return []
  return db.customerMemory.findMany({
    where: { contractorId, customerId },
    orderBy: [{ importance: 'desc' }, { createdAt: 'desc' }],
    take: limit,
  })
}

// ---------------------------------------------------------------------------
// Project Memory
// ---------------------------------------------------------------------------

export async function addProjectMemory(args: {
  contractorId: string
  projectId: string
  category: 'decision' | 'milestone' | 'issue' | 'material' | 'schedule' | 'financial' | 'scope'
  content: string
  source?: 'ai' | 'user' | 'system' | 'import'
  importance?: number
  metadata?: Record<string, unknown>
}) {
  return db.projectMemory.create({
    data: {
      contractorId: args.contractorId,
      projectId: args.projectId,
      category: args.category,
      content: args.content.slice(0, 2000),
      source: args.source ?? 'ai',
      importance: args.importance ?? 5,
      metadataJson: args.metadata ? JSON.stringify(args.metadata) : null,
    },
  })
}

export async function getProjectMemory(contractorId: string, projectId: string, limit = 50) {
  const project = await db.project.findUnique({ where: { id: projectId }, select: { contractorId: true } })
  if (!project || project.contractorId !== contractorId) return []
  return db.projectMemory.findMany({
    where: { contractorId, projectId },
    orderBy: [{ importance: 'desc' }, { createdAt: 'desc' }],
    take: limit,
  })
}

// ---------------------------------------------------------------------------
// Contractor Memory (company-wide intelligence)
// ---------------------------------------------------------------------------

export async function addContractorMemory(args: {
  contractorId: string
  category: 'policy' | 'preference' | 'pricing_rule' | 'vendor_relation' | 'lesson' | 'default'
  content: string
  source?: 'ai' | 'user' | 'system'
  metadata?: Record<string, unknown>
}) {
  return db.contractorMemory.create({
    data: {
      contractorId: args.contractorId,
      category: args.category,
      content: args.content.slice(0, 2000),
      source: args.source ?? 'ai',
      metadataJson: args.metadata ? JSON.stringify(args.metadata) : null,
    },
  })
}

export async function getContractorMemory(contractorId: string, category?: string, limit = 50) {
  return db.contractorMemory.findMany({
    where: { contractorId, ...(category ? { category } : {}) },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
}

// ---------------------------------------------------------------------------
// Agent Lessons (self-improvement)
// ---------------------------------------------------------------------------

export async function recordLesson(args: {
  contractorId: string
  agentName: string
  lessonType: 'success' | 'failure' | 'pattern' | 'preference' | 'correction'
  trigger: string
  action: string
  outcome: string
  correction?: string
  metadata?: Record<string, unknown>
}) {
  return db.agentLesson.create({
    data: {
      contractorId: args.contractorId,
      agentName: args.agentName,
      lessonType: args.lessonType,
      trigger: args.trigger.slice(0, 500),
      action: args.action.slice(0, 500),
      outcome: args.outcome.slice(0, 500),
      correction: args.correction?.slice(0, 500),
      metadataJson: args.metadata ? JSON.stringify(args.metadata) : null,
    },
  })
}

export async function getLessons(contractorId: string, agentName?: string, limit = 20) {
  return db.agentLesson.findMany({
    where: { contractorId, ...(agentName ? { agentName } : {}) },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
}

// ---------------------------------------------------------------------------
// Conversation Summaries (episodic memory)
// ---------------------------------------------------------------------------

export async function summarizeConversation(contractorId: string, conversationId: string): Promise<void> {
  // Lazy import to avoid circular dep
  const { chatComplete } = await import('@/lib/ai')
  const conversation = await db.conversation.findUnique({
    where: { id: conversationId },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  })
  if (!conversation || conversation.contractorId !== contractorId) return
  if (conversation.messages.length < 6) return // not enough to summarize

  const transcript = conversation.messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n').slice(-8000)
  const summary = await chatComplete([
    { role: 'system', content: 'Summarize this conversation. Return JSON only: {"summary":"2-3 sentences","keyDecisions":["..."],"actionItems":["..."],"participants":["..."]}' },
    { role: 'user', content: transcript },
  ], { temperature: 0.2, maxTokens: 600 }).catch(() => '{}')

  let parsed: any = {}
  try {
    let c = summary.trim()
    if (c.startsWith('```')) c = c.replace(/^```(?:json)?\s*\n?/i, '').replace(/```\s*$/i, '').trim()
    parsed = JSON.parse(c)
  } catch {}

  await db.conversationSummary.create({
    data: {
      contractorId,
      conversationId,
      summary: parsed.summary ?? 'Conversation summary unavailable.',
      keyDecisions: JSON.stringify(parsed.keyDecisions ?? []),
      actionItems: JSON.stringify(parsed.actionItems ?? []),
      participants: JSON.stringify(parsed.participants ?? []),
    },
  })
}

export async function getConversationSummaries(contractorId: string, conversationId: string) {
  return db.conversationSummary.findMany({
    where: { contractorId, conversationId },
    orderBy: { createdAt: 'desc' },
  })
}

// ---------------------------------------------------------------------------
// Unified memory retrieval for agent context
// ---------------------------------------------------------------------------

export async function getRelevantMemory(args: {
  contractorId: string
  customerId?: string
  projectId?: string
  workspaceId?: string
  query?: string // future: vector search
  limit?: number
}): Promise<string> {
  const { contractorId, customerId, projectId, workspaceId, limit = 30 } = args
  const parts: string[] = []

  // Contractor-level (always include)
  const contractorMem = await getContractorMemory(contractorId, undefined, 10)
  if (contractorMem.length > 0) {
    parts.push('COMPANY MEMORY:')
    parts.push(contractorMem.map(m => `- [${m.category}] ${m.content}`).join('\n'))
  }

  // Customer-level
  if (customerId) {
    const customerMem = await getCustomerMemory(contractorId, customerId, 10)
    if (customerMem.length > 0) {
      parts.push('\nCUSTOMER MEMORY:')
      parts.push(customerMem.map(m => `- [${m.category}] ${m.content}`).join('\n'))
    }
  }

  // Project-level
  if (projectId) {
    const projectMem = await getProjectMemory(contractorId, projectId, 15)
    if (projectMem.length > 0) {
      parts.push('\nPROJECT MEMORY:')
      parts.push(projectMem.map(m => `- [${m.category}] ${m.content}`).join('\n'))
    }
  }

  // Workspace memory (existing system, kept for backward compat)
  if (workspaceId) {
    const wsMem = await db.workspaceMemory.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' }, take: 15,
    })
    if (wsMem.length > 0) {
      parts.push('\nWORKSPACE MEMORY:')
      parts.push(wsMem.map(m => `- [${m.category}] ${m.content}`).join('\n'))
    }
  }

  return parts.join('\n').slice(0, 8000)
}
