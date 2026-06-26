import { create } from 'zustand'
import type { ClientMessage, ConversationInfo, MessageAttachment } from '@/lib/types'

interface ChatState {
  conversations: ConversationInfo[]; conversationId: string | null; messages: ClientMessage[]
  isTyping: boolean; isStreaming: boolean; streamingText: string; businessContext: string | null
  uploadProgress: Array<{ fileName: string; fileType: string; status: 'uploading' | 'analyzing' | 'done' | 'failed'; message?: string }>
  setConversations: (c: ConversationInfo[]) => void
  setConversationId: (id: string | null) => void
  selectConversation: (id: string | null) => void
  createConversationLocally: (id: string, title?: string) => void
  setMessages: (m: ClientMessage[]) => void
  addMessage: (m: ClientMessage) => void
  updateMessage: (id: string, u: Partial<ClientMessage>) => void
  setTyping: (t: boolean) => void
  setStreaming: (s: boolean) => void
  setStreamingText: (t: string) => void
  clearStreamingText: () => void
  setBusinessContext: (c: string | null) => void
  refreshBusinessContext: () => Promise<void>
  addUploadProgress: (e: any) => void
  updateUploadProgress: (i: number, u: any) => void
  clearUploadProgress: () => void
}

export const useChatStore = create<ChatState>((set) => ({
  conversations: [], conversationId: null, messages: [], isTyping: false, isStreaming: false, streamingText: '', businessContext: null, uploadProgress: [],
  setConversations: (c) => set({ conversations: c }),
  setConversationId: (id) => set({ conversationId: id }),
  selectConversation: (id) => set({ conversationId: id, messages: [], isTyping: false, isStreaming: false, streamingText: '' }),
  createConversationLocally: (id, title) => set((s) => ({ conversations: [{ id, title: title ?? 'New private chat', preview: '', messageCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, ...s.conversations], conversationId: id, messages: [], isTyping: false, isStreaming: false, streamingText: '' })),
  setMessages: (m) => set({ messages: m }),
  addMessage: (m) => set((s) => ({ messages: [...s.messages, m] })),
  updateMessage: (id, u) => set((s) => ({ messages: s.messages.map(m => m.id === id ? { ...m, ...u } : m) })),
  setTyping: (t) => set({ isTyping: t }),
  setStreaming: (s) => set({ isStreaming: s }),
  setStreamingText: (t) => set({ streamingText: t }),
  clearStreamingText: () => set({ streamingText: '' }),
  setBusinessContext: (c) => set({ businessContext: c }),
  refreshBusinessContext: async () => { try { const r = await fetch('/api/data'); if (r.ok) { const d = await r.json(); set({ businessContext: d.businessContext }) } } catch {} },
  addUploadProgress: (e) => set((s) => ({ uploadProgress: [...s.uploadProgress, e] })),
  updateUploadProgress: (i, u) => set((s) => ({ uploadProgress: s.uploadProgress.map((p, idx) => idx === i ? { ...p, ...u } : p) })),
  clearUploadProgress: () => set({ uploadProgress: [] }),
}))
