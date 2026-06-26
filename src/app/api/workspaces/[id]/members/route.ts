import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireContext } from '@/lib/security/context'
import { checkBodySize } from '@/lib/security/body-size'
import { createWorkspaceInvite } from '@/lib/invitations/workspace-invites'

const InviteSchema = z.object({
  chatId: z.string().optional().nullable(),
  name: z.string().min(2).max(160),
  email: z.string().email().max(240),
  phone: z.string().max(60).optional().nullable(),
  role: z.enum(['employee', 'manager', 'sales', 'crew', 'subcontractor', 'customer']).default('employee'),
  sendEmail: z.boolean().optional(),
  sendSms: z.boolean().optional(),
  note: z.string().max(1000).optional().nullable(),
})

function canManageMembers(role?: string | null) {
  return ['owner', 'admin', 'manager', 'project_manager'].includes(String(role ?? '').toLowerCase())
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const { id: workspaceId } = await params
  const workspace = await db.workspace.findFirst({
    where: { id: workspaceId, contractorId: ctx.contractorId, status: 'active' },
    select: { id: true },
  })
  if (!workspace) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  const members = await db.workspaceMember.findMany({
    where: { workspaceId },
    include: { user: { select: { id: true, name: true, email: true, phone: true, role: true, status: true, lastLoginAt: true } } },
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json({
    members: members.map(member => ({
      id: member.id,
      role: member.role,
      permissions: member.permissions,
      createdAt: member.createdAt,
      user: member.user,
    })),
  })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sizeErr = checkBodySize(req)
  if (sizeErr) return sizeErr
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  if (!ctx.user || !canManageMembers(ctx.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id: workspaceId } = await params
  const parsed = InviteSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  try {
    const invite = await createWorkspaceInvite(ctx, { workspaceId, ...parsed.data })
    return NextResponse.json({ invite }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Invite failed' }, { status: 400 })
  }
}
