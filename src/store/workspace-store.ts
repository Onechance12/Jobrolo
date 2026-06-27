import { create } from 'zustand'
import type { ClientMessage, WorkspaceInfo, WorkspaceChatInfo, WorkspaceMemoryItem } from '@/lib/types'

interface WorkspaceState {
  workspaces: WorkspaceInfo[]; currentWorkspaceId: string | null; currentChatId: string | null
  messages: ClientMessage[]; memory: WorkspaceMemoryItem[]
  isLoading: boolean; isTyping: boolean; streamingText: string; sidebarOpen: boolean
  setWorkspaces: (w: WorkspaceInfo[]) => void
  enterWorkspace: (id: string, chatId?: string) => void
  exitWorkspace: () => void
  setCurrentChat: (id: string) => void
  deleteWorkspaceChatLocally: (workspaceId: string, chatId: string, fallbackChatId?: string | null) => void
  setMessages: (m: ClientMessage[]) => void
  addMessage: (m: ClientMessage) => void
  updateMessage: (id: string, u: Partial<ClientMessage>) => void
  updateLastMessage: (u: Partial<ClientMessage>) => void
  setMemory: (m: WorkspaceMemoryItem[]) => void
  setLoading: (l: boolean) => void
  setTyping: (t: boolean) => void
  setStreamingText: (t: string) => void
  clearStreamingText: () => void
  toggleSidebar: () => void
  setSidebarOpen: (o: boolean) => void
  getCurrentWorkspace: () => WorkspaceInfo | null
  getCurrentChat: () => WorkspaceChatInfo | null
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspaces: [], currentWorkspaceId: null, currentChatId: null, messages: [], memory: [], isLoading: false, isTyping: false, streamingText: '', sidebarOpen: true,
  setWorkspaces: (w) => set({ workspaces: w }),
  enterWorkspace: (id, chatId) => {
    const ws = get().workspaces.find(w => w.id === id)
    const mainChat = ws?.chats.find(c => c.chatType === 'main')
    set({ currentWorkspaceId: id, currentChatId: chatId ?? mainChat?.id ?? ws?.chats[0]?.id ?? null, messages: [], memory: [], isTyping: false, streamingText: '' })
  },
  exitWorkspace: () => set({ currentWorkspaceId: null, currentChatId: null, messages: [], memory: [], isTyping: false, streamingText: '' }),
  setCurrentChat: (id) => set({ currentChatId: id, messages: [], isTyping: false, streamingText: '' }),
  deleteWorkspaceChatLocally: (workspaceId, chatId, fallbackChatId) => set((s) => {
    const nextWorkspaces = s.workspaces.map(workspace => {
      if (workspace.id !== workspaceId) return workspace
      const chats = workspace.chats.filter(chat => chat.id !== chatId)
      return { ...workspace, chats, chatCount: chats.length }
    })
    const activeDeleted = s.currentWorkspaceId === workspaceId && s.currentChatId === chatId
    return {
      workspaces: nextWorkspaces,
      currentChatId: activeDeleted ? fallbackChatId ?? nextWorkspaces.find(w => w.id === workspaceId)?.chats[0]?.id ?? null : s.currentChatId,
      messages: activeDeleted ? [] : s.messages,
      isTyping: false,
      streamingText: '',
    }
  }),
  setMessages: (m) => set({ messages: m }),
  addMessage: (m) => set((s) => ({ messages: [...s.messages, m] })),
  updateMessage: (id, u) => set((s) => ({ messages: s.messages.map(m => m.id === id ? { ...m, ...u } : m) })),
  updateLastMessage: (u) => set((s) => { if (!s.messages.length) return s; const m = [...s.messages]; m[m.length - 1] = { ...m[m.length - 1], ...u }; return { messages: m } }),
  setMemory: (m) => set({ memory: m }),
  setLoading: (l) => set({ isLoading: l }),
  setTyping: (t) => set({ isTyping: t }),
  setStreamingText: (t) => set({ streamingText: t }),
  clearStreamingText: () => set({ streamingText: '' }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (o) => set({ sidebarOpen: o }),
  getCurrentWorkspace: () => { const s = get(); return s.workspaces.find(w => w.id === s.currentWorkspaceId) ?? null },
  getCurrentChat: () => { const s = get(); const ws = s.workspaces.find(w => w.id === s.currentWorkspaceId); return ws?.chats.find(c => c.id === s.currentChatId) ?? null },
}))
