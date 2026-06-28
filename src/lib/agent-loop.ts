// =============================================================================
// Agent Loop v2 — Plan-then-Execute with tool validation, permissioning, retry
// =============================================================================

import { chatComplete, type ChatMessage } from '@/lib/ai'
import { executeTool, getToolDefinitions, isToolAllowedInChannel } from '@/lib/agent/tools-v2'
import { parseAIResponse, type ParsedAIResponse, type ToolCall } from '@/lib/prompts'
import { buildSkillRoutingContext } from '@/lib/skills/context'
import { selectSkills } from '@/lib/skills/select-skill'
import { renderSkillInstructions } from '@/lib/skills/render-skill-instructions'
import type { ChannelType } from '@/lib/types'

export interface AgentIteration {
  iteration: number
  text: string
  toolCalls: ToolCall[]
  toolResults?: Array<{ name: string; success: boolean; data: unknown; error?: string }>
  final: boolean
}

export interface AgentLoopOptions {
  messages: ChatMessage[]
  contractorId: string
  userId?: string
  userRole?: string
  trustedDirectExecution?: boolean
  conversationId?: string
  workspaceId?: string
  chatId?: string
  channelType?: ChannelType
  documentIds?: string[]  // IDs of documents uploaded with the current message
  maxIterations?: number
  onIteration?: (iter: AgentIteration) => void
  isCancelled?: () => Promise<boolean>
}

export interface AgentLoopResult {
  final: ParsedAIResponse
  iterations: AgentIteration[]
  totalToolCalls: number
}

const MAX_RETRIES = 4
const TOOL_NAMES = new Set(getToolDefinitions().map(t => t.name))
const EXECUTABLE_ACTION_TYPES = new Set(['cross_post', 'memory', 'task', 'task_update', 'note'])

const OPERATIONAL_INTENT_PHRASES = [
  'let me search', 'let me check', 'let me look', 'let me find', 'let me retrieve', 'let me get',
  'let me review', 'let me pull', 'let me grab', 'let me fetch', 'let me show', 'let me list', 'let me see',
  'let me first', 'let me help', 'let me process', 'let me save', 'let me create', 'let me update',
  'let me add', 'let me attach', 'let me link', 'let me import', 'let me extract', 'let me upload',
  'let me clear', 'let me proceed', 'let me start', 'let me set up',
  "i'll search", "i'll check", "i'll look", "i'll find", "i'll retrieve", "i'll get", "i'll review",
  "i'll pull", "i'll grab", "i'll fetch", "i'll show", "i'll list", "i'll see", "i'll process",
  "i'll help", "i'll first", "i'll save", "i'll create", "i'll update", "i'll add", "i'll attach",
  "i'll link", "i'll import", "i'll extract", "i'll upload", "i'll clear", "i'll proceed", "i'll now",
  "i'll start", "i'll set up",
  'i will search', 'i will check', 'i will look', 'i will find', 'i will retrieve', 'i will get', 'i will review',
  'i will pull', 'i will grab', 'i will fetch', 'i will show', 'i will first', 'i will help',
  'i will process', 'i will save', 'i will create', 'i will update', 'i will add', 'i will attach',
  'i will link', 'i will import', 'i will extract', 'i will upload', 'i will clear', 'i will proceed',
  'i will start', 'i will set up', 'i will now', 'please hold on', 'one moment', 'checking now', 'searching now', 'looking now',
  "i'm starting", 'i am starting', "i'm setting up", 'i am setting up',
  'starting the', 'starting this', 'starting your', 'setting up', 'setting this up',
  'creating the', 'creating this', 'creating your', 'creating a', 'creating an', 'creating new',
  'saving the', 'saving this', 'saving your', 'saving a', 'saving an',
  'adding the', 'adding this', 'adding your', 'adding a', 'adding an',
  'updating the', 'updating this', 'updating your',
  'linking the', 'linking this', 'linking your',
  'attaching the', 'attaching this', 'attaching your',
  'retrieving the', 'retrieving this', 'retrieving your',
  'reviewing the', 'reviewing this', 'reviewing your',
  'processing the', 'processing this', 'processing your',
  'setting up the', 'setting up this', 'setting up your',
  'fetching your', 'retrieving your', 'pulling up your', 'getting your', 'looking up your',
  'fetching the', 'retrieving the', 'pulling up the', 'getting the', 'looking up the',
  'first, let me', 'first let me',
  'requires approval before', 'requires approval to', 'review and approve', 'approval request',
  'please approve', 'please confirm the deletion request', 'approve the deletion request',
]

const COMPLETION_CLAIM_PHRASES = [
  'i saved', "i've saved", 'saved it', 'has been saved',
  'i created', "i've created", 'has been created',
  'i added', "i've added", 'has been added',
  'i updated', "i've updated", 'has been updated',
  'i attached', "i've attached", 'has been attached',
  'i linked', "i've linked", 'has been linked',
  'i imported', "i've imported", 'has been imported',
  'done', 'completed',
]

function hasOperationalIntent(text: string) {
  const lower = text.toLowerCase()
  return OPERATIONAL_INTENT_PHRASES.some(phrase => lower.includes(phrase))
}

function hasCompletionClaim(text: string) {
  const lower = text.toLowerCase()
  return COMPLETION_CLAIM_PHRASES.some(phrase => lower.includes(phrase))
}

