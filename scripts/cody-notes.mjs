#!/usr/bin/env node

const command = process.argv[2] || 'list'
const args = process.argv.slice(3)
const baseUrl = (process.env.JOBROLO_BASE_URL || 'https://jobrolo.onrender.com').replace(/\/$/, '')
const token = process.env.CODY_BRIDGE_TOKEN

function usage() {
  console.log(`Usage:
  CODY_BRIDGE_TOKEN=... npm run cody:notes
  CODY_BRIDGE_TOKEN=... npm run cody:notes -- --status unread,read --limit 25
  CODY_BRIDGE_TOKEN=... npm run cody:done -- <noteId> [moreIds...] --note "fixed in commit abc123"
  CODY_BRIDGE_TOKEN=... npm run cody:archive -- <noteId> [moreIds...]

Environment:
  JOBROLO_BASE_URL defaults to https://jobrolo.onrender.com
  CODY_BRIDGE_TOKEN must match Render's CODY_BRIDGE_TOKEN
`)
}

function valueAfter(flag, fallback) {
  const index = args.indexOf(flag)
  if (index === -1 || index + 1 >= args.length) return fallback
  return args[index + 1]
}

function idsFromArgs() {
  const stopFlags = new Set(['--note', '--status', '--limit'])
  const ids = []
  for (let i = 0; i < args.length; i += 1) {
    const value = args[i]
    if (stopFlags.has(value)) {
      i += 1
      continue
    }
    if (!value.startsWith('--')) ids.push(value)
  }
  return ids
}

async function request(path, options = {}) {
  if (!token) {
    console.error('Missing CODY_BRIDGE_TOKEN.')
    usage()
    process.exit(2)
  }
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const text = await res.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = { raw: text }
  }
  if (!res.ok) {
    console.error(`Request failed: ${res.status}`)
    console.error(JSON.stringify(body, null, 2))
    process.exit(1)
  }
  return body
}

function printNotes(body) {
  const items = Array.isArray(body.items) ? body.items : []
  console.log(`Cody notes: ${body.count ?? items.length}`)
  if (!items.length) {
    console.log('No open Cody notes found.')
    return
  }
  for (const item of items) {
    console.log('')
    console.log(`- ${item.id}`)
    console.log(`  ${item.title} [${item.priority}/${item.status}]`)
    console.log(`  Company: ${item.company || item.contractorId}`)
    console.log(`  Area: ${item.area || 'unknown'} · Severity: ${item.severity || item.priority}`)
    console.log(`  Created: ${item.createdAt}`)
    if (item.currentUrl) console.log(`  URL: ${item.currentUrl}`)
    console.log(`  Note: ${item.content || item.summary || '(empty)'}`)
  }
}

async function list() {
  const status = encodeURIComponent(valueAfter('--status', 'unread,read'))
  const limit = encodeURIComponent(valueAfter('--limit', '50'))
  const body = await request(`/api/dev/cody-notes?status=${status}&limit=${limit}`)
  printNotes(body)
}

async function mark(status) {
  const ids = idsFromArgs()
  if (!ids.length) {
    console.error(`Missing note ID for "${command}".`)
    usage()
    process.exit(2)
  }
  const resolution = valueAfter('--note', undefined)
  const body = await request('/api/dev/cody-notes', {
    method: 'PATCH',
    body: JSON.stringify({ ids, status, resolution }),
  })
  console.log(JSON.stringify(body, null, 2))
}

if (command === 'list') {
  await list()
} else if (command === 'done' || command === 'actioned') {
  await mark('actioned')
} else if (command === 'archive' || command === 'archived') {
  await mark('archived')
} else if (command === 'read') {
  await mark('read')
} else if (command === 'help' || command === '--help' || command === '-h') {
  usage()
} else {
  console.error(`Unknown command: ${command}`)
  usage()
  process.exit(2)
}
