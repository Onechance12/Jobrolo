import type { SkillRoutingContext, UploadSkillClassification, UploadSkillInput } from './types'
import { resolveJobroloIntent } from './intent-router'

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

const PRICE_LIST_RE = /\b(price\s*(sheet|list)|pricing|material\s*(prices?|list)|supplier\s*pricing|supplier\s*catalog|cost\s*sheet|pricebook|price\s*book)\b/i
const TEMPLATE_RE = /\b(template|blank\s*(form|agreement|contract)|agreement\s*template|contract\s*template|authorization\s*template|contingency\s*template|warranty\s*template|terms\s*template|estimate\s*template|report\s*template|form\s*template)\b/i
const SCOPE_RE = /\b(scope|scope\s*of\s*loss|estimate|xactimate|symbility|carrier\s*estimate|claim|insurance|line\s*items?|rcv|acv|depreciation|deductible)\b/i
const SUPPLIER_COST_RE = /\b(supplier\s*invoice|invoice|delivery\s*ticket|material\s*quote|supplier\s*quote|order\s*confirmation|packing\s*slip|bill\s*to|remit|due\s*date|subtotal|tax|total\s*due|received\s*by)\b/i
const LOGO_RE = /\b(company\s*)?logo|brand\s*asset|brand\s*mark\b/i
const USER_AVATAR_RE = /\b(profile\s*(photo|picture|image)|avatar|headshot)\b/i
const ROOF_REPORT_RE = /\b(roof\s*report|inspection\s*report|property\s*report|photo\s*documentation|observed\s*conditions|recommendations)\b/i
const MEASUREMENT_RE = /\b(eagleview|hover|roof\s*measurement|roof\s*diagram|facets?|pitch|squares?)\b/i

type EvidenceKind = UploadSkillClassification['evidence']

function normalizeEvidenceText(text: string) {
  return text.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
}

