import { z } from 'zod'
import { db } from '@/lib/db'
import type { TenantContext } from '@/lib/security/context'
import { DEFAULT_COMMAND_SHORTCUTS, type CommandShortcut } from '@/lib/command-shortcuts'

const ICONS = ['attention', 'building', 'globe', 'field', 'client', 'job', 'crew', 'customer', 'invite', 'template', 'roof', 'file'] as const

export const CommandShortcutInputSchema = z.object({
  id: z.string().optional(),
  label: z.string().trim().min(1).max(60),
  prompt: z.string().trim().min(1).max(2000),
  icon: z.enum(ICONS).optional().default('file'),
  group: z.string().trim().max(80).optional().nullable(),
  scope: z.enum(['user', 'company', 'role']).optional().default('user'),
  role: z.string().trim().max(80).optional().nullable(),
  active: z.boolean().optional(),
})

export const CommandShortcutListInputSchema = z.object({
  shortcuts: z.array(CommandShortcutInputSchema).max(48),
  scope: z.enum(['user', 'company', 'role']).optional().default('user'),
})

function canManageCompanyShortcuts(ctx: TenantContext) {
  return ['owner', 'admin', 'manager'].includes(String(ctx.user?.role ?? '').toLowerCase())
}

function defaultShortcutRows(): CommandShortcut[] {
  return DEFAULT_COMMAND_SHORTCUTS
}

function toShortcut(row: {
  id: string
  label: string
  prompt: string
  icon: string | null
}): CommandShortcut {
  return {
    id: row.id,
    label: row.label,
    prompt: row.prompt,
    icon: (row.icon || 'file') as CommandShortcut['icon'],
  }
}

function isShortcutTableMissing(error: unknown) {
  const message = String((error as { message?: unknown })?.message ?? error ?? '')
  return /CommandShortcut|commandshortcut|does not exist|no such table|relation .* does not exist/i.test(message)
}

function fallbackCategory(ctx: TenantContext, scope = 'user', role?: string | null) {
  if (scope === 'company') return 'command_shortcuts:company'
  if (scope === 'role') return `command_shortcuts:role:${role || ctx.user?.role || 'default'}`
  return `command_shortcuts:user:${ctx.user?.id || 'anonymous'}`
}

function parseFallbackShortcuts(raw: string | null | undefined): CommandShortcut[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as { shortcuts?: unknown }
    if (!Array.isArray(parsed.shortcuts)) return []
    return parsed.shortcuts
      .map((item, index) => {
        const shortcut = item as Partial<CommandShortcut>
        if (!shortcut.label || !shortcut.prompt) return null
        return {
          id: shortcut.id || `memory-${index}`,
          label: String(shortcut.label),
          prompt: String(shortcut.prompt),
          icon: (shortcut.icon || 'file') as CommandShortcut['icon'],
        }
      })
      .filter(Boolean) as CommandShortcut[]
  } catch {
    return []
  }
}

function scopedShortcutInput(shortcuts: CommandShortcut[], scope: 'user' | 'company' | 'role' = 'user') {
  return shortcuts.map(shortcut => ({
    id: shortcut.id,
    label: shortcut.label,
    prompt: shortcut.prompt,
    icon: (shortcut.icon || 'file') as z.infer<typeof CommandShortcutInputSchema>['icon'],
    scope,
  }))
}

async function listFallbackShortcuts(ctx: TenantContext, scope = 'user') {
  const role = scope === 'role' ? ctx.user?.role ?? null : null
  const categories = [
    fallbackCategory(ctx, 'company'),
    ...(role ? [fallbackCategory(ctx, 'role', role)] : []),
    fallbackCategory(ctx, scope, role),
  ]
  const memories = await db.contractorMemory.findMany({
    where: { contractorId: ctx.contractorId, category: { in: categories } },
    orderBy: { updatedAt: 'asc' },
    take: 10,
  })
  const shortcuts = memories.flatMap(memory => parseFallbackShortcuts(memory.metadataJson || memory.content))
  if (!shortcuts.length) {
    return { shortcuts: defaultShortcutRows(), persistedCount: 0, source: 'defaults' as const }
  }
  return { shortcuts, persistedCount: shortcuts.length, source: 'memory' as const }
}

