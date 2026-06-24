import { NextRequest, NextResponse } from 'next/server'
import { requireContext } from '@/lib/security/context'
import { db } from '@/lib/db'
import { createProactiveMessages } from '@/lib/copilot-proactive'

export const runtime = 'nodejs'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const { id: projectId } = await params
  const body = await req.json().catch(() => ({}))

  const project = await db.project.findFirst({ where: { id: projectId, contractorId: ctx.contractorId }, select: { id: true, workspace: { select: { id: true, chats: { select: { id: true, chatType: true } } } } } })
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const mainChat = project.workspace?.chats.find(c => c.chatType === 'main') ?? project.workspace?.chats[0]

  const result = await createProactiveMessages(ctx, {
    projectId,
    workspaceId: body.workspaceId ?? project.workspace?.id ?? null,
    chatId: body.chatId ?? mainChat?.id ?? null,
    reason: body.reason ?? 'project_open',
    force: body.force === true,
  })

  return NextResponse.json(result)
}
