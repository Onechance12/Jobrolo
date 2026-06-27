import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { db } from '@/lib/db'
import type { TenantContext } from '@/lib/security/context'
import { getContractorProfile } from '@/lib/contractor-profile'
import { defaultRoofReportDisclaimer, logProjectActivity, makeShareToken, renderRoofReportHtml } from '@/lib/field-ops'
import { toFileUrl, toThumbnailUrl } from '@/lib/file-url'
import { saveFile } from '@/lib/storage'
import { createSimplePdfBuffer, htmlToPlainText } from '@/lib/final-documents'
import { createProjectTimelineEvent, linkDocumentToJobPacket } from '@/lib/project-context'

export const ROOF_REPORT_CATEGORIES = [
  { key: 'front_elevation', label: 'Front elevation', required: true, group: 'overview' },
  { key: 'roof_overview', label: 'Roof overview', required: true, group: 'overview' },
  { key: 'shingle_closeup', label: 'Shingle close-up', required: true, group: 'roof' },
  { key: 'ridge', label: 'Ridge / hip', required: false, group: 'roof' },
  { key: 'valley', label: 'Valley', required: false, group: 'roof' },
  { key: 'pipe_jack', label: 'Pipe jack / flashing', required: false, group: 'accessories' },
  { key: 'vent', label: 'Vent / turtle vent', required: false, group: 'accessories' },
  { key: 'gutter', label: 'Gutter / downspout', required: false, group: 'collateral' },
  { key: 'soft_metal', label: 'Soft metal', required: false, group: 'collateral' },
  { key: 'interior_leak', label: 'Interior leak', required: false, group: 'interior' },
  { key: 'attic', label: 'Attic', required: false, group: 'interior' },
  { key: 'ceiling', label: 'Ceiling / drywall', required: false, group: 'interior' },
  { key: 'collateral', label: 'Collateral damage', required: false, group: 'collateral' },
  { key: 'other', label: 'Other', required: false, group: 'other' },
] as const

export const ROOF_REPORT_CONDITIONS = [
  'hail_indicator',
  'wind_indicator',
  'missing_shingle',
  'creased_shingle',
  'granule_loss',
  'dented_gutter',
  'active_water_entry',
  'no_issue_observed',
  'other',
] as const

export const ROOF_REPORT_SEVERITIES = [
  'informational',
  'monitor',
  'repair_recommended',
  'significant_concern',
  'immediate_attention',
] as const

const CATEGORY_LABELS = new Map(ROOF_REPORT_CATEGORIES.map(c => [c.key, c.label]))

function safeJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try { return JSON.parse(value) as T } catch { return fallback }
}

function asArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(v => String(v)).map(v => v.trim()).filter(Boolean)
  if (typeof value === 'string') return value.split('\n').map(v => v.trim()).filter(Boolean)
  return []
}

