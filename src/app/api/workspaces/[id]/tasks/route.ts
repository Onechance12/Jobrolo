// Workspace tasks — list + create + update.
// SECURITY: All operations require authentication AND workspace ownership verification.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireContext, audit } from '@/lib/security/context'

export const runtime = 'nodejs'

// Allowed task statuses
const ALLOWED_STATUSES = new Set(['open', 'in_progress', 'completed', 'cancelled', 'blocked'])
// Allowed task priorities
const ALLOWED_PRIORITIES = new Set(['low', 'medium', 'high', 'urgent'])

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })

  const { id: workspaceId } = await params

  // SECURITY: Verify workspace belongs to this contractor
  const workspace = await db.workspace.findFirst({
    where: { id: workspaceId, contractorId: ctx.contractorId },
    select: { projectId: true },
  })

  if (!workspace) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const tasks = workspace.projectId
    ? await db.task.findMany({
        where: { projectId: workspace.projectId },
        orderBy: [
          { status: 'asc' },
          { priority: 'desc' },
          { createdAt: 'desc' },
        ],
        take: 100,
      })
    : []

  return NextResponse.json({
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      status: t.status,
      priority: t.priority,
      dueDate: t.dueDate,
      completedAt: t.completedAt,
      createdAt: t.createdAt,
    })),
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })

  const { id: workspaceId } = await params
  const body = await req.json().catch(() => ({}))
  const { title, description, priority, dueDate } = body as {
    title: string
    description?: string
    priority?: string
    dueDate?: string
  }

  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }

  const taskPriority = priority && ALLOWED_PRIORITIES.has(priority) ? priority : 'medium'

  // SECURITY: Verify workspace belongs to this contractor
  const workspace = await db.workspace.findFirst({
    where: { id: workspaceId, contractorId: ctx.contractorId },
    select: { projectId: true },
  })

  if (!workspace?.projectId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // SECURITY: Verify the project also belongs to this contractor (defense in depth)
  const project = await db.project.findFirst({
    where: { id: workspace.projectId, contractorId: ctx.contractorId },
    select: { id: true },
  })
  if (!project) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const task = await db.task.create({
    data: {
      projectId: workspace.projectId,
      title: title.trim(),
      description: description?.trim() || null,
      priority: taskPriority,
      dueDate: dueDate ? new Date(dueDate) : null,
      createdById: ctx.user?.id,
    },
  })

  await audit(ctx, 'task.create', 'Task', task.id, `Task: ${title}`, null, req)

  return NextResponse.json({ task })
}

export async function PATCH(req: NextRequest) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { taskId, status } = body as { taskId: string; status: string }

  if (!taskId || !status) {
    return NextResponse.json(
      { error: 'taskId and status required' },
      { status: 400 }
    )
  }

  if (!ALLOWED_STATUSES.has(status)) {
    return NextResponse.json(
      { error: 'Invalid status' },
      { status: 400 }
    )
  }

  // SECURITY: Verify task belongs to a project owned by this contractor
  // This prevents cross-tenant task updates by raw taskId
  const task = await db.task.findFirst({
    where: {
      id: taskId,
      project: { contractorId: ctx.contractorId },
    },
    select: { id: true, title: true, status: true, projectId: true },
  })

  if (!task) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const updated = await db.task.update({
    where: { id: task.id },
    data: {
      status,
      completedAt: status === 'completed' ? new Date() : null,
    },
  })

  await audit(ctx, 'task.update', 'Task', task.id, `"${task.title}" → ${status}`, { oldStatus: task.status, newStatus: status }, req)

  return NextResponse.json({ task: updated })
}
