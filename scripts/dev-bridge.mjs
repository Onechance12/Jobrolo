#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const command = process.argv[2] || 'help'
const args = process.argv.slice(3)

function loadLocalEnv() {
  for (const file of ['.env.local', '.env']) {
    const path = resolve(process.cwd(), file)
    if (!existsSync(path)) continue
    const text = readFileSync(path, 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      if (!key || process.env[key]) continue
      let value = trimmed.slice(eq + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
      process.env[key] = value
    }
  }
}

loadLocalEnv()

const baseUrl = (process.env.JOBROLO_BASE_URL || 'https://jobrolo.onrender.com').replace(/\/$/, '')
const token = process.env.CODY_BRIDGE_TOKEN

function usage() {
  console.log(`Usage:
  npm run live:version
  npm run debug:actions -- --limit 25
  npm run debug:runtime -- --minutes 120
  npm run debug:upload -- <documentId>
  npm run debug:trace -- --chatId <chatId>
  npm run debug:trace -- --conversationId <conversationId>
  npm run smoke:live
  npm run debug:truth -- --limit 25
  npm run debug:classify -- --filename estimate.pdf --mime application/pdf --intent "this is a price list"
  npm run debug:synthetic -- --message "Show Timothy file" --projectId <projectId>
  npm run debug:cleanup -- --limit 25
  npm run debug:cleanup-dry -- --action move_price_sheet_to_company_pricing --documentId <documentId>
  npm run debug:chat-test -- --message "Show saved clients"
  npm run debug:chat-test -- --live --confirm --contractorId <contractorId> --message "Show saved clients"

Environment:
  JOBROLO_BASE_URL defaults to https://jobrolo.onrender.com
  CODY_BRIDGE_TOKEN is required for /api/dev/* endpoints
`)
}

function valueAfter(flag, fallback = undefined) {
  const index = args.indexOf(flag)
  if (index === -1 || index + 1 >= args.length) return fallback
  return args[index + 1]
}

function query(params) {
  const sp = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') sp.set(key, String(value))
  }
  const text = sp.toString()
  return text ? `?${text}` : ''
}

function collectText(flag) {
  const index = args.indexOf(flag)
  if (index === -1 || index + 1 >= args.length) return undefined
  return args.slice(index + 1).join(' ')
}

function collectUntilNextFlag(flag) {
  const index = args.indexOf(flag)
  if (index === -1 || index + 1 >= args.length) return undefined
  const values = []
  for (let i = index + 1; i < args.length; i++) {
    if (args[i].startsWith('--')) break
    values.push(args[i])
  }
  return values.length ? values.join(' ') : undefined
}

function has(flag) {
  return args.includes(flag)
}

async function request(path, { dev = true, method = 'GET', body } = {}) {
  if (dev && !token) {
    console.error('Missing CODY_BRIDGE_TOKEN. Add it to .env.local or export it in your shell.')
    process.exit(2)
  }
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(dev ? { authorization: `Bearer ${token}` } : {}),
      accept: 'application/json',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await res.text()
  let responseBody
  try {
    responseBody = JSON.parse(text)
  } catch {
    responseBody = { raw: text }
  }
  if (!res.ok) {
    console.error(`Request failed: ${res.status}`)
    console.error(JSON.stringify(responseBody, null, 2))
    process.exit(1)
  }
  return responseBody
}

function printJson(body) {
  console.log(JSON.stringify(body, null, 2))
}

async function version() {
  printJson(await request('/api/version', { dev: false }))
}

async function actions() {
  printJson(await request(`/api/dev/action-queue${query({
    limit: valueAfter('--limit', '50'),
    actionStatus: valueAfter('--action-status'),
    inboxStatus: valueAfter('--inbox-status'),
  })}`))
}

async function runtime() {
  printJson(await request(`/api/dev/runtime-logs${query({
    limit: valueAfter('--limit', '50'),
    minutes: valueAfter('--minutes', '60'),
  })}`))
}

async function upload() {
  const id = args.find(arg => !arg.startsWith('--'))
  if (!id) {
    console.error('Missing documentId.')
    usage()
    process.exit(2)
  }
  printJson(await request(`/api/dev/uploads/${encodeURIComponent(id)}/debug`))
}

async function trace() {
  printJson(await request(`/api/dev/agent-traces${query({
    limit: valueAfter('--limit', '25'),
    chatId: valueAfter('--chatId'),
    conversationId: valueAfter('--conversationId'),
    messageId: valueAfter('--messageId'),
  })}`))
}

async function smoke() {
  printJson(await request('/api/dev/smoke'))
}