function humanize(value?: string | null) {
  return String(value || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function safeFileStem(value: string, fallback = 'roof-report') {
  return (value || fallback).replace(/<[^>]*>/g, '').replace(/[^a-z0-9._-]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 90) || fallback
}

function scoreReport(report: any, checklist: ReturnType<typeof buildPhotoChecklist>) {
  let score = 15
  if (report.propertyAddress) score += 8
  if (report.clientName) score += 8
  if (report.inspectionDate) score += 7
  if (report.inspectorName) score += 5
  if (report.propertyReviewSummary) score += 12
  if (asArray(safeJson(report.observedConditionsJson, [])).length) score += 12
  if (asArray(safeJson(report.recommendationsJson, [])).length) score += 12
  if (report.conclusion) score += 8
  score += Math.min(18, (report.photos?.filter((p: any) => p.isIncluded !== false).length || 0) * 2)
  score -= Math.min(30, checklist.missingRequired.length * 8 + checklist.missingRecommended.length * 3)
  return Math.max(0, Math.min(100, score))
}

export function buildPhotoChecklist(report: any) {
  const photos = Array.isArray(report.photos) ? report.photos.filter((p: any) => p.isIncluded !== false) : []
  const present = new Set(photos.map((p: any) => String(p.category || 'other')))
  const mode = String(report.mode || 'inspection')
  const baseRequired = ['front_elevation', 'roof_overview', 'shingle_closeup']
  const adjusterRecommended = ['gutter', 'soft_metal', 'collateral']
  const productionRecommended = ['front_elevation', 'roof_overview', 'other']
  const required = mode === 'production_closeout' ? ['front_elevation', 'roof_overview'] : baseRequired
  const recommended = mode.includes('adjuster') ? [...adjusterRecommended, 'interior_leak'] : mode.includes('production') ? productionRecommended : ['ridge', 'valley', 'gutter', 'soft_metal']
  const checklist = ROOF_REPORT_CATEGORIES.map(c => ({
    key: c.key,
    label: c.label,
    group: c.group,
    required: required.includes(c.key),
    recommended: recommended.includes(c.key),
    present: present.has(c.key),
    count: photos.filter((p: any) => p.category === c.key).length,
  }))
  return {
    checklist,
    missingRequired: checklist.filter(c => c.required && !c.present).map(c => c.key),
    missingRecommended: checklist.filter(c => c.recommended && !c.present && !c.required).map(c => c.key),
    presentCategories: Array.from(present),
  }
}

function groupPhotos(photos: any[]) {
  const groups: Record<string, any[]> = {}
  for (const photo of photos || []) {
    const group = ROOF_REPORT_CATEGORIES.find(c => c.key === photo.category)?.group || 'other'
    groups[group] ||= []
    groups[group].push({
      ...photo,
      categoryLabel: CATEGORY_LABELS.get(photo.category) || humanize(photo.category),
      tags: safeJson<string[]>(photo.tagsJson, []),
      imageUrl: photo.imageUrl || null,
    })
  }
  return Object.entries(groups).map(([group, items]) => ({ group, label: humanize(group), photos: items.sort((a, b) => a.sortOrder - b.sortOrder) }))
}

export function generatePhotoCaption(photo: any) {
  const category = CATEGORY_LABELS.get(photo.category) || humanize(photo.category || 'photo')
  const condition = photo.condition ? humanize(photo.condition) : 'condition documented'
  const severity = photo.severity ? humanize(photo.severity) : 'Informational'
  if (photo.condition === 'no_issue_observed') return `${category}: no visible issue observed at the time of inspection.`
  return `${category}: ${condition} observed. Severity: ${severity}.`
}

export function generateNarrativeFromReport(report: any) {
  const photos = Array.isArray(report.photos) ? report.photos.filter((p: any) => p.isIncluded !== false) : []
  const byCondition = new Map<string, number>()
  const bySeverity = new Map<string, number>()
  for (const p of photos) {
    if (p.condition) byCondition.set(p.condition, (byCondition.get(p.condition) || 0) + 1)
    if (p.severity) bySeverity.set(p.severity, (bySeverity.get(p.severity) || 0) + 1)
  }
  const conditionItems = Array.from(byCondition.entries()).sort((a, b) => b[1] - a[1])
  const severe = photos.filter((p: any) => ['repair_recommended', 'significant_concern', 'immediate_attention'].includes(String(p.severity)))
  const observed: string[] = []
  if (conditionItems.length) {
    observed.push(...conditionItems.slice(0, 8).map(([condition, count]) => `${humanize(condition)} documented in ${count} photo${count === 1 ? '' : 's'}.`))
  } else if (photos.length) {
    observed.push(`${photos.length} inspection photo${photos.length === 1 ? '' : 's'} documented for this roof report.`)
  }
  if (!observed.length) observed.push('No photo-documented conditions have been added yet.')

  const recommendations: string[] = []
  if (severe.length) recommendations.push('Review the photo-documented conditions and verify repair or replacement scope against the contract, estimate, and carrier documentation.')
  if (photos.some((p: any) => ['gutter', 'soft_metal', 'collateral'].includes(String(p.category)))) recommendations.push('Review collateral/soft metal indicators alongside the roof observations before finalizing scope.')
  if (photos.some((p: any) => ['interior_leak', 'ceiling', 'attic'].includes(String(p.category)))) recommendations.push('Review interior/attic conditions and document moisture entry or staining in the job packet.')
  if (!recommendations.length) recommendations.push('Use this report as visible-condition documentation and confirm final recommendations after review of all job documents.')

  const summary = report.propertyReviewSummary || `A roof inspection report was prepared for ${report.propertyAddress || 'the property'}. The report includes ${photos.length} included photo${photos.length === 1 ? '' : 's'} grouped by roof area, collateral conditions, and interior/attic documentation when available.`
  const conclusion = report.conclusion || 'This report documents visible conditions observed at the time of inspection and should be reviewed with the complete job packet before final scope, pricing, or claim decisions are made.'
  return { summary, observed, recommendations, conclusion }
}

const REPORT_PHOTO_KEYWORDS: Record<string, string[]> = {
  front_elevation: ['front elevation', 'front of house', 'front exterior', 'street view'],
  roof_overview: ['roof overview', 'roof surface', 'roof plane', 'roof slope', 'facet', 'shingles', 'roof covering'],
  shingle_closeup: ['shingle close', 'close-up', 'closeup', 'test square', 'granule', 'matting', 'bruise', 'hail mark', 'wind mark', 'chalk'],
  ridge: ['ridge', 'hip', 'cap shingle', 'ridge cap'],
  valley: ['valley'],
  pipe_jack: ['pipe jack', 'pipe boot', 'flashing', 'vent pipe'],
  vent: ['vent', 'turtle vent', 'box vent'],
  gutter: ['gutter', 'downspout'],
  soft_metal: ['soft metal', 'fascia', 'metal', 'flashing', 'vent', 'gutter'],
  interior_leak: ['interior leak', 'water stain', 'leak', 'moisture', 'staining'],
  attic: ['attic', 'rafter', 'decking'],
  ceiling: ['ceiling', 'drywall', 'sheetrock'],
  collateral: ['fence', 'screen', 'window screen', 'collateral', 'garage door'],
}

const REPORT_CONDITION_KEYWORDS: Record<string, string[]> = {
  hail_indicator: ['hail', 'impact', 'bruise', 'marking', 'mark', 'chalk', 'dent'],
  wind_indicator: ['wind', 'lifted', 'creased', 'folded', 'missing shingle', 'blown off'],
  missing_shingle: ['missing shingle', 'missing tab', 'blown off'],
  creased_shingle: ['creased', 'crease'],
  granule_loss: ['granule', 'loss', 'matting'],
  dented_gutter: ['dented gutter', 'gutter dent', 'downspout dent', 'soft metal dent'],
  active_water_entry: ['leak', 'water entry', 'water stain', 'moisture', 'staining'],
  no_issue_observed: ['no visible damage', 'good condition', 'no issue'],
}

function normalizedWords(values?: unknown): string[] {
  if (Array.isArray(values)) return values.map(v => String(v || '').toLowerCase().trim()).filter(Boolean)
  if (typeof values === 'string') return values.toLowerCase().split(/[,\n]/).map(v => v.trim()).filter(Boolean)
  return []
}

function documentSearchText(doc: any) {
  const extracted = safeJson<Record<string, unknown>>(doc.extractedData, {})
  return [
    doc.originalName,
    doc.fileType,
    doc.aiCategory,
    doc.aiSummary,
    doc.ocrText,
    extracted?.summary,
    extracted?.description,
    extracted?.documentType,
    Array.isArray(extracted?.tags) ? extracted.tags.join(' ') : '',
  ].filter(Boolean).join(' ').toLowerCase()
}

function keywordScore(text: string, keywords: string[]) {
  let score = 0
  for (const keyword of keywords) {
    if (text.includes(keyword)) score += keyword.includes(' ') ? 3 : 1
  }
  return score
}

function inferPhotoCategory(text: string, requestedCategories: string[]) {
  for (const requested of requestedCategories) {
    if ((CATEGORY_LABELS as Map<string, string>).has(requested)) return requested
    const match = ROOF_REPORT_CATEGORIES.find(c => c.label.toLowerCase() === requested || c.label.toLowerCase().includes(requested))
    if (match) return match.key
  }
  let best = { key: 'other', score: 0 }
  for (const [key, words] of Object.entries(REPORT_PHOTO_KEYWORDS)) {
    const score = keywordScore(text, words)
    if (score > best.score) best = { key, score }
  }
  return best.key
}

function inferPhotoCondition(text: string, requestedConditions: string[]) {
  for (const requested of requestedConditions) {
    if ((ROOF_REPORT_CONDITIONS as readonly string[]).includes(requested)) return requested
  }
  let best = { key: 'other', score: 0 }
  for (const [key, words] of Object.entries(REPORT_CONDITION_KEYWORDS)) {
    const score = keywordScore(text, words)
    if (score > best.score) best = { key, score }
  }
  return best.score ? best.key : 'other'
}

function inferPhotoSeverity(condition: string, text: string) {
  if (condition === 'active_water_entry') return 'significant_concern'
  if (['hail_indicator', 'wind_indicator', 'missing_shingle', 'creased_shingle', 'dented_gutter'].includes(condition)) return 'repair_recommended'
  if (text.includes('severe') || text.includes('immediate')) return 'significant_concern'
  if (condition === 'no_issue_observed') return 'informational'
  return 'monitor'
}

function photoCandidateCaption(doc: any, category: string, condition: string) {
  const summary = String(doc.aiSummary || '').trim()
  if (summary) return summary.length > 180 ? `${summary.slice(0, 177)}...` : summary
  return generatePhotoCaption({ category, condition, severity: inferPhotoSeverity(condition, '') })
}

export async function reviewRoofReportCandidatePhotos(ctx: TenantContext, input: {
  reportId?: string
  projectId?: string
  customerId?: string
  query?: string
  categories?: string[]
  conditions?: string[]
  limit?: number
}) {
  const limit = Math.max(1, Math.min(Number(input.limit || 30), 80))
  let report: any = null
  if (input.reportId) {
    report = await db.roofReport.findFirst({ where: { id: input.reportId, contractorId: ctx.contractorId } })
    if (!report) throw new Error('Roof report not found')
  } else if (input.projectId || input.customerId) {
    report = await db.roofReport.findFirst({
      where: {
        contractorId: ctx.contractorId,
        ...(input.projectId ? { projectId: input.projectId } : {}),
        ...(input.customerId && !input.projectId ? { customerId: input.customerId } : {}),
      },
      orderBy: { updatedAt: 'desc' },
    })
  }

  const projectId = input.projectId || report?.projectId || undefined
  const customerId = input.customerId || report?.customerId || undefined
  const workspace = projectId
    ? await db.workspace.findFirst({ where: { contractorId: ctx.contractorId, projectId }, select: { id: true } }).catch(() => null)
    : null
  const typeFilter = [{ fileType: 'photo' }, { mimeType: { startsWith: 'image/' } }]
  const where: any = {
    contractorId: ctx.contractorId,
    OR: typeFilter,
  }
  const associationFilter = [
    projectId ? { projectId } : null,
    customerId ? { customerId } : null,
    workspace?.id ? { workspaceId: workspace.id } : null,
  ].filter(Boolean)
  if (associationFilter.length) {
    delete where.OR
    where.AND = [{ OR: typeFilter }, { OR: associationFilter }]
  }

  const docs = await db.document.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }],
    take: Math.min(160, Math.max(limit * 3, 30)),
    select: {
      id: true,
      originalName: true,
      mimeType: true,
      size: true,
      filePath: true,
      thumbnailPath: true,
      fileType: true,
      aiCategory: true,
      aiSummary: true,
      extractedData: true,
      ocrText: true,
      status: true,
      customerId: true,
      projectId: true,
      workspaceId: true,
      createdAt: true,
    },
  })

  const attached = report?.id
    ? await db.roofReportPhoto.findMany({ where: { contractorId: ctx.contractorId, reportId: report.id } })
    : []
  const attachedByDocument = new Map(attached.filter((p: any) => p.documentId).map((p: any) => [p.documentId, p]))
  const requestedCategories = normalizedWords(input.categories)
  const requestedConditions = normalizedWords(input.conditions)
  const queryWords = normalizedWords(input.query)
  const query = String(input.query || '').toLowerCase()

  const photos = docs.map((doc: any) => {
    const text = documentSearchText(doc)
    const attachedPhoto = attachedByDocument.get(doc.id) as any | undefined
    const suggestedCategory = attachedPhoto?.category || inferPhotoCategory(`${query} ${text}`, requestedCategories)
    const suggestedCondition = attachedPhoto?.condition || inferPhotoCondition(`${query} ${text}`, requestedConditions)
    const suggestedSeverity = attachedPhoto?.severity || inferPhotoSeverity(suggestedCondition, text)
    const directQueryScore = queryWords.length ? queryWords.reduce((sum, word) => sum + (text.includes(word) ? 2 : 0), 0) : 0
    const categoryScore = suggestedCategory !== 'other' ? keywordScore(text, REPORT_PHOTO_KEYWORDS[suggestedCategory] || []) : 0
    const conditionScore = suggestedCondition !== 'other' ? keywordScore(text, REPORT_CONDITION_KEYWORDS[suggestedCondition] || []) : 0
    const matchScore = directQueryScore + categoryScore + conditionScore + (attachedPhoto?.isIncluded !== false ? 4 : 0)
    const alreadyAttached = Boolean(attachedPhoto)
    const defaultSelected = alreadyAttached ? attachedPhoto?.isIncluded !== false : Boolean(queryWords.length ? matchScore > 0 : false)
    const url = toFileUrl(doc.filePath)
    const thumbnailUrl = doc.thumbnailPath ? toThumbnailUrl(doc.thumbnailPath) : url
    return {
      documentId: doc.id,
      reportPhotoId: attachedPhoto?.id ?? null,
      originalName: doc.originalName,
      fileType: doc.fileType,
      mimeType: doc.mimeType,
      size: doc.size,
      status: doc.status,
      url,
      thumbnailUrl,
      summary: doc.aiSummary || null,
      suggestedCategory,
      suggestedCategoryLabel: CATEGORY_LABELS.get(suggestedCategory as any) || humanize(suggestedCategory),
      suggestedCondition,
      suggestedSeverity,
      caption: attachedPhoto?.caption || photoCandidateCaption(doc, suggestedCategory, suggestedCondition),
      alreadyAttached,
      isIncluded: attachedPhoto?.isIncluded !== false,
      defaultSelected,
      matchScore,
      createdAt: doc.createdAt,
    }
  }).sort((a, b) => Number(b.defaultSelected) - Number(a.defaultSelected) || b.matchScore - a.matchScore || new Date(String(b.createdAt)).getTime() - new Date(String(a.createdAt)).getTime()).slice(0, limit)

  const selectedCount = photos.filter(p => p.defaultSelected).length
  const alreadyAttachedCount = photos.filter(p => p.alreadyAttached).length
  return {
    cardType: 'report_photo_picker',
    reportId: report?.id ?? input.reportId ?? null,
    projectId: projectId ?? null,
    customerId: customerId ?? null,
    title: report?.title || 'Roof report photos',
    query: input.query || null,
    totalFound: docs.length,
    shownCount: photos.length,
    selectedCount,
    alreadyAttachedCount,
    guidance: report?.id
      ? 'Select the photos that belong in this report. Removing a photo here only removes it from the report; it does not delete the saved file.'
      : 'Select report photos after creating or choosing a roof report.',
    photos,
  }
}

