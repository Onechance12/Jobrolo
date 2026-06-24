// =============================================================================
// P2 Entity Classification Tests — Document Extraction Layer
// =============================================================================
// Tests that the regex-based entity extractor (extractEntities) and the merge
// function (mergeEntities) correctly separate contacts by entity owner, and
// that the radar (downstream) cannot poison Customer.* from adjuster/carrier
// values found in extractedData.
//
// Run with:   bun scripts/test-extraction-entity-classification.ts
//   or:       npx tsx scripts/test-extraction-entity-classification.ts
// =============================================================================

import { extractEntities, mergeEntities } from '../src/lib/document/entity-extractor'
import { runOperationsRadar } from '../src/lib/radar'
import { db } from '../src/lib/db'

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

// =============================================================================
// TEST 1: Adjuster email in document does NOT become customer.email
// =============================================================================
console.log('\n=== TEST 1: Adjuster email does NOT become customer.email ===')
const text1 = `
Claim Number: CLM-2024-1234
Carrier: State Farm
Insured: Sarah Johnson
Property: 142 Maple Street, Springfield, IL 62701
Adjuster: Mark Thompson
Adjuster Email: mthompson@statefarm.com
Adjuster Phone: (555) 123-4567
Date of Loss: 03/15/2024
RCV: $15,200
ACV: $13,200
Deductible: $1,000
`
const entities1 = extractEntities(text1)
console.log('  Extracted:')
console.log(`    customer.email = ${entities1.customer.email ?? 'undefined'}`)
console.log(`    customer.phone = ${entities1.customer.phone ?? 'undefined'}`)
console.log(`    claimInfo.adjusterEmail = ${entities1.claimInfo.adjusterEmail ?? 'undefined'}`)
console.log(`    claimInfo.adjusterPhone = ${entities1.claimInfo.adjusterPhone ?? 'undefined'}`)
console.log(`    unknownEmails = ${JSON.stringify(entities1.unknownEmails)}`)
console.log(`    unknownPhones = ${JSON.stringify(entities1.unknownPhones)}`)

test(
  'customer.email is NOT set (no "Customer Email:" label in doc)',
  !entities1.customer.email,
  `customer.email was set to ${JSON.stringify(entities1.customer.email)}`,
)
test(
  'customer.phone is NOT set (no "Customer Phone:" label in doc)',
  !entities1.customer.phone,
  `customer.phone was set to ${JSON.stringify(entities1.customer.phone)}`,
)
test(
  'claimInfo.adjusterEmail IS set to mthompson@statefarm.com',
  entities1.claimInfo.adjusterEmail === 'mthompson@statefarm.com',
  `adjusterEmail was ${JSON.stringify(entities1.claimInfo.adjusterEmail)}`,
)
test(
  'claimInfo.adjusterPhone IS set to (555) 123-4567',
  entities1.claimInfo.adjusterPhone === '(555) 123-4567',
  `adjusterPhone was ${JSON.stringify(entities1.claimInfo.adjusterPhone)}`,
)
test(
  'Adjuster email is NOT in unknownEmails (it was claimed by adjuster pattern)',
  !entities1.unknownEmails.includes('mthompson@statefarm.com'),
  `unknownEmails was ${JSON.stringify(entities1.unknownEmails)}`,
)
test(
  'Adjuster phone is NOT in unknownPhones',
  !entities1.unknownPhones.includes('(555) 123-4567'),
  `unknownPhones was ${JSON.stringify(entities1.unknownPhones)}`,
)

// =============================================================================
// TEST 2: Homeowner email DOES become customer.email
// =============================================================================
console.log('\n=== TEST 2: Homeowner email DOES become customer.email ===')
const text2 = `
Claim Number: CLM-2024-5678
Carrier: Allstate
Insured: Jane Doe
Property: 999 Real Customer Addr, Hometown
Customer Email: jane.doe@example.com
Customer Phone: (555) 111-2222
Adjuster: Bob Smith
Adjuster Email: bsmith@allstate.com
Adjuster Phone: (555) 999-8888
`
const entities2 = extractEntities(text2)
console.log('  Extracted:')
console.log(`    customer.email = ${entities2.customer.email ?? 'undefined'}`)
console.log(`    customer.phone = ${entities2.customer.phone ?? 'undefined'}`)
console.log(`    claimInfo.adjusterEmail = ${entities2.claimInfo.adjusterEmail ?? 'undefined'}`)
console.log(`    claimInfo.adjusterPhone = ${entities2.claimInfo.adjusterPhone ?? 'undefined'}`)

