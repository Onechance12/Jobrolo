// =============================================================================
// Ownership Helpers — reusable contractor-scoped resource accessors
// =============================================================================
// Every function here returns the record ONLY if it belongs to ctx.contractorId.
// Returns null otherwise — callers should return 404 (not 403) to avoid
// confirming that a record exists in another tenant.
//
// Usage:
//   const workspace = await requireWorkspace(ctx, workspaceId)
//   if (!workspace) return NextResponse.json({ error: 'Not found' }, { status: 404 })
// =============================================================================

import { db } from '@/lib/db'
import type { TenantContext } from './context'

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------
export async function requireWorkspace(ctx: TenantContext, workspaceId: string) {
  return db.workspace.findFirst({
    where: { id: workspaceId, contractorId: ctx.contractorId },
  })
}

// ---------------------------------------------------------------------------
// Workspace Chat — must belong to the specified workspace
// ---------------------------------------------------------------------------
export async function requireWorkspaceChat(ctx: TenantContext, workspaceId: string, chatId: string) {
  // First verify the workspace belongs to the contractor
  const ws = await requireWorkspace(ctx, workspaceId)
  if (!ws) return null
  // Then verify the chat belongs to that workspace
  return db.workspaceChat.findFirst({
    where: { id: chatId, workspaceId },
  })
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------
export async function requireProject(ctx: TenantContext, projectId: string) {
  return db.project.findFirst({
    where: { id: projectId, contractorId: ctx.contractorId },
  })
}

// ---------------------------------------------------------------------------
// Customer
// ---------------------------------------------------------------------------
export async function requireCustomer(ctx: TenantContext, customerId: string) {
  return db.customer.findFirst({
    where: { id: customerId, contractorId: ctx.contractorId },
  })
}

// ---------------------------------------------------------------------------
// Document — may be linked directly to contractor or via project/customer
// ---------------------------------------------------------------------------
export async function requireDocument(ctx: TenantContext, documentId: string) {
  return db.document.findFirst({
    where: {
      id: documentId,
      OR: [
        { contractorId: ctx.contractorId },
        { project: { contractorId: ctx.contractorId } },
        { customer: { contractorId: ctx.contractorId } },
        { workspace: { contractorId: ctx.contractorId } },
      ],
    },
  })
}

// ---------------------------------------------------------------------------
// Task — must belong to a project owned by the contractor
// ---------------------------------------------------------------------------
export async function requireTask(ctx: TenantContext, taskId: string) {
  return db.task.findFirst({
    where: {
      id: taskId,
      project: { contractorId: ctx.contractorId },
    },
  })
}

// ---------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------
export async function requireConversation(ctx: TenantContext, conversationId: string) {
  return db.conversation.findFirst({
    where: { id: conversationId, contractorId: ctx.contractorId },
  })
}

// ---------------------------------------------------------------------------
// Insight
// ---------------------------------------------------------------------------
export async function requireInsight(ctx: TenantContext, insightId: string) {
  return db.insight.findFirst({
    where: { id: insightId, contractorId: ctx.contractorId },
  })
}

// ---------------------------------------------------------------------------
// Note — may be linked to a project or customer owned by the contractor
// ---------------------------------------------------------------------------
export async function requireNote(ctx: TenantContext, noteId: string) {
  return db.note.findFirst({
    where: {
      id: noteId,
      OR: [
        { project: { contractorId: ctx.contractorId } },
        { customer: { contractorId: ctx.contractorId } },
      ],
    },
  })
}

// ---------------------------------------------------------------------------
// FollowUp — must belong to a customer owned by the contractor
// ---------------------------------------------------------------------------
export async function requireFollowUp(ctx: TenantContext, followUpId: string) {
  return db.followUp.findFirst({
    where: {
      id: followUpId,
      customer: { contractorId: ctx.contractorId },
    },
  })
}

// ---------------------------------------------------------------------------
// Estimate — must belong to a customer owned by the contractor
// ---------------------------------------------------------------------------
export async function requireEstimate(ctx: TenantContext, estimateId: string) {
  return db.estimate.findFirst({
    where: {
      id: estimateId,
      customer: { contractorId: ctx.contractorId },
    },
  })
}

// ---------------------------------------------------------------------------
// ScopeAnalysis — must belong to a document owned by the contractor
// ---------------------------------------------------------------------------
export async function requireScopeAnalysis(ctx: TenantContext, scopeAnalysisId: string) {
  return db.scopeAnalysis.findFirst({
    where: {
      id: scopeAnalysisId,
      document: {
        OR: [
          { contractorId: ctx.contractorId },
          { project: { contractorId: ctx.contractorId } },
          { customer: { contractorId: ctx.contractorId } },
        ],
      },
    },
  })
}

// ---------------------------------------------------------------------------
// AgentJob — must belong to the contractor
// ---------------------------------------------------------------------------
export async function requireAgentJob(ctx: TenantContext, jobId: string) {
  return db.agentJob.findFirst({
    where: { id: jobId, contractorId: ctx.contractorId },
  })
}
