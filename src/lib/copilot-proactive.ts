import { db } from '@/lib/db'
import type { TenantContext } from '@/lib/security/context'

export type ProactiveTarget = {
  conversationId?: string | null
  workspaceId?: string | null
  chatId?: string | null
  projectId?: string | null
  reason?: string | null
  force?: boolean
}

export type ProactiveMessage = {
  id: string
  role: 'assistant'
  content: string
  contextType: string
  contextData: Record<string, unknown> | null
  createdAt: Date | string
}

type CandidateCard = {
  dedupeKey: string
  content: string
  contextType: string
  contextData: Record<string, unknown>
  priority: number
  windowHours?: number
}

const DEFAULT_WINDOW_HOURS = 12

function normalizeRole(role?: string | null): string {
  const r = String(role || 'owner').toLowerCase()
  if (['owner', 'admin'].includes(r)) return 'owner'
  if (['manager', 'project_manager', 'pm'].includes(r)) return 'project_manager'
  if (['coordinator', 'office'].includes(r)) return 'coordinator'
  if (['accounting', 'bookkeeper', 'finance'].includes(r)) return 'finance'
  if (['crew', 'installer', 'field', 'subcontractor'].includes(r)) return 'crew'
  if (['supplier', 'purchasing', 'vendor'].includes(r)) return 'supplier'
  if (['sales', 'rep'].includes(r)) return 'sales'
  if (['customer', 'homeowner'].includes(r)) return 'customer'
  return r
}

function visibleInboxRoles(role?: string | null): string[] {
  const normalized = normalizeRole(role)
  if (normalized === 'owner') return ['owner', 'management', 'project_manager', 'coordinator', 'finance', 'supplier', 'sales', 'insurance']
  if (normalized === 'project_manager') return ['project_manager', 'coordinator', 'management', 'crew', 'supplier', 'insurance']
  if (normalized === 'coordinator') return ['coordinator', 'project_manager', 'supplier', 'customer', 'insurance']
  if (normalized === 'finance') return ['finance', 'owner']
  if (normalized === 'crew') return ['crew']
  if (normalized === 'supplier') return ['supplier']
  if (normalized === 'sales') return ['sales', 'customer', 'insurance']
  return [normalized]
}

function cardForInboxType(type?: string | null): string {
  const t = String(type || '').toLowerCase()
  if (t.includes('material')) return 'material_request'
  if (t.includes('approval')) return 'approval_request'
  if (t.includes('issue')) return 'action_request'
  if (t.includes('signature')) return 'signature_request'
  if (t.includes('supplier')) return 'supplier_order'
  return 'inbox_item'
}

function dayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10)
}

function safeJson<T = any>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try { return JSON.parse(value) as T } catch { return fallback }
}

async function resolveTarget(ctx: TenantContext, target: ProactiveTarget) {
  if (target.workspaceId) {
    const workspace = await db.workspace.findFirst({
      where: { id: target.workspaceId, contractorId: ctx.contractorId },
      include: {
        project: { select: { id: true, title: true, status: true, priority: true, address: true, customerId: true, customer: { select: { id: true, name: true, phone: true, email: true } } } },
        chats: { select: { id: true, chatType: true, title: true } },
      },
    })
    if (!workspace) throw new Error('Workspace not found')
    const targetChat = target.chatId
      ? workspace.chats.find(c => c.id === target.chatId)
      : workspace.chats.find(c => c.chatType === 'main') ?? workspace.chats[0]
    if (!targetChat) throw new Error('Workspace chat not found')
    return {
      kind: 'workspace' as const,
      workspace,
      chatId: targetChat.id,
      projectId: target.projectId ?? workspace.projectId ?? workspace.project?.id ?? null,
      conversationId: null,
    }
  }

  let conversationId = target.conversationId ?? null
  if (conversationId) {
    const existing = await db.conversation.findFirst({ where: { id: conversationId, contractorId: ctx.contractorId }, select: { id: true } })
    if (!existing) conversationId = null
  }
  if (!conversationId) {
    const latest = await db.conversation.findFirst({ where: { contractorId: ctx.contractorId }, orderBy: { updatedAt: 'desc' }, select: { id: true } })
    if (latest) conversationId = latest.id
  }
  if (!conversationId) {
    const created = await db.conversation.create({ data: { contractorId: ctx.contractorId, title: 'Jobrolo Operator' } })
    conversationId = created.id
  }
  return { kind: 'global' as const, conversationId, workspace: null, chatId: null, projectId: target.projectId ?? null }
}