test(
  'customer.email IS set to jane.doe@example.com (labeled "Customer Email:")',
  entities2.customer.email === 'jane.doe@example.com',
  `customer.email was ${JSON.stringify(entities2.customer.email)}`,
)
test(
  'customer.phone IS set to (555) 111-2222 (labeled "Customer Phone:")',
  entities2.customer.phone === '(555) 111-2222',
  `customer.phone was ${JSON.stringify(entities2.customer.phone)}`,
)
test(
  'claimInfo.adjusterEmail IS set to bsmith@allstate.com (separate from customer)',
  entities2.claimInfo.adjusterEmail === 'bsmith@allstate.com',
  `adjusterEmail was ${JSON.stringify(entities2.claimInfo.adjusterEmail)}`,
)
test(
  'claimInfo.adjusterPhone IS set to (555) 999-8888 (separate from customer)',
  entities2.claimInfo.adjusterPhone === '(555) 999-8888',
  `adjusterPhone was ${JSON.stringify(entities2.claimInfo.adjusterPhone)}`,
)

// =============================================================================
// TEST 3: Carrier contact goes to carrier fields (NOT customer)
// =============================================================================
console.log('\n=== TEST 3: Carrier contact goes to carrier fields ===')
const text3 = `
Claim Number: CLM-2024-9012
Carrier: USAA
Carrier Phone: (800) 531-8722
Carrier Email: claims@usaa.com
Insured: Robert Brown
Property: 456 Oak Avenue, Dallas, TX
Adjuster: Sarah Lee
Adjuster Email: slee@usaa.com
`
const entities3 = extractEntities(text3)
console.log('  Extracted:')
console.log(`    claimInfo.carrier = ${entities3.claimInfo.carrier ?? 'undefined'}`)
console.log(`    claimInfo.carrierPhone = ${entities3.claimInfo.carrierPhone ?? 'undefined'}`)
console.log(`    claimInfo.carrierEmail = ${entities3.claimInfo.carrierEmail ?? 'undefined'}`)
console.log(`    customer.email = ${entities3.customer.email ?? 'undefined'}`)
console.log(`    customer.phone = ${entities3.customer.phone ?? 'undefined'}`)

test(
  'claimInfo.carrier IS set to USAA',
  entities3.claimInfo.carrier === 'USAA',
  `carrier was ${JSON.stringify(entities3.claimInfo.carrier)}`,
)
test(
  'claimInfo.carrierPhone IS set to (800) 531-8722',
  entities3.claimInfo.carrierPhone === '(800) 531-8722',
  `carrierPhone was ${JSON.stringify(entities3.claimInfo.carrierPhone)}`,
)
test(
  'claimInfo.carrierEmail IS set to claims@usaa.com',
  entities3.claimInfo.carrierEmail === 'claims@usaa.com',
  `carrierEmail was ${JSON.stringify(entities3.claimInfo.carrierEmail)}`,
)
test(
  'customer.email is NOT set (carrier email did not leak)',
  !entities3.customer.email,
  `customer.email was ${JSON.stringify(entities3.customer.email)}`,
)
test(
  'customer.phone is NOT set (carrier phone did not leak)',
  !entities3.customer.phone,
  `customer.phone was ${JSON.stringify(entities3.customer.phone)}`,
)

