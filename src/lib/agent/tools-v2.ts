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
import { ROOFING_SYNONYMS } from '@/lib/specialized-parsers'
import { toFileUrl, toThumbnailUrl } from '@/lib/file-url'
import { getProjectContextByContractor, getProjectDocumentPacket, linkDocumentToJobPacket, createProjectTimelineEvent, getProjectTimeline, getContractorOcrReviewQueue } from '@/lib/project-context'
import { buildProjectMergeData, getOrCreateContractorProfile, mergeTemplateVariables, publicContractorProfile, upsertContractorProfile } from '@/lib/contractor-profile'
import { createTemplateUploadFromDocument, analyzeTemplateUpload, getTemplateReview, approveDocumentTemplate, generateDocumentFromTemplate, TEMPLATE_VARIABLES } from '@/lib/template-intake'
import { getFieldBriefing, executeFieldAction, resolveFieldEntity, listCopilotInbox, decideActionRequest } from '@/lib/field-copilot'
import { createUnsignedDocumentPdf, getSignedDocumentArtifacts } from '@/lib/final-documents'
import { getRoofReportWorkspace, generateRoofReportSummary, finalizeRoofReport, createRoofReportPdf } from '@/lib/roof-reports'
import { getCanvassingMap, startCanvassingSession, createCanvassingLead, logCanvassingActivity, convertCanvassingLead } from '@/lib/canvassing'
import { getPropertyMemoryContext, upsertPropertyMemory, recordPropertyObservation, recordDoorAttempt, createCanvassingGamePlan } from '@/lib/property-memory'
import { researchPropertyNow, getPropertyResearchRun, confirmPropertyResearchCandidate, getStreetResearchRuns } from '@/lib/property-research'
import { sanitizeHtml } from '@/lib/security/html'

