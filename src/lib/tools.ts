import { toFileUrl, toThumbnailUrl } from '@/lib/file-url'
import { db } from './db'

export interface ToolDef { name: string; description: string; parameters: Record<string, { type: string; description: string; required?: boolean }> }

export const TOOL_DEFINITIONS: ToolDef[] = [
  { name: 'search_material_prices', description: 'Search material price database by name, SKU, or category. ALWAYS use for price questions.', parameters: { query: { type: 'string', description: 'Search term', required: true } } },
  { name: 'get_document_content', description: 'Get full extracted content from an uploaded document. ALWAYS call before answering about document contents.', parameters: { documentId: { type: 'string', description: 'Document ID', required: false }, filename: { type: 'string', description: 'Partial filename', required: false } } },
  { name: 'list_documents', description: 'List recently uploaded documents.', parameters: { fileType: { type: 'string', description: 'Filter: price_sheet, scope_of_loss, estimate, etc.', required: false } } },
  { name: 'get_project_details', description: 'Get project details: customer, tasks, notes, memory.', parameters: { workspaceName: { type: 'string', description: 'Workspace name', required: true } } },
  { name: 'search_customers', description: 'Search customers by name, phone, or email.', parameters: { query: { type: 'string', description: 'Search term', required: true } } },
  { name: 'get_workspace_memory', description: 'Get recent memory entries for a workspace.', parameters: { workspaceName: { type: 'string', description: 'Workspace name', required: true }, category: { type: 'string', description: 'Filter: decision, material_decision, etc.', required: false } } },
  { name: 'list_photos', description: 'List uploaded photos. Returns URLs for attaching to responses.', parameters: { workspaceName: { type: 'string', description: 'Filter by workspace', required: false } } },
  { name: 'create_customer', description: 'Create a new customer. ASK for info first — do NOT call with empty data.', parameters: { name: { type: 'string', description: 'Full name (required)', required: true }, phone: { type: 'string', description: 'Phone', required: false }, email: { type: 'string', description: 'Email', required: false }, address: { type: 'string', description: 'Address', required: false } } },
]

export async function executeTool(name: string, args: Record<string, unknown>, contractorId: string): Promise<{ success: boolean; data: unknown; error?: string }> {
  try {
    switch (name) {
      case 'search_material_prices': return await searchMaterialPrices(args.query as string, contractorId)
      case 'get_document_content': return await getDocumentContent(args.documentId as string | undefined, args.filename as string | undefined, contractorId)
      case 'list_documents': return await listDocuments(args.fileType as string | undefined, contractorId)
      case 'get_project_details': return await getProjectDetails(args.workspaceName as string, contractorId)
      case 'search_customers': return await searchCustomers(args.query as string, contractorId)
      case 'get_workspace_memory': return await getWorkspaceMemory(args.workspaceName as string, args.category as string | undefined, contractorId)
      case 'list_photos': return await listPhotos(args.workspaceName as string | undefined, contractorId)
      case 'create_customer': return await createCustomer(args as { name: string; phone?: string; email?: string; address?: string }, contractorId)
      default: return { success: false, data: null, error: `Unknown tool: ${name}` }
    }
  } catch (err) { console.error(`[tool] ${name} failed:`, err); return { success: false, data: null, error: err instanceof Error ? err.message : 'Tool failed' } }
}

async function searchMaterialPrices(query: string, contractorId: string) {
  const items = await db.materialItem.findMany({ where: { contractorId, OR: [{ name: { contains: query } }, { sku: { contains: query } }, { category: { contains: query } }, { description: { contains: query } }] }, take: 20, orderBy: { name: 'asc' } })
  if (items.length === 0) { const words = query.split(/\s+/).filter(Boolean); if (words.length > 1) { const broader = await db.materialItem.findMany({ where: { contractorId, OR: words.flatMap(w => [{ name: { contains: w } }, { sku: { contains: w } }, { category: { contains: w } }]) }, take: 20, orderBy: { name: 'asc' } }); if (broader.length > 0) return { success: true, data: { count: broader.length, items: broader.map(i => ({ name: i.name, sku: i.sku, category: i.category, unit: i.unit, unitCost: i.unitCost })) } } } }
  return { success: true, data: { count: items.length, items: items.length ? items.map(i => ({ name: i.name, sku: i.sku, category: i.category, unit: i.unit, unitCost: i.unitCost, description: i.description })) : [], note: items.length ? undefined : `No materials matching "${query}". Upload a price sheet.` } }
}

