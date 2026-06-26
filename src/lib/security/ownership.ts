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

export function hasCompanyWideAccess(ctx: TenantContext) {
  if (!ctx.user) return true
  return ['owner', 'admin', 'manager', 'project_manager'].includes(String(ctx.user.role ?? '').toLowerCase())
}

export function canAccessWorkspaceChat(ctx: TenantContext, chat: { chatType?: string | null; visibility?: string | null }) {
  if (hasCompanyWideAccess(ctx)) return true
  const role = String(ctx.user?.role ?? '').toLowerCase()
  const chatType = String(chat.chatType ?? '').toLowerCase()
  const visibility = String(chat.visibility ?? '').toLowerCase()
  if (role === 'customer') return visibility === 'customer' || chatType === 'customer'
  if (role === 'crew' || role === 'subcontractor') return chatType === 'crew'
  if (role === 'sales') return ['sales', 'customer', 'main'].includes(chatType)
  if (role === 'employee') return ['main', 'production', 'crew'].includes(chatType)
  return chatType === 'main'
}

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------
export async function requireWorkspace(ctx: TenantContext, workspaceId: string) {
  return db.workspace.findFirst({
    where: {
      id: workspaceId,
      contractorId: ctx.contractorId,
      ...(hasCompanyWideAccess(ctx) ? {} : { members: { some: { userId: ctx.user?.id ?? '__none__' } } }),
    },
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
  const chat = await db.workspaceChat.findFirst({
    where: { id: chatId, workspaceId },
  })
  if (!chat) return null
  if (!canAccessWorkspaceChat(ctx, chat)) return null
  return chat
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------
export async function requireProject(ctx: TenantContext, projectId: string) {
  return db.project.findFirst({
    where: {
      id: projectId,
      contractorId: ctx.contractorId,
      ...(hasCompanyWideAccess(ctx) ? {} : { workspace: { members: { some: { userId: ctx.user?.id ?? '__none__' } } } }),
    },
  })
}

// ---------------------------------------------------------------------------
// Customer
// ---------------------------------------------------------------------------
export async function requireCustomer(ctx: TenantContext, customerId: string) {
  return db.customer.findFirst({
    where: {
      id: customerId,
      contractorId: ctx.contractorId,
      ...(hasCompanyWideAccess(ctx) ? {} : {
        OR: [
          { workspace: { members: { some: { userId: ctx.user?.id ?? '__none__' } } } },
          { projects: { some: { workspace: { members: { some: { userId: ctx.user?.id ?? '__none__' } } } } } },
        ],
      }),
    },
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
        ...(hasCompanyWideAccess(ctx) ? [{ contractorId: ctx.contractorId }] : []),
        { project: { contractorId: ctx.contractorId, ...(hasCompanyWideAccess(ctx) ? {} : { workspace: { members: { some: { userId: ctx.user?.id ?? '__none__' } } } }) } },
        { customer: { contractorId: ctx.contractorId, ...(hasCompanyWideAccess(ctx) ? {} : { projects: { some: { workspace: { members: { some: { userId: ctx.user?.id ?? '__none__' } } } } } }) } },
        { workspace: { contractorId: ctx.contractorId, ...(hasCompanyWideAccess(ctx) ? {} : { members: { some: { userId: ctx.user?.id ?? '__none__' } } }) } },
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
  if (!hasCompanyWideAccess(ctx)) return null
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
