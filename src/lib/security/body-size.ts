// =============================================================================
// Body Size Guard — prevents oversized JSON requests from causing OOM
// =============================================================================
// Usage at the top of any POST route:
//   const sizeError = checkBodySize(req)
//   if (sizeError) return sizeError
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'

const MAX_JSON_BODY_SIZE = 1024 * 1024 // 1 MB for JSON payloads (files use multipart)

export function checkBodySize(req: NextRequest, maxBytes = MAX_JSON_BODY_SIZE): NextResponse | null {
  const contentLength = req.headers.get('content-length')
  if (!contentLength) return null // No Content-Length header — can't check, let it pass

  const size = parseInt(contentLength, 10)
  if (isNaN(size)) return null

  // Skip multipart/form-data (file uploads) — those have their own size limits
  const contentType = req.headers.get('content-type') ?? ''
  if (contentType.includes('multipart/form-data')) return null

  if (size > maxBytes) {
    return NextResponse.json(
      { error: `Request body too large. Maximum size is ${Math.round(maxBytes / 1024)} KB.` },
      { status: 413 }
    )
  }

  return null
}
