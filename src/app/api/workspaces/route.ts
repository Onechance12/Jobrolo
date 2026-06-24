import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireContext, audit } from '@/lib/security/context'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })

  const ws = await db.workspace.findMany({
    where: { contractorId: ctx.contractorId, status: 'active' },
    include: {
      project: { select: { id: true, title: true, status: true, priority: true, address: true, value: true, customer: { select: { id: true, name: true, phone: true, email: true } } } },
      customer: { select: { id: true, name: true, phone: true, email: true, address: true } },
      subcontractor: { select: { id: true, name: true, company: true, specialty: true, phone: true } },
      chats: { select: { id: true, chatType: true, title: true, lastActivity: true, _count: { select: { messages: true } } }, orderBy: { chatType: 'asc' } },
      memories: { orderBy: { createdAt: 'desc' }, take: 3, select: { id: true, category: true, content: true, createdAt: true } },
    },
    orderBy: { updatedAt: 'desc' },
  })

  return NextResponse.json({
    workspaces: ws.map(w => ({
      id: w.id, name: w.name, type: w.type, description: w.description, color: w.color, status: w.status,
      projectId: w.projectId, customerId: w.customerId, subcontractorId: w.subcontractorId,
      chats: w.chats.map(c => ({ id: c.id, chatType: c.chatType, title: c.title, messageCount: c._count.messages, lastActivity: c.lastActivity })),
      chatCount: w.chats.length,
      project: w.project, customer: w.customer, subcontractor: w.subcontractor,
      recentMemory: w.memories,
    })),
  })
}
