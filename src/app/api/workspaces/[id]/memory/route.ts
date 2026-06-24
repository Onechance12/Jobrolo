// Workspace memory — list + create + delete.
// SECURITY: All operations require authentication AND workspace ownership verification.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireContext } from '@/lib/security/context'
import { audit } from '@/lib/security/context'

export const runtime = 'nodejs'

// Allowed memory categories — prevents arbitrary memory poisoning
const ALLOWED_CATEGORIES = new Set([
  'key_info', 'preference', 'project_detail', 'customer_detail',
  'claim_detail', 'system_observation', 'unverified_extraction',
  'user_instruction', 'business_rule', 'task_update', 'fact',
])

// Allowed memory sources
const ALLOWED_SOURCES = new Set(['user', 'ai', 'system', 'document'])

// Max content length to prevent abuse
const MAX_CONTENT_LENGTH = 10000

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })

  const { id: workspaceId } = await params
  const { searchParams } = new URL(req.url)
  const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 200)

  // SECURITY: Verify workspace belongs to this contractor
  const workspace = await db.workspace.findFirst({
    where: { id: workspaceId, contractorId: ctx.contractorId },
    select: { id: true },
  })
  if (!workspace) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const memories = await db.workspaceMemory.findMany({
    where: { workspaceId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  return NextResponse.json({
    memories: memories.map((m) => ({
      id: m.id,
      category: m.category,
      content: m.content,
      metadata: m.metadata ? safeParse(m.metadata) : null,
      source: m.source,
      createdAt: m.createdAt,
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
  const { category, content, metadata, source } = body as {
    category: string
    content: string
    metadata?: unknown
    source?: string
  }

  // Input validation
  if (!category || !content) {
    return NextResponse.json(
      { error: 'category and content are required' },
      { status: 400 }
    )
  }

  if (typeof content !== 'string' || content.length > MAX_CONTENT_LENGTH) {
    return NextResponse.json(
      { error: 'Content too long' },
      { status: 400 }
    )
  }

  if (!ALLOWED_CATEGORIES.has(category)) {
    return NextResponse.json(
      { error: 'Invalid category' },
      { status: 400 }
    )
  }

  const memSource = source && ALLOWED_SOURCES.has(source) ? source : 'user'

  // SECURITY: Verify workspace belongs to this contractor
  const workspace = await db.workspace.findFirst({
    where: { id: workspaceId, contractorId: ctx.contractorId },
    select: { id: true },
  })
  if (!workspace) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Sanitize metadata — only allow plain objects, no prototypes
  let safeMetadata: string | null = null
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    try {
      safeMetadata = JSON.stringify(metadata)
    } catch {
      safeMetadata = null
    }
  }

  const memory = await db.workspaceMemory.create({
    data: {
      workspaceId,
      category,
      content: content.trim(),
      metadata: safeMetadata,
      source: memSource,
      createdById: ctx.user?.id,
    },
  })

  await audit(ctx, 'memory.create', 'WorkspaceMemory', memory.id, `Category: ${category}`, null, req)

  return NextResponse.json({ memory })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })

  const { id: workspaceId } = await params
  const { searchParams } = new URL(req.url)
  const memoryId = searchParams.get('memoryId')

  if (!memoryId) {
    return NextResponse.json({ error: 'memoryId required' }, { status: 400 })
  }

  // SECURITY: Verify workspace belongs to this contractor
  const workspace = await db.workspace.findFirst({
    where: { id: workspaceId, contractorId: ctx.contractorId },
    select: { id: true },
  })
  if (!workspace) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Delete the memory — scoped to workspaceId (which we verified belongs to contractor)
  const result = await db.workspaceMemory.deleteMany({
    where: { id: memoryId, workspaceId },
  })

  if (result.count === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  await audit(ctx, 'memory.delete', 'WorkspaceMemory', memoryId, null, null, req)

  return NextResponse.json({ success: true })
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}
