import { NextRequest, NextResponse } from 'next/server'
import { requireContext } from '@/lib/security/context'
import { checkBodySize } from '@/lib/security/body-size'
import { createUnsignedDocumentPdf, getSignedDocumentArtifacts } from '@/lib/final-documents'

export const runtime = 'nodejs'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const { id } = await params
  try {
    const artifacts = await getSignedDocumentArtifacts(ctx, id)
    return NextResponse.json({ artifacts })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Document not found' }, { status: 404 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sizeErr = checkBodySize(req)
  if (sizeErr) return sizeErr
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const { id } = await params
  try {
    const result = await createUnsignedDocumentPdf({ ctx, generatedDocumentId: id, postToThread: true })
    return NextResponse.json({ pdfDocument: result.pdfDocument, pdfUrl: result.pdfUrl, generatedDocument: result.generatedDocument })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not create PDF preview' }, { status: 400 })
  }
}
