import type { ToolCall } from '@/lib/prompts'
import { plainTruthText } from './resolve-local-truth'

export type LocalActionStatus = 'ready' | 'needs_context' | 'unsupported'

export type LocalActionContext = {
  activeCustomerId?: string | null
  activeProjectId?: string | null
  documentIds?: string[]
}

export type LocalActionCandidate = {
  id: string
  status: LocalActionStatus
  reason: string
  confidence: number
  toolCall?: ToolCall
  requiresApproval: boolean
  missingContext?: string[]
  blockedTools?: string[]
  userPrompt?: string
}

type ToolExecutionResultLike = {
  success: boolean
  data: unknown
  error?: string
}

const PRE_AI_LOCAL_ACTION_TOOLS = new Set([
  'record_tester_feedback',
  'get_canvassing_map',
  'create_canvassing_lead_at_location',
  'start_field_inspection_lead',
  'create_scope_from_document',
  'link_document_to_customer',
  'create_project_for_customer',
  'create_project_chat',
  'update_contractor_profile',
])

export function canRunLocalActionBeforeAi(candidate: LocalActionCandidate | null) {
  if (!candidate || candidate.status !== 'ready' || !candidate.toolCall) return false
  return PRE_AI_LOCAL_ACTION_TOOLS.has(candidate.toolCall.name)
}

function cleanText(text: string) {
  return plainTruthText(text).replace(/\s+/g, ' ').trim()
}

function firstDocumentId(context: LocalActionContext) {
  return context.documentIds?.length === 1 ? context.documentIds[0] : null
}

