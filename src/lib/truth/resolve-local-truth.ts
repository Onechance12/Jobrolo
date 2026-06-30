import type { ToolCall } from '@/lib/prompts'
import type { LocalTruthContext, LocalTruthRoute } from './types'

export function plainTruthText(text: string) {
  return text
    .replace(/<UNTRUSTED_CONTENT[^>]*>/gi, '')
    .replace(/<\/UNTRUSTED_CONTENT>/gi, '')
    .trim()
}

export function hasLocalTruthMutationIntent(text: string) {
  const lower = plainTruthText(text).toLowerCase()
  return /\b(create|add|save|update|edit|change|delete|remove|archive|attach|link|import|send|text|email|invite|approve|reject|finalize|convert)\b/.test(lower)
}

export function isPriceSheetReviewRequest(text: string) {
  const lower = plainTruthText(text).toLowerCase()
  if (!/\b(price\s*(?:sheet|list)|supplier|material|materials|unit price|unit and price|pending import|imported|first\s+\d+\s+(?:rows|items))\b/.test(lower)) return false
  if (/\b(delete|detach|remove|unassign|clear|replace|import these|import them|import rows|import items)\b/.test(lower)) return false
  return /\b(review|show|list|tell me|first|rows|items|unit|price|pending|imported|saved)\b/.test(lower)
}

export function documentHintFromPriceSheetText(text: string) {
  const clean = plainTruthText(text)
  const filename = clean.match(/\b([A-Za-z0-9][A-Za-z0-9._ -]{2,}\.(?:pdf|xlsx?|csv))\b/i)?.[1]
  if (filename) return filename
  const lower = clean.toLowerCase()
  if (lower.includes('price sheet') || lower.includes('price list') || lower.includes('supplier')) return 'price sheet'
  return ''
}

function isSavedCustomerListRequest(text: string) {
  const lower = plainTruthText(text).toLowerCase()
  if (!lower || hasLocalTruthMutationIntent(lower)) return false
  if (/\b(how many|count|kpi|kpis|analytics?|trend|this week|last week|month|quarter)\b/.test(lower)) return false
  return (
    /\b(what|which|show|list|view|pull|display|see|who)\b[\s\S]{0,80}\b(saved\s+)?(clients?|customers?|homeowners?)\b/.test(lower) ||
    /\b(clients?|customers?|homeowners?)\b[\s\S]{0,50}\b(do we have|are saved|on file|in jobrolo|in the system)\b/.test(lower) ||
    /\b(saved\s+)?(clients?|customers?|homeowners?)\b$/.test(lower.trim())
  )
}

