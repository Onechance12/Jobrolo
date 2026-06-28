export type IntegrationCategory =
  | 'ai'
  | 'supplier'
  | 'retail'
  | 'property_data'
  | 'marketing'
  | 'communications'
  | 'calendar'
  | 'accounting'

export type IntegrationStatus = 'available' | 'configured' | 'missing_config' | 'planned' | 'unsupported'

export type IntegrationCapability =
  | 'chat_reasoning'
  | 'web_search'
  | 'document_vision'
  | 'price_catalog'
  | 'account_pricing'
  | 'quote_request'
  | 'material_order'
  | 'order_status'
  | 'delivery_tracking'
  | 'invoice_lookup'
  | 'receipt_lookup'
  | 'store_availability'
  | 'property_lookup'
  | 'reviews_lookup'
  | 'social_research'
  | 'notification_send'
  | 'calendar_sync'

export type IntegrationRisk = 'read_only' | 'writes_internal' | 'external_send' | 'external_purchase' | 'financial'

export interface IntegrationDefinition {
  id: string
  label: string
  category: IntegrationCategory
  status: IntegrationStatus
  capabilities: IntegrationCapability[]
  envVars?: string[]
  authModel: 'env_api_key' | 'oauth' | 'partner_portal' | 'manual_upload' | 'none'
  risk: IntegrationRisk
  ownerFacingUse: string
  currentFallback: string
  safetyRules: string[]
  notes?: string[]
}

export interface IntegrationReadiness {
  id: string
  label: string
  category: IntegrationCategory
  configured: boolean
  status: IntegrationStatus
  capabilities: IntegrationCapability[]
  missingEnvVars: string[]
  currentFallback: string
  safetyRules: string[]
}
