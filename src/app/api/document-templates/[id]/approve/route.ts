import { NextRequest, NextResponse } from 'next/server'
import { requireContext } from '@/lib/security/context'
import { approveDocumentTemplate } from '@/lib/template-intake'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const { id } = await params
  try {
    const template = await approveDocumentTemplate(ctx, id)
    return NextResponse.json({ template })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Approval failed' }, { status: 400 })
  }
}