function isCompanyProfileReadRequest(text: string) {
  const lower = plainTruthText(text).toLowerCase()
  if (!lower || hasLocalTruthMutationIntent(lower)) return false
  return (
    /\b(show|view|pull|display|what(?:'s| is)|check|list)\b[\s\S]{0,80}\b(company|contractor|business)\s+(profile|info|information|setup|details)\b/.test(lower) ||
    /\b(company|contractor|business)\s+(profile|info|information|setup|details)\b[\s\S]{0,80}\b(saved|missing|need|needs|complete|incomplete|ready)\b/.test(lower) ||
    /\b(what|which|show|list|display)\b[\s\S]{0,80}\b(missing|needed|need|incomplete)\b[\s\S]{0,80}\b(estimates?|invoices?|reports?|contracts?|signatures?|company profile|company setup)\b/.test(lower)
  )
}

function isActionCenterReadRequest(text: string) {
  const lower = plainTruthText(text).toLowerCase()
  if (!lower || hasLocalTruthMutationIntent(lower)) return false
  return (
    /\b(what|show|list|view|pull|display|check)\b[\s\S]{0,80}\b(needs?\s+attention|action needed|pending approvals?|review items?|failed work|routed tasks?|inbox|notifications?)\b/.test(lower) ||
    /\b(needs?\s+attention|action needed|pending approvals?|review items?|failed work|routed tasks?)\b/.test(lower)
  )
}

function customerFileQueryFromText(text: string) {
  const clean = plainTruthText(text).replace(/\s+/g, ' ').trim()
  const lower = clean.toLowerCase()
  if (!clean || hasLocalTruthMutationIntent(lower)) return null
  if (!/\b(file|packet|customer record|client record|saved record|what do we have|what's saved|show|pull|view|open|display|files?|documents?|docs?|photos?)\b/.test(lower)) return null
  if (/\b(price\s*(?:sheet|list)|material prices?|company profile|company info|action needed|notifications?|inbox|recent uploads?)\b/.test(lower)) return null

  const patterns = [
    /\b(?:show|pull|view|open|display)\s+(?:me\s+)?(.+?)\s+(?:customer|client|homeowner)?\s*(?:file|packet|record)\b/i,
    /\b(?:show|pull|view|open|display)\s+(?:the\s+)?(?:customer|client|homeowner)?\s*(?:file|packet|record)\s+(?:for|on)\s+(.+?)$/i,
    /\b(?:what\s+do\s+we\s+have|what(?:'s| is)\s+saved)\s+(?:for|on)\s+(.+?)$/i,
    /\b(.+?)'s\s+(?:customer|client|homeowner)?\s*(?:file|packet|record)\b/i,
    /\b(?:files?|documents?|docs?|photos?)\s+(?:for|on)\s+(.+?)$/i,
  ]

  for (const pattern of patterns) {
    const match = clean.match(pattern)?.[1]?.trim()
    if (!match) continue
    const query = match
      .replace(/\b(only use saved database records|use saved database records only|saved database records only|please|the|my|our|saved)\b/gi, ' ')
      .replace(/'s\b/gi, '')
      .replace(/[?.!,]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!query) continue
    if (/^(this|that|current|active|the|a|an|customer|client|homeowner|project|job|file|packet|record|it|them)$/i.test(query)) continue
    if (/^(this|that|current|active|the)?\s*(customer|client|homeowner|project|job|file|packet|record)$/i.test(query)) continue
    if (query.length < 2) continue
    return query
  }

  return null
}

function customerContextQueryFromText(text: string) {
  const clean = plainTruthText(text).replace(/\s+/g, ' ').trim()
  const lower = clean.toLowerCase()
  if (!clean || hasLocalTruthMutationIntent(lower)) return null
  if (/\b(company|business|contractor)\s+(kpi|kpis|health|intelligence|profile|setup)\b/.test(lower)) return null
  if (!/\b(follow[- ]?up|tasks?|notes?|projects?|jobs?|chats?|conversation|customer context|client context|next steps?|what needs done)\b/.test(lower)) return null
  if (!/\b(check|show|list|view|pull|display|open|who|what|which|where|needs?)\b/.test(lower)) return null

  const patterns = [
    /\b(?:for|on|about|with)\s+(.+?)(?:\?|$|\.\s|,\s)/i,
    /\b(.+?)\s+(?:needs?|need)\s+follow[- ]?up\b/i,
  ]

  for (const pattern of patterns) {
    const match = clean.match(pattern)?.[1]?.trim()
    if (!match) continue
    const query = match
      .replace(/\b(saved|tasks?|notes?|projects?|jobs?|chats?|conversation|customer|client|homeowner|follow[- ]?up|records?|database|jobrolo|please|the|my|our)\b/gi, ' ')
      .replace(/'s\b/gi, '')
      .replace(/[?.!,]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!query) continue
    if (/^(this|that|current|active|the|a|an|customer|client|homeowner|project|job|it|them)$/i.test(query)) continue
    if (query.length < 2) continue
    return query
  }

  return null
}

function isProjectDocumentPacketRequest(text: string, activeProjectId?: string | null) {
  if (!activeProjectId) return false
  const lower = plainTruthText(text).toLowerCase()
  if (!lower || hasLocalTruthMutationIntent(lower)) return false
  return (
    /\b(show|pull|view|open|display|list|what(?:'s| is))\b[\s\S]{0,80}\b(this|current|active|the)?\s*(job|project)\s+(file|packet|documents?|docs?|files?|photos?)\b/.test(lower) ||
    /\b(what files?|what documents?|what docs?|what photos?)\b[\s\S]{0,80}\b(this|current|active|the)?\s*(job|project)\b/.test(lower)
  )
}

function isProjectFinancialSummaryRequest(text: string, activeProjectId?: string | null) {
  if (!activeProjectId) return false
  const lower = plainTruthText(text).toLowerCase()
  if (!lower || hasLocalTruthMutationIntent(lower)) return false
  if (/\b(closeout|close out|ready to close|close the job|warranty packet|final walkthrough)\b/.test(lower)) return false
  const asksToRead = /\b(show|pull|view|open|display|list|what(?:'s| is)|check|explain|calculate|how much|where are we|do we have)\b/.test(lower)
  const financialSubject = /\b(job\s*cost|job-cost|cost sheet|financials?|financial summary|ledger|margin|profit|gross profit|balance due|amount due|payments?|paid|collected|collections?|commission|customer invoice|invoice status|invoices?|material costs?|labor costs?|subcontractor costs?)\b/.test(lower)
  return asksToRead && financialSubject
}

function buildDocumentReadToolCall(text: string): ToolCall | null {
  const lower = plainTruthText(text).toLowerCase()
  if (!lower || hasLocalTruthMutationIntent(lower)) return null
  if (/\b(this|current|active|the)\s+(job|project)\b/.test(lower)) return null
  if (/\b(recent uploads?|latest uploads?|uploaded files?|upload status|still processing|analyzing|analysis status|pending analysis|unassigned uploads?)\b/.test(lower)) {
    return { name: 'get_recent_uploads', args: { limit: 12 } }
  }
  if (/\b(show|list|view|pull|display|open|what|which)\b[\s\S]{0,80}\b(files?|documents?|docs?|uploads?|photos?|images?)\b/.test(lower)) {
    const args: Record<string, unknown> = { limit: 20 }
    if (/\b(photos?|images?|pictures?)\b/.test(lower)) args.fileType = 'photo'
    return { name: 'list_documents', args }
  }
  return null
}

export function resolveLocalTruthRoute(text: string, context: LocalTruthContext = {}): LocalTruthRoute | null {
  const userText = plainTruthText(text)
  if (isActionCenterReadRequest(userText)) {
    return {
      id: 'action-center',
      reason: 'User asked for pending approvals, review items, failed work, routed tasks, or Action Needed.',
      confidence: 0.9,
      toolCall: { name: 'get_copilot_inbox', args: { limit: 25 } },
    }
  }

  if (isCompanyProfileReadRequest(userText)) {
    return {
      id: 'company-profile',
      reason: 'User asked to view saved company profile/setup readiness from Jobrolo records.',
      confidence: 0.88,
      toolCall: { name: 'get_contractor_profile', args: {} },
    }
  }

  if (isPriceSheetReviewRequest(userText)) {
    const filename = documentHintFromPriceSheetText(userText)
    return {
      id: 'price-list-review',
      reason: 'User asked to review/show saved supplier/material price rows.',
      confidence: 0.84,
      toolCall: { name: 'review_price_sheet_items', args: { limit: 10, ...(filename ? { filename } : {}) } },
    }
  }

  if (isProjectDocumentPacketRequest(userText, context.activeProjectId) && context.activeProjectId) {
    return {
      id: 'active-project-document-packet',
      reason: 'User asked for the active job/project file packet.',
      confidence: 0.86,
      toolCall: { name: 'get_project_document_packet', args: { projectId: context.activeProjectId } },
    }
  }

  if (isProjectFinancialSummaryRequest(userText, context.activeProjectId) && context.activeProjectId) {
    return {
      id: 'active-project-financial-summary',
      reason: 'User asked for active project financial truth from saved ledger rows.',
      confidence: 0.87,
      toolCall: { name: 'get_project_financial_summary', args: { projectId: context.activeProjectId } },
    }
  }

  const customerFileQuery = customerFileQueryFromText(userText)
  if (customerFileQuery) {
    return {
      id: 'customer-file',
      reason: 'User asked for a saved customer/client file by name or context.',
      confidence: 0.82,
      toolCall: { name: 'get_customer_file', args: { query: customerFileQuery } },
    }
  }

  const customerContextQuery = customerContextQueryFromText(userText)
  if (customerContextQuery) {
    return {
      id: 'customer-context',
      reason: 'User asked for customer-specific follow-up/tasks/notes/projects/chats from saved records.',
      confidence: 0.81,
      toolCall: { name: 'get_customer_file', args: { query: customerContextQuery } },
    }
  }

  if (isSavedCustomerListRequest(userText)) {
    return {
      id: 'saved-customer-list',
      reason: 'User asked to list saved customers/clients from Jobrolo records.',
      confidence: 0.88,
      toolCall: { name: 'list_customers', args: { limit: 25 } },
    }
  }

  const documentReadToolCall = buildDocumentReadToolCall(userText)
  if (documentReadToolCall) {
    return {
      id: documentReadToolCall.name === 'get_recent_uploads' ? 'recent-uploads' : 'document-list',
      reason: 'User asked to view saved uploads/documents/photos.',
      confidence: 0.78,
      toolCall: documentReadToolCall,
    }
  }

  return null
}

export function buildLocalTruthToolCall(text: string, context: LocalTruthContext = {}): ToolCall | null {
  return resolveLocalTruthRoute(text, context)?.toolCall ?? null
}