async function wasPosted(target: Awaited<ReturnType<typeof resolveTarget>>, dedupeKey: string, windowHours: number): Promise<boolean> {
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000)
  const needle = `"dedupeKey":"${dedupeKey}"`
  if (target.kind === 'workspace') {
    const found = await db.workspaceMessage.findFirst({
      where: { chatId: target.chatId, createdAt: { gte: since }, contextData: { contains: needle } },
      select: { id: true },
    })
    return !!found
  }
  const found = await db.message.findFirst({
    where: { conversationId: target.conversationId, createdAt: { gte: since }, contextData: { contains: needle } },
    select: { id: true },
  })
  return !!found
}

async function persistCard(target: Awaited<ReturnType<typeof resolveTarget>>, card: CandidateCard): Promise<ProactiveMessage> {
  const contextData = {
    ...card.contextData,
    cardType: card.contextData.cardType ?? card.contextType,
    dedupeKey: card.dedupeKey,
    source: 'proactive_operator',
    generatedAt: new Date().toISOString(),
  }

  if (target.kind === 'workspace') {
    const msg = await db.workspaceMessage.create({
      data: {
        chatId: target.chatId,
        role: 'assistant',
        content: card.content,
        contextType: card.contextType,
        contextData: JSON.stringify(contextData),
      },
    })
    await db.workspaceChat.update({ where: { id: target.chatId }, data: { lastActivity: new Date() } }).catch(() => {})
    return { id: msg.id, role: 'assistant', content: msg.content, contextType: msg.contextType ?? card.contextType, contextData, createdAt: msg.createdAt }
  }

  const msg = await db.message.create({
    data: {
      conversationId: target.conversationId,
      role: 'assistant',
      content: card.content,
      contextType: card.contextType,
      contextData: JSON.stringify(contextData),
    },
  })
  await db.conversation.update({ where: { id: target.conversationId }, data: { updatedAt: new Date() } }).catch(() => {})
  return { id: msg.id, role: 'assistant', content: msg.content, contextType: msg.contextType ?? card.contextType, contextData, createdAt: msg.createdAt }
}

