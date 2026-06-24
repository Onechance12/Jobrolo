import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireContext } from '@/lib/security/context'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const { id } = await params
  const upload = await db.documentTemplateUpload.findFirst({ where: { id, contractorId: ctx.contractorId } })
  if (!upload) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const template = upload.templateId
    ? await db.documentTemplate.findFirst({ where: { id: upload.templateId, contractorId: ctx.contractorId } })
    : null
  return NextResponse.json({ upload, template })
}
