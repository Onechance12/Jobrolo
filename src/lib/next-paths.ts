import { buildActiveJobroloContext } from './jobrolo-context'
import type { SkillRoutingContext } from './skills/types'

export type JobroloNextPath = {
  id: string
  label: string
  prompt: string
  reason: string
  priority: number
  requiresApproval?: boolean
}

function pushUnique(paths: JobroloNextPath[], path: JobroloNextPath) {
  const existing = paths.find(item => item.id === path.id)
  if (!existing) {
    paths.push(path)
    return
  }
  if (path.priority > existing.priority) Object.assign(existing, path)
}

export function suggestJobroloNextPaths(context: SkillRoutingContext): JobroloNextPath[] {
  const paths: JobroloNextPath[] = []
  const active = buildActiveJobroloContext(context)
  const upload = context.uploadClassification
  const intent = context.requestIntent
  const brain = context.brain
  const text = context.normalizedText || ''

  if (upload) {
    if (upload.needsClarification) {
      pushUnique(paths, {
        id: 'clarify-upload',
        label: 'Clarify upload',
        prompt: upload.suggestedPrompt ?? 'Is this reusable company material, or is it for a specific customer/job?',
        reason: upload.reason,
        priority: 100,
      })
    } else if (upload.route === 'company_pricing') {
      pushUnique(paths, {
        id: 'review-price-rows',
        label: 'Review price rows',
        prompt: 'Review the first 10 rows from this company price sheet before importing anything.',
        reason: 'Company pricing should be reviewed before import.',
        priority: 92,
        requiresApproval: true,
      })
    } else if (upload.route === 'brand_asset') {
      pushUnique(paths, {
        id: 'confirm-brand-asset',
        label: 'Use as logo',
        prompt: 'Use this uploaded image as my company logo after I approve it.',
        reason: 'Brand assets should be confirmed before updating company-facing documents.',
        priority: 88,
        requiresApproval: true,
      })
    } else if (upload.projectLevel && !active.hasProject) {
      pushUnique(paths, {
        id: 'resolve-project-for-upload',
        label: 'Pick job',
        prompt: 'Which customer or project should this upload be attached to?',
        reason: 'Project-level upload has no resolved project context.',
        priority: 86,
      })
    }
  }

  if (intent?.id === 'field_observation' || intent?.id === 'field_inspection' || brain?.signals.some(signal => signal.id === 'field_context')) {
    pushUnique(paths, {
      id: 'save-field-observation',
      label: 'Save field note',
      prompt: 'Save this as a field observation with my current GPS and ask before converting it to a customer or job.',
      reason: 'Field evidence should be captured before conversion.',
      priority: 82,
    })
    pushUnique(paths, {
      id: 'start-inspection-workflow',
      label: 'Start inspection',
      prompt: 'Start an inspection workflow here, capture GPS, and show the first photo checklist.',
      reason: 'Inspection workflow needs a persistent field context.',
      priority: 78,
    })
  }

  if (intent?.id === 'customer_project_inventory' || /saved clients?|customer file|project file|show files/.test(text)) {
    pushUnique(paths, {
      id: 'show-file-hub',
      label: 'Open file hub',
      prompt: 'Show a grouped customer/project file card with photos, documents, company pricing candidates, and action pills.',
      reason: 'Flat lists get messy; grouped file cards keep context clear.',
      priority: 76,
    })
  }

  if (intent?.id === 'cody_review' || brain?.mode === 'cody') {
    pushUnique(paths, {
      id: 'continue-cody',
      label: 'Continue Cody',
      prompt: 'Ask Cody to summarize the exact issue, evidence, likely files, and test checklist.',
      reason: 'Cody should create Codex-ready debugging packets.',
      priority: 90,
    })
  }

  if (brain?.signals.some(signal => signal.id === 'company_context')) {
    pushUnique(paths, {
      id: 'complete-company-profile',
      label: 'Complete profile',
      prompt: 'Show my company profile card with missing setup items and suggested chat prompts to complete them.',
      reason: 'Company profile completeness affects estimates, reports, invoices, contracts, and signatures.',
      priority: 74,
    })
  }

  if (brain?.signals.some(signal => signal.id === 'next_step_needed')) {
    pushUnique(paths, {
      id: 'choose-next-path',
      label: 'Pick next path',
      prompt: 'Based on saved context, give me the next 2 or 3 useful paths and what each one unlocks.',
      reason: 'User asked for direction rather than one narrow action.',
      priority: 72,
    })
  }

  return paths.sort((a, b) => b.priority - a.priority).slice(0, 5)
}

export function renderJobroloNextPaths(paths: JobroloNextPath[]) {
  if (!paths.length) return ''
  return paths
    .slice(0, 4)
    .map(path => `Next path: ${path.label} — ${path.reason} Prompt: "${path.prompt}"${path.requiresApproval ? ' Approval may be required.' : ''}`)
    .join('\n')
}