// =============================================================================
// TEST 4: Unknown email is preserved but not auto-applied to customer
// =============================================================================
console.log('\n=== TEST 4: Unknown email is preserved but NOT auto-applied ===')
const text4 = `
Some random document.
Contact: mystery@example.com
Phone: (555) 000-0000
No labels, no context.
`
const entities4 = extractEntities(text4)
console.log('  Extracted:')
console.log(`    customer.email = ${entities4.customer.email ?? 'undefined'}`)
console.log(`    customer.phone = ${entities4.customer.phone ?? 'undefined'}`)
console.log(`    unknownEmails = ${JSON.stringify(entities4.unknownEmails)}`)
console.log(`    unknownPhones = ${JSON.stringify(entities4.unknownPhones)}`)
console.log(`    emails (all) = ${JSON.stringify(entities4.emails)}`)
console.log(`    phones (all) = ${JSON.stringify(entities4.phones)}`)

test(
  'customer.email is NOT set (no label)',
  !entities4.customer.email,
  `customer.email was ${JSON.stringify(entities4.customer.email)}`,
)
test(
  'customer.phone is NOT set (no label)',
  !entities4.customer.phone,
  `customer.phone was ${JSON.stringify(entities4.customer.phone)}`,
)
test(
  'unknownEmails contains mystery@example.com (preserved for review)',
  entities4.unknownEmails.includes('mystery@example.com'),
  `unknownEmails was ${JSON.stringify(entities4.unknownEmails)}`,
)
test(
  'unknownPhones contains (555) 000-0000 (preserved for review)',
  entities4.unknownPhones.includes('(555) 000-0000'),
  `unknownPhones was ${JSON.stringify(entities4.unknownPhones)}`,
)
test(
  'emails (all) still contains the bare email',
  entities4.emails.includes('mystery@example.com'),
  `emails was ${JSON.stringify(entities4.emails)}`,
)

// =============================================================================
// TEST 5: mergeEntities sanitizes AI-extracted customer.email that matches adjusterEmail
// =============================================================================
console.log('\n=== TEST 5: mergeEntities sanitizes AI miscategorization ===')
// Simulate what the AI sometimes does: puts adjusterEmail in BOTH claimInfo AND customer
const aiExtracted = {
  claimInfo: {
    adjusterEmail: 'parker@farmers.com',
    adjusterPhone: '(555) 333-2222',
    carrier: 'Farmers',
  },
  customer: {
    name: 'Alex Parker',
    // BUG: AI incorrectly put adjuster email/phone here
    email: 'parker@farmers.com',
    phone: '(555) 333-2222',
    address: '999 Real Customer Addr, Hometown',
  },
}
const regexEntities = extractEntities(`
Claim Number: CLM-TEST-5
Carrier: Farmers
Insured: Alex Parker
Property: 999 Real Customer Addr, Hometown
Adjuster Email: parker@farmers.com
Adjuster Phone: (555) 333-2222
`)
const merged = mergeEntities(aiExtracted, regexEntities)
const mergedCustomer = merged.customer as Record<string, unknown>
const mergedClaim = merged.claimInfo as Record<string, unknown>

console.log('  Merged:')
console.log(`    customer = ${JSON.stringify(mergedCustomer)}`)
console.log(`    claimInfo.adjusterEmail = ${mergedClaim.adjusterEmail ?? 'undefined'}`)
console.log(`    claimInfo.adjusterPhone = ${mergedClaim.adjusterPhone ?? 'undefined'}`)

test(
  'customer.email was REMOVED (matched adjusterEmail)',
  !mergedCustomer.email,
  `customer.email was ${JSON.stringify(mergedCustomer.email)}`,
)
test(
  'customer.phone was REMOVED (matched adjusterPhone)',
  !mergedCustomer.phone,
  `customer.phone was ${JSON.stringify(mergedCustomer.phone)}`,
)
test(
  'customer.address IS preserved (legitimate homeowner data)',
  mergedCustomer.address === '999 Real Customer Addr, Hometown',
  `customer.address was ${JSON.stringify(mergedCustomer.address)}`,
)
test(
  'claimInfo.adjusterEmail IS preserved',
  mergedClaim.adjusterEmail === 'parker@farmers.com',
  `claimInfo.adjusterEmail was ${JSON.stringify(mergedClaim.adjusterEmail)}`,
)
test(
  'claimInfo.adjusterPhone IS preserved',
  mergedClaim.adjusterPhone === '(555) 333-2222',
  `claimInfo.adjusterPhone was ${JSON.stringify(mergedClaim.adjusterPhone)}`,
)

