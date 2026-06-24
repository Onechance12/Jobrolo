// =============================================================================
// Prompt Injection Defense
// =============================================================================
// Defense-in-depth for LLM inputs:
//   1. Wrap untrusted content (user messages, document text) with markers
//   2. Detect common injection patterns
//   3. Strip control sequences
//   4. Validate AI outputs against schema before executing actions
// =============================================================================

const INJECTION_PATTERNS = [
  // Direct instruction attempts
  /ignore (all |any )?(previous |prior |above )?instructions/i,
  /disregard (the |all |any )?(previous |prior |above )?(instructions|rules|system)/i,
  /you are (now )?(no longer )?(an? )?(assistant|ai|bot|jobrolo)/i,
  /forget (everything |all )?(you |that you )?(know|were told|learned)/i,
  /new (instructions|rules|system prompt):/i,
  /system prompt/i,
  /reveal (your |the )?(system |instructions? )?prompt/i,
  // Role-hijack
  /pretend (you are|to be)/i,
  /act as (if you are )?(an? )?(admin|root|developer|root|superuser)/i,
  // Data exfiltration
  /send (the |all |any )?(data|secrets|keys|tokens|passwords) (to|via|through)/i,
  /post (this |the )?(message|data) to/i,
  // Tool abuse
  /call (the )?tool/i,
  /execute (the )?following (command|code|sql)/i,
]

const MAX_MESSAGE_LENGTH = 32_000 // hard cap on user message length
const MAX_DOCUMENT_TEXT_FOR_PROMPT = 12_000 // cap on document text injected into prompt

export interface SanitizeResult {
  text: string
  warnings: string[]
  truncated: boolean
}

export function sanitizeUserInput(raw: string): SanitizeResult {
  const warnings: string[] = []
  let text = raw

  // Length cap
  if (text.length > MAX_MESSAGE_LENGTH) {
    text = text.slice(0, MAX_MESSAGE_LENGTH)
    warnings.push(`Input truncated to ${MAX_MESSAGE_LENGTH} chars`)
  }

  // Strip null bytes / control chars (except newline, tab)
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')

  // Detect injection patterns
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      warnings.push(`Potential prompt injection detected: matched /${pattern.source}/`)
    }
  }

  return { text, warnings, truncated: raw.length > MAX_MESSAGE_LENGTH }
}

/**
 * Wrap untrusted content so the LLM is reminded not to obey instructions
 * inside it. This is a defense-in-depth measure, not a guarantee.
 */
export function wrapUntrusted(content: string, source: string): string {
  const capped = content.length > MAX_DOCUMENT_TEXT_FOR_PROMPT
    ? content.slice(0, MAX_DOCUMENT_TEXT_FOR_PROMPT) + '\n[...truncated for length...]'
    : content
  return `<UNTRUSTED_CONTENT source="${source}">\n${capped}\n</UNTRUSTED_CONTENT>`
}

/**
 * Validate that an AI-proposed action conforms to the expected shape.
 * Returns null if valid, error string if invalid.
 */
export function validateAction(action: unknown): string | null {
  if (!action || typeof action !== 'object') return 'Action must be an object'
  const a = action as Record<string, unknown>
  if (typeof a.type !== 'string') return 'Action.type must be a string'

  const ALLOWED_TYPES = ['cross_post', 'memory', 'task', 'task_update', 'note']
  if (!ALLOWED_TYPES.includes(a.type)) return `Action.type '${a.type}' not allowed`

  // cross_post
  if (a.type === 'cross_post') {
    if (typeof a.chatType !== 'string') return 'cross_post requires chatType'
    if (typeof a.message !== 'string' || a.message.length > 5000) return 'cross_post.message must be 1-5000 chars'
    const ALLOWED_CHANNELS = ['main', 'customer', 'crew', 'supplier', 'finance', 'management', 'sales', 'insurance']
    if (!ALLOWED_CHANNELS.includes(a.chatType)) return `cross_post.chatType '${a.chatType}' not allowed`
  }

  // memory
  if (a.type === 'memory') {
    if (typeof a.content !== 'string' || a.content.length > 2000) return 'memory.content must be 1-2000 chars'
    const ALLOWED_CATEGORIES = ['summary', 'decision', 'key_info', 'action_item', 'note', 'customer_request', 'material_decision', 'schedule_change', 'task_update']
    if (typeof a.category !== 'string' || !ALLOWED_CATEGORIES.includes(a.category)) return 'memory.category invalid'
  }

  // task
  if (a.type === 'task') {
    if (typeof a.title !== 'string' || a.title.length > 300) return 'task.title must be 1-300 chars'
    if (a.priority !== undefined && !['low', 'medium', 'high', 'urgent'].includes(a.priority as string)) return 'task.priority invalid'
  }

  // task_update
  if (a.type === 'task_update') {
    if (typeof a.taskId !== 'string') return 'task_update requires taskId'
    if (typeof a.status !== 'string' || !['open', 'in_progress', 'completed', 'cancelled'].includes(a.status)) return 'task_update.status invalid'
  }

  // note
  if (a.type === 'note') {
    if (typeof a.content !== 'string' || a.content.length > 5000) return 'note.content must be 1-5000 chars'
  }

  return null
}

/**
 * Sanitize AI-generated text for display. Strips any control sequences
 * that could affect the client.
 */
export function sanitizeAIOutput(text: string): string {
  // Strip null bytes and control chars (keep \n, \t)
  let out = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
  // Cap length
  if (out.length > 10_000) out = out.slice(0, 10_000) + '\n[...truncated...]'
  return out
}
