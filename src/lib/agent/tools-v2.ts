// =============================================================================
// Tool Registry v2 — typed schemas, per-channel permissioning, validation
// =============================================================================
// Every tool has:
//   - a Zod schema for args (validated before execution)
//   - a list of channels where it's allowed (least-privilege)
//   - a function that takes (args, contractorId, context)
// Tools that mutate state (create_customer, create_task) require human-in-the-loop
// approval when called from autonomous contexts (future).
// =============================================================================

import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { db } from '@/lib/db'
import type { ChannelType } from '@/lib/types'
import { parseXactimateLineItems, ROOFING_SYNONYMS } from '@/lib/specialized-parsers'
import { parseScope } from '@/lib/scope-parser'
import { deleteStoredFile, saveFile } from '@/lib/storage'
import { initScopeAnalysis } from '@/lib/scope-manager'
import { toFileUrl, toThumbnailUrl } from '@/lib/file-url'
import { getProjectContextByContractor, getProjectDocumentPacket, linkDocumentToJobPacket, createProjectTimelineEvent, getProjectTimeline, getContractorOcrReviewQueue } from '@/lib/project-context'
import { buildProjectMergeData, getOrCreateContractorProfile, mergeTemplateVariables, publicContractorProfile, upsertContractorProfile } from '@/lib/contractor-profile'
import { createTemplateUploadFromDocument, analyzeTemplateUpload, getTemplateReview, approveDocumentTemplate, generateDocumentFromTemplate, TEMPLATE_VARIABLES } from '@/lib/template-intake'
import { getFieldBriefing, executeFieldAction, resolveFieldEntity, listCopilotInbox, decideActionRequest } from '@/lib/field-copilot'
import { createUnsignedDocumentPdf, getSignedDocumentArtifacts } from '@/lib/final-documents'
import { getRoofReportWorkspace, generateRoofReportSummary, finalizeRoofReport, createRoofReportPdf, reviewRoofReportCandidatePhotos, updateRoofReportPhotoSelection, bulkAddPhotosToRoofReport, shareRoofReport } from '@/lib/roof-reports'
import { getCanvassingMap, startCanvassingSession, createCanvassingLead, logCanvassingActivity, convertCanvassingLead } from '@/lib/canvassing'
import { getPropertyMemoryContext, upsertPropertyMemory, recordPropertyObservation, recordDoorAttempt, createCanvassingGamePlan } from '@/lib/property-memory'
import { researchPropertyNow, getPropertyResearchRun, confirmPropertyResearchCandidate, getStreetResearchRuns } from '@/lib/property-research'
import { researchCompany } from '@/lib/onboarding/research'
import { sanitizeHtml } from '@/lib/security/html'
import type { TenantContext } from '@/lib/security/context'
import { normalizeRole } from '@/lib/security/permissions'
import { createWorkspaceInvite } from '@/lib/invitations/workspace-invites'

export interface ToolContext {
  workspaceId?: string
  chatId?: string
  channelType?: ChannelType
  userId?: string
  userRole?: string
  documentIds?: string[]  // IDs of documents uploaded with the current message
  approved?: boolean      // Set to true when a human has approved the action
  approvalActionRequestId?: string
  trustedDirectExecution?: boolean
}

export interface ToolResult {
  success: boolean
  data: unknown
  error?: string
}

export interface ToolDef {
  name: string
  description: string
  schema: z.ZodType<any>
  allowedChannels: ChannelType[] | 'all'
  requiresApproval?: boolean
  execute: (args: any, contractorId: string, ctx: ToolContext) => Promise<ToolResult>
}

const TRUSTED_DIRECT_TOOLS = new Set(['create_customer'])
const TRUSTED_DIRECT_ROLES = new Set(['owner', 'admin', 'manager', 'project_manager', 'sales'])
const COMPANY_PROFILE_ROLES = new Set(['owner', 'admin', 'manager', 'project_manager', 'coordinator'])
const PROJECT_CHAT_TYPES = [
  'main',
  'customer',
  'crew',
  'roofing_crew',
  'gutter_crew',
  'window_crew',
  'siding_crew',
  'field_crew',
  'subcontractor',
  'supplier',
  'finance',
  'management',
  'sales',
  'insurance',
  'production',
] as const
const PROJECT_CHAT_TYPE_SCHEMA = z.enum(PROJECT_CHAT_TYPES)
type ProjectChatType = (typeof PROJECT_CHAT_TYPES)[number]
const CREW_LIKE_CHAT_TYPES = new Set<ProjectChatType>(['crew', 'roofing_crew', 'gutter_crew', 'window_crew', 'siding_crew', 'field_crew', 'subcontractor'])

function canRunDirectWithoutApproval(name: string, ctx: ToolContext) {
  if (!ctx.trustedDirectExecution) return false
  if (!TRUSTED_DIRECT_TOOLS.has(name)) return false
  return TRUSTED_DIRECT_ROLES.has(normalizeRole(ctx.userRole))
}

function canManageCompanyProfile(ctx: ToolContext) {
  return COMPANY_PROFILE_ROLES.has(normalizeRole(ctx.userRole))
}

function stableStringify(value: unknown): string {
  if (typeof value === 'undefined') return 'undefined'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
}

function shortRecordNumber(prefix: string, id: string | null | undefined) {
  const suffix = String(id ?? '').slice(-6).toUpperCase()
  return suffix ? `${prefix}-${suffix}` : null
}

function customerNumber(customerOrId: { id?: string | null } | string | null | undefined) {
  const id = typeof customerOrId === 'string' ? customerOrId : customerOrId?.id
  return shortRecordNumber('C', id)
}

function projectNumber(projectOrId: { id?: string | null; title?: string | null } | string | null | undefined) {
  if (projectOrId && typeof projectOrId === 'object') {
    const title = projectOrId.title ?? ''
    const match = title.match(/\bJob\s*#?\s*(\d{4,})\b/i)
    if (match?.[1]) return `J-${match[1]}`
    return shortRecordNumber('P', projectOrId.id)
  }
  return shortRecordNumber('P', projectOrId)
}

function appBaseUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '')
}

function workspaceChatUrl(workspaceId?: string | null, chatId?: string | null) {
  if (!workspaceId) return null
  const params = new URLSearchParams({ workspaceId })
  if (chatId) params.set('chatId', chatId)
  return `${appBaseUrl()}/?${params.toString()}`
}

function isCrewLikeChatType(chatType?: string | null) {
  return CREW_LIKE_CHAT_TYPES.has(String(chatType ?? '') as ProjectChatType)
}

function isCustomerFacingChatType(chatType?: string | null) {
  return String(chatType ?? '') === 'customer'
}

function chatTypeLabel(chatType: string) {
  const labels: Record<string, string> = {
    main: 'Main',
    customer: 'Customer',
    crew: 'Crew',
    roofing_crew: 'Roofing crew',
    gutter_crew: 'Gutter crew',
    window_crew: 'Window crew',
    siding_crew: 'Siding crew',
    field_crew: 'Field crew',
    subcontractor: 'Subcontractor',
    supplier: 'Supplier',
    finance: 'Finance',
    management: 'Management',
    sales: 'Sales',
    insurance: 'Insurance',
    production: 'Production',
  }
  return labels[chatType] ?? chatType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function normalizeProjectChatType(chatType: string | undefined, hints: Array<string | null | undefined>): ProjectChatType {
  const current = (chatType || 'crew') as ProjectChatType
  if (current !== 'crew') return PROJECT_CHAT_TYPES.includes(current) ? current : 'crew'
  const text = hints.filter(Boolean).join(' ').toLowerCase()
  if (/\b(gutter|gutters|downspout|downspouts)\b/.test(text)) return 'gutter_crew'
  if (/\b(window|windows|screen|screens|glazing)\b/.test(text)) return 'window_crew'
  if (/\b(siding|fascia|soffit)\b/.test(text)) return 'siding_crew'
  if (/\b(subcontractor|sub contractor|sub\b|trade partner|vendor)\b/.test(text)) return 'subcontractor'
  if (/\b(field crew|repair crew|general crew)\b/.test(text)) return 'field_crew'
  if (/\b(roof|roofing|roofer|roofers|shingle|install crew|installer|installers)\b/.test(text)) return 'roofing_crew'
  return 'crew'
}

function permissionChannelForType(channel: ChannelType): ChannelType {
  return isCrewLikeChatType(channel) ? 'crew' : channel
}

async function ensureWorkspaceMember(workspaceId: string | null | undefined, ctx: ToolContext) {
  if (!workspaceId || !ctx.userId) return null
  const role = normalizeRole(ctx.userRole)
  return db.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId, userId: ctx.userId } },
    update: { role, permissions: 'read,write' },
    create: { workspaceId, userId: ctx.userId, role, permissions: 'read,write' },
  }).catch(err => {
    console.warn(`[tools-v2] ensureWorkspaceMember failed workspaceId=${workspaceId} userId=${ctx.userId}:`, err)
    return null
  })
}

function withCustomerNumber<T extends { id?: string | null }>(customer: T): T & { clientNumber: string | null; customerNumber: string | null } {
  const number = customerNumber(customer)
  return { ...customer, clientNumber: number, customerNumber: number }
}

function withProjectNumber<T extends { id?: string | null; title?: string | null }>(project: T): T & { projectNumber: string | null } {
  return { ...project, projectNumber: projectNumber(project) }
}

async function buildTrustedToolTenantContext(contractorId: string, ctx: ToolContext): Promise<TenantContext> {
  const contractor = await db.contractor.findFirst({
    where: { id: contractorId, status: 'active', deletedAt: null },
    select: { id: true, name: true, company: true, plan: true, subscriptionStatus: true, status: true },
  })
  if (!contractor) throw new Error('Contractor not found')
  const user = ctx.userId
    ? await db.user.findFirst({
        where: { id: ctx.userId, contractorId, status: 'active', deletedAt: null },
        select: { id: true, contractorId: true, name: true, email: true, role: true, status: true },
      })
    : null
  if (ctx.userId && !user) throw new Error('User not authorized')
  return {
    contractorId,
    contractor,
    user,
    actor: user ? `user:${user.email}` : 'ai',
    authMethod: 'system',
  }
}


async function resolveJobTarget(contractorId: string, input: { projectId?: string | null; customerId?: string | null }) {
  if (input.projectId) {
    const project = await db.project.findFirst({
      where: { id: input.projectId, contractorId },
      select: { id: true, customerId: true, title: true, address: true },
    })
    if (!project) return { error: 'Project not found' as const }
    return { projectId: project.id, customerId: input.customerId ?? project.customerId ?? undefined, project }
  }

  if (input.customerId) {
    const customer = await db.customer.findFirst({
      where: { id: input.customerId, contractorId },
      select: { id: true, name: true },
    })
    if (!customer) return { error: 'Customer not found' as const }
    const projects = await db.project.findMany({
      where: { contractorId, customerId: customer.id, status: { not: 'closed' } },
      orderBy: { updatedAt: 'desc' },
      take: 2,
      select: { id: true, customerId: true, title: true, address: true },
    })
    if (projects.length === 1) return { projectId: projects[0].id, customerId: customer.id, project: projects[0] }
    if (projects.length > 1) return { error: `Multiple active projects found for ${customer.name}. Ask which job/project to attach this to.` as const }
    return { error: `No active project found for ${customer.name}. Ask whether to create a project first.` as const }
  }

  return { error: 'Which job/project should I attach this to? Operational actions must be tied to a project or customer.' as const }
}

