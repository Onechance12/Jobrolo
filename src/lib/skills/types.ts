import type { JobroloBrainContext } from '../brain/types'

export type JobroloSkillCategory =
  | 'core_platform'
  | 'company_setup'
  | 'uploads_documents'
  | 'customers_projects'
  | 'production'
  | 'suppliers'
  | 'homeowner'
  | 'crews_subs'
  | 'partners'
  | 'external_roles'
  | 'marketing_growth'
  | 'meta'

export type JobroloSkillRisk = 'read' | 'low' | 'medium' | 'high' | 'external'

export type JobroloSkillStatus = 'draft' | 'active' | 'planned' | 'experimental' | 'deprecated'

export type JobroloSkillRole =
  | 'owner'
  | 'admin'
  | 'sales'
  | 'production'
  | 'project_manager'
  | 'supplement'
  | 'supplementer'
  | 'office'
  | 'homeowner'
  | 'crew'
  | 'supplier'
  | 'adjuster'
  | 'realtor'
  | 'marketing'
  | 'system'

export interface JobroloSkillTriggers {
  intents?: string[]
  phrases?: string[]
  fileTypes?: string[]
  documentTypes?: string[]
  uploadPurposes?: string[]
  documentHints?: string[]
  toolNames?: string[]
  routes?: string[]
  fileNamePatterns?: string[]
  channelTypes?: string[]
}

export interface JobroloSkill {
  id: string
  name?: string
  title?: string
  version?: string
  category: JobroloSkillCategory
  status: JobroloSkillStatus
  risk?: JobroloSkillRisk
  riskLevel?: JobroloSkillRisk
  defaultScope?: SkillStorageScope | 'system' | 'company' | 'customer' | 'project' | 'workspace' | 'field' | 'external'
  priority: number
  purpose: string
  whenToUse: string[]
  whenNotToUse?: string[]
  triggers?: JobroloSkillTriggers
  allowedRoles: JobroloSkillRole[]
  requiredContext?: string[]
  optionalContext?: string[]
  allowedTools?: string[]
  forbiddenTools?: string[]
  approvalRequiredFor?: string[]
  decisionRules: Array<string | { if: string; then: string }>
  output?: {
    cards?: string[]
    attachments?: string[]
    timelineEvents?: string[]
    actionKinds?: string[]
  }
  outputFormat?: string
  failureHandling?: string[]
  tests?: Array<string | { name: string; input: string; expected: string }>
}

export type JobroloSkillDefinition = JobroloSkill

export interface UploadSkillInput {
  filename: string
  mimeType?: string
  /**
   * Visible/extracted content signals are trusted more than filenames.
   * `metadataTitle` is intentionally treated as weak evidence, similar to filename.
   */
  visibleText?: string
  extractedText?: string
  contentHints?: string[]
  metadataTitle?: string
  uploadPurpose?: string
  suggestedUploadPurpose?: string
  uploadIntentSource?: string
  actionSource?: string
  activeRoute?: string
  captureMode?: 'upload' | 'camera' | 'voice' | 'video' | 'ar_capture' | 'manual_note' | 'system'
  captureSource?: string
  captureLatitude?: number
  captureLongitude?: number
  captureAccuracyMeters?: number
  capturedAt?: string
  photoSection?: string
  photoSectionLabel?: string
  hasCustomerContext?: boolean
  hasProjectContext?: boolean
  hasWorkspaceContext?: boolean
  recentUserText?: string
}

export type SkillStorageScope =
  | 'company_pricing'
  | 'company_template'
  | 'company_profile'
  | 'brand_asset'
  | 'user_profile'
  | 'project_file'
  | 'customer_file'
  | 'field_evidence'
  | 'unassigned_review'

export type UploadSkillRoute =
  | 'company_pricing'
  | 'company_template'
  | 'company_document'
  | 'brand_asset'
  | 'user_profile'
  | 'project_scope'
  | 'project_invoice'
  | 'project_cost'
  | 'inspection_photo'
  | 'customer_project_file'
  | 'unassigned_review'

export type UploadEvidenceKind = 'user_intent' | 'visible_content' | 'document_structure' | 'context' | 'conflicting_evidence' | 'filename_fallback' | 'mixed' | 'unknown'

export type EvidenceSignalTrust = 'strong' | 'medium' | 'weak'

