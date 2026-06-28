import type { SkillRoutingContext, UploadSkillClassification, UploadSkillInput } from './types'

type SkillContextMessage = {
  role: string
  content?: unknown
  message?: {
    content: unknown
  }
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object' && 'text' in part) return String((part as any).text ?? '')
        return ''
      })
      .join('\n')
  }
  if (content && typeof content === 'object' && 'text' in content) return String((content as any).text ?? '')
  return ''
}

function messageToText(message: SkillContextMessage | undefined): string {
  if (!message) return ''
  return contentToText(message.content ?? message.message?.content ?? '')
}

export function normalizeSkillText(text: string) {
  return text
    .replace(/<UNTRUSTED_CONTENT[^>]*>/gi, '')
    .replace(/<\/UNTRUSTED_CONTENT>/gi, '')
    .replace(/\[BROWSER_LOCATION\][\s\S]*$/i, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

const PRICE_LIST_RE = /\b(price\s*(sheet|list)|pricing|material\s*(prices?|list)|supplier\s*pricing|supplier\s*catalog|cost\s*sheet)\b/i
const TEMPLATE_RE = /\b(template|agreement|contract|authorization|contingency|warranty|terms|estimate\s*template|report\s*template|form)\b/i
const SCOPE_RE = /\b(scope|estimate|xactimate|symbility|carrier|claim|insurance|line\s*items?|rcv|acv|deductible)\b/i
const SUPPLIER_COST_RE = /\b(supplier\s*invoice|delivery\s*ticket|material\s*quote|order\s*confirmation|packing\s*slip)\b/i
const LOGO_RE = /\b(company\s*)?logo|brand\s*asset|brand\s*mark\b/i
const USER_AVATAR_RE = /\b(profile\s*(photo|picture|image)|avatar|headshot)\b/i

export function detectDocumentTypeFromName(filename: string, mimeType = '') {
  const lower = `${filename} ${mimeType}`.toLowerCase().replace(/[_-]+/g, ' ')
  if (mimeType.startsWith('image/')) return 'photo'
  if (PRICE_LIST_RE.test(lower)) return 'price_sheet'
  if (SUPPLIER_COST_RE.test(lower)) return 'supplier_cost_document'
  if (TEMPLATE_RE.test(lower)) return 'template'
  if (SCOPE_RE.test(lower)) return lower.includes('scope') ? 'scope_of_loss' : 'estimate'
  if (/\binvoice\b/.test(lower)) return 'invoice'
  if (/\bpermit\b/.test(lower)) return 'permit'
  if (/\bclaim|insurance\b/.test(lower)) return 'insurance_claim'
  if (mimeType === 'application/pdf' || /\.pdf$/i.test(filename)) return 'pdf'
  return 'other'
}

export function classifyUploadForSkills(input: UploadSkillInput): UploadSkillClassification {
  const filename = input.filename || 'upload'
  const mimeType = input.mimeType || ''
  const combined = [
    filename,
    mimeType,
    input.uploadPurpose,
    input.suggestedUploadPurpose,
    input.uploadIntentSource,
    input.photoSection,
    input.photoSectionLabel,
    input.recentUserText,
  ].filter(Boolean).join(' ')
  const lower = combined.toLowerCase().replace(/[_-]+/g, ' ')

  if (input.uploadPurpose === 'user_avatar' || input.suggestedUploadPurpose === 'user_avatar' || USER_AVATAR_RE.test(lower)) {
    const explicitlyConfirmed = input.uploadPurpose === 'user_avatar'
    return {
      skillIds: ['upload-classifier', 'brand-assets'],
      fileType: 'user_avatar',
      documentType: 'user_avatar',
      route: 'user_profile',
      storageScope: 'user_profile',
      uploadPurpose: input.uploadPurpose || 'user_avatar',
      companyLevel: true,
      projectLevel: false,
      needsClarification: !explicitlyConfirmed,
      reason: 'Upload appears to be a user profile photo/avatar.',
      confidence: 0.96,
      suggestedPrompt: 'Saved this as a profile photo candidate. Do you want me to update your account avatar with it?',
    }
  }

  if (input.uploadPurpose === 'company_logo' || input.suggestedUploadPurpose === 'company_logo' || LOGO_RE.test(lower)) {
    const explicitlyConfirmed = input.uploadPurpose === 'company_logo'
    return {
      skillIds: ['upload-classifier', 'brand-assets', 'company-profile'],
      fileType: 'company_logo',
      documentType: 'company_logo',
      route: 'brand_asset',
      storageScope: 'brand_asset',
      uploadPurpose: input.uploadPurpose || 'company_logo',
      companyLevel: true,
      projectLevel: false,
      needsClarification: !explicitlyConfirmed,
      reason: 'Upload appears to be a company logo/brand asset.',
      confidence: 0.96,
      suggestedPrompt: 'Saved this as a company logo candidate. Do you want me to update the company profile logo with it?',
    }
  }

  const documentType = detectDocumentTypeFromName(filename, mimeType)

  if (input.uploadPurpose === 'company_pricing' || documentType === 'price_sheet') {
    return {
      skillIds: ['upload-classifier', 'document-type-routing', 'price-list'],
      fileType: 'price_sheet',
      documentType: 'price_sheet',
      route: 'company_pricing',
      storageScope: 'company_pricing',
      uploadPurpose: input.uploadPurpose || 'company_pricing',
      companyLevel: true,
      projectLevel: false,
      needsClarification: false,
      reason: 'Supplier/material price sheets route to company pricing by default.',
      confidence: 0.95,
      suggestedPrompt: 'Saved this as a company price sheet. I’ll extract the rows for review before importing anything into material pricing.',
    }
  }

  if (
    input.uploadPurpose === 'company_document' ||
    input.uploadPurpose === 'company_template' ||
    input.suggestedUploadPurpose === 'company_document' ||
    input.suggestedUploadPurpose === 'company_template' ||
    documentType === 'template'
  ) {
    return {
      skillIds: ['upload-classifier', 'document-type-routing', 'template-intake'],
      fileType: /\.pdf$/i.test(filename) || mimeType === 'application/pdf' ? 'contract' : documentType,
      documentType: 'template',
      route: 'company_template',
      storageScope: 'company_template',
      uploadPurpose: input.uploadPurpose || 'company_template',
      companyLevel: true,
      projectLevel: false,
      needsClarification: false,
      reason: 'Templates/forms route to the company template library unless explicitly tied to a job.',
      confidence: 0.9,
      suggestedPrompt: 'Saved this as a company template candidate. Do you want me to turn it into a reusable Jobrolo template?',
    }
  }

  if (documentType === 'estimate' || documentType === 'scope_of_loss' || documentType === 'insurance_claim') {
    return {
      skillIds: ['upload-classifier', 'document-type-routing', 'save-scope', 'entity-resolver'],
      fileType: documentType === 'insurance_claim' ? 'estimate' : documentType,
      documentType,
      route: 'project_scope',
      storageScope: 'project_file',
      companyLevel: false,
      projectLevel: true,
      needsClarification: !input.hasCustomerContext && !input.hasProjectContext && !input.hasWorkspaceContext,
      reason: 'Scopes and estimates belong to a customer/project once resolved.',
      confidence: 0.88,
      suggestedPrompt: 'Saved the scope/estimate. Which customer or project should I attach this to, or should I create a job from it?',
    }
  }

  if (documentType === 'supplier_cost_document') {
    return {
      skillIds: ['upload-classifier', 'document-type-routing', 'supplier'],
      fileType: 'invoice',
      documentType,
      route: 'project_cost',
      storageScope: 'project_file',
      companyLevel: false,
      projectLevel: true,
      needsClarification: true,
      reason: 'Supplier invoices, quotes, and delivery tickets need a job/project before they become job cost.',
      confidence: 0.82,
      suggestedPrompt: 'Saved this supplier document. Which job should I attach this cost/delivery record to?',
    }
  }

  if (mimeType.startsWith('image/')) {
    const hasSection = Boolean(input.photoSection || input.photoSectionLabel)
    return {
      skillIds: ['upload-classifier', 'document-type-routing', 'file-attachment'],
      fileType: 'photo',
      documentType: 'photo',
      route: hasSection ? 'inspection_photo' : 'unassigned_review',
      storageScope: hasSection ? 'field_evidence' : 'unassigned_review',
      companyLevel: false,
      projectLevel: hasSection,
      needsClarification: !hasSection,
      reason: hasSection ? 'Photo includes field/inspection section context.' : 'General photo needs customer/project or purpose confirmation.',
      confidence: hasSection ? 0.82 : 0.55,
      suggestedPrompt: 'Saved the photo. Which customer/project or inspection section should I attach it to?',
    }
  }

  return {
    skillIds: ['upload-classifier', 'document-type-routing', 'file-attachment'],
    fileType: documentType === 'pdf' ? 'pdf' : documentType,
    documentType,
    route: 'unassigned_review',
    storageScope: 'unassigned_review',
    companyLevel: false,
    projectLevel: false,
    needsClarification: true,
    reason: 'Document type is not specific enough to route without confirmation.',
    confidence: 0.45,
    suggestedPrompt: 'Saved the file. Is this for a customer/project, company setup, pricing, or templates?',
  }
}

export function buildSkillRoutingContext(input: {
  messages?: SkillContextMessage[]
  latestText?: string
  documentIds?: string[]
  channelType?: string
  role?: string
  activeCustomerId?: string | null
  activeProjectId?: string | null
  activeWorkspaceId?: string | null
  upload?: UploadSkillInput
}): SkillRoutingContext {
  const externalMessages = (input.messages ?? []).filter(message => message.role === 'user')
  const latestText = input.latestText ?? messageToText(externalMessages.at(-1))
  const recentText = externalMessages.slice(-4).map(messageToText).join('\n')
  const uploadClassification = input.upload ? classifyUploadForSkills(input.upload) : undefined
  return {
    latestText,
    normalizedText: normalizeSkillText(`${recentText}\n${latestText}`),
    documentIds: input.documentIds,
    channelType: input.channelType,
    role: input.role,
    activeCustomerId: input.activeCustomerId,
    activeProjectId: input.activeProjectId,
    activeWorkspaceId: input.activeWorkspaceId,
    upload: input.upload,
    uploadClassification,
  }
}