// =============================================================================
// TEST 6: Radar does NOT poison Customer.* from extractedData
// =============================================================================
console.log('\n=== TEST 6: Radar does NOT poison Customer records from extractedData ===')

// Set up: find an existing customer to use, or create a temporary one
const contractor = await db.contractor.findFirst({ where: { status: 'active' } })
if (!contractor) {
  console.log('  (skipped — no active contractor)')
} else {
  const RUN_ID = Math.random().toString(36).slice(2, 8)
  const testCustomer = await db.customer.create({
    data: {
      id: `testext_${RUN_ID}`,
      contractorId: contractor.id,
      name: `[ext-test-${RUN_ID}] Adjuster-Only Doc`,
      // intentionally leave email/phone NULL — radar should NOT auto-fill
      email: null,
      phone: null,
      address: null,
    },
  })

  // Create a doc where ONLY adjuster contact info is present (no homeowner email/phone)
  await db.document.create({
    data: {
      id: `testdoc_${RUN_ID}`,
      contractorId: contractor.id,
      filename: `[ext-test-${RUN_ID}] adjuster_only.pdf`,
      originalName: `[ext-test-${RUN_ID}] adjuster_only.pdf`,
      mimeType: 'application/pdf',
      size: 1024,
      filePath: '/tmp/test.pdf',
      fileType: 'estimate',
      status: 'reviewed',
      customerId: testCustomer.id,
      extractedData: JSON.stringify({
        // Mimic what the FIXED extractor would produce:
        customer: {
          name: `[ext-test-${RUN_ID}] Adjuster-Only Doc`,
          // No email/phone — homeowner contact info not in this doc
          address: '142 Maple Street, Springfield, IL 62701',
        },
        claimInfo: {
          claimNumber: 'CLM-EXT-1',
          carrier: 'State Farm',
          adjuster: 'Mark Thompson',
          adjusterEmail: 'mthompson@statefarm.com',
          adjusterPhone: '(555) 999-1234',
          property: '142 Maple Street, Springfield, IL 62701',
        },
      }),
    },
  })

  // Clear existing insights so radar actually investigates
  await db.insight.deleteMany({
    where: { contractorId: contractor.id, source: 'customer', sourceId: testCustomer.id },
  })

  // Run the radar
  console.log(`  Created customer ${testCustomer.id} (no email/phone)`)
  console.log('  Created doc with claimInfo.adjusterEmail=mthompson@statefarm.com')
  console.log('  Running radar...')
  await runOperationsRadar(contractor.id)

  // Re-read the customer
  const after = await db.customer.findUnique({ where: { id: testCustomer.id } })
  console.log(`  After radar: email=${JSON.stringify(after!.email)}, phone=${JSON.stringify(after!.phone)}`)

  test(
    'Customer.email is STILL null (radar did not write adjuster email)',
    !after!.email,
    `email was ${JSON.stringify(after!.email)}`,
  )
  test(
    'Customer.phone is STILL null (radar did not write adjuster phone)',
    !after!.phone,
    `phone was ${JSON.stringify(after!.phone)}`,
  )

  // Cleanup
  await db.insight.deleteMany({
    where: { contractorId: contractor.id, source: 'customer', sourceId: testCustomer.id },
  })
  await db.contractorMemory.deleteMany({
    where: { contractorId: contractor.id, content: { contains: testCustomer.name } },
  })
  await db.document.deleteMany({ where: { id: `testdoc_${RUN_ID}` } })
  await db.customer.deleteMany({ where: { id: testCustomer.id } })
  console.log('  Cleanup done.')
}

// =============================================================================
// Summary
// =============================================================================
console.log(`\n${'='.repeat(70)}`)
console.log(`EXTRACTION ENTITY CLASSIFICATION RESULTS: ${PASS} passed, ${FAIL} failed`)
console.log(`${'='.repeat(70)}`)
process.exit(FAIL === 0 ? 0 : 1)