async function replaceFallbackShortcuts(ctx: TenantContext, input: z.infer<typeof CommandShortcutListInputSchema>) {
  const scope = input.scope ?? 'user'
  const category = fallbackCategory(ctx, scope, scope === 'role' ? ctx.user?.role : null)
  const payload = {
    shortcuts: input.shortcuts.map((shortcut, index) => ({
      id: shortcut.id || `memory-${Date.now()}-${index}`,
      label: shortcut.label,
      prompt: shortcut.prompt,
      icon: shortcut.icon ?? 'file',
      group: shortcut.group ?? null,
      active: shortcut.active ?? true,
      sortOrder: index,
    })),
    scope,
    savedBy: ctx.user?.id ?? null,
    savedAt: new Date().toISOString(),
  }
  const existing = await db.contractorMemory.findFirst({
    where: { contractorId: ctx.contractorId, category },
    orderBy: { updatedAt: 'desc' },
  })
  if (existing) {
    await db.contractorMemory.update({
      where: { id: existing.id },
      data: {
        content: 'Saved command shortcuts',
        metadataJson: JSON.stringify(payload),
        source: 'user',
      },
    })
  } else {
    await db.contractorMemory.create({
      data: {
        contractorId: ctx.contractorId,
        category,
        content: 'Saved command shortcuts',
        metadataJson: JSON.stringify(payload),
        source: 'user',
      },
    })
  }
  return listFallbackShortcuts(ctx, scope)
}

