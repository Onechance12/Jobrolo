import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireContext } from '@/lib/security/context'
import { checkBodySize } from '@/lib/security/body-size'
import { updateCanvassingSession } from '@/lib/canvassing'

const PatchSchema = z.object({ status: z.string().optional().nullable(), title: z.string().optional().nullable(), territoryName: z.string().optional().nullable(), notes: z.string().optional().nullable() })

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const { id } = await params
  const session = await db.canvassingSession.findFirst({ where: { id, contractorId: ctx.contractorId } })
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const [leads, activities] = await Promise.all([
    db.canvassingLead.findMany({ where: { contractorId: ctx.contractorId, sessionId: id }, orderBy: { updatedAt: 'desc' }, take: 250 }),
    db.canvassingActivity.findMany({ where: { contractorId: ctx.contractorId, sessionId: id }, orderBy: { createdAt: 'desc' }, take: 250 }),
  ])
  return NextResponse.json({ session, leads, activities })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sizeErr = checkBodySize(req)
  if (sizeErr) return sizeErr
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const { id } = await params
  const parsed = PatchSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const session = await updateCanvassingSession(ctx, id, parsed.data)
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ session })
}
