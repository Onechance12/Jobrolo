import type { IntegrationCapability, IntegrationDefinition, IntegrationReadiness } from './types'

function hasEnv(name: string) {
  return Boolean(process.env[name]?.trim())
}

function configuredStatus(definition: IntegrationDefinition): IntegrationReadiness {
  const missingEnvVars = (definition.envVars ?? []).filter(name => !hasEnv(name))
  const configured = definition.status === 'configured' || ((definition.envVars?.length ?? 0) > 0 && missingEnvVars.length === 0)
  return {
    id: definition.id,
    label: definition.label,
    category: definition.category,
    configured,
    status: configured ? 'configured' : definition.status,
    capabilities: definition.capabilities,
    missingEnvVars,
    currentFallback: definition.currentFallback,
    safetyRules: definition.safetyRules,
  }
}

export const INTEGRATIONS: IntegrationDefinition[] = [
  {
    id: 'external_claim_crm_import',
    label: 'External claim CRM migration/audit',
    category: 'external_crm',
    status: 'planned',
    capabilities: ['external_file_read', 'claim_file_import'],
    authModel: 'env_api_key',
    risk: 'read_only',
    ownerFacingUse: 'Read exported claim/contact files from another CRM during controlled migrations or audits, then convert them into Jobrolo claim packets for review.',
    currentFallback: 'Use exported CRM reports/CSV/JSON packets and run the Jobrolo claim adapter in dry-run mode before importing anything.',
    safetyRules: [
      'Jobrolo must not write back to the external CRM from this integration.',
      'Do not import raw notes into homeowner/shared chats without role visibility review.',
      'External CRM data should become Jobrolo truth only through an explicit approved import path.',
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI / ChatGPT',
    category: 'ai',
    status: 'available',
    capabilities: ['chat_reasoning', 'web_search', 'document_vision'],
    envVars: ['LLM_API_KEY'],
    authModel: 'env_api_key',
    risk: 'read_only',
    ownerFacingUse: 'Powers Jobrolo reasoning, document/photo understanding, and public web research when configured.',
    currentFallback: 'If OpenAI is not configured, Jobrolo should say the AI provider/search connection is missing instead of pretending.',
    safetyRules: [
      'Log usage for expensive AI/search calls.',
      'Label public web research as external evidence, not saved company truth.',
      'Do not expose private customer/project data to public entry chat.',
    ],
  },
  {
    id: 'abc_supply',
    label: 'ABC Supply',
    category: 'supplier',
    status: 'planned',
    capabilities: ['price_catalog', 'account_pricing', 'quote_request', 'material_order', 'order_status', 'delivery_tracking', 'invoice_lookup'],
    authModel: 'partner_portal',
    risk: 'external_purchase',
    ownerFacingUse: 'Future material pricing, order placement, delivery tracking, and invoice reconciliation for roofing jobs.',
    currentFallback: 'Use uploaded ABC price sheets, supplier invoices, delivery tickets, and manual supplier/order notes.',
    safetyRules: [
      'Never place or change material orders without explicit approval.',
      'Account pricing must be tenant-scoped and never shared across contractors.',
      'Supplier invoices and delivery tickets are job-level cost/delivery records, not company price sheets.',
    ],
  },
  {
    id: 'srs_distribution',
    label: 'SRS Distribution',
    category: 'supplier',
    status: 'planned',
    capabilities: ['price_catalog', 'account_pricing', 'quote_request', 'material_order', 'order_status', 'delivery_tracking', 'invoice_lookup'],
    authModel: 'partner_portal',
    risk: 'external_purchase',
    ownerFacingUse: 'Future supplier pricing, order, delivery, and invoice workflows.',
    currentFallback: 'Use uploaded SRS price sheets, quotes, invoices, delivery tickets, and manual supplier notes.',
    safetyRules: [
      'Never place or change material orders without explicit approval.',
      'Confirm job/project before attaching supplier costs.',
      'Do not treat quotes/invoices as reusable company pricing unless confirmed.',
    ],
  },
  {
    id: 'qxo',
    label: 'QXO / Beacon-style supplier',
    category: 'supplier',
    status: 'planned',
    capabilities: ['price_catalog', 'account_pricing', 'quote_request', 'material_order', 'order_status', 'delivery_tracking', 'invoice_lookup'],
    authModel: 'partner_portal',
    risk: 'external_purchase',
    ownerFacingUse: 'Future supplier bid/proposal, material order, delivery, and invoice workflows.',
    currentFallback: 'Use uploaded bid proposals, price sheets, invoices, and delivery tickets.',
    safetyRules: [
      'Imported bid rows should stay reviewable before becoming company pricing.',
      'Job-specific supplier bids should attach to the project, not overwrite company pricebook automatically.',
    ],
  },
  {
    id: 'southern_shingle',
    label: 'Southern Shingle',
    category: 'supplier',
    status: 'planned',
    capabilities: ['price_catalog', 'account_pricing', 'quote_request', 'material_order', 'order_status', 'delivery_tracking', 'invoice_lookup'],
    authModel: 'partner_portal',
    risk: 'external_purchase',
    ownerFacingUse: 'Future regional supplier pricing, quote, order, delivery, and invoice workflows for roofing jobs.',
    currentFallback: 'Use uploaded Southern Shingle price sheets, quotes, invoices, delivery tickets, and manual supplier notes.',
    safetyRules: [
      'Never place or change material orders without explicit approval.',
      'Confirm the job/project before attaching supplier invoices or delivery records.',
      'Keep reusable pricing company-level and job-specific invoices/deliveries project-level.',
    ],
  },
  {
    id: 'builders_firstsource',
    label: 'Builders FirstSource',
    category: 'supplier',
    status: 'planned',
    capabilities: ['price_catalog', 'account_pricing', 'quote_request', 'material_order', 'order_status', 'delivery_tracking', 'invoice_lookup'],
    authModel: 'partner_portal',
    risk: 'external_purchase',
    ownerFacingUse: 'Future building-material pricing, quote/order status, delivery tracking, and invoice workflows.',
    currentFallback: 'Use uploaded BFS quotes, receipts, invoices, delivery tickets, and manual supplier notes.',
    safetyRules: [
      'Never place or change material orders without explicit approval.',
      'Treat receipts and invoices as job-cost/company-expense records, not reusable pricing by default.',
      'Account pricing must stay tenant-scoped.',
    ],
  },
  {
    id: 'home_depot',
    label: 'The Home Depot',
    category: 'retail',
    status: 'planned',
    capabilities: ['price_catalog', 'store_availability', 'receipt_lookup'],
    authModel: 'partner_portal',
    risk: 'financial',
    ownerFacingUse: 'Future retail material availability, receipt lookup, and small-purchase reconciliation.',
    currentFallback: 'Use uploaded receipts/invoices and public/manual price references.',
    safetyRules: [
      'Retail prices are not a substitute for contractor account pricing unless confirmed.',
      'Receipts belong to job cost or company expense workflows, not customer documents by default.',
    ],
  },
  {
    id: 'lowes',
    label: "Lowe's",
    category: 'retail',
    status: 'planned',
    capabilities: ['price_catalog', 'store_availability', 'receipt_lookup'],
    authModel: 'partner_portal',
    risk: 'financial',
    ownerFacingUse: 'Future retail availability, receipts, and small material purchase workflows.',
    currentFallback: 'Use uploaded receipts/invoices and manual material notes.',
    safetyRules: [
      'Retail receipt data should be scoped to the correct job or company expense.',
      'Do not create supplier orders from retail availability without approval.',
    ],
  },
  {
    id: 'public_web_search',
    label: 'Public web search',
    category: 'marketing',
    status: 'available',
    capabilities: ['web_search', 'reviews_lookup', 'social_research', 'property_lookup'],
    envVars: ['LLM_API_KEY'],
    authModel: 'env_api_key',
    risk: 'read_only',
    ownerFacingUse: 'Research company presence, public reviews/social signals, property clues, and public sources.',
    currentFallback: 'If unavailable, Jobrolo should ask for the source/link or explain that web search is not configured.',
    safetyRules: [
      'Public search cannot claim private analytics, traffic attribution, or platform dashboard metrics.',
      'Sources must be deduped and labeled as public evidence.',
      'Property-owner research must be presented as a candidate match requiring confirmation.',
    ],
  },
]

const INTEGRATION_MAP = new Map(INTEGRATIONS.map(integration => [integration.id, integration]))

export function getIntegrationById(id: string) {
  return INTEGRATION_MAP.get(id)
}

export function getIntegrationReadiness(id: string): IntegrationReadiness | null {
  const definition = getIntegrationById(id)
  return definition ? configuredStatus(definition) : null
}

export function getAllIntegrationReadiness() {
  return INTEGRATIONS.map(configuredStatus)
}

export function getIntegrationsByCapability(capability: IntegrationCapability) {
  return INTEGRATIONS.filter(integration => integration.capabilities.includes(capability))
}

export function integrationCapabilitySummary(capability: IntegrationCapability) {
  return getIntegrationsByCapability(capability)
    .map(integration => {
      const readiness = configuredStatus(integration)
      return `${integration.label}: ${readiness.configured ? 'configured' : readiness.status}; fallback: ${readiness.currentFallback}`
    })
    .join('\n')
}
