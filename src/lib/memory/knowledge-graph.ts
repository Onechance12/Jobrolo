// =============================================================================
// Knowledge Graph Service — typed entity relations
// Records relationships between customers, projects, documents, users, etc.
// =============================================================================

import { db } from '@/lib/db'

export type EntityType = 'customer' | 'project' | 'document' | 'user' | 'supplier' | 'subcontractor' | 'claim' | 'material' | 'workspace' | 'estimate' | 'task'
export type RelationType =
  | 'owns' | 'works_on' | 'references' | 'supplied' | 'employed_by'
  | 'references_doc' | 'manages' | 'assigned_to' | 'depends_on' | 'created_from'

export async function addRelation(args: {
  contractorId: string
  sourceType: EntityType
  sourceId: string
  relationType: RelationType
  targetType: EntityType
  targetId: string
  metadata?: Record<string, unknown>
  confidence?: number
}) {
  try {
    return await db.entityRelation.upsert({
      where: {
        sourceType_sourceId_relationType_targetType_targetId: {
          sourceType: args.sourceType,
          sourceId: args.sourceId,
          relationType: args.relationType,
          targetType: args.targetType,
          targetId: args.targetId,
        },
      },
      update: {
        confidence: args.confidence ?? 1.0,
        metadataJson: args.metadata ? JSON.stringify(args.metadata) : null,
      },
      create: {
        contractorId: args.contractorId,
        sourceType: args.sourceType,
        sourceId: args.sourceId,
        relationType: args.relationType,
        targetType: args.targetType,
        targetId: args.targetId,
        confidence: args.confidence ?? 1.0,
        metadataJson: args.metadata ? JSON.stringify(args.metadata) : null,
      },
    })
  } catch (err) {
    console.error('[kg] addRelation failed:', err)
  }
}

export async function getRelations(args: {
  contractorId: string
  sourceType?: EntityType
  sourceId?: string
  targetType?: EntityType
  targetId?: string
  relationType?: RelationType
  limit?: number
}) {
  return db.entityRelation.findMany({
    where: {
      contractorId: args.contractorId,
      ...(args.sourceType ? { sourceType: args.sourceType } : {}),
      ...(args.sourceId ? { sourceId: args.sourceId } : {}),
      ...(args.targetType ? { targetType: args.targetType } : {}),
      ...(args.targetId ? { targetId: args.targetId } : {}),
      ...(args.relationType ? { relationType: args.relationType } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: args.limit ?? 50,
  })
}

// Convenience: auto-create relations when entities are created/linked
export async function onCustomerCreated(contractorId: string, customerId: string) {
  await addRelation({
    contractorId,
    sourceType: 'customer', sourceId: customerId,
    relationType: 'employed_by', // customer belongs to contractor
    targetType: 'user', targetId: contractorId, // (using contractorId as the user entity)
    confidence: 1.0,
  })
}

export async function onProjectCreated(contractorId: string, projectId: string, customerId?: string) {
  if (customerId) {
    await addRelation({
      contractorId,
      sourceType: 'customer', sourceId: customerId,
      relationType: 'owns',
      targetType: 'project', targetId: projectId,
    })
  }
}

export async function onDocumentLinked(contractorId: string, documentId: string, projectId?: string, customerId?: string) {
  if (projectId) {
    await addRelation({
      contractorId,
      sourceType: 'project', sourceId: projectId,
      relationType: 'references_doc',
      targetType: 'document', targetId: documentId,
    })
  }
  if (customerId) {
    await addRelation({
      contractorId,
      sourceType: 'customer', sourceId: customerId,
      relationType: 'references_doc',
      targetType: 'document', targetId: documentId,
    })
  }
}

export async function onTaskCreated(contractorId: string, taskId: string, projectId: string) {
  await addRelation({
    contractorId,
    sourceType: 'project', sourceId: projectId,
    relationType: 'depends_on',
    targetType: 'task', targetId: taskId,
  })
}
