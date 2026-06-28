export type JobroloSkillCategory =
  | 'core_platform'
  | 'company_setup'
  | 'uploads_documents'
  | 'customers_projects'
  | 'customers-projects'
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
  uploadPurpose?: string
  suggestedUploadPurpose?: string
  uploadIntentSource?: string
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
  | 'project_cost'
  | 'inspection_photo'
  | 'customer_project_file'
  | 'unassigned_review'

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
  confidence: number
  suggestedPrompt?: string
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
}

export interface SkillSelection {
  skill: JobroloSkill
  confidence: number
  reason: string
}

export interface RenderedSkillInstructions {
  skillIds: string[]
  text: string
}
