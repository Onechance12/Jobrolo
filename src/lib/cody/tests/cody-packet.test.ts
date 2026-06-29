import {
  buildCodyPacket,
  codyBlockOpeningContent,
  extractCodyFeedbackActivation,
  inferCodyArea,
  inferCodySeverity,
  isCodyBlockCloseText,
  isCodyBlockOpenText,
} from '../packet'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export function assertCodyPacketContracts() {
  assert(inferCodyArea('Cody Cody Cody PDF upload says saved but never attaches to project') === 'uploads/files', 'upload notes should classify as uploads/files')
  assert(inferCodyArea('Cody Cody Cody the onboarding screen locks me in setup mode') === 'onboarding/auth', 'onboarding notes should classify as onboarding/auth')
  assert(inferCodyArea('Cody Cody Cody approval button does nothing in Action Needed') === 'notifications', 'approval/notification notes should classify as notifications')
  assert(inferCodyArea('company card setup gaps should prompt me to upload agreements and research BBB') === 'company profile', 'company setup/research notes should classify as company profile')
  assert(inferCodyArea('uploaded a photo after company research and the company card BBB Google reviews are wrong', 'uploads/files') === 'company profile', 'strong company/research notes should override a weak upload fallback')
  assert(inferCodySeverity('critical private customer file leaked') === 'urgent', 'security/private-data language should be urgent')
  assert(inferCodySeverity('upload failed and got stuck') === 'high', 'failed/stuck language should be high severity')

  assert(extractCodyFeedbackActivation('Cody Cody Cody: upload approval does nothing') === null, 'Cody Cody Cody should open Cody mode, not one-shot capture')
  assert(extractCodyFeedbackActivation('hey Cody upload approval does nothing') === null, 'old hey Cody trigger should not activate Cody')

  const codexActivation = extractCodyFeedbackActivation('note to Codex: review this patch')
  assert(codexActivation?.audience === 'codex', 'note to Codex should still activate direct Codex feedback')
  const codyActivation = extractCodyFeedbackActivation('note to Cody: upload approval does nothing')
  assert(codyActivation?.audience === 'cody', 'note to Cody should activate direct Cody feedback')

  assert(isCodyBlockOpenText('Cody Cody Cody upload approval does nothing') === true, 'triple Cody should open Cody review mode')
  assert(isCodyBlockOpenText('Cody help me debug uploads') === false, 'single Cody should not open Cody review mode')
  assert(isCodyBlockCloseText('end Cody') === true, 'end Cody should close Cody review mode')
  assert(codyBlockOpeningContent('Cody Cody Cody: help me debug uploads') === 'help me debug uploads', 'Cody block opening content should strip opener')

  const packet = buildCodyPacket({
    content: 'Approval button does nothing after I approve linking photos to a job.',
    debugContext: {
      workspaceId: 'workspace_123',
      chatId: 'chat_123',
      channelType: 'project',
      documentIds: ['doc_1', 'doc_2'],
      userRole: 'owner',
      route: '/projects/project_123',
      toolNames: ['link_document_to_project'],
      lastError: 'Approval required but replay did not finish.',
    },
    relevantIds: { projectId: 'project_123', actionRequestId: 'action_123' },
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
  assert(packet.evidence.some(item => item.includes('project_123')), 'packet should include relevant project/action evidence')
  assert(packet.evidence.some(item => item.includes('link_document_to_project')), 'packet should include tool evidence when present')
  assert(packet.safetyNotes.some(note => note.toLowerCase().includes('approval') || note.toLowerCase().includes('mutate')), 'packet should include safety notes')
  assert(packet.testChecklist.length > 0, 'packet should include test checklist')
}
