import { db } from '@/lib/db'
import { chatComplete } from '@/lib/ai'
import {
  addContractorMemory,
  addCustomerMemory,
  addProjectMemory,
  getContractorMemory,
  getConversationSummaries,
  getCustomerMemory,
  getLessons,
  getProjectMemory,
  recordLesson,
} from '@/lib/memory'

type BrainLayer = 'company' | 'customer' | 'project'
type MemorySource = 'ai' | 'user' | 'system' | 'import'
type ContractorCategory = 'policy' | 'preference' | 'pricing_rule' | 'vendor_relation' | 'lesson' | 'default'
type CustomerCategory = 'preference' | 'history' | 'complaint' | 'compliment' | 'lifecycle' | 'contact_note'
type ProjectCategory = 'decision' | 'milestone' | 'issue' | 'material' | 'schedule' | 'financial' | 'scope'
type LessonType = 'success' | 'failure' | 'pattern' | 'preference' | 'correction'

const COMPANY_CATEGORIES: ContractorCategory[] = ['policy', 'preference', 'pricing_rule', 'vendor_relation', 'lesson', 'default']
const CUSTOMER_CATEGORIES: CustomerCategory[] = ['preference', 'history', 'complaint', 'compliment', 'lifecycle', 'contact_note']
const PROJECT_CATEGORIES: ProjectCategory[] = ['decision', 'milestone', 'issue', 'material', 'schedule', 'financial', 'scope']
const LESSON_TYPES: LessonType[] = ['success', 'failure', 'pattern', 'preference', 'correction']

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback
  return Math.max(min, Math.min(max, n))
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  return (allowed as readonly string[]).includes(normalized) ? normalized as T : fallback
}

