import { db } from './db'
import type { AiAction, ActionResult, ChannelType } from './types'

export interface ExecutionContext { workspaceId: string; sourceChatId: string; sourceChatType: ChannelType; contractorId: string; userId?: string }

export async function executeActions(actions: AiAction[], ctx: ExecutionContext): Promise<ActionResult[]> {
  const results: ActionResult[] = []
  for (const action of actions) {
    try {
      const result = await executeOne(action, ctx)
      results.push(result)
      await db.workspaceAction.create({ data: { workspaceId: ctx.workspaceId, type: action.type, status: result.status, detail: result.detail, payload: JSON.stringify(action), sourceChatId: ctx.sourceChatId } }).catch(() => {})
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Unknown error'
      results.push({ action: action.type, status: 'failed', detail: `${action.type} failed: ${detail}` })
    }
  }
  return results
}

async function executeOne(action: AiAction, ctx: ExecutionContext): Promise<ActionResult> {
  switch (action.type) {
    case 'cross_post': {
      if (!action.chatType || !action.message) return { action: 'cross_post', status: 'skipped', detail: 'Missing chatType or message' }
      if (action.chatType === ctx.sourceChatType) return { action: 'cross_post', status: 'skipped', detail: `Already in ${action.chatType}`, targetChatType: action.chatType }
      const target = await db.workspaceChat.findFirst({ where: { workspaceId: ctx.workspaceId, chatType: action.chatType } })
      if (!target) return { action: 'cross_post', status: 'failed', detail: `No ${action.chatType} chat`, targetChatType: action.chatType }
      await db.workspaceMessage.create({ data: { chatId: target.id, role: 'assistant', content: action.message, createdById: ctx.userId } })
      await db.workspaceChat.update({ where: { id: target.id }, data: { lastActivity: new Date() } })
      return { action: 'cross_post', status: 'executed', detail: `Posted to ${action.chatType} chat`, targetChatType: action.chatType }
    }
    case 'memory': {
      if (!action.category || !action.content) return { action: 'memory', status: 'skipped', detail: 'Missing category or content' }
      await db.workspaceMemory.create({ data: { workspaceId: ctx.workspaceId, category: action.category, content: action.content, metadata: action.metadata ? JSON.stringify(action.metadata) : null, source: 'ai', createdById: ctx.userId } })
      return { action: 'memory', status: 'executed', detail: `Memory saved (${action.category})` }
    }
    case 'task': {
      if (!action.title) return { action: 'task', status: 'skipped', detail: 'Missing title' }
      const ws = await db.workspace.findFirst({ where: { id: ctx.workspaceId, contractorId: ctx.contractorId }, select: { projectId: true } })
      if (!ws?.projectId) return { action: 'task', status: 'skipped', detail: 'No project' }
      const t = await db.task.create({ data: { projectId: ws.projectId, title: action.title, description: action.description, priority: action.priority ?? 'medium', dueDate: action.dueDate ? new Date(action.dueDate) : null, createdById: ctx.userId } })
      return { action: 'task', status: 'executed', detail: `Task: ${t.title}` }
    }
    case 'task_update': {
      if (!action.taskId || !action.status) return { action: 'task_update', status: 'skipped', detail: 'Missing taskId or status' }
      // SECURITY: Verify task belongs to a project owned by this contractor
      const task = await db.task.findFirst({
        where: {
          id: action.taskId,
          project: { contractorId: ctx.contractorId },
        },
        select: { id: true, title: true, status: true, projectId: true },
      })
      if (!task) return { action: 'task_update', status: 'failed', detail: 'Task not found' }
      await db.task.update({ where: { id: task.id }, data: { status: action.status, completedAt: action.status === 'completed' ? new Date() : null } })
      await db.workspaceMemory.create({ data: { workspaceId: ctx.workspaceId, category: 'task_update', content: `Task "${task.title}" marked ${action.status}`, metadata: JSON.stringify({ taskId: task.id, oldStatus: task.status, newStatus: action.status }), source: 'ai', createdById: ctx.userId } }).catch(() => {})
      return { action: 'task_update', status: 'executed', detail: `"${task.title}" → ${action.status}` }
    }
    case 'note': {
      if (!action.content) return { action: 'note', status: 'skipped', detail: 'Missing content' }
      const ws = await db.workspace.findFirst({ where: { id: ctx.workspaceId, contractorId: ctx.contractorId }, select: { projectId: true, customerId: true } })
      if (!ws) return { action: 'note', status: 'failed', detail: 'Workspace not found' }
      await db.note.create({ data: { projectId: ws?.projectId, customerId: ws?.customerId, content: action.content, type: action.noteType ?? 'general', isAiGenerated: true, createdById: ctx.userId } })
      return { action: 'note', status: 'executed', detail: `Note saved (${action.noteType ?? 'general'})` }
    }
    default: return { action: action.type as ActionResult['action'], status: 'skipped', detail: `Unknown: ${action.type}` }
  }
}