export interface ToolContext {
  workspaceId?: string
  chatId?: string
  channelType?: ChannelType
  userId?: string
  documentIds?: string[]  // IDs of documents uploaded with the current message
  approved?: boolean      // Set to true when a human has approved the action
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
      const mergeContext = await buildProjectMergeData({ contractorId })
      return { success: true, data: { profile: publicContractorProfile(profile), availableMergeFields: Object.keys(mergeContext.data).sort(), mergePreview: mergeContext.data } }
    },
  },
  {
    name: 'update_contractor_profile',
    description: 'Update the contractor company profile: company name, logo URL/document, contact info, address, license, brand colors, legal footer, default terms, warranty text, report/contract/estimate disclaimers. Requires human approval.',
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
    }),
    allowedChannels: ['main', 'management'],
    requiresApproval: true,
    execute: async (args, contractorId) => {
      const profile = await upsertContractorProfile(contractorId, args)
      return { success: true, data: { profile: publicContractorProfile(profile) } }
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
        doc = await db.document.findUnique({ where: { id: args.documentId } })
      } else if (args.filename) {
        const lower = args.filename.toLowerCase()
        const all = await db.document.findMany({ where: { contractorId }, orderBy: { createdAt: 'desc' }, take: 50 })
        doc = all.find(d => d.originalName.toLowerCase().includes(lower))
      }
      if (!doc || doc.contractorId !== contractorId) return { success: false, data: null, error: 'Document not found. Call list_documents.' }
      let extractedData: unknown = null
      try { extractedData = doc.extractedData ? JSON.parse(doc.extractedData) : null } catch {}

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
          missingData: doc.missingDataFlags ? JSON.parse(doc.missingDataFlags) : null,
          reviewNotes: doc.extractedData ? (JSON.parse(doc.extractedData).reviewNotes ?? []) : [],
          warnings: doc.extractedData ? (JSON.parse(doc.extractedData).warnings ?? []) : [],
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
    description: 'Search customers by name, phone, or email.',
    schema: z.object({ query: z.string().min(1).max(200) }),
    allowedChannels: 'all',
    execute: async (args, contractorId) => {
      const customers = await db.customer.findMany({
        where: { contractorId, OR: [
          { name: { contains: args.query } },
          { phone: { contains: args.query } },
          { email: { contains: args.query } },
        ] },
        take: 10,
      })
      return { success: true, data: { count: customers.length, customers } }
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
        console.log(`[tools-v2] create_customer: linked ${linkedDocs} document(s) to ${customer.name}`)
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
      const doc = await db.document.findUnique({ where: { id: args.documentId } })
      if (!doc || doc.contractorId !== contractorId) {
        return { success: false, data: null, error: 'Document not found' }
      }
      // Delete the physical file too
      try {
        const fs = await import('node:fs/promises')
        await fs.unlink(doc.filePath).catch(() => {})
        if (doc.thumbnailPath) await fs.unlink(doc.thumbnailPath).catch(() => {})
      } catch {}
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
      const fs = await import('node:fs/promises')
      let deletedCount = 0
      for (const doc of docs) {
        try {
          await fs.unlink(doc.filePath).catch(() => {})
          if (doc.thumbnailPath) await fs.unlink(doc.thumbnailPath).catch(() => {})
        } catch {}
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
    execute: async (args, contractorId) => {
      const doc = await db.document.findUnique({ where: { id: args.documentId } })
      if (!doc || doc.contractorId !== contractorId) {
        return { success: false, data: null, error: 'Document not found' }
      }
      // Enqueue a new doc_analysis job
      const { enqueueAgentJob } = await import('@/lib/jobs/queue')
      await enqueueAgentJob({
        contractorId,
        type: 'doc_analysis',
        input: { documentId: args.documentId, heicConversionNeeded: false },
        priority: 3,
      })
      return { success: true, data: { documentId: args.documentId, message: `Re-processing document "${doc.originalName}". Results will be available in 10-30 seconds.` } }
    },
  },
  {
    name: 'link_document_to_customer',
    description: 'Link an uploaded document to a customer. Use when a user asks to associate/attach/tie a document to a specific customer. Also links to the customer\'s active project if one exists.',
    schema: z.object({
      documentId: z.string().min(1).max(200),
      customerName: z.string().min(1).max(200),
    }),
    allowedChannels: 'all',
    execute: async (args, contractorId) => {
      const doc = await db.document.findUnique({ where: { id: args.documentId } })
      if (!doc || doc.contractorId !== contractorId) {
        return { success: false, data: null, error: 'Document not found' }
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
        where: { customerId: customer.id, status: 'active' },
        include: { workspace: true },
      })
      await db.document.update({
        where: { id: args.documentId },
        data: {
          customerId: customer.id,
          projectId: project?.id ?? null,
          workspaceId: project?.workspace?.id ?? null,
        },
      })
      if (project?.id) {
        await linkDocumentToJobPacket({
          contractorId,
          documentId: args.documentId,
          projectId: project.id,
          customerId: customer.id,
          entityType: 'project',
          entityId: project.id,
          role: 'attachment',
          label: doc.originalName,
          source: 'ai',
          metadata: { linkedVia: 'link_document_to_customer' },
        }).catch(() => null)
      }
      console.log(`[tools-v2] link_document_to_customer: linked ${doc.originalName} to ${customer.name}`)
      return {
        success: true,
        data: {
          documentId: args.documentId,
          documentName: doc.originalName,
          customerId: customer.id,
          customerName: customer.name,
          projectId: project?.id ?? null,
          message: `Document "${doc.originalName}" linked to ${customer.name}.`,
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
    name: 'generate_roof_report_summary',
    description: 'Draft or refresh the roof report summary, observed conditions, recommendations, and conclusion from the report photos. Requires approval because it updates the report.',
    schema: z.object({ reportId: z.string() }),
    allowedChannels: ['main', 'sales', 'customer'],
    requiresApproval: true,
    execute: async (args, contractorId, ctx) => {
      const report = await generateRoofReportSummary({ contractorId, user: ctx.userId ? { id: ctx.userId } as any : undefined } as any, args.reportId)
      return { success: true, data: { report, builderUrl: `/reports/${report.id}`, printUrl: `/api/roof-reports/${report.id}/print` } }
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
      return { success: true, data: { report, builderUrl: `/reports/${report.id}`, printUrl: `/api/roof-reports/${report.id}/print` } }
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
      const contractor = await db.contractor.findFirst({ where: { id: contractorId }, select: { id: true, name: true, company: true, plan: true, status: true } })
      if (!contractor) return { success: false, data: null, error: 'Contractor not found' }
      const result = await createUnsignedDocumentPdf({
        ctx: { contractorId, contractor, user: ctx.userId ? { id: ctx.userId, contractorId, name: '', email: '', role: 'manager', status: 'active' } : null, actor: 'ai', authMethod: 'system' },
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
      const contractor = await db.contractor.findFirst({ where: { id: contractorId }, select: { id: true, name: true, company: true, plan: true, status: true } })
      if (!contractor) return { success: false, data: null, error: 'Contractor not found' }
      const artifacts = await getSignedDocumentArtifacts({ contractorId, contractor, user: ctx.userId ? { id: ctx.userId, contractorId, name: '', email: '', role: 'manager', status: 'active' } : null, actor: 'ai', authMethod: 'system' }, args.generatedDocumentId)
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
      const upload = await createTemplateUploadFromDocument({ contractorId, contractor: { id: contractorId, name: '', company: null, plan: 'free', status: 'active' }, user: ctx.userId ? { id: ctx.userId, contractorId, name: '', email: '', role: 'manager', status: 'active' } : null, actor: 'ai', authMethod: 'system' }, args)
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
      const result = await analyzeTemplateUpload({ contractorId, contractor: { id: contractorId, name: '', company: null, plan: 'free', status: 'active' }, user: ctx.userId ? { id: ctx.userId, contractorId, name: '', email: '', role: 'manager', status: 'active' } : null, actor: 'ai', authMethod: 'system' }, args.uploadId)
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
      const template = await approveDocumentTemplate({ contractorId, contractor: { id: contractorId, name: '', company: null, plan: 'free', status: 'active' }, user: ctx.userId ? { id: ctx.userId, contractorId, name: '', email: '', role: 'manager', status: 'active' } : null, actor: 'ai', authMethod: 'system' }, args.templateId)
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
      const generated = await generateDocumentFromTemplate({ contractorId, contractor: { id: contractorId, name: '', company: null, plan: 'free', status: 'active' }, user: ctx.userId ? { id: ctx.userId, contractorId, name: '', email: '', role: 'manager', status: 'active' } : null, actor: 'ai', authMethod: 'system' }, {
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
      const briefing = await getFieldBriefing({ contractorId, contractor: { id: contractorId, name: '', company: null, plan: 'free', status: 'active' }, user: ctx.userId ? { id: ctx.userId, contractorId, name: '', email: '', role: 'manager', status: 'active' } : null, actor: 'ai', authMethod: 'system' }, args)
      if (!briefing) return { success: false, data: null, error: 'Project not found' }
      return { success: true, data: { briefing } }
    },
  },
  {
    name: 'log_field_action',
    description: 'Log a Field Copilot quick action such as arrived, inspection started, no answer, adjuster present, customer signed, production started, need material, issue found, or completed. This writes to the field visit, appointment status, project timeline, workspace event cards, and role inbox routing. Requires approval in chat; direct field UI buttons can call the API.',
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
    requiresApproval: true,
    execute: async (args, contractorId, ctx) => {
      const result = await executeFieldAction({ contractorId, contractor: { id: contractorId, name: '', company: null, plan: 'free', status: 'active' }, user: ctx.userId ? { id: ctx.userId, contractorId, name: '', email: '', role: 'manager', status: 'active' } : null, actor: 'ai', authMethod: 'system' }, args)
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
      const result = await resolveFieldEntity({ contractorId, contractor: { id: contractorId, name: '', company: null, plan: 'free', status: 'active' }, user: ctx.userId ? { id: ctx.userId, contractorId, name: '', email: '', role: 'manager', status: 'active' } : null, actor: 'ai', authMethod: 'system' }, args)
      return { success: true, data: result }
    },
  },
  {
    name: 'get_copilot_inbox',
    description: 'List role-routed Jobrolo Copilot inbox items/action cards for the current user or role, such as crew material requests, PM approvals, supplier orders, finance items, owner summaries, and field issues.',
    schema: z.object({ role: z.string().optional(), projectId: z.string().optional(), status: z.string().optional(), limit: z.number().optional() }),
    allowedChannels: 'all',
    execute: async (args, contractorId, ctx) => {
      const inbox = await listCopilotInbox({ contractorId, contractor: { id: contractorId, name: '', company: null, plan: 'free', status: 'active' }, user: ctx.userId ? { id: ctx.userId, contractorId, name: '', email: '', role: args.role ?? 'manager', status: 'active' } : null, actor: 'ai', authMethod: 'system' }, args)
      return { success: true, data: inbox }
    },
  },
  {
    name: 'decide_action_request',
    description: 'Approve or reject a routed action request, such as a crew material request or field issue. Approval can route supplier/purchasing tasks, update inbox cards, and log the decision to the job timeline. Requires human approval.',
    schema: z.object({ actionRequestId: z.string().min(1), decision: z.enum(['approved', 'rejected']), notes: z.string().optional() }),
    allowedChannels: ['main', 'management', 'crew', 'supplier', 'finance'],
    requiresApproval: true,
    execute: async (args, contractorId, ctx) => {
      const request = await decideActionRequest({ contractorId, contractor: { id: contractorId, name: '', company: null, plan: 'free', status: 'active' }, user: ctx.userId ? { id: ctx.userId, contractorId, name: '', email: '', role: 'manager', status: 'active' } : null, actor: 'ai', authMethod: 'system' }, args.actionRequestId, args.decision, args.notes)
      if (!request) return { success: false, data: null, error: 'Action request not found' }
      return { success: true, data: { actionRequest: request } }
    },
  },

  {
    name: 'get_property_memory',
    description: 'Get property-level canvassing memory: roof observations, door attempts, no-soliciting/renter/new-roof notes, follow-ups, street coverage, and opportunity summary. Use before knocking a house or building a canvassing plan.',
    schema: z.object({ propertyMemoryId: z.string().optional(), canvassingLeadId: z.string().optional(), address: z.string().optional(), status: z.string().optional(), limit: z.number().optional() }),
    allowedChannels: ['main', 'sales', 'management', 'crew'],
    execute: async (args, contractorId, ctx) => {
      const result = await getPropertyMemoryContext({ contractorId, contractor: { id: contractorId, name: '', company: null, plan: 'free', status: 'active' }, user: ctx.userId ? { id: ctx.userId, contractorId, name: '', email: '', role: 'manager', status: 'active' } : null, actor: 'ai', authMethod: 'system' }, args)
      return { success: true, data: result }
    },
  },
  {
    name: 'upsert_property_memory',
    description: 'Create or update a property memory record for a house without making it a lead/customer. Store property/workflow observations like new roof, missing shingles, renter, no soliciting, visible damage, follow-up reason, and roof opportunity score. Requires approval.',
    schema: z.object({
      address: z.string().optional(), city: z.string().optional(), state: z.string().optional(), postalCode: z.string().optional(), homeownerName: z.string().optional(), phone: z.string().optional(), primaryLeadId: z.string().optional(), customerId: z.string().optional(), projectId: z.string().optional(), sessionId: z.string().optional(), propertyType: z.string().optional(), occupancyStatus: z.string().optional(), solicitationStatus: z.string().optional(), roofCondition: z.string().optional(), roofAgeSignal: z.string().optional(), damageSignal: z.string().optional(), opportunityScore: z.number().optional(), priority: z.string().optional(), status: z.string().optional(), summary: z.string().optional(), notes: z.string().optional(), tags: z.array(z.string()).optional(), location: z.object({ lat: z.number().optional(), lng: z.number().optional(), latitude: z.number().optional(), longitude: z.number().optional(), accuracyMeters: z.number().optional(), source: z.string().optional() }).optional(),
    }),
    allowedChannels: ['main', 'sales', 'management', 'crew'],
    requiresApproval: true,
    execute: async (args, contractorId, ctx) => {
      const property = await upsertPropertyMemory({ contractorId, contractor: { id: contractorId, name: '', company: null, plan: 'free', status: 'active' }, user: ctx.userId ? { id: ctx.userId, contractorId, name: '', email: '', role: 'manager', status: 'active' } : null, actor: 'ai', authMethod: 'system' }, args)
      return { success: true, data: { property, card: { cardType: 'property_memory', propertyMemoryId: property.id, address: property.address, roofCondition: property.roofCondition, damageSignal: property.damageSignal, solicitationStatus: property.solicitationStatus, occupancyStatus: property.occupancyStatus, opportunityScore: property.opportunityScore, status: property.status } } }
    },
  },
  {
    name: 'record_property_observation',
    description: 'Record a property-level observation such as new roof, visible missing shingles, tarp/felt paper, hail/wind damage, no-soliciting sign, renter, dog/gate, or general note. Requires approval.',
    schema: z.object({ propertyMemoryId: z.string().optional(), canvassingLeadId: z.string().optional(), sessionId: z.string().optional(), type: z.string().min(1), title: z.string().optional(), summary: z.string().optional(), roofCondition: z.string().optional(), damageSignal: z.string().optional(), severity: z.string().optional(), confidence: z.number().optional(), photoDocumentId: z.string().optional(), location: z.object({ lat: z.number().optional(), lng: z.number().optional(), latitude: z.number().optional(), longitude: z.number().optional(), accuracyMeters: z.number().optional(), source: z.string().optional() }).optional() }),
    allowedChannels: ['main', 'sales', 'management', 'crew'],
    requiresApproval: true,
    execute: async (args, contractorId, ctx) => {
      const observation = await recordPropertyObservation({ contractorId, contractor: { id: contractorId, name: '', company: null, plan: 'free', status: 'active' }, user: ctx.userId ? { id: ctx.userId, contractorId, name: '', email: '', role: 'manager', status: 'active' } : null, actor: 'ai', authMethod: 'system' }, args)
      return { success: true, data: { observation, card: { cardType: 'property_observation', observationId: observation.id, propertyMemoryId: observation.propertyMemoryId, type: observation.type, title: observation.title, summary: observation.summary } } }
    },
  },
  {
    name: 'record_door_attempt',
    description: 'Record a door attempt/outcome against property memory: no answer, spoke, interested, follow-up, not interested, renter, no soliciting, do not knock, or inspection set. Requires approval.',
    schema: z.object({ propertyMemoryId: z.string().optional(), canvassingLeadId: z.string().optional(), sessionId: z.string().optional(), outcome: z.string().min(1), contactName: z.string().optional(), contactRole: z.string().optional(), summary: z.string().optional(), scriptUsed: z.string().optional(), objection: z.string().optional(), nextStep: z.string().optional(), followUpAt: z.string().optional(), location: z.object({ lat: z.number().optional(), lng: z.number().optional(), latitude: z.number().optional(), longitude: z.number().optional(), accuracyMeters: z.number().optional(), source: z.string().optional() }).optional() }),
    allowedChannels: ['main', 'sales', 'management', 'crew'],
    requiresApproval: true,
    execute: async (args, contractorId, ctx) => {
      const attempt = await recordDoorAttempt({ contractorId, contractor: { id: contractorId, name: '', company: null, plan: 'free', status: 'active' }, user: ctx.userId ? { id: ctx.userId, contractorId, name: '', email: '', role: 'manager', status: 'active' } : null, actor: 'ai', authMethod: 'system' }, args)
      return { success: true, data: { attempt, card: { cardType: 'door_attempt', attemptId: attempt.id, propertyMemoryId: attempt.propertyMemoryId, outcome: attempt.outcome, summary: attempt.summary, followUpAt: attempt.followUpAt } } }
    },
  },
  {
    name: 'create_canvassing_game_plan',
    description: 'Create a partner-style canvassing game plan from property memory, follow-ups, opportunity signals, rep energy/mindset, focus mode, and territory history. Should feel like a supportive partner, not a boss. Requires approval.',
    schema: z.object({ sessionId: z.string().optional(), title: z.string().optional(), territoryName: z.string().optional(), focusMode: z.string().optional(), energyLevel: z.string().optional(), customerFocus: z.string().optional(), timeBudgetMinutes: z.number().optional(), goalDoors: z.number().optional(), goalConversations: z.number().optional(), goalInspections: z.number().optional(), notes: z.string().optional(), location: z.object({ lat: z.number().optional(), lng: z.number().optional(), latitude: z.number().optional(), longitude: z.number().optional(), accuracyMeters: z.number().optional(), source: z.string().optional() }).optional() }),
    allowedChannels: ['main', 'sales', 'management'],
    requiresApproval: true,
    execute: async (args, contractorId, ctx) => {
      const result = await createCanvassingGamePlan({ contractorId, contractor: { id: contractorId, name: '', company: null, plan: 'free', status: 'active' }, user: ctx.userId ? { id: ctx.userId, contractorId, name: '', email: '', role: 'manager', status: 'active' } : null, actor: 'ai', authMethod: 'system' }, args)
      return { success: true, data: { ...result, card: { cardType: 'canvassing_game_plan', planId: result.plan.id, title: result.plan.title, focusMode: result.plan.focusMode, strategySummary: result.plan.strategySummary, recommendedStart: result.plan.recommendedStart, goals: { doors: result.plan.goalDoors, conversations: result.plan.goalConversations, inspections: result.plan.goalInspections }, recommendations: result.recommendations.recommendations } } }
    },
  },
  {
    name: 'research_property_now',
    description: 'Actively research a house/property on demand from an address or current GPS context. Use when the rep says "I am approaching this house", "research this property", or asks who owns/what is known about a house. Creates a research run and candidate cards; candidates should be confirmed before saving to long-term property memory. Requires approval because it stores research history.',
    schema: z.object({
      mode: z.string().optional(), query: z.string().optional(), address: z.string().optional(), city: z.string().optional(), state: z.string().optional(), postalCode: z.string().optional(), streets: z.array(z.string()).optional(), focusMode: z.string().optional(), energyLevel: z.string().optional(), mindset: z.string().optional(), timeBudgetMinutes: z.number().optional(), goalDoors: z.number().optional(), goalConversations: z.number().optional(), goalInspections: z.number().optional(), notes: z.string().optional(), allowProviderLookup: z.boolean().optional(),
      location: z.object({ lat: z.number().optional(), lng: z.number().optional(), latitude: z.number().optional(), longitude: z.number().optional(), accuracyMeters: z.number().optional(), source: z.string().optional() }).optional(),
    }),
    allowedChannels: ['main', 'sales', 'management', 'crew'],
    requiresApproval: true,
    execute: async (args, contractorId, ctx) => {
      const result = await researchPropertyNow({ contractorId, contractor: { id: contractorId, name: '', company: null, plan: 'free', status: 'active' }, user: ctx.userId ? { id: ctx.userId, contractorId, name: '', email: '', role: 'manager', status: 'active' } : null, actor: 'ai', authMethod: 'system' }, args)
      return { success: true, data: result }
    },
  },
  {
    name: 'confirm_property_research_candidate',
    description: 'Confirm a researched property candidate and optionally save it into long-term PropertyMemory. Use after the user confirms the correct house/owner/address. Requires approval.',
    schema: z.object({ researchRunId: z.string().min(1), candidateId: z.string().optional(), createMemory: z.boolean().optional(), status: z.string().optional(), notes: z.string().optional(), confirmedOwnerName: z.string().optional(), confirmedAddress: z.string().optional() }),
    allowedChannels: ['main', 'sales', 'management', 'crew'],
    requiresApproval: true,
    execute: async (args, contractorId, ctx) => {
      const result = await confirmPropertyResearchCandidate({ contractorId, contractor: { id: contractorId, name: '', company: null, plan: 'free', status: 'active' }, user: ctx.userId ? { id: ctx.userId, contractorId, name: '', email: '', role: 'manager', status: 'active' } : null, actor: 'ai', authMethod: 'system' }, args.researchRunId, args)
      return { success: true, data: result }
    },
  },
  {
    name: 'get_property_research_run',
    description: 'Get a prior property research run, candidate matches, enrichment snapshots, and the chat-native research card.',
    schema: z.object({ researchRunId: z.string().min(1) }),
    allowedChannels: ['main', 'sales', 'management', 'crew'],
    execute: async (args, contractorId, ctx) => {
      const result = await getPropertyResearchRun({ contractorId, contractor: { id: contractorId, name: '', company: null, plan: 'free', status: 'active' }, user: ctx.userId ? { id: ctx.userId, contractorId, name: '', email: '', role: 'manager', status: 'active' } : null, actor: 'ai', authMethod: 'system' }, args.researchRunId)
      if (!result) return { success: false, data: null, error: 'Property research run not found' }
      return { success: true, data: result }
    },
  },
  {
    name: 'research_streets_for_canvassing',
    description: 'Research streets on demand and build a supportive partner-style street game plan. Use when the user says they want to work Elm Street/Zoe Street or asks for a canvassing plan. Pulls cached property memory first and optionally configured property data provider results. Requires approval because it stores a research run/game plan.',
    schema: z.object({ streets: z.array(z.string()).min(1), city: z.string().optional(), state: z.string().optional(), postalCode: z.string().optional(), focusMode: z.string().optional(), energyLevel: z.string().optional(), mindset: z.string().optional(), timeBudgetMinutes: z.number().optional(), goalDoors: z.number().optional(), goalConversations: z.number().optional(), goalInspections: z.number().optional(), notes: z.string().optional(), allowProviderLookup: z.boolean().optional() }),
    allowedChannels: ['main', 'sales', 'management'],
    requiresApproval: true,
    execute: async (args, contractorId, ctx) => {
      const result = await researchPropertyNow({ contractorId, contractor: { id: contractorId, name: '', company: null, plan: 'free', status: 'active' }, user: ctx.userId ? { id: ctx.userId, contractorId, name: '', email: '', role: 'manager', status: 'active' } : null, actor: 'ai', authMethod: 'system' }, { ...args, mode: 'street_game_plan' })
      return { success: true, data: result }
    },
  },
  {
    name: 'get_street_research_runs',
    description: 'List street research/game-plan runs created for canvassing strategy.',
    schema: z.object({ status: z.string().optional(), limit: z.number().optional() }),
    allowedChannels: ['main', 'sales', 'management'],
    execute: async (args, contractorId, ctx) => {
      const result = await getStreetResearchRuns({ contractorId, contractor: { id: contractorId, name: '', company: null, plan: 'free', status: 'active' }, user: ctx.userId ? { id: ctx.userId, contractorId, name: '', email: '', role: 'manager', status: 'active' } : null, actor: 'ai', authMethod: 'system' }, args)
      return { success: true, data: result }
    },
  },

  {
    name: 'create_canvassing_lead_at_location',
    description: 'Create a canvassing lead/pin from the current field GPS location when the user is standing at a house that does not yet have a customer or project. Requires approval in chat.',
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
    requiresApproval: true,
    execute: async (args, contractorId, ctx) => {
      const lead = await createCanvassingLead({ contractorId, contractor: { id: contractorId, name: '', company: null, plan: 'free', status: 'active' }, user: ctx.userId ? { id: ctx.userId, contractorId, name: '', email: '', role: 'manager', status: 'active' } : null, actor: 'ai', authMethod: 'system' }, args)
      return { success: true, data: { lead, card: { cardType: 'canvassing_lead', leadId: lead.id, address: lead.address, homeownerName: lead.homeownerName, phone: lead.phone, status: lead.status, latitude: lead.latitude, longitude: lead.longitude } } }
    },
  },
  {
    name: 'get_canvassing_map',
    description: 'Get the canvassing map/session state: active sessions, GPS lead pins, statuses, recent activity, and counts. Use when the user asks what has been canvassed, where reps are, or which leads need follow-up.',
    schema: z.object({ sessionId: z.string().optional(), status: z.string().optional(), includeConverted: z.boolean().optional(), limit: z.number().optional() }),
    allowedChannels: 'all',
    execute: async (args, contractorId, ctx) => {
      const result = await getCanvassingMap({ contractorId, contractor: { id: contractorId, name: '', company: null, plan: 'free', status: 'active' }, user: ctx.userId ? { id: ctx.userId, contractorId, name: '', email: '', role: 'manager', status: 'active' } : null, actor: 'ai', authMethod: 'system' }, args)
      return { success: true, data: result }
    },
  },
  {
    name: 'start_canvassing_session',
    description: 'Start a canvassing session/territory for a rep or crew. This creates a field session and posts a chat-native canvassing session card. Requires approval.',
    schema: z.object({ title: z.string().optional(), territoryName: z.string().optional(), notes: z.string().optional(), location: z.object({ lat: z.number().optional(), lng: z.number().optional(), latitude: z.number().optional(), longitude: z.number().optional(), accuracyMeters: z.number().optional(), source: z.string().optional() }).optional() }),
    allowedChannels: ['main', 'sales', 'management'],
    requiresApproval: true,
    execute: async (args, contractorId, ctx) => {
      const session = await startCanvassingSession({ contractorId, contractor: { id: contractorId, name: '', company: null, plan: 'free', status: 'active' }, user: ctx.userId ? { id: ctx.userId, contractorId, name: '', email: '', role: 'manager', status: 'active' } : null, actor: 'ai', authMethod: 'system' }, args)
      return { success: true, data: { session, card: { cardType: 'canvassing_session', sessionId: session.id, title: session.title, territoryName: session.territoryName, status: session.status } } }
    },
  },
  {
    name: 'log_canvassing_activity',
    description: 'Log a canvassing activity for a lead/session such as knock, no_answer, interested, follow_up, not_interested, note, or photo. Updates the lead status when supplied. Requires approval.',
    schema: z.object({ leadId: z.string().optional(), sessionId: z.string().optional(), type: z.string().min(1), summary: z.string().optional(), status: z.string().optional(), notes: z.string().optional(), location: z.object({ lat: z.number().optional(), lng: z.number().optional(), latitude: z.number().optional(), longitude: z.number().optional(), accuracyMeters: z.number().optional(), source: z.string().optional() }).optional() }),
    allowedChannels: ['main', 'sales', 'management'],
    requiresApproval: true,
    execute: async (args, contractorId, ctx) => {
      const result = await logCanvassingActivity({ contractorId, contractor: { id: contractorId, name: '', company: null, plan: 'free', status: 'active' }, user: ctx.userId ? { id: ctx.userId, contractorId, name: '', email: '', role: 'manager', status: 'active' } : null, actor: 'ai', authMethod: 'system' }, args)
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
      const result = await convertCanvassingLead({ contractorId, contractor: { id: contractorId, name: '', company: null, plan: 'free', status: 'active' }, user: ctx.userId ? { id: ctx.userId, contractorId, name: '', email: '', role: 'manager', status: 'active' } : null, actor: 'ai', authMethod: 'system' }, args.leadId, args)
      if (!result) return { success: false, data: null, error: 'Canvassing lead not found' }
      return { success: true, data: result }
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
  if (ctx.channelType && tool.allowedChannels !== 'all' && !tool.allowedChannels.includes(ctx.channelType)) {
    return { success: false, data: null, error: `Tool '${name}' not allowed in '${ctx.channelType}' channel` }
  }

  // Schema validation happens before approval so the approval card stores a safe, typed payload.
  const parsed = tool.schema.safeParse(args)
  if (!parsed.success) {
    return { success: false, data: null, error: `Invalid args: ${parsed.error.issues.map(i => i.message).join('; ')}` }
  }

  // SECURITY: Enforce requiresApproval flag — dangerous tools must not execute autonomously.
  // Instead of dead-ending, create an approval replay request that can be approved from a chat card.
  if (tool.requiresApproval && !ctx.approved) {
    console.warn(`[tools-v2] APPROVAL REQUIRED: Tool '${name}' contractorId=${contractorId}`)
    const requestedRole = approvalRoleForTool(name)
    const title = `Approval needed: ${humanizeToolName(name)}`
    const summary = `Jobrolo wants to run ${humanizeToolName(name)}. Review and approve before execution.`
    const payload = { toolName: name, args: parsed.data, toolContext: ctx }
    const existing = await db.actionRequest.findFirst({
      where: {
        contractorId,
        type: 'tool_approval',
        status: { in: ['pending', 'needs_approval'] },
        payloadJson: JSON.stringify(payload),
      },
      select: { id: true, status: true, title: true },
    }).catch(() => null)
    if (existing) {
      return { success: true, data: { approvalRequired: true, actionRequestId: existing.id, status: existing.status, title: existing.title }, error: 'Awaiting human approval' }
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
        payloadJson: JSON.stringify({ cardType: 'approval_request', actionRequestId: actionRequest.id, toolName: name, args: parsed.data }),
      },
    }).catch(() => null)
    return { success: true, data: { approvalRequired: true, actionRequestId: actionRequest.id, status: actionRequest.status, title, summary, toolName: name }, error: 'Awaiting human approval' }
  }

  try {
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
  return tool.allowedChannels.includes(channel)
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
    const typeName = propDef?.typeName ?? (v as any)._zod?.def?.type ?? ''
    let type = 'string'
    if (typeName.includes('String')) type = 'string'
    else if (typeName.includes('Number')) type = 'number'
    else if (typeName.includes('Boolean')) type = 'boolean'
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
    const typeName = propDef?.typeName ?? ''
    if (!typeName.includes('Optional')) required.push(k)
  }
  return required
}