export async function updateRoofReportPhotoSelection(ctx: TenantContext, reportId: string, input: {
  includeDocumentIds?: string[]
  excludeDocumentIds?: string[]
  includeReportPhotoIds?: string[]
  excludeReportPhotoIds?: string[]
}) {
  const report = await db.roofReport.findFirst({ where: { id: reportId, contractorId: ctx.contractorId } })
  if (!report) throw new Error('Roof report not found')
  let added = 0
  let included = 0
  let excluded = 0
  const includeDocumentIds = Array.from(new Set((input.includeDocumentIds || []).filter(Boolean)))
  if (includeDocumentIds.length) {
    const existing = await db.roofReportPhoto.findMany({
      where: { contractorId: ctx.contractorId, reportId, documentId: { in: includeDocumentIds } },
      select: { documentId: true },
    })
    const existingIds = new Set(existing.map(p => p.documentId).filter(Boolean) as string[])
    const missing = includeDocumentIds.filter(id => !existingIds.has(id))
    if (missing.length) {
      const docs = await db.document.findMany({ where: { contractorId: ctx.contractorId, id: { in: missing } } })
      const candidates = docs.map((doc: any, i) => {
        const text = documentSearchText(doc)
        const category = inferPhotoCategory(text, [])
        const condition = inferPhotoCondition(text, [])
        return {
          documentId: doc.id,
          category,
          condition,
          severity: inferPhotoSeverity(condition, text),
          caption: photoCandidateCaption(doc, category, condition),
          sortOrder: i,
        }
      })
      const created = await bulkAddPhotosToRoofReport(ctx, reportId, candidates)
      added += created.length
    }
    const result = await db.roofReportPhoto.updateMany({
      where: { contractorId: ctx.contractorId, reportId, documentId: { in: includeDocumentIds } },
      data: { isIncluded: true },
    })
    included += result.count
  }

  const includeReportPhotoIds = Array.from(new Set((input.includeReportPhotoIds || []).filter(Boolean)))
  if (includeReportPhotoIds.length) {
    const result = await db.roofReportPhoto.updateMany({
      where: { contractorId: ctx.contractorId, reportId, id: { in: includeReportPhotoIds } },
      data: { isIncluded: true },
    })
    included += result.count
  }

  const excludeDocumentIds = Array.from(new Set((input.excludeDocumentIds || []).filter(Boolean)))
  if (excludeDocumentIds.length) {
    const result = await db.roofReportPhoto.updateMany({
      where: { contractorId: ctx.contractorId, reportId, documentId: { in: excludeDocumentIds } },
      data: { isIncluded: false },
    })
    excluded += result.count
  }

  const excludeReportPhotoIds = Array.from(new Set((input.excludeReportPhotoIds || []).filter(Boolean)))
  if (excludeReportPhotoIds.length) {
    const result = await db.roofReportPhoto.updateMany({
      where: { contractorId: ctx.contractorId, reportId, id: { in: excludeReportPhotoIds } },
      data: { isIncluded: false },
    })
    excluded += result.count
  }

  await updateRoofReportChecklist(ctx.contractorId, reportId)
  return {
    added,
    included,
    excluded,
    workspace: await getRoofReportWorkspace(ctx, reportId),
  }
}