export interface EvidenceSignal {
  kind:
    | 'user_intent'
    | 'visible_text'
    | 'document_structure'
    | 'app_context'
    | 'filename'
    | 'mime_type'
    | 'gps'
    | 'photo_section'
    | 'capture_source'
  label: string
  value?: string
  confidence: number
  trust: EvidenceSignalTrust
}

export interface EvidencePacket {
  source: 'upload' | 'camera' | 'voice' | 'video' | 'ar_capture' | 'manual_note' | 'system'
  filename?: string
  mimeType?: string
  userIntent?: string
  visibleContentAvailable: boolean
  appContext: {
    hasCustomer: boolean
    hasProject: boolean
    hasWorkspace: boolean
    activeRoute?: string
  }
  location?: {
    latitude: number
    longitude: number
    accuracyMeters?: number
    source?: string
    capturedAt?: string
  }
  signals: EvidenceSignal[]
  primaryEvidence: UploadEvidenceKind
  route: UploadSkillRoute
  storageScope: SkillStorageScope
  confidence: number
  needsClarification: boolean
  recommendedQuestion?: string
}

export interface UploadSkillClassification {
  skillIds: string[]
  fileType: string
  documentType: string
  route: UploadSkillRoute
  storageScope: SkillStorageScope
  uploadPurpose?: string
  companyLevel: boolean
  projectLevel: boolean
  needsClarification: boolean
  reason: string
  evidence: UploadEvidenceKind
  confidence: number
  suggestedPrompt?: string
  routeLabel?: string
  confidenceReasons?: string[]
  evidencePacket?: EvidencePacket
}

export interface SkillRoutingContext {
  latestText: string
  normalizedText: string
  documentIds?: string[]
  channelType?: string
  role?: string
  activeCustomerId?: string | null
  activeProjectId?: string | null
  activeWorkspaceId?: string | null
  upload?: UploadSkillInput
  uploadClassification?: UploadSkillClassification
  requestIntent?: JobroloRequestIntent
  brain?: JobroloBrainContext
}

export interface SkillSelection {
  skill: JobroloSkill
  confidence: number
  reason: string
}

export type JobroloIntentId =
  | 'cash_quote_bid'
  | 'upload_routing'
  | 'field_inspection'
  | 'field_observation'
  | 'lead_intake'
  | 'appointment_scheduling'
  | 'photo_evidence'
  | 'roof_report'
  | 'communication_draft'
  | 'communication_routing'
  | 'activity_timeline'
  | 'role_permissions'
  | 'project_closeout'
  | 'integration_provider'
  | 'cody_review'
  | 'company_profile'
  | 'user_profile'
  | 'company_intelligence'
  | 'price_list'
  | 'customer_project_inventory'
  | 'chat_invite'
  | 'general'

export type JobroloIntentMode = 'chat' | 'workflow' | 'qa' | 'onboarding'

export interface JobroloRequestIntent {
  id: JobroloIntentId
  mode: JobroloIntentMode
  confidence: number
  primarySkill?: string
  supportingSkills?: string[]
  workflowName?: string
  sticky?: boolean
  allowedTools?: string[]
  blockedTools?: string[]
  requiredContext?: string[]
  nextStep?: 'call_tool' | 'ask_clarification' | 'show_card' | 'answer'
  summary: string
  laneRules: string[]
}

export type SkillConsultRole = 'primary' | 'supporting'

export interface SkillConsult {
  skillId: string
  role: SkillConsultRole
  finding: string
  confidence: number
  suggestedAction?: string
  requiredContext?: string[]
  approvalNeeded?: boolean
  allowedTools?: string[]
  blockedTools?: string[]
  userVisible?: boolean
}

export interface SkillOrchestrationPlan {
  primarySkill: string
  supportingSkills: string[]
  consults: SkillConsult[]
  selectedEntities: {
    customerId?: string | null
    projectId?: string | null
    workspaceId?: string | null
    documentIds?: string[]
  }
  requiredContext: string[]
  riskLevel: JobroloSkillRisk
  approvalNeeded: boolean
  allowedTools: string[]
  blockedTools: string[]
  recommendedAction: string
  userFacingSummary: string
  highComplexity: boolean
}

export interface RenderedSkillInstructions {
  skillIds: string[]
  text: string
}
