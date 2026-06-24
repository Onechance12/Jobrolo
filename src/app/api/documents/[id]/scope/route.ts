import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireContext } from '@/lib/security/context'
import { getScopeBreakdown, toggleLineByNumber } from '@/lib/scope-manager'
export const runtime = 'nodejs'

// GET /api/documents/[id]/scope — get the full scope breakdown
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const { id } = await params

  const doc = await db.document.findUnique({ where: { id }, select: { contractorId: true } })
  if (!doc || doc.contractorId !== ctx.contractorId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const breakdown = await getScopeBreakdown(id, ctx.contractorId)
  if (!breakdown) {
    return NextResponse.json({ error: 'No line items found in this document' }, { status: 404 })
  }

  return NextResponse.json({ breakdown })
}

// PUT /api/documents/[id]/scope — toggle a line item
// Body: { lineNumber: "5", selected: false, reason: "Not doing the fence" }
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const { id } = await params

  const { lineNumber, selected, reason } = await req.json()
  if (!lineNumber) return NextResponse.json({ error: 'lineNumber required' }, { status: 400 })

  const breakdown = await toggleLineByNumber(id, ctx.contractorId, String(lineNumber), selected, reason)
  if (!breakdown) {
    return NextResponse.json({ error: 'Could not toggle line item' }, { status: 400 })
  }

  return NextResponse.json({ breakdown })
}