export async function getRoofReportWorkspace(ctx: TenantContext, reportId: string) {
  const report = await db.roofReport.findFirst({
    where: { id: reportId, contractorId: ctx.contractorId },
    include: { photos: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } },
  })
  if (!report) return null
  const checklist = buildPhotoChecklist(report)
  const score = scoreReport(report, checklist)
  const warnings = [
    ...checklist.missingRequired.map(key => `Missing required photo: ${CATEGORY_LABELS.get(key) || humanize(key)}`),
    ...(score < 70 ? ['Report is not ready for customer-facing use yet.'] : []),
  ]
  return {
    report: {
      ...report,
      observedConditions: asArray(safeJson(report.observedConditionsJson, [])),
      recommendations: asArray(safeJson(report.recommendationsJson, [])),
      photoChecklist: safeJson(report.photoChecklistJson, checklist.checklist),
      missingPhotoChecklist: safeJson(report.missingPhotoChecklistJson, [...checklist.missingRequired, ...checklist.missingRecommended]),
      printUrl: `/api/roof-reports/${report.id}/print`,
      shareUrl: report.shareToken ? `/reports/share/${report.shareToken}` : null,
      pdfUrl: report.reportPdfDocumentId ? `/api/storage/docs/${path.basename(report.reportPdfPath || '')}` : null,
    },
    categories: ROOF_REPORT_CATEGORIES,
    conditions: ROOF_REPORT_CONDITIONS,
    severities: ROOF_REPORT_SEVERITIES,
    checklist,
    groupedPhotos: groupPhotos(report.photos),
    readyScore: score,
    warnings,
    suggestedNarrative: generateNarrativeFromReport(report),
  }
}