function normalizeCustomerFileQuery(query: string) {
  return query
    .replace(/[’']/g, "'")
    .replace(/\b(show|pull|get|open|find|lookup|look up|retrieve|only use|saved|database|records|actual|actually|everything|all|what|do|we|have|on|for|client|customer|job|project|packet|profile|file|folder|info|information|crew|chat|channel)\b/gi, ' ')
    .replace(/\b's\b/gi, ' ')
    .replace(/[^\p{L}\p{N}@.+\- ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function customerSearchTerms(query: string) {
  const normalized = normalizeCustomerFileQuery(query)
  const raw = query.replace(/[’']/g, "'").trim()
  const terms = new Set<string>()
  for (const value of [normalized, raw]) {
    const trimmed = value.trim()
    if (trimmed) terms.add(trimmed)
    for (const part of trimmed.split(/\s+/)) {
      if (part.length >= 3) terms.add(part)
    }
  }
  return [...terms].slice(0, 8)
}

function containsInsensitive(value: string) {
  return { contains: value, mode: 'insensitive' as const }
}

function normalizeMaterialItems(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .map((item: any) => ({
      name: String(item?.name ?? '').trim(),
      sku: item?.sku ? String(item.sku).trim() : null,
      category: item?.category ? String(item.category).trim() : 'other',
      unit: item?.unit ? String(item.unit).trim() : 'EA',
      unitCost: Number(item?.unitCost ?? item?.unitPrice ?? item?.cost ?? 0),
    }))
    .filter(item => item.name && Number.isFinite(item.unitCost) && item.unitCost >= 0)
}

function safeJsonParse<T = Record<string, unknown>>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try { return JSON.parse(value) as T } catch { return fallback }
}

async function replayStoredToolApproval(input: {
  contractorId: string
  ctx: ToolContext
  actionRequest: { id: string; payloadJson: string | null }
  decision: 'approved' | 'rejected'
  notes?: string | null
}): Promise<ToolResult> {
  const decisionRecord = await decideActionRequest(
    await buildTrustedToolTenantContext(input.contractorId, input.ctx),
    input.actionRequest.id,
    input.decision,
    input.notes,
  )
  if (!decisionRecord) return { success: false, data: null, error: 'Action request not found' }
  if (input.decision === 'rejected') {
    return { success: true, data: { actionRequestId: input.actionRequest.id, decision: input.decision, status: decisionRecord.status, replayResult: null } }
  }

  const payload = safeJsonParse<{ toolName?: string; args?: Record<string, unknown>; toolContext?: Record<string, unknown> }>(input.actionRequest.payloadJson, {})
  if (!payload.toolName) {
    return { success: false, data: { actionRequestId: input.actionRequest.id, status: decisionRecord.status }, error: 'Approved action request has no stored tool payload to replay' }
  }

  const replayContext = { ...(payload.toolContext ?? {}) }
  delete replayContext.approved
  delete replayContext.approvalActionRequestId
  delete replayContext.trustedDirectExecution
  delete replayContext.userId
  delete replayContext.userRole

  const replayResult = await executeTool(payload.toolName, payload.args ?? {}, input.contractorId, {
    ...(replayContext as ToolContext),
    userId: input.ctx.userId,
    userRole: input.ctx.userRole,
    approved: true,
    approvalActionRequestId: input.actionRequest.id,
  })

  await db.actionRequest.update({
    where: { id: input.actionRequest.id },
    data: {
      status: replayResult.success ? 'completed' : 'approved',
      completedAt: replayResult.success ? new Date() : undefined,
      payloadJson: JSON.stringify({ ...payload, replayResult }),
    },
  }).catch(() => null)

  return {
    success: replayResult.success,
    data: { actionRequestId: input.actionRequest.id, decision: input.decision, replayedTool: payload.toolName, replayResult },
    error: replayResult.success ? undefined : replayResult.error,
  }
}

function pendingMaterialItemsFromExtractedData(data: Record<string, any>) {
  return normalizeMaterialItems(
    data.materialItems ??
    data.priceSheetReview?.materialItems ??
    data.priceSheetReview?.items ??
    data.extractedRows ??
    data.rows,
  )
}

function supplierFromExtractedData(data: Record<string, any>) {
  return String(data.supplier ?? data.supplierName ?? data.priceSheetReview?.supplier ?? '').trim() || null
}

function effectiveDateFromExtractedData(data: Record<string, any>) {
  return String(data.validDate ?? data.effectiveDate ?? data.validFrom ?? data.priceSheetReview?.effectiveDate ?? '').trim() || null
}

function normalizeDocumentSearchText(value: string) {
  return value
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|a|an|supplier|price|sheet|document|file|pdf|contractor|contr|rfg|roofing|list|items|rows|latest|direct)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function materialRowCountFromDocument(doc: { extractedData: string | null }) {
  return pendingMaterialItemsFromExtractedData(safeJsonParse<Record<string, any>>(doc.extractedData, {})).length
}

function scoreDocumentNameMatch(docName: string, query: string) {
  const normalizedName = normalizeDocumentSearchText(docName)
  const normalizedQuery = normalizeDocumentSearchText(query)
  if (!normalizedQuery) return 0
  if (normalizedName.includes(normalizedQuery)) return 100
  const queryTokens = normalizedQuery.split(' ').filter(Boolean)
  if (!queryTokens.length) return 0
  const nameTokens = new Set(normalizedName.split(' ').filter(Boolean))
  const matched = queryTokens.filter(token => nameTokens.has(token) || normalizedName.includes(token)).length
  return Math.round((matched / queryTokens.length) * 90)
}

function numberFromMoney(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = Number(String(value ?? '').replace(/[$,()<>\s]/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

function scopeLineItemsFromText(rawText: string) {
  const xactimate = parseXactimateLineItems(rawText)
  if (xactimate.length > 0) {
    return xactimate.map(li => ({
      code: li.lineNumber,
      description: li.description,
      quantity: li.quantity,
      unit: li.unit,
      unitPrice: li.unitPrice,
      total: li.rcv,
      rcv: li.rcv,
      acv: li.acv,
      depreciation: li.depreciation,
      trade: li.trade,
      category: li.category,
    }))
  }
  const parsed = parseScope(rawText)
  return parsed.lineItems.map(li => ({
    code: li.lineNumber,
    description: li.description,
    quantity: numberFromMoney(li.quantity),
    unit: li.unit || null,
    unitPrice: numberFromMoney(li.unitPrice),
    total: numberFromMoney(li.rcv),
    rcv: numberFromMoney(li.rcv),
    acv: numberFromMoney(li.acv),
    depreciation: numberFromMoney(li.depreciation),
    trade: li.trade,
    category: li.category,
  }))
}

function compactDocument(d: { id: string; originalName: string; fileType: string; status: string; mimeType: string; size: number; filePath: string; thumbnailPath: string | null; aiSummary: string | null; customerId: string | null; projectId: string | null; workspaceId: string | null; createdAt: Date }) {
  return {
    id: d.id,
    originalName: d.originalName,
    fileType: d.fileType,
    status: d.status,
    mimeType: d.mimeType,
    size: d.size,
    aiSummary: d.aiSummary,
    customerId: d.customerId,
    projectId: d.projectId,
    workspaceId: d.workspaceId,
    url: toFileUrl(d.filePath),
    thumbnailUrl: toThumbnailUrl(d.thumbnailPath),
    createdAt: d.createdAt,
  }
}

function normalizePhone(value?: string | null) {
  return String(value ?? '').replace(/\D/g, '')
}

function normalizeText(value?: string | null) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function firstLastName(name?: string | null) {
  const parts = normalizeText(name).split(/\s+/).filter(Boolean)
  return { first: parts[0] ?? '', last: parts.length > 1 ? parts[parts.length - 1] : '' }
}

function detectCustomerDocumentConflict(
  saved: { name: string; phone?: string | null; email?: string | null; address?: string | null },
  extracted: { name?: string | null; phone?: string | null; email?: string | null; address?: string | null },
) {
  const issues: string[] = []
  const savedName = firstLastName(saved.name)
  const extractedName = firstLastName(extracted.name)
  const sameFirst = Boolean(savedName.first && extractedName.first && savedName.first === extractedName.first)
  const sameLast = Boolean(savedName.last && extractedName.last && savedName.last === extractedName.last)
  const savedPhone = normalizePhone(saved.phone)
  const extractedPhone = normalizePhone(extracted.phone)
  const savedEmail = normalizeText(saved.email)
  const extractedEmail = normalizeText(extracted.email)
  const savedAddress = normalizeText(saved.address)
  const extractedAddress = normalizeText(extracted.address)

  if (extracted.name && normalizeText(saved.name) !== normalizeText(extracted.name)) {
    issues.push(sameFirst || sameLast ? 'minor_name_variation' : 'name_mismatch')
  }
  if (savedPhone && extractedPhone && savedPhone !== extractedPhone) issues.push('phone_mismatch')
  if (savedEmail && extractedEmail && savedEmail !== extractedEmail) issues.push('email_mismatch')
  if (savedAddress && extractedAddress && savedAddress !== extractedAddress) issues.push('address_mismatch')

  let level: 'none' | 'minor_name_variation' | 'address_mismatch' | 'phone_mismatch' | 'high_conflict' = 'none'
  if (issues.includes('phone_mismatch')) level = 'phone_mismatch'
  if (issues.includes('address_mismatch')) level = level === 'phone_mismatch' ? 'high_conflict' : 'address_mismatch'
  if (issues.includes('name_mismatch') && (issues.includes('phone_mismatch') || issues.includes('address_mismatch'))) level = 'high_conflict'
  if (level === 'none' && issues.includes('minor_name_variation')) level = 'minor_name_variation'

  return {
    level,
    hasConflict: level !== 'none' && level !== 'minor_name_variation',
    issues,
    saved,
    extracted,
  }
}

async function resolveCustomerForTool(contractorId: string, input: { customerId?: string; customerName?: string; name?: string }) {
  if (input.customerId) {
    const customer = await db.customer.findFirst({
      where: { id: input.customerId, contractorId },
      select: { id: true, name: true, email: true, phone: true, address: true },
    })
    return customer ? { customer: withCustomerNumber(customer) } : { error: 'Customer not found' as const }
  }
  const raw = input.customerName || input.name || ''
  const terms = customerSearchTerms(raw)
  if (terms.length === 0) return { error: 'Customer name or customerId is required' as const }
  const customers = await db.customer.findMany({
    where: {
      contractorId,
      OR: terms.flatMap(term => [
        { name: containsInsensitive(term) },
        { phone: containsInsensitive(term) },
        { email: containsInsensitive(term) },
        { address: containsInsensitive(term) },
      ]),
    },
    orderBy: { updatedAt: 'desc' },
    take: 5,
    select: { id: true, name: true, email: true, phone: true, address: true },
  })
  if (customers.length === 0) return { notFound: true as const, query: raw }
  const normalized = normalizeText(normalizeCustomerFileQuery(raw))
  const exact = customers.find(c => normalizeText(c.name) === normalized || normalizeText(c.email) === normalized || normalizePhone(c.phone) === normalizePhone(raw))
  if (!exact && customers.length > 1) return { needsClarification: true as const, matches: customers.map(withCustomerNumber), query: raw }
  return { customer: withCustomerNumber(exact ?? customers[0]) }
}

type ApprovalDetail = {
  title: string
  summary: string
  targetLabel?: string | null
  destructive?: boolean
  details?: Array<{ label: string; value: string | number | null }>
}

function compactApprovalArgs(args: Record<string, unknown>) {
  return Object.entries(args)
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
    .slice(0, 8)
    .map(([label, value]) => ({ label, value: typeof value === 'object' ? stableStringify(value).slice(0, 120) : String(value) }))
}

async function buildApprovalDetailsForTool(name: string, args: Record<string, unknown>, contractorId: string): Promise<ApprovalDetail> {
  const human = humanizeToolName(name)

  if (name === 'delete_customer') {
    const customerId = typeof args.customerId === 'string' ? args.customerId : undefined
    const customerName = typeof args.customerName === 'string' ? args.customerName : undefined
    const resolved = await resolveCustomerForTool(contractorId, { customerId, customerName })
    if ('customer' in resolved) {
      const customer = resolved.customer
      if (!customer) {
        return {
          title: 'Approval needed: Delete client',
          summary: `Delete client matching "${customerName || customerId || 'unknown'}".`,
          targetLabel: customerName || customerId,
          destructive: true,
          details: compactApprovalArgs(args),
        }
      }
      const [documentCount, projectCount] = await Promise.all([
        db.document.count({ where: { contractorId, customerId: customer.id } }).catch(() => 0),
        db.project.count({ where: { contractorId, customerId: customer.id } }).catch(() => 0),
      ])
      const number = customerNumber(customer)
      return {
        title: `Approval needed: Delete ${customer.name}`,
        summary: `Delete client ${customer.name}${number ? ` (${number})` : ''}. Existing documents/photos/projects will be kept and detached from this client record.`,
        targetLabel: `${customer.name}${number ? ` (${number})` : ''}`,
        destructive: true,
        details: [
          { label: 'Action', value: 'Delete client record' },
          { label: 'Client', value: customer.name },
          { label: 'Client #', value: number },
          { label: 'Phone', value: customer.phone },
          { label: 'Email', value: customer.email },
          { label: 'Address', value: customer.address },
          { label: 'Files to keep/detach', value: documentCount },
          { label: 'Projects to keep/detach', value: projectCount },
        ],
      }
    }
    if ('needsClarification' in resolved) {
      return {
        title: 'Approval needed: Delete client',
        summary: `Multiple clients matched "${resolved.query}". Choose the exact client before approving deletion.`,
        targetLabel: resolved.query,
        destructive: true,
        details: (resolved.matches ?? []).slice(0, 5).map(c => ({ label: customerNumber(c) ?? 'Client', value: [c.name, c.phone, c.address].filter(Boolean).join(' · ') })),
      }
    }
    return {
      title: 'Approval needed: Delete client',
      summary: `Delete client matching "${customerName || customerId || 'unknown'}".`,
      targetLabel: customerName || customerId,
      destructive: true,
      details: compactApprovalArgs(args),
    }
  }

  if (name === 'delete_document') {
    const documentId = typeof args.documentId === 'string' ? args.documentId : ''
    const doc = documentId ? await db.document.findFirst({
      where: { id: documentId, contractorId },
      select: { id: true, originalName: true, fileType: true, status: true, size: true, customer: { select: { id: true, name: true } }, project: { select: { id: true, title: true } } },
    }).catch(() => null) : null
    if (doc) {
      return {
        title: `Approval needed: Delete ${doc.originalName}`,
        summary: `Delete file ${doc.originalName}. This removes the saved file and its analysis data.`,
        targetLabel: doc.originalName,
        destructive: true,
        details: [
          { label: 'Action', value: 'Delete file' },
          { label: 'File', value: doc.originalName },
          { label: 'Type', value: doc.fileType },
          { label: 'Status', value: doc.status },
          { label: 'Size', value: doc.size ? `${Math.round(doc.size / 1024)} KB` : null },
          { label: 'Client', value: doc.customer ? `${doc.customer.name}${customerNumber(doc.customer) ? ` (${customerNumber(doc.customer)})` : ''}` : 'Unassigned' },
          { label: 'Project', value: doc.project ? `${doc.project.title}${projectNumber(doc.project) ? ` (${projectNumber(doc.project)})` : ''}` : 'Unassigned' },
        ],
      }
    }
    return {
      title: 'Approval needed: Delete file',
      summary: `Delete file with documentId ${documentId || 'unknown'}.`,
      targetLabel: documentId,
      destructive: true,
      details: compactApprovalArgs(args),
    }
  }

  if (name === 'delete_documents_by_name') {
    const nameFilter = typeof args.nameFilter === 'string' ? args.nameFilter.trim() : ''
    const [count, docs] = await Promise.all([
      nameFilter ? db.document.count({ where: { contractorId, originalName: containsInsensitive(nameFilter) } }).catch(() => 0) : Promise.resolve(0),
      nameFilter ? db.document.findMany({
        where: { contractorId, originalName: containsInsensitive(nameFilter) },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { originalName: true },
      }).catch(() => []) : Promise.resolve([]),
    ])
    return {
      title: `Approval needed: Delete ${count || ''} matching file${count === 1 ? '' : 's'}`.trim(),
      summary: `Delete ${count} saved file${count === 1 ? '' : 's'} whose filename contains "${nameFilter}".`,
      targetLabel: nameFilter,
      destructive: true,
      details: [
        { label: 'Action', value: 'Delete matching files' },
        { label: 'Filename contains', value: nameFilter },
        { label: 'Matching files', value: count },
        ...docs.map((doc, index) => ({ label: index === 0 ? 'Examples' : '', value: doc.originalName })),
      ],
    }
  }

  if (name === 'clear_material_prices') {
    const count = await db.materialItem.count({ where: { contractorId } }).catch(() => 0)
    return {
      title: 'Approval needed: Clear material prices',
      summary: `Delete all ${count} saved material price item${count === 1 ? '' : 's'} for this company.`,
      targetLabel: 'All material prices',
      destructive: true,
      details: [
        { label: 'Action', value: 'Clear material price database' },
        { label: 'Rows affected', value: count },
      ],
    }
  }

  if (name === 'import_price_sheet_items') {
    const documentId = typeof args.documentId === 'string' ? args.documentId : ''
    const doc = documentId ? await db.document.findFirst({ where: { id: documentId, contractorId }, select: { id: true, originalName: true, fileType: true, extractedData: true } }).catch(() => null) : null
    const rows = doc?.extractedData ? pendingMaterialItemsFromExtractedData(safeJsonParse<Record<string, any>>(doc.extractedData, {})).length : null
    return {
      title: 'Approval needed: Import price sheet',
      summary: `Import ${rows ?? 'extracted'} material price rows${doc?.originalName ? ` from ${doc.originalName}` : ''}.`,
      targetLabel: doc?.originalName ?? documentId,
      destructive: false,
      details: [
        { label: 'Action', value: 'Import material price rows' },
        { label: 'Document', value: doc?.originalName ?? documentId },
        { label: 'Mode', value: typeof args.mode === 'string' ? args.mode : 'append' },
        { label: 'Rows', value: rows },
      ],
    }
  }

  return {
    title: `Approval needed: ${human}`,
    summary: `Jobrolo wants to run ${human}. Review and approve before execution.`,
    targetLabel: null,
    destructive: false,
    details: compactApprovalArgs(args),
  }
}

function inferProjectTitle(input: { title?: string | null; customerName?: string | null; address?: string | null; projectType?: string | null; claimNumber?: string | null; jobNumber?: string | null }) {
  if (input.title?.trim()) {
    const title = input.title.trim()
    return input.jobNumber && !/\bJob\s*#?\s*\d{4,}\b/i.test(title) ? `Job #${input.jobNumber} — ${title}` : title
  }
  const type = input.projectType?.trim() || (input.claimNumber ? 'Claim' : 'Roof Project')
  const base = input.customerName?.trim() || input.address?.trim() || 'New Project'
  const title = `${base} ${type}`.trim()
  return input.jobNumber ? `Job #${input.jobNumber} — ${title}` : title
}

async function generateUniqueJobNumber(contractorId: string) {
  for (let i = 0; i < 20; i++) {
    const candidate = String(Math.floor(100000 + Math.random() * 900000))
    const existing = await db.project.findFirst({
      where: { contractorId, title: { contains: `Job #${candidate}` } },
      select: { id: true },
    }).catch(() => null)
    if (!existing) return candidate
  }
  return String(Math.floor(100000 + Math.random() * 900000))
}

async function createProjectRecordForCustomer(contractorId: string, ctx: ToolContext, input: {
  customer: { id: string; name: string; address: string | null; phone?: string | null; email?: string | null }
  title?: string | null
  address?: string | null
  projectType?: string | null
  stage?: string | null
  value?: number | null
  deductible?: number | null
  claimNumber?: string | null
  carrier?: string | null
  dateOfLoss?: string | null
  jobNumber?: string | null
  notes?: string | null
  sourceDocumentId?: string | null
}) {
  const jobNumber = input.jobNumber || null
  const address = input.address?.trim() || input.customer.address || null
  const title = inferProjectTitle({
    title: input.title,
    customerName: input.customer.name,
    address,
    projectType: input.projectType,
    claimNumber: input.claimNumber,
    jobNumber,
  })
  const project = await db.project.create({
    data: {
      contractorId,
      customerId: input.customer.id,
      title,
      address,
      value: typeof input.value === 'number' && Number.isFinite(input.value) ? input.value : undefined,
      status: input.stage?.trim() || 'active',
      priority: 'medium',
    },
  })

  const metadata = {
    jobNumber,
    projectType: input.projectType ?? null,
    deductible: input.deductible ?? null,
    claimNumber: input.claimNumber ?? null,
    carrier: input.carrier ?? null,
    dateOfLoss: input.dateOfLoss ?? null,
    sourceDocumentId: input.sourceDocumentId ?? null,
  }
  const noteLines = [
    jobNumber ? `Job #${jobNumber}` : null,
    input.projectType ? `Project type: ${input.projectType}` : null,
    input.claimNumber ? `Claim number: ${input.claimNumber}` : null,
    input.carrier ? `Carrier: ${input.carrier}` : null,
    typeof input.deductible === 'number' ? `Deductible: $${input.deductible.toLocaleString()}` : null,
    input.dateOfLoss ? `Date of loss: ${input.dateOfLoss}` : null,
    input.notes?.trim() || null,
  ].filter(Boolean)
  if (noteLines.length) {
    await db.note.create({
      data: {
        projectId: project.id,
        customerId: input.customer.id,
        type: 'project_setup',
        content: noteLines.join('\n'),
        isAiGenerated: true,
        createdById: ctx.userId ?? undefined,
      },
    }).catch(() => null)
  }

  const workspace = await db.workspace.create({
    data: {
      contractorId,
      projectId: project.id,
      name: title,
      type: 'project',
      description: `Project workspace for ${input.customer.name}`,
      color: 'bg-blue-600',
      chats: {
        create: [
          { chatType: 'main', title: 'Main', visibility: 'internal' },
          { chatType: 'production', title: 'Production', visibility: 'internal' },
          { chatType: 'customer', title: 'Customer', visibility: 'customer' },
        ],
      },
    },
  }).catch(() => null)

  await ensureWorkspaceMember(workspace?.id, ctx)

  await createProjectTimelineEvent({
    contractorId,
    projectId: project.id,
    customerId: input.customer.id,
    eventType: 'project_created',
    title: `Project created: ${title}`,
    body: input.sourceDocumentId ? 'Created from extracted document data.' : 'Created from chat request.',
    relatedType: input.sourceDocumentId ? 'document' : 'project',
    relatedId: input.sourceDocumentId ?? project.id,
    source: 'ai',
    actorUserId: ctx.userId ?? null,
    metadata,
  })

  return { project, workspace, jobNumber, metadata }
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const TOOLS: ToolDef[] = [

  {
    name: 'get_contractor_profile',
    description: 'Get the contractor company profile used for roof reports, agreements, estimates, generated documents, signature pages, and customer-facing branding.',
    schema: z.object({}),
    allowedChannels: 'all',
    execute: async (_args, contractorId) => {
      const profile = await getOrCreateContractorProfile(contractorId)
      const publicProfile = publicContractorProfile(profile)
      const mergeContext = await buildProjectMergeData({ contractorId })
      return {
        success: true,
        data: {
          profile: publicProfile,
          availableMergeFields: Object.keys(mergeContext.data).sort(),
          mergePreview: mergeContext.data,
          card: {
            cardType: 'company_profile',
            profile: publicProfile,
            status: 'saved',
          },
        },
      }
    },
  },
  {
    name: 'research_contractor_website',
    description: 'Research the contractor company website or company name from the command center using the configured AI provider. Use when the owner gives their website, asks Jobrolo to search/research the business, or wants suggested company profile fields. This is read-only; call update_contractor_profile only if the user asks to save/update the profile.',
    schema: z.object({
      website: z.string().max(500).optional(),
      companyName: z.string().max(200).optional(),
    }).refine(v => Boolean(v.website?.trim() || v.companyName?.trim()), 'website or companyName is required'),
    allowedChannels: ['main', 'management'],
    execute: async (args, contractorId, ctx) => {
      if (!canManageCompanyProfile(ctx)) {
        return { success: false, data: null, error: 'Only an owner, admin, manager, project manager, or coordinator can research/update the company profile from chat.' }
      }
      console.log(`[tools-v2] research_contractor_website requested contractorId=${contractorId} website=${args.website ? 'provided' : 'none'} companyName=${args.companyName ? 'provided' : 'none'}`)
      const research = await researchCompany({ website: args.website, companyName: args.companyName })
      if (!research) {
        return {
          success: true,
          data: {
            found: false,
            website: args.website ?? null,
            companyName: args.companyName ?? null,
            message: 'I could not fetch enough website/company information to research this profile. Save the website manually or try the full https:// URL.',
          },
        }
      }
      const suggestedProfileUpdate = {
        companyName: research.companyName || args.companyName || undefined,
        displayName: research.companyName || args.companyName || undefined,
        phone: research.phone || undefined,
        email: research.email || undefined,
        website: research.website || args.website || undefined,
        metadata: {
          websiteResearch: {
            description: research.description ?? null,
            services: research.services,
            serviceAreas: research.serviceAreas,
            location: research.location ?? null,
            businessType: research.businessType ?? null,
            teamSizeEstimate: research.teamSizeEstimate ?? null,
            socialProfiles: research.socialProfiles,
            confidence: research.confidence,
            source: research.source,
            researchedAt: new Date().toISOString(),
          },
        },
      }
      return {
        success: true,
        data: {
          found: true,
          research,
          suggestedProfileUpdate,
          message: 'Website research completed. If the user wants this saved, call update_contractor_profile with suggestedProfileUpdate fields.',
        },
      }
    },
  },
  {
    name: 'update_contractor_profile',
    description: 'Update the contractor company profile from chat: company name, logo URL/document, contact info, website, address, license, brand colors, legal footer, default terms, warranty text, report/contract/estimate disclaimers. Use when the owner/admin asks to update company info. Role-limited; not for customer records.',
    schema: z.object({
      companyName: z.string().optional(),
      legalName: z.string().optional(),
      displayName: z.string().optional(),
      logoUrl: z.string().optional(),
      logoDocumentId: z.string().optional(),
      addressLine1: z.string().optional(),
      addressLine2: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      postalCode: z.string().optional(),
      country: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().email().optional(),
      website: z.string().optional(),
      licenseNumber: z.string().optional(),
      insuranceText: z.string().optional(),
      ownerName: z.string().optional(),
      publicContactName: z.string().optional(),
      publicContactTitle: z.string().optional(),
      brandPrimaryColor: z.string().optional(),
      brandAccentColor: z.string().optional(),
      brandMode: z.enum(['dark', 'light', 'auto']).optional(),
      defaultTerms: z.string().optional(),
      paymentInstructions: z.string().optional(),
      warrantyText: z.string().optional(),
      legalFooter: z.string().optional(),
      reportDisclaimer: z.string().optional(),
      contractDisclaimer: z.string().optional(),
      estimateDisclaimer: z.string().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }),
    allowedChannels: ['main', 'management'],
    execute: async (args, contractorId, ctx) => {
      if (!canManageCompanyProfile(ctx)) {
        return { success: false, data: null, error: 'Only an owner, admin, manager, project manager, or coordinator can update the company profile from chat.' }
      }
      const profile = await upsertContractorProfile(contractorId, args)
      const publicProfile = publicContractorProfile(profile)
      console.log(`[tools-v2] contractor profile updated contractorId=${contractorId} fields=${Object.keys(args).filter(k => typeof args[k] !== 'undefined').join(',')}`)
      return {
        success: true,
        data: {
          profile: publicProfile,
          updatedFields: Object.keys(args).filter(k => typeof args[k] !== 'undefined'),
          card: {
            cardType: 'company_profile',
            profile: publicProfile,
            status: 'updated',
          },
        },
      }
    },
  },
  {
    name: 'search_material_prices',
    description: 'Search the material price database by name, SKU, or category. Returns ALL matching items with unit costs. Use for any price question. If the user asks "show me everything" or "list all prices", call this with query "all". Understands roofing synonyms — searching "pipe jacks" will also find lead jacks, bullet boots, pipe boots, etc.',
    schema: z.object({ query: z.string().min(1).max(200) }),
    allowedChannels: ['main', 'supplier', 'finance', 'management', 'sales'],
    execute: async (args, contractorId) => {
      const query = args.query.toLowerCase().trim()

      // If user asks for "all" or "everything", return all items
      if (query === 'all' || query === 'everything') {
        const items = await db.materialItem.findMany({
          where: { contractorId },
          take: 200, orderBy: { name: 'asc' },
        })
        return {
          success: true,
          data: {
            count: items.length,
            items: items.map(i => ({ name: i.name, sku: i.sku, category: i.category, unit: i.unit, unitCost: i.unitCost })),
          },
        }
      }

      // Build search terms — include synonyms
      const searchTerms = [args.query]
      // Check if the query matches any synonym key
      for (const [key, synonyms] of Object.entries(ROOFING_SYNONYMS) as Array<[string, string[]]>) {
        if (query.includes(key) || key.includes(query)) {
          searchTerms.push(...synonyms)
        }
        // Also check if any synonym matches the query
        for (const syn of synonyms) {
          if (query.includes(syn)) {
            searchTerms.push(key, ...synonyms)
            break
          }
        }
      }
      // Add individual words from the query
      const words = args.query.split(/\s+/).filter(w => w.length > 2)
      searchTerms.push(...words)

      // Deduplicate search terms
      const uniqueTerms = [...new Set(searchTerms.map(t => t.toLowerCase()))]

      // Build OR conditions for each search term
      const orConditions = uniqueTerms.flatMap(term => [
        { name: { contains: term } },
        { sku: { contains: term } },
        { category: { contains: term } },
        { description: { contains: term } },
      ])

      const items = await db.materialItem.findMany({
        where: { contractorId, OR: orConditions },
        take: 200, orderBy: { name: 'asc' },
      })

      return {
        success: true,
        data: {
          count: items.length,
          searchTermsUsed: uniqueTerms.length > 1 ? uniqueTerms : undefined,
          items: items.map(i => ({ name: i.name, sku: i.sku, category: i.category, unit: i.unit, unitCost: i.unitCost })),
          note: items.length ? undefined : `No materials matching "${args.query}". Try a different term or upload a price sheet.`,
        },
      }
    },
  },
  {
    name: 'get_document_content',
    description: 'Get full extracted content from an uploaded document. ALWAYS call before answering about document contents. Returns ocrText (extracted text), extractedData (parsed line items / claim info), and metadata. If status is "needs_ocr" the document is a scanned PDF that requires OCR and has no extractable text yet.',
    schema: z.object({
      documentId: z.string().optional(),
      filename: z.string().optional(),
    }).refine(d => d.documentId || d.filename, 'Either documentId or filename required'),
    allowedChannels: 'all',
    execute: async (args, contractorId) => {
      let doc
      if (args.documentId) {
        doc = await db.document.findFirst({ where: { id: args.documentId, contractorId } })
      } else if (args.filename) {
        const lower = args.filename.toLowerCase()
        const all = await db.document.findMany({ where: { contractorId }, orderBy: { createdAt: 'desc' }, take: 50 })
        doc = all.find(d => d.originalName.toLowerCase().includes(lower))
      }
      if (!doc) return { success: false, data: null, error: 'Document not found. Call list_documents.' }
      let extractedData: unknown = null
      try { extractedData = doc.extractedData ? JSON.parse(doc.extractedData) : null } catch {}
      const parsedExtracted = (extractedData && typeof extractedData === 'object') ? extractedData as Record<string, any> : {}
      const isPhotoDocument = doc.fileType === 'photo' || doc.mimeType.startsWith('image/') || doc.aiCategory === 'photo'
      const documentReview = parsedExtracted.documentReview && typeof parsedExtracted.documentReview === 'object'
        ? parsedExtracted.documentReview as Record<string, any>
        : null

      // Smart truncation of OCR text: include head + tail with a marker
      const fullOcr = doc.ocrText ?? ''
      let ocrTextForContext = ''
      const MAX_OCR_FOR_CONTEXT = 12_000
      if (fullOcr.length > MAX_OCR_FOR_CONTEXT) {
        const headLen = Math.floor(MAX_OCR_FOR_CONTEXT * 0.7)
        const tailLen = MAX_OCR_FOR_CONTEXT - headLen - 50
        ocrTextForContext = fullOcr.slice(0, headLen) + '\n\n[...truncated...]\n\n' + fullOcr.slice(-tailLen)
      } else {
        ocrTextForContext = fullOcr
      }

      return {
        success: true,
        data: {
          id: doc.id,
          filename: doc.originalName,
          fileType: doc.fileType,
          mimeType: doc.mimeType,
          aiSummary: doc.aiSummary,
          aiCategory: doc.aiCategory,
          status: doc.status,
          extractionMethod: doc.extractionMethod,
          // Collaborative extraction fields
          extractionConfidence: doc.extractionConfidence,
          conflicts: doc.conflictFlags ? JSON.parse(doc.conflictFlags) : null,
          missingData: isPhotoDocument ? null : documentReview?.missingDataFlags ?? (doc.missingDataFlags ? JSON.parse(doc.missingDataFlags) : null),
          documentReview,
          reviewNotes: parsedExtracted.reviewNotes ?? [],
          warnings: isPhotoDocument
            ? (Array.isArray(parsedExtracted.warnings) ? parsedExtracted.warnings : []).filter((w: unknown) => !/claim|policy|carrier|deductible|rcv|acv|depreciation|line item|totals/i.test(String(w)))
            : parsedExtracted.warnings ?? [],
          extractedData,
          // OCR text — only returned if document has been processed
          ocrText: ocrTextForContext || null,
          ocrTextLength: fullOcr.length,
          ocrTruncated: fullOcr.length > MAX_OCR_FOR_CONTEXT,
          // Per-method text lengths for transparency
          embeddedTextLength: doc.embeddedText?.length ?? 0,
          visionTextLength: doc.visionText?.length ?? 0,
          url: toFileUrl(doc.filePath),
          thumbnailUrl: toThumbnailUrl(doc.thumbnailPath),
          customerId: doc.customerId,
          projectId: doc.projectId,
          workspaceId: doc.workspaceId,
          createdAt: doc.createdAt,
        },
      }
    },
  },
  {
    name: 'list_documents',
    description: 'List recently uploaded documents. Optional filter by fileType.',
    schema: z.object({ fileType: z.string().optional() }),
    allowedChannels: 'all',
    execute: async (args, contractorId) => {
      const docs = await db.document.findMany({
        where: { contractorId, ...(args.fileType ? { fileType: args.fileType } : {}) },
        orderBy: { createdAt: 'desc' }, take: 20,
        select: { id: true, originalName: true, fileType: true, aiSummary: true, aiCategory: true, status: true, filePath: true, thumbnailPath: true, mimeType: true, customerId: true, projectId: true, workspaceId: true, createdAt: true },
      })
      return {
        success: true,
        data: {
          count: docs.length,
          documents: docs.map(d => ({ ...d, url: toFileUrl(d.filePath), thumbnailUrl: toThumbnailUrl(d.thumbnailPath) })),
        },
      }
    },
  },
  {
    name: 'get_recent_uploads',
    description: 'List recent uploaded files/photos with save status, analysis status, links, and whether they are still unassigned. Use when the user asks what uploaded, whether uploads saved, what is pending analysis, or what still needs to be attached to a customer/project.',
    schema: z.object({
      limit: z.number().min(1).max(50).optional(),
      status: z.string().max(80).optional(),
      fileType: z.string().max(80).optional(),
      unlinkedOnly: z.boolean().optional(),
    }),
    allowedChannels: 'all',
    execute: async (args, contractorId) => {
      const where: any = {
        contractorId,
        ...(args.status ? { status: args.status } : {}),
        ...(args.fileType ? { fileType: args.fileType } : {}),
      }
      if (args.unlinkedOnly) {
        where.customerId = null
        where.projectId = null
        where.workspaceId = null
      }
      const documents = await db.document.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: args.limit ?? 20,
        select: {
          id: true,
          originalName: true,
          fileType: true,
          status: true,
          mimeType: true,
          size: true,
          filePath: true,
          thumbnailPath: true,
          aiSummary: true,
          aiCategory: true,
          extractionConfidence: true,
          missingDataFlags: true,
          conflictFlags: true,
          customerId: true,
          projectId: true,
          workspaceId: true,
          createdAt: true,
        },
      })
      const counts = documents.reduce((acc: Record<string, number>, doc) => {
        acc[doc.status] = (acc[doc.status] ?? 0) + 1
        return acc
      }, {})
      return {
        success: true,
        data: {
          count: documents.length,
          countsByStatus: counts,
          documents: documents.map(doc => {
            const isPhotoDocument = doc.fileType === 'photo' || doc.mimeType.startsWith('image/') || doc.aiCategory === 'photo'
            return {
              ...compactDocument(doc),
              aiCategory: doc.aiCategory,
              extractionConfidence: doc.extractionConfidence,
              missingData: isPhotoDocument ? null : safeJsonParse(doc.missingDataFlags, null),
              conflicts: safeJsonParse(doc.conflictFlags, null),
              needsLink: !doc.customerId && !doc.projectId && !doc.workspaceId,
              fileSaved: true,
              analysisPending: ['queued', 'processing', 'pending_review'].includes(doc.status),
            }
          }),
          guidance: 'A saved upload may still have analysis status queued/processing/pending_review. Treat fileSaved=true as saved, then separately report whether analysis/linking is complete.',
        },
      }
    },
  },
  {
    name: 'get_upload_status',
    description: 'Check one uploaded document/photo by documentId or filename. Returns whether the file row is saved, current analysis state, link state, recent processing jobs, and safe storage URLs.',
    schema: z.object({
      documentId: z.string().max(200).optional(),
      filename: z.string().max(300).optional(),
    }).refine(v => Boolean(v.documentId || v.filename), 'documentId or filename is required'),
    allowedChannels: 'all',
    execute: async (args, contractorId) => {
      let doc
      if (args.documentId) {
        doc = await db.document.findFirst({
          where: { id: args.documentId, contractorId },
          select: {
            id: true,
            originalName: true,
            fileType: true,
            status: true,
            mimeType: true,
            size: true,
            filePath: true,
            thumbnailPath: true,
            aiSummary: true,
            aiCategory: true,
            extractionConfidence: true,
            missingDataFlags: true,
            conflictFlags: true,
            customerId: true,
            projectId: true,
            workspaceId: true,
            createdAt: true,
          },
        })
      } else {
        const needle = String(args.filename ?? '').toLowerCase()
        const recent = await db.document.findMany({
          where: { contractorId },
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: {
            id: true,
            originalName: true,
            fileType: true,
            status: true,
            mimeType: true,
            size: true,
            filePath: true,
            thumbnailPath: true,
            aiSummary: true,
            aiCategory: true,
            extractionConfidence: true,
            missingDataFlags: true,
            conflictFlags: true,
            customerId: true,
            projectId: true,
            workspaceId: true,
            createdAt: true,
          },
        })
        doc = recent.find(d => d.originalName.toLowerCase().includes(needle))
      }
      if (!doc) return { success: true, data: { found: false, fileSaved: false, message: 'No saved upload matched that documentId or filename.' } }

      const jobs = await db.agentJob.findMany({
        where: { contractorId, type: 'doc_analysis', inputJson: { contains: doc.id } },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, status: true, heartbeat: true, error: true, createdAt: true, startedAt: true, completedAt: true },
      })

      return {
        success: true,
        data: {
          found: true,
          fileSaved: true,
          document: {
            ...compactDocument(doc),
            aiCategory: doc.aiCategory,
            extractionConfidence: doc.extractionConfidence,
            missingData: (doc.fileType === 'photo' || doc.mimeType.startsWith('image/') || doc.aiCategory === 'photo') ? null : safeJsonParse(doc.missingDataFlags, null),
            conflicts: safeJsonParse(doc.conflictFlags, null),
            needsLink: !doc.customerId && !doc.projectId && !doc.workspaceId,
          },
          analysisStatus: doc.status,
          analysisPending: ['queued', 'processing', 'pending_review'].includes(doc.status),
          linked: Boolean(doc.customerId || doc.projectId || doc.workspaceId),
          recentJobs: jobs,
          guidance: doc.status === 'failed'
            ? 'The file row is saved, but analysis failed. Tell the user it saved but did not analyze successfully.'
            : 'Report saved/link/analysis as separate facts. Do not say analysis is complete unless status is reviewed or needs_review with extracted data available.',
        },
      }
    },
  },

  {
    name: 'get_project_context',
    description: 'Get the full job context for a project: customer, schedule, appointments, tasks, notes, follow-ups, estimates, documents, OCR review status, signatures, roof reports, scope analysis, timeline, and next-action signals. Use before making recommendations or operational changes on a job.',
    schema: z.object({ projectId: z.string().min(1).max(200) }),
    allowedChannels: 'all',
    execute: async (args, contractorId, ctx) => {
      const context = await getProjectContextByContractor(args.projectId, contractorId)
      if (!context) return { success: false, data: null, error: 'Project not found' }
      return { success: true, data: context }
    },
  },
  {
    name: 'get_project_document_packet',
    description: 'Get all files and customer-facing documents attached to a job packet, including uploaded documents, OCR quality/review flags, roof reports, generated documents, signature requests, and scope analysis. Use when the user asks what files/docs are connected to a job.',
    schema: z.object({ projectId: z.string().min(1).max(200) }),
    allowedChannels: 'all',
    execute: async (args, contractorId) => {
      const packet = await getProjectDocumentPacket(args.projectId, contractorId)
      if (!packet) return { success: false, data: null, error: 'Project not found' }
      return { success: true, data: packet }
    },
  },
  {
    name: 'get_project_timeline',
    description: 'Get the unified Jobrolo timeline for a project/job: uploads, OCR review events, appointments, reports, generated documents, signatures, schedule updates, and other operational events.',
    schema: z.object({ projectId: z.string().min(1).max(200), limit: z.number().optional() }),
    allowedChannels: 'all',
    execute: async (args, contractorId) => {
      const timeline = await getProjectTimeline(args.projectId, contractorId, args.limit ?? 100)
      if (!timeline) return { success: false, data: null, error: 'Project not found' }
      return { success: true, data: timeline }
    },
  },
  {
    name: 'get_ocr_review_queue',
    description: 'List documents whose OCR/extraction quality needs human review. Use when checking which files are unreliable, conflicted, missing data, or need cleaner uploads.',
    schema: z.object({ projectId: z.string().optional(), limit: z.number().optional() }),
    allowedChannels: 'all',
    execute: async (args, contractorId) => {
      const queue = await getContractorOcrReviewQueue(contractorId, { projectId: args.projectId, limit: args.limit ?? 50 })
      return { success: true, data: queue }
    },
  },

  {
    name: 'link_document_to_project',
    description: 'Attach an uploaded document to a project/job packet with a role such as carrier_estimate, inspection_photo, signed_copy, authorization, contract, supplement, report_photo, or evidence. Use when a file must be tied to the correct job.',
    schema: z.object({
      documentId: z.string().min(1).max(200),
      projectId: z.string().min(1).max(200),
      customerId: z.string().optional(),
      role: z.string().default('attachment'),
      entityType: z.string().default('project'),
      entityId: z.string().optional(),
      label: z.string().optional(),
      notes: z.string().optional(),
    }),
    allowedChannels: ['main', 'management', 'sales'],
    requiresApproval: true,
    execute: async (args, contractorId) => {
      const project = await db.project.findFirst({ where: { id: args.projectId, contractorId }, select: { id: true, customerId: true } })
      if (!project) return { success: false, data: null, error: 'Project not found' }
      const link = await linkDocumentToJobPacket({
        contractorId,
        documentId: args.documentId,
        projectId: args.projectId,
        customerId: args.customerId ?? project.customerId ?? null,
        entityType: args.entityType,
        entityId: args.entityId ?? args.projectId,
        role: args.role,
        label: args.label,
        notes: args.notes,
        source: 'ai',
      })
      if (!link) return { success: false, data: null, error: 'Document not found or does not belong to this contractor' }
      return { success: true, data: { link } }
    },
  },
  {
    name: 'get_project_details',
    description: 'Get project details: customer, tasks, notes, memory.',
    schema: z.object({ workspaceName: z.string().min(1).max(200) }),
    allowedChannels: 'all',
    execute: async (args, contractorId) => {
      const ws = await db.workspace.findFirst({
        where: { contractorId, name: { contains: args.workspaceName } },
        include: {
          project: { include: {
            customer: { select: { id: true, name: true, phone: true, email: true, address: true } },
            tasks: { orderBy: { createdAt: 'desc' }, take: 20 },
            notes: { orderBy: { createdAt: 'desc' }, take: 10 },
          } },
          customer: true, subcontractor: true,
          chats: { select: { id: true, chatType: true, title: true } },
          memories: { orderBy: { createdAt: 'desc' }, take: 10 },
        },
      })
      if (!ws) return { success: false, data: null, error: `Workspace "${args.workspaceName}" not found.` }
      return { success: true, data: { id: ws.id, name: ws.name, type: ws.type, project: ws.project, customer: ws.customer, subcontractor: ws.subcontractor, chats: ws.chats, recentMemory: ws.memories } }
    },
  },
  {
    name: 'search_customers',
    description: 'Search customers by name, phone, email, or address. Use for specific customer lookups. For broad questions like "what clients do we have saved" or "list customers", use list_customers.',
    schema: z.object({ query: z.string().min(1).max(200) }),
    allowedChannels: 'all',
    execute: async (args, contractorId) => {
      const customers = await db.customer.findMany({
        where: { contractorId, OR: [
          { name: containsInsensitive(args.query) },
          { phone: containsInsensitive(args.query) },
          { email: containsInsensitive(args.query) },
          { address: containsInsensitive(args.query) },
        ] },
        orderBy: { updatedAt: 'desc' },
        take: 10,
      })
      return { success: true, data: { count: customers.length, customers: customers.map(withCustomerNumber) } }
    },
  },
  {
    name: 'list_customers',
    description: 'List saved customers/clients from the database. Use this before answering broad questions like "what clients do we have saved", "list customers", "who is in the CRM", or "show my clients". Never answer that there are no clients unless this tool returns count 0.',
    schema: z.object({
      query: z.string().max(200).optional(),
      limit: z.coerce.number().int().min(1).optional(),
    }),
    allowedChannels: 'all',
    execute: async (args, contractorId) => {
      const query = typeof args.query === 'string' ? args.query.trim() : ''
      const limit = Math.min(Math.max(Number(args.limit ?? 25), 1), 50)
      const customers = await db.customer.findMany({
        where: {
          contractorId,
          ...(query ? {
            OR: [
              { name: containsInsensitive(query) },
              { phone: containsInsensitive(query) },
              { email: containsInsensitive(query) },
              { address: containsInsensitive(query) },
              { notes: containsInsensitive(query) },
            ],
          } : {}),
        },
        orderBy: { updatedAt: 'desc' },
        take: limit,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          address: true,
          notes: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              projects: true,
              documents: true,
              noteRecords: true,
              followUps: true,
            },
          },
        },
      })
      return {
        success: true,
        data: {
          count: customers.length,
          query: query || null,
          limit,
          customers: customers.map(c => ({
            id: c.id,
            clientNumber: customerNumber(c),
            customerNumber: customerNumber(c),
            name: c.name,
            email: c.email,
            phone: c.phone,
            address: c.address,
            notes: c.notes,
            createdAt: c.createdAt,
            updatedAt: c.updatedAt,
            counts: {
              projects: c._count.projects,
              documents: c._count.documents,
              notes: c._count.noteRecords,
              followUps: c._count.followUps,
            },
          })),
          message: customers.length
            ? `Found ${customers.length} saved customer${customers.length === 1 ? '' : 's'}.`
            : 'No saved customer records found for this contractor.',
        },
      }
    },
  },
  {
    name: 'delete_customer',
    description: 'Delete a saved customer/client profile. Use only when the user asks to delete/remove a customer/client record. This does NOT delete their uploaded documents/photos or projects; it detaches those records from the customer so files are not accidentally lost.',
    schema: z.object({
      customerId: z.string().max(200).optional(),
      customerName: z.string().max(300).optional(),
    }).refine(v => Boolean(v.customerId || v.customerName), 'customerId or customerName is required'),
    allowedChannels: ['main', 'management'],
    requiresApproval: true,
    execute: async (args, contractorId) => {
      const resolved = await resolveCustomerForTool(contractorId, { customerId: args.customerId, customerName: args.customerName })
      if ('error' in resolved) return { success: false, data: null, error: resolved.error }
      if ('notFound' in resolved) return { success: true, data: { needsCustomer: true, query: resolved.query, message: `No saved customer found for ${resolved.query}.` } }
      if ('needsClarification' in resolved) return { success: true, data: { needsClarification: true, matches: resolved.matches, message: `Multiple customers matched ${resolved.query}. Which customer should be deleted?` } }
      const customer = resolved.customer
      const [documentCount, projectCount, workspaceCount] = await Promise.all([
        db.document.count({ where: { contractorId, customerId: customer.id } }),
        db.project.count({ where: { contractorId, customerId: customer.id } }),
        db.workspace.count({ where: { contractorId, customerId: customer.id } }),
      ])
      await db.document.updateMany({ where: { contractorId, customerId: customer.id }, data: { customerId: null } })
      await db.project.updateMany({ where: { contractorId, customerId: customer.id }, data: { customerId: null } })
      await db.workspace.updateMany({ where: { contractorId, customerId: customer.id }, data: { customerId: null } })
      await db.customer.delete({ where: { id: customer.id } })
      console.log(`[tools-v2] delete_customer: deleted customerId=${customer.id} contractorId=${contractorId} detachedDocuments=${documentCount} detachedProjects=${projectCount}`)
      return {
        success: true,
        data: {
          deleted: true,
          customerId: customer.id,
          clientNumber: customerNumber(customer),
          customerNumber: customerNumber(customer),
          customerName: customer.name,
          detached: { documents: documentCount, projects: projectCount, workspaces: workspaceCount },
          message: `Deleted customer "${customer.name}"${customerNumber(customer) ? ` (${customerNumber(customer)})` : ''}. Existing documents/photos/projects were kept and detached from that customer record.`,
        },
      }
    },
  },
  {
    name: 'get_customer_file',
    description: 'Resolve a customer by name, first/last name, phone, email, or address and return the saved customer file: customer details, projects/jobs, workspaces/chats, documents/photos, notes, tasks, and recent unlinked uploads. Use for "Timothy’s file", "show what is actually saved", "pull the job packet", or "what do we have on this customer".',
    schema: z.object({
      query: z.string().max(300).optional(),
      name: z.string().max(300).optional(),
      phone: z.string().max(80).optional(),
      email: z.string().max(200).optional(),
      address: z.string().max(500).optional(),
    }).refine(v => Boolean(v.query || v.name || v.phone || v.email || v.address), 'Provide name, phone, email, address, or query'),
    allowedChannels: 'all',
    execute: async (args, contractorId) => {
      const rawQuery = args.query || [args.name, args.phone, args.email, args.address].filter(Boolean).join(' ')
      const terms = customerSearchTerms(rawQuery)
      if (terms.length === 0) return { success: false, data: null, error: 'Customer search query required' }

      const customers = await db.customer.findMany({
        where: {
          contractorId,
          OR: terms.flatMap(term => [
            { name: containsInsensitive(term) },
            { phone: containsInsensitive(term) },
            { email: containsInsensitive(term) },
            { address: containsInsensitive(term) },
            ...(args.phone ? [{ phone: containsInsensitive(args.phone) }] : []),
            ...(args.email ? [{ email: containsInsensitive(args.email) }] : []),
            ...(args.address ? [{ address: containsInsensitive(args.address) }] : []),
          ]),
        },
        orderBy: { updatedAt: 'desc' },
        take: 10,
        select: { id: true, name: true, email: true, phone: true, address: true, notes: true, createdAt: true, updatedAt: true },
      })

      if (customers.length === 0) {
        return {
          success: true,
          data: {
            found: false,
            query: rawQuery,
            normalizedQuery: normalizeCustomerFileQuery(rawQuery),
            searchedTerms: terms,
            message: `No saved customer record found for ${rawQuery}.`,
          },
        }
      }

      const normalized = normalizeCustomerFileQuery(rawQuery).toLowerCase()
      const exact = customers.find(c =>
        c.name.toLowerCase() === normalized ||
        c.email?.toLowerCase() === normalized ||
        normalizePhone(c.phone) === normalizePhone(normalized) ||
        Boolean(args.email && c.email?.toLowerCase() === args.email.toLowerCase()) ||
        Boolean(args.phone && normalizePhone(c.phone) === normalizePhone(args.phone)) ||
        Boolean(args.address && c.address?.toLowerCase().includes(args.address.toLowerCase()))
      )
      const customer = exact ?? customers[0]
      if (!exact && customers.length > 1) {
        return {
          success: true,
          data: {
            found: true,
            needsClarification: true,
            query: rawQuery,
            normalizedQuery: normalizeCustomerFileQuery(rawQuery),
            matches: customers.map(c => ({ id: c.id, clientNumber: customerNumber(c), customerNumber: customerNumber(c), name: c.name, email: c.email, phone: c.phone, address: c.address })),
            message: 'Multiple saved customers matched. Ask the user which customer file to open before making changes.',
          },
        }
      }

      const projects = await db.project.findMany({
        where: { contractorId, customerId: customer.id },
        orderBy: { updatedAt: 'desc' },
        take: 20,
        select: {
          id: true, title: true, status: true, priority: true, address: true, value: true, createdAt: true, updatedAt: true,
          workspace: { select: { id: true, name: true, type: true, status: true, chats: { select: { id: true, chatType: true, title: true, visibility: true, lastActivity: true } } } },
        },
      })
      const projectIds = projects.map(p => p.id)

      const [documents, notes, tasks, directWorkspace, documentLinks, recentUnlinkedDocuments] = await Promise.all([
        db.document.findMany({
          where: {
            contractorId,
            OR: [
              { customerId: customer.id },
              ...(projectIds.length ? [{ projectId: { in: projectIds } }] : []),
            ],
          },
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: { id: true, originalName: true, fileType: true, status: true, mimeType: true, size: true, filePath: true, thumbnailPath: true, aiSummary: true, customerId: true, projectId: true, workspaceId: true, createdAt: true },
        }),
        db.note.findMany({
          where: { OR: [{ customerId: customer.id }, ...(projectIds.length ? [{ projectId: { in: projectIds } }] : [])] },
          orderBy: { createdAt: 'desc' },
          take: 30,
          select: { id: true, projectId: true, customerId: true, type: true, content: true, isAiGenerated: true, createdAt: true },
        }),
        projectIds.length ? db.task.findMany({
          where: { projectId: { in: projectIds } },
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: { id: true, projectId: true, title: true, description: true, status: true, priority: true, dueDate: true, completedAt: true, createdAt: true },
        }) : Promise.resolve([]),
        db.workspace.findFirst({
          where: { contractorId, customerId: customer.id },
          select: { id: true, name: true, type: true, status: true, chats: { select: { id: true, chatType: true, title: true, visibility: true, lastActivity: true } } },
        }),
        db.documentLink.findMany({
          where: {
            contractorId,
            OR: [
              { customerId: customer.id },
              ...(projectIds.length ? [{ projectId: { in: projectIds } }] : []),
            ],
          },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
        db.document.findMany({
          where: { contractorId, customerId: null, projectId: null, workspaceId: null },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: { id: true, originalName: true, fileType: true, status: true, mimeType: true, size: true, filePath: true, thumbnailPath: true, aiSummary: true, customerId: true, projectId: true, workspaceId: true, createdAt: true },
        }),
      ])

      const photos = documents.filter(d => d.fileType === 'photo' || d.mimeType.startsWith('image/'))

      return {
        success: true,
        data: {
          found: true,
          query: rawQuery,
          normalizedQuery: normalizeCustomerFileQuery(rawQuery),
          searchedTerms: terms,
          customer: withCustomerNumber(customer),
          counts: {
            projects: projects.length,
            documents: documents.length,
            photos: photos.length,
            notes: notes.length,
            tasks: tasks.length,
            documentLinks: documentLinks.length,
            recentUnlinkedDocuments: recentUnlinkedDocuments.length,
          },
          projects: projects.map(p => withProjectNumber(p)),
          workspace: directWorkspace,
          documents: documents.map(compactDocument),
          photos: photos.map(compactDocument),
          notes,
          tasks,
          documentLinks,
          recentUnlinkedDocuments: recentUnlinkedDocuments.map(compactDocument),
          guidance: recentUnlinkedDocuments.length
            ? 'Some recent uploads are not linked to any customer/project/workspace yet. Do not say they are in this customer file unless a link tool succeeds.'
            : undefined,
        },
      }
    },
  },
  {
    name: 'save_customer_note',
    description: 'Save an operational note to a customer profile/file from main chat. Use when the user asks to save notes, profile info, customer preferences, job context, call notes, or "remember this for this customer". This creates a real Note row and should be used instead of narrating that notes were saved.',
    schema: z.object({
      customerId: z.string().max(200).optional(),
      customerName: z.string().max(300).optional(),
      projectId: z.string().max(200).optional(),
      content: z.string().min(1).max(10000),
      noteType: z.string().max(80).optional(),
      documentIds: z.array(z.string().max(200)).optional(),
    }).refine(v => Boolean(v.customerId || v.customerName), 'customerId or customerName is required'),
    allowedChannels: ['main', 'management', 'sales', 'insurance'],
    execute: async (args, contractorId, ctx) => {
      const resolved = await resolveCustomerForTool(contractorId, { customerId: args.customerId, customerName: args.customerName })
      if ('error' in resolved) return { success: false, data: null, error: resolved.error }
      if ('notFound' in resolved) {
        return {
          success: true,
          data: {
            saved: false,
            needsCustomer: true,
            query: resolved.query,
            message: `No saved customer matched "${resolved.query}". Create or choose a customer before saving the note.`,
          },
        }
      }
      if ('needsClarification' in resolved) {
        return {
          success: true,
          data: {
            saved: false,
            needsClarification: true,
            matches: resolved.matches,
            message: 'Multiple customers matched. Ask which customer file should receive this note.',
          },
        }
      }
      const customer = resolved.customer

      let projectId: string | null = null
      if (args.projectId) {
        const project = await db.project.findFirst({
          where: { id: args.projectId, contractorId },
          select: { id: true, customerId: true, title: true },
        })
        if (!project) return { success: false, data: null, error: 'Project not found' }
        if (project.customerId && project.customerId !== customer.id) {
          return { success: false, data: null, error: `Project "${project.title}" belongs to a different customer. Note was not saved.` }
        }
        projectId = project.id
      }

      const note = await db.note.create({
        data: {
          customerId: customer.id,
          projectId,
          type: args.noteType?.trim() || 'general',
          content: args.content.trim(),
          isAiGenerated: false,
          createdById: ctx.userId ?? undefined,
        },
      })

      const validDocumentIds = (args.documentIds || []).filter(Boolean)
      if (validDocumentIds.length > 0 && projectId) {
        for (const documentId of validDocumentIds.slice(0, 10)) {
          await linkDocumentToJobPacket({
            contractorId,
            documentId,
            projectId,
            customerId: customer.id,
            entityType: 'note',
            entityId: note.id,
            role: 'note_attachment',
            label: `Attached to note ${note.id}`,
            source: 'ai',
            metadata: { linkedVia: 'save_customer_note' },
          }).catch(() => null)
        }
      }

      console.log(`[tools-v2] save_customer_note: saved note ${note.id} for ${customer.name}`)
      return {
        success: true,
        data: {
          saved: true,
          note: { id: note.id, type: note.type, content: note.content, customerId: note.customerId, projectId: note.projectId, createdAt: note.createdAt },
          customer,
          linkedDocumentIds: projectId ? validDocumentIds.slice(0, 10) : [],
          message: projectId
            ? `Saved note to ${customer.name}'s project/customer file.`
            : `Saved note to ${customer.name}'s customer file.`,
        },
      }
    },
  },
  {
    name: 'get_workspace_memory',
    description: 'Get recent memory entries for a workspace. Optional category filter.',
    schema: z.object({ workspaceName: z.string().min(1).max(200), category: z.string().optional() }),
    allowedChannels: 'all',
    execute: async (args, contractorId) => {
      const ws = await db.workspace.findFirst({ where: { contractorId, name: { contains: args.workspaceName } } })
      if (!ws) return { success: false, data: null, error: 'Workspace not found.' }
      const memories = await db.workspaceMemory.findMany({
        where: { workspaceId: ws.id, ...(args.category ? { category: args.category } : {}) },
        orderBy: { createdAt: 'desc' }, take: 30,
      })
      return { success: true, data: { workspaceId: ws.id, workspaceName: ws.name, count: memories.length, memories: memories.map(m => ({ category: m.category, content: m.content, createdAt: m.createdAt })) } }
    },
  },
  {
    name: 'list_photos',
    description: 'List uploaded photos. Returns URLs for attaching to responses.',
    schema: z.object({ workspaceName: z.string().optional() }),
    allowedChannels: 'all',
    execute: async (args, contractorId) => {
      let workspaceId: string | undefined
      if (args.workspaceName) {
        const ws = await db.workspace.findFirst({ where: { contractorId, name: { contains: args.workspaceName } }, select: { id: true } })
        workspaceId = ws?.id
      }
      const where: any = { contractorId, fileType: 'photo' }
      if (workspaceId) where.workspaceId = workspaceId
      const photos = await db.document.findMany({
        where, orderBy: { createdAt: 'desc' }, take: 30,
        select: { id: true, originalName: true, aiSummary: true, filePath: true, thumbnailPath: true, mimeType: true, createdAt: true },
      })
      return { success: true, data: { count: photos.length, photos: photos.map(p => ({ id: p.id, filename: p.originalName, summary: p.aiSummary, url: toFileUrl(p.filePath), thumbnailUrl: toThumbnailUrl(p.thumbnailPath), createdAt: p.createdAt })) } }
    },
  },
  {
    name: 'create_customer',
    description: 'Create a new customer. If a document was uploaded, call get_document_content FIRST to extract the customer info — do NOT ask the user to re-enter info that is in the document. Only ask for missing fields. Any uploaded documents will be automatically linked to the new customer.',
    schema: z.object({
      name: z.string().min(1).max(200),
      phone: z.string().max(50).optional(),
      email: z.string().email().optional().or(z.literal('')),
      address: z.string().max(500).optional(),
    }),
    allowedChannels: ['main', 'sales', 'management'],
    requiresApproval: true,
    execute: async (args, contractorId, ctx) => {
      if (!args.name?.trim()) return { success: false, data: null, error: 'Name required' }
      const existing = await db.customer.findFirst({ where: { contractorId, name: { contains: args.name } } })
      if (existing) {
        // Still link documents to the existing customer
        if (ctx.documentIds?.length) {
          await db.document.updateMany({
            where: { id: { in: ctx.documentIds }, contractorId },
            data: { customerId: existing.id },
          }).catch(() => {})
        }
        return { success: true, data: { id: existing.id, name: existing.name, message: `"${existing.name}" already exists.${ctx.documentIds?.length ? ` ${ctx.documentIds.length} document(s) linked to their account.` : ''}` } }
      }
      const customer = await db.customer.create({
        data: {
          contractorId, name: args.name.trim(),
          phone: args.phone?.trim() || null,
          email: args.email?.trim() || null,
          address: args.address?.trim() || null,
        },
      })
      // Auto-link any uploaded documents to this new customer
      let linkedDocs = 0
      if (ctx.documentIds?.length) {
        const result = await db.document.updateMany({
          where: { id: { in: ctx.documentIds }, contractorId },
          data: { customerId: customer.id },
        }).catch(() => null)
        linkedDocs = result?.count ?? 0
      }

      return {
        success: true,
        data: {
          id: customer.id,
          name: customer.name,
          message: `Customer "${customer.name}" created.${linkedDocs > 0 ? ` ${linkedDocs} document(s) saved to their account and data extracted.` : ''}`,
          linkedDocuments: linkedDocs,
        },
      }
    },
  },
  {
    name: 'review_price_sheet_items',
    description: 'Review extracted material rows from a supplier price sheet document. Read-only. Use for "show the first 10 price sheet items", "are they pending or imported?", or "review this supplier price sheet". Does not import or change prices.',
    schema: z.object({
      documentId: z.string().max(200).optional(),
      filename: z.string().max(300).optional(),
      limit: z.number().int().min(1).max(50).optional(),
      status: z.enum(['pending', 'imported', 'all']).optional(),
    }),
    allowedChannels: 'all',
    execute: async (args, contractorId) => {
      console.log(`[price-sheet] review requested contractorId=${contractorId} documentId=${args.documentId ?? ''} filename=${args.filename ?? ''}`)
      let doc
      if (args.documentId) {
        doc = await db.document.findFirst({
          where: { id: args.documentId, contractorId },
          select: { id: true, originalName: true, fileType: true, aiCategory: true, extractedData: true, status: true, extractionConfidence: true },
        })
      } else {
        const needle = String(args.filename ?? '').trim()
        const docs = await db.document.findMany({
          where: { contractorId },
          orderBy: { createdAt: 'desc' },
          take: 100,
          select: { id: true, originalName: true, fileType: true, aiCategory: true, extractedData: true, status: true, extractionConfidence: true },
        })
        const likelyPriceSheets = docs
          .map(d => ({ doc: d, rows: materialRowCountFromDocument(d), score: needle ? scoreDocumentNameMatch(d.originalName, needle) : 0 }))
          .filter(item => item.doc.fileType === 'price_sheet' || item.doc.aiCategory === 'price_sheet' || item.rows > 0)
        if (needle) {
          doc = likelyPriceSheets
            .sort((a, b) => (b.score + Math.min(b.rows, 20)) - (a.score + Math.min(a.rows, 20)))[0]
            ?.doc
          if (doc && scoreDocumentNameMatch(doc.originalName, needle) < 25 && likelyPriceSheets.length > 1) {
            return {
              success: true,
              data: {
                needsClarification: true,
                query: needle,
                candidates: likelyPriceSheets.slice(0, 5).map(item => ({
                  documentId: item.doc.id,
                  filename: item.doc.originalName,
                  fileType: item.doc.fileType,
                  rowCount: item.rows,
                })),
                message: `I found multiple possible price sheets. Which one should I review?`,
              },
            }
          }
        } else {
          doc = likelyPriceSheets[0]?.doc
        }
      }
      if (!doc) return { success: false, data: null, error: 'Price sheet document not found. Call list_documents first if you need the documentId.' }

      const data = safeJsonParse<Record<string, any>>(doc.extractedData, {})
      const rows = pendingMaterialItemsFromExtractedData(data)
      const isPriceSheet = doc.fileType === 'price_sheet' || doc.aiCategory === 'price_sheet' || rows.length > 0
      if (!isPriceSheet) {
        return { success: true, data: { documentId: doc.id, filename: doc.originalName, isPriceSheet: false, message: 'This document is not classified as a supplier price sheet and has no extracted material rows.' } }
      }
      const importStatus = data.priceSheetReview?.status === 'imported'
        ? 'imported'
        : rows.length > 0
          ? 'pending review'
          : 'unknown'
      if (rows.length === 0) {
        return {
          success: true,
          data: {
            documentId: doc.id,
            filename: doc.originalName,
            supplier: supplierFromExtractedData(data),
            effectiveDate: effectiveDateFromExtractedData(data),
            totalExtractedRowCount: Number(data.priceSheetReview?.extractedRowCount ?? 0),
            importStatus,
            rows: [],
            message: 'This price sheet was detected, but extracted row data is not available for review yet.',
          },
        }
      }
      const limit = args.limit ?? 10
      return {
        success: true,
        data: {
          documentId: doc.id,
          filename: doc.originalName,
          supplier: supplierFromExtractedData(data),
          effectiveDate: effectiveDateFromExtractedData(data),
          confidence: doc.extractionConfidence,
          totalExtractedRowCount: rows.length,
          importStatus,
          rows: rows.slice(0, limit).map((row, index) => ({
            rowNumber: index + 1,
            itemName: row.name,
            category: row.category,
            sku: row.sku,
            unit: row.unit,
            unitPrice: row.unitCost,
            confidence: null,
            notes: null,
          })),
          message: `Found ${rows.length} extracted material row(s). They are ${importStatus}; no material prices were changed by this review.`,
        },
      }
    },
  },
  {
    name: 'create_project_for_customer',
    description: 'Create a real project/job for an existing customer, optionally generating a 6-digit job number and project workspace. Use for "create a job/project for Timothy", "create a new 6-digit project/job", or before saving scope text to a job file.',
    schema: z.object({
      customerId: z.string().max(200).optional(),
      customerName: z.string().max(300).optional(),
      title: z.string().max(300).optional(),
      address: z.string().max(500).optional(),
      projectType: z.string().max(120).optional(),
      stage: z.string().max(80).optional(),
      value: z.number().optional(),
      deductible: z.number().optional(),
      claimNumber: z.string().max(120).optional(),
      carrier: z.string().max(160).optional(),
      dateOfLoss: z.string().max(80).optional(),
      jobNumber: z.string().max(40).optional(),
      generateJobNumber: z.boolean().optional(),
      notes: z.string().max(2000).optional(),
    }).refine(v => Boolean(v.customerId || v.customerName), 'customerId or customerName is required'),
    allowedChannels: ['main', 'management', 'sales', 'insurance'],
    execute: async (args, contractorId, ctx) => {
      const resolved = await resolveCustomerForTool(contractorId, { customerId: args.customerId, customerName: args.customerName })
      if ('error' in resolved) return { success: false, data: null, error: resolved.error }
      if ('notFound' in resolved) return { success: true, data: { needsCustomer: true, query: resolved.query, message: `No saved customer found for ${resolved.query}. Create or select the customer before creating a project.` } }
      if ('needsClarification' in resolved) return { success: true, data: { needsClarification: true, matches: resolved.matches, message: `Multiple customers matched ${resolved.query}. Which customer should this project belong to?` } }
      const customer = resolved.customer
      const jobNumber = args.jobNumber || (args.generateJobNumber === false ? null : await generateUniqueJobNumber(contractorId))
      const created = await createProjectRecordForCustomer(contractorId, ctx, {
        customer,
        title: args.title,
        address: args.address,
        projectType: args.projectType,
        stage: args.stage,
        value: args.value,
        deductible: args.deductible,
        claimNumber: args.claimNumber,
        carrier: args.carrier,
        dateOfLoss: args.dateOfLoss,
        jobNumber,
        notes: args.notes,
      })
      const displayProjectNumber = created.jobNumber ? `J-${created.jobNumber}` : projectNumber(created.project)
      return {
        success: true,
        data: {
          created: true,
          projectId: created.project.id,
          projectNumber: displayProjectNumber,
          title: created.project.title,
          customer: withCustomerNumber({ id: customer.id, name: customer.name, phone: customer.phone, email: customer.email, address: customer.address }),
          address: created.project.address,
          status: created.project.status,
          value: created.project.value,
          jobNumber: created.jobNumber,
          workspaceId: created.workspace?.id ?? null,
          message: `Created project "${created.project.title}"${displayProjectNumber ? ` (${displayProjectNumber})` : ''} for ${customer.name}${customerNumber(customer) ? ` (${customerNumber(customer)})` : ''}.`,
        },
      }
    },
  },
  {
    name: 'create_project_chat',
    description: 'Create or open a chat channel for a customer/project workspace, such as a crew chat, roofing crew chat, gutter crew chat, window crew chat, subcontractor chat, customer-facing chat, sales chat, supplement chat, production chat, or insurance chat. Use when the user says "create a crew chat for Timothy" or wants to route a message to a job-specific chat. Separate trade crew chatTypes can coexist on the same job.',
    schema: z.object({
      workspaceId: z.string().max(200).optional(),
      projectId: z.string().max(200).optional(),
      customerId: z.string().max(200).optional(),
      customerName: z.string().max(300).optional(),
      chatType: PROJECT_CHAT_TYPE_SCHEMA.default('crew'),
      title: z.string().max(200).optional(),
      initialMessage: z.string().max(2000).optional(),
    }),
    allowedChannels: ['main', 'management', 'sales', 'crew', 'customer'],
    execute: async (args, contractorId, ctx) => {
      const chatType = normalizeProjectChatType(args.chatType, [args.title, args.initialMessage, args.customerName])
      const role = normalizeRole(ctx.userRole)
      if ((role === 'crew' || role === 'subcontractor') && !isCrewLikeChatType(chatType)) {
        return { success: true, data: { needsApproval: true, message: 'Crew/subcontractor users can create crew/subcontractor chat threads only. Ask a project manager to create customer, sales, finance, insurance, or management chats.' } }
      }
      if (role === 'customer' && chatType !== 'customer') {
        return { success: true, data: { needsApproval: true, message: 'Customer users can create customer-facing chat threads only. Ask the project team for internal crew/team chats.' } }
      }
      let project: { id: string; title: string; customerId: string | null; address: string | null; workspace: { id: string } | null; customer: { id: string; name: string; address: string | null } | null } | null = null
      let customer: { id: string; name: string; address: string | null } | null = null

      if (args.workspaceId || (!args.projectId && !args.customerId && !args.customerName && ctx.workspaceId)) {
        const workspace = await db.workspace.findFirst({
          where: { id: args.workspaceId || ctx.workspaceId, contractorId, status: 'active' },
          select: {
            id: true,
            project: {
              select: {
                id: true,
                title: true,
                customerId: true,
                address: true,
                workspace: { select: { id: true } },
                customer: { select: { id: true, name: true, address: true } },
              },
            },
          },
        })
        if (!workspace?.project) return { success: false, data: null, error: 'Project workspace not found' }
        project = workspace.project
        customer = project.customer
      } else if (args.projectId) {
        project = await db.project.findFirst({
          where: { id: args.projectId, contractorId },
          select: { id: true, title: true, customerId: true, address: true, workspace: { select: { id: true } }, customer: { select: { id: true, name: true, address: true } } },
        })
        if (!project) return { success: false, data: null, error: 'Project not found' }
        customer = project.customer
      } else {
        if (!args.customerId && !args.customerName) {
          return { success: true, data: { needsProject: true, message: `Which customer or project should get the ${chatTypeLabel(chatType)} chat?` } }
        }
        const resolved = await resolveCustomerForTool(contractorId, { customerId: args.customerId, customerName: args.customerName })
        if ('error' in resolved) return { success: false, data: null, error: resolved.error }
        if ('notFound' in resolved) return { success: true, data: { needsCustomer: true, query: resolved.query, message: `No saved customer found for ${resolved.query}. Create or select the customer before creating a chat.` } }
        if ('needsClarification' in resolved) return { success: true, data: { needsClarification: true, matches: resolved.matches, message: `Multiple customers matched ${resolved.query}. Which customer's project should get this chat?` } }
        customer = resolved.customer
        const projects = await db.project.findMany({
          where: { contractorId, customerId: customer.id, status: { not: 'closed' } },
          orderBy: { updatedAt: 'desc' },
          take: 2,
          select: { id: true, title: true, customerId: true, address: true, workspace: { select: { id: true } }, customer: { select: { id: true, name: true, address: true } } },
        })
        if (projects.length === 0) {
          return { success: true, data: { needsProject: true, customer, message: `No active project found for ${customer.name}. Create a project/job first, then I can create the ${chatTypeLabel(chatType)} chat.` } }
        }
        if (projects.length > 1) {
          return { success: true, data: { needsClarification: true, customer, projects: projects.map(p => ({ id: p.id, title: p.title, address: p.address })), message: `Multiple active projects found for ${customer.name}. Which project should get the ${chatTypeLabel(chatType)} chat?` } }
        }
        project = projects[0]
      }

      let workspace = project.workspace
      if (!workspace) {
        workspace = await db.workspace.create({
          data: {
            contractorId,
            projectId: project.id,
            name: project.title,
            type: 'project',
            description: customer?.name ? `Workspace for ${customer.name}` : 'Project workspace',
            color: '#2563eb',
          },
          select: { id: true },
        })
      }
      await ensureWorkspaceMember(workspace.id, ctx)

      const defaultTitle = args.title || chatTypeLabel(chatType)
      const existed = await db.workspaceChat.findUnique({
        where: { workspaceId_chatType: { workspaceId: workspace.id, chatType } },
        select: { id: true },
      })
      const chat = await db.workspaceChat.upsert({
        where: { workspaceId_chatType: { workspaceId: workspace.id, chatType } },
        update: { title: defaultTitle, lastActivity: new Date() },
        create: {
          workspaceId: workspace.id,
          chatType,
          title: defaultTitle,
          visibility: isCustomerFacingChatType(chatType) ? 'customer' : 'internal',
        },
        select: { id: true, chatType: true, title: true, visibility: true, lastActivity: true },
      })

      let seededMessage: { id: string; content: string } | null = null
      const starterNote = args.initialMessage?.trim()
      if (starterNote) {
        const existingStarter = await db.workspaceMessage.findFirst({
          where: {
            chatId: chat.id,
            content: starterNote,
          },
          orderBy: { createdAt: 'desc' },
          select: { id: true, content: true },
        })
        seededMessage = existingStarter ?? await db.workspaceMessage.create({
          data: { chatId: chat.id, role: 'assistant', content: starterNote, createdById: ctx.userId },
          select: { id: true, content: true },
        })
      }
      await db.workspaceChat.update({ where: { id: chat.id }, data: { lastActivity: new Date() } }).catch(() => null)

      return {
        success: true,
        data: {
          created: true,
          workspaceId: workspace.id,
          projectId: project.id,
          projectNumber: projectNumber(project),
          projectTitle: project.title,
          customer: customer ? withCustomerNumber(customer) : null,
          chat,
          chatUrl: workspaceChatUrl(workspace.id, chat.id),
          seededMessage,
          card: {
            cardType: 'created_chat',
            workspaceId: workspace.id,
            chatId: chat.id,
            chatType: chat.chatType,
            chatTypeLabel: chatTypeLabel(chat.chatType),
            visibility: chat.visibility,
            title: chat.title,
            chatUrl: workspaceChatUrl(workspace.id, chat.id),
            projectId: project.id,
            projectTitle: project.title,
            projectNumber: projectNumber(project),
            customer: customer ? withCustomerNumber(customer) : null,
            attachedTo: {
              type: 'project',
              id: project.id,
              title: project.title,
              address: project.address,
            },
            reusedExisting: Boolean(existed),
            subcontractorRoleHint: isCrewLikeChatType(chat.chatType) ? chatTypeLabel(chat.chatType) : null,
          },
          message: `${existed ? 'Opened existing' : 'Created'} ${chatTypeLabel(chat.chatType)} chat for ${project.title}${projectNumber(project) ? ` (${projectNumber(project)})` : ''}${seededMessage ? ' and posted the starter note.' : '.'} Chat link: ${workspaceChatUrl(workspace.id, chat.id)}`,
        },
      }
    },
  },
  {
    name: 'invite_user_to_chat',
    description: 'Invite an employee, crew member, subcontractor, sales rep, manager, or customer/homeowner to a Jobrolo workspace chat. Creates an invited user, workspace membership, in-app notification, and one-time invite link that can be copied and texted manually. Use for "add Jose to the roofing crew chat", "invite homeowner to customer chat", "add employee to this job chat", or "give me a link to share". Requires approval because it grants chat access.',
    schema: z.object({
      workspaceId: z.string().max(200).optional(),
      projectId: z.string().max(200).optional(),
      customerId: z.string().max(200).optional(),
      customerName: z.string().max(300).optional(),
      chatId: z.string().max(200).optional(),
      chatType: PROJECT_CHAT_TYPE_SCHEMA.optional(),
      name: z.string().min(2).max(160),
      email: z.string().email().max(240),
      phone: z.string().max(60).optional(),
      role: z.enum(['employee', 'manager', 'sales', 'crew', 'subcontractor', 'customer']).optional(),
      sendEmail: z.boolean().optional(),
      sendSms: z.boolean().optional(),
      note: z.string().max(1000).optional(),
    }),
    allowedChannels: ['main', 'management', 'sales', 'crew', 'customer'],
    requiresApproval: true,
    execute: async (args, contractorId, ctx) => {
      let workspaceId = args.workspaceId || ctx.workspaceId || undefined
      let chatId = args.chatId || ctx.chatId || undefined
      let chatType = args.chatType ? normalizeProjectChatType(args.chatType, [args.note, args.name]) : undefined

      if (!workspaceId && args.projectId) {
        const workspace = await db.workspace.findFirst({
          where: { contractorId, projectId: args.projectId, status: 'active' },
          select: { id: true },
        })
        if (!workspace) return { success: true, data: { needsWorkspace: true, message: 'No active workspace found for that project.' } }
        workspaceId = workspace.id
      }

      if (!workspaceId && (args.customerId || args.customerName)) {
        const resolved = await resolveCustomerForTool(contractorId, { customerId: args.customerId, customerName: args.customerName })
        if ('error' in resolved) return { success: false, data: null, error: resolved.error }
        if ('notFound' in resolved) return { success: true, data: { needsCustomer: true, query: resolved.query, message: `No saved customer found for ${resolved.query}.` } }
        if ('needsClarification' in resolved) return { success: true, data: { needsClarification: true, matches: resolved.matches, message: `Multiple customers matched ${resolved.query}. Which customer should this invite attach to?` } }
        const workspace = await db.workspace.findFirst({
          where: {
            contractorId,
            status: 'active',
            OR: [
              { customerId: resolved.customer.id },
              { project: { customerId: resolved.customer.id } },
            ],
          },
          orderBy: { updatedAt: 'desc' },
          select: { id: true },
        })
        if (!workspace) return { success: true, data: { needsProject: true, customer: resolved.customer, message: `No active workspace/project found for ${resolved.customer.name}. Create a project first, then invite people to the chat.` } }
        workspaceId = workspace.id
      }

      if (!workspaceId) return { success: true, data: { needsWorkspace: true, message: 'Which workspace or job chat should I invite them to?' } }

      if (chatType) {
        const workspace = await db.workspace.findFirst({
          where: { id: workspaceId, contractorId, status: 'active' },
          select: { id: true, name: true },
        })
        if (!workspace) return { success: false, data: null, error: 'Workspace not found' }
        const chat = await db.workspaceChat.upsert({
          where: { workspaceId_chatType: { workspaceId, chatType } },
          update: { lastActivity: new Date() },
          create: {
            workspaceId,
            chatType,
            title: chatTypeLabel(chatType),
            visibility: isCustomerFacingChatType(chatType) ? 'customer' : 'internal',
          },
          select: { id: true },
        })
        chatId = chat.id
      }

      const invite = await createWorkspaceInvite(await buildTrustedToolTenantContext(contractorId, ctx), {
        workspaceId,
        chatId,
        name: args.name,
        email: args.email,
        phone: args.phone,
        role: args.role || (isCustomerFacingChatType(chatType) ? 'customer' : isCrewLikeChatType(chatType) ? 'crew' : 'employee'),
        sendEmail: args.sendEmail,
        sendSms: args.sendSms,
        note: args.note,
      })
      return { success: true, data: { ...invite, card: { cardType: 'chat_invite', ...invite } } }
    },
  },
  {
    name: 'create_project_from_document',
    description: 'Create a project/job from an extracted estimate, scope, or claim document after checking customer/document conflicts. Use when the user says "create a project from this uploaded estimate/document". If saved customer data conflicts with extracted name/phone/address, ask for resolution before linking.',
    schema: z.object({
      documentId: z.string().min(1).max(200),
      customerId: z.string().max(200).optional(),
      customerName: z.string().max(300).optional(),
      confirmConflictResolution: z.boolean().optional(),
      conflictResolution: z.enum(['attach_existing', 'create_new_customer', 'update_existing_customer', 'create_new_project_under_existing_customer', 'leave_unassigned']).optional(),
    }),
    allowedChannels: ['main', 'management', 'sales', 'insurance'],
    execute: async (args, contractorId, ctx) => {
      const doc = await db.document.findFirst({
        where: { id: args.documentId, contractorId },
        select: { id: true, originalName: true, fileType: true, aiCategory: true, extractedData: true, ocrText: true, customerId: true, projectId: true, extractionConfidence: true },
      })
      if (!doc) return { success: false, data: null, error: 'Document not found' }
      const data = safeJsonParse<Record<string, any>>(doc.extractedData, {})
      const extractedCustomer = {
        name: String(data.customer?.name ?? data.customerName ?? data.insuredName ?? data.name ?? '').trim() || null,
        phone: String(data.customer?.phone ?? data.phone ?? data.insuredPhone ?? '').trim() || null,
        email: String(data.customer?.email ?? data.email ?? '').trim() || null,
        address: String(data.projectAddress ?? data.customer?.address ?? data.propertyAddress ?? data.address ?? '').trim() || null,
      }
      const value = numberFromMoney(data.totalAmount ?? data.rcv ?? data.claimInfo?.rcv ?? data.claimInfo?.total)
      const deductible = numberFromMoney(data.claimInfo?.deductible ?? data.deductible)
      const carrier = String(data.claimInfo?.carrier ?? data.carrier ?? '').trim() || undefined
      const claimNumber = String(data.claimInfo?.claimNumber ?? data.claimNumber ?? '').trim() || undefined
      const projectType = doc.fileType === 'price_sheet' || doc.aiCategory === 'price_sheet' ? 'price sheet review' : 'roof/claim project'

      let resolved
      if (args.customerId || args.customerName) {
        resolved = await resolveCustomerForTool(contractorId, { customerId: args.customerId, customerName: args.customerName })
      } else if (doc.customerId) {
        resolved = await resolveCustomerForTool(contractorId, { customerId: doc.customerId })
      } else if (extractedCustomer.name) {
        resolved = await resolveCustomerForTool(contractorId, { customerName: extractedCustomer.name })
      }

      if (!resolved || 'notFound' in resolved || 'error' in resolved) {
        if (args.conflictResolution !== 'create_new_customer' || !args.confirmConflictResolution || !extractedCustomer.name) {
          return {
            success: true,
            data: {
              needsCustomer: true,
              documentId: doc.id,
              extractedCustomer,
              message: extractedCustomer.name
                ? `I found extracted customer info for ${extractedCustomer.name}, but no saved customer was selected. Confirm whether to create a new customer/project from this document.`
                : 'I could not identify a customer from this document. Select or create a customer before creating a project from it.',
            },
          }
        }
        const customer = await db.customer.create({
          data: {
            contractorId,
            name: extractedCustomer.name,
            phone: extractedCustomer.phone,
            email: extractedCustomer.email,
            address: extractedCustomer.address,
          },
        })
        resolved = { customer }
      }

      if ('needsClarification' in resolved) {
        return { success: true, data: { needsClarification: true, matches: resolved.matches, extractedCustomer, message: `Multiple customers matched. Which saved customer should this document/project attach to?` } }
      }

      const customer = resolved.customer
      const conflict = detectCustomerDocumentConflict(customer, extractedCustomer)
      if (conflict.hasConflict && !args.confirmConflictResolution) {
        console.warn(`[customer-resolver] document conflict detected contractorId=${contractorId} documentId=${doc.id} customerId=${customer.id} level=${conflict.level}`)
        console.warn(`[customer-resolver] awaiting user resolution contractorId=${contractorId} documentId=${doc.id}`)
        return {
          success: true,
          data: {
            needsConflictResolution: true,
            documentId: doc.id,
            customerCandidate: customer,
            extractedCustomer,
            conflict,
            message: `I found saved ${customer.name}, but this document appears to be for ${extractedCustomer.name ?? 'a customer'}${extractedCustomer.address ? ` at ${extractedCustomer.address}` : ''}${extractedCustomer.phone ? ` with phone ${extractedCustomer.phone}` : ''}. Is this the same customer, a different customer, or a new project?`,
          },
        }
      }

      if (args.conflictResolution === 'leave_unassigned') {
        return { success: true, data: { leftUnassigned: true, documentId: doc.id, message: 'Left the document unassigned. No project was created.' } }
      }

      if (args.conflictResolution === 'update_existing_customer' && args.confirmConflictResolution) {
        await db.customer.update({
          where: { id: customer.id },
          data: {
            phone: extractedCustomer.phone || customer.phone,
            email: extractedCustomer.email || customer.email,
            address: extractedCustomer.address || customer.address,
          },
        }).catch(() => null)
      }

      const jobNumber = await generateUniqueJobNumber(contractorId)
      const created = await createProjectRecordForCustomer(contractorId, ctx, {
        customer,
        title: `${customer.name} ${doc.fileType === 'scope_of_loss' || doc.aiCategory === 'estimate' ? 'Estimate/Scope' : 'Project'}`,
        address: extractedCustomer.address ?? customer.address,
        projectType,
        value,
        deductible,
        claimNumber,
        carrier,
        jobNumber,
        sourceDocumentId: doc.id,
        notes: `Created from ${doc.originalName}. Extraction confidence: ${doc.extractionConfidence ?? 'unknown'}.`,
      })
      await db.document.update({
        where: { id: doc.id },
        data: { customerId: customer.id, projectId: created.project.id },
      })
      const link = await linkDocumentToJobPacket({
        contractorId,
        documentId: doc.id,
        projectId: created.project.id,
        customerId: customer.id,
        entityType: 'project',
        entityId: created.project.id,
        role: doc.fileType === 'scope_of_loss' || doc.aiCategory === 'estimate' ? 'carrier_estimate' : 'source',
        source: 'ai',
        confidence: conflict.level === 'minor_name_variation' ? 0.85 : 1,
        metadata: { extractedCustomer, conflict },
      })
      if (doc.fileType === 'scope_of_loss' || doc.aiCategory === 'estimate' || Array.isArray(data.lineItems)) {
        await initScopeAnalysis(doc.id, contractorId).catch(() => null)
      }
      console.log(`[customer-resolver] conflict resolved contractorId=${contractorId} documentId=${doc.id} projectId=${created.project.id} level=${conflict.level}`)
      return {
        success: true,
        data: {
          created: true,
          documentId: doc.id,
          projectId: created.project.id,
          projectNumber: created.jobNumber ? `J-${created.jobNumber}` : projectNumber(created.project),
          title: created.project.title,
          customer: withCustomerNumber({ id: customer.id, name: customer.name, phone: customer.phone, email: customer.email, address: customer.address }),
          documentLinked: Boolean(link),
          conflict,
          message: `Created project "${created.project.title}"${created.jobNumber ? ` (J-${created.jobNumber})` : ''} from ${doc.originalName} and linked the document.`,
        },
      }
    },
  },
  {
    name: 'create_scope_from_text',
    description: 'Save pasted scope/estimate text as a real Document and ScopeAnalysis linked to a customer/project. Use when the user pastes scope text and asks to save it, create a scope breakdown, or attach it to a customer/job file.',
    schema: z.object({
      customerName: z.string().max(300).optional(),
      customerId: z.string().max(200).optional(),
      projectId: z.string().max(200).optional(),
      rawText: z.string().min(20).max(120000),
      source: z.enum(['pasted', 'extracted', 'uploaded']).optional(),
      title: z.string().max(300).optional(),
    }),
    allowedChannels: ['main', 'management', 'sales', 'insurance'],
    execute: async (args, contractorId, ctx) => {
      let customerId = args.customerId || undefined
      let projectId = args.projectId || undefined
      let customer: { id: string; name: string; address: string | null } | null = null
      let project: { id: string; title: string; customerId: string | null; address: string | null } | null = null

      if (!customerId && args.customerName) {
        const customerQuery = normalizeCustomerFileQuery(args.customerName) || args.customerName
        const matches = await db.customer.findMany({
          where: { contractorId, name: containsInsensitive(customerQuery) },
          take: 3,
          select: { id: true, name: true, address: true },
        })
        if (matches.length === 0) return { success: true, data: { needsCustomer: true, message: `No saved customer found for ${args.customerName}. Create or select a customer before saving this scope.` } }
        if (matches.length > 1) return { success: true, data: { needsClarification: true, matches, message: `Multiple customers matched ${args.customerName}. Which customer should this scope attach to?` } }
        customer = matches[0]
        customerId = customer.id
      }

      if (projectId) {
        const p = await db.project.findFirst({ where: { contractorId, id: projectId }, select: { id: true, title: true, customerId: true, address: true } })
        if (!p) return { success: false, data: null, error: 'Project not found' }
        project = p
        customerId = customerId ?? p.customerId ?? undefined
      } else if (customerId) {
        customer = customer ?? await db.customer.findFirst({ where: { contractorId, id: customerId }, select: { id: true, name: true, address: true } })
        if (!customer) return { success: false, data: null, error: 'Customer not found' }
        const projects = await db.project.findMany({
          where: { contractorId, customerId, status: { not: 'closed' } },
          orderBy: { updatedAt: 'desc' },
          take: 3,
          select: { id: true, title: true, customerId: true, address: true },
        })
        if (projects.length === 0) {
          return { success: true, data: { needsProject: true, customer, message: `No active project/job exists for ${customer.name}. Ask whether to create a project before saving this scope.` } }
        }
        if (projects.length > 1) {
          return { success: true, data: { needsClarification: true, customer, projects, message: `Multiple active projects found for ${customer.name}. Which project should this scope attach to?` } }
        }
        project = projects[0]
        projectId = project.id
      } else {
        return { success: true, data: { needsCustomer: true, message: 'Which customer or project should I attach this pasted scope to?' } }
      }

      const title = args.title?.trim() || `Pasted scope${customer?.name ? ` - ${customer.name}` : ''}`
      const saved = await saveFile({
        buffer: Buffer.from(args.rawText, 'utf8'),
        filename: `${title.replace(/[^a-z0-9._-]+/gi, '-').slice(0, 80) || 'pasted-scope'}.txt`,
        mimeType: 'text/plain',
        directory: 'docs',
      })
      const lineItems = scopeLineItemsFromText(args.rawText)
      const extractedData = {
        source: args.source ?? 'pasted',
        title,
        lineItems,
        rawLength: args.rawText.length,
        reviewNotes: lineItems.length ? [] : ['No structured line items were parsed. Review the pasted text manually.'],
      }
      const document = await db.document.create({
        data: {
          contractorId,
          uploadedById: ctx.userId ?? null,
          filename: saved.filename,
          originalName: `${title}.txt`,
          mimeType: 'text/plain',
          size: saved.size,
          filePath: saved.filePath,
          fileType: 'scope_of_loss',
          status: lineItems.length ? 'reviewed' : 'needs_review',
          customerId,
          projectId,
          extractedData: JSON.stringify(extractedData),
          embeddedText: args.rawText.slice(0, 100000),
          ocrText: args.rawText.slice(0, 100000),
          extractionMethod: 'text_direct',
          extractionConfidence: lineItems.length ? 85 : 45,
          aiSummary: `${lineItems.length} scope line item(s) parsed from pasted text.`,
          aiCategory: 'scope_of_loss',
        },
      })
      const scope = await initScopeAnalysis(document.id, contractorId)
      if (!scope) {
        return { success: true, data: { saved: true, needsReview: true, documentId: document.id, projectId, customerId, lineItemCount: lineItems.length, message: 'The pasted scope was saved as a document, but no ScopeAnalysis could be initialized from the parsed line items.' } }
      }
      return {
        success: true,
        data: {
          saved: true,
          documentId: document.id,
          scopeAnalysisCreated: true,
          projectId,
          customerId,
          lineItemCount: scope.lineItems.length,
          selectedRcv: scope.selectedRcv,
          retrievable: true,
          message: `Saved pasted scope to the job file with ${scope.lineItems.length} line item(s).`,
        },
      }
    },
  },
  {
    name: 'import_price_sheet_items',
    description: 'Import pending extracted material rows from a reviewed price sheet document into the contractor material database. Requires explicit user confirmation/approval. Never use this to clear or replace existing prices unless the user separately approved clearing.',
    schema: z.object({
      documentId: z.string().min(1).max(200),
      mode: z.enum(['append', 'replace']).optional(),
      confirm: z.boolean().optional(),
    }),
    allowedChannels: ['main', 'management', 'supplier', 'finance'],
    requiresApproval: true,
    execute: async (args, contractorId) => {
      const doc = await db.document.findFirst({
        where: { id: args.documentId, contractorId },
        select: { id: true, originalName: true, fileType: true, extractedData: true },
      })
      if (!doc) return { success: false, data: null, error: 'Price sheet document not found' }
      const data = safeJsonParse<Record<string, any>>(doc.extractedData, {})
      const items = pendingMaterialItemsFromExtractedData(data)
      if (items.length === 0) return { success: false, data: null, error: 'No pending material rows found on this document' }

      const mode = args.mode ?? 'append'
      if (mode === 'replace' && args.confirm !== true) {
        return { success: true, data: { confirmationRequired: true, documentId: doc.id, totalRows: items.length, message: 'Replacing existing material prices requires explicit confirmation. Ask whether to replace all existing prices or append/update only.' }, error: 'Replacement confirmation required' }
      }
      console.log(`[price-sheet] importing confirmed rows documentId=${doc.id} count=${items.length} mode=${mode}`)
      const existingItems = await db.materialItem.findMany({
        where: { contractorId },
        select: { id: true, name: true, unit: true, unitCost: true, sku: true },
      })
      if (mode === 'replace') {
        await db.materialItem.deleteMany({ where: { contractorId } })
      }
      const existingKeys = new Map(existingItems.map(i => [`${i.name.toLowerCase()}|${i.unit}|${i.sku ?? ''}`, i]))
      let created = 0
      let updated = 0
      let skipped = 0
      for (const item of items) {
        const key = `${item.name.toLowerCase()}|${item.unit}|${item.sku ?? ''}`
        const existing = mode === 'append' ? existingKeys.get(key) : undefined
        if (existing) {
          if (existing.unitCost !== item.unitCost) {
            await db.materialItem.update({ where: { id: existing.id }, data: { unitCost: item.unitCost, category: item.category, sku: item.sku } })
            updated++
          } else {
            skipped++
          }
        } else {
          const createdItem = await db.materialItem.create({
            data: {
              contractorId,
              name: item.name,
              sku: item.sku,
              category: item.category,
              unit: item.unit,
              unitCost: item.unitCost,
            },
          })
          existingKeys.set(key, createdItem)
          created++
        }
      }
      data.priceSheetReview = { ...(data.priceSheetReview ?? {}), status: 'imported', importedAt: new Date().toISOString(), mode, created, updated, skipped }
      await db.document.update({ where: { id: doc.id }, data: { extractedData: JSON.stringify(data), status: 'reviewed' } })
      console.log(`[price-sheet] import complete documentId=${doc.id} created=${created} updated=${updated} skipped=${skipped}`)
      return { success: true, data: { documentId: doc.id, originalName: doc.originalName, mode, created, updated, skipped, totalRows: items.length, message: `Imported ${created} material item(s), updated ${updated}, skipped ${skipped}.` } }
    },
  },
  {
    name: 'clear_material_prices',
    description: 'Delete ALL material price items for this contractor. Use when the user uploads a new price list and wants to replace the old one, or asks to "clear all prices". This removes all existing material items so the new price list can be loaded fresh.',
    schema: z.object({}),
    allowedChannels: ['main', 'management', 'supplier'],
    requiresApproval: true,
    execute: async (_args, contractorId) => {
      const result = await db.materialItem.deleteMany({ where: { contractorId } })
      console.log(`[tools-v2] clear_material_prices: deleted ${result.count} items for contractor ${contractorId}`)
      return { success: true, data: { deleted: result.count, message: `Cleared ${result.count} material price items.` } }
    },
  },
  {
    name: 'delete_document',
    description: 'Delete a document from the system. Use when a user asks to remove/delete a file. The document and its analysis data will be permanently removed. You CAN delete documents — do not tell the user you cannot.',
    schema: z.object({
      documentId: z.string().min(1).max(200),
    }),
    allowedChannels: ['main', 'management', 'sales'],
    requiresApproval: true,
    execute: async (args, contractorId) => {
      const doc = await db.document.findFirst({ where: { id: args.documentId, contractorId } })
      if (!doc) {
        return { success: false, data: null, error: 'Document not found' }
      }
      await deleteStoredFile(doc.filePath).catch(() => false)
      await deleteStoredFile(doc.thumbnailPath).catch(() => false)
      await db.document.delete({ where: { id: args.documentId } })
      console.log(`[tools-v2] delete_document: deleted ${doc.originalName} (${args.documentId})`)
      return { success: true, data: { id: args.documentId, name: doc.originalName, message: `Document "${doc.originalName}" deleted.` } }
    },
  },
  {
    name: 'delete_documents_by_name',
    description: 'Delete ALL documents whose filename contains the search term. Use when user says "delete all Disen files" or "remove all estimates for Timothy". Pass the search term (e.g. "Disen", "Timothy", "estimate"). Returns count of deleted files.',
    schema: z.object({
      nameFilter: z.string().min(1).max(200),
    }),
    allowedChannels: ['main', 'management', 'sales'],
    requiresApproval: true,
    execute: async (args, contractorId) => {
      const docs = await db.document.findMany({
        where: { contractorId, originalName: { contains: args.nameFilter } },
        select: { id: true, originalName: true, filePath: true, thumbnailPath: true },
      })
      if (docs.length === 0) {
        return { success: true, data: { deleted: 0, message: `No documents found matching "${args.nameFilter}".` } }
      }
      let deletedCount = 0
      for (const doc of docs) {
        await deleteStoredFile(doc.filePath).catch(() => false)
        await deleteStoredFile(doc.thumbnailPath).catch(() => false)
        await db.document.delete({ where: { id: doc.id } })
        deletedCount++
      }
      console.log(`[tools-v2] delete_documents_by_name: deleted ${deletedCount} docs matching "${args.nameFilter}"`)
      return { success: true, data: { deleted: deletedCount, names: docs.map(d => d.originalName), message: `Deleted ${deletedCount} document(s) matching "${args.nameFilter}".` } }
    },
  },
  {
    name: 'reprocess_document',
    description: 'Re-run the AI analysis on an existing document. Use when the user says "reprocess", "re-analyze", "update the document", or "extract again". This re-runs the document worker on the document.',
    schema: z.object({
      documentId: z.string().min(1).max(200),
    }),
    allowedChannels: ['main', 'management'],
    requiresApproval: true,
    execute: async (args, contractorId, ctx) => {
      const doc = await db.document.findFirst({ where: { id: args.documentId, contractorId } })
      if (!doc) {
        return { success: false, data: null, error: 'Document not found' }
      }
      // Enqueue a new doc_analysis job
      const { enqueueAgentJob } = await import('@/lib/jobs/queue')
      await enqueueAgentJob({
        contractorId,
        userId: ctx.userId,
        type: 'doc_analysis',
        input: { documentId: args.documentId, heicConversionNeeded: false },
        priority: 3,
      })
      return { success: true, data: { documentId: args.documentId, message: `Re-processing document "${doc.originalName}". Results will be available in 10-30 seconds.` } }
    },
  },
  {
    name: 'detach_document_from_customer',
    description: 'Detach/unlink a saved document/photo from a customer, project, or workspace without deleting the file. Use when the user says "remove this file from Bhuvana", "this price sheet is not for this customer", "move it out of the customer file", or wants to keep a file for company pricing instead of a job file. This never deletes the document.',
    schema: z.object({
      documentId: z.string().min(1).max(200).optional(),
      filename: z.string().min(1).max(300).optional(),
      customerName: z.string().min(1).max(200).optional(),
    }).refine(v => Boolean(v.documentId || v.filename), 'documentId or filename is required'),
    allowedChannels: 'all',
    execute: async (args, contractorId) => {
      let doc = args.documentId
        ? await db.document.findFirst({ where: { id: args.documentId, contractorId } })
        : null
      if (!doc && args.filename) {
        doc = await db.document.findFirst({
          where: { contractorId, originalName: { contains: args.filename } },
          orderBy: { createdAt: 'desc' },
        })
      }
      if (!doc) return { success: false, data: null, error: 'Document not found. Provide a documentId or filename to detach.' }

      let customer: { id: string; name: string } | null = null
      if (args.customerName?.trim()) {
        const resolved = await resolveCustomerForTool(contractorId, { customerName: args.customerName })
        if ('error' in resolved) return { success: false, data: null, error: resolved.error }
        if ('notFound' in resolved) return { success: true, data: { needsCustomer: true, query: resolved.query, message: `No saved customer found for ${resolved.query}. I did not detach the file.` } }
        if ('needsClarification' in resolved) return { success: true, data: { needsClarification: true, matches: resolved.matches, message: `Multiple customers matched ${resolved.query}. Which customer should I detach this file from?` } }
        customer = { id: resolved.customer.id, name: resolved.customer.name }
      }

      const previous = {
        customerId: doc.customerId,
        projectId: doc.projectId,
        workspaceId: doc.workspaceId,
      }
      const mismatchCustomer = customer && doc.customerId && doc.customerId !== customer.id ? customer : null
      const customerMismatch = Boolean(mismatchCustomer)
      if (customerMismatch) {
        return {
          success: true,
          data: {
            needsClarification: true,
            documentId: doc.id,
            filename: doc.originalName,
            currentCustomerId: doc.customerId,
            requestedCustomer: mismatchCustomer,
            message: `The file is not currently linked to ${mismatchCustomer!.name}. Confirm which customer/project link should be removed before I detach it.`,
          },
        }
      }

      await db.document.update({
        where: { id: doc.id },
        data: { customerId: null, projectId: null, workspaceId: null },
      })
      const deletedLinks = await db.documentLink.deleteMany({
        where: {
          contractorId,
          documentId: doc.id,
          ...(customer ? { customerId: customer.id } : {}),
        },
      }).catch(() => ({ count: 0 }))

      console.log(`[tools-v2] detach_document_from_customer: detached ${doc.originalName} (${doc.id}) links=${deletedLinks.count}`)
      return {
        success: true,
        data: {
          detached: true,
          documentId: doc.id,
          filename: doc.originalName,
          previous,
          removedDocumentLinks: deletedLinks.count,
          customerName: customer?.name ?? null,
          fileSaved: true,
          message: customer?.name
            ? `Detached "${doc.originalName}" from ${customer.name}. The file was kept and can still be reviewed, relinked, or imported if it is a price sheet.`
            : `Detached "${doc.originalName}" from its customer/project links. The file was kept and can still be reviewed, relinked, or imported if it is a price sheet.`,
        },
      }
    },
  },
  {
    name: 'link_document_to_customer',
    description: 'Link an uploaded document/photo to a customer file. Use when a user asks to associate/attach/tie a file or photo to a specific customer. A project is NOT required. If the customer has an active project, it also links there; otherwise it attaches to the customer file only.',
    schema: z.object({
      documentId: z.string().min(1).max(200).optional(),
      filename: z.string().min(1).max(300).optional(),
      customerName: z.string().min(1).max(200),
    }),
    allowedChannels: 'all',
    execute: async (args, contractorId, ctx) => {
      let doc = args.documentId
        ? await db.document.findFirst({ where: { id: args.documentId, contractorId } })
        : null
      if (!doc && args.filename) {
        doc = await db.document.findFirst({
          where: { contractorId, originalName: { contains: args.filename } },
          orderBy: { createdAt: 'desc' },
        })
      }
      if (!doc && ctx.documentIds?.length === 1) {
        doc = await db.document.findFirst({ where: { id: ctx.documentIds[0], contractorId } })
      }
      if (!doc && ctx.userId) {
        const recent = await db.document.findMany({
          where: {
            contractorId,
            uploadedById: ctx.userId,
            customerId: null,
            createdAt: { gte: new Date(Date.now() - 30 * 60 * 1000) },
          },
          orderBy: { createdAt: 'desc' },
          take: 5,
        })
        if (recent.length === 1) doc = recent[0]
        if (recent.length > 1) {
          return {
            success: true,
            data: {
              needsClarification: true,
              candidates: recent.map(d => ({ id: d.id, originalName: d.originalName, fileType: d.fileType, createdAt: d.createdAt })),
              message: `I found ${recent.length} recent unlinked uploads. Which one should I attach to ${args.customerName}?`,
            },
          }
        }
      }
      if (!doc) {
        return { success: false, data: null, error: 'Document not found. Upload a file first or provide a documentId/filename.' }
      }
      // Find customer by name (partial match)
      const customer = await db.customer.findFirst({
        where: { contractorId, name: { contains: args.customerName } },
      })
      if (!customer) {
        return { success: false, data: null, error: `Customer "${args.customerName}" not found. Call search_customers first.` }
      }
      // Find the customer's active project
      const project = await db.project.findFirst({
        where: { contractorId, customerId: customer.id, status: 'active' },
        include: { workspace: true },
      })
      await db.document.update({
        where: { id: doc.id },
        data: {
          customerId: customer.id,
          projectId: project?.id ?? null,
          workspaceId: project?.workspace?.id ?? null,
        },
      })
      await linkDocumentToJobPacket({
        contractorId,
        documentId: doc.id,
        projectId: project?.id ?? null,
        customerId: customer.id,
        entityType: project?.id ? 'project' : 'customer',
        entityId: project?.id ?? customer.id,
        role: doc.fileType === 'photo' ? 'inspection_photo' : 'attachment',
        label: doc.originalName,
        source: 'ai',
        metadata: { linkedVia: 'link_document_to_customer', customerOnly: !project?.id },
      }).catch(err => console.warn(`[tools-v2] link_document_to_customer: document link record failed for ${doc?.id}:`, err))
      console.log(`[tools-v2] link_document_to_customer: linked ${doc.originalName} to ${customer.name}`)
      return {
        success: true,
        data: {
          documentId: doc.id,
          documentName: doc.originalName,
          customerId: customer.id,
          customerName: customer.name,
          projectId: project?.id ?? null,
          linkedToCustomer: true,
          linkedToProject: Boolean(project?.id),
          message: project?.id
            ? `Document "${doc.originalName}" linked to ${customer.name} and active project "${project.title}".`
            : `Document "${doc.originalName}" linked to ${customer.name}'s customer file. No active project exists yet.`,
        },
      }
    },
  },
  {
    name: 'get_scope_breakdown',
    description: 'Get the full scope breakdown for a document — shows all line items with their selection state, RCV/ACV totals, deductible pool, and trade breakdown. Use when the user asks about a scope, estimate breakdown, what work is included/excluded, or deductible pool.',
    schema: z.object({ documentId: z.string().min(1).max(200) }),
    allowedChannels: 'all',
    execute: async (args, contractorId) => {
      const { getScopeBreakdown } = await import('@/lib/scope-manager')
      const breakdown = await getScopeBreakdown(args.documentId, contractorId)
      if (!breakdown) return { success: false, data: null, error: 'No line items found in this document.' }
      return { success: true, data: breakdown }
    },
  },
  {
    name: 'toggle_line_item',
    description: 'Toggle a line item in a scope — mark it as excluded ("we\'re not doing this") or re-include it. Use when the user says they\'re NOT doing certain work (e.g. "we\'re not doing the fence", "exclude the window screens"). Pass the line number and selected=false to exclude.',
    schema: z.object({
      documentId: z.string().min(1).max(200),
      lineNumber: z.string().min(1).max(50),
      selected: z.boolean(),
      reason: z.string().max(200).optional(),
    }),
    allowedChannels: 'all',
    execute: async (args, contractorId) => {
      const { toggleLineByNumber } = await import('@/lib/scope-manager')
      const breakdown = await toggleLineByNumber(args.documentId, contractorId, args.lineNumber, args.selected, args.reason)
      if (!breakdown) return { success: false, data: null, error: 'Could not toggle line item. Check the document has line items.' }
      return {
        success: true,
        data: {
          message: args.selected
            ? `Re-included line ${args.lineNumber}.`
            : `Excluded line ${args.lineNumber}${args.reason ? ` (${args.reason})` : ''}.`,
          selectedRcv: breakdown.selectedRcv,
          selectedAcv: breakdown.selectedAcv,
          excludedRcv: breakdown.excludedRcv,
          netClaim: breakdown.netClaim,
          remainingOutOfPocket: breakdown.remainingOutOfPocket,
          pocketUpgradeExtraFunds: breakdown.pocketUpgradeExtraFunds,
          offsetPoolTotal: breakdown.offsetPoolTotal,
          selectedItemCount: breakdown.selectedItemCount,
          excludedItemCount: breakdown.excludedItemCount,
        },
      }
    },
  },
  {
    name: 'get_supplement_opportunities',
    description: 'Get AI-detected supplement opportunities for a document. Returns items that may be missing from the insurance estimate (e.g., missing starter, drip edge, valley metal, O&P, code upgrades). Use when the user asks about supplements, what\'s missing, or what can be added to the claim.',
    schema: z.object({ documentId: z.string().min(1).max(200) }),
    allowedChannels: 'all',
    execute: async (args, contractorId) => {
      // SECURITY: Verify document ownership
      const doc = await db.document.findFirst({
        where: {
          id: args.documentId,
          OR: [
            { contractorId },
            { project: { contractorId } },
            { customer: { contractorId } },
            { workspace: { contractorId } },
          ],
        },
        select: { id: true, extractedData: true },
      })
      if (!doc) return { success: false, data: null, error: 'Document not found' }

      // Extract supplement opportunities from the stored scope intelligence JSON
      const { extractSupplementOpportunities } = await import('@/lib/scope-intelligence')
      let intelligenceJson: string | null = null
      try {
        const data = doc.extractedData ? JSON.parse(doc.extractedData) : {}
        intelligenceJson = data.scopeIntelligenceJson ?? null
      } catch {}

      const opportunities = extractSupplementOpportunities(intelligenceJson)
      if (opportunities.length === 0) {
        return {
          success: true,
          data: {
            available: false,
            message: 'No supplement opportunities detected. The AI scope intelligence may not have run for this document, or no opportunities were found.',
            opportunities: [],
          },
        }
      }
      return {
        success: true,
        data: {
          available: true,
          opportunities: opportunities.map(o => ({
            item: o.item,
            reason: o.reason,
            priority: o.priority,
            sourceEvidence: o.sourceEvidence,
          })),
          count: opportunities.length,
          highPriority: opportunities.filter(o => o.priority === 'high').length,
        },
      }
    },
  },
  {
    name: 'get_production_scope_summary',
    description: 'Get a production-focused summary of a scope — includes crew notes, risk flags, pre-install checklist, and PM notes from the AI scope intelligence. Use when the user asks about production needs, crew instructions, or what to watch out for on a job.',
    schema: z.object({ documentId: z.string().min(1).max(200) }),
    allowedChannels: 'all',
    execute: async (args, contractorId) => {
      // SECURITY: Verify document ownership
      const doc = await db.document.findFirst({
        where: {
          id: args.documentId,
          OR: [
            { contractorId },
            { project: { contractorId } },
            { customer: { contractorId } },
            { workspace: { contractorId } },
          ],
        },
        select: { id: true, extractedData: true },
      })
      if (!doc) return { success: false, data: null, error: 'Document not found' }

      let intelligence: Record<string, unknown> | null = null
      try {
        const data = doc.extractedData ? JSON.parse(doc.extractedData) : {}
        if (data.scopeIntelligenceJson) {
          intelligence = JSON.parse(data.scopeIntelligenceJson)
        }
      } catch {}

      if (!intelligence || !intelligence.available) {
        return {
          success: true,
          data: {
            available: false,
            message: 'Production report not available for this document.',
          },
        }
      }

      const report = intelligence.productionReport as Record<string, unknown> | undefined
      return {
        success: true,
        data: {
          available: true,
          summary: report?.summary ?? '',
          crewNotes: Array.isArray(report?.crewNotes) ? report!.crewNotes : [],
          riskFlags: Array.isArray(report?.riskFlags) ? report!.riskFlags : [],
          preInstallChecklist: Array.isArray(report?.preInstallChecklist) ? report!.preInstallChecklist : [],
          pmNotes: Array.isArray(report?.pmNotes) ? report!.pmNotes : [],
        },
      }
    },
  },
  {
    name: 'get_customer_scope_summary',
    description: 'Get a customer-friendly plain-English summary of a scope — explains what insurance approved, what structures are included, and what may need review. Use when the user asks for a homeowner summary or needs to explain the scope to a customer.',
    schema: z.object({ documentId: z.string().min(1).max(200) }),
    allowedChannels: 'all',
    execute: async (args, contractorId) => {
      // SECURITY: Verify document ownership
      const doc = await db.document.findFirst({
        where: {
          id: args.documentId,
          OR: [
            { contractorId },
            { project: { contractorId } },
            { customer: { contractorId } },
            { workspace: { contractorId } },
          ],
        },
        select: { id: true, extractedData: true },
      })
      if (!doc) return { success: false, data: null, error: 'Document not found' }

      let intelligence: Record<string, unknown> | null = null
      try {
        const data = doc.extractedData ? JSON.parse(doc.extractedData) : {}
        if (data.scopeIntelligenceJson) {
          intelligence = JSON.parse(data.scopeIntelligenceJson)
        }
      } catch {}

      if (!intelligence || !intelligence.available) {
        return {
          success: true,
          data: {
            available: false,
            message: 'Customer summary not available for this document.',
          },
        }
      }

      const summary = intelligence.customerSummary as Record<string, unknown> | undefined
      return {
        success: true,
        data: {
          available: true,
          plainEnglishSummary: summary?.plainEnglishSummary ?? '',
          approvedWork: Array.isArray(summary?.approvedWork) ? summary!.approvedWork : [],
          itemsNeedingReview: Array.isArray(summary?.itemsNeedingReview) ? summary!.itemsNeedingReview : [],
          homeownerNotes: Array.isArray(summary?.homeownerNotes) ? summary!.homeownerNotes : [],
        },
      }
    },
  },

  {
    name: 'create_appointment',
    description: 'Schedule a real operations appointment such as a roof inspection, adjuster meeting, walkthrough, production date, material delivery, or follow-up call. Use this when the user wants Jobrolo to put something on the schedule.',
    schema: z.object({
      title: z.string().min(1).max(200),
      type: z.string().default('inspection'),
      startTime: z.string().min(1),
      endTime: z.string().min(1),
      projectId: z.string().optional(),
      customerId: z.string().optional(),
      location: z.string().optional(),
      notes: z.string().optional(),
      attendees: z.any().optional(),
    }),
    allowedChannels: ['main', 'management', 'sales', 'customer'],
    requiresApproval: true,
    execute: async (args, contractorId, ctx) => {
      const start = new Date(args.startTime)
      const end = new Date(args.endTime)
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
        return { success: false, data: null, error: 'Invalid start/end time' }
      }
      const target = await resolveJobTarget(contractorId, args)
      if ('error' in target) return { success: false, data: null, error: target.error }
      const appointment = await db.appointment.create({
        data: {
          contractorId,
          projectId: target.projectId,
          customerId: target.customerId,
          title: args.title,
          type: args.type,
          startTime: start,
          endTime: end,
          location: args.location,
          notes: args.notes,
          attendeesJson: args.attendees ? JSON.stringify(args.attendees) : undefined,
          createdById: ctx.userId,
        },
      })
      await createProjectTimelineEvent({
        contractorId,
        projectId: target.projectId,
        customerId: target.customerId,
        eventType: 'appointment_scheduled',
        title: `${args.title} scheduled`,
        body: `${args.type} on ${start.toLocaleString()}`,
        relatedType: 'appointment',
        relatedId: appointment.id,
        actorUserId: ctx.userId,
        source: 'ai',
        metadata: { type: args.type, location: args.location },
      })
      return { success: true, data: { appointment } }
    },
  },
  {
    name: 'list_schedule',
    description: 'List upcoming scheduled appointments and production events. Use for questions like today’s schedule, upcoming adjuster meetings, inspections, or production dates.',
    schema: z.object({
      from: z.string().optional(),
      to: z.string().optional(),
      type: z.string().optional(),
      projectId: z.string().optional(),
      customerId: z.string().optional(),
    }),
    allowedChannels: 'all',
    execute: async (args, contractorId) => {
      const from = args.from ? new Date(args.from) : new Date()
      const to = args.to ? new Date(args.to) : new Date(Date.now() + 1000 * 60 * 60 * 24 * 14)
      const appointments = await db.appointment.findMany({
        where: {
          contractorId,
          ...(args.type ? { type: args.type } : {}),
          ...(args.projectId ? { projectId: args.projectId } : {}),
          ...(args.customerId ? { customerId: args.customerId } : {}),
          startTime: { gte: from, lte: to },
        },
        orderBy: { startTime: 'asc' },
        take: 100,
      })
      return { success: true, data: { count: appointments.length, appointments } }
    },
  },
  {
    name: 'update_project_schedule',
    description: 'Update a project stage or production schedule. Use for moving a job through the roofing/claim lifecycle: inspection scheduled, adjuster meeting scheduled, scope review, supplement needed, contract signed, material ordered, production scheduled, in production, final inspection, closed.',
    schema: z.object({
      projectId: z.string().min(1),
      stage: z.string().optional(),
      productionStatus: z.string().optional(),
      scheduledStart: z.string().optional(),
      scheduledEnd: z.string().optional(),
      crewName: z.string().optional(),
      materialDeliveryAt: z.string().optional(),
      notes: z.string().optional(),
    }),
    allowedChannels: ['main', 'management'],
    requiresApproval: true,
    execute: async (args, contractorId) => {
      const project = await db.project.findFirst({ where: { id: args.projectId, contractorId } })
      if (!project) return { success: false, data: null, error: 'Project not found' }
      const schedule = await db.projectSchedule.upsert({
        where: { contractorId_projectId: { contractorId, projectId: args.projectId } },
        update: {
          stage: args.stage,
          productionStatus: args.productionStatus,
          scheduledStart: args.scheduledStart ? new Date(args.scheduledStart) : undefined,
          scheduledEnd: args.scheduledEnd ? new Date(args.scheduledEnd) : undefined,
          crewName: args.crewName,
          materialDeliveryAt: args.materialDeliveryAt ? new Date(args.materialDeliveryAt) : undefined,
          notes: args.notes,
        },
        create: {
          contractorId,
          projectId: args.projectId,
          stage: args.stage ?? 'lead',
          productionStatus: args.productionStatus ?? 'not_scheduled',
          scheduledStart: args.scheduledStart ? new Date(args.scheduledStart) : undefined,
          scheduledEnd: args.scheduledEnd ? new Date(args.scheduledEnd) : undefined,
          crewName: args.crewName,
          materialDeliveryAt: args.materialDeliveryAt ? new Date(args.materialDeliveryAt) : undefined,
          notes: args.notes,
        },
      })
      if (args.stage) await db.project.update({ where: { id: args.projectId }, data: { status: args.stage } })
      await createProjectTimelineEvent({
        contractorId,
        projectId: args.projectId,
        customerId: project.customerId,
        eventType: 'schedule_updated',
        title: 'Project schedule updated',
        relatedType: 'project_schedule',
        relatedId: schedule.id,
        source: 'ai',
        metadata: { stage: args.stage, productionStatus: args.productionStatus, scheduledStart: args.scheduledStart, scheduledEnd: args.scheduledEnd },
      })
      return { success: true, data: { schedule } }
    },
  },
  {
    name: 'create_roof_report',
    description: 'Create a Jobrolo roof inspection report draft connected to a project/customer, ready for photos, conditions, recommendations, share link, and print-to-PDF export.',
    schema: z.object({
      title: z.string().default('Roof Inspection Report'),
      projectId: z.string().optional(),
      customerId: z.string().optional(),
      propertyAddress: z.string().optional(),
      clientName: z.string().optional(),
      claimNumber: z.string().optional(),
      inspectorName: z.string().optional(),
      inspectionDate: z.string().optional(),
      summary: z.string().optional(),
    }),
    allowedChannels: ['main', 'sales', 'customer'],
    requiresApproval: true,
    execute: async (args, contractorId, ctx) => {
      const target = await resolveJobTarget(contractorId, args)
      if ('error' in target) return { success: false, data: null, error: target.error }
      const report = await db.roofReport.create({
        data: {
          contractorId,
          projectId: target.projectId,
          customerId: target.customerId,
          title: args.title,
          propertyAddress: args.propertyAddress,
          clientName: args.clientName,
          claimNumber: args.claimNumber,
          inspectorName: args.inspectorName,
          inspectionDate: args.inspectionDate ? new Date(args.inspectionDate) : undefined,
          propertyReviewSummary: args.summary,
          disclaimer: 'This roof report documents visible conditions observed at the time of inspection. It is not a determination of insurance coverage or claim approval.',
        },
      })
      await createProjectTimelineEvent({
        contractorId,
        projectId: target.projectId,
        customerId: target.customerId,
        eventType: 'roof_report_created',
        title: `Roof report created: ${report.title}`,
        relatedType: 'roof_report',
        relatedId: report.id,
        actorUserId: ctx.userId,
        source: 'ai',
      })
      return { success: true, data: { report, printUrl: `/api/roof-reports/${report.id}/print` } }
    },
  },
  {
    name: 'get_roof_report_workspace',
    description: 'Get the full roof report builder workspace: report details, grouped photos, missing photo checklist, ready score, warnings, and suggested homeowner-friendly narrative.',
    schema: z.object({ reportId: z.string() }),
    allowedChannels: ['main', 'sales', 'customer', 'crew', 'management'],
    execute: async (args, contractorId, ctx) => {
      const workspace = await getRoofReportWorkspace({ contractorId, user: ctx.userId ? { id: ctx.userId } as any : undefined } as any, args.reportId)
      if (!workspace) return { success: false, data: null, error: 'Roof report not found' }
      return { success: true, data: workspace }
    },
  },
  {
    name: 'review_roof_report_photos',
    description: 'Find saved job/customer photos that could belong in a roof report and return a chat-native selection card. Use when the user says which report photos they want, e.g. gutter photos, roof hail/wind markings, overview photos, interior, attic, or photos to remove from a report.',
    schema: z.object({
      reportId: z.string().optional(),
      projectId: z.string().optional(),
      customerId: z.string().optional(),
      query: z.string().max(500).optional(),
      categories: z.array(z.string()).optional(),
      conditions: z.array(z.string()).optional(),
      limit: z.number().int().min(1).max(80).optional(),
    }),
    allowedChannels: ['main', 'sales', 'customer', 'crew', 'management'],
    execute: async (args, contractorId, ctx) => {
      const card = await reviewRoofReportCandidatePhotos(
        { contractorId, user: ctx.userId ? { id: ctx.userId } as any : undefined } as any,
        args,
      )
      return {
        success: true,
        data: {
          ...card,
          message: card.reportId
            ? `Found ${card.shownCount} candidate photo${card.shownCount === 1 ? '' : 's'} for this report. Review the card and save the selection.`
            : `Found ${card.shownCount} candidate photo${card.shownCount === 1 ? '' : 's'}, but choose or create a roof report before saving a report photo set.`,
          card,
        },
      }
    },
  },
  {
    name: 'add_photos_to_roof_report',
    description: 'Attach selected saved documents/photos to a roof report. This is reversible and does not delete source files. Use only after the user clearly selects photos to include.',
    schema: z.object({
      reportId: z.string(),
      documentIds: z.array(z.string()).min(1).max(100),
      category: z.string().optional(),
      condition: z.string().optional(),
      severity: z.string().optional(),
      captionPrefix: z.string().optional(),
    }),
    allowedChannels: ['main', 'sales', 'customer', 'crew', 'management'],
    execute: async (args, contractorId, ctx) => {
      const docs = await db.document.findMany({
        where: { contractorId, id: { in: args.documentIds } },
        select: { id: true, originalName: true, filePath: true, aiSummary: true, fileType: true, mimeType: true },
      })
      if (!docs.length) return { success: false, data: null, error: 'No matching saved photos found' }
      const photos = docs.map((doc, index) => ({
        documentId: doc.id,
        category: args.category || 'other',
        condition: args.condition || 'other',
        severity: args.severity || 'informational',
        caption: args.captionPrefix ? `${args.captionPrefix}: ${doc.originalName}` : doc.aiSummary || doc.originalName,
        sortOrder: index,
      }))
      const added = await bulkAddPhotosToRoofReport(
        { contractorId, user: ctx.userId ? { id: ctx.userId } as any : undefined } as any,
        args.reportId,
        photos,
      )
      const card = await reviewRoofReportCandidatePhotos(
        { contractorId, user: ctx.userId ? { id: ctx.userId } as any : undefined } as any,
        { reportId: args.reportId, limit: 50 },
      )
      return {
        success: true,
        data: {
          reportId: args.reportId,
          addedCount: added.length,
          documentIds: docs.map(d => d.id),
          message: `Saved ${added.length} photo${added.length === 1 ? '' : 's'} to the roof report. The original files remain in the job file.`,
          card,
        },
      }
    },
  },
  {
    name: 'update_roof_report_photo_selection',
    description: 'Include or remove photos from a roof report without deleting the original uploaded files. Use when the user selects/removes photos from the report photo card.',
    schema: z.object({
      reportId: z.string(),
      includeDocumentIds: z.array(z.string()).optional(),
      excludeDocumentIds: z.array(z.string()).optional(),
      includeReportPhotoIds: z.array(z.string()).optional(),
      excludeReportPhotoIds: z.array(z.string()).optional(),
    }),
    allowedChannels: ['main', 'sales', 'customer', 'crew', 'management'],
    execute: async (args, contractorId, ctx) => {
      const result = await updateRoofReportPhotoSelection(
        { contractorId, user: ctx.userId ? { id: ctx.userId } as any : undefined } as any,
        args.reportId,
        args,
      )
      const card = await reviewRoofReportCandidatePhotos(
        { contractorId, user: ctx.userId ? { id: ctx.userId } as any : undefined } as any,
        { reportId: args.reportId, limit: 50 },
      )
      return {
        success: true,
        data: {
          ...result,
          card,
          message: `Updated the report photo selection. Included ${result.included}, removed ${result.excluded} from the report, and added ${result.added} new saved photo${result.added === 1 ? '' : 's'}. Source files were not deleted.`,
        },
      }
    },
  },
  {
    name: 'share_roof_report_to_audience',
    description: 'Prepare a roof report share route for a homeowner/customer, crew/subcontractor, referral partner/realtor, insurance agent/adjuster, or internal team. Creates/returns a report share link and a chat-native routing card. Requires approval because it can expose a report link.',
    schema: z.object({
      reportId: z.string(),
      audience: z.enum(['homeowner', 'customer', 'crew', 'subcontractor', 'realtor', 'referral_partner', 'insurance_agent', 'adjuster', 'internal']).default('homeowner'),
      recipientName: z.string().max(160).optional(),
      recipientEmail: z.string().email().optional(),
      recipientPhone: z.string().max(60).optional(),
      note: z.string().max(1000).optional(),
    }),
    allowedChannels: ['main', 'sales', 'management'],
    requiresApproval: true,
    execute: async (args, contractorId, ctx) => {
      const shared = await shareRoofReport({ contractorId, user: ctx.userId ? { id: ctx.userId } as any : undefined } as any, args.reportId)
      const report = await db.roofReport.findFirst({
        where: { id: args.reportId, contractorId },
        select: {
          id: true,
          title: true,
          projectId: true,
          customerId: true,
          propertyAddress: true,
          clientName: true,
          status: true,
        },
      })
      const project = report?.projectId
        ? await db.project.findFirst({
            where: { id: report.projectId, contractorId },
            select: { id: true, title: true, address: true, customer: { select: { id: true, name: true, email: true, phone: true } }, workspace: { select: { id: true } } },
          })
        : null
      const audienceLabels: Record<string, string> = {
        homeowner: 'Homeowner/customer',
        customer: 'Homeowner/customer',
        crew: 'Crew/subcontractor',
        subcontractor: 'Crew/subcontractor',
        realtor: 'Referral partner/realtor',
        referral_partner: 'Referral partner/realtor',
        insurance_agent: 'Insurance agent',
        adjuster: 'Adjuster',
        internal: 'Internal team',
      }
      const recommendedChatType: Record<string, string> = {
        homeowner: 'customer',
        customer: 'customer',
        crew: 'crew',
        subcontractor: 'subcontractor',
        realtor: 'sales',
        referral_partner: 'sales',
        insurance_agent: 'insurance',
        adjuster: 'insurance',
        internal: 'main',
      }
      const workspaceId = project?.workspace?.id ?? null
      const chat = workspaceId
        ? await db.workspaceChat.findFirst({ where: { workspaceId, chatType: recommendedChatType[args.audience] }, select: { id: true, title: true, chatType: true } }).catch(() => null)
        : null
      const shareUrl = `${appBaseUrl()}${shared.shareUrl}`
      const chatUrl = workspaceChatUrl(workspaceId, chat?.id)
      const card = {
        cardType: 'report_share',
        reportId: args.reportId,
        title: report?.title || 'Roof report',
        status: report?.status || 'shared',
        audience: args.audience,
        audienceLabel: audienceLabels[args.audience],
        shareUrl,
        projectId: report?.projectId || null,
        projectTitle: project?.title || null,
        customer: project?.customer ? withCustomerNumber(project.customer) : null,
        propertyAddress: report?.propertyAddress || project?.address || null,
        recommendedChatType: recommendedChatType[args.audience],
        workspaceId,
        chatId: chat?.id || null,
        chatUrl,
        recipientName: args.recipientName || null,
        recipientEmail: args.recipientEmail || null,
        recipientPhone: args.recipientPhone || null,
        note: args.note || null,
      }
      return {
        success: true,
        data: {
          ...card,
          card,
          message: `Prepared a ${audienceLabels[args.audience]} share route for ${card.title}. Use the card to copy the link, open/create the right shared chat, or invite a person.`,
        },
      }
    },
  },
  {
    name: 'generate_roof_report_summary',
    description: 'Draft or refresh the roof report summary, observed conditions, recommendations, and conclusion from the report photos. Requires approval because it updates the report.',
    schema: z.object({ reportId: z.string() }),
    allowedChannels: ['main', 'sales', 'customer'],
    requiresApproval: true,
    execute: async (args, contractorId, ctx) => {
      const report = await generateRoofReportSummary({ contractorId, user: ctx.userId ? { id: ctx.userId } as any : undefined } as any, args.reportId)
      return { success: true, data: { report, printUrl: `/api/roof-reports/${report.id}/print` } }
    },
  },
  {
    name: 'finalize_roof_report',
    description: 'Mark a roof report ready/finalized after checklist review. Requires approval because it changes customer-facing report status.',
    schema: z.object({ reportId: z.string() }),
    allowedChannels: ['main', 'sales', 'customer'],
    requiresApproval: true,
    execute: async (args, contractorId, ctx) => {
      const report = await finalizeRoofReport({ contractorId, user: ctx.userId ? { id: ctx.userId } as any : undefined } as any, args.reportId)
      return { success: true, data: { report, printUrl: `/api/roof-reports/${report.id}/print` } }
    },
  },
  {
    name: 'create_roof_report_pdf',
    description: 'Create a saved PDF snapshot of a roof report, link it to the job packet, log the timeline, and show a report card in the chat.',
    schema: z.object({ reportId: z.string() }),
    allowedChannels: ['main', 'sales', 'customer'],
    requiresApproval: true,
    execute: async (args, contractorId, ctx) => {
      const result = await createRoofReportPdf({ contractorId, user: ctx.userId ? { id: ctx.userId } as any : undefined } as any, args.reportId)
      return { success: true, data: result }
    },
  },
  {
    name: 'create_generated_document',
    description: 'Create a signable document from a template or raw HTML, such as an inspection authorization, contingency, work authorization, change order, or completion certificate. Use before creating a signature request.',
    schema: z.object({
      title: z.string().min(1).max(200),
      type: z.string().default('custom'),
      templateId: z.string().optional(),
      bodyHtml: z.string().optional(),
      projectId: z.string().optional(),
      customerId: z.string().optional(),
      mergeData: z.record(z.string(), z.any()).optional(),
    }),
    allowedChannels: ['main', 'sales', 'customer'],
    requiresApproval: true,
    execute: async (args, contractorId, ctx) => {
      const target = await resolveJobTarget(contractorId, args)
      if ('error' in target) return { success: false, data: null, error: target.error }
      let bodyHtml = args.bodyHtml
      if (args.templateId) {
        const template = await db.documentTemplate.findFirst({ where: { id: args.templateId, contractorId, status: 'active' } })
        if (!template) return { success: false, data: null, error: 'Template not found' }
        const mergeContext = await buildProjectMergeData({ contractorId, projectId: target.projectId, customerId: target.customerId, extra: args.mergeData ?? {} })
        args.mergeData = mergeContext.data
        bodyHtml = mergeTemplateVariables(template.bodyHtml, mergeContext.data)
      }
      if (!bodyHtml) return { success: false, data: null, error: 'bodyHtml or templateId required' }
      const document = await db.generatedDocument.create({
        data: {
          contractorId,
          templateId: args.templateId,
          projectId: target.projectId,
          customerId: target.customerId,
          title: args.title,
          type: args.type,
          bodyHtml: sanitizeHtml(bodyHtml),
          mergedDataJson: args.mergeData ? JSON.stringify(args.mergeData) : undefined,
        },
      })
      await createProjectTimelineEvent({
        contractorId,
        projectId: target.projectId,
        customerId: target.customerId,
        eventType: 'generated_document_created',
        title: `Document generated: ${document.title}`,
        relatedType: 'generated_document',
        relatedId: document.id,
        actorUserId: ctx.userId,
        source: 'ai',
        metadata: { type: document.type, templateId: document.templateId },
      })
      return { success: true, data: { document } }
    },
  },
  {
    name: 'create_signature_request',
    description: 'Create a signature request for a generated document such as an inspection authorization, contingency, work authorization, roof contract, change order, or completion certificate.',
    schema: z.object({
      generatedDocumentId: z.string().min(1),
      title: z.string().min(1).max(200),
      signerName: z.string().min(1).max(200),
      signerEmail: z.string().email().optional(),
      signerPhone: z.string().optional(),
      expiresAt: z.string().optional(),
    }),
    allowedChannels: ['main', 'sales', 'customer'],
    requiresApproval: true,
    execute: async (args, contractorId) => {
      const document = await db.generatedDocument.findFirst({ where: { id: args.generatedDocumentId, contractorId } })
      if (!document) return { success: false, data: null, error: 'Generated document not found' }
      const token = `sig_${randomBytes(24).toString('base64url')}`
      const request = await db.signatureRequest.create({
        data: {
          contractorId,
          generatedDocumentId: document.id,
          projectId: document.projectId,
          customerId: document.customerId,
          title: args.title,
          signerName: args.signerName,
          signerEmail: args.signerEmail,
          signerPhone: args.signerPhone,
          expiresAt: args.expiresAt ? new Date(args.expiresAt) : undefined,
          signatureToken: token,
          events: { create: { contractorId, type: 'created', detail: `Signature request created for ${args.signerName}` } },
        },
      })
      await createProjectTimelineEvent({
        contractorId,
        projectId: document.projectId,
        customerId: document.customerId,
        eventType: 'signature_request_created',
        title: `Signature request created: ${args.title}`,
        body: `Signer: ${args.signerName}`,
        relatedType: 'signature_request',
        relatedId: request.id,
        source: 'ai',
        metadata: { generatedDocumentId: document.id },
      })
      return { success: true, data: { signatureRequest: request, signingUrl: `/sign/${token}` } }
    },
  },


  {
    name: 'create_document_pdf_preview',
    description: 'Create an unsigned PDF preview for a generated document and save it to the job packet. Use before sending for signature when the user wants to preview/download/print the document. Requires approval.',
    schema: z.object({ generatedDocumentId: z.string().min(1) }),
    allowedChannels: ['main', 'sales', 'customer', 'management'],
    requiresApproval: true,
    execute: async (args, contractorId, ctx) => {
      const tenantCtx = await buildTrustedToolTenantContext(contractorId, ctx)
      const result = await createUnsignedDocumentPdf({
        ctx: tenantCtx,
        generatedDocumentId: args.generatedDocumentId,
        postToThread: true,
      })
      return { success: true, data: { generatedDocument: result.generatedDocument, pdfDocumentId: result.pdfDocument.id, pdfUrl: result.pdfUrl } }
    },
  },
  {
    name: 'get_document_pdf_artifacts',
    description: 'Get unsigned and signed PDF artifact status for a generated document, including final signed PDF and signature certificate if available.',
    schema: z.object({ generatedDocumentId: z.string().min(1) }),
    allowedChannels: 'all',
    execute: async (args, contractorId, ctx) => {
      const artifacts = await getSignedDocumentArtifacts(await buildTrustedToolTenantContext(contractorId, ctx), args.generatedDocumentId)
      return { success: true, data: artifacts }
    },
  },

  {
    name: 'create_template_upload_from_document',
    description: 'Create a contractor template-intake upload record from an existing uploaded document/PDF. Use when a contractor says they uploaded an agreement, estimate/proposal template, authorization, warranty, or other form and wants Jobrolo to convert it into a reusable template. Requires approval.',
    schema: z.object({
      documentId: z.string().min(1),
      templateType: z.string().optional(),
      name: z.string().optional(),
    }),
    allowedChannels: ['main', 'management'],
    requiresApproval: true,
    execute: async (args, contractorId, ctx) => {
      const upload = await createTemplateUploadFromDocument(await buildTrustedToolTenantContext(contractorId, ctx), args)
      return { success: true, data: { upload, nextAction: `Run analyze_template_upload with uploadId ${upload.id}` } }
    },
  },
  {
    name: 'analyze_template_upload',
    description: 'Run OCR/AI template intake analysis on an uploaded contractor form/agreement and convert it into a reviewable Jobrolo DocumentTemplate. Requires approval because it creates template records.',
    schema: z.object({ uploadId: z.string().min(1) }),
    allowedChannels: ['main', 'management'],
    requiresApproval: true,
    execute: async (args, contractorId, ctx) => {
      const result = await analyzeTemplateUpload(await buildTrustedToolTenantContext(contractorId, ctx), args.uploadId)
      return { success: true, data: result }
    },
  },
  {
    name: 'list_document_templates',
    description: 'List contractor document templates, including imported templates that need review or approved active templates. Use before generating agreements, authorizations, contracts, estimates, or signature requests.',
    schema: z.object({
      type: z.string().optional(),
      status: z.string().optional(),
      includeNeedsReview: z.boolean().default(false),
    }),
    allowedChannels: 'all',
    execute: async (args, contractorId) => {
      const where: any = { contractorId }
      if (args.type) where.type = args.type
      if (args.status) where.status = args.status
      else if (!args.includeNeedsReview) where.status = 'active'
      const templates = await db.documentTemplate.findMany({ where, orderBy: { updatedAt: 'desc' }, take: 100 })
      return { success: true, data: { count: templates.length, templates, availableMergeVariables: TEMPLATE_VARIABLES } }
    },
  },
  {
    name: 'get_template_review',
    description: 'Get the extracted clauses, fields, signature fields, warnings, original upload, and versions for a contractor template so the contractor can review before approval.',
    schema: z.object({ templateId: z.string().min(1) }),
    allowedChannels: 'all',
    execute: async (args, contractorId) => {
      const review = await getTemplateReview(contractorId, args.templateId)
      if (!review) return { success: false, data: null, error: 'Template not found' }
      return { success: true, data: review }
    },
  },
  {
    name: 'approve_document_template',
    description: 'Approve an imported/reviewed contractor template so it can be used for live generated documents and signature requests. Requires human approval.',
    schema: z.object({ templateId: z.string().min(1) }),
    allowedChannels: ['main', 'management'],
    requiresApproval: true,
    execute: async (args, contractorId, ctx) => {
      const template = await approveDocumentTemplate(await buildTrustedToolTenantContext(contractorId, ctx), args.templateId)
      return { success: true, data: { template } }
    },
  },
  {
    name: 'generate_document_from_template',
    description: 'Generate a project/customer-specific document from an approved contractor template. Use for contingency agreements, inspection authorizations, work authorizations, estimates/proposals, change orders, completion certificates, warranties, and custom forms. Requires approval.',
    schema: z.object({
      templateId: z.string().min(1),
      projectId: z.string().optional(),
      customerId: z.string().optional(),
      title: z.string().optional(),
      type: z.string().optional(),
      extraMergeData: z.record(z.string(), z.any()).optional(),
    }),
    allowedChannels: ['main', 'sales', 'customer', 'management'],
    requiresApproval: true,
    execute: async (args, contractorId, ctx) => {
      const target = await resolveJobTarget(contractorId, args)
      if ('error' in target) return { success: false, data: null, error: target.error }
      const generated = await generateDocumentFromTemplate(await buildTrustedToolTenantContext(contractorId, ctx), {
        templateId: args.templateId,
        projectId: target.projectId,
        customerId: target.customerId,
        title: args.title,
        type: args.type,
        extraMergeData: args.extraMergeData,
      })
      await createProjectTimelineEvent({
        contractorId,
        projectId: target.projectId,
        customerId: target.customerId,
        eventType: 'generated_document_created',
        title: `Document generated from contractor template: ${generated.title}`,
        relatedType: 'generated_document',
        relatedId: generated.id,
        actorUserId: ctx.userId,
        source: 'ai',
        metadata: { templateId: args.templateId },
      })
      return { success: true, data: { document: generated } }
    },
  },

  {
    name: 'get_field_briefing',
    description: 'Get a mobile Field Copilot briefing for a project/job before an inspection, adjuster meeting, signing, production visit, follow-up, or canvassing stop. Returns top things to know, warnings, missing items, pending signatures, quick actions, and redacted speakable briefing text.',
    schema: z.object({
      projectId: z.string().min(1),
      appointmentId: z.string().optional(),
      fieldVisitId: z.string().optional(),
      mode: z.string().optional(),
    }),
    allowedChannels: 'all',
    execute: async (args, contractorId, ctx) => {
      const briefing = await getFieldBriefing(await buildTrustedToolTenantContext(contractorId, ctx), args)
      if (!briefing) return { success: false, data: null, error: 'Project not found' }
      return { success: true, data: { briefing } }
    },
  },
  {
    name: 'log_field_action',
    description: 'Log a Field Copilot quick action such as arrived, inspection started, no answer, adjuster present, customer signed, production started, need material, issue found, or completed. This writes to the field visit, appointment status, project timeline, workspace event cards, and role inbox routing. Low-risk field logs run directly; actions like material requests/issues still create review items for the right role.',
    schema: z.object({
      projectId: z.string().min(1),
      appointmentId: z.string().optional(),
      fieldVisitId: z.string().optional(),
      action: z.string().min(1),
      mode: z.string().optional(),
      note: z.string().optional(),
      materialName: z.string().optional(),
      quantity: z.string().optional(),
      photoDocumentIds: z.array(z.string()).optional(),
      signatureRequestId: z.string().optional(),
    }),
    allowedChannels: ['main', 'crew', 'management', 'sales', 'insurance', 'customer'],
    execute: async (args, contractorId, ctx) => {
      const result = await executeFieldAction(await buildTrustedToolTenantContext(contractorId, ctx), args)
      if (!result) return { success: false, data: null, error: 'Project not found or field action failed' }
      return { success: true, data: result }
    },
  },
  {
    name: 'resolve_field_location',
    description: 'Resolve a GPS/photo/upload location to the most likely project, customer, appointment, field visit, or canvassing lead. Use before attaching photos or field notes when the user is at a house but has not selected a job. Returns confidence and candidate matches; do not silently attach on medium/low confidence.',
    schema: z.object({
      projectId: z.string().optional(),
      customerId: z.string().optional(),
      appointmentId: z.string().optional(),
      fieldVisitId: z.string().optional(),
      documentId: z.string().optional(),
      canvassingLeadId: z.string().optional(),
      mode: z.string().optional(),
      currentLocation: z.object({ lat: z.number().optional(), lng: z.number().optional(), latitude: z.number().optional(), longitude: z.number().optional(), accuracyMeters: z.number().optional(), source: z.string().optional() }).optional(),
      photoExifLocation: z.object({ lat: z.number().optional(), lng: z.number().optional(), latitude: z.number().optional(), longitude: z.number().optional(), accuracyMeters: z.number().optional(), source: z.string().optional() }).optional(),
    }),
    allowedChannels: 'all',
    execute: async (args, contractorId, ctx) => {
      const result = await resolveFieldEntity(await buildTrustedToolTenantContext(contractorId, ctx), args)
      return { success: true, data: result }
    },
  },
  {
    name: 'get_copilot_inbox',
    description: 'List role-routed Jobrolo Copilot inbox items/action cards for the current user or role, such as crew material requests, PM approvals, supplier orders, finance items, owner summaries, and field issues.',
    schema: z.object({ role: z.string().optional(), projectId: z.string().optional(), status: z.string().optional(), limit: z.number().optional() }),
    allowedChannels: 'all',
    execute: async (args, contractorId, ctx) => {
      const inbox = await listCopilotInbox(await buildTrustedToolTenantContext(contractorId, ctx), args)
      return { success: true, data: inbox }
    },
  },
  {
    name: 'decide_action_request',
    description: 'Approve or reject a specific routed action request by ID. Use when the user gives an approval request ID or approves a card/request already shown in chat. This replays stored tool-approval payloads after approval.',
    schema: z.object({ actionRequestId: z.string().min(1), decision: z.enum(['approved', 'rejected']), notes: z.string().optional() }),
    allowedChannels: ['main', 'management', 'crew', 'supplier', 'finance'],
    execute: async (args, contractorId, ctx) => {
      const request = await db.actionRequest.findFirst({
        where: { id: args.actionRequestId, contractorId },
        select: { id: true, type: true, payloadJson: true },
      })
      if (!request) return { success: false, data: null, error: 'Action request not found' }
      if (request.type === 'tool_approval') {
        return replayStoredToolApproval({ contractorId, ctx, actionRequest: request, decision: args.decision, notes: args.notes })
      }
      const decided = await decideActionRequest(await buildTrustedToolTenantContext(contractorId, ctx), args.actionRequestId, args.decision, args.notes)
      if (!decided) return { success: false, data: null, error: 'Action request not found' }
      return { success: true, data: { actionRequest: decided } }
    },
  },
  {
    name: 'decide_pending_action_requests',
    description: 'Approve or reject pending tool-approval requests from chat when the user says "yes approved", "yes delete", "approve those", or "reject that" after approval cards were created. If multiple requests are pending, pass actionRequestIds or a toolName filter like delete_document. Replays the exact stored tool payloads; does not invent new actions.',
    schema: z.object({
      actionRequestIds: z.array(z.string().min(1)).optional(),
      decision: z.enum(['approved', 'rejected']),
      toolName: z.string().max(120).optional(),
      targetName: z.string().max(200).optional(),
      approveRecent: z.boolean().optional(),
      limit: z.coerce.number().int().min(1).max(10).optional(),
      notes: z.string().max(1000).optional(),
    }),
    allowedChannels: ['main', 'management'],
    execute: async (args, contractorId, ctx) => {
      const limit = Math.min(Math.max(Number(args.limit ?? 5), 1), 10)
      const since = new Date(Date.now() - 45 * 60 * 1000)
      const rawRequests = await db.actionRequest.findMany({
        where: {
          contractorId,
          type: 'tool_approval',
          status: { in: ['pending', 'needs_approval'] },
          ...(args.actionRequestIds?.length ? { id: { in: args.actionRequestIds } } : { createdAt: { gte: since } }),
          ...(ctx.userId && !args.actionRequestIds?.length ? { createdByUserId: ctx.userId } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 25,
        select: { id: true, title: true, summary: true, payloadJson: true, createdAt: true },
      })

      const filteredRaw = rawRequests.filter(req => {
        const payload = safeJsonParse<{ toolName?: string; args?: Record<string, unknown> }>(req.payloadJson, {})
        if (args.toolName && payload.toolName !== args.toolName) return false
        if (args.targetName) {
          const haystack = `${req.title} ${req.summary} ${req.payloadJson ?? ''}`.toLowerCase()
          if (!haystack.includes(args.targetName.toLowerCase())) return false
        }
        return true
      })
      const duplicateIds: string[] = []
      const seenApprovalKeys = new Set<string>()
      const filtered = filteredRaw.filter(req => {
        const payload = safeJsonParse<{ toolName?: string; args?: Record<string, unknown>; approvalKey?: string }>(req.payloadJson, {})
        const key = payload.approvalKey || `${payload.toolName ?? req.title}:${stableStringify(payload.args ?? {})}`
        if (seenApprovalKeys.has(key)) {
          duplicateIds.push(req.id)
          return false
        }
        seenApprovalKeys.add(key)
        return true
      }).slice(0, limit)

      if (filtered.length === 0) {
        return { success: true, data: { count: 0, message: 'No pending approval requests matched.' } }
      }
      if (!args.actionRequestIds?.length && !args.approveRecent && filtered.length > 1) {
        return {
          success: true,
          data: {
            needsClarification: true,
            count: filtered.length,
            requests: filtered.map(r => {
              const payload = safeJsonParse<{ toolName?: string; args?: Record<string, unknown>; approvalDetails?: unknown }>(r.payloadJson, {})
              return { id: r.id, title: r.title, summary: r.summary, toolName: payload.toolName, args: payload.args, approvalDetails: payload.approvalDetails, createdAt: r.createdAt }
            }),
            message: 'Multiple pending approvals matched. Ask which ones to approve, or approve them with actionRequestIds.',
          },
        }
      }

      const results: ToolResult[] = []
      for (const req of filtered) {
        results.push(await replayStoredToolApproval({ contractorId, ctx, actionRequest: req, decision: args.decision, notes: args.notes }))
      }
      if (args.decision === 'approved' && duplicateIds.length > 0) {
        await db.actionRequest.updateMany({ where: { contractorId, id: { in: duplicateIds }, status: { in: ['pending', 'needs_approval'] } }, data: { status: 'rejected', rejectedAt: new Date() } }).catch(() => null)
        await db.inboxItem.updateMany({ where: { contractorId, actionRequestId: { in: duplicateIds } }, data: { status: 'actioned', actionedAt: new Date() } }).catch(() => null)
      }
      const succeeded = results.filter(r => r.success).length
      return {
        success: results.every(r => r.success),
        data: {
          count: results.length,
          succeeded,
          failed: results.length - succeeded,
          duplicateRequestsClosed: args.decision === 'approved' ? duplicateIds.length : 0,
          results: results.map((r, i) => ({ actionRequestId: filtered[i]?.id, success: r.success, data: r.data, error: r.error })),
          message: `${args.decision === 'approved' ? 'Approved' : 'Rejected'} ${results.length} pending request${results.length === 1 ? '' : 's'}. ${succeeded} completed successfully.`,
        },
        error: results.every(r => r.success) ? undefined : 'One or more approval replays failed',
      }
    },
  },

  {
    name: 'get_property_memory',
    description: 'Get property-level canvassing memory: roof observations, door attempts, no-soliciting/renter/new-roof notes, follow-ups, street coverage, and opportunity summary. Use before knocking a house or building a canvassing plan.',
    schema: z.object({ propertyMemoryId: z.string().optional(), canvassingLeadId: z.string().optional(), address: z.string().optional(), status: z.string().optional(), limit: z.number().optional() }),
    allowedChannels: ['main', 'sales', 'management', 'crew'],
    execute: async (args, contractorId, ctx) => {
      const result = await getPropertyMemoryContext(await buildTrustedToolTenantContext(contractorId, ctx), args)
      return { success: true, data: result }
    },
  },
  {
    name: 'upsert_property_memory',
    description: 'Create or update a property memory record for a house without making it a lead/customer. Store property/workflow observations like new roof, missing shingles, renter, no soliciting, visible damage, follow-up reason, and roof opportunity score.',
    schema: z.object({
      address: z.string().optional(), city: z.string().optional(), state: z.string().optional(), postalCode: z.string().optional(), homeownerName: z.string().optional(), phone: z.string().optional(), primaryLeadId: z.string().optional(), customerId: z.string().optional(), projectId: z.string().optional(), sessionId: z.string().optional(), propertyType: z.string().optional(), occupancyStatus: z.string().optional(), solicitationStatus: z.string().optional(), roofCondition: z.string().optional(), roofAgeSignal: z.string().optional(), damageSignal: z.string().optional(), opportunityScore: z.number().optional(), priority: z.string().optional(), status: z.string().optional(), summary: z.string().optional(), notes: z.string().optional(), tags: z.array(z.string()).optional(), location: z.object({ lat: z.number().optional(), lng: z.number().optional(), latitude: z.number().optional(), longitude: z.number().optional(), accuracyMeters: z.number().optional(), source: z.string().optional() }).optional(),
    }),
    allowedChannels: ['main', 'sales', 'management', 'crew'],
    execute: async (args, contractorId, ctx) => {
      const property = await upsertPropertyMemory(await buildTrustedToolTenantContext(contractorId, ctx), args)
      return { success: true, data: { property, card: { cardType: 'property_memory', propertyMemoryId: property.id, address: property.address, roofCondition: property.roofCondition, damageSignal: property.damageSignal, solicitationStatus: property.solicitationStatus, occupancyStatus: property.occupancyStatus, opportunityScore: property.opportunityScore, status: property.status } } }
    },
  },
  {
    name: 'record_property_observation',
    description: 'Record a property-level observation such as new roof, visible missing shingles, tarp/felt paper, hail/wind damage, no-soliciting sign, renter, dog/gate, or general note.',
    schema: z.object({ propertyMemoryId: z.string().optional(), canvassingLeadId: z.string().optional(), sessionId: z.string().optional(), type: z.string().min(1), title: z.string().optional(), summary: z.string().optional(), roofCondition: z.string().optional(), damageSignal: z.string().optional(), severity: z.string().optional(), confidence: z.number().optional(), photoDocumentId: z.string().optional(), location: z.object({ lat: z.number().optional(), lng: z.number().optional(), latitude: z.number().optional(), longitude: z.number().optional(), accuracyMeters: z.number().optional(), source: z.string().optional() }).optional() }),
    allowedChannels: ['main', 'sales', 'management', 'crew'],
    execute: async (args, contractorId, ctx) => {
      const observation = await recordPropertyObservation(await buildTrustedToolTenantContext(contractorId, ctx), args)
      return { success: true, data: { observation, card: { cardType: 'property_observation', observationId: observation.id, propertyMemoryId: observation.propertyMemoryId, type: observation.type, title: observation.title, summary: observation.summary } } }
    },
  },
  {
    name: 'record_door_attempt',
    description: 'Record a door attempt/outcome against property memory: no answer, spoke, interested, follow-up, not interested, renter, no soliciting, do not knock, or inspection set.',
    schema: z.object({ propertyMemoryId: z.string().optional(), canvassingLeadId: z.string().optional(), sessionId: z.string().optional(), outcome: z.string().min(1), contactName: z.string().optional(), contactRole: z.string().optional(), summary: z.string().optional(), scriptUsed: z.string().optional(), objection: z.string().optional(), nextStep: z.string().optional(), followUpAt: z.string().optional(), location: z.object({ lat: z.number().optional(), lng: z.number().optional(), latitude: z.number().optional(), longitude: z.number().optional(), accuracyMeters: z.number().optional(), source: z.string().optional() }).optional() }),
    allowedChannels: ['main', 'sales', 'management', 'crew'],
    execute: async (args, contractorId, ctx) => {
      const attempt = await recordDoorAttempt(await buildTrustedToolTenantContext(contractorId, ctx), args)
      return { success: true, data: { attempt, card: { cardType: 'door_attempt', attemptId: attempt.id, propertyMemoryId: attempt.propertyMemoryId, outcome: attempt.outcome, summary: attempt.summary, followUpAt: attempt.followUpAt } } }
    },
  },
  {
    name: 'create_canvassing_game_plan',
    description: 'Create a partner-style canvassing game plan from property memory, follow-ups, opportunity signals, rep energy/mindset, focus mode, and territory history. Should feel like a supportive partner, not a boss.',
    schema: z.object({ sessionId: z.string().optional(), title: z.string().optional(), territoryName: z.string().optional(), focusMode: z.string().optional(), energyLevel: z.string().optional(), customerFocus: z.string().optional(), timeBudgetMinutes: z.number().optional(), goalDoors: z.number().optional(), goalConversations: z.number().optional(), goalInspections: z.number().optional(), notes: z.string().optional(), location: z.object({ lat: z.number().optional(), lng: z.number().optional(), latitude: z.number().optional(), longitude: z.number().optional(), accuracyMeters: z.number().optional(), source: z.string().optional() }).optional() }),
    allowedChannels: ['main', 'sales', 'management'],
    execute: async (args, contractorId, ctx) => {
      const result = await createCanvassingGamePlan(await buildTrustedToolTenantContext(contractorId, ctx), args)
      return { success: true, data: { ...result, card: { cardType: 'canvassing_game_plan', planId: result.plan.id, title: result.plan.title, focusMode: result.plan.focusMode, strategySummary: result.plan.strategySummary, recommendedStart: result.plan.recommendedStart, goals: { doors: result.plan.goalDoors, conversations: result.plan.goalConversations, inspections: result.plan.goalInspections }, recommendations: result.recommendations.recommendations } } }
    },
  },
  {
    name: 'research_property_now',
    description: 'Actively research a house/property on demand from an address or current GPS context. Use when the rep says "I am approaching this house", "research this property", or asks who owns/what is known about a house. Creates a research run and candidate cards; candidates should be confirmed before saving to long-term property memory.',
    schema: z.object({
      mode: z.string().optional(), query: z.string().optional(), address: z.string().optional(), city: z.string().optional(), state: z.string().optional(), postalCode: z.string().optional(), streets: z.array(z.string()).optional(), focusMode: z.string().optional(), energyLevel: z.string().optional(), mindset: z.string().optional(), timeBudgetMinutes: z.number().optional(), goalDoors: z.number().optional(), goalConversations: z.number().optional(), goalInspections: z.number().optional(), notes: z.string().optional(), allowProviderLookup: z.boolean().optional(),
      location: z.object({ lat: z.number().optional(), lng: z.number().optional(), latitude: z.number().optional(), longitude: z.number().optional(), accuracyMeters: z.number().optional(), source: z.string().optional() }).optional(),
    }),
    allowedChannels: ['main', 'sales', 'management', 'crew'],
    execute: async (args, contractorId, ctx) => {
      const result = await researchPropertyNow(await buildTrustedToolTenantContext(contractorId, ctx), args)
      return { success: true, data: result }
    },
  },
  {
    name: 'confirm_property_research_candidate',
    description: 'Confirm a researched property candidate and optionally save it into long-term PropertyMemory. Use after the user confirms the correct house/owner/address.',
    schema: z.object({ researchRunId: z.string().min(1), candidateId: z.string().optional(), createMemory: z.boolean().optional(), status: z.string().optional(), notes: z.string().optional(), confirmedOwnerName: z.string().optional(), confirmedAddress: z.string().optional() }),
    allowedChannels: ['main', 'sales', 'management', 'crew'],
    execute: async (args, contractorId, ctx) => {
      const result = await confirmPropertyResearchCandidate(await buildTrustedToolTenantContext(contractorId, ctx), args.researchRunId, args)
      return { success: true, data: result }
    },
  },
  {
    name: 'get_property_research_run',
    description: 'Get a prior property research run, candidate matches, enrichment snapshots, and the chat-native research card.',
    schema: z.object({ researchRunId: z.string().min(1) }),
    allowedChannels: ['main', 'sales', 'management', 'crew'],
    execute: async (args, contractorId, ctx) => {
      const result = await getPropertyResearchRun(await buildTrustedToolTenantContext(contractorId, ctx), args.researchRunId)
      if (!result) return { success: false, data: null, error: 'Property research run not found' }
      return { success: true, data: result }
    },
  },
  {
    name: 'research_streets_for_canvassing',
    description: 'Research streets on demand and build a supportive partner-style street game plan. Use when the user says they want to work Elm Street/Zoe Street or asks for a canvassing plan. Pulls cached property memory first and optionally configured property data provider results.',
    schema: z.object({ streets: z.array(z.string()).min(1), city: z.string().optional(), state: z.string().optional(), postalCode: z.string().optional(), focusMode: z.string().optional(), energyLevel: z.string().optional(), mindset: z.string().optional(), timeBudgetMinutes: z.number().optional(), goalDoors: z.number().optional(), goalConversations: z.number().optional(), goalInspections: z.number().optional(), notes: z.string().optional(), allowProviderLookup: z.boolean().optional() }),
    allowedChannels: ['main', 'sales', 'management'],
    execute: async (args, contractorId, ctx) => {
      const result = await researchPropertyNow(await buildTrustedToolTenantContext(contractorId, ctx), { ...args, mode: 'street_game_plan' })
      return { success: true, data: result }
    },
  },
  {
    name: 'get_street_research_runs',
    description: 'List street research/game-plan runs created for canvassing strategy.',
    schema: z.object({ status: z.string().optional(), limit: z.number().optional() }),
    allowedChannels: ['main', 'sales', 'management'],
    execute: async (args, contractorId, ctx) => {
      const result = await getStreetResearchRuns(await buildTrustedToolTenantContext(contractorId, ctx), args)
      return { success: true, data: result }
    },
  },

  {
    name: 'start_field_inspection_lead',
    description: 'Save a newly landed field inspection from the current GPS/location when the user is at an unknown house and there is not yet a confirmed customer/project/appointment. Use for phrases like "walking up for an inspection", "I just landed this inspection", "they were outside mowing", or "add this inspection at my location". Do NOT use for generic "create a lead" or property research unless the user clearly says this is an inspection/appointment. Creates or reuses an active FIELD session, creates an inspection-set lead/pin, logs the field outcome, and optionally runs property lookup. This is not a door-knocking canvassing run and it does not create a real customer/project until the user confirms conversion.',
    schema: z.object({
      sessionId: z.string().optional(),
      address: z.string().optional(),
      homeownerName: z.string().optional(),
      phone: z.string().optional(),
      notes: z.string().optional(),
      searchPropertyInfo: z.boolean().optional(),
      location: z.object({ lat: z.number().optional(), lng: z.number().optional(), latitude: z.number().optional(), longitude: z.number().optional(), accuracyMeters: z.number().optional(), source: z.string().optional() }).optional(),
    }),
    allowedChannels: ['main', 'sales', 'management', 'crew'],
    execute: async (args, contractorId, ctx) => {
      const tenant = await buildTrustedToolTenantContext(contractorId, ctx)
      const unsafeInternalNotes = args.notes && /Common recovery examples:|You said "|MUST call the correct tool|Respond as JSON only\.|Tool results:/i.test(args.notes)
      const safeNotes = unsafeInternalNotes ? undefined : args.notes?.trim()
      let sessionId = args.sessionId
      if (!sessionId) {
        const existingSession = await db.canvassingSession.findFirst({
          where: {
            contractorId,
            status: { in: ['active', 'paused'] },
            ...(ctx.userId ? { userId: ctx.userId } : {}),
          },
          orderBy: { startedAt: 'desc' },
          select: { id: true },
        })
        if (existingSession) {
          sessionId = existingSession.id
        } else {
          const session = await startCanvassingSession(tenant, {
            title: 'Field inspection run',
            territoryName: 'Current field area',
            notes: 'Started from a newly landed field inspection.',
            mode: 'field',
            location: args.location,
          })
          sessionId = session.id
        }
      }
      const notes = [
        safeNotes,
        'New inspection landed in the field. Save as inspection lead until customer/project is confirmed.',
      ].filter(Boolean).join('\n')
      const lead = await createCanvassingLead(tenant, {
        sessionId,
        address: args.address,
        homeownerName: args.homeownerName,
        phone: args.phone,
        notes,
        status: 'inspection_set',
        source: 'field_inspection',
        location: args.location,
        metadata: { fieldInspection: true },
      })
      const activity = await logCanvassingActivity(tenant, {
        leadId: lead.id,
        sessionId,
        type: 'inspection_set',
        status: 'inspection_set',
        summary: safeNotes || 'Inspection landed from the field.',
        notes: safeNotes,
        location: args.location,
        metadata: { fieldInspection: true },
      })
      const shouldResearchProperty = args.searchPropertyInfo !== false
      const propertyResearch = shouldResearchProperty
        ? await researchPropertyNow(tenant, {
            mode: 'approaching_house',
            query: args.address || 'current GPS location',
            address: args.address,
            location: args.location,
            notes: safeNotes,
            allowProviderLookup: true,
          }).catch(error => ({ error: error instanceof Error ? error.message : 'Property lookup failed' }))
        : null
      return {
        success: true,
        data: {
          sessionId,
          lead,
          activity,
          propertyResearch,
          message: 'Saved the current-location inspection as an inspection lead. Confirm the property/customer details before converting it to a customer/project.',
          card: {
            cardType: 'field_inspection_lead',
            leadId: lead.id,
            sessionId,
            address: lead.address,
            homeownerName: lead.homeownerName,
            phone: lead.phone,
            status: lead.status,
            latitude: lead.latitude,
            longitude: lead.longitude,
            propertyResearch: propertyResearch && typeof propertyResearch === 'object' ? propertyResearch : null,
            photoSections: ['Front elevation', 'All elevations', 'Roof overview', 'Roof slopes/facets', 'Hail/wind damage', 'Soft metals / gutters / vents', 'Interior', 'Attic', 'Detached structures', 'Documents / scope'],
            summary: safeNotes || 'Inspection landed from the field.',
          },
        },
      }
    },
  },

  {
    name: 'create_canvassing_lead_at_location',
    description: 'Create a potential/customer lead from a door knock, conversation, name/address, or current GPS location when it does not yet have a confirmed customer/project. Use for "create a lead for Natalie at 486 North Charles St" or door/conversation leads before an inspection is set. Do NOT use this for a newly landed inspection/appointment; use start_field_inspection_lead instead.',
    schema: z.object({
      sessionId: z.string().optional(),
      address: z.string().optional(),
      homeownerName: z.string().optional(),
      phone: z.string().optional(),
      notes: z.string().optional(),
      status: z.string().optional(),
      location: z.object({ lat: z.number().optional(), lng: z.number().optional(), latitude: z.number().optional(), longitude: z.number().optional(), accuracyMeters: z.number().optional(), source: z.string().optional() }).optional(),
    }),
    allowedChannels: ['main', 'sales', 'management'],
    execute: async (args, contractorId, ctx) => {
      const lead = await createCanvassingLead(await buildTrustedToolTenantContext(contractorId, ctx), args)
      return { success: true, data: { lead, card: { cardType: 'canvassing_lead', leadId: lead.id, address: lead.address, homeownerName: lead.homeownerName, phone: lead.phone, status: lead.status, latitude: lead.latitude, longitude: lead.longitude } } }
    },
  },
  {
    name: 'get_canvassing_map',
    description: 'Read saved field/canvassing map data: active sessions, GPS lead pins, statuses, recent activity, and counts. Use for questions like "what has been canvassed", "which leads need follow-up", or "show saved field pins". This is read-only data retrieval; it does NOT open the visual map UI and must not create a session/lead.',
    schema: z.object({ sessionId: z.string().optional(), status: z.string().optional(), includeConverted: z.boolean().optional(), limit: z.number().optional() }),
    allowedChannels: 'all',
    execute: async (args, contractorId, ctx) => {
      const result = await getCanvassingMap(await buildTrustedToolTenantContext(contractorId, ctx), args)
      return { success: true, data: result }
    },
  },
  {
    name: 'start_canvassing_session',
    description: 'Start a door-knocking canvassing session/territory for a rep or crew only when the user explicitly wants canvassing, a street run, or territory work. Do NOT use this for "open map", "where I am", "at this house", "I landed an inspection", "walking up for an inspection", or property lookup; use read-only map navigation, research_property_now, or start_field_inspection_lead instead.',
    schema: z.object({ title: z.string().optional(), territoryName: z.string().optional(), notes: z.string().optional(), location: z.object({ lat: z.number().optional(), lng: z.number().optional(), latitude: z.number().optional(), longitude: z.number().optional(), accuracyMeters: z.number().optional(), source: z.string().optional() }).optional() }),
    allowedChannels: ['main', 'sales', 'management'],
    execute: async (args, contractorId, ctx) => {
      const session = await startCanvassingSession(await buildTrustedToolTenantContext(contractorId, ctx), args)
      return { success: true, data: { session, card: { cardType: 'canvassing_session', sessionId: session.id, title: session.title, territoryName: session.territoryName, status: session.status } } }
    },
  },
  {
    name: 'log_canvassing_activity',
    description: 'Log a canvassing activity for a lead/session such as knock, no_answer, interested, follow_up, not_interested, note, or photo. Updates the lead status when supplied.',
    schema: z.object({ leadId: z.string().optional(), sessionId: z.string().optional(), type: z.string().min(1), summary: z.string().optional(), status: z.string().optional(), notes: z.string().optional(), location: z.object({ lat: z.number().optional(), lng: z.number().optional(), latitude: z.number().optional(), longitude: z.number().optional(), accuracyMeters: z.number().optional(), source: z.string().optional() }).optional() }),
    allowedChannels: ['main', 'sales', 'management'],
    execute: async (args, contractorId, ctx) => {
      const result = await logCanvassingActivity(await buildTrustedToolTenantContext(contractorId, ctx), args)
      return { success: true, data: result }
    },
  },
  {
    name: 'convert_canvassing_lead_to_project',
    description: 'Convert an interested canvassing lead into a real customer, project, workspace/job thread, and project timeline event. Requires approval.',
    schema: z.object({ leadId: z.string().min(1), customerName: z.string().optional(), projectTitle: z.string().optional(), projectValue: z.number().optional(), notes: z.string().optional() }),
    allowedChannels: ['main', 'sales', 'management'],
    requiresApproval: true,
    execute: async (args, contractorId, ctx) => {
      const result = await convertCanvassingLead(await buildTrustedToolTenantContext(contractorId, ctx), args.leadId, args)
      if (!result) return { success: false, data: null, error: 'Canvassing lead not found' }
      return { success: true, data: result }
    },
  },

  // ── Orchestrator planning consultant ─────────────────────────────────────
  {
    name: 'consult_orchestrator',
    description: 'Analyze a complex or ambiguous request and produce a structured execution plan with recommended steps, tool suggestions, missing context, and risks. This is a read-only planning tool — it does NOT execute anything, mutate data, or send messages. Use it before coordinating across customers, projects, documents, signatures, property memory, canvassing, and roof reports. Do NOT use it for simple single-step questions.',
    schema: z.object({
      userRequest: z.string().min(1).describe('The user request to analyze and plan for'),
      channelType: z.string().optional().describe('Current channel type (main, customer, crew, etc.)'),
      entityContext: z.string().optional().describe('Context about the current project, customer, or workspace'),
    }),
    allowedChannels: 'all',
    // Read-only planning tool — no approval needed since it cannot mutate anything
    requiresApproval: false,
    execute: async (args, _contractorId, _ctx) => {
      const { consultOrchestrator } = await import('./orchestrator-adapter')
      try {
        const plan = await consultOrchestrator({
          userRequest: args.userRequest,
          channelType: args.channelType as ChannelType | undefined,
          entityContext: args.entityContext,
        })
        return { success: true, data: plan }
      } catch (err) {
        return { success: false, data: null, error: err instanceof Error ? err.message : 'Orchestrator planning failed' }
      }
    },
  },

]

const TOOL_MAP = new Map(TOOLS.map(t => [t.name, t]))

// ---------------------------------------------------------------------------

function humanizeToolName(name: string) {
  return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function approvalRoleForTool(name: string) {
  if (/finance|price|cost|profit|billing/i.test(name)) return 'finance'
  if (/supplier|material|order/i.test(name)) return 'project_manager'
  if (/customer|signature|document|template|profile|delete|archive/i.test(name)) return 'project_manager'
  if (/canvass|property|research|lead/i.test(name)) return 'sales'
  return 'project_manager'
}

// Execute a tool call with validation + permissioning
// ---------------------------------------------------------------------------

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  contractorId: string,
  ctx: ToolContext = {},
): Promise<ToolResult> {
  const tool = TOOL_MAP.get(name)
  if (!tool) return { success: false, data: null, error: `Unknown tool: ${name}` }

  // Channel permissioning
  if (ctx.channelType && tool.allowedChannels !== 'all' && !tool.allowedChannels.includes(permissionChannelForType(ctx.channelType))) {
    return { success: false, data: null, error: `Tool '${name}' not allowed in '${ctx.channelType}' channel` }
  }

  // Schema validation happens before approval so the approval card stores a safe, typed payload.
  const parsed = tool.schema.safeParse(args)
  if (!parsed.success) {
    return { success: false, data: null, error: `Invalid args: ${parsed.error.issues.map(i => i.message).join('; ')}` }
  }

  // SECURITY: Enforce requiresApproval flag — dangerous tools must not execute autonomously.
  // Instead of dead-ending, create an approval replay request that can be approved from a chat card.
  if (tool.requiresApproval && !ctx.approved && !canRunDirectWithoutApproval(name, ctx)) {
    console.warn(`[tools-v2] APPROVAL REQUIRED: Tool '${name}' contractorId=${contractorId}`)
    const requestedRole = approvalRoleForTool(name)
    const approvalDetails = await buildApprovalDetailsForTool(name, parsed.data, contractorId).catch(err => {
      console.warn(`[tools-v2] approval details failed for ${name}:`, err)
      return {
        title: `Approval needed: ${humanizeToolName(name)}`,
        summary: `Jobrolo wants to run ${humanizeToolName(name)}. Review and approve before execution.`,
        details: compactApprovalArgs(parsed.data),
      } satisfies ApprovalDetail
    })
    const title = approvalDetails.title
    const summary = approvalDetails.summary
    const approvalKey = `${name}:${stableStringify(parsed.data)}`
    const payload = { toolName: name, args: parsed.data, toolContext: ctx, approvalDetails, approvalKey }
    const pendingRequests = await db.actionRequest.findMany({
      where: {
        contractorId,
        type: 'tool_approval',
        status: { in: ['pending', 'needs_approval'] },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, status: true, title: true, summary: true, payloadJson: true },
    }).catch(() => [])
    const existing = pendingRequests.find(req => {
      const existingPayload = safeJsonParse<{ toolName?: string; args?: Record<string, unknown>; approvalKey?: string }>(req.payloadJson, {})
      if (existingPayload.approvalKey && existingPayload.approvalKey === approvalKey) return true
      return existingPayload.toolName === name && stableStringify(existingPayload.args ?? {}) === stableStringify(parsed.data)
    }) ?? null
    if (existing) {
      return {
        success: true,
        data: { approvalRequired: true, actionRequestId: existing.id, status: existing.status, title: existing.title, summary: existing.summary, toolName: name, approvalDetails },
        error: 'Awaiting human approval',
      }
    }
    const actionRequest = await db.actionRequest.create({
      data: {
        contractorId,
        createdByUserId: ctx.userId ?? null,
        requestedRole,
        type: 'tool_approval',
        title,
        summary,
        status: 'needs_approval',
        priority: 'normal',
        payloadJson: JSON.stringify(payload),
      },
    })
    await db.approvalRequest.create({ data: { contractorId, actionRequestId: actionRequest.id, approverRole: requestedRole } }).catch(() => null)
    await db.inboxItem.create({
      data: {
        contractorId,
        userId: null,
        role: requestedRole,
        type: 'approval_request',
        title,
        summary,
        status: 'unread',
        priority: 'normal',
        actionRequestId: actionRequest.id,
        payloadJson: JSON.stringify({ cardType: 'approval_request', actionRequestId: actionRequest.id, toolName: name, args: parsed.data, approvalDetails, approvalKey }),
      },
    }).catch(() => null)
    return { success: true, data: { approvalRequired: true, actionRequestId: actionRequest.id, status: actionRequest.status, title, summary, toolName: name, approvalDetails }, error: 'Awaiting human approval' }
  }

  try {
    if (tool.requiresApproval && ctx.approved && !ctx.approvalActionRequestId && !canRunDirectWithoutApproval(name, ctx)) {
      return { success: false, data: null, error: 'Trusted approval context required' }
    }
    if (tool.requiresApproval && ctx.approved && ctx.approvalActionRequestId) {
      const approvedRequest = await db.actionRequest.findFirst({
        where: {
          id: ctx.approvalActionRequestId,
          contractorId,
          type: 'tool_approval',
          status: { in: ['approved', 'completed'] },
        },
        select: { id: true, payloadJson: true },
      })
      if (!approvedRequest) return { success: false, data: null, error: 'Approval not found' }
      const approvedPayload = JSON.parse(approvedRequest.payloadJson || '{}') as { toolName?: string; args?: unknown }
      if (approvedPayload.toolName !== name || stableStringify(approvedPayload.args ?? {}) !== stableStringify(parsed.data)) {
        return { success: false, data: null, error: 'Approval does not match requested action' }
      }
    }
    const result = await tool.execute(parsed.data, contractorId, ctx)
    // Log all tool executions for audit trail
    console.log(`[tools-v2] Tool '${name}' executed by contractor ${contractorId}: success=${result.success}`)
    return result
  } catch (err) {
    console.error(`[tools-v2] ${name} failed:`, err)
    return { success: false, data: null, error: err instanceof Error ? err.message : 'Tool execution failed' }
  }
}

export function isToolAllowedInChannel(name: string, channel: ChannelType): boolean {
  const tool = TOOL_MAP.get(name)
  if (!tool) return false
  if (tool.allowedChannels === 'all') return true
  return tool.allowedChannels.includes(permissionChannelForType(channel))
}

export function getToolDefinitions(): Array<{ name: string; description: string; parameters: Record<string, unknown>; requiredParams: string[] }> {
  return TOOLS.map(t => ({
    name: t.name,
    description: t.description,
    parameters: extractParamsFromSchema(t.schema),
    requiredParams: extractRequiredParams(t.schema),
  }))
}

function extractParamsFromSchema(schema: z.ZodType<any>): Record<string, unknown> {
  // Zod v4 — _zod.def.shape
  const def: any = (schema as any)._zod?.def ?? (schema as any)._def
  if (!def) return {}
  const shape = def.shape
  if (!shape) return {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(shape)) {
    const propDef: any = (v as any)._zod?.def ?? (v as any)._def
    const typeName = String(propDef?.typeName ?? (v as any)._zod?.def?.type ?? propDef?.type ?? '').toLowerCase()
    let type = 'string'
    if (typeName.includes('string')) type = 'string'
    else if (typeName.includes('number')) type = 'number'
    else if (typeName.includes('boolean')) type = 'boolean'
    out[k] = { type, description: propDef?.description ?? '' }
  }
  return out
}

function extractRequiredParams(schema: z.ZodType<any>): string[] {
  const def: any = (schema as any)._zod?.def ?? (schema as any)._def
  if (!def) return []
  const shape = def.shape
  if (!shape) return []
  const required: string[] = []
  for (const [k, v] of Object.entries(shape)) {
    const propDef: any = (v as any)._zod?.def ?? (v as any)._def
    const typeName = String(propDef?.typeName ?? propDef?.type ?? '').toLowerCase()
    if (!typeName.includes('optional')) required.push(k)
  }
  return required
}
