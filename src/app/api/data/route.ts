import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireContext, audit } from '@/lib/security/context'
import { rateLimit } from '@/lib/security/rate-limit'
import { getOrCreateContractorProfile, publicContractorProfile } from '@/lib/contractor-profile'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) {
    return NextResponse.json({ error: ctx.message }, { status: 401 })
  }

  const [profile, customers, projects, tasks, docs, convos, workspaces, documentTemplates, templateUploads, inboxItems, actionRequests, fieldVisits] = await Promise.all([
    getOrCreateContractorProfile(ctx.contractorId),
    db.customer.findMany({ where: { contractorId: ctx.contractorId }, orderBy: { createdAt: 'desc' }, take: 50 }),
    db.project.findMany({ where: { contractorId: ctx.contractorId }, include: { customer: { select: { id: true, name: true } }, tasks: { where: { status: 'open' } } }, orderBy: { updatedAt: 'desc' }, take: 30 }),
    db.task.findMany({ where: { project: { contractorId: ctx.contractorId } }, include: { project: { select: { id: true, title: true } } }, orderBy: { createdAt: 'desc' }, take: 50 }),
    db.document.findMany({ where: { contractorId: ctx.contractorId }, orderBy: { createdAt: 'desc' }, take: 30 }),
    db.conversation.findMany({ where: { contractorId: ctx.contractorId }, orderBy: { updatedAt: 'desc' }, take: 1, include: { messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { content: true } }, _count: { select: { messages: true } } } }),
    db.workspace.findMany({ where: { contractorId: ctx.contractorId, status: 'active' }, include: { chats: { select: { id: true, chatType: true } }, project: { select: { id: true, title: true, status: true, priority: true, address: true, value: true, customer: { select: { id: true, name: true } } } } } }),
    db.documentTemplate.findMany({ where: { contractorId: ctx.contractorId }, orderBy: { updatedAt: 'desc' }, take: 20 }),
    db.documentTemplateUpload.findMany({ where: { contractorId: ctx.contractorId }, orderBy: { updatedAt: 'desc' }, take: 20 }),
    db.inboxItem.findMany({ where: { contractorId: ctx.contractorId, status: { in: ['unread', 'read'] } }, orderBy: { createdAt: 'desc' }, take: 20 }),
    db.actionRequest.findMany({ where: { contractorId: ctx.contractorId, status: { in: ['pending', 'needs_approval', 'approved'] } }, orderBy: { createdAt: 'desc' }, take: 20 }),
    db.fieldVisit.findMany({ where: { contractorId: ctx.contractorId, status: { in: ['planned', 'en_route', 'arrived', 'started'] } }, orderBy: { updatedAt: 'desc' }, take: 20 }),
  ])

  const businessContext = JSON.stringify({
    contractor: { name: ctx.contractor.name, company: ctx.contractor.company, profile: publicContractorProfile(profile) },
    stats: { projects: projects.length, openTasks: tasks.filter(t => t.status === 'open').length, inboxItems: inboxItems.length, actionRequests: actionRequests.length, activeFieldVisits: fieldVisits.length },
    projects: projects.map(p => ({ id: p.id, title: p.title, status: p.status, priority: p.priority, value: p.value, customerName: p.customer?.name })),
    workspaces: workspaces.map(w => ({ id: w.id, name: w.name, type: w.type, projectId: w.projectId, chats: w.chats.map(ch => ({ id: ch.id, chatType: ch.chatType })) })),
    documents: docs.slice(0, 10).map(d => ({ id: d.id, name: d.originalName, type: d.fileType, summary: d.aiSummary })),
    documentTemplates: documentTemplates.map(t => ({ id: t.id, name: t.name, type: t.type, status: t.status, reviewStatus: t.reviewStatus })),
    templateUploads: templateUploads.map(u => ({ id: u.id, name: u.name, templateType: u.templateType, status: u.status, templateId: u.templateId })),
    fieldCopilot: {
      inboxItems: inboxItems.map(i => ({ id: i.id, role: i.role, type: i.type, title: i.title, status: i.status, priority: i.priority, projectId: i.projectId, actionRequestId: i.actionRequestId })),
      actionRequests: actionRequests.map(a => ({ id: a.id, type: a.type, title: a.title, status: a.status, requestedRole: a.requestedRole, projectId: a.projectId, priority: a.priority })),
      activeFieldVisits: fieldVisits.map(v => ({ id: v.id, type: v.type, status: v.status, projectId: v.projectId, appointmentId: v.appointmentId })),
    },
  })

  return NextResponse.json({
    contractor: { id: ctx.contractor.id, name: ctx.contractor.name, company: ctx.contractor.company, plan: ctx.contractor.plan },
    contractorProfile: publicContractorProfile(profile),
    businessContext,
    conversationId: convos[0]?.id ?? null,
    conversations: convos.map(cv => ({ id: cv.id, title: cv.title, preview: cv.messages[0]?.content?.slice(0, 100) ?? '', messageCount: cv._count.messages, createdAt: cv.createdAt, updatedAt: cv.updatedAt })),
    workspaces: workspaces.map(w => ({ id: w.id, name: w.name, type: w.type, chats: w.chats, project: w.project })),
    customers,
    projects: projects.map(p => ({ id: p.id, title: p.title, status: p.status, priority: p.priority, value: p.value })),
    tasks: tasks.map(t => ({ id: t.id, title: t.title, status: t.status, projectName: t.project?.title })),
    documentTemplates: documentTemplates.map(t => ({ id: t.id, name: t.name, type: t.type, status: t.status, reviewStatus: t.reviewStatus, importedFromUpload: t.importedFromUpload })),
    templateUploads,
    fieldCopilot: { inboxItems, actionRequests, activeFieldVisits: fieldVisits },
  })
}
