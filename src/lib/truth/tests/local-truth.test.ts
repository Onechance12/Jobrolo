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
  assert(countQuestion?.name === 'get_company_kpis', `KPI/count questions should route to company KPIs, got ${countQuestion?.name}`)
  assert(countQuestion.args.periodDays === 7, 'This-week KPI questions should use a 7-day default')

  const companyHealth = buildLocalTruthToolCall('Show company health, leads, projects, and AI usage for the last 30 days.')
  assert(companyHealth?.name === 'get_company_kpis', `Company health should route to company KPIs, got ${companyHealth?.name}`)
  assert(companyHealth.args.periodDays === 30, 'Explicit 30-day KPI questions should pass periodDays=30')

  const createCustomer = buildLocalTruthToolCall('Create a customer named Natalie Pearson')
  assert(!createCustomer, 'Mutation-looking customer requests should not route through local truth')

  const customerFile = buildLocalTruthToolCall("Only use saved database records. Show me Timothy Disen's file.")
  assert(customerFile?.name === 'get_customer_file', `Customer file should route to get_customer_file, got ${customerFile?.name}`)
  assert(customerFile.args.query === 'Timothy Disen', `Customer file query should normalize possessive, got ${String(customerFile.args.query)}`)

  const customerPhotos = buildLocalTruthToolCall('Show photos for Timothy Disen grouped by category.')
  assert(customerPhotos?.name === 'get_customer_file', `Named photo requests should prefer customer file context, got ${customerPhotos?.name}`)

  const customerFollowUp = buildLocalTruthToolCall('Who needs follow-up for Timothy Disen? Check saved tasks, notes, projects, and chats.')
  assert(customerFollowUp?.name === 'get_customer_file', `Named customer follow-up context should route to get_customer_file, got ${customerFollowUp?.name}`)
  assert(customerFollowUp.args.query === 'Timothy Disen', `Named customer follow-up query should be Timothy Disen, got ${String(customerFollowUp.args.query)}`)

  const recentUploads = buildLocalTruthToolCall('Show recent uploads that are still processing.')
  assert(recentUploads?.name === 'get_recent_uploads', `Recent uploads should route to get_recent_uploads, got ${recentUploads?.name}`)

  const genericPhotos = buildLocalTruthToolCall('Show saved photos.')
  assert(genericPhotos?.name === 'list_documents', `Generic photo reads should route to list_documents, got ${genericPhotos?.name}`)
  assert(genericPhotos.args.fileType === 'photo', 'Generic photo reads should include fileType=photo')

  const priceRows = buildLocalTruthToolCall('Show the first 10 price sheet rows.')
  assert(priceRows?.name === 'review_price_sheet_items', `Price sheet rows should route to review_price_sheet_items, got ${priceRows?.name}`)

  const companyProfile = buildLocalTruthToolCall('Show my company profile and what setup items are missing.')
  assert(companyProfile?.name === 'get_contractor_profile', `Company profile reads should route to get_contractor_profile, got ${companyProfile?.name}`)

  const companyMutation = buildLocalTruthToolCall('Update my company profile phone number.')
  assert(!companyMutation, 'Company profile mutations should not route through local truth')

  const actionCenter = buildLocalTruthToolCall('What needs attention right now? Show pending approvals, review items, failed work, and routed tasks.')
  assert(actionCenter?.name === 'get_copilot_inbox', `Action Center reads should route to get_copilot_inbox, got ${actionCenter?.name}`)

  const approvalMutation = buildLocalTruthToolCall('Approve the pending roof report.')
  assert(!approvalMutation, 'Approval decisions should not route through local truth')

  const activePacket = buildLocalTruthToolCall('Show this job file packet.', { activeProjectId: 'project_123' })
  assert(activePacket?.name === 'get_project_document_packet', `Active job packet should route to get_project_document_packet, got ${activePacket?.name}`)
  assert(activePacket.args.projectId === 'project_123', 'Active job packet should pass the active project id')

  const activeFinancials = buildLocalTruthToolCall('Show this job cost and margin.', { activeProjectId: 'project_123' })
  assert(activeFinancials?.name === 'get_project_financial_summary', `Active job cost should route to get_project_financial_summary, got ${activeFinancials?.name}`)
  assert(activeFinancials.args.projectId === 'project_123', 'Active financial summary should pass the active project id')

  const activeFinancialsWithoutProject = buildLocalTruthToolCall('Show this job cost and margin.')
  assert(!activeFinancialsWithoutProject, 'Active job financial summary needs activeProjectId before local routing')

  const createInvoice = buildLocalTruthToolCall('Create an invoice for this job.', { activeProjectId: 'project_123' })
  assert(!createInvoice, 'Financial mutations should not route through local truth')

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

  const customerFileText = formatLocalTruthFinalText({ name: 'get_customer_file', args: { query: 'Timothy Disen' } }, {
    success: true,
    data: {
      customer: { name: 'Timothy Disen', customerNumber: 'C-VHUHGG', phone: '(214) 263-6363', address: '4524 Lakecrest Dr' },
      projects: [{ title: 'Job #783289 — Roof Repair Project', customerProjectNumber: 'C-VHUHGG-1', status: 'initial', address: '4524 Lakecrest Dr' }],
      photos: [{ id: 'photo_1' }],
      documents: [{ id: 'doc_1' }, { id: 'doc_2' }],
      notes: [{ id: 'note_1' }],
      tasks: [],
      counts: { documents: 2, photos: 1, notes: 1, tasks: 0 },
      companyPricingCandidates: [{ id: 'price_1' }],
      recentUnlinkedDocuments: [{ id: 'unlinked_1' }],
    },
  })
  assert(customerFileText.includes('Timothy Disen (C-VHUHGG)'), 'Customer file formatter should include customer number')
  assert(customerFileText.includes('C-VHUHGG-1'), 'Customer file formatter should include customer-project number')
  assert(customerFileText.includes('Company pricing candidates: 1'), 'Customer file formatter should flag company pricing candidates')
  assert(customerFileText.includes('Recent unlinked uploads: 1'), 'Customer file formatter should surface unlinked upload count')

  const projectPacketText = formatLocalTruthFinalText({ name: 'get_project_document_packet', args: { projectId: 'project_123' } }, {
    success: true,
    data: {
      project: {
        title: 'Job #783289 — Roof Repair Project',
        projectNumber: 'J-783289',
        customerProjectNumber: 'C-VHUHGG-1',
        status: 'initial',
        address: '4524 Lakecrest Dr',
        customer: { name: 'Timothy Disen', customerNumber: 'C-VHUHGG' },
      },
      documentGroups: {
        jobDocuments: [{ originalName: 'scope.pdf', fileType: 'estimate', aiSummary: 'Roof repair scope.' }],
      },
      roofReports: [{ title: 'Roof Damage Report', status: 'draft' }],
      counts: {
        documents: 3,
        photos: 2,
        jobDocuments: 1,
        priceSheets: 1,
        scopeAnalyses: 1,
        roofReports: 1,
        signatureRequests: 1,
        pendingSignatures: 1,
        generatedDocuments: 1,
        ocrReviewRequired: 1,
        ocrReviewRecommended: 0,
      },
    },
  })
  assert(projectPacketText.includes('C-VHUHGG-1'), 'Project packet formatter should prefer customer-project number')
  assert(projectPacketText.includes('2 photos · 1 job files'), 'Project packet formatter should summarize section counts')
  assert(projectPacketText.includes('Needs review: 1 required'), 'Project packet formatter should include OCR review counts')
  assert(projectPacketText.includes('price sheets should be reviewed/imported into company pricing'), 'Project packet formatter should protect price sheet routing')

  const financialText = formatLocalTruthFinalText({ name: 'get_project_financial_summary', args: { projectId: 'project_123' } }, {
    success: true,
    data: {
      project: { title: 'Job #783289 — Roof Repair Project', customerProjectNumber: 'C-VHUHGG-1' },
      customer: { name: 'Timothy Disen' },
      summary: {
        adjustedRevenue: 10000,
        approvedCosts: 4000,
        approvedCommission: 1000,
        approvedPayments: 2500,
        grossProfit: 5000,
        marginPercent: 50,
        balanceDue: 7500,
        candidateRevenue: 500,
        candidateCosts: 250,
      },
      missingInputs: ['customer payments / collection status'],
      entries: [
        { description: 'Contract amount', direction: 'revenue', entryType: 'contract_amount', status: 'approved', amount: 10000 },
        { description: 'ABC material invoice', direction: 'cost', entryType: 'material_cost', status: 'approved', amount: 4000 },
      ],
    },
  })
  assert(financialText.includes('Loaded financial truth from saved Jobrolo ledger rows'), 'Financial formatter should identify saved ledger source')
  assert(financialText.includes('Gross profit: $5000.00'), 'Financial formatter should include gross profit')
  assert(financialText.includes('Margin: 50.00%'), 'Financial formatter should include margin percent')
  assert(financialText.includes('ProjectFinancialEntry ledger rows are the money truth'), 'Financial formatter should explain money truth source')

  const kpiText = formatLocalTruthFinalText({ name: 'get_company_kpis', args: { periodDays: 7 } }, {
    success: true,
    data: {
      kpis: {
        periodDays: 7,
        leads: { total: 12, thisPeriod: 4, previousPeriod: 2, new: 3, inspectionSet: 2, converted: 1 },
        customers: { total: 8, addedThisPeriod: 2 },
        projects: { total: 6, active: 5, addedThisPeriod: 1 },
        appointments: { upcoming14Days: 3, inspectionsUpcoming14Days: 2 },
        files: { documentsThisPeriod: 9, photosThisPeriod: 5, estimates: 2, priceSheets: 1, priceSheetsPendingReview: 1 },
        operations: { pendingActions: 2, activeInsights: 1, failedOrReviewItems: 3 },
        usage: { aiCallsThisMonth: 42, webSearchCallsThisMonth: 4, estimatedCostThisMonth: 1.23 },
      },
    },
  })
  assert(kpiText.includes('Loaded company KPIs from saved Jobrolo records'), 'KPI formatter should identify saved DB records')
  assert(kpiText.includes('Leads: 4 this period (+2 vs previous period)'), 'KPI formatter should include lead delta')
  assert(kpiText.includes('AI usage this month: 42 calls · 4 web searches · estimated $1.23'), 'KPI formatter should include usage/cost')
  assert(kpiText.includes('not chat memory or public research'), 'KPI formatter should clarify source')

  return true
}

if (process.argv[1]?.endsWith('local-truth.test.ts')) {
  assertLocalTruthContracts()
  console.log('local truth contracts passed')
}
