import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireContext } from '@/lib/security/context'
import { checkBodySize } from '@/lib/security/body-size'
import { logProjectActivity, normalizeDate } from '@/lib/field-ops'

const AppointmentSchema = z.object({
  projectId: z.string().optional(),
  customerId: z.string().optional(),
  title: z.string().min(1).max(200),
  type: z.string().default('inspection'),
  status: z.string().default('scheduled'),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  location: z.string().max(500).optional(),
  notes: z.string().max(5000).optional(),
  attendees: z.unknown().optional(),
  externalProvider: z.string().optional(),
  externalEventId: z.string().optional(),
})

export async function GET(req: NextRequest) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const projectId = searchParams.get('projectId') ?? undefined
  const customerId = searchParams.get('customerId') ?? undefined
  const type = searchParams.get('type') ?? undefined
  const status = searchParams.get('status') ?? undefined
  const from = normalizeDate(searchParams.get('from'))
  const to = normalizeDate(searchParams.get('to'))

  const appointments = await db.appointment.findMany({
    where: {
      contractorId: ctx.contractorId,
      ...(projectId ? { projectId } : {}),
      ...(customerId ? { customerId } : {}),
      ...(type ? { type } : {}),
      ...(status ? { status } : {}),
      ...(from || to ? { startTime: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    },
    orderBy: { startTime: 'asc' },
    take: 250,
  })

  return NextResponse.json({ appointments })
}

export async function POST(req: NextRequest) {
  const sizeErr = checkBodySize(req)
  if (sizeErr) return sizeErr
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })

  const parsed = AppointmentSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const input = parsed.data


  if (!input.projectId && !input.customerId) {
    return NextResponse.json({ error: 'Appointment must be attached to a project or customer' }, { status: 400 })
  }

  const start = new Date(input.startTime)
  const end = new Date(input.endTime)
  if (end <= start) return NextResponse.json({ error: 'endTime must be after startTime' }, { status: 400 })

  if (input.projectId) {
    const project = await db.project.findFirst({ where: { id: input.projectId, contractorId: ctx.contractorId } })
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }
  if (input.customerId) {
    const customer = await db.customer.findFirst({ where: { id: input.customerId, contractorId: ctx.contractorId } })
    if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
  }

  const appointment = await db.appointment.create({
    data: {
      contractorId: ctx.contractorId,
      projectId: input.projectId,
      customerId: input.customerId,
      title: input.title,
      type: input.type,
      status: input.status,
      startTime: start,
      endTime: end,
      location: input.location,
      notes: input.notes,
      attendeesJson: input.attendees ? JSON.stringify(input.attendees) : undefined,
      createdById: ctx.user?.id,
      externalProvider: input.externalProvider,
      externalEventId: input.externalEventId,
    },
  })

  if (input.projectId) {
    await logProjectActivity({
      contractorId: ctx.contractorId,
      projectId: input.projectId,
      userId: ctx.user?.id,
      activityType: 'APPOINTMENT_SCHEDULED',
      title: `${input.title} scheduled`,
      body: `${input.type} on ${start.toLocaleString()}`,
      relatedType: 'appointment',
      relatedId: appointment.id,
      metadata: { appointmentId: appointment.id, type: input.type },
    })
  }

  return NextResponse.json({ appointment }, { status: 201 })
}
