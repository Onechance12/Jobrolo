// Conservative HTML sanitizer for generated customer-facing documents.
// This is intentionally simple and dependency-free for the MVP. It strips scripts,
// event handlers, javascript: URLs, embedded objects, and dangerous tags before any
// generated/template HTML is rendered publicly or converted into PDFs.

const FORBIDDEN_TAGS = [
  'script', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form', 'input',
  'button', 'textarea', 'select', 'option', 'style', 'svg', 'math', 'canvas', 'video',
  'audio', 'source', 'track', 'applet', 'frame', 'frameset'
]

export function sanitizeHtml(input: string | null | undefined): string {
  let html = String(input || '')
  if (!html.trim()) return '<p>No content.</p>'

  for (const tag of FORBIDDEN_TAGS) {
    const block = new RegExp(`<\\s*${tag}\\b[^>]*>[\\s\\S]*?<\\s*\\/\\s*${tag}\\s*>`, 'gi')
    const self = new RegExp(`<\\s*${tag}\\b[^>]*\\/?\\s*>`, 'gi')
    html = html.replace(block, '').replace(self, '')
  }

  // Remove inline event handlers and dangerous URL attributes.
  html = html
    .replace(/\s+on[a-z0-9_-]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\s+on[a-z0-9_-]+\s*=\s*'[^']*'/gi, '')
    .replace(/\s+on[a-z0-9_-]+\s*=\s*[^\s>]+/gi, '')
    .replace(/\s+(href|src|xlink:href)\s*=\s*"\s*javascript:[^"]*"/gi, ' $1="#"')
    .replace(/\s+(href|src|xlink:href)\s*=\s*'\s*javascript:[^']*'/gi, ' $1="#"')
    .replace(/\s+(href|src|xlink:href)\s*=\s*\s*javascript:[^\s>]+/gi, ' $1="#"')
    .replace(/\s+style\s*=\s*"[^"]*(expression\s*\(|url\s*\(\s*javascript:)[^"]*"/gi, '')
    .replace(/\s+style\s*=\s*'[^']*(expression\s*\(|url\s*\(\s*javascript:)[^']*'/gi, '')

  return html
}

export function sanitizePlainText(input: string | null | undefined): string {
  return String(input || '').replace(/[<>]/g, '').trim()
}
