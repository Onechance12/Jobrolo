import { canRunLocalTruthBeforeAi, formatLocalTruthFinalText } from '../format-local-truth'
import { buildLocalTruthToolCall, resolveLocalTruthRoute } from '../resolve-local-truth'

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export function assertLocalTruthContracts() {
  const savedCustomers = buildLocalTruthToolCall('What clients do we have saved?')
  assert(savedCustomers?.name === 'list_customers', `Saved client list should route to list_customers, got ${savedCustomers?.name}`)
  assert(savedCustomers.args.limit === 25, 'Saved client list should use a safe bounded limit')

  const countQuestion = buildLocalTruthToolCall('How many clients did we get this week?')
  assert(!countQuestion, 'KPI/count questions should not route to local customer list')

  const createCustomer = buildLocalTruthToolCall('Create a customer named Natalie Pearson')
  assert(!createCustomer, 'Mutation-looking customer requests should not route through local truth')

  const customerFile = buildLocalTruthToolCall("Only use saved database records. Show me Timothy Disen's file.")
  assert(customerFile?.name === 'get_customer_file', `Customer file should route to get_customer_file, got ${customerFile?.name}`)
  assert(customerFile.args.query === 'Timothy Disen', `Customer file query should normalize possessive, got ${String(customerFile.args.query)}`)

  const customerPhotos = buildLocalTruthToolCall('Show photos for Timothy Disen grouped by category.')
  assert(customerPhotos?.name === 'get_customer_file', `Named photo requests should prefer customer file context, got ${customerPhotos?.name}`)

  const recentUploads = buildLocalTruthToolCall('Show recent uploads that are still processing.')
  assert(recentUploads?.name === 'get_recent_uploads', `Recent uploads should route to get_recent_uploads, got ${recentUploads?.name}`)

  const genericPhotos = buildLocalTruthToolCall('Show saved photos.')
  assert(genericPhotos?.name === 'list_documents', `Generic photo reads should route to list_documents, got ${genericPhotos?.name}`)
  assert(genericPhotos.args.fileType === 'photo', 'Generic photo reads should include fileType=photo')

  const priceRows = buildLocalTruthToolCall('Show the first 10 price sheet rows.')
  assert(priceRows?.name === 'review_price_sheet_items', `Price sheet rows should route to review_price_sheet_items, got ${priceRows?.name}`)

  const activePacket = buildLocalTruthToolCall('Show this job file packet.', { activeProjectId: 'project_123' })
  assert(activePacket?.name === 'get_project_document_packet', `Active job packet should route to get_project_document_packet, got ${activePacket?.name}`)
  assert(activePacket.args.projectId === 'project_123', 'Active job packet should pass the active project id')

  const activePacketWithoutProject = buildLocalTruthToolCall('Show this job file packet.')
  assert(!activePacketWithoutProject, 'Active job packet needs activeProjectId before local routing')

  const route = resolveLocalTruthRoute('Show my material price list and first 10 rows.')
  assert(route?.id === 'price-list-review', `Price list route id should be price-list-review, got ${route?.id}`)
  assert(route.confidence > 0.8, 'Price list route should be high enough confidence for local read')

  assert(canRunLocalTruthBeforeAi({ name: 'list_customers', args: {} }), 'Safe local read tools should run before AI')
  assert(!canRunLocalTruthBeforeAi({ name: 'create_customer', args: {} }), 'Mutation tools must not run through local truth pre-AI path')

  const customerText = formatLocalTruthFinalText({ name: 'list_customers', args: {} }, {
    success: true,
    data: {
      count: 1,
      customers: [{ name: 'Timothy Disen', customerNumber: 'C-123456', phone: '(214) 555-1212', address: '4524 Lakecrest Dr', projects: [{}] }],
    },
  })
  assert(customerText.includes('Loaded 1 saved client/customer'), 'Customer formatter should state local records were loaded')
  assert(customerText.includes('Timothy Disen'), 'Customer formatter should include the saved customer name')

  const docsText = formatLocalTruthFinalText({ name: 'list_documents', args: { fileType: 'photo' } }, {
    success: true,
    data: {
      count: 1,
      documents: [{ originalName: 'roof.jpg', fileType: 'photo', status: 'reviewed', aiSummary: 'Roof overview.' }],
    },
  })
  assert(docsText.includes('roof.jpg'), 'Document formatter should include saved file names')

  const priceText = formatLocalTruthFinalText({ name: 'review_price_sheet_items', args: {} }, {
    success: true,
    data: {
      filename: 'ABC-price-list.pdf',
      supplier: 'ABC Supply',
      totalExtractedRowCount: 1,
      rows: [{ rowNumber: 1, itemName: 'Architectural shingle', sku: 'ABC-1', unit: 'SQ', unitPrice: 123.45 }],
    },
  })
  assert(priceText.includes('ABC Supply'), 'Price sheet formatter should include supplier when present')
  assert(priceText.includes('$123.45'), 'Price sheet formatter should include row prices')

  return true
}

if (process.argv[1]?.endsWith('local-truth.test.ts')) {
  assertLocalTruthContracts()
  console.log('local truth contracts passed')
}
