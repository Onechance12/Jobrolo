import { NextRequest, NextResponse } from 'next/server'
import { requireContext } from '@/lib/security/context'
import { getProjectContext } from '@/lib/project-context'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const { id } = await params
  const context = await getProjectContext(ctx, id)
  if (!context) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(context)
}
