import type { ToolCall } from '@/lib/prompts'
import type { ToolExecutionResultLike } from './types'

const PRE_AI_LOCAL_TRUTH_TOOLS = new Set([
  'get_contractor_profile',
  'get_copilot_inbox',
  'get_company_kpis',
  'get_integration_readiness',
  'list_customers',
  'get_customer_file',
  'list_documents',
  'get_recent_uploads',
  'review_price_sheet_items',
  'get_project_document_packet',
])

export function canRunLocalTruthBeforeAi(call: ToolCall | null) {
  if (!call) return false
  if (!PRE_AI_LOCAL_TRUTH_TOOLS.has(call.name)) return false
  return true
}

function stringField(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numberField(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function arrayField(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return Array.isArray(value) ? value : []
}

function compactLine(text: string, max = 120) {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1).trim()}…` : clean
}

function moneyText(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return `$${value.toFixed(2)}`
}

function formatLocalCustomerList(data: Record<string, unknown>) {
  const customers = arrayField(data, 'customers').filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
  const count = numberField(data, 'count') ?? customers.length
  if (!customers.length) return 'No saved client/customer records found in Jobrolo.'
  const lines = customers.slice(0, 8).map(customer => {
    const name = stringField(customer, 'name') ?? 'Unnamed customer'
    const customerNumber = stringField(customer, 'customerNumber') ?? stringField(customer, 'clientNumber')
    const phone = stringField(customer, 'phone')
    const address = stringField(customer, 'address')
    const projects = arrayField(customer, 'projects').length
    const parts = [
      customerNumber ? `${name} (${customerNumber})` : name,
      phone,
      address,
      projects ? `${projects} project${projects === 1 ? '' : 's'}` : null,
    ].filter(Boolean)
    return `- ${compactLine(parts.join(' · '), 180)}`
  })
  return [`Loaded ${count} saved client/customer${count === 1 ? '' : 's'} from Jobrolo records.`, ...lines].join('\n')
}

function formatLocalDocumentList(data: Record<string, unknown>, label = 'saved file') {
  const documents = arrayField(data, 'documents').filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
  const count = numberField(data, 'count') ?? documents.length
  if (!documents.length) return `No ${label}s found in saved Jobrolo records.`
  const lines = documents.slice(0, 10).map(doc => {
    const name = stringField(doc, 'originalName') ?? stringField(doc, 'filename') ?? 'Unnamed file'
    const type = stringField(doc, 'fileType') ?? stringField(doc, 'aiCategory') ?? 'file'
    const status = stringField(doc, 'status')
    const summary = stringField(doc, 'aiSummary')
    return `- ${compactLine([name, type, status, summary].filter(Boolean).join(' · '), 190)}`
  })
  return [`Loaded ${count} ${label}${count === 1 ? '' : 's'} from saved Jobrolo records.`, ...lines].join('\n')
}

function formatLocalRecentUploads(data: Record<string, unknown>) {
  const base = formatLocalDocumentList(data, 'recent upload')
  const counts = data.countsByStatus
  if (!counts || typeof counts !== 'object' || Array.isArray(counts)) return base
  const statusLine = Object.entries(counts as Record<string, unknown>)
    .filter(([, value]) => typeof value === 'number')
    .map(([status, value]) => `${status}: ${value}`)
    .join(', ')
  return statusLine ? `${base}\nStatus: ${statusLine}` : base
}

function formatLocalPriceSheetReview(data: Record<string, unknown>) {
  const message = stringField(data, 'message')
  const filename = stringField(data, 'filename')
  const supplier = stringField(data, 'supplier')
  const importStatus = stringField(data, 'importStatus')
  const rows = arrayField(data, 'rows').filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
  const total = numberField(data, 'totalExtractedRowCount') ?? rows.length
  const header = [
    message ?? `Loaded ${total} extracted price sheet row${total === 1 ? '' : 's'} for review.`,
    filename ? `File: ${filename}` : null,
    supplier ? `Supplier: ${supplier}` : null,
    importStatus ? `Status: ${importStatus}` : null,
  ].filter(Boolean)
  if (!rows.length) return header.join('\n')
  const rowLines = rows.slice(0, 10).map(row => {
    const rowNumber = numberField(row, 'rowNumber')
    const itemName = stringField(row, 'itemName') ?? stringField(row, 'name') ?? 'Unnamed item'
    const sku = stringField(row, 'sku')
    const unit = stringField(row, 'unit')
    const price = moneyText(row.unitPrice) ?? moneyText(row.unitCost)
    return `- ${rowNumber ? `${rowNumber}. ` : ''}${compactLine([itemName, sku, unit, price].filter(Boolean).join(' · '), 170)}`
  })
  return [...header, ...rowLines].join('\n')
}

export function formatLocalTruthFinalText(call: ToolCall, result: ToolExecutionResultLike) {
  if (!result.success) {
    return `I tried to load that from saved Jobrolo records, but it failed. ${result.error ? `Error: ${result.error}` : 'Please try again.'}`
  }
  const data = result.data as Record<string, unknown> | null
  if (call.name === 'list_customers' && data) return formatLocalCustomerList(data)
  if (call.name === 'list_documents' && data) return formatLocalDocumentList(data)
  if (call.name === 'get_recent_uploads' && data) return formatLocalRecentUploads(data)
  if (call.name === 'review_price_sheet_items' && data) return formatLocalPriceSheetReview(data)
  const message = typeof data?.message === 'string' ? data.message : null
  if (message) return message
  if (call.name === 'get_contractor_profile') return 'Loaded your saved company profile.'
  if (call.name === 'get_copilot_inbox') return 'Loaded Action Needed from saved Jobrolo records.'
  if (call.name === 'get_company_kpis') return 'Loaded company KPIs from saved Jobrolo records.'
  if (call.name === 'get_integration_readiness') return 'Loaded integration readiness from Jobrolo configuration.'
  if (call.name === 'get_customer_file') return 'Loaded the saved customer file from Jobrolo records.'
  if (call.name === 'get_project_document_packet') return 'Loaded the job document packet from saved Jobrolo records.'
  return 'Loaded that from saved Jobrolo records.'
}
