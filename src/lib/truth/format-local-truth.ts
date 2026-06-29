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

function objectField(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
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

function formatLocalCustomerFile(data: Record<string, unknown>) {
  const customer = objectField(data, 'customer')
  if (!customer) return 'Loaded the saved customer file from Jobrolo records.'

  const name = stringField(customer, 'name') ?? 'Unnamed customer'
  const customerNumber = stringField(customer, 'customerNumber') ?? stringField(customer, 'clientNumber')
  const phone = stringField(customer, 'phone')
  const email = stringField(customer, 'email')
  const address = stringField(customer, 'address')
  const projects = arrayField(data, 'projects').filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
  const counts = objectField(data, 'counts') ?? {}
  const documents = numberField(counts, 'documents') ?? arrayField(data, 'documents').length
  const photos = numberField(counts, 'photos') ?? arrayField(data, 'photos').length
  const notes = numberField(counts, 'notes') ?? arrayField(data, 'notes').length
  const tasks = numberField(counts, 'tasks') ?? arrayField(data, 'tasks').length
  const pricingCandidates = arrayField(data, 'companyPricingCandidates').length
  const recentUnlinkedDocs = arrayField(data, 'recentUnlinkedDocuments').length

  const lines = [
    `Loaded saved customer file from Jobrolo records: ${customerNumber ? `${name} (${customerNumber})` : name}.`,
    compactLine([phone, email, address].filter(Boolean).join(' · '), 180),
    `Projects: ${projects.length} · Photos: ${photos} · Files: ${documents} · Notes: ${notes} · Tasks: ${tasks}`,
  ].filter(Boolean)

  if (projects.length) {
    lines.push('Projects:')
    for (const project of projects.slice(0, 4)) {
      const title = stringField(project, 'title') ?? 'Untitled project'
      const projectNumber = stringField(project, 'customerProjectNumber') ?? stringField(project, 'projectNumber')
      const status = stringField(project, 'status')
      const projectAddress = stringField(project, 'address')
      lines.push(`- ${compactLine([projectNumber, title, status, projectAddress].filter(Boolean).join(' · '), 190)}`)
    }
  }

  if (pricingCandidates) {
    lines.push(`Company pricing candidates: ${pricingCandidates}. Price sheets belong in company pricing unless you explicitly attach them to a job.`)
  }
  if (recentUnlinkedDocs) {
    lines.push(`Recent unlinked uploads: ${recentUnlinkedDocs}. Ask me to attach, review, create a job, or save a scope when you know where they belong.`)
  }
  return lines.join('\n')
}

function formatLocalProjectPacket(data: Record<string, unknown>) {
  const project = objectField(data, 'project')
  if (!project) return 'Loaded the job document packet from saved Jobrolo records.'

  const customer = objectField(project, 'customer')
  const title = stringField(project, 'title') ?? 'Untitled project'
  const projectNumber = stringField(project, 'customerProjectNumber') ?? stringField(project, 'projectNumber')
  const status = stringField(project, 'status')
  const address = stringField(project, 'address')
  const customerName = customer ? stringField(customer, 'name') : null
  const customerNumber = customer ? stringField(customer, 'customerNumber') ?? stringField(customer, 'clientNumber') : null
  const counts = objectField(data, 'counts') ?? {}
  const documents = numberField(counts, 'documents') ?? arrayField(data, 'documents').length
  const photos = numberField(counts, 'photos')
  const jobDocuments = numberField(counts, 'jobDocuments')
  const priceSheets = numberField(counts, 'priceSheets')
  const roofReports = numberField(counts, 'roofReports')
  const generatedDocuments = numberField(counts, 'generatedDocuments')
  const signatureRequests = numberField(counts, 'signatureRequests')
  const pendingSignatures = numberField(counts, 'pendingSignatures')
  const scopeAnalyses = numberField(counts, 'scopeAnalyses')
  const ocrRequired = numberField(counts, 'ocrReviewRequired')
  const ocrRecommended = numberField(counts, 'ocrReviewRecommended')
  const groups = objectField(data, 'documentGroups') ?? {}
  const sampleDocs = arrayField(groups, 'jobDocuments')
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
    .slice(0, 3)
  const sampleReports = arrayField(data, 'roofReports')
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
    .slice(0, 2)

  const lines = [
    `Loaded job packet from saved Jobrolo records: ${projectNumber ? `${projectNumber} · ` : ''}${title}.`,
    compactLine([customerName ? `Customer: ${customerNumber ? `${customerName} (${customerNumber})` : customerName}` : null, status ? `Status: ${status}` : null, address].filter(Boolean).join(' · '), 190),
    `Contents: ${photos ?? 0} photos · ${jobDocuments ?? documents} job files · ${priceSheets ?? 0} price sheets · ${scopeAnalyses ?? 0} scopes · ${roofReports ?? 0} reports · ${signatureRequests ?? 0} signature requests${pendingSignatures ? ` (${pendingSignatures} pending)` : ''}`,
  ].filter(Boolean)

  if ((ocrRequired ?? 0) || (ocrRecommended ?? 0)) {
    lines.push(`Needs review: ${ocrRequired ?? 0} required OCR/doc review, ${ocrRecommended ?? 0} recommended.`)
  }
  if (sampleDocs.length) {
    lines.push('Recent job files:')
    for (const doc of sampleDocs) {
      const name = stringField(doc, 'originalName') ?? stringField(doc, 'filename') ?? 'Unnamed file'
      const type = stringField(doc, 'fileType') ?? stringField(doc, 'aiCategory')
      const summary = stringField(doc, 'aiSummary')
      lines.push(`- ${compactLine([name, type, summary].filter(Boolean).join(' · '), 190)}`)
    }
  }
  if (sampleReports.length) {
    lines.push('Reports:')
    for (const report of sampleReports) {
      const reportTitle = stringField(report, 'title') ?? 'Untitled report'
      const reportStatus = stringField(report, 'status')
      lines.push(`- ${compactLine([reportTitle, reportStatus].filter(Boolean).join(' · '), 160)}`)
    }
  }
  if ((generatedDocuments ?? 0) > 0) lines.push(`Generated documents saved: ${generatedDocuments}.`)
  if ((priceSheets ?? 0) > 0) lines.push('Note: price sheets should be reviewed/imported into company pricing unless this file is truly job-specific.')
  return lines.join('\n')
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
  if (call.name === 'get_customer_file' && data) return formatLocalCustomerFile(data)
  if (call.name === 'get_project_document_packet' && data) return formatLocalProjectPacket(data)
  const message = typeof data?.message === 'string' ? data.message : null
  if (message) return message
  if (call.name === 'get_contractor_profile') return 'Loaded your saved company profile.'
  if (call.name === 'get_copilot_inbox') return 'Loaded Action Needed from saved Jobrolo records.'
  if (call.name === 'get_company_kpis') return 'Loaded company KPIs from saved Jobrolo records.'
  if (call.name === 'get_integration_readiness') return 'Loaded integration readiness from Jobrolo configuration.'
  return 'Loaded that from saved Jobrolo records.'
}
