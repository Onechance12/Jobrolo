// =============================================================================
// File URL Helper — the ONLY safe way to convert file paths to frontend URLs
// =============================================================================
// SECURITY:
//   - Never returns raw filesystem paths to the frontend
//   - Always returns authenticated /api/storage/... URLs
//   - Handles both legacy public/ paths and new private storage paths
//   - Returns null for invalid/empty paths
// =============================================================================

import path from 'node:path'

/**
 * Convert a stored file path to a safe authenticated URL.
 *
 * Examples:
 *   /home/z/my-project/storage/private/uploads/photos/123-abc.jpg
 *     → /api/storage/photos/123-abc.jpg
 *
 *   /home/z/my-project/public/uploads/docs/456-def.pdf
 *     → /api/storage/docs/456-def.pdf  (legacy path, still served through auth)
 *
 *   null → null
 *   '' → null
 */
export function toFileUrl(filePath: string | null | undefined): string | null {
  if (!filePath || typeof filePath !== 'string') return null

  // Extract the filename and directory from the path
  // The path could be:
  //   .../storage/private/uploads/photos/123-abc.jpg
  //   .../public/uploads/docs/456-def.pdf
  //   /uploads/photos/123-abc.jpg  (relative)

  const normalized = filePath.replace(/\\/g, '/')

  // Remote private object pointers, e.g.
  // r2://bucket/contractors/{id}/documents/{documentId}/original/file.pdf
  // r2://bucket/contractors/{id}/documents/{documentId}/thumb/file.jpg
  const remoteMatch = normalized.match(/^(?:s3|r2):\/\/[^/]+\/.+\/(original|thumb)\/([^/?]+)$/)
  if (remoteMatch) {
    const ext = path.extname(remoteMatch[2]).toLowerCase()
    const dir = remoteMatch[1] === 'thumb'
      ? 'thumbnails'
      : ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif'].includes(ext) ? 'photos' : 'docs'
    return `/api/storage/${dir}/${remoteMatch[2]}`
  }

  // Try to match the uploads directory pattern
  // Matches: .../uploads/{dir}/{filename}
  const match = normalized.match(/\/uploads\/(photos|docs|thumbnails|tts-cache)\/([^/?]+)$/)
  if (match) {
    return `/api/storage/${match[1]}/${match[2]}`
  }

  // If no match, try extracting just the basename as a last resort
  // (but don't expose the full path)
  const basename = path.basename(normalized)
  if (basename && basename.includes('.')) {
    // Guess directory from extension
    const ext = path.extname(basename).toLowerCase()
    const dir = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif'].includes(ext) ? 'photos' : 'docs'
    return `/api/storage/${dir}/${basename}`
  }

  return null
}

/**
 * Convert a thumbnail path to a safe authenticated URL.
 * Same logic as toFileUrl but for thumbnail paths.
 */
export function toThumbnailUrl(thumbPath: string | null | undefined): string | null {
  if (!thumbPath || typeof thumbPath !== 'string') return null
  // Thumbnails are stored in the thumbnails/ directory
  const normalized = thumbPath.replace(/\\/g, '/')
  const remoteMatch = normalized.match(/^(?:s3|r2):\/\/[^/]+\/.+\/thumb\/([^/?]+)$/)
  if (remoteMatch) {
    return `/api/storage/thumbnails/${remoteMatch[1]}`
  }
  const match = normalized.match(/\/uploads\/thumbnails\/([^/?]+)$/)
  if (match) {
    return `/api/storage/thumbnails/${match[1]}`
  }
  // Fallback: try the general path resolver
  return toFileUrl(thumbPath)
}