export async function updateRoofReportChecklist(contractorId: string, reportId: string) {
  const report = await db.roofReport.findFirst({ where: { id: reportId, contractorId }, include: { photos: true } })
  if (!report) return null
  const checklist = buildPhotoChecklist(report)
  return db.roofReport.update({
    where: { id: reportId },
    data: {
      photoChecklistJson: JSON.stringify(checklist.checklist),
      missingPhotoChecklistJson: JSON.stringify([...checklist.missingRequired, ...checklist.missingRecommended]),
    },
    include: { photos: { orderBy: { sortOrder: 'asc' } } },
  })
}

export async function bulkAddPhotosToRoofReport(ctx: TenantContext, reportId: string, photos: Array<any>) {
  const report = await db.roofReport.findFirst({ where: { id: reportId, contractorId: ctx.contractorId } })
  if (!report) throw new Error('Report not found')
  const created: any[] = []
  for (let i = 0; i < photos.length; i++) {
    const p = photos[i]
    let imageUrl = p.imageUrl
    let existingPhoto: any = null
    if (p.documentId) {
      const doc = await db.document.findFirst({ where: { id: p.documentId, contractorId: ctx.contractorId } })
      if (!doc) continue
      imageUrl = toFileUrl(doc.filePath)
      existingPhoto = await db.roofReportPhoto.findFirst({ where: { contractorId: ctx.contractorId, reportId, documentId: doc.id } })
      await linkDocumentToJobPacket({
        contractorId: ctx.contractorId,
        documentId: doc.id,
        projectId: report.projectId,
        customerId: report.customerId,
        entityType: 'roof_report',
        entityId: report.id,
        role: 'report_photo',
        label: p.caption || doc.originalName,
        source: 'system',
        metadata: { reportId, category: p.category || 'other' },
      })
    }
    if (existingPhoto) {
      const updated = await db.roofReportPhoto.update({
        where: { id: existingPhoto.id },
        data: {
          imageUrl: imageUrl || existingPhoto.imageUrl,
          category: p.category || existingPhoto.category || 'other',
          area: p.area ?? existingPhoto.area,
          condition: p.condition ?? existingPhoto.condition,
          severity: p.severity || existingPhoto.severity || 'informational',
          caption: p.caption || existingPhoto.caption || generatePhotoCaption(p),
          notes: p.notes ?? existingPhoto.notes,
          tagsJson: Array.isArray(p.tags) ? JSON.stringify(p.tags) : p.tagsJson ?? existingPhoto.tagsJson,
          isIncluded: p.isIncluded ?? true,
          isCoverPhoto: p.isCoverPhoto ?? existingPhoto.isCoverPhoto,
          takenAt: p.takenAt ? new Date(p.takenAt) : existingPhoto.takenAt,
          sortOrder: typeof p.sortOrder === 'number' ? p.sortOrder : existingPhoto.sortOrder,
        },
      })
      created.push(updated)
      continue
    }
    const photo = await db.roofReportPhoto.create({
      data: {
        contractorId: ctx.contractorId,
        reportId,
        documentId: p.documentId,
        imageUrl,
        category: p.category || 'other',
        area: p.area,
        condition: p.condition,
        severity: p.severity || 'informational',
        caption: p.caption || generatePhotoCaption(p),
        notes: p.notes,
        tagsJson: Array.isArray(p.tags) ? JSON.stringify(p.tags) : p.tagsJson,
        aiCaptionStatus: p.caption ? 'reviewed' : 'ai_suggested',
        isIncluded: p.isIncluded ?? true,
        isCoverPhoto: p.isCoverPhoto ?? false,
        takenAt: p.takenAt ? new Date(p.takenAt) : undefined,
        sortOrder: typeof p.sortOrder === 'number' ? p.sortOrder : i,
      },
    })
    created.push(photo)
  }
  await updateRoofReportChecklist(ctx.contractorId, reportId)
  await logProjectActivity({
    contractorId: ctx.contractorId,
    projectId: report.projectId,
    userId: ctx.user?.id,
    activityType: 'ROOF_REPORT_PHOTOS_ADDED',
    title: `${created.length} roof report photo${created.length === 1 ? '' : 's'} added`,
    relatedType: 'roof_report',
    relatedId: report.id,
    metadata: { count: created.length },
  })
  return created
}

