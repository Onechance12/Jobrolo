export type ChannelType =
  | 'main'
  | 'customer'
  | 'crew'
  | 'roofing_crew'
  | 'gutter_crew'
  | 'window_crew'
  | 'siding_crew'
  | 'field_crew'
  | 'subcontractor'
  | 'supplier'
  | 'finance'
  | 'management'
  | 'sales'
  | 'insurance'
  | 'production'
export type WorkspaceType = 'project' | 'customer' | 'subcontractor' | 'supplier'
export type ActionType = 'cross_post' | 'memory' | 'task' | 'task_update' | 'note'
export type MemoryCategory = 'summary' | 'decision' | 'key_info' | 'action_item' | 'note' | 'customer_request' | 'material_decision' | 'schedule_change' | 'task_update'

export interface AiAction { type: ActionType; chatType?: ChannelType; message?: string; category?: MemoryCategory; content?: string; metadata?: Record<string, unknown>; title?: string; description?: string; priority?: 'low' | 'medium' | 'high' | 'urgent'; dueDate?: string; taskId?: string; status?: 'open' | 'in_progress' | 'completed' | 'cancelled'; noteType?: string }
export interface ActionResult { action: ActionType; status: 'executed' | 'failed' | 'skipped'; detail: string; targetChatType?: ChannelType }
export interface MessageAttachment { type: 'image' | 'file'; name: string; url: string; thumbnailUrl?: string; mimeType: string; size?: number; documentId?: string; documentStatus?: 'queued' | 'processing' | 'reviewed' | 'failed' | 'needs_ocr' | 'pending_review'; documentType?: string; documentSummary?: string; documentCategory?: string; documentExtractedData?: Record<string, unknown> | null }
export interface ThinkingStep { text: string; toolCalls?: Array<{ name: string; args: Record<string, unknown> }>; toolResults?: Array<{ name: string; success: boolean; summary: string }> }
export interface TaskStep { id: string; description: string; status: 'running' | 'done' | 'failed'; summary?: string }
export interface ClientMessage { id: string; role: 'user' | 'assistant' | 'system'; content: string; contextType?: string; contextData?: Record<string, unknown> | null; attachments?: MessageAttachment[]; actionResults?: ActionResult[]; thinking?: ThinkingStep[]; tasks?: TaskStep[]; createdAt?: string; routedTo?: string[] }
export interface ConversationInfo { id: string; title: string; preview: string; messageCount: number; createdAt: string; updatedAt: string }
export interface WorkspaceChatInfo { id: string; chatType: ChannelType; title: string; visibility?: string; messageCount: number; lastActivity: string; lastMessage?: string }
export interface WorkspaceMemoryItem { id: string; category: MemoryCategory; content: string; metadata?: Record<string, unknown> | null; createdAt: string }
export interface WorkspaceInfo { id: string; name: string; type: WorkspaceType; description?: string | null; color?: string | null; status: string; projectId?: string | null; customerId?: string | null; subcontractorId?: string | null; supplierId?: string | null; chats: WorkspaceChatInfo[]; chatCount: number; lastActivity?: string; project?: { id: string; title: string; status: string; priority: string; address?: string | null; value?: number | null; customer?: { id: string; name: string; phone?: string | null; email?: string | null } | null } | null; customer?: { id: string; name: string; phone?: string | null; email?: string | null; address?: string | null } | null; subcontractor?: { id: string; name: string; company?: string | null; specialty: string; phone?: string | null } | null; recentMemory?: WorkspaceMemoryItem[] }
