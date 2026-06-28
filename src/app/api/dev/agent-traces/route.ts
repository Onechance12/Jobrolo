import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { boundedLimit, requireDevBridge, safeJson } from '@/lib/dev-bridge'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const unauthorized = requireDevBridge(req)
  if (unauthorized) return unauthorized

  const url = new URL(req.url)
  const limit = boundedLimit(url.searchParams.get('limit'), 25, 100)
  const chatId = url.searchParams.get('chatId')
  const conversationId = url.searchParams.get('conversationId')
  const messageId = url.searchParams.get('messageId')

  if (!chatId && !conversationId && !messageId) {
    return NextResponse.json({ error: 'Provide chatId, conversationId, or messageId.' }, { status: 400 })
  }

  const [workspaceMessages, conversationMessages, jobs] = await Promise.all([
    chatId || messageId
      ? db.workspaceMessage.findMany({
          where: messageId ? { id: messageId } : { chatId: chatId ?? undefined },
          orderBy: { createdAt: 'desc' },
          take: limit,
          select: { id: true, chatId: true, role: true, content: true, contextType: true, contextData: true, attachments: true, actionResults: true, createdById: true, createdAt: true },
        }).catch(() => [])
      : Promise.resolve([]),
    conversationId || messageId
      ? db.message.findMany({
          where: messageId ? { id: messageId } : { conversationId: conversationId ?? undefined },
          orderBy: { createdAt: 'desc' },
          take: limit,
          select: { id: true, conversationId: true, role: true, content: true, contextType: true, contextData: true, attachments: true, actionResults: true, createdAt: true },
        }).catch(() => [])
      : Promise.resolve([]),
    db.agentJob.findMany({
      where: {
        OR: [
          ...(chatId ? [{ chatId }] : []),
          ...(conversationId ? [{ conversationId }] : []),
          ...(messageId ? [{ inputJson: { contains: messageId } }, { outputJson: { contains: messageId } }] : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, contractorId: true, type: true, status: true, priority: true, conversationId: true, workspaceId: true, chatId: true, userId: true, heartbeat: true, thinkingJson: true, inputJson: true, outputJson: true, error: true, startedAt: true, completedAt: true, createdAt: true, updatedAt: true },
    }),
  ])

  const messages = [
    ...workspaceMessages.map(message => ({ source: 'workspace_chat', ...message })),
    ...conversationMessages.map(message => ({ source: 'conversation', ...message })),
  ].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())

  return NextResponse.json({
    status: 'ok',
    filters: { chatId, conversationId, messageId, limit },
    messages: messages.map(message => ({
      ...message,
      contextData: safeJson(message.contextData, null),
      attachments: safeJson(message.attachments, []),
      actionResults: safeJson(message.actionResults, []),
    })),
    jobs: jobs.map(job => ({
      id: job.id,
      contractorId: job.contractorId,
      type: job.type,
      status: job.status,
      priority: job.priority,
      conversationId: job.conversationId,
      workspaceId: job.workspaceId,
      chatId: job.chatId,
      userId: job.userId,
      heartbeat: job.heartbeat,
      thinking: safeJson(job.thinkingJson, []),
      input: safeJson(job.inputJson, null),
      output: safeJson(job.outputJson, null),
      error: job.error,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    })),
  })
}
