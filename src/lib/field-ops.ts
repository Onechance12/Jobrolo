import { randomBytes } from 'node:crypto'
import { db } from '@/lib/db'
import { createProjectTimelineEvent } from '@/lib/project-context'
import { renderCompanyHeaderHtml } from '@/lib/contractor-profile'
import type { TenantContext } from '@/lib/security/context'

export type AppointmentType =
  | 'inspection'
  | 'adjuster_meeting'
  | 'production'
  | 'material_delivery'
  | 'walkthrough'
  | 'call'
  | 'other'

export const PROJECT_STAGE_ORDER = [
  'lead',
  'inspection_scheduled',
  'inspected',
  'claim_filed',
  'adjuster_meeting_scheduled',
  'waiting_scope',
  'scope_review',
  'supplement_needed',
  'approved',
  'contract_signed',
  'material_ordered',
  'production_scheduled',
  'in_production',
  'final_inspection',
  'invoiced',
  'closed',
] as const

export function makeShareToken(prefix = 'jbr'): string {
  return `${prefix}_${randomBytes(18).toString('base64url')}`
}

export function normalizeDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export async function ensureProjectSchedule(ctx: TenantContext, projectId: string) {
  const project = await db.project.findFirst({ where: { id: projectId, contractorId: ctx.contractorId } })
  if (!project) return null

  return db.projectSchedule.upsert({
    where: { contractorId_projectId: { contractorId: ctx.contractorId, projectId } },
    update: {},
    create: { contractorId: ctx.contractorId, projectId, stage: 'lead' },
  })
}

export async function logProjectActivity(input: {
  contractorId: string
  projectId?: string | null
  userId?: string | null
  activityType: string
  title: string
  body?: string | null
  metadata?: unknown
  relatedType?: string | null
  relatedId?: string | null
  source?: string
}) {
  if (!input.projectId) return null
  const activity = await db.projectActivity.create({
    data: {
      contractorId: input.contractorId,
      projectId: input.projectId,
      userId: input.userId ?? undefined,
      activityType: input.activityType,
      title: input.title,
      body: input.body ?? undefined,
      source: input.source ?? 'system',
      relatedType: input.relatedType ?? undefined,
      relatedId: input.relatedId ?? undefined,
      metadataJson: input.metadata ? JSON.stringify(input.metadata) : undefined,
    },
  }).catch(() => null)

  await createProjectTimelineEvent({
    contractorId: input.contractorId,
    projectId: input.projectId,
    eventType: input.activityType.toLowerCase(),
    title: input.title,
    body: input.body,
    relatedType: input.relatedType,
    relatedId: input.relatedId,
    actorUserId: input.userId,
    source: input.source ?? 'system',
    metadata: input.metadata,
  })

  return activity
}

export function defaultRoofReportDisclaimer(): string {
  return 'This roof report documents visible conditions observed at the time of inspection. It is not a determination of insurance coverage, carrier liability, code compliance, or claim approval. Hidden damage, latent defects, and conditions not visible during inspection may exist. Final scope, pricing, and coverage decisions should be verified through the applicable contract, estimate, carrier documents, and local requirements.'
}