export async function generateRoofReportSummary(ctx: TenantContext, reportId: string) {
  const report = await db.roofReport.findFirst({ where: { id: reportId, contractorId: ctx.contractorId }, include: { photos: true } })
  if (!report) throw new Error('Report not found')
  const narrative = generateNarrativeFromReport(report)
  const updated = await db.roofReport.update({
    where: { id: reportId },
    data: {
      propertyReviewSummary: narrative.summary,
      observedConditionsJson: JSON.stringify(narrative.observed),
      recommendationsJson: JSON.stringify(narrative.recommendations),
      conclusion: narrative.conclusion,
      status: report.status === 'draft' ? 'ready' : report.status,
    },
    include: { photos: { orderBy: { sortOrder: 'asc' } } },
  })
  await logProjectActivity({
    contractorId: ctx.contractorId,
    projectId: updated.projectId,
    userId: ctx.user?.id,
    activityType: 'ROOF_REPORT_SUMMARY_GENERATED',
    title: `Roof report summary drafted: ${updated.title}`,
    relatedType: 'roof_report',
    relatedId: updated.id,
    source: 'system',
  })
  await postRoofReportCardToThread({ contractorId: ctx.contractorId, report: updated, content: `Roof report summary drafted for ${updated.title}.` })
  return updated
}

