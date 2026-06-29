export type JobroloBrainMode =
  | 'command_center'
  | 'field'
  | 'upload'
  | 'onboarding'
  | 'cody'
  | 'company'
  | 'customer_project'
  | 'planning'
  | 'support'
  | 'unknown'

export type JobroloBrainUrgency = 'low' | 'normal' | 'high'

export type JobroloBrainSentiment = 'steady' | 'frustrated' | 'excited' | 'uncertain'

export type JobroloBrainSignalId =
  | 'field_context'
  | 'upload_context'
  | 'cody_context'
  | 'setup_context'
  | 'company_context'
  | 'customer_project_context'
  | 'bug_or_friction'
  | 'next_step_needed'
  | 'outside_world'
  | 'learning_needed'

export interface JobroloBrainSignal {
  id: JobroloBrainSignalId
  label: string
  confidence: number
  evidence: string
  instruction: string
}

export interface JobroloBrainContext {
  mode: JobroloBrainMode
  urgency: JobroloBrainUrgency
  sentiment: JobroloBrainSentiment
  summary: string
  signals: JobroloBrainSignal[]
  suggestedPaths: string[]
  guardrails: string[]
}

export interface BuildBrainContextInput {
  latestText: string
  recentText?: string
  normalizedText?: string
  channelType?: string
  role?: string
  hasUpload?: boolean
  requestIntentId?: string
  hasActiveCustomer?: boolean
  hasActiveProject?: boolean
  hasActiveWorkspace?: boolean
}
