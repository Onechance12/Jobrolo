'use client'
import { useWorkspaceStore } from '@/store/workspace-store'
import { getChannelConfig } from '@/lib/channels'
import { cn } from '@/lib/utils'

export function ChannelTabs() {
  const currentWorkspaceId = useWorkspaceStore(s => s.currentWorkspaceId)
  const currentChatId = useWorkspaceStore(s => s.currentChatId)
  const setCurrentChat = useWorkspaceStore(s => s.setCurrentChat)
  const workspaces = useWorkspaceStore(s => s.workspaces)
  const workspace = workspaces.find(w => w.id === currentWorkspaceId)
  if (!workspace || workspace.chats.length <= 1) return null
  return (
    <div className="border-b border-border glass px-2 overflow-x-auto">
      <div className="flex gap-1 min-w-max">
        {workspace.chats.map(chat => {
          const config = getChannelConfig(chat.chatType)
          const active = chat.id === currentChatId
          return (
            <button
              key={chat.id}
              onClick={() => setCurrentChat(chat.id)}
              className={cn(
                'flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 -mb-px whitespace-nowrap min-h-[44px] transition-colors',
                active
                  ? cn(config.color, config.border)
                  : 'text-muted-foreground border-transparent hover:text-foreground hover:border-border'
              )}
            >
              <span className={cn('w-2 h-2 rounded-full transition-colors', active ? cn(config.bg.replace('100', '500')) : 'bg-muted-foreground/30')} />
              {config.label}
              {chat.messageCount > 0 && (
                <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full', active ? cn(config.bg, config.color) : 'bg-muted text-muted-foreground')}>
                  {chat.messageCount}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