export async function listCommandShortcuts(ctx: TenantContext) {
  const role = ctx.user?.role ?? null
  let rows: Array<{ id: string; label: string; prompt: string; icon: string | null }> = []
  try {
    rows = await db.commandShortcut.findMany({
      where: {
        contractorId: ctx.contractorId,
        active: true,
        OR: [
          { scope: 'company', userId: null },
          ...(role ? [{ scope: 'role', role }] : []),
          ...(ctx.user?.id ? [{ scope: 'user', userId: ctx.user.id }] : []),
        ],
      },
      orderBy: [{ scope: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
      take: 60,
    })
  } catch (error) {
    if (isShortcutTableMissing(error)) return listFallbackShortcuts(ctx)
    throw error
  }

  if (!rows.length) {
    return { shortcuts: defaultShortcutRows(), persistedCount: 0, source: 'defaults' as const }
  }

  return { shortcuts: rows.map(toShortcut), persistedCount: rows.length, source: 'database' as const }
}

export async function replaceCommandShortcuts(ctx: TenantContext, input: z.infer<typeof CommandShortcutListInputSchema>) {
  const scope = input.scope ?? 'user'
  if (scope !== 'user' && !canManageCompanyShortcuts(ctx)) throw new Error('Only an owner, admin, or manager can manage shared shortcuts')
  const userId = scope === 'user' ? ctx.user?.id : null
  const role = scope === 'role' ? ctx.user?.role ?? input.shortcuts[0]?.role ?? null : null

  try {
    await db.$transaction(async tx => {
      await tx.commandShortcut.deleteMany({
        where: {
          contractorId: ctx.contractorId,
          scope,
          ...(scope === 'user' ? { userId: userId ?? '__none__' } : {}),
          ...(scope === 'role' ? { role: role ?? '__none__' } : {}),
        },
      })

      if (input.shortcuts.length) {
        await tx.commandShortcut.createMany({
          data: input.shortcuts.map((shortcut, index) => ({
            contractorId: ctx.contractorId,
            userId: scope === 'user' ? userId : null,
            scope,
            role: scope === 'role' ? role : null,
            group: shortcut.group ?? undefined,
            label: shortcut.label,
            prompt: shortcut.prompt,
            icon: shortcut.icon ?? 'file',
            sortOrder: index,
            active: shortcut.active ?? true,
            createdById: ctx.user?.id,
          })),
        })
      }
    })
  } catch (error) {
    if (isShortcutTableMissing(error)) return replaceFallbackShortcuts(ctx, input)
    throw error
  }

  return listCommandShortcuts(ctx)
}

export async function createCommandShortcut(ctx: TenantContext, input: z.infer<typeof CommandShortcutInputSchema>) {
  const scope = input.scope ?? 'user'
  if (scope !== 'user' && !canManageCompanyShortcuts(ctx)) throw new Error('Only an owner, admin, or manager can manage shared shortcuts')
  try {
    const count = await db.commandShortcut.count({ where: { contractorId: ctx.contractorId, scope, userId: scope === 'user' ? ctx.user?.id : null } })
    const row = await db.commandShortcut.create({
      data: {
        contractorId: ctx.contractorId,
        userId: scope === 'user' ? ctx.user?.id : null,
        scope,
        role: scope === 'role' ? input.role ?? ctx.user?.role ?? null : null,
        group: input.group ?? undefined,
        label: input.label,
        prompt: input.prompt,
        icon: input.icon ?? 'file',
        sortOrder: count,
        active: input.active ?? true,
        createdById: ctx.user?.id,
      },
    })
    return { shortcut: toShortcut(row), ...(await listCommandShortcuts(ctx)) }
  } catch (error) {
    if (!isShortcutTableMissing(error)) throw error
    const current = await listFallbackShortcuts(ctx, scope)
    const shortcut = {
      id: input.id || `memory-${Date.now()}`,
      label: input.label,
      prompt: input.prompt,
      icon: (input.icon || 'file') as CommandShortcut['icon'],
    }
    const updated = [...current.shortcuts.filter(item => item.id !== shortcut.id), shortcut]
    return { shortcut, ...(await replaceFallbackShortcuts(ctx, { scope, shortcuts: scopedShortcutInput(updated, scope) })) }
  }
}

export async function updateCommandShortcut(ctx: TenantContext, id: string, input: Partial<z.infer<typeof CommandShortcutInputSchema>>) {
  try {
    const existing = await db.commandShortcut.findFirst({ where: { id, contractorId: ctx.contractorId } })
    if (!existing) throw new Error('Shortcut not found')
    if (existing.scope !== 'user' && !canManageCompanyShortcuts(ctx)) throw new Error('Only an owner, admin, or manager can manage shared shortcuts')
    if (existing.scope === 'user' && existing.userId && existing.userId !== ctx.user?.id && !canManageCompanyShortcuts(ctx)) throw new Error('Forbidden')
    const row = await db.commandShortcut.update({
      where: { id },
      data: {
        label: input.label,
        prompt: input.prompt,
        icon: input.icon,
        group: input.group,
        active: input.active,
      },
    })
    return { shortcut: toShortcut(row), ...(await listCommandShortcuts(ctx)) }
  } catch (error) {
    if (!isShortcutTableMissing(error)) throw error
    const current = await listFallbackShortcuts(ctx)
    const existing = current.shortcuts.find(shortcut => shortcut.id === id)
    if (!existing) throw new Error('Shortcut not found')
    const shortcut = {
      ...existing,
      label: input.label ?? existing.label,
      prompt: input.prompt ?? existing.prompt,
      icon: (input.icon ?? existing.icon ?? 'file') as CommandShortcut['icon'],
    }
    const updated = current.shortcuts.map(item => item.id === id ? shortcut : item)
    return { shortcut, ...(await replaceFallbackShortcuts(ctx, { scope: 'user', shortcuts: scopedShortcutInput(updated) })) }
  }
}

export async function deleteCommandShortcut(ctx: TenantContext, id: string) {
  try {
    const existing = await db.commandShortcut.findFirst({ where: { id, contractorId: ctx.contractorId } })
    if (!existing) throw new Error('Shortcut not found')
    if (existing.scope !== 'user' && !canManageCompanyShortcuts(ctx)) throw new Error('Only an owner, admin, or manager can manage shared shortcuts')
    if (existing.scope === 'user' && existing.userId && existing.userId !== ctx.user?.id && !canManageCompanyShortcuts(ctx)) throw new Error('Forbidden')
    await db.commandShortcut.delete({ where: { id } })
    return listCommandShortcuts(ctx)
  } catch (error) {
    if (!isShortcutTableMissing(error)) throw error
    const current = await listFallbackShortcuts(ctx)
    const updated = current.shortcuts.filter(shortcut => shortcut.id !== id)
    return replaceFallbackShortcuts(ctx, { scope: 'user', shortcuts: scopedShortcutInput(updated) })
  }
}

export async function markCommandShortcutUsed(ctx: TenantContext, id: string) {
  await db.commandShortcut.updateMany({
    where: { id, contractorId: ctx.contractorId },
    data: { usageCount: { increment: 1 }, lastUsedAt: new Date() },
  }).catch(() => null)
}
