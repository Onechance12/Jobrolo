// =============================================================================
// P3 Radar Review — Overdue Follow-up Test (Prisma pathway)
// =============================================================================
// Verifies that an overdue FollowUp created via Prisma's create() method
// (the production pathway) IS detected by the radar and classified as
// 'needs_attention' (NOT 'waiting_customer').
//
// The Python test (test-radar-review.py TEST 4) creates FollowUp rows via
// raw SQL, which exposes a Prisma+SQLite date-comparison limitation that
// doesn't affect production. This bun test uses the same pathway as the
// chat agent (Prisma create) so it accurately tests production behavior.
//
// Run with: bun scripts/test-radar-overdue-followup.ts
// =============================================================================

import { db } from '@/lib/db'
import { runOperationsRadar } from '@/lib/radar'

let PASS = 0
let FAIL = 0

function test(name: string, condition: boolean, detail = '') {
  if (condition) {
    PASS++
    console.log(`  ✓ ${name}`)
  } else {
    FAIL++
    console.log(`  ✗ ${name} — ${detail}`)
  }
}

const CONTRACTOR_ID = 'cmqpenfjy0000m6blje8o44mw'
const RUN_ID = Math.random().toString(36).slice(2, 8)

async function main() {
  // Clean slate
  await db.followUp.deleteMany({ where: { id: { startsWith: `test_overdue_${RUN_ID}` } } })
  await db.insight.deleteMany({ where: { sourceId: { startsWith: `test_overdue_${RUN_ID}` } } })
  await db.insight.deleteMany({ where: { dedupKey: { startsWith: `overdue_followup:test_overdue_${RUN_ID}` } } })
  await db.customer.deleteMany({ where: { id: { startsWith: `test_overdue_${RUN_ID}` } } })

  console.log(`\nRun ID: ${RUN_ID}`)

  // Create customer with all fields populated (so we don't get a missing-info insight)
  const customer = await db.customer.create({
    data: {
      id: `test_overdue_${RUN_ID}_cust`,
      contractorId: CONTRACTOR_ID,
      name: `[overdue-test-${RUN_ID}] Customer`,
      email: 'overdue-test@example.com',
      phone: '(555) 555-5555',
      address: '123 Test St',
    },
  })

  // Create an overdue follow-up via Prisma (production pathway)
  const followUp = await db.followUp.create({
    data: {
      id: `test_overdue_${RUN_ID}_fu`,
      customerId: customer.id,
      type: 'call',
      reason: `[overdue-test-${RUN_ID}] Call about overdue thing`,
      status: 'pending',
      dueDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
      isAiSuggested: true,
    },
  })
  console.log(`Created follow-up: ${followUp.id}, dueDate: ${followUp.dueDate?.toISOString()}`)

  // Run radar
  console.log('Running radar...')
  const result = await runOperationsRadar(CONTRACTOR_ID)
  console.log(`Radar: detected=${result.detected}, handled=${result.handled}, escalated=${result.escalated}, waiting=${result.waiting}`)

  // Check the insight
  const insight = await db.insight.findUnique({
    where: {
      contractorId_dedupKey: {
        contractorId: CONTRACTOR_ID,
        dedupKey: `overdue_followup:${followUp.id}`,
      },
    },
  })

  if (insight) {
    console.log(`Insight: "${insight.title}" → ${insight.status}`)
    test(
      "Overdue follow-up insight was created",
      true,
    )
    test(
      "Overdue follow-up is 'needs_attention' (NOT 'waiting_customer')",
      insight.status === 'needs_attention',
      `status was ${JSON.stringify(insight.status)}`,
    )
    test(
      "Insight title includes 'Overdue follow-up'",
      insight.title.includes('Overdue follow-up'),
      `title was ${JSON.stringify(insight.title)}`,
    )
  } else {
    test("Overdue follow-up insight was created", false, "no insight found in DB")
  }

  // Cleanup
  await db.followUp.deleteMany({ where: { id: followUp.id } })
  await db.insight.deleteMany({ where: { sourceId: customer.id } })
  await db.insight.deleteMany({ where: { dedupKey: `overdue_followup:${followUp.id}` } })
  await db.customer.deleteMany({ where: { id: customer.id } })
  console.log('Cleanup done.')

  console.log(`\n${'='.repeat(70)}`)
  console.log(`OVERDUE FOLLOWUP TEST: ${PASS} passed, ${FAIL} failed`)
  console.log(`${'='.repeat(70)}`)
  process.exit(FAIL === 0 ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(1) })
