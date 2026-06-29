import type {
  BuildBrainContextInput,
  JobroloBrainContext,
  JobroloBrainMode,
  JobroloBrainSentiment,
  JobroloBrainSignal,
  JobroloBrainUrgency,
} from './types'

function compact(text: string) {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

function addSignal(signals: JobroloBrainSignal[], signal: JobroloBrainSignal) {
  const existing = signals.find(item => item.id === signal.id)
  if (!existing) {
    signals.push(signal)
    return
  }
  if (signal.confidence > existing.confidence) Object.assign(existing, signal)
}

function inferSentiment(text: string): JobroloBrainSentiment {
  if (/\b(bugged|broken|jacked|stuck|annoying|frustrating|doesn'?t work|wtf|eww|awful|hate|loop)\b/.test(text)) return 'frustrated'
  if (/\b(love|awesome|amazing|let'?s go|fire all cylinders|he'?s alive|bro!|haha)\b/.test(text)) return 'excited'
  if (/\b(idk|not sure|confused|confusion|maybe|how do i|what if)\b/.test(text)) return 'uncertain'
  return 'steady'
}

function inferUrgency(text: string, sentiment: JobroloBrainSentiment): JobroloBrainUrgency {
  if (/\b(p0|urgent|asap|right now|broken|stuck|can'?t|nothing happens|doesn'?t work)\b/.test(text)) return 'high'
  if (sentiment === 'frustrated') return 'high'
  if (/\b(soon|before push|before deploy|needs fixed|fix)\b/.test(text)) return 'normal'
  return 'low'
}

function inferMode(input: BuildBrainContextInput, text: string, signals: JobroloBrainSignal[]): JobroloBrainMode {
  if (input.requestIntentId === 'cody_review' || signals.some(signal => signal.id === 'cody_context')) return 'cody'
  if (input.hasUpload || input.requestIntentId === 'upload_routing' || signals.some(signal => signal.id === 'upload_context')) return 'upload'
  if (input.requestIntentId === 'field_inspection' || input.requestIntentId === 'field_observation' || signals.some(signal => signal.id === 'field_context')) return 'field'
  if (input.requestIntentId === 'company_profile' || input.requestIntentId === 'company_intelligence' || signals.some(signal => signal.id === 'company_context')) return 'company'
  if (input.requestIntentId === 'customer_project_inventory' || input.hasActiveCustomer || input.hasActiveProject || signals.some(signal => signal.id === 'customer_project_context')) return 'customer_project'
  if (/\b(onboarding|sign in|signup|create workspace|join workspace|setup mode|first login)\b/.test(text)) return 'onboarding'
  if (/\b(plan|strategy|game plan|architecture|what should|next path|roadmap)\b/.test(text)) return 'planning'
  if (signals.some(signal => signal.id === 'bug_or_friction')) return 'support'
  return 'command_center'
}

function summarizeMode(mode: JobroloBrainMode, sentiment: JobroloBrainSentiment, urgency: JobroloBrainUrgency) {
  const mood = sentiment === 'frustrated'
    ? 'friction detected'
    : sentiment === 'excited'
      ? 'high-energy build mode'
      : sentiment === 'uncertain'
        ? 'user is exploring/uncertain'
        : 'steady'
  return `${mode.replace(/_/g, ' ')} moment; ${mood}; urgency ${urgency}.`
}

export function detectUserState(input: BuildBrainContextInput): JobroloBrainContext {
  const text = compact(`${input.recentText ?? ''} ${input.normalizedText ?? ''} ${input.latestText ?? ''}`)
  const latest = compact(input.latestText)
  const signals: JobroloBrainSignal[] = []

  if (input.hasUpload || /\b(upload|file|pdf|photo|image|logo|price sheet|scope|estimate|document)\b/.test(latest)) {
    addSignal(signals, {
      id: 'upload_context',
      label: 'Upload / file context',
      confidence: input.hasUpload ? 0.92 : 0.72,
      evidence: 'Latest text or request context references an upload/file/document.',
      instruction: 'Preserve upload intent and classification. If analysis is pending, say saved + processing instead of guessing.',
    })
  }

  if (/\b(cody cody cody|end cody|note to cody|hey cody|codex packet|debug this)\b/.test(text)) {
    addSignal(signals, {
      id: 'cody_context',
      label: 'Cody developer review',
      confidence: 0.98,
      evidence: 'Cody activation or closure phrase detected.',
      instruction: 'Treat as read-only developer feedback. Capture exact wording and recent context; do not mutate customer/job/company records.',
    })
  }

  if (/\b(where i am|current location|gps|walking up|landed an inspection|inspection landed|door knock|field|saw .*damage|no soliciting|renters?)\b/.test(text)) {
    addSignal(signals, {
      id: 'field_context',
      label: 'Field / location context',
      confidence: 0.86,
      evidence: 'Message references field/location/inspection/door context.',
      instruction: 'Treat observations as field evidence first. Attach location only when the user is describing what they are doing/seeing now.',
    })
  }

  if (/\b(onboarding|setup|first login|create workspace|join workspace|sign in|invite code|company setup)\b/.test(text)) {
    addSignal(signals, {
      id: 'setup_context',
      label: 'Setup / onboarding context',
      confidence: 0.82,
      evidence: 'Message references onboarding, sign-in, setup, or workspace join flow.',
      instruction: 'Guide with small choices. Explain capabilities before forcing setup, and do not unlock operational tools until setup/auth is valid.',
    })
  }

  if (/\b(company|business|profile|logo|brand|website|reviews|social|kpi|growth|marketing|online presence)\b/.test(text)) {
    addSignal(signals, {
      id: 'company_context',
      label: 'Company context',
      confidence: 0.78,
      evidence: 'Message references company profile, brand, growth, or public presence.',
      instruction: 'Separate saved company facts from public research and recommendations. Ask before saving researched changes.',
    })
  }

  if (/\b(customer|client|project|job|homeowner|file|scope|crew chat|production|appointment)\b/.test(text) || input.hasActiveCustomer || input.hasActiveProject) {
    addSignal(signals, {
      id: 'customer_project_context',
      label: 'Customer / project context',
      confidence: input.hasActiveCustomer || input.hasActiveProject ? 0.86 : 0.72,
      evidence: 'Message or active context references customer/project/job work.',
      instruction: 'Resolve saved customer/project context before mutations. Never treat contractor company as a customer.',
    })
  }

  if (/\b(bug|broken|loop|nothing happens|doesn'?t work|stuck|wrong|misfire|jacked|awful|ugly|not fitting)\b/.test(text)) {
    addSignal(signals, {
      id: 'bug_or_friction',
      label: 'Bug / friction report',
      confidence: 0.84,
      evidence: 'User is reporting broken behavior or UX friction.',
      instruction: 'Acknowledge the issue directly, avoid generic apologies, and offer a concrete next diagnostic/fix path.',
    })
  }

  if (/\b(what next|next step|what should|recommend|suggest|path|game plan|strategy|where do we go)\b/.test(text)) {
    addSignal(signals, {
      id: 'next_step_needed',
      label: 'Next-step guidance needed',
      confidence: 0.8,
      evidence: 'User is asking for direction rather than a single operation.',
      instruction: 'Offer two or three practical next paths grounded in current saved/contextual state, not generic advice.',
    })
  }

  if (/\b(api|web search|google|maps|twilio|abc supply|srs|qxo|home depot|lowe'?s|render|outside|online)\b/.test(text)) {
    addSignal(signals, {
      id: 'outside_world',
      label: 'External provider context',
      confidence: 0.74,
      evidence: 'Message references external APIs, web search, maps, suppliers, or deployment/provider systems.',
      instruction: 'Check provider readiness before promising live external actions. Name missing provider/config clearly.',
    })
  }

  if (/\b(learn|training|practice|roleplay|coach|development|improve|sales pitch|objection|how do i use)\b/.test(text)) {
    addSignal(signals, {
      id: 'learning_needed',
      label: 'Learning / training need',
      confidence: 0.7,
      evidence: 'Message asks for training, practice, or product usage guidance.',
      instruction: 'For now, explain or guide from current context. Do not invent personal performance insights without saved activity/KPI evidence.',
    })
  }

  const sentiment = inferSentiment(text)
  const urgency = inferUrgency(text, sentiment)
  const mode = inferMode(input, text, signals)
  const suggestedPaths = buildSuggestedPaths(mode, signals)
  const guardrails = buildGuardrails(mode, signals)

  return {
    mode,
    urgency,
    sentiment,
    summary: summarizeMode(mode, sentiment, urgency),
    signals: signals.sort((a, b) => b.confidence - a.confidence).slice(0, 6),
    suggestedPaths,
    guardrails,
  }
}

function buildSuggestedPaths(mode: JobroloBrainMode, signals: JobroloBrainSignal[]) {
  const ids = new Set(signals.map(signal => signal.id))
  const paths: string[] = []
  if (ids.has('bug_or_friction') || mode === 'support') paths.push('Capture a Cody-quality issue packet or offer one concrete workaround.')
  if (ids.has('upload_context')) paths.push('Classify the upload, preserve intent, and ask one destination question only if needed.')
  if (ids.has('field_context')) paths.push('Save field observations as evidence/lead context before converting to customer/job.')
  if (ids.has('company_context')) paths.push('Show saved company facts separately from public research and missing setup items.')
  if (ids.has('next_step_needed')) paths.push('Offer two or three grounded next paths instead of a generic open-ended prompt.')
  if (ids.has('learning_needed')) paths.push('Guide or teach from known context, but defer deep coaching until activity/KPI memory exists.')
  return paths.slice(0, 4)
}

function buildGuardrails(mode: JobroloBrainMode, signals: JobroloBrainSignal[]) {
  const guardrails = [
    'Brain context is situational guidance only; saved database records remain the source of truth.',
    'Do not claim remembered facts unless they come from tools, saved records, or current chat context.',
  ]
  const ids = new Set(signals.map(signal => signal.id))
  if (mode === 'cody' || ids.has('cody_context')) guardrails.push('Cody context is read-only and must not trigger customer/project/company mutations.')
  if (ids.has('field_context')) guardrails.push('Only attach GPS when the user is describing current in-person field activity.')
  if (ids.has('learning_needed')) guardrails.push('Training/development insights require activity/KPI evidence; otherwise provide general guidance.')
  return guardrails.slice(0, 5)
}