export async function collectProactiveCards(ctx: TenantContext, target: ProactiveTarget = {}): Promise<CandidateCard[]> {
  const role = normalizeRole(ctx.user?.role)
  const roles = visibleInboxRoles(ctx.user?.role)
  const now = new Date()
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0)
  const endOfTomorrow = new Date(now); endOfTomorrow.setDate(endOfTomorrow.getDate() + 1); endOfTomorrow.setHours(23, 59, 59, 999)
  const projectFilter = target.projectId ? { projectId: target.projectId } : {}

  const cards: CandidateCard[] = []

  const inboxItems = await db.inboxItem.findMany({
    where: {
      contractorId: ctx.contractorId,
      status: { in: ['unread', 'pending'] },
      ...projectFilter,
      OR: [
        ...(ctx.user?.id ? [{ userId: ctx.user.id }] : []),
        { role: { in: roles } },
      ],
    },
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    take: target.projectId ? 6 : 8,
  })

  for (const item of inboxItems) {
    const cardType = cardForInboxType(item.type)
    cards.push({
      dedupeKey: `inbox:${item.id}`,
      content: item.summary ? `${item.title}\n\n${item.summary}` : item.title,
      contextType: cardType,
      priority: item.priority === 'urgent' ? 100 : item.priority === 'high' ? 90 : 70,
      windowHours: 72,
      contextData: {
        ...item,
        payload: safeJson(item.payloadJson, null),
        cardType,
        roleVisibility: roles,
        mode: 'operator',
      },
    })
  }

  const appointments = await db.appointment.findMany({
    where: {
      contractorId: ctx.contractorId,
      status: { in: ['scheduled', 'planned'] },
      startTime: { gte: new Date(now.getTime() - 60 * 60 * 1000), lte: endOfTomorrow },
      ...projectFilter,
    },
    orderBy: { startTime: 'asc' },
    take: target.projectId ? 3 : 5,
  })

  const projectIds = Array.from(new Set(appointments.map(a => a.projectId).filter(Boolean) as string[]))
  const projects = projectIds.length ? await db.project.findMany({ where: { contractorId: ctx.contractorId, id: { in: projectIds } }, select: { id: true, title: true, address: true, status: true, priority: true, customer: { select: { id: true, name: true, phone: true, email: true } } } }) : []
  const projectMap = new Map(projects.map(p => [p.id, p]))

  for (const appt of appointments) {
    const p: any = appt.projectId ? projectMap.get(appt.projectId) : null
    const when = appt.startTime.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    const soon = appt.startTime.getTime() - now.getTime() < 3 * 60 * 60 * 1000
    cards.push({
      dedupeKey: `appointment:${appt.id}:${dayKey(appt.startTime)}`,
      content: `${soon ? 'Heads up' : 'Upcoming'}: ${appt.title} at ${when}.${p?.title ? ` Job: ${p.title}.` : ''}`,
      contextType: 'schedule_event',
      priority: soon ? 85 : 55,
      windowHours: soon ? 6 : 24,
      contextData: {
        cardType: 'schedule_event',
        appointment: appt,
        project: p,
        mode: appt.type || 'schedule',
        quickActions: quickActionsForAppointment(appt.type),
      },
    })
  }

  const openActionRequests = await db.actionRequest.findMany({
    where: { contractorId: ctx.contractorId, status: { in: ['pending', 'needs_approval', 'routed'] }, ...projectFilter },
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    take: target.projectId ? 4 : 6,
  })
  for (const req of openActionRequests) {
    if (roles.includes(req.requestedRole) || role === 'owner' || (ctx.user?.id && req.createdByUserId === ctx.user.id)) {
      const cardType = cardForInboxType(req.type)
      cards.push({
        dedupeKey: `action:${req.id}`,
        content: req.summary ? `${req.title}\n\n${req.summary}` : req.title,
        contextType: cardType,
        priority: req.priority === 'urgent' ? 100 : req.priority === 'high' ? 90 : 65,
        windowHours: 48,
        contextData: {
          ...req,
          role: req.requestedRole,
          actionRequestId: req.id,
          payload: safeJson(req.payloadJson, null),
          cardType,
          mode: 'operator',
        },
      })
    }
  }

  if (['owner', 'project_manager', 'coordinator', 'sales'].includes(role)) {
    const templateReviews = await db.documentTemplate.findMany({
      where: { contractorId: ctx.contractorId, importedFromUpload: true, reviewStatus: { in: ['uploaded', 'parsed', 'needs_review'] }, status: { not: 'archived' } },
      orderBy: { updatedAt: 'desc' },
      take: 3,
    })
    for (const tmpl of templateReviews) {
      const warnings = safeJson<string[]>(tmpl.parseWarningsJson, [])
      cards.push({
        dedupeKey: `template:${tmpl.id}:${tmpl.reviewStatus}`,
        content: `${tmpl.name} is ready for template review before it is used on customer-facing docs.`,
        contextType: 'template_review',
        priority: 50,
        windowHours: 24,
        contextData: {
          cardType: 'template_review',
          templateId: tmpl.id,
          name: tmpl.name,
          type: tmpl.type,
          status: tmpl.status,
          reviewStatus: tmpl.reviewStatus,
          warnings,
          fieldCount: safeJson<any[]>(tmpl.detectedFieldsJson, []).length,
          clauseCount: safeJson<any[]>(tmpl.clausesJson, []).length,
          signatureFieldCount: safeJson<any[]>(tmpl.signatureFieldsJson, []).length,
          sourceOriginalName: tmpl.sourceOriginalName,
        },
      })
    }
  }


  const roofReports = await db.roofReport.findMany({
    where: { contractorId: ctx.contractorId, status: { in: ['draft', 'ready', 'shared'] }, ...projectFilter },
    include: { photos: true },
    orderBy: { updatedAt: 'desc' },
    take: target.projectId ? 3 : 4,
  })
  for (const report of roofReports) {
    const photoCount = report.photos?.length || 0
    const needsAttention = report.status === 'draft' || photoCount < 3
    if (!needsAttention && !target.projectId) continue
    cards.push({
      dedupeKey: `roof_report:${report.id}:${report.status}:${photoCount}`,
      content: `${report.title} ${report.status === 'draft' ? 'is still a draft' : 'is ready for review'}${photoCount ? ` with ${photoCount} photo${photoCount === 1 ? '' : 's'}` : ' with no photos attached yet'}.`,
      contextType: 'roof_report',
      priority: report.status === 'draft' ? 58 : 48,
      windowHours: 18,
      contextData: {
        cardType: 'roof_report',
        id: report.id,
        reportId: report.id,
        title: report.title,
        status: report.status,
        projectId: report.projectId,
        customerId: report.customerId,
        photoCount,
        printUrl: `/api/roof-reports/${report.id}/print`,
        shareUrl: report.shareToken ? `/reports/share/${report.shareToken}` : null,
      },
    })
  }

  const signatureWhere: any = { contractorId: ctx.contractorId, status: { in: ['pending', 'viewed'] }, ...projectFilter }
  const signatures = await db.signatureRequest.findMany({ where: signatureWhere, orderBy: { createdAt: 'desc' }, take: target.projectId ? 3 : 5 })
  for (const sig of signatures) {
    cards.push({
      dedupeKey: `signature:${sig.id}:${sig.status}`,
      content: `${sig.title} is still pending signature from ${sig.signerName}.`,
      contextType: 'signature_request',
      priority: sig.status === 'viewed' ? 62 : 52,
      windowHours: 24,
      contextData: { ...sig, cardType: 'signature_request', mode: 'signing' },
    })
  }

  const docs = await db.document.findMany({
    where: { contractorId: ctx.contractorId, status: { in: ['needs_ocr', 'pending_review'] }, ...projectFilter },
    orderBy: { createdAt: 'desc' },
    take: target.projectId ? 3 : 5,
  })
  for (const doc of docs) {
    cards.push({
      dedupeKey: `document_review:${doc.id}:${doc.status}`,
      content: `${doc.originalName} needs document review before Jobrolo fully trusts it.`,
      contextType: 'document_review',
      priority: doc.status === 'needs_ocr' ? 64 : 45,
      windowHours: 24,
      contextData: {
        cardType: 'document_review',
        documentId: doc.id,
        name: doc.originalName,
        fileType: doc.fileType,
        status: doc.status,
        aiSummary: doc.aiSummary,
        extractionConfidence: doc.extractionConfidence,
      },
    })
  }

  const insights = await db.insight.findMany({
    where: { contractorId: ctx.contractorId, status: { in: ['needs_attention', 'needs_approval', 'waiting_customer', 'waiting_carrier', 'waiting_internal', 'active'] } },
    orderBy: [{ status: 'asc' }, { confidence: 'desc' }, { createdAt: 'desc' }],
    take: 4,
  })
  for (const insight of insights) {
    cards.push({
      dedupeKey: `insight:${insight.id}:${insight.status}`,
      content: `${insight.title}\n\n${insight.detail}`,
      contextType: 'radar_alert',
      priority: insight.status === 'needs_approval' ? 80 : insight.status === 'needs_attention' ? 78 : 40,
      windowHours: 12,
      contextData: {
        cardType: 'radar_alert',
        id: insight.id,
        type: insight.type,
        title: insight.title,
        detail: insight.detail,
        confidence: insight.confidence,
        source: insight.source,
        sourceId: insight.sourceId,
        sourceName: insight.sourceName,
        status: insight.status,
        resolutionDetail: insight.resolutionDetail,
        resolutionActions: safeJson<string[]>(insight.resolutionActions, []),
      },
    })
  }

  if (!cards.length && !target.projectId) {
    cards.push({
      dedupeKey: `daily_clear:${ctx.user?.id ?? 'system'}:${dayKey(now)}`,
      content: `Good ${partOfDay()}, ${ctx.user?.name?.split(' ')[0] || 'there'}. Nothing urgent is routed to you right now. Tell me what you want to work on, or ask “what needs attention?”`,
      contextType: 'operator_briefing',
      priority: 1,
      windowHours: 20,
      contextData: { cardType: 'operator_briefing', mode: 'daily', role, empty: true },
    })
  }

  return cards.sort((a, b) => b.priority - a.priority).slice(0, target.projectId ? 8 : 10)
}

