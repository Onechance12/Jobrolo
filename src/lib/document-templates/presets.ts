export const DEFAULT_DOCUMENT_TEMPLATES = [
  {
    name: 'Inspection Authorization',
    type: 'inspection_authorization',
    requiresSignature: true,
    variables: ['clientName', 'customer.name', 'propertyAddress', 'project.address', 'companyName', 'company.name', 'company.phone', 'company.email', 'company.licenseNumber', 'inspectionDate', 'company.legalFooter'],
    bodyHtml: `
      <h1>Inspection Authorization</h1>
      <p>I, {{clientName}}, authorize {{companyName}} to inspect the property located at {{propertyAddress}} for visible storm, roof, exterior, and related property conditions.</p>
      <p>This authorization permits documentation through notes, measurements, photographs, and related inspection materials. This is not a contract for construction work unless separately agreed in writing.</p>
      <p><strong>Inspection Date:</strong> {{inspectionDate}}</p>
      <p style="font-size:12px;color:#64748b">{{company.legalFooter}}</p>
    `,
  },
  {
    name: 'Contingency / Representation Authorization',
    type: 'contingency',
    requiresSignature: true,
    variables: ['clientName', 'customer.name', 'propertyAddress', 'project.address', 'companyName', 'company.name', 'company.phone', 'company.email', 'company.licenseNumber', 'claimNumber', 'company.defaultTerms', 'company.contractDisclaimer'],
    bodyHtml: `
      <h1>Contingency / Representation Authorization</h1>
      <p>I, {{clientName}}, authorize {{companyName}} to assist with documentation, scope review, estimating, and project planning for the property at {{propertyAddress}}.</p>
      <p><strong>Claim Number:</strong> {{claimNumber}}</p>
      <p>Any construction agreement, deductible obligations, payment terms, and final scope must be documented in a separate signed agreement where required.</p>
      <p style="font-size:12px;color:#64748b">{{company.contractDisclaimer}}</p>
    `,
  },
  {
    name: 'Work Authorization',
    type: 'work_authorization',
    requiresSignature: true,
    variables: ['clientName', 'customer.name', 'propertyAddress', 'project.address', 'companyName', 'company.name', 'company.phone', 'company.email', 'approvedScopeSummary', 'company.defaultTerms', 'company.warrantyText'],
    bodyHtml: `
      <h1>Work Authorization</h1>
      <p>I, {{clientName}}, authorize {{companyName}} to perform the work described for {{propertyAddress}} according to the approved scope, contract terms, and any agreed change orders.</p>
      <h2>Approved Scope Summary</h2>
      <p>{{approvedScopeSummary}}</p>
      <h2>Terms / Warranty</h2>
      <p>{{company.defaultTerms}}</p>
      <p>{{company.warrantyText}}</p>
    `,
  },
  {
    name: 'Change Order',
    type: 'change_order',
    requiresSignature: true,
    variables: ['clientName', 'customer.name', 'propertyAddress', 'project.address', 'company.name', 'changeDescription', 'changeAmount', 'company.paymentInstructions'],
    bodyHtml: `
      <h1>Change Order</h1>
      <p><strong>Client:</strong> {{clientName}}</p>
      <p><strong>Property:</strong> {{propertyAddress}}</p>
      <p><strong>Description:</strong> {{changeDescription}}</p>
      <p><strong>Amount:</strong> {{changeAmount}}</p>
      <p>By signing, the signer approves this change order and understands it may affect project cost, schedule, or scope.</p>
    `,
  },
  {
    name: 'Completion Certificate',
    type: 'completion_certificate',
    requiresSignature: true,
    variables: ['clientName', 'customer.name', 'propertyAddress', 'project.address', 'companyName', 'company.name', 'company.warrantyText', 'completionDate'],
    bodyHtml: `
      <h1>Certificate of Completion</h1>
      <p>I, {{clientName}}, acknowledge that {{companyName}} has substantially completed the agreed work at {{propertyAddress}} as of {{completionDate}}, subject to any written punch-list items.</p>
    `,
  },
]