function stripTrailingNoise(value: string) {
  return value
    .replace(/\b(?:phone|cell|number|address|at|for|to|under)\b\s*$/i, '')
    .replace(/[.,!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractPhone(text: string) {
  return text.match(/\b(?:phone|cell|number)\s*(?:is|:)?\s*([+()0-9][+()0-9 .-]{6,})\b/i)?.[1]?.trim()
    ?? text.match(/\b(\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4})\b/)?.[1]?.trim()
    ?? null
}

function extractLeadParts(text: string) {
  const clean = cleanText(text)
  const match = clean.match(/\b(?:create|add|save|log)\s+(?:a\s+)?(?:new\s+)?(?:lead|potential customer|door knock|canvassing lead)\s+(?:for\s+)?(.+)$/i)
  if (!match?.[1]) return null
  const phone = extractPhone(clean)
  let rest = match[1]
  if (phone) rest = rest.replace(phone, ' ')
  rest = rest.replace(/\b(?:phone|cell|number)\s*(?:is|:)?\s*$/i, ' ')

  let name = rest
  let address: string | null = null
  const atIndex = rest.toLowerCase().indexOf(' at ')
  if (atIndex >= 0) {
    name = rest.slice(0, atIndex)
    address = rest.slice(atIndex + 4)
  }

  name = stripTrailingNoise(name)
  address = address ? stripTrailingNoise(address.replace(/\b(?:phone|cell|number)\b[\s\S]*$/i, '')) : null
  return name ? { name, address, phone } : null
}

function extractCustomerName(text: string) {
  const clean = cleanText(text)
  const patterns = [
    /\b(?:for|to|under|on)\s+([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){0,3})\b/,
    /\b([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){0,3})'s\s+(?:file|job|project|scope|photos?|documents?|chat)\b/,
  ]
  for (const pattern of patterns) {
    const match = clean.match(pattern)?.[1]
    if (match) return stripTrailingNoise(match)
  }
  return null
}

function scopeTypeFromText(text: string) {
  const lower = cleanText(text).toLowerCase()
  if (/\bscope of loss\b/.test(lower)) return 'scope_of_loss'
  if (/\bxactimate\b/.test(lower)) return 'xactimate'
  if (/\bsymbility\b/.test(lower)) return 'symbility'
  if (/\bcarrier estimate|insurance estimate|estimate\b/.test(lower)) return 'carrier_estimate'
  return 'other'
}

function chatTypeFromText(text: string) {
  const lower = cleanText(text).toLowerCase()
  if (/\bgutter\b/.test(lower)) return 'gutter_crew'
  if (/\bwindow\b/.test(lower)) return 'window_crew'
  if (/\bsiding|soffit|fascia\b/.test(lower)) return 'siding_crew'
  if (/\broof|roofing|roofer\b/.test(lower)) return 'roofing_crew'
  if (/\bcustomer\b/.test(lower)) return 'customer'
  if (/\bproduction\b/.test(lower)) return 'production'
  if (/\binsurance|supplement|adjuster\b/.test(lower)) return 'insurance'
  if (/\bfinance|invoice|payment\b/.test(lower)) return 'finance'
  return 'crew'
}

function ready(input: Omit<LocalActionCandidate, 'status'>): LocalActionCandidate {
  return { ...input, status: 'ready' }
}

function needsContext(input: Omit<LocalActionCandidate, 'status'> & { missingContext: string[] }): LocalActionCandidate {
  return { ...input, status: 'needs_context' }
}

export function compileLocalAction(text: string, context: LocalActionContext = {}): LocalActionCandidate | null {
  const clean = cleanText(text)
  const lower = clean.toLowerCase()
  if (!clean) return null

  if (/\b(open|show|pull up|display|bring up|launch)\b.{0,50}\b(field\s+|job\s+|current\s+)?map\b/.test(lower) || /^map(?:\s+(?:where i am|where i'm at|my location|current location|here))?$/.test(lower)) {
    return ready({
      id: 'show-field-map',
      reason: 'User asked to show the field map or saved map pins.',
      confidence: 0.92,
      requiresApproval: false,
      toolCall: {
        name: 'get_canvassing_map',
        args: {
          includeConverted: true,
          limit: 250,
        },
      },
      blockedTools: ['create_canvassing_lead_at_location', 'start_canvassing_session', 'create_customer', 'create_project_for_customer'],
    })
  }

  if (/\bcody cody note\b/.test(lower)) {
    const note = clean.replace(/^[\s\S]*?\bcody cody note\b\s*:?\s*/i, '').trim()
    if (!note) {
      return needsContext({
        id: 'cody-note',
        reason: 'Cody note trigger was present but no note text was supplied.',
        confidence: 0.9,
        requiresApproval: false,
        missingContext: ['note text'],
        userPrompt: 'Tell Cody what broke or what needs review.',
      })
    }
    return ready({
      id: 'cody-note',
      reason: 'User gave a direct Cody developer feedback note.',
      confidence: 0.96,
      requiresApproval: false,
      toolCall: {
        name: 'record_tester_feedback',
        args: {
          content: note,
          source: 'note_to_cody',
          area: 'qa',
          severity: 'normal',
        },
      },
      blockedTools: ['create_customer', 'create_project_for_customer', 'link_document_to_customer', 'link_document_to_project'],
    })
  }

  const lead = extractLeadParts(clean)
  if (lead) {
    return ready({
      id: 'create-lead',
      reason: 'User gave a clear lead/customer opportunity command.',
      confidence: 0.9,
      requiresApproval: false,
      toolCall: {
        name: 'create_canvassing_lead_at_location',
        args: {
          homeownerName: lead.name,
          ...(lead.address ? { address: lead.address } : {}),
          ...(lead.phone ? { phone: lead.phone } : {}),
          notes: clean,
        },
      },
    })
  }

  if (/\b(start|begin|landed|land)\b[\s\S]{0,40}\binspection\b|\binspection\b[\s\S]{0,40}\b(where i am|here|current location|my location)\b/.test(lower)) {
    return ready({
      id: 'start-field-inspection',
      reason: 'User clearly asked to start a field inspection lead.',
      confidence: 0.88,
      requiresApproval: false,
      toolCall: {
        name: 'start_field_inspection_lead',
        args: {
          notes: clean,
          searchPropertyInfo: true,
        },
      },
      blockedTools: ['create_customer', 'create_project_for_customer'],
    })
  }

  if (/\b(save|file|attach|add)\b[\s\S]{0,50}\b(scope|scope of loss|xactimate|symbility|carrier estimate|estimate)\b/.test(lower)) {
    const documentId = firstDocumentId(context)
    const customerName = extractCustomerName(clean)
    const missing = [
      documentId ? null : 'one uploaded documentId',
      customerName || context.activeCustomerId || context.activeProjectId ? null : 'customer/project',
    ].filter((value): value is string => Boolean(value))
    if (missing.length) {
      return needsContext({
        id: 'save-scope-document',
        reason: 'Scope/estimate save intent is clear but needs the uploaded document and destination.',
        confidence: 0.84,
        requiresApproval: false,
        missingContext: missing,
        userPrompt: 'Which saved upload and customer/project should this scope be saved to?',
      })
    }
    return ready({
      id: 'save-scope-document',
      reason: 'User clearly asked to save an uploaded scope/estimate document.',
      confidence: 0.88,
      requiresApproval: false,
      toolCall: {
        name: 'create_scope_from_document',
        args: {
          documentId,
          scopeType: scopeTypeFromText(clean),
          ...(context.activeProjectId ? { projectId: context.activeProjectId } : {}),
          ...(context.activeCustomerId ? { customerId: context.activeCustomerId } : {}),
          ...(customerName ? { customerName } : {}),
        },
      },
    })
  }

  if (/\b(attach|link|save|add)\b[\s\S]{0,40}\b(file|document|photo|image|upload)\b[\s\S]{0,60}\b(customer|client|homeowner|file|job)\b/.test(lower)) {
    const documentId = firstDocumentId(context)
    const customerName = extractCustomerName(clean)
    const missing = [
      documentId ? null : 'one uploaded documentId',
      customerName || context.activeCustomerId ? null : 'customer',
    ].filter((value): value is string => Boolean(value))
    if (missing.length) {
      return needsContext({
        id: 'attach-upload-to-customer',
        reason: 'Attachment intent is clear but needs the uploaded document and customer.',
        confidence: 0.82,
        requiresApproval: false,
        missingContext: missing,
        userPrompt: 'Which saved upload and customer should I attach?',
      })
    }
    return ready({
      id: 'attach-upload-to-customer',
      reason: 'User clearly asked to attach an upload to a customer file.',
      confidence: 0.86,
      requiresApproval: false,
      toolCall: {
        name: 'link_document_to_customer',
        args: {
          documentId,
          ...(customerName ? { customerName } : {}),
        },
      },
    })
  }

  if (/\b(create|start|open)\b[\s\S]{0,30}\b(project|job)\b/.test(lower)) {
    const customerName = extractCustomerName(clean)
    if (!customerName && !context.activeCustomerId) {
      return needsContext({
        id: 'create-project',
        reason: 'Project creation intent is clear but no customer was resolved.',
        confidence: 0.82,
        requiresApproval: false,
        missingContext: ['customer'],
        userPrompt: 'Which saved customer should this project/job belong to?',
      })
    }
    return ready({
      id: 'create-project',
      reason: 'User clearly asked to create a project/job for a customer.',
      confidence: 0.84,
      requiresApproval: false,
      toolCall: {
        name: 'create_project_for_customer',
        args: {
          ...(context.activeCustomerId ? { customerId: context.activeCustomerId } : {}),
          ...(customerName ? { customerName } : {}),
          generateJobNumber: true,
        },
      },
    })
  }

  if (/\b(create|start|open)\b[\s\S]{0,40}\b(chat)\b/.test(lower) && /\b(crew|roofing|gutter|window|siding|customer|production|insurance|finance|subcontractor)\b/.test(lower)) {
    const customerName = extractCustomerName(clean)
    if (!context.activeProjectId && !context.activeCustomerId && !customerName) {
      return needsContext({
        id: 'create-project-chat',
        reason: 'Project chat intent is clear but no project/customer was resolved.',
        confidence: 0.82,
        requiresApproval: false,
        missingContext: ['project/customer'],
        userPrompt: 'Which job or customer should this chat belong to?',
      })
    }
    return ready({
      id: 'create-project-chat',
      reason: 'User clearly asked to create/open a job-specific chat.',
      confidence: 0.84,
      requiresApproval: false,
      toolCall: {
        name: 'create_project_chat',
        args: {
          chatType: chatTypeFromText(clean),
          ...(context.activeProjectId ? { projectId: context.activeProjectId } : {}),
          ...(context.activeCustomerId ? { customerId: context.activeCustomerId } : {}),
          ...(customerName ? { customerName } : {}),
        },
      },
    })
  }

  const documentId = firstDocumentId(context)
  if (/\b(company|business)\s+logo\b|\buse\b[\s\S]{0,40}\blogo\b|\blogo\b[\s\S]{0,40}\b(company|profile)\b/.test(lower)) {
    if (!documentId) {
      return needsContext({
        id: 'set-company-logo',
        reason: 'Company logo intent is clear but no single uploaded image is selected.',
        confidence: 0.86,
        requiresApproval: true,
        missingContext: ['one uploaded logo documentId'],
        blockedTools: ['link_document_to_customer', 'link_document_to_project'],
        userPrompt: 'Which uploaded image should become the company logo?',
      })
    }
    return ready({
      id: 'set-company-logo',
      reason: 'User clearly asked to apply an uploaded image as company logo.',
      confidence: 0.9,
      requiresApproval: true,
      toolCall: {
        name: 'update_contractor_profile',
        args: { logoDocumentId: documentId },
      },
      blockedTools: ['link_document_to_customer', 'link_document_to_project'],
    })
  }

  if (/\b(profile photo|avatar|user icon|account photo)\b/.test(lower)) {
    return {
      id: 'set-user-avatar',
      status: 'unsupported',
      reason: 'User avatar intent is clear, but there is no stable local action tool exposed for applying a user profile photo yet.',
      confidence: 0.84,
      requiresApproval: true,
      missingContext: ['user avatar update tool'],
      blockedTools: ['link_document_to_customer', 'link_document_to_project', 'update_contractor_profile'],
      userPrompt: 'I can identify this as a profile photo, but applying it needs the user-avatar tool path.',
    }
  }

  return null
}

function objectData(data: unknown) {
  return data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : null
}

function stringField(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function nestedObject(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key]
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function compact(text: string, max = 220) {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1).trim()}…` : clean
}

export function localActionDirectResponse(candidate: LocalActionCandidate) {
  if (candidate.status === 'needs_context') {
    const missing = candidate.missingContext?.length ? ` Missing: ${candidate.missingContext.join(', ')}.` : ''
    return `${candidate.userPrompt || 'I need one more detail before I can do that.'}${missing}`
  }
  if (candidate.status === 'unsupported') {
    return candidate.userPrompt || `I understood the request, but this local action is not wired yet: ${candidate.reason}`
  }
  return null
}

export function formatLocalActionFinalText(candidate: LocalActionCandidate, result: ToolExecutionResultLike) {
  const data = objectData(result.data)
  const message = stringField(data, 'message')
  if (!result.success) {
    return `I understood that without needing AI, but it did not complete. ${result.error ? `Error: ${result.error}` : 'Please try again.'}`
  }

  if (data?.approvalRequired) {
    const title = stringField(data, 'title') || 'Approval needed'
    const summary = stringField(data, 'summary') || message || 'Review and approve this action before Jobrolo changes saved records.'
    return `${title}. ${summary}`
  }

  if (
    data?.needsClarification ||
    data?.needsCustomer ||
    data?.needsProject ||
    data?.needsCompanyPricingReview ||
    data?.needsCompanyTemplateWorkflow ||
    data?.needsProcessing ||
    data?.needsApproval
  ) {
    return message || candidate.userPrompt || 'I need one more detail before I can complete that.'
  }

  if (message) return message

  if (candidate.id === 'cody-note') {
    return 'Captured that note for Cody/Codex with the recent chat context.'
  }

  if (candidate.id === 'create-lead') {
    const card = nestedObject(data, 'card')
    const name = stringField(card, 'homeownerName')
    const phone = stringField(card, 'phone')
    const address = stringField(card, 'address')
    return compact(`Saved the lead${name ? ` for ${name}` : ''}${phone ? ` · ${phone}` : ''}${address ? ` · ${address}` : ''}.`)
  }

  if (candidate.id === 'start-field-inspection') {
    return 'Saved this as a field inspection lead. Confirm the property/customer details before converting it to a real customer or job.'
  }

  if (candidate.id === 'show-field-map') {
    return 'Loaded the field map card from saved Jobrolo map records. No lead, canvassing run, customer, or project was created.'
  }

  if (candidate.id === 'attach-upload-to-customer') {
    return 'Attached the uploaded file/photo to the customer file from saved Jobrolo records.'
  }

  if (candidate.id === 'save-scope-document') {
    return 'Saved the uploaded scope/estimate document to the job file from saved Jobrolo records.'
  }

  if (candidate.id === 'create-project') {
    return 'Created the project/job from saved Jobrolo records.'
  }

  if (candidate.id === 'create-project-chat') {
    return 'Created/opened the job chat from saved Jobrolo records.'
  }

  if (candidate.id === 'set-company-logo') {
    return 'Prepared the company logo update. If approval is required, approve it before Jobrolo changes the saved company profile.'
  }

  return 'Completed that local Jobrolo action without needing AI.'
}