export async function createProactiveMessages(ctx: TenantContext, targetOptions: ProactiveTarget = {}): Promise<{ conversationId?: string | null; workspaceId?: string | null; chatId?: string | null; messages: ProactiveMessage[] }> {
  const target = await resolveTarget(ctx, targetOptions)
  const cards = await collectProactiveCards(ctx, { ...targetOptions, projectId: targetOptions.projectId ?? target.projectId })
  const created: ProactiveMessage[] = []

  for (const card of cards) {
    const exists = targetOptions.force ? false : await wasPosted(target, card.dedupeKey, card.windowHours ?? DEFAULT_WINDOW_HOURS)
    if (exists) continue
    created.push(await persistCard(target, card))
  }

  return {
    conversationId: target.kind === 'global' ? target.conversationId : null,
    workspaceId: target.kind === 'workspace' ? target.workspace.id : null,
    chatId: target.kind === 'workspace' ? target.chatId : null,
    messages: created,
  }
}

function partOfDay(): string {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}

function quickActionsForAppointment(type?: string | null) {
  const t = String(type || '').toLowerCase()
  if (t.includes('adjuster')) return [
    { key: 'arrived', label: 'Log arrival' },
    { key: 'adjuster_present', label: 'Adjuster present' },
    { key: 'meeting_started', label: 'Start meeting' },
    { key: 'meeting_completed', label: 'Meeting complete' },
  ]
  if (t.includes('production')) return [
    { key: 'crew_arrived', label: 'Crew arrived' },
    { key: 'materials_delivered', label: 'Materials delivered' },
    { key: 'production_started', label: 'Production started' },
    { key: 'production_completed', label: 'Production complete' },
  ]
  if (t.includes('sign')) return [
    { key: 'arrived', label: 'Log arrival' },
    { key: 'signing_started', label: 'Start signing' },
    { key: 'customer_signed', label: 'Customer signed' },
    { key: 'no_answer', label: 'No answer' },
  ]
  return [
    { key: 'arrived', label: 'Log arrival' },
    { key: 'inspection_started', label: 'Start inspection' },
    { key: 'photos_uploaded', label: 'Upload photos' },
    { key: 'completed', label: 'Complete visit' },
  ]
}