async function truth() {
  printJson(await request(`/api/dev/local-truth-audit${query({
    limit: valueAfter('--limit', '25'),
    staleMinutes: valueAfter('--stale-minutes', '30'),
  })}`))
}

async function classify() {
  const filename = valueAfter('--filename') || args.find(arg => !arg.startsWith('--'))
  if (!filename) {
    console.error('Missing --filename.')
    usage()
    process.exit(2)
  }
  printJson(await request('/api/dev/upload-classify', {
    method: 'POST',
    body: {
      filename,
      mimeType: valueAfter('--mime'),
      uploadPurpose: valueAfter('--purpose'),
      suggestedUploadPurpose: valueAfter('--suggested-purpose'),
      uploadIntentSource: valueAfter('--intent'),
      actionSource: valueAfter('--action-source'),
      activeRoute: valueAfter('--route'),
      visibleText: valueAfter('--visible-text'),
      extractedText: valueAfter('--extracted-text'),
      metadataTitle: valueAfter('--metadata-title'),
      recentUserText: valueAfter('--recent-user-text'),
      photoSection: valueAfter('--photo-section'),
      hasCustomerContext: has('--customer'),
      hasProjectContext: has('--project'),
      hasWorkspaceContext: has('--workspace'),
    },
  }))
}

async function synthetic() {
  const message = valueAfter('--message') || collectText('--text') || args.join(' ')
  if (!message) {
    console.error('Missing --message.')
    usage()
    process.exit(2)
  }
  printJson(await request('/api/dev/synthetic-chat', {
    method: 'POST',
    body: {
      message,
      activeProjectId: valueAfter('--projectId'),
      activeCustomerId: valueAfter('--customerId'),
      activeWorkspaceId: valueAfter('--workspaceId'),
      channelType: valueAfter('--channel'),
      role: valueAfter('--role'),
      highComplexity: has('--high'),
    },
  }))
}

async function cleanup() {
  printJson(await request(`/api/dev/cleanup-candidates${query({
    limit: valueAfter('--limit', '50'),
    staleMinutes: valueAfter('--stale-minutes', valueAfter('--staleMinutes', '30')),
  })}`))
}

async function cleanupDry() {
  const action = valueAfter('--action')
  const documentId = valueAfter('--documentId') || valueAfter('--document-id') || args.find(arg => !arg.startsWith('--'))
  if (!action || !documentId) {
    console.error('Missing --action or --documentId.')
    usage()
    process.exit(2)
  }
  printJson(await request('/api/dev/cleanup-dry-run', {
    method: 'POST',
    body: { action, documentId },
  }))
}

function repeatedValues(flag) {
  const values = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && i + 1 < args.length) values.push(args[i + 1])
  }
  return values
}

async function chatTest() {
  const message = collectUntilNextFlag('--message') || collectText('--text') || args.filter(arg => !arg.startsWith('--')).join(' ')
  if (!message) {
    console.error('Missing --message.')
    usage()
    process.exit(2)
  }
  printJson(await request('/api/dev/chat-test', {
    method: 'POST',
    body: {
      mode: has('--live') ? 'live' : valueAfter('--mode', has('--local-only') ? 'local_only' : 'dry_run'),
      confirm: has('--confirm'),
      message,
      displayMessage: valueAfter('--display-message'),
      contractorId: valueAfter('--contractorId') || valueAfter('--contractor-id'),
      userId: valueAfter('--userId') || valueAfter('--user-id'),
      conversationId: valueAfter('--conversationId') || valueAfter('--conversation-id'),
      workspaceId: valueAfter('--workspaceId') || valueAfter('--workspace-id'),
      chatId: valueAfter('--chatId') || valueAfter('--chat-id'),
      activeCustomerId: valueAfter('--customerId') || valueAfter('--customer-id'),
      activeProjectId: valueAfter('--projectId') || valueAfter('--project-id'),
      channelType: valueAfter('--channel'),
      role: valueAfter('--role'),
      highComplexity: has('--high'),
      documentIds: repeatedValues('--documentId').concat(repeatedValues('--document-id')),
    },
  }))
}

if (command === 'version') await version()
else if (command === 'actions') await actions()
else if (command === 'runtime') await runtime()
else if (command === 'upload') await upload()
else if (command === 'trace') await trace()
else if (command === 'smoke') await smoke()
else if (command === 'truth') await truth()
else if (command === 'classify') await classify()
else if (command === 'synthetic') await synthetic()
else if (command === 'cleanup') await cleanup()
else if (command === 'cleanup-dry') await cleanupDry()
else if (command === 'chat-test') await chatTest()
else usage()
