'use client'

import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export type JobroloCardTone = 'blue' | 'cyan' | 'emerald' | 'amber' | 'violet' | 'rose' | 'slate'

const toneStyles: Record<JobroloCardTone, {
  card: string
  header: string
  title: string
  icon: string
  pill: string
  sectionTitle: string
}> = {
  blue: {
    card: 'border-blue-200 bg-blue-50/60 dark:border-blue-900/60 dark:bg-blue-950/20',
    header: 'border-blue-200/70 bg-gradient-to-br from-blue-500/10 via-transparent to-cyan-500/10 dark:border-blue-900/60',
    title: 'text-blue-950 dark:text-blue-100',
    icon: 'border-blue-200 bg-blue-100 text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200',
    pill: 'border-blue-300/70 bg-blue-100/80 text-blue-950 hover:bg-blue-200 dark:border-blue-800/70 dark:bg-blue-950/50 dark:text-blue-100 dark:hover:bg-blue-900/70',
    sectionTitle: 'text-blue-950 dark:text-blue-100',
  },
  cyan: {
    card: 'border-cyan-200 bg-cyan-50/60 dark:border-cyan-900/60 dark:bg-cyan-950/20',
    header: 'border-cyan-200/70 bg-gradient-to-br from-cyan-500/10 via-blue-500/5 to-violet-500/10 dark:border-cyan-900/60',
    title: 'text-cyan-950 dark:text-cyan-100',
    icon: 'border-cyan-200 bg-cyan-100 text-cyan-700 dark:border-cyan-900 dark:bg-cyan-950 dark:text-cyan-200',
    pill: 'border-cyan-300/70 bg-cyan-100/80 text-cyan-950 hover:bg-cyan-200 dark:border-cyan-800/70 dark:bg-cyan-950/50 dark:text-cyan-100 dark:hover:bg-cyan-900/70',
    sectionTitle: 'text-cyan-950 dark:text-cyan-100',
  },
  emerald: {
    card: 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/60 dark:bg-emerald-950/20',
    header: 'border-emerald-200/70 bg-gradient-to-br from-emerald-500/10 via-transparent to-teal-500/10 dark:border-emerald-900/60',
    title: 'text-emerald-950 dark:text-emerald-100',
    icon: 'border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
    pill: 'border-emerald-300/70 bg-emerald-100/80 text-emerald-950 hover:bg-emerald-200 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-100 dark:hover:bg-emerald-900/70',
    sectionTitle: 'text-emerald-950 dark:text-emerald-100',
  },
  amber: {
    card: 'border-amber-200 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/20',
    header: 'border-amber-200/70 bg-gradient-to-br from-amber-500/10 via-transparent to-orange-500/10 dark:border-amber-900/60',
    title: 'text-amber-950 dark:text-amber-100',
    icon: 'border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100',
    pill: 'border-amber-300/70 bg-amber-100/80 text-amber-950 hover:bg-amber-200 dark:border-amber-800/70 dark:bg-amber-950/50 dark:text-amber-100 dark:hover:bg-amber-900/70',
    sectionTitle: 'text-amber-950 dark:text-amber-100',
  },
  violet: {
    card: 'border-violet-200 bg-violet-50/60 dark:border-violet-900/60 dark:bg-violet-950/20',
    header: 'border-violet-200/70 bg-gradient-to-br from-violet-500/10 via-transparent to-fuchsia-500/10 dark:border-violet-900/60',
    title: 'text-violet-950 dark:text-violet-100',
    icon: 'border-violet-200 bg-violet-100 text-violet-700 dark:border-violet-900 dark:bg-violet-950 dark:text-violet-200',
    pill: 'border-violet-300/70 bg-violet-100/80 text-violet-950 hover:bg-violet-200 dark:border-violet-800/70 dark:bg-violet-950/50 dark:text-violet-100 dark:hover:bg-violet-900/70',
    sectionTitle: 'text-violet-950 dark:text-violet-100',
  },
  rose: {
    card: 'border-rose-200 bg-rose-50/60 dark:border-rose-900/60 dark:bg-rose-950/20',
    header: 'border-rose-200/70 bg-gradient-to-br from-rose-500/10 via-transparent to-pink-500/10 dark:border-rose-900/60',
    title: 'text-rose-950 dark:text-rose-100',
    icon: 'border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200',
    pill: 'border-rose-300/70 bg-rose-100/80 text-rose-950 hover:bg-rose-200 dark:border-rose-800/70 dark:bg-rose-950/50 dark:text-rose-100 dark:hover:bg-rose-900/70',
    sectionTitle: 'text-rose-950 dark:text-rose-100',
  },
  slate: {
    card: 'border-slate-200 bg-slate-50/60 dark:border-slate-800/80 dark:bg-slate-950/30',
    header: 'border-slate-200/70 bg-gradient-to-br from-slate-500/10 via-transparent to-blue-500/5 dark:border-slate-800/80',
    title: 'text-slate-950 dark:text-slate-100',
    icon: 'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200',
    pill: 'border-slate-300/70 bg-slate-100/80 text-slate-950 hover:bg-slate-200 dark:border-slate-700/70 dark:bg-slate-900/80 dark:text-slate-100 dark:hover:bg-slate-800',
    sectionTitle: 'text-slate-950 dark:text-slate-100',
  },
}