export async function finalizeRoofReport(ctx: TenantContext, reportId: string) {
  const report = await db.roofReport.findFirst({ where: { id: reportId, contractorId: ctx.contractorId }, include: { photos: true } })
  if (!report) throw new Error('Report not found')
  const checklist = buildPhotoChecklist(report)
  const status = checklist.missingRequired.length ? 'ready' : 'finalized'
  const updated = await db.roofReport.update({
    where: { id: reportId },
    data: {
      status,
      finalizedAt: status === 'finalized' ? new Date() : report.finalizedAt,
      completedAt: status === 'finalized' ? new Date() : report.completedAt,
      photoChecklistJson: JSON.stringify(checklist.checklist),
      missingPhotoChecklistJson: JSON.stringify([...checklist.missingRequired, ...checklist.missingRecommended]),
    },
    include: { photos: { orderBy: { sortOrder: 'asc' } } },
  })
  await logProjectActivity({
    contractorId: ctx.contractorId,
    projectId: updated.projectId,
    userId: ctx.user?.id,
    activityType: status === 'finalized' ? 'ROOF_REPORT_FINALIZED' : 'ROOF_REPORT_READY',
    title: `${status === 'finalized' ? 'Roof report finalized' : 'Roof report marked ready'}: ${updated.title}`,
    relatedType: 'roof_report',
    relatedId: updated.id,
    metadata: { missingRequired: checklist.missingRequired, missingRecommended: checklist.missingRecommended },
  })
  await postRoofReportCardToThread({ contractorId: ctx.contractorId, report: updated, content: `${updated.title} is ${status === 'finalized' ? 'finalized' : 'ready for review'}.` })
  return updated
}

