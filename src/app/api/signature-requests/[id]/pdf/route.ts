import { NextRequest, NextResponse } from 'next/server'
import { requireContext } from '@/lib/security/context'
import { finalizeSignedDocument } from '@/lib/final-documents'

export const runtime = 'nodejs'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const { id } = await params
  try {
    const result = await finalizeSignedDocument({ contractorId: ctx.contractorId, signatureRequestId: id, actorUserId: ctx.user?.id, postToThread: true })
    return NextResponse.json({ signedPdfDocument: result.pdfDocument, signedPdfUrl: result.pdfUrl, generatedDocument: result.generatedDocument, certificate: result.certificate })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not finalize signed PDF' }, { status: 400 })
  }
}
