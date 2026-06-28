import { buildCodyPacket, extractCodyFeedbackActivation, inferCodyArea, inferCodySeverity } from '../packet'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export function assertCodyPacketContracts() {
  assert(inferCodyArea('Cody Cody Cody PDF upload says saved but never attaches to project') === 'uploads/files', 'upload notes should classify as uploads/files')
  assert(inferCodyArea('Cody Cody Cody the onboarding screen locks me in setup mode') === 'onboarding/auth', 'onboarding notes should classify as onboarding/auth')
  assert(inferCodyArea('Cody Cody Cody approval button does nothing in Action Needed') === 'notifications', 'approval/notification notes should classify as notifications')
  assert(inferCodyArea('company card setup gaps should prompt me to upload agreements and research BBB') === 'company profile', 'company setup/research notes should classify as company profile')
  assert(inferCodySeverity('critical private customer file leaked') === 'urgent', 'security/private-data language should be urgent')
  assert(inferCodySeverity('upload failed and got stuck') === 'high', 'failed/stuck language should be high severity')

  const codyActivation = extractCodyFeedbackActivation('Cody Cody Cody: upload approval does nothing')
  assert(codyActivation?.audience === 'cody', 'Cody Cody Cody should activate Cody feedback')
  assert(codyActivation.content === 'upload approval does nothing', 'Cody activation should strip the trigger')
  assert(extractCodyFeedbackActivation('hey Cody upload approval does nothing') === null, 'old hey Cody trigger should not activate Cody')

  const codexActivation = extractCodyFeedbackActivation('note to Codex: review this patch')
  assert(codexActivation?.audience === 'codex', 'note to Codex should still activate direct Codex feedback')

  const packet = buildCodyPacket({
    content: 'Approval button does nothing after I approve linking photos to a job.',
    debugContext: {
      workspaceId: 'workspace_123',
      chatId: 'chat_123',
      channelType: 'project',
      documentIds: ['doc_1', 'doc_2'],
      userRole: 'owner',
    },
    recentMessages: [
      { role: 'user', text: 'Upload these front elevation photos.' },
      { role: 'assistant', text: 'Approval required.' },
      { role: 'user', text: 'Approved.' },
    ],
  })

  assert(packet.role === 'read_only_developer_analyst', 'Cody packet should be explicitly read-only')
  assert(packet.priority === 'P1', 'approval-does-nothing packet should be P1')
  assert(packet.area === 'uploads/files' || packet.area === 'notifications', 'packet should route to a useful area')
  assert(packet.likelyFiles.length > 0, 'packet should include likely files')
  assert(packet.safetyNotes.some(note => note.toLowerCase().includes('approval') || note.toLowerCase().includes('mutate')), 'packet should include safety notes')
  assert(packet.testChecklist.length > 0, 'packet should include test checklist')
}
