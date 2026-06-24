import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireContext } from '@/lib/security/context'
import { requireProject } from '@/lib/security/ownership'
import { checkBodySize } from '@/lib/security/body-size'
import { ensureProjectSchedule, logProjectActivity } from '@/lib/field-ops'

const ScheduleSchema = z.object({
  stage: z.string().optional(),
  productionStatus: z.string().optional(),
  scheduledStart: z.string().datetime().nullable().optional(),
  scheduledEnd: z.string().datetime().nullable().optional(),
  crewName: z.string().nullable().optional(),
  materialDeliveryAt: z.string().datetime().nullable().optional(),
  permitStatus: z.string().nullable().optional(),
  weatherHold: z.boolean().optional(),
  notes: z.string().nullable().optional(),
  milestones: z.unknown().optional(),
})

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const { id } = await params
  const project = await requireProject(ctx, id)
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const schedule = await ensureProjectSchedule(ctx, id)
  const appointments = await db.appointment.findMany({ where: { contractorId: ctx.contractorId, projectId: id }, orderBy: { startTime: 'asc' } })
  return NextResponse.json({ project, schedule, appointments })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sizeErr = checkBodySize(req)
  if (sizeErr) return sizeErr
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const { id } = await params
  const project = await requireProject(ctx, id)
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = ScheduleSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const input = parsed.data
  const schedule = await db.projectSchedule.upsert({
    where: { contractorId_projectId: { contractorId: ctx.contractorId, projectId: id } },
    update: {
      stage: input.stage,
      productionStatus: input.productionStatus,
      scheduledStart: input.scheduledStart ? new Date(input.scheduledStart) : input.scheduledStart === null ? null : undefined,
      scheduledEnd: input.scheduledEnd ? new Date(input.scheduledEnd) : input.scheduledEnd === null ? null : undefined,
      crewName: input.crewName,
      materialDeliveryAt: input.materialDeliveryAt ? new Date(input.materialDeliveryAt) : input.materialDeliveryAt === null ? null : undefined,
      permitStatus: input.permitStatus,
      weatherHold: input.weatherHold,
      notes: input.notes,
      milestonesJson: input.milestones !== undefined ? JSON.stringify(input.milestones) : undefined,
    },
    create: {
      contractorId: ctx.contractorId,
      projectId: id,
      stage: input.stage ?? 'lead',
      productionStatus: input.productionStatus ?? 'not_scheduled',
      scheduledStart: input.scheduledStart ? new Date(input.scheduledStart) : undefined,
      scheduledEnd: input.scheduledEnd ? new Date(input.scheduledEnd) : undefined,
      crewName: input.crewName ?? undefined,
      materialDeliveryAt: input.materialDeliveryAt ? new Date(input.materialDeliveryAt) : undefined,
      permitStatus: input.permitStatus ?? undefined,
      weatherHold: input.weatherHold ?? false,
      notes: input.notes ?? undefined,
      milestonesJson: input.milestones !== undefined ? JSON.stringify(input.milestones) : undefined,
    },
  })

  if (input.stage) {
    await db.project.update({ where: { id }, data: { status: input.stage } }).catch(() => null)
  }
  await logProjectActivity({
    contractorId: ctx.contractorId,
    projectId: id,
    userId: ctx.user?.id,
    activityType: 'PROJECT_SCHEDULE_UPDATED',
    title: 'Project schedule updated',
    metadata: input,
  })
  return NextResponse.json({ schedule })
}