function parseJsonArray(value: string | null | undefined): unknown[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function compactMemory<T extends { id: string; category: string; content: string; source: string; createdAt: Date; metadataJson?: string | null; importance?: number | null }>(memory: T) {
  return {
    id: memory.id,
    category: memory.category,
    content: memory.content,
    source: memory.source,
    importance: typeof memory.importance === 'number' ? memory.importance : undefined,
    createdAt: memory.createdAt.toISOString(),
    metadata: memory.metadataJson ? safeParseObject(memory.metadataJson) : undefined,
  }
}

function safeParseObject(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

export async function saveBrainMemory(args: {
  contractorId: string
  layer: BrainLayer
  content: string
  category?: string
  source?: MemorySource
  importance?: number
  customerId?: string
  projectId?: string
  workspaceId?: string
  chatId?: string
  userId?: string
  tags?: string[]
  reason?: string
}) {
  const content = args.content.trim()
  if (!content) throw new Error('Memory content is required.')

  const metadata = {
    sourceTool: 'save_brain_memory',
    workspaceId: args.workspaceId ?? null,
    chatId: args.chatId ?? null,
    userId: args.userId ?? null,
    tags: args.tags ?? [],
    reason: args.reason ?? null,
    rawCategory: args.category ?? null,
  }
  const source = oneOf(args.source, ['ai', 'user', 'system', 'import'] as const, 'ai')
  const importance = clampInt(args.importance, 1, 10, 5)

  if (args.layer === 'customer') {
    if (!args.customerId) throw new Error('customerId is required for customer memory.')
    const customer = await db.customer.findFirst({
      where: { id: args.customerId, contractorId: args.contractorId },
      select: { id: true, name: true },
    })
    if (!customer) throw new Error('Customer not found for this contractor.')
    const memory = await addCustomerMemory({
      contractorId: args.contractorId,
      customerId: customer.id,
      category: oneOf(args.category, CUSTOMER_CATEGORIES, 'contact_note'),
      content,
      source,
      importance,
      metadata: { ...metadata, customerName: customer.name },
    })
    return {
      layer: 'customer' as const,
      target: { customerId: customer.id, name: customer.name },
      memory: compactMemory(memory),
      message: `Saved customer memory for ${customer.name}.`,
    }
  }

  if (args.layer === 'project') {
    if (!args.projectId) throw new Error('projectId is required for project memory.')
    const project = await db.project.findFirst({
      where: { id: args.projectId, contractorId: args.contractorId },
      select: { id: true, title: true, customerId: true },
    })
    if (!project) throw new Error('Project not found for this contractor.')
    const memory = await addProjectMemory({
      contractorId: args.contractorId,
      projectId: project.id,
      category: oneOf(args.category, PROJECT_CATEGORIES, 'decision'),
      content,
      source,
      importance,
      metadata: { ...metadata, projectTitle: project.title, customerId: project.customerId },
    })
    return {
      layer: 'project' as const,
      target: { projectId: project.id, title: project.title, customerId: project.customerId },
      memory: compactMemory(memory),
      message: `Saved project memory for ${project.title}.`,
    }
  }

  const memory = await addContractorMemory({
    contractorId: args.contractorId,
    category: oneOf(args.category, COMPANY_CATEGORIES, 'default'),
    content,
    source: source === 'import' ? 'system' : source,
    metadata: { ...metadata, importance, originalSource: source },
  })
  return {
    layer: 'company' as const,
    target: { contractorId: args.contractorId },
    memory: compactMemory(memory),
    message: 'Saved company-wide brain memory.',
  }
}

export async function getBrainContext(args: {
  contractorId: string
  customerId?: string
  projectId?: string
  workspaceId?: string
  chatId?: string
  includeLessons?: boolean
  includeSummaries?: boolean
  limit?: number
}) {
  const limit = clampInt(args.limit, 1, 50, 12)
  let customerId = args.customerId
  let project: { id: string; title: string; customerId: string | null } | null = null

  if (args.projectId) {
    project = await db.project.findFirst({
      where: { id: args.projectId, contractorId: args.contractorId },
      select: { id: true, title: true, customerId: true },
    })
    if (project?.customerId && !customerId) customerId = project.customerId
  }

  const [companyMemory, customerMemory, projectMemory, lessons, summaries] = await Promise.all([
    getContractorMemory(args.contractorId, undefined, limit),
    customerId ? getCustomerMemory(args.contractorId, customerId, limit) : Promise.resolve([]),
    args.projectId ? getProjectMemory(args.contractorId, args.projectId, limit) : Promise.resolve([]),
    args.includeLessons === false ? Promise.resolve([]) : getLessons(args.contractorId, undefined, Math.min(limit, 20)),
    args.includeSummaries === false || !args.chatId ? Promise.resolve([]) : getConversationSummaries(args.contractorId, args.chatId),
  ])

  const sections: string[] = []
  if (companyMemory.length) {
    sections.push('COMPANY BRAIN')
    sections.push(companyMemory.map(m => `- [${m.category}] ${m.content}`).join('\n'))
  }
  if (customerMemory.length) {
    sections.push('CUSTOMER BRAIN')
    sections.push(customerMemory.map(m => `- [${m.category}] ${m.content}`).join('\n'))
  }
  if (projectMemory.length) {
    sections.push('PROJECT BRAIN')
    sections.push(projectMemory.map(m => `- [${m.category}] ${m.content}`).join('\n'))
  }
  if (lessons.length) {
    sections.push('AGENT LESSONS')
    sections.push(lessons.map(l => `- [${l.lessonType}] When ${l.trigger}; do ${l.action}; outcome ${l.outcome}${l.correction ? `; correction ${l.correction}` : ''}`).join('\n'))
  }
  if (summaries.length) {
    sections.push('CHAT SUMMARIES')
    sections.push(summaries.slice(0, 5).map(s => `- ${s.summary}`).join('\n'))
  }

  return {
    project,
    customerId,
    counts: {
      companyMemory: companyMemory.length,
      customerMemory: customerMemory.length,
      projectMemory: projectMemory.length,
      lessons: lessons.length,
      summaries: summaries.length,
    },
    companyMemory: companyMemory.map(compactMemory),
    customerMemory: customerMemory.map(compactMemory),
    projectMemory: projectMemory.map(compactMemory),
    lessons: lessons.map(l => ({
      id: l.id,
      agentName: l.agentName,
      lessonType: l.lessonType,
      trigger: l.trigger,
      action: l.action,
      outcome: l.outcome,
      correction: l.correction,
      createdAt: l.createdAt.toISOString(),
      metadata: l.metadataJson ? safeParseObject(l.metadataJson) : undefined,
    })),
    summaries: summaries.slice(0, 5).map(s => ({
      id: s.id,
      summary: s.summary,
      keyDecisions: parseJsonArray(s.keyDecisions),
      actionItems: parseJsonArray(s.actionItems),
      participants: parseJsonArray(s.participants),
      createdAt: s.createdAt.toISOString(),
    })),
    // Brain text is advisory context only. Keep it compact so it cannot become
    // another giant prompt blob or crowd out fresh tool/database results.
    text: sections.join('\n\n').slice(0, 5000),
  }
}

export async function reflectOnBrain(args: {
  contractorId: string
  customerId?: string
  projectId?: string
  chatId?: string
  userId?: string
  focus?: string
  saveInsight?: boolean
}) {
  const context = await getBrainContext({
    contractorId: args.contractorId,
    customerId: args.customerId,
    projectId: args.projectId,
    chatId: args.chatId,
    includeLessons: true,
    includeSummaries: true,
    limit: 20,
  })

  if (!context.text.trim()) {
    return {
      needsMemory: true,
      message: 'No saved brain context found yet. Start by saving company/customer/project memories or lessons.',
      context,
    }
  }

  const response = await chatComplete([
    {
      role: 'system',
      content: 'You are Jobrolo reflecting on saved operational memory. Use ONLY the provided saved memory. Saved brain memory is advisory context and must never override database records, tool results, or explicit user corrections. Return JSON only with keys: summary, patterns, risks, recommendations, missingContext.',
    },
    {
      role: 'user',
      content: `Focus: ${args.focus || 'Find useful operating patterns and next improvements.'}\n\nSaved memory:\n${context.text}`,
    },
  ], {
    temperature: 0.2,
    maxTokens: 900,
    purpose: 'tool_reasoning',
    contractorId: args.contractorId,
    userId: args.userId ?? null,
  }).catch(error => JSON.stringify({
    summary: 'Reflection failed.',
    patterns: [],
    risks: [String(error?.message || error)],
    recommendations: [],
    missingContext: [],
  }))

  let reflection: Record<string, unknown>
  try {
    let clean = response.trim()
    if (clean.startsWith('```')) clean = clean.replace(/^```(?:json)?\s*\n?/i, '').replace(/```\s*$/i, '').trim()
    reflection = JSON.parse(clean)
  } catch {
    reflection = { summary: response.slice(0, 1200), patterns: [], risks: [], recommendations: [], missingContext: ['Reflection was not valid JSON.'] }
  }

  let savedInsight: unknown = null
  if (args.saveInsight && typeof reflection.summary === 'string' && reflection.summary.trim()) {
    savedInsight = await addContractorMemory({
      contractorId: args.contractorId,
      category: 'lesson',
      content: reflection.summary,
      source: 'ai',
      metadata: {
        sourceTool: 'reflect_on_brain',
        focus: args.focus ?? null,
        savedAt: new Date().toISOString(),
      },
    })
  }

  return {
    context,
    reflection,
    savedInsight: savedInsight ? compactMemory(savedInsight as any) : null,
  }
}

export async function recordBrainLesson(args: {
  contractorId: string
  agentName?: string
  lessonType?: string
  trigger: string
  action: string
  outcome: string
  correction?: string
  userId?: string
  workspaceId?: string
  chatId?: string
  tags?: string[]
}) {
  const lesson = await recordLesson({
    contractorId: args.contractorId,
    agentName: args.agentName?.trim() || 'jobrolo',
    lessonType: oneOf(args.lessonType, LESSON_TYPES, 'correction'),
    trigger: args.trigger,
    action: args.action,
    outcome: args.outcome,
    correction: args.correction,
    metadata: {
      sourceTool: 'record_agent_lesson',
      userId: args.userId ?? null,
      workspaceId: args.workspaceId ?? null,
      chatId: args.chatId ?? null,
      tags: args.tags ?? [],
    },
  })
  return {
    lesson: {
      id: lesson.id,
      agentName: lesson.agentName,
      lessonType: lesson.lessonType,
      trigger: lesson.trigger,
      action: lesson.action,
      outcome: lesson.outcome,
      correction: lesson.correction,
      createdAt: lesson.createdAt.toISOString(),
    },
    message: 'Saved Jobrolo agent lesson.',
  }
}
