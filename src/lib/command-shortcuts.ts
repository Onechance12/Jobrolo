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
  { id: 'update-company', label: 'Update company info', prompt: 'Make edits to company profile: ', icon: 'building' },
  { id: 'research-website', label: 'Research', prompt: 'Research my company online and suggest missing company profile updates. Show what is new before saving. Website or company name: ', icon: 'globe' },
  { id: 'open-map', label: 'Open map', prompt: 'Open the Jobrolo field command map. Show saved pins, nearby leads, GPS evidence, and field actions without creating a new lead or session.', icon: 'field' },
  { id: 'field', label: 'Field check-in', prompt: 'Help me in the field where I am right now. If I am at a job, brief me and help me log the visit. If I just landed an inspection, use my location, research the property if configured, confirm the owner/address with me, then start the inspection photo workflow.', icon: 'field' },
  { id: 'canvassing-run', label: 'Canvassing run', prompt: 'Start a canvassing run. Ask me what street or territory, what kind of run I want, and keep it chat-native unless I ask for the map.', icon: 'field' },
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

function mergeDefaultShortcutUpdates(shortcuts: CommandShortcut[]) {
  const defaultsById = new Map(DEFAULT_COMMAND_SHORTCUTS.map(shortcut => [shortcut.id, shortcut]))
  const requiredDefaults = ['open-map', 'field', 'canvassing-run']
  const next = shortcuts.map(shortcut => {
    if (shortcut.id === 'field' && shortcut.label.trim().toLowerCase() === 'field') {
      return { ...shortcut, label: defaultsById.get('field')?.label ?? 'Field check-in' }
    }
    return shortcut
  })

  for (const id of requiredDefaults) {
    if (next.some(shortcut => shortcut.id === id)) continue
    const shortcut = defaultsById.get(id)
    if (!shortcut) continue
    const anchorId = id === 'open-map' ? 'research-website' : id === 'canvassing-run' ? 'field' : 'open-map'
    const anchorIndex = next.findIndex(item => item.id === anchorId)
    next.splice(anchorIndex >= 0 ? anchorIndex + 1 : Math.min(next.length, 5), 0, shortcut)
  }

  return next.slice(0, 24)
}

export function parseStoredCommandShortcuts(raw: string | null, legacyRaw?: string | null): CommandShortcut[] {
  try {
    const parsed = raw ? JSON.parse(raw) : null
    if (Array.isArray(parsed)) {
      const cleaned = parsed
        .map((item, index) => cleanShortcut(item, `custom-${index}`))
        .filter(Boolean) as CommandShortcut[]
      return mergeDefaultShortcutUpdates(cleaned)
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