export type JobroloPromptPill = {
  label: string
  prompt: string
  tone?: JobroloCardTone
  disabled?: boolean
}

export function insertJobroloCardPrompt(text: string) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('jobrolo:insert-prompt', { detail: { text } }))
}

export function JobroloCard({
  tone = 'blue',
  title,
  subtitle,
  badge,
  icon,
  hero,
  children,
  footer,
  className,
}: {
  tone?: JobroloCardTone
  title: ReactNode
  subtitle?: ReactNode
  badge?: ReactNode
  icon?: ReactNode
  hero?: ReactNode
  children: ReactNode
  footer?: ReactNode
  className?: string
}) {
  const styles = toneStyles[tone]
  return (
    <Card className={cn('mt-2 w-full overflow-hidden shadow-sm sm:max-w-xl', styles.card, className)}>
      <CardHeader className={cn('border-b p-3 sm:p-4', styles.header)}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {hero ?? (icon ? <div className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border', styles.icon)}>{icon}</div> : null)}
            <div className="min-w-0">
              <CardTitle className={cn('truncate text-base', styles.title)}>{title}</CardTitle>
              {subtitle ? <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{subtitle}</p> : null}
            </div>
          </div>
          {badge ? <Badge variant="secondary" className="shrink-0 text-[10px]">{badge}</Badge> : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 p-3 text-sm sm:p-4">{children}</CardContent>
      {footer ? <CardFooter className="flex flex-wrap gap-2 border-t bg-background/60 p-3 sm:px-4 sm:py-2.5">{footer}</CardFooter> : null}
    </Card>
  )
}

export function JobroloCardSection({
  title,
  eyebrow,
  action,
  children,
  tone = 'slate',
  className,
}: {
  title?: ReactNode
  eyebrow?: ReactNode
  action?: ReactNode
  children: ReactNode
  tone?: JobroloCardTone
  className?: string
}) {
  return (
    <section className={cn('rounded-xl border bg-background/70 p-3', className)}>
      {(title || eyebrow || action) ? (
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {eyebrow ? <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{eyebrow}</div> : null}
            {title ? <div className={cn('text-sm font-semibold', toneStyles[tone].sectionTitle)}>{title}</div> : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}

export function JobroloFactGrid({ children, columns = 2 }: { children: ReactNode; columns?: 2 | 3 | 4 }) {
  return (
    <div className={cn(
      'grid gap-2 text-xs',
      columns === 2 && 'sm:grid-cols-2',
      columns === 3 && 'grid-cols-3',
      columns === 4 && 'grid-cols-2 sm:grid-cols-4',
    )}>
      {children}
    </div>
  )
}

export function JobroloFact({ label, value, hint, icon, className }: { label: ReactNode; value: ReactNode; hint?: ReactNode; icon?: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-xl border bg-background/70 p-2', className)}>
      <div className="mb-0.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{icon}{label}</div>
      <div className="break-words font-semibold text-foreground">{value}</div>
      {hint ? <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div> : null}
    </div>
  )
}

export function JobroloPromptPills({ pills, tone = 'blue', className }: { pills: JobroloPromptPill[]; tone?: JobroloCardTone; className?: string }) {
  if (!pills.length) return null
  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {pills.map(pill => {
        const pillTone = pill.tone ?? tone
        return (
          <button
            key={`${pill.label}-${pill.prompt}`}
            type="button"
            disabled={pill.disabled}
            onClick={() => insertJobroloCardPrompt(pill.prompt)}
            className={cn(
              'rounded-full border px-2.5 py-1 text-[11px] font-semibold shadow-[0_0_18px_-12px_currentColor] transition hover:shadow-[0_0_24px_-10px_currentColor] disabled:pointer-events-none disabled:opacity-50',
              toneStyles[pillTone].pill,
            )}
          >
            {pill.label}
          </button>
        )
      })}
    </div>
  )
}

export function JobroloCardFooterActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-2">{children}</div>
}

export function JobroloPromptButton({ label, prompt, tone = 'blue', variant = 'outline' }: { label: ReactNode; prompt: string; tone?: JobroloCardTone; variant?: 'default' | 'outline' | 'secondary' | 'ghost' }) {
  return (
    <Button size="sm" variant={variant} className={cn('rounded-full', variant === 'outline' && toneStyles[tone].pill)} onClick={() => insertJobroloCardPrompt(prompt)}>
      {label}
    </Button>
  )
}
