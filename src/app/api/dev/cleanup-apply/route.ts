import { NextRequest, NextResponse } from 'next/server'
import { requireDevBridge, safeText } from '@/lib/dev-bridge'
import { applyDevCleanup, type DevCleanupAction } from '@/lib/dev-cleanup'
import { checkBodySize } from '@/lib/security/body-size'

export const runtime = 'nodejs'

const ACTIONS = new Set<DevCleanupAction>([
  'move_price_sheet_to_company_pricing',
  'move_company_asset_to_profile_scope',
  'mark_stale_processing_document_needs_review',
])

export async function POST(req: NextRequest) {
  const unauthorized = requireDevBridge(req)
  if (unauthorized) return unauthorized

  const sizeErr = checkBodySize(req, 128 * 1024)
  if (sizeErr) return sizeErr

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Expected JSON object.' }, { status: 400 })
  }

  const record = body as Record<string, unknown>
  const action = safeText(record.action, 120) as DevCleanupAction
  const documentId = safeText(record.documentId, 200)
  const confirm = record.confirm === true || record.confirm === 'true'

  if (!ACTIONS.has(action)) return NextResponse.json({ error: 'Valid action is required.' }, { status: 400 })
  if (!documentId) return NextResponse.json({ error: 'documentId is required.' }, { status: 400 })
  if (!confirm) {
    return NextResponse.json({
      error: 'confirm=true is required.',
      hint: 'Run cleanup-dry first. This endpoint mutates document routing/status only for matching cleanup candidates.',
    }, { status: 400 })
  }

  const result = await applyDevCleanup({ action, documentId, actor: 'dev:cody-bridge' })
  if (!result) {
    return NextResponse.json({
      error: 'No matching cleanup candidate found.',
      hint: 'Run /api/dev/cleanup-candidates first, or confirm this record is still a valid cleanup candidate.',
    }, { status: 404 })
  }

  return NextResponse.json({
    status: 'ok',
    note: 'Cleanup applied. File was not deleted and extracted content was not changed.',
    result,
  })
}
