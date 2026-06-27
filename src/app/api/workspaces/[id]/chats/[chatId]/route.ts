import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { audit, requireContext } from '@/lib/security/context'
import { hasCompanyWideAccess, requireWorkspace, requireWorkspaceChat } from '@/lib/security/ownership'

export const runtime = 'nodejs'

const BLOCKED_DELETE_ROLES = new Set(['customer', 'client', 'homeowner', 'crew', 'subcontractor', 'sub'])
const ADMIN_DELETE_ROLES = new Set(['owner', 'admin', 'manager', 'project_manager', 'project manager', 'pm'])

function canDeleteWorkspaceChat(userRole?: string | null, memberRole?: string | null) {
  const normalizedUserRole = String(userRole ?? '').toLowerCase()
  const normalizedMemberRole = String(memberRole ?? '').toLowerCase()
  if (BLOCKED_DELETE_ROLES.has(normalizedUserRole) || BLOCKED_DELETE_ROLES.has(normalizedMemberRole)) return false
  return ADMIN_DELETE_ROLES.has(normalizedUserRole) || ADMIN_DELETE_ROLES.has(normalizedMemberRole)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; chatId: string }> }) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  if (!ctx.user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  const { id: workspaceId, chatId } = await params
  const workspace = await requireWorkspace(ctx, workspaceId)
  if (!workspace) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const chat = await requireWorkspaceChat(ctx, workspaceId, chatId)
  if (!chat) return NextResponse.json({ error: 'Chat not found' }, { status: 404 })

  const member = hasCompanyWideAccess(ctx)
    ? null
    : await db.workspaceMember.findFirst({
      where: { workspaceId, userId: ctx.user.id },
      select: { role: true },
    })

  if (!canDeleteWorkspaceChat(ctx.user.role, member?.role)) {
    return NextResponse.json({ error: 'Only project/company admins can delete shared chats.' }, { status: 403 })
  }

  if (String(chat.chatType).toLowerCase() === 'main') {
    return NextResponse.json({
      error: 'The main job chat cannot be deleted yet. Delete or archive the job file instead.',
    }, { status: 400 })
  }

  const remainingChats = await db.workspaceChat.findMany({
    where: { workspaceId },
    orderBy: [{ chatType: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, chatType: true, title: true },
  })

  if (remainingChats.length <= 1) {
    return NextResponse.json({
      error: 'This is the last chat in the job file, so it cannot be deleted yet.',
    }, { status: 400 })
  }

  await db.workspaceChat.delete({ where: { id: chat.id } })
  const fallbackChat = remainingChats.find(item => item.id !== chat.id) ?? null

  await audit(ctx, 'delete', 'workspace_chat', chat.id, `Deleted shared chat: ${chat.title ?? chat.chatType}`, {
    workspaceId,
    chatType: chat.chatType,
    title: chat.title ?? null,
    fallbackChatId: fallbackChat?.id ?? null,
  }, req)

  return NextResponse.json({
    ok: true,
    deletedId: chat.id,
    fallbackChatId: fallbackChat?.id ?? null,
  })
}
