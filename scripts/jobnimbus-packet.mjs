#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const jiti = require('jiti')(process.cwd(), { interopDefault: true })

const { createJobroloClaimPacketFromJobNimbus, summarizeJobroloClaimPacket } = jiti('./src/lib/integrations/jobnimbus/adapter.ts')

function valueAfter(flag) {
  const index = process.argv.indexOf(flag)
  if (index === -1 || index + 1 >= process.argv.length) return undefined
  return process.argv[index + 1]
}

function has(flag) {
  return process.argv.includes(flag)
}

const EXAMPLES = {
  ready_for_appraisal: {
    sourceSystem: 'jobnimbus',
    sourceRecordType: 'contact',
    sourceId: 'example-ready-for-appraisal',
    customerName: 'Example PA File',
    address: '4607 W Red Bird Ln, Dallas, TX, 75236',
    status: 'Ready for Appraisal',
    recordType: 'Insurance',
    carrier: 'Allstate',
    claimNumber: 'EXAMPLE-CLAIM',
    policyNumber: 'EXAMPLE-POLICY',
    typeOfLoss: 'Hail',
    deductibleAmount: 5000,
    adjusterName: 'Carrier Adjuster',
    adjusterEmail: 'claims@example.com',
    notes: ['ACV received.', 'Ready for appraisal.'],
    openTasks: [{ title: 'Estimate Inspection', dueDate: '2026-05-22', assignee: { name: 'Appraisal Desk' } }],
  },
  two_confirmations: {
    sourceSystem: 'jobnimbus',
    sourceRecordType: 'contact',
    sourceId: 'example-two-confirmations',
    customerName: 'Example Confirmation File',
    address: '2414 Summit View St, Grand Prairie, TX, 75050',
    status: 'Submitted Awaiting Confirmation',
    recordType: 'Insurance',
    carrier: 'State Farm',
    claimNumber: 'EXAMPLE-CLAIM-2',
    policyNumber: 'EXAMPLE-POLICY-2',
    dateOfLoss: '2026-04-26',
    typeOfLoss: 'Hail',
    deductibleAmount: 4800,
    notes: ['Claim filed. Confirm carrier/payment-control context before advancing.'],
    openTasks: [{ title: 'Estimate Inspection', dueDate: '2026-05-07', assignee: { name: 'Office Admin' } }],
  },
}

function usage() {
  console.log(`Usage:
  npm run jobnimbus:packet -- --example ready_for_appraisal
  npm run jobnimbus:packet -- --example two_confirmations --summary
  npm run jobnimbus:packet -- --input /path/to/jobnimbus-claim.json

Input shape:
  JobNimbus-like claim/contact JSON with customerName, address, status, carrier,
  claimNumber, policyNumber, dateOfLoss, notes, openTasks, files, and payments.

Safety:
  This command is local dry-run only. It does not call JobNimbus, Jobrolo, OpenAI, or production APIs.
`)
}

function readInput() {
  const inputPath = valueAfter('--input')
  if (inputPath) {
    if (!existsSync(inputPath)) {
      console.error(`Input file not found: ${inputPath}`)
      process.exit(2)
    }
    return JSON.parse(readFileSync(inputPath, 'utf8'))
  }
  const example = valueAfter('--example') || 'ready_for_appraisal'
  const payload = EXAMPLES[example]
  if (!payload) {
    console.error(`Unknown example: ${example}`)
    usage()
    process.exit(2)
  }
  return payload
}

if (has('--help')) {
  usage()
  process.exit(0)
}

const packet = createJobroloClaimPacketFromJobNimbus(readInput(), { now: new Date('2026-07-01T12:00:00.000Z') })
if (has('--summary')) console.log(summarizeJobroloClaimPacket(packet))
else console.log(JSON.stringify(packet, null, 2))
