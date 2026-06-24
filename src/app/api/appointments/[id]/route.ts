import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireContext } from '@/lib/security/context'
import { checkBodySize } from '@/lib/security/body-size'

const PatchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  type: z.string().optional(),
  status: z.string().optional(),
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
  location: z.string().max(500).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  attendees: z.unknown().optional(),
})

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const { id } = await params
  const appointment = await db.appointment.findFirst({ where: { id, contractorId: ctx.contractorId } })
  if (!appointment) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ appointment })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sizeErr = checkBodySize(req)
  if (sizeErr) return sizeErr
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const { id } = await params
  const existing = await db.appointment.findFirst({ where: { id, contractorId: ctx.contractorId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = PatchSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const input = parsed.data
  const appointment = await db.appointment.update({
    where: { id },
    data: {
      title: input.title,
      type: input.type,
      status: input.status,
      startTime: input.startTime ? new Date(input.startTime) : undefined,
      endTime: input.endTime ? new Date(input.endTime) : undefined,
      location: input.location,
      notes: input.notes,
      attendeesJson: input.attendees !== undefined ? JSON.stringify(input.attendees) : undefined,
    },
  })
  return NextResponse.json({ appointment })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const { id } = await params
  const existing = await db.appointment.findFirst({ where: { id, contractorId: ctx.contractorId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await db.appointment.update({ where: { id }, data: { status: 'cancelled' } })
  return NextResponse.json({ ok: true })
}
