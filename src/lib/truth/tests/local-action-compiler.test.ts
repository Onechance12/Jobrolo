import {
  canRunLocalActionBeforeAi,
  compileLocalAction,
  localActionDirectResponse,
} from '../compile-local-action'

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export function assertLocalActionCompilerContracts() {
  const cody = compileLocalAction('Cody Cody note: inspection card loses thumbnails after taking photos.')
  assert(cody?.id === 'cody-note', `Cody note should compile as cody-note, got ${cody?.id}`)
  assert(cody.status === 'ready', 'Cody note should be ready when note text is present')
  assert(cody.toolCall?.name === 'record_tester_feedback', `Cody note should call record_tester_feedback, got ${cody.toolCall?.name}`)
  assert(canRunLocalActionBeforeAi(cody), 'Cody note should be eligible for pre-AI execution')

  const lead = compileLocalAction('Create a lead for Natalie Pearson at 486 North Charles St. Phone 777-661-0334.')
  assert(lead?.id === 'create-lead', `Lead should compile as create-lead, got ${lead?.id}`)
  assert(lead.status === 'ready', 'Lead with name should be ready')
  assert(lead.toolCall?.name === 'create_canvassing_lead_at_location', `Lead should call create_canvassing_lead_at_location, got ${lead.toolCall?.name}`)
  assert(lead.toolCall.args.homeownerName === 'Natalie Pearson', `Lead name should parse, got ${String(lead.toolCall.args.homeownerName)}`)
  assert(lead.toolCall.args.address === '486 North Charles St.', `Lead address should parse, got ${String(lead.toolCall.args.address)}`)
  assert(lead.toolCall.args.phone === '777-661-0334', `Lead phone should parse, got ${String(lead.toolCall.args.phone)}`)
  assert(canRunLocalActionBeforeAi(lead), 'Create lead should be eligible for pre-AI execution')

  const inspection = compileLocalAction('I need to start an inspection where I am')
  assert(inspection?.id === 'start-field-inspection', `Inspection should compile as start-field-inspection, got ${inspection?.id}`)
  assert(inspection.status === 'ready', 'Clear inspection command should be ready')
  assert(inspection.toolCall?.name === 'start_field_inspection_lead', `Inspection should call start_field_inspection_lead, got ${inspection.toolCall?.name}`)
  assert(inspection.toolCall.args.searchPropertyInfo === true, 'Inspection should request property search by default')
  assert(Boolean(inspection.blockedTools?.includes('create_customer')), 'Inspection local action should block direct customer creation')
  assert(canRunLocalActionBeforeAi(inspection), 'Start inspection should be eligible for pre-AI execution')

  const scope = compileLocalAction('Save this as a scope of loss for Timothy Disen.', { documentIds: ['doc_123'] })
  assert(scope?.id === 'save-scope-document', `Scope should compile as save-scope-document, got ${scope?.id}`)
  assert(scope.status === 'ready', 'Scope with one document and customer should be ready')
  assert(scope.toolCall?.name === 'create_scope_from_document', `Scope should call create_scope_from_document, got ${scope.toolCall?.name}`)
  assert(scope.toolCall.args.documentId === 'doc_123', 'Scope should pass documentId')
  assert(scope.toolCall.args.customerName === 'Timothy Disen', `Scope customer should parse, got ${String(scope.toolCall.args.customerName)}`)
  assert(scope.toolCall.args.scopeType === 'scope_of_loss', `Scope type should parse, got ${String(scope.toolCall.args.scopeType)}`)
  assert(canRunLocalActionBeforeAi(scope), 'Save scope from uploaded document should be eligible for pre-AI execution')

  const scopeMissing = compileLocalAction('Save this as a scope of loss for Timothy Disen.')
  assert(scopeMissing?.id === 'save-scope-document', `Missing scope should still compile, got ${scopeMissing?.id}`)
  assert(scopeMissing.status === 'needs_context', 'Scope without document should ask for context')
  assert(Boolean(scopeMissing.missingContext?.includes('one uploaded documentId')), 'Scope missing context should include documentId')
  assert(!canRunLocalActionBeforeAi(scopeMissing), 'Needs-context action must not execute before AI')
  assert(Boolean(localActionDirectResponse(scopeMissing)), 'Needs-context action should return a direct local prompt')

  const attach = compileLocalAction('Attach this uploaded photo to Timothy Disen customer file.', { documentIds: ['photo_123'] })
  assert(attach?.id === 'attach-upload-to-customer', `Attach should compile as attach-upload-to-customer, got ${attach?.id}`)
  assert(attach.status === 'ready', 'Attach with one document and customer should be ready')
  assert(attach.toolCall?.name === 'link_document_to_customer', `Attach should call link_document_to_customer, got ${attach.toolCall?.name}`)
  assert(attach.toolCall.args.documentId === 'photo_123', 'Attach should pass documentId')
  assert(attach.toolCall.args.customerName === 'Timothy Disen', `Attach customer should parse, got ${String(attach.toolCall.args.customerName)}`)
  assert(canRunLocalActionBeforeAi(attach), 'Attach upload should be eligible for pre-AI execution when explicit')

  const project = compileLocalAction('Create a project for Timothy Disen')
  assert(project?.id === 'create-project', `Project should compile as create-project, got ${project?.id}`)
  assert(project.status === 'ready', 'Project with customer name should be ready')
  assert(project.toolCall?.name === 'create_project_for_customer', `Project should call create_project_for_customer, got ${project.toolCall?.name}`)
  assert(project.toolCall.args.customerName === 'Timothy Disen', `Project customer should parse, got ${String(project.toolCall.args.customerName)}`)
  assert(project.toolCall.args.generateJobNumber === true, 'Project should generate a job number by default')
  assert(canRunLocalActionBeforeAi(project), 'Create project should be eligible for pre-AI execution when customer is explicit')

  const crewChat = compileLocalAction('Create a roofing crew chat for Timothy Disen')
  assert(crewChat?.id === 'create-project-chat', `Crew chat should compile as create-project-chat, got ${crewChat?.id}`)
  assert(crewChat.status === 'ready', 'Crew chat with customer name should be ready')
  assert(crewChat.toolCall?.name === 'create_project_chat', `Crew chat should call create_project_chat, got ${crewChat.toolCall?.name}`)
  assert(crewChat.toolCall.args.chatType === 'roofing_crew', `Crew chat type should parse, got ${String(crewChat.toolCall.args.chatType)}`)
  assert(canRunLocalActionBeforeAi(crewChat), 'Create crew chat should be eligible for pre-AI execution when destination is explicit')

  const logo = compileLocalAction('Use this uploaded image as my company logo.', { documentIds: ['logo_123'] })
  assert(logo?.id === 'set-company-logo', `Logo should compile as set-company-logo, got ${logo?.id}`)
  assert(logo.status === 'ready', 'Logo with one document should be ready')
  assert(logo.requiresApproval, 'Logo update should be approval-gated')
  assert(logo.toolCall?.name === 'update_contractor_profile', `Logo should call update_contractor_profile, got ${logo.toolCall?.name}`)
  assert(logo.toolCall.args.logoDocumentId === 'logo_123', 'Logo should pass logoDocumentId')
  assert(Boolean(logo.blockedTools?.includes('link_document_to_project')), 'Logo should block project attachment')
  assert(canRunLocalActionBeforeAi(logo), 'Company logo should be eligible for pre-AI approval-gated execution')

  const avatar = compileLocalAction('Use this uploaded image as my profile photo.', { documentIds: ['avatar_123'] })
  assert(avatar?.id === 'set-user-avatar', `Avatar should compile as set-user-avatar, got ${avatar?.id}`)
  assert(avatar.status === 'unsupported', 'Avatar should stay unsupported until a stable user-avatar tool exists')
  assert(Boolean(avatar.blockedTools?.includes('update_contractor_profile')), 'Avatar should not update company profile')
  assert(!canRunLocalActionBeforeAi(avatar), 'Unsupported avatar action must not execute before AI')
  assert(Boolean(localActionDirectResponse(avatar)), 'Unsupported action should return a direct local explanation')

  return true
}

if (process.argv[1]?.endsWith('local-action-compiler.test.ts')) {
  assertLocalActionCompilerContracts()
  console.log('local action compiler contracts passed')
}