export function detectDocumentTypeFromName(filename: string, mimeType = '') {
  const lower = normalizeEvidenceText(`${filename} ${mimeType}`)
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

function detectDocumentTypeFromTrustedText(text: string) {
  const lower = normalizeEvidenceText(text)
  if (!lower) return ''
  if (PRICE_LIST_RE.test(lower)) return 'price_sheet'
  if (SUPPLIER_COST_RE.test(lower)) return 'supplier_cost_document'
  if (TEMPLATE_RE.test(lower)) return 'template'
  if (ROOF_REPORT_RE.test(lower)) return 'roof_report'
  if (MEASUREMENT_RE.test(lower)) return 'measurement_report'
  if (SCOPE_RE.test(lower)) return lower.includes('scope') ? 'scope_of_loss' : 'estimate'
  if (/\bpermit\b/.test(lower)) return 'permit'
  return ''
}

function routeClarification(input: {
  filename: string
  mimeType: string
  weakType: string
  reason: string
  suggestedPrompt?: string
  confidence?: number
}): UploadSkillClassification {
  const fallbackType = input.mimeType.startsWith('image/')
    ? 'photo'
    : input.mimeType === 'application/pdf' || /\.pdf$/i.test(input.filename)
      ? 'pdf'
      : 'other'
  return {
    skillIds: ['upload-classifier', 'document-type-routing', 'file-attachment'],
    fileType: fallbackType,
    documentType: input.weakType || fallbackType,
    route: 'unassigned_review',
    storageScope: 'unassigned_review',
    companyLevel: false,
    projectLevel: false,
    needsClarification: true,
    reason: input.reason,
    evidence: input.weakType && input.weakType !== 'other' ? 'filename_fallback' : 'unknown',
    confidence: input.confidence ?? 0.35,
    suggestedPrompt: input.suggestedPrompt ?? 'Saved the file. Is this reusable company material, or is it for a specific customer/job?',
  }
}

function withEvidence(classification: Omit<UploadSkillClassification, 'evidence'>, evidence: EvidenceKind): UploadSkillClassification {
  return { ...classification, evidence }
}

export function classifyUploadForSkills(input: UploadSkillInput): UploadSkillClassification {
  const filename = input.filename || 'upload'
  const mimeType = input.mimeType || ''
  const intentText = [
    input.uploadPurpose,
    input.suggestedUploadPurpose,
    input.uploadIntentSource,
    input.photoSection,
    input.photoSectionLabel,
    input.recentUserText,
  ].filter(Boolean).join(' ')
  const trustedContentText = [
    input.visibleText,
    input.extractedText,
    ...(input.contentHints ?? []),
  ].filter(Boolean).join(' ')
  const weakText = [filename, input.metadataTitle, mimeType].filter(Boolean).join(' ')
  const intent = normalizeEvidenceText(intentText)
  const content = normalizeEvidenceText(trustedContentText)
  const intentType = detectDocumentTypeFromTrustedText(intent)
  const contentType = detectDocumentTypeFromTrustedText(content)
  const weakType = detectDocumentTypeFromName(filename, mimeType)
  const hasOperationalContext = Boolean(input.hasCustomerContext || input.hasProjectContext || input.hasWorkspaceContext)

  if (intentType && contentType && intentType !== contentType) {
    return routeClarification({
      filename,
      mimeType,
      weakType,
      reason: `User intent suggests ${intentType}, but visible/extracted content suggests ${contentType}. Confirmation is required before routing.`,
      suggestedPrompt: intentType === 'price_sheet' && contentType === 'supplier_cost_document'
        ? 'This file was described like pricing, but the visible content looks like an invoice/quote. Should I treat it as company pricing or a job-specific supplier cost?'
        : 'The upload intent and document content disagree. Should I save this as company material or attach it to a customer/project?',
      confidence: 0.38,
    })
  }

  if (input.uploadPurpose === 'user_avatar' || input.suggestedUploadPurpose === 'user_avatar' || USER_AVATAR_RE.test(intent)) {
    const explicitlyConfirmed = input.uploadPurpose === 'user_avatar'
    return withEvidence({
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
    }, 'user_intent')
  }

  if (input.uploadPurpose === 'company_logo' || input.suggestedUploadPurpose === 'company_logo' || LOGO_RE.test(intent) || LOGO_RE.test(content)) {
    const explicitlyConfirmed = input.uploadPurpose === 'company_logo'
    return withEvidence({
      skillIds: ['upload-classifier', 'brand-assets', 'company-profile'],
      fileType: 'company_logo',
      documentType: 'company_logo',
      route: 'brand_asset',
      storageScope: 'brand_asset',
      uploadPurpose: input.uploadPurpose || 'company_logo',
      companyLevel: true,
      projectLevel: false,
      needsClarification: !explicitlyConfirmed,
      reason: LOGO_RE.test(content) ? 'Visible/extracted content appears to be a company logo/brand asset.' : 'User intent indicates a company logo/brand asset.',
      confidence: LOGO_RE.test(content) ? 0.9 : 0.96,
      suggestedPrompt: 'Saved this as a company logo candidate. Do you want me to update the company profile logo with it?',
    }, LOGO_RE.test(content) ? 'visible_content' : 'user_intent')
  }

  const documentType = contentType || intentType || weakType
  const primaryEvidence: EvidenceKind = contentType ? 'visible_content' : intentType ? 'user_intent' : 'filename_fallback'

  if (input.uploadPurpose === 'company_pricing' || intentType === 'price_sheet' || contentType === 'price_sheet') {
    return withEvidence({
      skillIds: ['upload-classifier', 'document-type-routing', 'price-list'],
      fileType: 'price_sheet',
      documentType: 'price_sheet',
      route: 'company_pricing',
      storageScope: 'company_pricing',
      uploadPurpose: input.uploadPurpose || 'company_pricing',
      companyLevel: true,
      projectLevel: false,
      needsClarification: false,
      reason: contentType === 'price_sheet' ? 'Visible/extracted content indicates supplier/material price sheet.' : 'User intent/action source indicates company pricing.',
      confidence: contentType === 'price_sheet' ? 0.92 : 0.95,
      suggestedPrompt: 'Saved this as a company price sheet. I’ll extract the rows for review before importing anything into material pricing.',
    }, contentType === 'price_sheet' ? 'visible_content' : 'user_intent')
  }

  if (
    input.uploadPurpose === 'company_document' ||
    input.uploadPurpose === 'company_template' ||
    input.suggestedUploadPurpose === 'company_document' ||
    input.suggestedUploadPurpose === 'company_template' ||
    intentType === 'template' ||
    contentType === 'template'
  ) {
    return withEvidence({
      skillIds: ['upload-classifier', 'document-type-routing', 'template-intake'],
      fileType: /\.pdf$/i.test(filename) || mimeType === 'application/pdf' ? 'contract' : documentType,
      documentType: 'template',
      route: 'company_template',
      storageScope: 'company_template',
      uploadPurpose: input.uploadPurpose || 'company_template',
      companyLevel: true,
      projectLevel: false,
      needsClarification: false,
      reason: contentType === 'template' ? 'Visible/extracted content indicates a reusable template/form.' : 'User intent/action source indicates company template/library.',
      confidence: contentType === 'template' ? 0.88 : 0.9,
      suggestedPrompt: 'Saved this as a company template candidate. Do you want me to turn it into a reusable Jobrolo template?',
    }, contentType === 'template' ? 'visible_content' : 'user_intent')
  }

  if (contentType === 'estimate' || contentType === 'scope_of_loss' || intentType === 'estimate' || intentType === 'scope_of_loss') {
    return withEvidence({
      skillIds: ['upload-classifier', 'document-type-routing', 'save-scope', 'entity-resolver'],
      fileType: contentType || intentType,
      documentType: contentType || intentType,
      route: 'project_scope',
      storageScope: 'project_file',
      companyLevel: false,
      projectLevel: true,
      needsClarification: !hasOperationalContext,
      reason: contentType ? 'Visible/extracted content indicates a scope/estimate for a customer or project.' : 'User intent indicates a scope/estimate workflow.',
      confidence: contentType ? 0.88 : 0.84,
      suggestedPrompt: 'Saved the scope/estimate. Which customer or project should I attach this to, or should I create a job from it?',
    }, primaryEvidence === 'filename_fallback' ? 'context' : primaryEvidence)
  }

  if (contentType === 'supplier_cost_document' || intentType === 'supplier_cost_document') {
    return withEvidence({
      skillIds: ['upload-classifier', 'document-type-routing', 'supplier'],
      fileType: 'invoice',
      documentType,
      route: 'project_cost',
      storageScope: 'project_file',
      companyLevel: false,
      projectLevel: true,
      needsClarification: true,
      reason: contentType === 'supplier_cost_document' ? 'Visible/extracted content indicates supplier invoice/quote/delivery ticket.' : 'User intent indicates supplier cost/delivery workflow.',
      confidence: contentType === 'supplier_cost_document' ? 0.84 : 0.8,
      suggestedPrompt: 'Saved this supplier document. Which job should I attach this cost/delivery record to?',
    }, contentType === 'supplier_cost_document' ? 'visible_content' : 'user_intent')
  }

  if (mimeType.startsWith('image/')) {
    const hasSection = Boolean(input.photoSection || input.photoSectionLabel)
    return withEvidence({
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
    }, hasSection ? 'context' : 'unknown')
  }

  if (weakType && weakType !== 'other' && weakType !== 'pdf') {
    return routeClarification({
      filename,
      mimeType,
      weakType,
      reason: `Only filename or PDF title metadata suggests ${weakType}. That is weak evidence, so Jobrolo will wait for extraction or ask before routing.`,
      suggestedPrompt: weakType === 'price_sheet'
        ? 'This filename looks like a price sheet, but I need visible content or your confirmation before treating it as company pricing. Is it company pricing or job-specific?'
        : 'The filename hints at a document type, but filenames are unreliable. Is this reusable company material, or is it for a specific customer/job?',
      confidence: 0.32,
    })
  }

  return routeClarification({
    filename,
    mimeType,
    weakType,
    reason: 'Document type is not specific enough to route without confirmation or extracted content.',
    confidence: 0.3,
  })
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
  const context: SkillRoutingContext = {
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
  context.requestIntent = resolveJobroloIntent(context)
  return context
}
