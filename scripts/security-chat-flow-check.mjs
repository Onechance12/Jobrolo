import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

const chatRoute = read('src/app/api/chat/route.ts')
assert.match(chatRoute, /checkBodySize\(req\)/, 'main chat route must enforce request body size limits')
assert.match(chatRoute, /if \(!ctx\.user\)/, 'main chat route must require an authenticated user')
assert.match(chatRoute, /assertDocumentsBelongToTenant\(ctx\.contractorId,\s*documentIds\)/, 'main chat document IDs must be tenant-validated before queueing')
assert.match(chatRoute, /userId:\s*ctx\.user\.id/, 'main chat jobs must persist the authenticated actor')

const workspaceChatRoute = read('src/app/api/workspaces/[id]/chat/route.ts')
assert.match(workspaceChatRoute, /checkBodySize\(req\)/, 'workspace chat route must enforce request body size limits')
assert.match(workspaceChatRoute, /requireWorkspace\(ctx,\s*workspaceId\)/, 'workspace chat route must verify workspace ownership')
assert.match(workspaceChatRoute, /requireWorkspaceChat\(ctx,\s*workspaceId,\s*String\(chatId\)\)/, 'workspace chat route must verify chat ownership')
assert.match(workspaceChatRoute, /assertDocumentsBelongToTenant\(ctx\.contractorId,\s*documentIds\)/, 'workspace chat document IDs must be tenant-validated before queueing')
assert.match(workspaceChatRoute, /userId:\s*ctx\.user\.id/, 'workspace chat jobs must persist the authenticated actor')

const worker = read('src/lib/jobs/worker.ts')
assert.match(worker, /resolveJobExecutionContext\(job\)/, 'worker must re-resolve trusted tenant/user context before execution')
assert.match(worker, /assertDocumentsBelongToTenant\(job\.contractorId,\s*input\.documentIds\)/, 'worker must revalidate document IDs before adding them to AI context')
assert.match(worker, /userRole:\s*actorRole/, 'worker must pass real actor role into the agent loop')
assert.doesNotMatch(worker, /role:\s*['"]manager['"]/, 'worker must not fabricate manager role')

const tools = read('src/lib/agent/tools-v2.ts')
assert.doesNotMatch(tools, /approved:\s*tc\.name\s*===\s*['"]create_customer['"]/, 'tools must not special-case create_customer as model-approved')
assert.doesNotMatch(tools, /role:\s*['"]manager['"]/, 'tools must not fabricate manager role')
assert.match(tools, /Approval does not match requested action/, 'approved tool replay must be bound to the approved tool payload')
assert.match(tools, /canRunDirectWithoutApproval/, 'direct execution exceptions must stay explicit and server-controlled')

const legacyJob = read('src/lib/chat-job.ts')
assert.match(legacyJob, /JOBROLO_ENABLE_LEGACY_CHAT_JOB/, 'legacy in-memory chat processor must remain disabled unless explicitly enabled')

console.log('security chat flow checks passed')
