import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireContext } from '@/lib/security/context'
import { requireProject } from '@/lib/security/ownership'
import { checkBodySize } from '@/lib/security/body-size'
import { createProjectTimelineEvent, getProjectTimeline } from '@/lib/project-context'

const TimelineEventSchema = z.object({
  eventType: z.string().min(1).max(100),
  title: z.string().min(1).max(240),
  body: z.string().optional(),
  relatedType: z.string().optional(),
  relatedId: z.string().optional(),
  status: z.string().optional(),
  source: z.string().optional(),
  occurredAt: z.string().optional(),
  metadata: z.unknown().optional(),
})

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const { id } = await params
  const url = new URL(req.url)
  const limit = Number(url.searchParams.get('limit') ?? '100')
  const timeline = await getProjectTimeline(id, ctx.contractorId, Number.isFinite(limit) ? limit : 100)
  if (!timeline) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(timeline)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sizeErr = checkBodySize(req)
  if (sizeErr) return sizeErr
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const { id } = await params
  const project = await requireProject(ctx, id)
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = TimelineEventSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const data = parsed.data
  const event = await createProjectTimelineEvent({
    contractorId: ctx.contractorId,
    projectId: id,
    customerId: project.customerId,
    eventType: data.eventType,
    title: data.title,
    body: data.body,
    relatedType: data.relatedType,
    relatedId: data.relatedId,
    source: data.source ?? 'user',
    actorUserId: ctx.user?.id,
    metadata: data.metadata,
    occurredAt: data.occurredAt ? new Date(data.occurredAt) : undefined,
  })
  if (!event) return NextResponse.json({ error: 'Could not create timeline event' }, { status: 400 })
  return NextResponse.json({ event }, { status: 201 })
}
