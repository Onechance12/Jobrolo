import { NextRequest, NextResponse } from 'next/server'
import { checkBodySize } from '@/lib/security/body-size'
import { requireDevBridge, safeText } from '@/lib/dev-bridge'
import { buildDevCleanupDryRun, type DevCleanupAction } from '@/lib/dev-cleanup'

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
  if (!ACTIONS.has(action)) return NextResponse.json({ error: 'Valid action is required.' }, { status: 400 })
  if (!documentId) return NextResponse.json({ error: 'documentId is required.' }, { status: 400 })

  const dryRun = await buildDevCleanupDryRun({ action, documentId })
  if (!dryRun) {
    return NextResponse.json({
      error: 'No matching cleanup candidate found.',
      hint: 'Run /api/dev/cleanup-candidates first, or confirm this record is still a valid cleanup candidate.',
    }, { status: 404 })
  }

  return NextResponse.json({
    status: 'ok',
    note: 'Dry-run only. This endpoint describes the intended cleanup mutation but does not apply it.',
    candidate: dryRun,
  })
}
