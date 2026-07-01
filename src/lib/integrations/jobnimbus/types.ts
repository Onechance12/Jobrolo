import type { PublicAdjusterWorkflowResult } from '../../operating-models'

export type JobNimbusSourceRecordType = 'contact' | 'job' | 'task' | 'document' | 'payment' | 'activity'

export type JobNimbusAssignee = {
  name?: string | null
  email?: string | null
}

export type JobNimbusOpenTask = {
  title: string
  dueDate?: string | null
  assignee?: JobNimbusAssignee | null
}

export type JobNimbusFileReference = {
  id?: string | null
  name: string
  type?: string | null
  status?: string | null
}

export type JobNimbusPaymentReference = {
  id?: string | null
  amount?: number | null
  date?: string | null
  type?: string | null
}

export type JobNimbusClaimInput = {
  sourceSystem?: 'jobnimbus'
  sourceRecordType?: JobNimbusSourceRecordType
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
  openTasks?: JobNimbusOpenTask[] | null
  files?: JobNimbusFileReference[] | null
  payments?: JobNimbusPaymentReference[] | null
}

export type JobroloClaimPacket = {
  sourceSystem: 'jobnimbus'
  sourceRecordType: JobNimbusSourceRecordType
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
  tasks: Array<JobNimbusOpenTask & { overdue: boolean }>
  documents: JobNimbusFileReference[]
  payments: JobNimbusPaymentReference[]
  timelineHints: string[]
  importWarnings: string[]
  codexTestNotes: string[]
}
