import type { PublicAdjusterWorkflowResult } from '../../operating-models'

export type ExternalClaimCrmSourceRecordType = 'contact' | 'job' | 'task' | 'document' | 'payment' | 'activity'

export type ExternalClaimCrmAssignee = {
  name?: string | null
  email?: string | null
}

export type ExternalClaimCrmOpenTask = {
  title: string
  dueDate?: string | null
  assignee?: ExternalClaimCrmAssignee | null
}

export type ExternalClaimCrmFileReference = {
  id?: string | null
  name: string
  type?: string | null
  status?: string | null
}

export type ExternalClaimCrmPaymentReference = {
  id?: string | null
  amount?: number | null
  date?: string | null
  type?: string | null
}

export type ExternalClaimCrmInput = {
  sourceSystem?: 'external_claim_crm'
  sourceRecordType?: ExternalClaimCrmSourceRecordType
  sourceId?: string | null
  customerName: string
  address?: string | null
  status?: string | null
  recordType?: string | null
  carrier?: string | null
  claimNumber?: string | null
  policyNumber?: string | null
  dateOfLoss?: string | null
  typeOfLoss?: string | null
  deductibleAmount?: number | null
  adjusterName?: string | null
  adjusterPhone?: string | null
  adjusterEmail?: string | null
  mortgageCompany?: string | null
  lastActivityDate?: string | null
  daysInStatus?: number | null
  lastClientTouchDays?: number | null
  notes?: string[] | null
  openTasks?: ExternalClaimCrmOpenTask[] | null
  files?: ExternalClaimCrmFileReference[] | null
  payments?: ExternalClaimCrmPaymentReference[] | null
}

export type JobroloClaimPacket = {
  sourceSystem: 'external_claim_crm'
  sourceRecordType: ExternalClaimCrmSourceRecordType
  sourceId?: string | null
  operatingModelId: 'public_adjuster'
  customer: {
    name: string
  }
  property: {
    address?: string | null
  }
  claim: {
    carrier?: string | null
    claimNumber?: string | null
    policyNumber?: string | null
    dateOfLoss?: string | null
    typeOfLoss?: string | null
    deductibleAmount?: number | null
    adjusterName?: string | null
    adjusterPhone?: string | null
    adjusterEmail?: string | null
    mortgageCompany?: string | null
  }
  workflow: PublicAdjusterWorkflowResult & {
    sourceStatus?: string | null
    sourceRecordTypeName?: string | null
  }
  tasks: Array<ExternalClaimCrmOpenTask & { overdue: boolean }>
  documents: ExternalClaimCrmFileReference[]
  payments: ExternalClaimCrmPaymentReference[]
  timelineHints: string[]
  importWarnings: string[]
  codexTestNotes: string[]
}