export async function shareRoofReport(ctx: TenantContext, reportId: string) {
  const existing = await db.roofReport.findFirst({ where: { id: reportId, contractorId: ctx.contractorId } })
  if (!existing) throw new Error('Report not found')
  const report = await db.roofReport.update({
    where: { id: reportId },
    data: { shareToken: existing.shareToken ?? makeShareToken('rpt'), status: existing.status === 'draft' ? 'shared' : existing.status },
    include: { photos: { orderBy: { sortOrder: 'asc' } } },
  })
  await postRoofReportCardToThread({ contractorId: ctx.contractorId, report, content: `Share link is ready for ${report.title}.` })
  return { report, shareToken: report.shareToken, shareUrl: `/reports/share/${report.shareToken}` }
}

export async function createRoofReportPdf(ctx: TenantContext, reportId: string) {
  const report = await db.roofReport.findFirst({ where: { id: reportId, contractorId: ctx.contractorId }, include: { photos: { orderBy: { sortOrder: 'asc' } } } })
  if (!report) throw new Error('Report not found')
  const profile = await getContractorProfile(ctx.contractorId)
  const html = renderRoofReportHtml(report, profile)
  const pdf = createSimplePdfBuffer(report.title || 'Roof Report', htmlToPlainText(html), 'Roof report PDF generated by Jobrolo. Photos are referenced in the report and available in the job packet.')
  const filename = `${safeFileStem(report.title)}-${randomBytes(4).toString('hex')}.pdf`
  const stored = await saveFile({ buffer: pdf, filename, mimeType: 'application/pdf', directory: 'docs' })
  const document = await db.document.create({
    data: {
      contractorId: ctx.contractorId,
      projectId: report.projectId ?? undefined,
      customerId: report.customerId ?? undefined,
      filename: stored.filename,
      originalName: `${report.title} — roof report.pdf`,
      mimeType: 'application/pdf',
      size: stored.size,
      filePath: stored.filePath,
      fileType: 'roof_report_pdf',
      aiCategory: 'roof_report',
      aiSummary: `PDF snapshot for roof report ${report.title}`,
      status: 'ready',
      uploadedById: ctx.user?.id ?? undefined,
    },
  })
  await linkDocumentToJobPacket({
    contractorId: ctx.contractorId,
    documentId: document.id,
    projectId: report.projectId,
    customerId: report.customerId,
    entityType: 'roof_report',
    entityId: report.id,
    role: 'attachment',
    label: 'Roof report PDF',
    source: 'system',
    metadata: { reportId: report.id, pdfVariant: 'roof_report' },
  })
  const updated = await db.roofReport.update({ where: { id: report.id }, data: { reportPdfPath: document.filePath, reportPdfDocumentId: document.id, status: report.status === 'draft' ? 'ready' : report.status } })
  await createProjectTimelineEvent({
    contractorId: ctx.contractorId,
    projectId: report.projectId,
    customerId: report.customerId,
    eventType: 'roof_report_pdf_created',
    title: `Roof report PDF created: ${report.title}`,
    relatedType: 'roof_report',
    relatedId: report.id,
    actorUserId: ctx.user?.id,
    source: 'system',
    metadata: { documentId: document.id },
  })
  await postRoofReportCardToThread({ contractorId: ctx.contractorId, report: { ...report, reportPdfDocumentId: document.id, reportPdfPath: document.filePath }, content: `Roof report PDF is ready for ${report.title}.` })
  return { report: updated, pdfDocument: document, pdfUrl: stored.url }
}

async function postRoofReportCardToThread(input: { contractorId: string; report: any; content: string }) {
  if (!input.report?.projectId) return null
  const workspace = await db.workspace.findFirst({ where: { contractorId: input.contractorId, projectId: input.report.projectId }, include: { chats: { where: { chatType: 'main' }, take: 1 } } })
  const chat = workspace?.chats?.[0]
  if (!chat) return null
  return db.workspaceMessage.create({
    data: {
      chatId: chat.id,
      role: 'assistant',
      content: input.content,
      contextType: 'roof_report',
      contextData: JSON.stringify({
        cardType: 'roof_report',
        id: input.report.id,
        title: input.report.title,
        status: input.report.status,
        projectId: input.report.projectId,
        customerId: input.report.customerId,
        photoCount: Array.isArray(input.report.photos) ? input.report.photos.length : undefined,
        printUrl: `/api/roof-reports/${input.report.id}/print`,
        shareUrl: input.report.shareToken ? `/reports/share/${input.report.shareToken}` : null,
        pdfUrl: input.report.reportPdfDocumentId ? `/api/storage/docs/${path.basename(input.report.reportPdfPath || '')}` : null,
      }),
    },
  }).catch(() => null)
}
