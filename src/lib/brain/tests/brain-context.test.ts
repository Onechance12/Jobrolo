import { buildBrainContext, renderBrainInstructions } from '..'

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message)
}

function signalIdsFor(text: string) {
  return buildBrainContext({ latestText: text }).signals.map(signal => signal.id)
}

export function assertBrainContextContracts() {
  const field = buildBrainContext({
    latestText: 'I landed an inspection here and saw missing shingles from the ground.',
    requestIntentId: 'field_inspection',
  })
  assert(field.mode === 'field', `Field context should resolve to field mode, got ${field.mode}`)
  assert(field.signals.some(signal => signal.id === 'field_context'), 'Field context should include field signal')
  assert(field.guardrails.some(rule => rule.includes('GPS')), 'Field context should include GPS guardrail')

  const upload = buildBrainContext({
    latestText: 'I uploaded this logo right after asking about my company logo.',
    hasUpload: true,
  })
  assert(upload.mode === 'upload', `Upload context should resolve to upload mode, got ${upload.mode}`)
  assert(upload.signals.some(signal => signal.id === 'upload_context'), 'Upload context should include upload signal')

  const cody = buildBrainContext({
    latestText: 'Cody Cody Cody the approval button says approved but nothing happens.',
    requestIntentId: 'cody_review',
  })
  assert(cody.mode === 'cody', `Cody context should resolve to cody mode, got ${cody.mode}`)
  assert(cody.guardrails.some(rule => rule.includes('read-only')), 'Cody context should stay read-only')

  const bug = buildBrainContext({
    latestText: 'Bro this loop is broken again and nothing happens.',
  })
  assert(bug.sentiment === 'frustrated', `Bug/friction should detect frustration, got ${bug.sentiment}`)
  assert(bug.urgency === 'high', `Bug/friction should be high urgency, got ${bug.urgency}`)
  assert(bug.signals.some(signal => signal.id === 'bug_or_friction'), 'Bug/friction should include bug signal')

  const nextStep = buildBrainContext({
    latestText: 'Based on what we have built, what should we do next?',
  })
  assert(nextStep.signals.some(signal => signal.id === 'next_step_needed'), 'Next-step request should include guidance signal')
  assert(nextStep.suggestedPaths.some(path => path.includes('grounded next paths')), 'Next-step request should suggest grounded paths')

  const learning = buildBrainContext({
    latestText: 'Help me practice my sales pitch and roleplay homeowner objections.',
  })
  assert(learning.signals.some(signal => signal.id === 'learning_needed'), 'Learning request should be noticed')
  assert(learning.guardrails.some(rule => rule.includes('Training/development insights require activity/KPI evidence')), 'Learning request should not invent performance insights')
  assert(signalIdsFor('Help me practice my sales pitch').includes('learning_needed'), 'Learning signal helper should include learning_needed')

  const rendered = renderBrainInstructions(learning)
  assert(rendered.includes('BRAINSTEM CONTEXT'), 'Rendered brain context should be compactly included')
  assert(rendered.includes('Brain guardrail'), 'Rendered brain context should include guardrails')

  return true
}

if (process.argv[1]?.endsWith('brain-context.test.ts')) {
  assertBrainContextContracts()
  console.log('brain context contracts passed')
}