async function getDocumentContent(documentId: string | undefined, filename: string | undefined, contractorId: string) {
  let doc
  if (documentId) doc = await db.document.findUnique({ where: { id: documentId } })
  else if (filename) { const lower = filename.toLowerCase(); const all = await db.document.findMany({ where: { contractorId }, orderBy: { createdAt: 'desc' }, take: 50 }); doc = all.find(d => d.originalName.toLowerCase().includes(lower)) }
  if (!doc) return { success: false, data: null, error: 'Document not found. Call list_documents.' }
  let extractedData: unknown = null
  try { extractedData = doc.extractedData ? JSON.parse(doc.extractedData) : null } catch {}
  return { success: true, data: { id: doc.id, filename: doc.originalName, fileType: doc.fileType, aiSummary: doc.aiSummary, aiCategory: doc.aiCategory, status: doc.status, extractedData, url: toFileUrl(doc.filePath), thumbnailUrl: toThumbnailUrl(doc.thumbnailPath), mimeType: doc.mimeType, customerId: doc.customerId, projectId: doc.projectId, workspaceId: doc.workspaceId, createdAt: doc.createdAt } }
}

async function listDocuments(fileType: string | undefined, contractorId: string) {
  const docs = await db.document.findMany({ where: { contractorId, ...(fileType ? { fileType } : {}) }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, originalName: true, fileType: true, aiSummary: true, aiCategory: true, status: true, filePath: true, thumbnailPath: true, mimeType: true, customerId: true, projectId: true, workspaceId: true, createdAt: true } })
  return { success: true, data: { count: docs.length, documents: docs.map(d => ({ ...d, url: toFileUrl(d.filePath), thumbnailUrl: toThumbnailUrl(d.thumbnailPath) })) } }
}

async function getProjectDetails(workspaceName: string, contractorId: string) {
  const ws = await db.workspace.findFirst({ where: { contractorId, name: { contains: workspaceName } }, include: { project: { include: { customer: { select: { id: true, name: true, phone: true, email: true, address: true } }, tasks: { orderBy: { createdAt: 'desc' }, take: 20 }, notes: { orderBy: { createdAt: 'desc' }, take: 10 } } }, customer: true, subcontractor: true, chats: { select: { id: true, chatType: true, title: true } }, memories: { orderBy: { createdAt: 'desc' }, take: 10 } } })
  if (!ws) return { success: false, data: null, error: `Workspace "${workspaceName}" not found.` }
  return { success: true, data: { id: ws.id, name: ws.name, type: ws.type, project: ws.project, customer: ws.customer, subcontractor: ws.subcontractor, chats: ws.chats, recentMemory: ws.memories } }
}

async function searchCustomers(query: string, contractorId: string) {
  const customers = await db.customer.findMany({ where: { contractorId, OR: [{ name: { contains: query } }, { phone: { contains: query } }, { email: { contains: query } }] }, take: 10 })
  return { success: true, data: { count: customers.length, customers } }
}

async function getWorkspaceMemory(workspaceName: string, category: string | undefined, contractorId: string) {
  const ws = await db.workspace.findFirst({ where: { contractorId, name: { contains: workspaceName } } })
  if (!ws) return { success: false, data: null, error: `Workspace not found.` }
  const memories = await db.workspaceMemory.findMany({ where: { workspaceId: ws.id, ...(category ? { category } : {}) }, orderBy: { createdAt: 'desc' }, take: 30 })
  return { success: true, data: { workspaceId: ws.id, workspaceName: ws.name, count: memories.length, memories: memories.map(m => ({ category: m.category, content: m.content, createdAt: m.createdAt })) } }
}

async function listPhotos(workspaceName: string | undefined, contractorId: string) {
  let workspaceId: string | undefined
  if (workspaceName) { const ws = await db.workspace.findFirst({ where: { contractorId, name: { contains: workspaceName } }, select: { id: true, projectId: true } }); workspaceId = ws?.id }
  const where: any = { contractorId, fileType: 'photo' }
  if (workspaceId) where.workspaceId = workspaceId
  const photos = await db.document.findMany({ where, orderBy: { createdAt: 'desc' }, take: 30, select: { id: true, originalName: true, aiSummary: true, filePath: true, thumbnailPath: true, mimeType: true, createdAt: true } })
  return { success: true, data: { count: photos.length, photos: photos.map(p => ({ id: p.id, filename: p.originalName, summary: p.aiSummary, url: toFileUrl(p.filePath), thumbnailUrl: toThumbnailUrl(p.thumbnailPath), createdAt: p.createdAt })) } }
}

async function createCustomer(args: { name: string; phone?: string; email?: string; address?: string }, contractorId: string) {
  if (!args.name?.trim()) return { success: false, data: null, error: 'Name required' }
  const existing = await db.customer.findFirst({ where: { contractorId, name: { contains: args.name } } })
  if (existing) return { success: true, data: { id: existing.id, name: existing.name, message: `"${existing.name}" already exists.` } }
  const customer = await db.customer.create({ data: { contractorId, name: args.name.trim(), phone: args.phone?.trim() || null, email: args.email?.trim() || null, address: args.address?.trim() || null } })
  return { success: true, data: { id: customer.id, name: customer.name, message: `Customer "${customer.name}" created.` } }
}
