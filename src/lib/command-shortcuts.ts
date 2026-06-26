export type CommandShortcutIcon =
  | 'attention'
  | 'building'
  | 'globe'
  | 'field'
  | 'client'
  | 'job'
  | 'crew'
  | 'customer'
  | 'invite'
  | 'template'
  | 'roof'
  | 'file'

export type CommandShortcut = {
  id: string
  label: string
  prompt: string
  icon?: CommandShortcutIcon
}

export const COMMAND_SHORTCUTS_KEY = 'jobrolo:command-shortcuts:v2'
export const LEGACY_CUSTOM_SHORTCUTS_KEY = 'jobrolo:custom-command-shortcuts:v1'
export const COMMAND_SHORTCUTS_UPDATED_EVENT = 'jobrolo:command-shortcuts-updated'

export const DEFAULT_COMMAND_SHORTCUTS: CommandShortcut[] = [
  { id: 'needs-attention', label: 'Needs attention', prompt: 'What needs attention?', icon: 'attention' },
  { id: 'saved-clients', label: 'Saved clients', prompt: 'Show saved clients.', icon: 'client' },
  { id: 'company-info', label: 'Company profile', prompt: 'Show my saved company profile.', icon: 'building' },
  { id: 'update-company', label: 'Update company info', prompt: 'Update my company profile: company name, phone, email, website, and address are ', icon: 'building' },
  { id: 'research-website', label: 'Research website', prompt: 'Research my company website and suggest updates to my company profile: ', icon: 'globe' },
  { id: 'field', label: 'Field', prompt: 'Help me in the field where I am right now. If I am at a job, brief me and help me log the visit. If I just landed an inspection, use my location, research the property if configured, confirm the owner/address with me, then start the inspection photo workflow.', icon: 'field' },
  { id: 'create-client', label: 'Create client', prompt: 'Create a client named ', icon: 'client' },
  { id: 'create-job', label: 'Create job', prompt: 'Create a project/job for ', icon: 'job' },
  { id: 'create-crew-chat', label: 'Create crew chat', prompt: 'Create a crew chat for ', icon: 'crew' },
  { id: 'create-customer-chat', label: 'Create customer chat', prompt: 'Create a customer-facing chat for ', icon: 'customer' },
  { id: 'invite-to-chat', label: 'Invite to chat', prompt: 'Invite this person to the chat and give me a copyable link: name, email, phone, role are ', icon: 'invite' },
  { id: 'template-from-chat', label: 'Start template', prompt: 'Turn an uploaded document into a reusable template.', icon: 'template' },
  { id: 'roof-report', label: 'Start roof report', prompt: 'Start a roof report from chat. Ask me which customer/project and photos to use.', icon: 'roof' },
]

function cleanShortcut(item: any, fallbackId: string): CommandShortcut | null {
  const label = String(item?.label ?? '').trim()
  const prompt = String(item?.prompt ?? '').trim()
  if (!label || !prompt) return null
  return {
    id: String(item?.id ?? fallbackId).trim() || fallbackId,
    label: label.slice(0, 60),
    prompt: prompt.slice(0, 2000),
    icon: item?.icon,
  }
}

export function parseStoredCommandShortcuts(raw: string | null, legacyRaw?: string | null): CommandShortcut[] {
  try {
    const parsed = raw ? JSON.parse(raw) : null
    if (Array.isArray(parsed)) {
      const cleaned = parsed
        .map((item, index) => cleanShortcut(item, `custom-${index}`))
        .filter(Boolean) as CommandShortcut[]
      return cleaned.slice(0, 24)
    }
  } catch {}

  const merged = [...DEFAULT_COMMAND_SHORTCUTS]
  try {
    const legacy = legacyRaw ? JSON.parse(legacyRaw) : null
    if (Array.isArray(legacy)) {
      for (const item of legacy) {
        const shortcut = cleanShortcut(item, `legacy-${merged.length}`)
        if (shortcut && !merged.some(existing => existing.prompt === shortcut.prompt)) merged.unshift(shortcut)
      }
    }
  } catch {}
  return merged.slice(0, 24)
}

export function makeCommandShortcut(label: string, prompt: string, icon: CommandShortcutIcon = 'file'): CommandShortcut {
  return {
    id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    label: label.trim().slice(0, 60),
    prompt: prompt.trim().slice(0, 2000),
    icon,
  }
}