function findNullishIdArg(value: unknown, path = 'args'): string | null {
  if (!value || typeof value !== 'object') return null
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`
    if (/(^id$|id$|Id$)/.test(key) && (child === null || child === undefined || child === '')) {
      return childPath
    }
    const nested = findNullishIdArg(child, childPath)
    if (nested) return nested
  }
  return null
}

function isIdLikeKey(key: string) {
  return /(^id$|id$|Id$)/.test(key)
}

function looksLikePlaceholder(value: string, key: string) {
  const trimmed = value.trim()
  const lower = trimmed.toLowerCase()
  if (!trimmed) return false
  if (/^<[^>]+>$/.test(trimmed)) return true
  if (/\bplaceholder\b/.test(lower)) return true
  if (isIdLikeKey(key)) {
    return (
      lower === 'id' ||
      lower === 'project id' ||
      lower === 'customer id' ||
      lower === 'document id' ||
      lower === "customer's id" ||
      lower.endsWith('_id') ||
      /\b(customer|project|document|scope)\b.*\bid\b/.test(lower)
    )
  }
  if (key === 'rawText') {
    return (
      lower === 'scope information' ||
      lower === 'provided scope information' ||
      lower === 'provided text' ||
      (lower.includes('scope information') && trimmed.length < 120)
    )
  }
  return false
}

function looksLikeDocumentReferenceArg(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (/^[\w ().-]+\.(pdf|docx?|txt|csv|xlsx?|png|jpe?g|webp)$/i.test(trimmed)) return true
  if (/^[a-z0-9_-]{20,}$/i.test(trimmed) && !/\s/.test(trimmed)) return true
  if (/\bdocumentId\b/i.test(trimmed) && trimmed.length < 160) return true
  return false
}

function sanitizeToolArgs(value: unknown, path = 'args'): { value: unknown; removed: string[]; invalid?: string } {
  if (typeof value === 'string') {
    const key = path.split('.').pop() ?? ''
    if (looksLikePlaceholder(value, key)) {
      if (isIdLikeKey(key)) return { value: undefined, removed: [path] }
      return { value, removed: [], invalid: `${path} is a placeholder, not real saved data` }
    }
    return { value, removed: [] }
  }
  if (Array.isArray(value)) {
    const next: unknown[] = []
    const removed: string[] = []
    for (let i = 0; i < value.length; i++) {
      const result = sanitizeToolArgs(value[i], `${path}[${i}]`)
      if (result.invalid) return { value, removed, invalid: result.invalid }
      removed.push(...result.removed)
      if (result.value !== undefined) next.push(result.value)
    }
    return { value: next, removed }
  }
  if (value && typeof value === 'object') {
    const next: Record<string, unknown> = {}
    const removed: string[] = []
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (child === null || child === undefined) {
        removed.push(`${path}.${key}`)
        continue
      }
      if (isIdLikeKey(key) && (child === null || child === undefined || child === '')) {
        removed.push(`${path}.${key}`)
        continue
      }
      const result = sanitizeToolArgs(child, `${path}.${key}`)
      if (result.invalid) return { value, removed, invalid: result.invalid }
      removed.push(...result.removed)
      if (result.value !== undefined) next[key] = result.value
    }
    return { value: next, removed }
  }
  return { value, removed: [] }
}

function actionToToolCall(action: { type: string; [k: string]: unknown }): ToolCall | null {
  if (!TOOL_NAMES.has(action.type)) return null
  const { type, ...args } = action
  return { name: type, args }
}

function normalizeParsedWork(parsed: ParsedAIResponse) {
  const actions = parsed.actions ?? []
  const convertedToolCalls: ToolCall[] = []
  const executableActions: NonNullable<ParsedAIResponse['actions']> = []
  const blockedResults: NonNullable<AgentIteration['toolResults']> = []

  for (const action of actions) {
    const asTool = actionToToolCall(action)
    if (asTool) {
      console.warn(`[agent-loop] converted tool-like action '${action.type}' into tool_call`)
      convertedToolCalls.push(asTool)
      continue
    }
    if (EXECUTABLE_ACTION_TYPES.has(action.type)) {
      executableActions.push(action)
      continue
    }
    blockedResults.push({
      name: action.type || 'unknown_action',
      success: false,
      data: null,
      error: `Unknown action type '${action.type}'. Database/system operations must be sent as tool_calls, not actions.`,
    })
  }

  return { convertedToolCalls, executableActions, blockedResults }
}

function shouldForceToolRetry(parsed: ParsedAIResponse, toolCallCount: number, executableActionCount: number) {
  if (toolCallCount > 0 || executableActionCount > 0) return false
  return hasOperationalIntent(parsed.text) || hasCompletionClaim(parsed.text)
}

function recentPlainMessages(messages: ChatMessage[], limit = 6) {
  const out: string[] = []
  for (let i = messages.length - 1; i >= 0 && out.length < limit; i--) {
    const message = messages[i]
    if (message.role !== 'user' || isInternalAgentInstruction(message.content)) continue
    out.unshift(plainMessageText(message.content))
  }
  return out.join('\n')
}

function recentVisibleChatTurns(messages: ChatMessage[], limit = 12) {
  const out: Array<{ role: 'user' | 'assistant'; text: string }> = []
  for (let i = messages.length - 1; i >= 0 && out.length < limit; i--) {
    const message = messages[i]
    if ((message.role !== 'user' && message.role !== 'assistant') || isInternalAgentInstruction(message.content)) continue
    const text = plainMessageText(message.content).slice(0, 2000)
    if (!text) continue
    out.unshift({ role: message.role, text })
  }
  return out
}

function looksLikeApprovalReplayFailure(text: string) {
  return /approval (?:request|command|options).*(?:could not|failed|error|did not accept|not accepted|cannot be processed|could not be processed)/i.test(text)
    || /system did not accept the approval/i.test(text)
}

function plainMessageText(text: string) {
  return text
    .replace(/<UNTRUSTED_CONTENT[^>]*>/gi, '')
    .replace(/<\/UNTRUSTED_CONTENT>/gi, '')
    .trim()
}

function isInternalAgentInstruction(text: string) {
  const clean = plainMessageText(text)
  return (
    clean.startsWith('You said "') ||
    clean.startsWith('Tool results:') ||
    clean.startsWith('You returned actions, but') ||
    clean.startsWith('The latest user request is') ||
    clean.startsWith('The latest user reply') ||
    clean.startsWith('A recent assistant message asked') ||
    clean.startsWith('The user asked:') ||
    clean.startsWith('Selected Jobrolo skills for this turn:') ||
    clean.startsWith('JOBROLO SELECTED SKILLS') ||
    clean.includes('Common recovery examples:') ||
    clean.includes('Respond as JSON only.')
  )
}

function lastExternalUserMessage(messages: ChatMessage[], beforeIndex = messages.length) {
  for (let i = beforeIndex - 1; i >= 0; i--) {
    const message = messages[i]
    if (message?.role === 'user' && !isInternalAgentInstruction(message.content)) {
      return { index: i, message }
    }
  }
  return null
}

function latestUserText(messages: ChatMessage[]) {
  const latest = lastExternalUserMessage(messages) ?? lastMessageByRole(messages, 'user')
  return latest ? plainMessageText(latest.message.content) : ''
}

function isCompanyProfileReadRequest(text: string) {
  const lower = plainMessageText(text).toLowerCase()
  if (!lower) return false
  if (/\b(update|change|set|save|edit|research|search|look up)\b/.test(lower)) return false
  return (
    /\b(what|show|pull|fetch|view|display|list|see)\b[\s\S]{0,80}\b(my|our|the)?\s*(company|business)\s+(info|information|profile|details)\b/.test(lower) ||
    /\b(my|our)\s+(company|business)\s+(info|information|profile|details)\b/.test(lower) ||
    /\bcompany\s+profile\b/.test(lower)
  )
}

function needsCompanyProfileToolRetry(parsed: ParsedAIResponse, messages: ChatMessage[], toolCallCount: number, executableActionCount: number) {
  if (toolCallCount > 0 || executableActionCount > 0) return false
  const userText = latestUserText(messages)
  if (!isCompanyProfileReadRequest(userText)) return false
  const answer = parsed.text.toLowerCase()
  return (
    answer.includes('fetching') ||
    answer.includes('retrieving') ||
    answer.includes('pulling up') ||
    answer.includes('getting') ||
    answer.includes('checking') ||
    answer.length < 160
  )
}

function isAffirmativeReply(text: string) {
  return /^(yes|yeah|yea|yep|yup|ok|okay|sure|do it|go ahead|proceed|please do|sounds good|that works|correct)(\b|[.!?])?.{0,120}$/i.test(plainMessageText(text))
}

function lastMessageByRole(messages: ChatMessage[], role: ChatMessage['role'], beforeIndex = messages.length) {
  for (let i = beforeIndex - 1; i >= 0; i--) {
    if (messages[i]?.role === role) return { index: i, message: messages[i] }
  }
  return null
}

function cleanCustomerName(raw: string) {
  return raw
    .replace(/'s\s+(customer\s+file|client\s+file|file|profile).*$/i, '')
    .replace(/\s+(customer\s+file|client\s+file|file|profile)\b.*$/i, '')
    .replace(/\b(if so|first|before|using|with|and|also|please|would|should|then)\b.*$/i, '')
    .replace(/^(yes|yeah|yea|yep|yup|ok|okay|sure|correct)\s+/i, '')
    .replace(/["“”]/g, '')
    .replace(/[?.!,;:]+$/g, '')
    .trim()
}

function extractCustomerNameFromReply(text: string) {
  const cleaned = cleanCustomerName(plainMessageText(text))
  const candidate = cleaned
    .replace(/\b(?:customer|client|project|job|file|profile)\b.*$/i, '')
    .trim()
  if (!candidate || candidate.length < 2 || candidate.length > 120) return null
  if (/^(yes|yeah|yea|yep|yup|ok|okay|sure|correct|project|job|chat|file|document)$/i.test(candidate)) return null
  return candidate
}

function extractPendingProjectCustomerName(text: string) {
  const patterns = [
    /creating (?:a |the )?(?:new )?(?:project|job) for ([A-Za-z][^?.\n]+)/i,
    /create (?:a |the )?(?:new )?(?:project|job) for ([A-Za-z][^?.\n]+)/i,
    /create (?:a |the )?(?:new )?(?:project|job) first (?:for|under) ([A-Za-z][^?.\n]+)/i,
    /(?:project|job) first (?:for|under) ([A-Za-z][^?.\n]+)/i,
    /no (?:active )?(?:project|job) (?:created |found )?for ([A-Za-z][^?.\n]+)/i,
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    const name = match?.[1] ? cleanCustomerName(match[1]) : ''
    if (name && name.length <= 120) return name
  }
  return null
}

function extractCustomerNameFromOperationalText(text: string) {
  const clean = plainMessageText(text)
  const patterns = [
    /\b(?:for|to|under)\s+(?:the\s+)?([A-Za-z][A-Za-z0-9 '.-]{1,100}?)(?:\s+(?:file|profile|customer file|client file|project|job|chat|crew|homeowner|customer|client)\b|[?.!,;:]|$)/i,
    /\b([A-Za-z][A-Za-z0-9 '.-]{1,100}?)'?s\s+(?:file|profile|project|job|chat)\b/i,
    /\b(?:customer|client)\s+([A-Za-z][A-Za-z0-9 '.-]{1,100}?)(?:[?.!,;:]|$)/i,
  ]
  for (const pattern of patterns) {
    const match = clean.match(pattern)
    const name = match?.[1] ? cleanCustomerName(match[1]) : ''
    if (name && name.length >= 2 && name.length <= 120 && !/^(project|job|chat|crew|customer|client|file|profile)$/i.test(name)) {
      return name
    }
  }
  return null
}

function extractPendingLinkCustomerName(text: string) {
  const patterns = [
    /(?:link|attach|tie|save).{0,120}\bto\s+([A-Za-z][^?.\n]+)/i,
    /\bto\s+([A-Za-z][^'?.\n]+)'?s\s+(?:file|profile|customer file|client file)/i,
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    const name = match?.[1] ? cleanCustomerName(match[1]) : ''
    if (name && name.length <= 120) return name
  }
  return null
}

function findRecentOperationalCustomerName(messages: ChatMessage[], beforeIndex: number) {
  for (let i = beforeIndex - 1; i >= Math.max(0, beforeIndex - 8); i--) {
    const content = plainMessageText(messages[i]?.content ?? '')
    if (!content) continue
    const fromProjectOffer = extractPendingProjectCustomerName(content)
    if (fromProjectOffer) return fromProjectOffer
    const fromLinkOffer = extractPendingLinkCustomerName(content)
    if (fromLinkOffer) return fromLinkOffer
    const fromOperationalText = extractCustomerNameFromOperationalText(content)
    if (fromOperationalText) return fromOperationalText
  }
  return null
}

function findRecentDocumentReference(messages: ChatMessage[], beforeIndex: number) {
  for (let i = beforeIndex - 1; i >= 0; i--) {
    const content = messages[i]?.content ?? ''
    const documentId =
      content.match(/documentId="([^"]+)"/i)?.[1] ??
      content.match(/\bdocumentId\s*[:=]?\s*([a-z0-9][a-z0-9-]{10,})/i)?.[1] ??
      content.match(/\bdocument\s+id\s*[:=]?\s*([a-z0-9][a-z0-9-]{10,})/i)?.[1]
    const filename =
      content.match(/name="([^"]+)"/i)?.[1] ??
      content.match(/\b([A-Za-z0-9][A-Za-z0-9._ -]{2,}\.(?:pdf|png|jpe?g|heic|webp|docx?|xlsx?|csv))\b/i)?.[1]
    if (documentId || filename) return { documentId, filename }
  }
  return null
}

function findRecentUploadAttachPrompt(messages: ChatMessage[], beforeIndex: number) {
  for (let i = beforeIndex - 1; i >= Math.max(0, beforeIndex - 8); i--) {
    const text = plainMessageText(messages[i]?.content ?? '')
    if (/which customer or project should i attach|which client or project should i attach|attach this upload|which customer or project would you like to attach/i.test(text)) {
      return { index: i, text }
    }
  }
  return null
}

function findRecentRequestedChatType(messages: ChatMessage[], beforeIndex: number) {
  for (let i = beforeIndex - 1; i >= Math.max(0, beforeIndex - 8); i--) {
    const type = inferChatType(messages[i]?.content ?? '')
    if (type) return type
  }
  return null
}

function inferChatType(text: string): string | null {
  const lower = plainMessageText(text).toLowerCase()
  if (/\b(gutter|gutters|downspout|downspouts)\b/.test(lower)) return 'gutter_crew'
  if (/\b(window|windows|screen|screens|glazing)\b/.test(lower)) return 'window_crew'
  if (/\b(siding|soffit|fascia)\b/.test(lower)) return 'siding_crew'
  if (/\b(roofing crew|roofer|roofers|roof crew|install crew|installer|installers)\b/.test(lower)) return 'roofing_crew'
  if (/\b(field crew|repair crew)\b/.test(lower)) return 'field_crew'
  if (/\b(subcontractor|sub contractor|sub\b|trade partner)\b/.test(lower)) return 'subcontractor'
  if (/\b(customer|homeowner|client)\b/.test(lower)) return 'customer'
  if (/\b(crew|roofer|roofing crew|installer|install crew|subcontractor|sub contractor|sub)\b/.test(lower)) return 'crew'
  if (/\bsales\b/.test(lower)) return 'sales'
  if (/\binsurance|adjuster|carrier\b/.test(lower)) return 'insurance'
  if (/\bsupplier|material\b/.test(lower)) return 'supplier'
  if (/\bfinance|billing|invoice\b/.test(lower)) return 'finance'
  if (/\bmanagement|manager|admin\b/.test(lower)) return 'management'
  return null
}

function buildAffirmativeContinuationInstruction(messages: ChatMessage[]) {
  const latestUser = lastMessageByRole(messages, 'user')
  if (!latestUser || !isAffirmativeReply(latestUser.message.content)) return null
  const previousAssistant = lastMessageByRole(messages, 'assistant', latestUser.index)
  if (!previousAssistant) return null
  const previousAssistantText = plainMessageText(previousAssistant.message.content)

  if (/approval needed|requires approval|review and approve|approve before/i.test(previousAssistantText)) {
    const toolName =
      /delete (?:client|customer)|delete_customer/i.test(previousAssistantText) ? 'delete_customer' :
      /delete (?:file|document)|delete_document/i.test(previousAssistantText) ? 'delete_document' :
      /import price|price sheet/i.test(previousAssistantText) ? 'import_price_sheet_items' :
      undefined
    return `The latest user reply "${plainMessageText(latestUser.message.content)}" confirms an approval request from the previous assistant message.

Do not create a new approval request. Do not narrate.

Call decide_pending_action_requests with decision "approved"${toolName ? ` and toolName "${toolName}"` : ''}.

Only say the action completed after the approval replay tool result confirms success. If multiple approvals match, ask which exact approval to run. Respond as JSON only.`
  }

  const directCustomerName = extractPendingProjectCustomerName(previousAssistantText)
  const latestText = plainMessageText(latestUser.message.content)
  const looksLikeProjectConfirmation = /\b(project|job|chat|crew|subcontractor|customer|homeowner|sales|insurance|supplier|finance)\b/i.test(latestText)
    || /\b(project|job)\b/i.test(previousAssistantText)
  const customerName = directCustomerName
    ?? (looksLikeProjectConfirmation ? findRecentOperationalCustomerName(messages, latestUser.index) : null)
  if (!customerName) {
    const linkCustomerName = extractPendingLinkCustomerName(previousAssistantText)
    const documentRef = linkCustomerName ? findRecentDocumentReference(messages, latestUser.index) : null
    if (linkCustomerName && documentRef) {
      return `The latest user reply "${plainMessageText(latestUser.message.content)}" confirms the previous assistant offer to link/attach the recent uploaded file to customer "${linkCustomerName}".

Do not narrate. Do not ask again.

Call link_document_to_customer with customerName "${linkCustomerName}"${documentRef.documentId ? ` and documentId "${documentRef.documentId}"` : documentRef.filename ? ` and filename "${documentRef.filename}"` : ''}.

Only say linked/attached after the tool result confirms success. Respond as JSON only.`
    }
    return null
  }

  const previousUser = lastMessageByRole(messages, 'user', previousAssistant.index)
  const requestedChatType = previousUser?.message.content && /creat|chat|crew|subcontractor|homeowner|customer|sales|insurance|supplier|finance/i.test(previousUser.message.content)
    ? inferChatType(previousUser.message.content)
    : findRecentRequestedChatType(messages, latestUser.index)

  return `The latest user reply "${plainMessageText(latestUser.message.content)}" is an explicit confirmation of the previous assistant offer to create a project/job for customer "${customerName}".

Do not narrate. Do not ask again.

Call create_project_for_customer with customerName "${customerName}".
${requestedChatType ? `The user's original request also asked for a ${requestedChatType} chat. After create_project_for_customer returns a real projectId, continue the workflow by calling create_project_chat with that projectId and chatType "${requestedChatType}".` : ''}

Only say created/done after the relevant tool result confirms success. Respond as JSON only.`
}

function buildUploadLinkContinuationInstruction(messages: ChatMessage[]) {
  const latestUser = lastMessageByRole(messages, 'user')
  if (!latestUser) return null
  const latest = plainMessageText(latestUser.message.content)
  if (!latest || latest.length > 160) return null
  const prompt = findRecentUploadAttachPrompt(messages, latestUser.index)
  if (!prompt) return null
  const documentRef = findRecentDocumentReference(messages, latestUser.index)
  if (!documentRef) return null
  const customerName = extractCustomerNameFromReply(latest)
  if (!customerName || /^(project|customer|client|job)$/i.test(customerName)) return null

  return `A recent assistant message asked which customer/project to attach the recent upload to. The latest user answered "${customerName}".

Do not ask again and do not require a project for customer-file attachment.

Call link_document_to_customer with customerName "${customerName}"${documentRef.documentId ? ` and documentId "${documentRef.documentId}"` : documentRef.filename ? ` and filename "${documentRef.filename}"` : ''}.

Only say linked/attached after the tool result confirms success. Respond as JSON only.`
}

function isPriceSheetReviewRequest(text: string) {
  const lower = plainMessageText(text).toLowerCase()
  if (!/\b(price\s*(?:sheet|list)|supplier|material|materials|unit price|unit and price|pending import|imported|first\s+\d+\s+(?:rows|items))\b/.test(lower)) return false
  if (/\b(delete|detach|remove|unassign|clear|replace|import these|import them|import rows|import items)\b/.test(lower)) return false
  return /\b(review|show|list|tell me|first|rows|items|unit|price|pending|imported|saved)\b/.test(lower)
}

function browserLocationFromText(text: string) {
  const latitude = text.match(/\blatitude:\s*(-?\d+(?:\.\d+)?)/i)?.[1]
  const longitude = text.match(/\blongitude:\s*(-?\d+(?:\.\d+)?)/i)?.[1]
  if (!latitude || !longitude) return null
  const accuracy = text.match(/\baccuracyMeters:\s*(\d+(?:\.\d+)?)/i)?.[1]
  const source = text.match(/\bsource:\s*([^\n]+)/i)?.[1]?.trim()
  return {
    latitude: Number(latitude),
    longitude: Number(longitude),
    accuracyMeters: accuracy ? Number(accuracy) : undefined,
    source: source || 'browser_gps',
  }
}

function mostRecentBrowserLocation(messages: ChatMessage[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const location = browserLocationFromText(plainMessageText(messages[i]?.content ?? ''))
    if (location) return location
  }
  return null
}

function isCompanyLogoUploadRequest(text: string) {
  const lower = plainMessageText(text).toLowerCase()
  if (!/\blogo\b/.test(lower)) return false
  return /\b(company|profile|estimate|estimates|invoice|invoices|report|reports|contract|contracts|signature|signatures|branding|brand)\b/.test(lower)
}

function isActionCenterRequest(text: string) {
  const lower = plainMessageText(text).toLowerCase()
  if (!lower) return false
  return (
    /\b(what|show|list|pull|open|check)\b[\s\S]{0,90}\b(needs? attention|action needed|pending approvals?|review items?|failed work|routed tasks?|invites?|notifications?)\b/.test(lower) ||
    /\b(needs? attention|action needed|what needs my approval|what do i need to approve|pending approvals?)\b/.test(lower)
  )
}

type TesterFeedbackArgs = {
  content: string
  source: 'note_to_cody' | 'note_to_codex' | 'tester_feedback'
  area?: string
  severity?: 'low' | 'normal' | 'high' | 'urgent'
  debugContext?: {
    recentMessages?: Array<{ role: 'user' | 'assistant'; text: string }>
    conversationId?: string
    workspaceId?: string
    chatId?: string
    channelType?: string
    documentIds?: string[]
    userId?: string
    userRole?: string
  }
}

function testerFeedbackFromText(text: string): TesterFeedbackArgs | null {
  const clean = plainMessageText(text)
  if (!clean) return null
  const marker = clean.match(/^\s*\(?\s*note\s+to\s+(cody|codex)\s*\)?\s*[:\-–—]?\s*/i)
    ?? clean.match(/^\s*(?:tell|send|save)\s+(?:this\s+)?(?:to|for)\s+(cody|codex)\s*[:\-–—]?\s*/i)
    ?? clean.match(/^\s*(?:tell|send|save)\s+(cody|codex)\s+(?:this\s+)?[:\-–—]?\s*/i)
    ?? clean.match(/^\s*\(?\s*hey\s+(cody|codex)\s*\)?\s*[:,\-–—]?\s*/i)
  if (!marker) return null
  const audience = String(marker[1] || '').toLowerCase()
  const content = clean.slice(marker[0].length).trim()
  if (!content) return null
  const lower = content.toLowerCase()
  const area = /\bupload|file|photo|document\b/.test(lower) ? 'uploads/files'
    : /\bonboard|signup|sign in|login|workspace|invite\b/.test(lower) ? 'onboarding/auth'
      : /\bshortcut|prompt|pill\b/.test(lower) ? 'shortcuts'
        : /\bfield|gps|map|inspection|canvass\b/.test(lower) ? 'field'
          : /\bcompany|profile|logo|research\b/.test(lower) ? 'company profile'
            : undefined
  const severity: 'low' | 'normal' | 'high' | 'urgent' = /\burgent|critical|p0|emergency\b/.test(lower)
    ? 'urgent'
    : /\b(broken|bug|failed|failure|stuck|crash|crashed|error|cannot|can't|wont|won't|loop|frozen|froze)\b/.test(lower)
      ? 'high'
      : 'normal'
  return {
    content,
    source: audience === 'codex' ? 'note_to_codex' : 'note_to_cody',
    ...(area ? { area } : {}),
    severity,
  }
}

function withTesterFeedbackDebugContext(feedback: TesterFeedbackArgs, messages: ChatMessage[], opts?: Pick<AgentLoopOptions, 'conversationId' | 'workspaceId' | 'chatId' | 'channelType' | 'documentIds' | 'userId' | 'userRole'>): TesterFeedbackArgs {
  return {
    ...feedback,
    debugContext: {
      recentMessages: recentVisibleChatTurns(messages),
      ...(opts?.conversationId ? { conversationId: opts.conversationId } : {}),
      ...(opts?.workspaceId ? { workspaceId: opts.workspaceId } : {}),
      ...(opts?.chatId ? { chatId: opts.chatId } : {}),
      ...(opts?.channelType ? { channelType: opts.channelType } : {}),
      ...(opts?.documentIds?.length ? { documentIds: opts.documentIds.slice(0, 20) } : {}),
      ...(opts?.userId ? { userId: opts.userId } : {}),
      ...(opts?.userRole ? { userRole: opts.userRole } : {}),
    },
  }
}

function testerFeedbackFollowUpText(feedback: { content: string; source: 'note_to_cody' | 'note_to_codex' | 'tester_feedback'; area?: string }) {
  const audience = feedback.source === 'note_to_codex' ? 'Codex' : 'Cody'
  const lower = feedback.content.toLowerCase()
  let workaround = 'If you still need to keep working, tell Jobrolo the immediate goal in plain language and use the closest working card/tool path. This note is saved for review with the logs.'

  if (/\b(upload|file|photo|image|jpeg|jpg|png|pdf|document|scope)\b/.test(lower)) {
    workaround = 'For now, use the upload path that matches the file: roof/site photos through photo or inspection-photo upload, PDFs/scopes/estimates through document upload, and company logos through Add logo. If the picker rejects it or Jobrolo guesses wrong, paste the scope text into chat or say “this upload is a photo/document/logo for…” so the workflow stays moving while Cody reviews the bug.'
  }

  if (/\b(misclass|wrong.*type|claim number|policy number|insurance field|treated.*document|roof photo|simple photo)\b/.test(lower)) {
    workaround = 'For now, treat normal roof photos as inspection/evidence photos and manually tag the section if needed, like “roof overview,” “front elevation,” or “hail/wind damage.” A plain roof photo should not ask for claim number, policy number, carrier, deductible, RCV, or ACV.'
  }

  if (/\b(company|profile|logo|avatar|picture|brand)\b/.test(lower)) {
    workaround = 'For now, upload the image, then say “use the last upload as my company logo” or “use the last upload as my profile photo.” Jobrolo should ask before saving it to the profile instead of attaching it to a customer/job.'
  }

  if (/\b(onboard|signup|sign in|login|workspace|invite|locked|stuck)\b/.test(lower)) {
    workaround = 'For now, use Sign in, Create workspace, or the invite link/code path. If setup locks you in, refresh and open Command Center after the company setup finishes; Cody will review the onboarding lock/route.'
  }

  if (/\b(shortcut|prompt|pill|button)\b/.test(lower)) {
    workaround = 'For now, use the shortcut pill as a prompt starter, edit the text before sending, and tell Jobrolo exactly which shortcut title/prompt to add, edit, or delete.'
  }

  if (/\b(field|gps|map|inspection|canvass|location)\b/.test(lower)) {
    workaround = 'For now, use Open map to confirm the location, then say “start an inspection here” or “save this as a field lead.” If the browser location is wrong or missing, include the address or nearest landmark.'
  }

  return `Captured that note for ${audience}. ${workaround}`
}

function toolResultCardPayload(data: unknown): { contextType: string; contextData: Record<string, unknown> } | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const record = data as Record<string, unknown>
  const nestedCard = record.card
  if (nestedCard && typeof nestedCard === 'object' && !Array.isArray(nestedCard)) {
    const nested = nestedCard as Record<string, unknown>
    const nestedType = typeof nested.cardType === 'string'
      ? nested.cardType
      : typeof nested.type === 'string'
        ? nested.type
        : null
    if (nestedType) return { contextType: nestedType, contextData: nested }
  }
  const contextData = record.contextData
  const contextType = typeof record.contextType === 'string' ? record.contextType : null
  if (contextType && contextData && typeof contextData === 'object' && !Array.isArray(contextData)) {
    return { contextType, contextData: contextData as Record<string, unknown> }
  }
  const rawType = typeof record.type === 'string' ? record.type : ''
  const cardType = typeof record.cardType === 'string'
    ? record.cardType
    : rawType && (
        rawType.includes('_card') ||
        rawType.includes('scope_') ||
        rawType.includes('company_') ||
        rawType.includes('customer_') ||
        rawType.includes('field_') ||
        rawType.includes('report_')
      )
      ? rawType
      : null
  if (!cardType) return null
  return { contextType: cardType, contextData: record }
}

function attachToolCardFallback(response: ParsedAIResponse, card: { contextType: string; contextData: Record<string, unknown> } | null): ParsedAIResponse {
  if (!card || response.contextType || response.contextData) return response
  console.log(`[agent-loop] attached deterministic card payload contextType=${card.contextType}`)
  return {
    ...response,
    contextType: card.contextType,
    contextData: card.contextData,
  }
}

function isFieldInspectionLeadRequest(text: string) {
  const lower = plainMessageText(text).toLowerCase()
  if (!lower) return false
  if (/\b(open|show|pull up|display)\b.{0,40}\bmap\b/.test(lower)) return false
  const hasLocation = lower.includes('[browser_location]') || /\b(use my location|my location|where i am|where i'm at|current location|near me|nearby|gps|here|this house|this property)\b/.test(lower)
  const hasInspectionIntent = /\b(inspection|inspect|appointment|field check|walking up|arrived for|landed (?:an? )?inspection|got (?:an? )?inspection|set (?:an? )?inspection|start (?:an? )?inspection|outside mowing)\b/.test(lower)
  return hasLocation && hasInspectionIntent
}

function withoutBrowserLocationBlock(text: string) {
  return plainMessageText(text).replace(/\[BROWSER_LOCATION\][\s\S]*$/i, '').trim()
}

function looksLikeRelayedPropertyInfo(text: string) {
  const lower = withoutBrowserLocationBlock(text).toLowerCase()
  return /\b(customer|homeowner|owner|tenant|renter|adjuster|roofer|crew|sub|sales|pm)\s+(?:texted|messaged|emailed|called|said|told|sent)\b/.test(lower)
    || /\b(?:text|message|email|call)\s+(?:from|came in|said)\b/.test(lower)
    || /\b(?:scope|estimate|document|pdf|file|report)\s+(?:says|said|shows|mentions|lists|has)\b/.test(lower)
    || /\b(?:according to|from the pdf|from the document|from the file|uploaded scope|uploaded estimate)\b/.test(lower)
}

function classifyFieldObservation(text: string) {
  const clean = withoutBrowserLocationBlock(text)
  const lower = clean.toLowerCase()
  let outcome: string | undefined
  if (/\b(no soliciting|do not solicit|do not knock|no knock)\b/.test(lower)) outcome = lower.includes('do not knock') ? 'do_not_knock' : 'no_soliciting'
  else if (/\b(renter|renters|tenant|tenants)\b/.test(lower)) outcome = 'renter'
  else if (/\b(no answer|nobody answered|no one answered)\b/.test(lower)) outcome = 'no_answer'
  else if (/\b(not interested|no interest)\b/.test(lower)) outcome = 'not_interested'
  else if (/\b(interested|wants inspection|wants me to inspect|inspection set|set inspection|landed inspection|got inspection)\b/.test(lower)) outcome = /\binspection/.test(lower) ? 'inspection_set' : 'interested'
  else if (/\b(knocked|knocking|door knock)\b/.test(lower)) outcome = 'knocked'
  else if (/\b(spoke with|talked to|someone answered)\b/.test(lower)) outcome = 'spoke'
  else if (/\bfollow[- ]?up\b/.test(lower)) outcome = 'follow_up'

  const damageSignals: string[] = []
  if (/\bhail\b/.test(lower)) damageSignals.push('hail')
  if (/\bwind\b/.test(lower)) damageSignals.push('wind')
  if (/\bmissing shingles?\b/.test(lower)) damageSignals.push('missing shingles')
  if (/\bcreased shingles?\b/.test(lower)) damageSignals.push('creased shingles')
  if (/\bsoft metals?|gutters?|vents?|drip edge|flashing\b/.test(lower)) damageSignals.push('soft metals')
  if (/\bwindow screens?|screens?\b/.test(lower)) damageSignals.push('window screens')
  if (/\binterior leak|ceiling stain|water stain|drywall|interior\b/.test(lower)) damageSignals.push('interior')

  const roofCondition = /\b(new roof)\b/.test(lower) ? 'new_roof'
    : /\b(old roof|aged roof)\b/.test(lower) ? 'aged'
    : damageSignals.length ? 'visible_damage'
    : undefined

  const type = outcome ? 'door_or_property_note'
    : damageSignals.length ? 'damage_observation'
    : /\b(dog|gate locked|locked gate|vacant|for sale|sold)\b/.test(lower) ? 'property_access_note'
    : 'field_observation'

  return {
    type,
    outcome,
    title: outcome ? outcome.replace(/_/g, ' ') : type.replace(/_/g, ' '),
    summary: clean.slice(0, 800),
    roofCondition,
    damageSignal: damageSignals.length ? damageSignals.join(', ') : undefined,
    severity: /\b(major|severe|bad|heavy|lots of|tons of)\b/.test(lower) ? 'high' : damageSignals.length ? 'moderate' : undefined,
  }
}

function isLiveFieldObservationRequest(text: string) {
  const clean = withoutBrowserLocationBlock(text)
  const lower = clean.toLowerCase()
  if (!browserLocationFromText(text)) return false
  if (looksLikeRelayedPropertyInfo(text) && !/\b(i am here|i'm here|where i am|where i'm at|current location|at the property|at this property|from the ground|i saw|i see|noticed|observed)\b/.test(lower)) return false
  if (/\b(open|show|pull up|display)\b.{0,40}\bmap\b/.test(lower)) return false
  if (/\b(start|landed|got|set)\b.{0,35}\binspection\b/.test(lower)) return false
  const fieldSignals = /\b(i saw|i see|seeing|noticed|observed|from (?:the )?ground|from driveway|from street|standing|walking around|on (?:the )?roof|during (?:the )?inspection|at (?:the )?inspection|knocked|knocking|door knock|someone answered|no answer|not interested|interested|follow[- ]?up|talked to|spoke with|left (?:a )?(?:card|flyer|door hanger))\b/.test(lower)
  const propertySignals = /\b(roof damage|missing shingles?|creased shingles?|lifted shingles?|hail damage|wind damage|dents?|dented|soft metals?|gutters?|vents?|window screens?|screens?|collateral|fence damage|interior leak|ceiling stain|water stain|attic leak|tarp|new roof|old roof|no soliciting|do not knock|renters?|tenants?|vacant|dog|gate locked)\b/.test(lower)
  return fieldSignals || propertySignals
}

function isCreatePotentialLeadRequest(text: string) {
  const lower = plainMessageText(text).toLowerCase()
  if (!/\b(create|add|save|start)\b.{0,30}\blead\b|\blead\b.{0,30}\b(create|add|save|start)\b/.test(lower)) return false
  return !/\b(inspection|inspect|appointment|project|job|customer file)\b/.test(lower)
}

function extractPotentialLeadArgs(text: string) {
  const clean = plainMessageText(text)
    .replace(/\[BROWSER_LOCATION\][\s\S]*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  const phoneMatch = clean.match(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)?\d{3}[\s.-]?\d{4}\b/) ?? clean.match(/\b\d{10,12}\b/)
  const phone = phoneMatch?.[0]?.trim()
  const afterLead = clean.replace(/^.*?\blead(?:\s+for\s+me|\s+for)?\s*/i, '').trim()
  const phoneIndex = phone ? afterLead.indexOf(phone) : -1
  const beforePhone = phone && phoneIndex >= 0 ? afterLead.slice(0, phoneIndex).trim() : afterLead
  const afterPhone = phone && phoneIndex >= 0 ? afterLead.slice(phoneIndex + phone.length).trim() : ''
  const nameWords = beforePhone.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}/)?.[0]
  const cleanupAddress = (value: string) => value
    .replace(nameWords ?? '', '')
    .replace(/^\s*(?:at|address is|address|for|on)\s+/i, '')
    .replace(/\b(?:phone|cell|mobile|number|tel|telephone)\b.*$/i, '')
    .replace(/\b(speech|period|comma|please|thanks|thank you)\b\.?$/i, '')
    .replace(/^[\s:,. -]+|[\s:,. -]+$/g, '')
    .trim()
  const addressFromBeforePhone = cleanupAddress(beforePhone)
  const addressFromAfterPhone = cleanupAddress(afterPhone)
  const address = addressFromBeforePhone || addressFromAfterPhone || undefined
  return {
    homeownerName: nameWords,
    phone,
    address,
    notes: clean.slice(0, 800),
    status: 'new',
  }
}

function isFieldLocationResolveRequest(messages: ChatMessage[]) {
  const latestUser = lastExternalUserMessage(messages)
  if (!latestUser) return false
  const latest = plainMessageText(latestUser.message.content)
  const lower = latest.toLowerCase()
  if (!browserLocationFromText(latest)) return false
  if (/\b(open|show|pull up|display)\b.{0,40}\bmap\b/.test(lower)) return false
  const wantsLocationLookup = /\b(use my location|my location|current location|where i am|where i'm at|gps|here|near me|nearby)\b/.test(lower)
  if (!wantsLocationLookup) return false
  const recent = recentPlainMessages(messages, 8).toLowerCase()
  return /\b(do i have|any|check|find|look for|search|lookup|look up)\b[\s\S]{0,120}\b(inspection|appointment|job|project|customer|client|lead)\b/.test(recent)
    || /\b(inspection|appointment|jobsite|job site|field visit|current house|this house|this property)\b/.test(recent)
}

function isFieldResearchContinuationRequest(messages: ChatMessage[]) {
  const latestUser = lastExternalUserMessage(messages)
  if (!latestUser) return false
  const latest = plainMessageText(latestUser.message.content).toLowerCase()
  if (!/\b(research|search|look\s*up|lookup|find|check)\b.{0,60}\b(it|this|property|house|home|address|owner|homeowner)\b/.test(latest)) return false
  const recent = recentPlainMessages(messages, 10).toLowerCase()
  return /\b(field|inspection|current location|browser_location|where i am|where i'm at|this house|this property|canvassing lead|inspection lead|property research)\b/.test(recent)
}

function isAffirmativeFieldInspectionContinuation(messages: ChatMessage[]) {
  const latestUser = lastExternalUserMessage(messages)
  if (!latestUser) return false
  const latest = plainMessageText(latestUser.message.content).trim().toLowerCase()
  if (!/^(yes|yea|yep|yeah|sure|ok|okay|proceed|do it|start it|use it)$/.test(latest)) return false
  const recent = recentPlainMessages(messages, 8).toLowerCase()
  return /\b(start a new inspection lead|proceed with this canvassing lead|inspection lead|field inspection|current location)\b/.test(recent)
    && /\b(inspection|current location|where i am|where i'm at|browser_location|near your current location)\b/.test(recent)
}

function buildFieldInspectionLeadInstruction(userText: string, fallbackLocation?: ReturnType<typeof browserLocationFromText>) {
  const location = browserLocationFromText(userText) ?? fallbackLocation ?? null
  const locationArgs = location
    ? `, "location": ${JSON.stringify(location)}`
    : ''
  return `The latest user request is a field inspection/current-property workflow:
"${userText.slice(0, 500)}"

Do not ask for homeowner name, phone number, appointment title, start time, or end time before saving the field lead.
Do not start a canvassing run and do not open a map.

Call start_field_inspection_lead now with {"searchPropertyInfo": true${locationArgs}, "notes": ${JSON.stringify(userText.slice(0, 800))}}.

After the tool returns, ask the user to confirm any property/homeowner match and offer the inspection photo workflow/sections. Respond as JSON only.`
}

function buildFieldResearchContinuationInstruction(messages: ChatMessage[]) {
  const latestUser = lastExternalUserMessage(messages)
  const userText = latestUser ? plainMessageText(latestUser.message.content) : ''
  const location = mostRecentBrowserLocation(messages)
  const locationArgs = location
    ? `, "location": ${JSON.stringify(location)}`
    : ''
  return `The user is continuing a field/current-property workflow and asked to research the property:
"${userText.slice(0, 500)}"

Do not ask for homeowner name or phone number before researching.
Do not create a customer/project yet.
Call research_property_now now with {"mode":"approaching_house","query":"current GPS location","allowProviderLookup":true${locationArgs}, "notes": ${JSON.stringify(userText.slice(0, 500))}}.

After the tool returns, show possible property/owner/address matches and ask the user to confirm before saving, converting, or updating records. If public property research is not configured, say exactly what provider/API is missing. Respond as JSON only.`
}

function buildFieldLocationResolveInstruction(userText: string) {
  const location = browserLocationFromText(userText)
  const locationArgs = location
    ? `"currentLocation": ${JSON.stringify(location)}, `
    : ''
  return `The latest user reply provides browser GPS for a field/location lookup:
"${userText.slice(0, 500)}"

Do not narrate "checking" as a final answer.
Call resolve_field_location now with {${locationArgs}"mode":"inspection_check"}.

After the tool returns, tell the user whether a saved inspection/project/customer/lead appears to match this location. If nothing matches, say that honestly and offer to start a new field inspection lead. Respond as JSON only.`
}

function buildFieldObservationInstruction(userText: string) {
  const location = browserLocationFromText(userText)
  const classification = classifyFieldObservation(userText)
  return `The latest user message is a live field/property observation with browser GPS:
"${withoutBrowserLocationBlock(userText).slice(0, 500)}"

Do not create a customer or project from this note.
Do not treat this as office/admin information, a customer text, or a pasted scope.
Call record_field_observation_at_location now with:
${JSON.stringify({ ...classification, ...(location ? { location } : {}) })}

After the tool returns, confirm the observation was saved with GPS and say whether it matched an existing property/lead or stayed as lightweight property memory. Respond as JSON only.`
}

function buildFieldInspectionLeadToolCall(userText: string, fallbackLocation?: ReturnType<typeof browserLocationFromText>): ToolCall {
  const location = browserLocationFromText(userText) ?? fallbackLocation ?? null
  return {
    name: 'start_field_inspection_lead',
    args: {
      searchPropertyInfo: true,
      ...(location ? { location } : {}),
      notes: userText.slice(0, 800),
    },
  }
}

function buildPotentialLeadToolCall(userText: string): ToolCall {
  const location = browserLocationFromText(userText)
  const args = extractPotentialLeadArgs(userText)
  return {
    name: 'create_canvassing_lead_at_location',
    args: {
      ...args,
      ...(location ? { location } : {}),
    },
  }
}

function buildFieldResearchContinuationToolCall(messages: ChatMessage[]): ToolCall {
  const latestUser = lastExternalUserMessage(messages)
  const userText = latestUser ? plainMessageText(latestUser.message.content) : ''
  const location = mostRecentBrowserLocation(messages)
  return {
    name: 'research_property_now',
    args: {
      mode: 'approaching_house',
      query: 'current GPS location',
      allowProviderLookup: true,
      ...(location ? { location } : {}),
      notes: userText.slice(0, 500),
    },
  }
}

function buildFieldLocationResolveToolCall(userText: string): ToolCall | null {
  const location = browserLocationFromText(userText)
  if (!location) return null
  return {
    name: 'resolve_field_location',
    args: {
      currentLocation: location,
      mode: 'inspection_check',
    },
  }
}

function buildFieldObservationToolCall(userText: string): ToolCall {
  const location = browserLocationFromText(userText)
  const classification = classifyFieldObservation(userText)
  return {
    name: 'record_field_observation_at_location',
    args: {
      ...classification,
      ...(location ? { location } : {}),
    },
  }
}

function buildDeterministicToolCall(messages: ChatMessage[], opts?: Pick<AgentLoopOptions, 'conversationId' | 'workspaceId' | 'chatId' | 'channelType' | 'documentIds' | 'userId' | 'userRole'>): ToolCall | null {
  const latestUser = lastExternalUserMessage(messages)
  if (!latestUser) return null
  const userText = plainMessageText(latestUser.message.content)
  if (opts?.documentIds?.length && isCompanyLogoUploadRequest(userText)) {
    return { name: 'update_contractor_profile', args: { logoDocumentId: opts.documentIds[0] } }
  }
  const testerFeedback = testerFeedbackFromText(userText)
  if (testerFeedback) return { name: 'record_tester_feedback', args: withTesterFeedbackDebugContext(testerFeedback, messages, opts) }
  if (isActionCenterRequest(userText)) return { name: 'get_copilot_inbox', args: { limit: 12 } }
  if (isCreatePotentialLeadRequest(userText)) return buildPotentialLeadToolCall(userText)
  if (isFieldInspectionLeadRequest(userText)) return buildFieldInspectionLeadToolCall(userText)
  if (isLiveFieldObservationRequest(userText)) return buildFieldObservationToolCall(userText)
  if (isAffirmativeFieldInspectionContinuation(messages)) return buildFieldInspectionLeadToolCall(userText, mostRecentBrowserLocation(messages))
  if (isFieldResearchContinuationRequest(messages)) return buildFieldResearchContinuationToolCall(messages)
  if (isFieldLocationResolveRequest(messages)) return buildFieldLocationResolveToolCall(userText)
  return null
}

function stableToolCallSignature(toolCall: ToolCall) {
  return `${toolCall.name}:${JSON.stringify(toolCall.args ?? {})}`
}

function documentHintFromPriceSheetText(text: string) {
  const clean = plainMessageText(text)
  const filename = clean.match(/\b([A-Za-z0-9][A-Za-z0-9._ -]{2,}\.(?:pdf|xlsx?|csv))\b/i)?.[1]
  if (filename) return filename
  const lower = clean.toLowerCase()
  if (lower.includes('price sheet') || lower.includes('price list') || lower.includes('supplier')) return 'price sheet'
  return ''
}

function buildDeterministicIntentInstruction(messages: ChatMessage[], opts?: Pick<AgentLoopOptions, 'conversationId' | 'workspaceId' | 'chatId' | 'channelType' | 'documentIds' | 'userId' | 'userRole'>) {
  const latestUser = lastExternalUserMessage(messages)
  if (!latestUser) return null
  const userText = plainMessageText(latestUser.message.content)
  const testerFeedback = testerFeedbackFromText(userText)
  if (testerFeedback) {
    const feedbackWithContext = withTesterFeedbackDebugContext(testerFeedback, messages, opts)
    return `The latest user message is tester/product feedback intended for ${testerFeedback.source === 'note_to_codex' ? 'Codex' : 'Cody'}:
"${testerFeedback.content.slice(0, 500)}"

Call record_tester_feedback now with:
${JSON.stringify(feedbackWithContext)}

Do not save it as a normal customer/job note. Do not narrate that you will save it. Only say it was captured after the tool succeeds. Respond as JSON only.`
  }
  if (isFieldInspectionLeadRequest(userText)) return buildFieldInspectionLeadInstruction(userText)
  if (isLiveFieldObservationRequest(userText)) return buildFieldObservationInstruction(userText)
  if (isAffirmativeFieldInspectionContinuation(messages)) return buildFieldInspectionLeadInstruction(userText, mostRecentBrowserLocation(messages))
  if (isFieldResearchContinuationRequest(messages)) return buildFieldResearchContinuationInstruction(messages)
  if (isFieldLocationResolveRequest(messages)) return buildFieldLocationResolveInstruction(userText)
  if (isPriceSheetReviewRequest(userText)) {
    const filename = documentHintFromPriceSheetText(userText)
    return `The latest user request is a read-only supplier/material price sheet review request:
"${userText.slice(0, 300)}"

Do not detach, link, delete, clear, replace, or import anything.
Call review_price_sheet_items now with limit 10${filename ? ` and filename "${filename}"` : ''}.
Only after that tool result returns, answer with the extracted rows and pending/imported status.
Respond as JSON only.`
  }
  return null
}

function buildMissingToolInstruction(text: string) {
  if (looksLikeApprovalReplayFailure(text)) {
    return `You described an approval failure without calling the approval replay tool.

Do not narrate. Do not ask for the same approval again unless the replay tool says multiple approvals match.

Call decide_pending_action_requests with:
{"decision":"approved","approveRecent":true}

If the tool result says multiple approvals matched, ask the user which exact approval to run and include the actionRequestIds/options. Only say completed after the approval replay tool result confirms success. Respond as JSON only.`
  }

  return `You said "${text.slice(0, 160)}" but did not include any tool_calls or actions.

If you are checking, saving, creating, updating, linking, attaching, importing, extracting, clearing, uploading, or retrieving system data, you MUST call the correct tool or include the correct action in strict JSON.

Common recovery examples:
- To list saved clients/customers, call list_customers.
- To attach an uploaded photo/file to a customer, call link_document_to_customer. A projectId is not required.
- If you previously asked whether to link/attach a document/photo and the user replied "yes" or "yea", call link_document_to_customer or the appropriate save/link tool using the prior document/customer context.
- To create a project/job for a customer, call create_project_for_customer.
- To review supplier price sheet rows, call review_price_sheet_items. Do not detach, clear, replace, delete, or import anything unless the user explicitly asked for that operation.
- To remove a file from a customer/project but keep it saved, call detach_document_from_customer. Do not delete unless the user explicitly asked to permanently delete the file.
- To move a supplier price sheet out of a customer file and into company pricing, call detach_document_from_customer, then review_price_sheet_items; ask for confirmation before import_price_sheet_items.
- To delete a customer/client, call delete_customer, not delete_documents_by_name.
- To approve pending requests after the user says "yes approved", "yes delete", "yes", or "approved", call decide_pending_action_requests or decide_action_request. If the pending request is delete_customer, pass toolName="delete_customer" and do NOT create a new delete_customer approval.
- To create a crew/customer/project chat, call create_project_chat.
- To invite/add/share a chat with an employee, crew member, subcontractor, customer, homeowner, or sales rep, call invite_user_to_chat. If email is missing, ask for it. Default to returning a copyable secure invite link; only set sendEmail/sendSms when the user explicitly wants automatic delivery.
- To show/update company info, call get_contractor_profile or update_contractor_profile. To research a company website, call research_contractor_website first; if the user asked to save the findings, follow up with update_contractor_profile after the research result.
- If the user uploaded a logo and asked to add it to the company profile, call update_contractor_profile with logoDocumentId from the current uploaded document. Do not wait for logo/image analysis.
- To create a named/address potential lead before an inspection is set, call create_canvassing_lead_at_location with homeownerName/address/phone/status="new".
- To start or log an inspection/field visit from chat, call log_field_action when a projectId is known, or start_field_inspection_lead when this is clearly an inspection/appointment at a new property with browser GPS.
- To save live field observations like "missing shingles from ground", "dents to soft metals", "no soliciting sign", "renters", or "window screen damage" with browser GPS, call record_field_observation_at_location. Do not create a customer/project unless the user explicitly asks to convert it.
- If the user asks to research "it/this property/this house" during a field inspection flow, call research_property_now with the latest browser GPS/location context. Do not ask for homeowner name or phone first.
- If the user says "yes create a project" after a customer was just discussed, use that customerName unless multiple customers are possible.

If no tool exists for the requested operation, do not claim it is done. Respond with final=true and clearly say the workflow cannot be saved/executed yet, naming the missing tool/workflow.

If a tool previously failed, say: "I tried, but it did not save. Here's the error: ..."

Respond as JSON only.`
}

function buildCompanyProfileToolInstruction(userText: string) {
  return `The user asked: "${userText.slice(0, 180)}"

This is a saved company/business profile lookup. Do not answer "fetching" or "checking" as a final response.

Call get_contractor_profile now with no args, final=false. After the tool result returns, answer from the saved profile only and include any missing key company fields honestly.

Respond as JSON only.`
}

async function chatWithRetry(messages: ChatMessage[], opts: { temperature?: number; maxTokens?: number; contractorId?: string; userId?: string }): Promise<string> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await chatComplete(messages, { ...opts, purpose: 'tool_reasoning', contractorId: opts.contractorId, userId: opts.userId })
    } catch (err) {
      lastErr = err
      const isRateLimit = err instanceof Error && /429|rate.?limit|too many requests/i.test(err.message)
      if (isRateLimit) {
        // Exponential backoff for rate limits: 3s, 6s, 12s, 24s
        const backoff = Math.min(30000, 3000 * Math.pow(2, attempt))
        console.warn(`[agent-loop] rate limited, attempt ${attempt + 1}/${MAX_RETRIES + 1}, backing off ${backoff}ms`)
        await new Promise(r => setTimeout(r, backoff))
      } else {
        // Non-rate-limit errors: short backoff, fewer retries
        if (attempt >= 1) throw err
        console.warn(`[agent-loop] error attempt ${attempt + 1}, backing off 500ms`)
        await new Promise(r => setTimeout(r, 500))
      }
    }
  }
  throw lastErr
}

export async function runAgentLoop(opts: AgentLoopOptions): Promise<AgentLoopResult> {
  const maxIterations = opts.maxIterations ?? 4
  const messages = [...opts.messages]
  const latestUserAtStart = lastExternalUserMessage(messages)
  const activeTesterFeedback = latestUserAtStart ? testerFeedbackFromText(plainMessageText(latestUserAtStart.message.content)) : null
  if (latestUserAtStart) {
    const skillContext = buildSkillRoutingContext({
      latestText: plainMessageText(latestUserAtStart.message.content),
      documentIds: opts.documentIds,
    })
    const skillSelections = selectSkills(skillContext)
    const skillInstruction = renderSkillInstructions(skillSelections, skillContext)
    if (skillInstruction) {
      const insertAt = Math.max(0, messages.length - 1)
      console.log(`[agent-loop] selected skills contractorId=${opts.contractorId} skills=${skillSelections.map(s => s.skill.id).join(',')}`)
      messages.splice(insertAt, 0, { role: 'system', content: skillInstruction })
    }
  }
  const continuationInstruction = buildAffirmativeContinuationInstruction(messages) ?? buildUploadLinkContinuationInstruction(messages)
  if (continuationInstruction) {
    const insertAt = Math.max(0, messages.length - 1)
    console.log(`[agent-loop] affirmative continuation detected contractorId=${opts.contractorId}`)
    messages.splice(insertAt, 0, { role: 'system', content: continuationInstruction })
  }
  const deterministicIntentInstruction = buildDeterministicIntentInstruction(messages, {
    conversationId: opts.conversationId,
    workspaceId: opts.workspaceId,
    chatId: opts.chatId,
    channelType: opts.channelType,
    documentIds: opts.documentIds,
    userId: opts.userId,
    userRole: opts.userRole,
  })
  if (deterministicIntentInstruction) {
    const insertAt = Math.max(0, messages.length - 1)
    console.log(`[agent-loop] deterministic intent instruction inserted contractorId=${opts.contractorId}`)
    messages.splice(insertAt, 0, { role: 'system', content: deterministicIntentInstruction })
  }
  const iterations: AgentIteration[] = []
  let totalToolCalls = 0
  let lastBlockedReason: string | null = null
  let testerFeedbackSaved = false
  let lastToolCard: { contextType: string; contextData: Record<string, unknown> } | null = null
  const injectedDeterministicToolCalls = new Set<string>()

  for (let i = 0; i < maxIterations; i++) {
    if (await opts.isCancelled?.()) {
      return {
        final: { text: 'Stopped. No further actions were run.', actions: [], tool_calls: [], final: true },
        iterations,
        totalToolCalls,
      }
    }
    const raw = await chatWithRetry(messages, { temperature: 0.3, maxTokens: 1500, contractorId: opts.contractorId, userId: opts.userId })
    const parsed = parseAIResponse(raw)
    if (activeTesterFeedback && testerFeedbackSaved) {
      const capturedText = testerFeedbackFollowUpText(activeTesterFeedback)
      const finalParsed: ParsedAIResponse = {
        ...parsed,
        text: capturedText,
        actions: [],
        tool_calls: [],
        final: true,
      }
      const finalIteration: AgentIteration = { iteration: i, text: finalParsed.text, toolCalls: [], final: true }
      opts.onIteration?.(finalIteration)
      iterations.push(finalIteration)
      console.log(`[agent-loop] tester feedback final answer sanitized after saved result contractorId=${opts.contractorId}`)
      return { final: finalParsed, iterations, totalToolCalls }
    }
    const normalizedWork = normalizeParsedWork(parsed)
    const parsedToolCallCount = (parsed.tool_calls?.length ?? 0) + normalizedWork.convertedToolCalls.length
    const parsedActionCount = normalizedWork.executableActions.length
    const candidateDeterministicToolCall = parsedToolCallCount === 0 && parsedActionCount === 0
      ? buildDeterministicToolCall(messages, opts)
      : null
    const deterministicToolCall = candidateDeterministicToolCall && !injectedDeterministicToolCalls.has(stableToolCallSignature(candidateDeterministicToolCall))
      ? candidateDeterministicToolCall
      : null
    if (candidateDeterministicToolCall && !deterministicToolCall) {
      console.warn(`[agent-loop] skipped repeated deterministic tool call '${candidateDeterministicToolCall.name}' iteration=${i} contractorId=${opts.contractorId}`)
    }
    if (deterministicToolCall) {
      injectedDeterministicToolCalls.add(stableToolCallSignature(deterministicToolCall))
      console.warn(`[agent-loop] injected deterministic tool call '${deterministicToolCall.name}' iteration=${i} contractorId=${opts.contractorId}`)
    }

    if (!opts.workspaceId && parsedActionCount > 0 && parsedToolCallCount === 0 && !deterministicToolCall) {
      lastBlockedReason = 'The assistant produced chat actions, but this main chat has no workspace context to execute them.'
      console.warn(`[agent-loop] blocked executable actions without workspace context iteration=${i} contractorId=${opts.contractorId}`)
      messages.push({ role: 'assistant', content: raw })
      messages.push({
        role: 'user',
        content: `You returned actions, but this is the main command center and there is no workspaceId to execute workspace actions.

If the user requested a database/system operation, use tool_calls.
If it can only be done inside a workspace/project chat, say that clearly and do not claim it was saved or completed.
If the user asked to attach/link/detach/remove a document from a customer or project, use link_document_to_customer or detach_document_from_customer as tool_calls.

Respond as JSON only.`,
      })
      continue
    }

    // Detect when the AI narrates operational work without actually calling a tool/action.
    // This is the trust boundary between "chat demo" and "operating system".
    if (needsCompanyProfileToolRetry(parsed, messages, parsedToolCallCount, parsedActionCount)) {
      lastBlockedReason = 'The assistant tried to fetch company profile data without calling get_contractor_profile.'
      console.warn(`[agent-loop] forced company profile tool retry iteration=${i} contractorId=${opts.contractorId}`)
      messages.push({ role: 'assistant', content: raw })
      messages.push({ role: 'user', content: buildCompanyProfileToolInstruction(latestUserText(messages)) })
      continue
    }

    if (!deterministicToolCall && shouldForceToolRetry(parsed, parsedToolCallCount, parsedActionCount)) {
      lastBlockedReason = 'The assistant narrated operational work without a valid executable tool call.'
      console.warn(`[agent-loop] blocked narrated action without tool iteration=${i} contractorId=${opts.contractorId}`)
      console.warn(`[agent-loop] forced retry for missing tool call iteration=${i} contractorId=${opts.contractorId}`)
      messages.push({ role: 'assistant', content: raw })
      messages.push({ role: 'user', content: buildMissingToolInstruction(parsed.text) })
      continue
    }

    let toolCalls = [...(parsed.tool_calls ?? []), ...normalizedWork.convertedToolCalls, ...(deterministicToolCall ? [deterministicToolCall] : [])]
    const blockedToolResults: NonNullable<AgentIteration['toolResults']> = [...normalizedWork.blockedResults]
    if (normalizedWork.blockedResults.length > 0) {
      lastBlockedReason = normalizedWork.blockedResults.map(r => r.error).filter(Boolean).join('; ')
    }

    if (activeTesterFeedback && toolCalls.some(tc => tc.name === 'record_tester_feedback')) {
      const before = toolCalls.length
      toolCalls = toolCalls.filter(tc => tc.name === 'record_tester_feedback')
      if (before !== toolCalls.length) {
        console.warn(`[agent-loop] isolated tester feedback; dropped non-feedback tool calls contractorId=${opts.contractorId} dropped=${before - toolCalls.length}`)
      }
    }

    // Uploaded estimates/scopes are saved documents, not pasted raw text.
    // If the model tries the old failure path (create_scope_from_text with a PDF filename/document id),
    // reroute to the document-aware scope tool when the current upload context provides a real documentId.
    if (toolCalls.some(tc => tc.name === 'create_scope_from_text')) {
      const rerouted: typeof toolCalls = []
      for (const tc of toolCalls) {
        const rawText = tc.name === 'create_scope_from_text' && typeof tc.args?.rawText === 'string' ? tc.args.rawText : ''
        if (!rawText || !looksLikeDocumentReferenceArg(rawText)) {
          rerouted.push(tc)
          continue
        }

        const args = tc.args ?? {}
        const explicitDocumentId = typeof args.documentId === 'string' ? args.documentId : undefined
        const contextDocumentId = opts.documentIds?.length === 1 ? opts.documentIds[0] : undefined
        const documentId = explicitDocumentId || contextDocumentId

        if (!documentId) {
          const error = 'Invalid tool args: rawText appears to be a filename or document reference. Use create_scope_from_document with a saved documentId instead.'
          console.warn(`[agent-loop] blocked filename rawText for create_scope_from_text contractorId=${opts.contractorId}`)
          blockedToolResults.push({ name: tc.name, success: false, data: null, error })
          lastBlockedReason = error
          continue
        }

        console.warn(`[agent-loop] rerouted filename rawText from create_scope_from_text to create_scope_from_document contractorId=${opts.contractorId} documentId=${documentId}`)
        rerouted.push({
          name: 'create_scope_from_document',
          args: {
            documentId,
            customerId: args.customerId,
            customerName: args.customerName,
            projectId: args.projectId,
            title: args.title,
            notes: 'Rerouted from create_scope_from_text because rawText was a document filename/reference.',
          },
        })
      }
      toolCalls = rerouted
    }

    // Filter out tools not allowed in this channel (security: per-channel permissioning)
    if (opts.channelType) {
      toolCalls = toolCalls.filter(tc => {
        const allowed = isToolAllowedInChannel(tc.name, opts.channelType!)
        if (!allowed) console.warn(`[agent-loop] blocked tool '${tc.name}' in channel '${opts.channelType}'`)
        return allowed
      })
    }

    toolCalls = toolCalls.filter(tc => {
      const sanitized = sanitizeToolArgs(tc.args)
      if (sanitized.invalid) {
        const error = `Invalid tool args: ${sanitized.invalid}`
        console.warn(`[agent-loop] blocked placeholder tool call '${tc.name}' ${sanitized.invalid} contractorId=${opts.contractorId}`)
        blockedToolResults.push({ name: tc.name, success: false, data: null, error })
        lastBlockedReason = error
        return false
      }
      if (sanitized.removed.length > 0) {
        console.warn(`[agent-loop] removed placeholder id args for '${tc.name}': ${sanitized.removed.join(', ')} contractorId=${opts.contractorId}`)
        tc.args = sanitized.value as Record<string, unknown>
      }
      const badArgPath = findNullishIdArg(tc.args)
      if (!badArgPath) return true
      const error = `Invalid tool args: ${badArgPath} is required`
      console.warn(`[agent-loop] blocked invalid tool call '${tc.name}' ${badArgPath} contractorId=${opts.contractorId}`)
      blockedToolResults.push({ name: tc.name, success: false, data: null, error })
      lastBlockedReason = error
      return false
    })

    const isFinal = toolCalls.length > 0 ? false : parsed.final !== false
    const iteration: AgentIteration = { iteration: i, text: parsed.text, toolCalls, final: isFinal }

    if (toolCalls.length > 0) {
      console.log(`[agent-loop] tool calls detected; forcing post-tool final response contractorId=${opts.contractorId} count=${toolCalls.length}`)
      const results: AgentIteration['toolResults'] = [...blockedToolResults]
      for (const tc of toolCalls) {
        if (await opts.isCancelled?.()) {
          console.warn(`[agent-loop] stopped before executing tool '${tc.name}' contractorId=${opts.contractorId}`)
          break
        }
        console.log(`[agent-loop] executing tool '${tc.name}' contractorId=${opts.contractorId}`)
        const result = await executeTool(tc.name, tc.args, opts.contractorId, {
          userId: opts.userId,
          userRole: opts.userRole,
          trustedDirectExecution: opts.trustedDirectExecution,
          conversationId: opts.conversationId,
          workspaceId: opts.workspaceId,
          chatId: opts.chatId,
          channelType: opts.channelType,
          documentIds: opts.documentIds,
        })
        results.push({
          name: tc.name,
          success: result.success,
          data: result.data,
          error: result.error,
        })
        if (tc.name === 'record_tester_feedback' && result.success) {
          testerFeedbackSaved = true
        }
        if (result.success) {
          const card = toolResultCardPayload(result.data)
          if (card) lastToolCard = card
        }
        totalToolCalls++
      }
      iteration.toolResults = results
      opts.onIteration?.(iteration)
      if (activeTesterFeedback && toolCalls.some(tc => tc.name === 'record_tester_feedback')) {
        const feedbackResult = results.find(r => r.name === 'record_tester_feedback')
        const finalText = feedbackResult?.success
          ? testerFeedbackFollowUpText(activeTesterFeedback)
          : `I tried to capture that note for ${activeTesterFeedback.source === 'note_to_codex' ? 'Codex' : 'Cody'}, but it did not save. ${feedbackResult?.error ? `Error: ${feedbackResult.error}` : 'Please try again with “hey Cody:” and the bug details.'}`
        iterations.push(iteration)
        console.log(`[agent-loop] tester feedback turn ended after feedback tool contractorId=${opts.contractorId} success=${Boolean(feedbackResult?.success)}`)
        return {
          final: { text: finalText, contextType: null, contextData: null, actions: [], tool_calls: [], attachments: [], final: true },
          iterations,
          totalToolCalls,
        }
      }
      messages.push({ role: 'assistant', content: JSON.stringify({ text: parsed.text, tool_calls: toolCalls, final: false }) })
      const toolResultsFormatted = results.map(r =>
        `TOOL RESULT: ${r.name}\n${r.success ? JSON.stringify(r.data, null, 2).slice(0, 3000) : `ERROR: ${r.error}`}`
      ).join('\n\n')
      const hasNonSavedResult = results.some(r => {
        const data = r.data as Record<string, unknown> | null
        return !r.success || Boolean(data?.needsProject || data?.needsCustomer || data?.needsClarification || data?.approvalRequired)
      })
      messages.push({
        role: 'user',
        content: `Tool results:\n\n${toolResultsFormatted}\n\nNow continue from these real tool results. If the user's requested workflow requires a follow-up tool using a real id returned above, call that next tool with final=false instead of giving a final answer. Otherwise answer the user's original question using these real tool results. Do not make up information. Only say saved/created/updated/linked/imported if a tool result confirms success with saved=true, created record ids, linked ids, or an executed mutation result.${hasNonSavedResult ? '\n\nIMPORTANT: At least one tool result did not complete the requested save/mutation or requires clarification/approval. Say exactly what is missing or what failed. Do not say the action is done.' : ''} If tools returned errors or approvalRequired, acknowledge that clearly.\n\nIf a tool result includes a card/cardType payload, return it through contextType/contextData instead of describing raw JSON. If tool results include photos/images, include structured attachments using the exact relative url/thumbnailUrl returned by the tool. Do not write markdown image URLs. Never invent or use https://yourdomain.com.`,
      })
      iterations.push(iteration)
      continue
    } else {
      if (blockedToolResults.length > 0) {
        iteration.toolResults = blockedToolResults
        opts.onIteration?.(iteration)
        messages.push({ role: 'assistant', content: JSON.stringify({ text: parsed.text, tool_calls: parsed.tool_calls ?? [], final: false }) })
        const blockedFormatted = blockedToolResults.map(r => `TOOL RESULT: ${r.name}\nERROR: ${r.error}`).join('\n\n')
        messages.push({
          role: 'user',
          content: `Tool results:\n\n${blockedFormatted}\n\nAt least one tool call was blocked before execution because its required ID argument was missing/null. Do not claim the action succeeded. Either retry with valid arguments from saved records or tell the user what is missing.`,
        })
        iterations.push(iteration)
        continue
      }
      if (parsed.final !== false) {
        console.log(`[agent-loop] final answer without mutation contractorId=${opts.contractorId} toolCalls=0 actions=${parsedActionCount}`)
        if (totalToolCalls > 0) console.log(`[agent-loop] final answer based on tool results contractorId=${opts.contractorId}`)
      }
      const final = totalToolCalls > 0 ? attachToolCardFallback(parsed, lastToolCard) : parsed
      opts.onIteration?.(iteration)
      iterations.push(iteration)
      return { final, iterations, totalToolCalls }
    }
  }
  const fallback: ParsedAIResponse = {
    text: lastBlockedReason
      ? `I tried, but it did not save or complete. ${lastBlockedReason}`
      : iterations[iterations.length - 1]?.text ?? 'I got stuck. Could you rephrase?',
    actions: [], tool_calls: [], final: true,
  }
  return { final: fallback, iterations, totalToolCalls }
}
