import { db } from './db'
export interface LogActivityOptions { contractorId?: string; userId?: string; body?: string; metadataJson?: string; relatedId?: string; relatedType?: string; source?: 'user' | 'ai' | 'system' | 'carrier' | 'customer' | 'subcontractor' }
export async function logActivity(projectId: string, activityType: string, title: string, options: LogActivityOptions = {}): Promise<void> {
  try {
    let contractorId = options.contractorId
    if (!contractorId) { const p = await db.project.findUnique({ where: { id: projectId }, select: { contractorId: true } }); contractorId = p?.contractorId }
    if (!contractorId) return
    await db.projectActivity.create({ data: { projectId, contractorId, userId: options.userId ?? null, activityType, title, body: options.body ?? null, metadataJson: options.metadataJson ?? null, relatedId: options.relatedId ?? null, relatedType: options.relatedType ?? null, source: options.source ?? 'user' } })
  } catch (err) { console.error('[logActivity] Failed:', err) }
}
export const ACTIVITY_TYPES = { PROJECT_CREATED: 'project_created', STAGE_CHANGED: 'stage_changed', INSPECTION_COMPLETED: 'inspection_completed', PHOTO_UPLOADED: 'photo_uploaded', SCOPE_UPLOADED: 'scope_uploaded', SCOPE_ANALYZED: 'scope_analyzed', CLAIM_FILED: 'claim_filed', ADJUSTER_ASSIGNED: 'adjuster_assigned', WORK_ORDER_GENERATED: 'work_order_generated', MATERIAL_ORDERED: 'material_ordered', PRODUCTION_STARTED: 'production_started', PRODUCTION_COMPLETED: 'production_completed', SUPPLEMENT_SUBMITTED: 'supplement_submitted', INVOICE_GENERATED: 'invoice_generated', PAYMENT_RECEIVED: 'payment_received', CUSTOMER_CONTACTED: 'customer_contacted', NOTE_ADDED: 'note_added', AI_RECOMMENDATION: 'ai_recommendation', DOCUMENT_UPLOADED: 'document_uploaded', DOCUMENT_ANALYZED: 'document_analyzed', PRICE_SHEET_UPLOADED: 'price_sheet_uploaded', SIGNATURE_COMPLETED: 'signature_completed' } as const