export function renderRoofReportHtml(report: any, contractorProfile?: any): string {
  const photos = Array.isArray(report.photos) ? report.photos.filter((p: any) => p.isIncluded !== false) : []
  const observed = safeJsonArray(report.observedConditionsJson)
  const recommendations = safeJsonArray(report.recommendationsJson)

  const photoHtml = photos.map((photo: any, index: number) => `
    <section class="photo-card">
      ${photo.imageUrl ? `<img src="${escapeHtml(photo.imageUrl)}" alt="Report photo ${index + 1}" />` : ''}
      <div class="photo-meta">
        <strong>Photo ${index + 1}: ${escapeHtml(photo.category || 'Other')}</strong>
        ${photo.area ? `<p><b>Area:</b> ${escapeHtml(photo.area)}</p>` : ''}
        <p><b>Condition:</b> ${escapeHtml(photo.condition || 'Not specified')}</p>
        <p><b>Severity:</b> ${escapeHtml(photo.severity || 'Informational')}</p>
        ${photo.caption ? `<p><b>Caption:</b> ${escapeHtml(photo.caption)}</p>` : ''}
        ${photo.notes ? `<p><b>Notes:</b> ${escapeHtml(photo.notes)}</p>` : ''}
      </div>
    </section>
  `).join('\n')

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(report.title || 'Roof Report')}</title>
  <style>
    :root { color-scheme: light; --blue:#0ea5e9; --navy:#0f172a; --muted:#64748b; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--navy); background: #f8fafc; }
    main { max-width: 920px; margin: 0 auto; padding: 40px 24px; background: white; min-height: 100vh; }
    .hero { border-bottom: 3px solid var(--blue); padding-bottom: 24px; margin-bottom: 28px; }
    h1 { font-size: 40px; margin: 0 0 8px; letter-spacing: -0.04em; }
    h2 { margin-top: 32px; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; }
    .meta { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 10px 24px; color: #334155; }
    .meta div { border: 1px solid #e2e8f0; padding: 12px; border-radius: 12px; background: #f8fafc; }
    .list { padding-left: 20px; }
    .photo-card { page-break-inside: avoid; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; margin: 18px 0; background: #fff; }
    .photo-card img { width: 100%; max-height: 520px; object-fit: cover; display: block; background: #e2e8f0; }
    .photo-meta { padding: 16px; }
    .disclaimer { color: var(--muted); font-size: 13px; border-top: 1px solid #e2e8f0; margin-top: 36px; padding-top: 18px; }
    @media print { body { background: white; } main { padding: 20px; } .no-print { display:none; } }
  </style>
</head>
<body>
  <main>
    <div class="no-print" style="text-align:right;margin-bottom:16px;"><button onclick="window.print()">Print / Save PDF</button></div>
    ${renderCompanyHeaderHtml(contractorProfile)}
    <header class="hero">
      <h1>${escapeHtml(report.title || 'Roof Report')}</h1>
      <p>${escapeHtml(report.propertyAddress || '')}</p>
    </header>

    <section class="meta">
      <div><b>Client</b><br />${escapeHtml(report.clientName || 'Not specified')}</div>
      <div><b>Inspection Date</b><br />${formatDate(report.inspectionDate)}</div>
      <div><b>Inspector</b><br />${escapeHtml(report.inspectorName || 'Not specified')}</div>
      <div><b>Claim #</b><br />${escapeHtml(report.claimNumber || 'Not specified')}</div>
    </section>

    ${report.introduction ? `<h2>Introduction</h2><p>${escapeHtml(report.introduction)}</p>` : ''}
    ${report.propertyReviewSummary ? `<h2>Property Review Summary</h2><p>${escapeHtml(report.propertyReviewSummary)}</p>` : ''}
    ${report.internalNotes ? `<div class="no-print" style="margin:16px 0;padding:12px;border:1px dashed #cbd5e1;border-radius:12px;color:#64748b;font-size:12px;"><b>Internal notes are hidden from customer-facing print/share.</b></div>` : ''}

    <h2>Observed Conditions</h2>
    ${observed.length ? `<ul class="list">${observed.map(item => `<li>${escapeHtml(String(item))}</li>`).join('')}</ul>` : '<p>No observed conditions have been added yet.</p>'}

    <h2>Recommendations</h2>
    ${recommendations.length ? `<ul class="list">${recommendations.map(item => `<li>${escapeHtml(String(item))}</li>`).join('')}</ul>` : '<p>No recommendations have been added yet.</p>'}

    ${report.conclusion ? `<h2>Conclusion</h2><p>${escapeHtml(report.conclusion)}</p>` : ''}

    <h2>Photo Documentation</h2>
    ${photoHtml || '<p>No photos have been added yet.</p>'}

    <section class="disclaimer"><b>Disclaimer:</b> ${escapeHtml(report.disclaimer || contractorProfile?.reportDisclaimer || defaultRoofReportDisclaimer())}</section>
    ${contractorProfile?.legalFooter ? `<section class="disclaimer">${escapeHtml(contractorProfile.legalFooter)}</section>` : ''}
  </main>
</body>
</html>`
}

function safeJsonArray(value?: string | null): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) return parsed.map(String)
    if (typeof parsed === 'string') return [parsed]
    return []
  } catch {
    return value.split('\n').map(s => s.trim()).filter(Boolean)
  }
}

function formatDate(value?: string | Date | null): string {
  const date = normalizeDate(value)
  if (!date) return 'Not specified'
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
