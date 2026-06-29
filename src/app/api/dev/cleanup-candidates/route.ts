import { NextRequest, NextResponse } from 'next/server'
import { boundedLimit, minutesAgo, requireDevBridge } from '@/lib/dev-bridge'
import { buildDevCleanupCandidates } from '@/lib/dev-cleanup'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const unauthorized = requireDevBridge(req)
  if (unauthorized) return unauthorized

  const url = new URL(req.url)
  const limit = boundedLimit(url.searchParams.get('limit'), 50, 200)
  const staleSince = minutesAgo(url.searchParams.get('staleMinutes'), 30)
  const candidates = await buildDevCleanupCandidates({ limit, staleSince })

  return NextResponse.json({
    status: 'ok',
    dryRun: true,
    note: 'Read-only cleanup candidate scan. This does not mutate records, move files, or import data.',
    input: {
      limit,
      staleSince: staleSince.toISOString(),
    },
    count: candidates.length,
    candidates,
  })
}
