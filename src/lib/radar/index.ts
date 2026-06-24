// =============================================================================
// Operations Radar V3 — P0 Fixes
// =============================================================================
// Truthful resolution engine:
//   - Only marks "handled" when a real DB update happened
//   - Searches only documents related to the specific customer/project
//   - Deduplicates by content hash or normalized name + size
//   - Never recreates dismissed/resolved insights
//   - Follow-up creation actually works with correct customerId
//   - Every handled insight has proof fields (actionsTaken, recordsUpdated, etc.)
// =============================================================================

import { db } from '@/lib/db'

export type InsightType = 'observation' | 'risk' | 'opportunity' | 'recommendation' | 'follow_up'
export type ResolutionStatus =
  | 'active' | 'handled' | 'needs_attention' | 'needs_approval'
  | 'waiting_customer' | 'waiting_carrier' | 'waiting_internal'
  | 'resolved' | 'dismissed'

export interface DetectedIssue {
  type: InsightType
  title: string
  detail: string
  confidence: number
  source: string
  sourceId?: string
  sourceName?: string
  dedupKey: string
  resolutionStrategy: 'search_documents' | 'search_memory' | 'search_conversations' | 'update_record' | 'create_follow_up' | 'escalate_only'
  // Context for resolution — which customer/project to search
  customerId?: string
  projectId?: string
  missingFields?: string[] // e.g. ['phone', 'email', 'address']
}

// ===========================================================================
// P2 — Entity Ownership Classification
// ===========================================================================
// Problem: Radar was treating ANY email/phone found in a customer's documents
// as the customer's own contact info. Adjuster emails were being written into
// Customer.email. Carrier phones were being written into Customer.phone.
//
// Fix: Every candidate value found in extractedData is now classified by who
// it actually belongs to. Only `homeowner`-owned values may update Customer.*.
// Adjuster / carrier / contractor / mortgage values are saved to memory (so
// the info isn't lost) but NEVER written to the Customer record.
// `unknown`-owner values escalate for human review — they are NOT auto-applied.
// ===========================================================================

export type EntityOwner = 'homeowner' | 'adjuster' | 'carrier' | 'contractor' | 'mortgage' | 'unknown'

export interface EntityCandidate {
  field: 'email' | 'phone' | 'address'
  value: string
  owner: EntityOwner
  confidence: number        // 0–1
  sourcePath: string        // e.g. 'claimInfo.adjusterEmail' or 'customer.email'
  sourceDocId: string
  sourceDocName: string
}

// Which owners are allowed to update Customer.{field}
const CUSTOMER_ALLOWED_OWNERS: Record<string, EntityOwner[]> = {
  email:   ['homeowner'],
  phone:   ['homeowner'],
  address: ['homeowner'],
}

// Classify a (path, value) pair to determine entity ownership.
// `allPairs` is the full set of (path, value) pairs found in the same document —
// we use it to cross-check e.g. customer.email == claimInfo.adjusterEmail.
function classifyOwner(path: string, value: string, allPairs: { path: string; value: string }[]): EntityOwner {
  const p = path.toLowerCase()
  const v = value.toLowerCase().trim()

  // 1. Explicit adjuster prefix wins immediately
  if (p.includes('adjuster')) return 'adjuster'

  // 2. Explicit carrier / insurer prefix
  if (p.includes('carrier') || p.includes('insurancecompany') || p.includes('insurer')) return 'carrier'

  // 3. Contractor / roofer / builder
  if (p.includes('contractor') || p.includes('roofer') || p.includes('builder')) return 'contractor'

  // 4. Mortgage / lender
  if (p.includes('mortgage') || p.includes('lender') || p.includes('loan_')) return 'mortgage'

  // 5. `claimInfo.property` is the insured property — that IS the customer's home address
  if (p === 'claiminfo.property' || p.endsWith('.property')) return 'homeowner'

  // 6. `customer.*` / `homeowner.*` / `insured.*` — but cross-check: if the
  //    value matches an adjuster-owned value elsewhere in the same document,
  //    the extractor mis-copied it. Demote to 'adjuster' so we don't poison
  //    the Customer record.
  if (p.includes('homeowner') || p.includes('customer') || p.includes('insured')) {
    const adjusterMatch = allPairs.find(ap =>
      ap.path.toLowerCase().includes('adjuster') &&
      ap.value.toLowerCase().trim() === v &&
      v.length > 0
    )
    if (adjusterMatch) return 'adjuster'

    const carrierMatch = allPairs.find(ap =>
      (ap.path.toLowerCase().includes('carrier') || ap.path.toLowerCase().includes('insurer')) &&
      ap.value.toLowerCase().trim() === v &&
      v.length > 0
    )
    if (carrierMatch) return 'carrier'

    return 'homeowner'
  }

  // 7. Bare keys (data.email, data.phone) with no entity prefix → unknown
  return 'unknown'
}

// Walk extractedData and collect every candidate value for the missing fields.
// Each candidate is tagged with the entity it belongs to.
function collectCandidates(
  extractedData: any,
  missingFields: string[],
  docId: string,
  docName: string,
): EntityCandidate[] {
  const candidates: EntityCandidate[] = []
  if (!extractedData || typeof extractedData !== 'object') return candidates

  // Phase 1: walk the object, collect all (path, value) pairs
  const allPairs: { path: string; value: string }[] = []
  function walk(obj: any, path: string) {
    if (!obj || typeof obj !== 'object') return
    for (const [k, v] of Object.entries(obj)) {
      const newPath = path ? `${path}.${k}` : k
      if (typeof v === 'string' && v.trim()) {
        allPairs.push({ path: newPath, value: v })
      } else if (v && typeof v === 'object') {
        walk(v, newPath)
      }
    }
  }
  walk(extractedData, '')

  // Phase 2: for each missing field, find matching candidates
  const EMAIL_KEYS = new Set(['email', 'emailaddress', 'e-mail', 'mail'])
  const PHONE_KEYS = new Set(['phone', 'phonenumber', 'tel', 'telephone', 'mobile', 'cell', 'cellphone'])
  const ADDRESS_KEYS = new Set(['address', 'property', 'propertyaddress', 'street', 'streetaddress', 'location', 'mailingaddress'])

  for (const field of missingFields) {
    for (const pair of allPairs) {
      const key = (pair.path.split('.').pop() ?? '').toLowerCase()
      const val = pair.value.trim()
      if (!val) continue

      if (field === 'email' && EMAIL_KEYS.has(key)) {
        if (!val.includes('@')) continue
        const owner = classifyOwner(pair.path, val, allPairs)
        candidates.push({
          field: 'email',
          value: val,
          owner,
          confidence: owner === 'homeowner' ? 0.9 : owner === 'unknown' ? 0.4 : 0.5,
          sourcePath: pair.path,
          sourceDocId: docId,
          sourceDocName: docName,
        })
      }

      if (field === 'phone' && PHONE_KEYS.has(key)) {
        // Must contain at least one digit to be a phone number
        if (!/\d/.test(val)) continue
        const owner = classifyOwner(pair.path, val, allPairs)
        candidates.push({
          field: 'phone',
          value: val,
          owner,
          confidence: owner === 'homeowner' ? 0.9 : owner === 'unknown' ? 0.4 : 0.5,
          sourcePath: pair.path,
          sourceDocId: docId,
          sourceDocName: docName,
        })
      }

      if (field === 'address' && ADDRESS_KEYS.has(key)) {
        // Skip very short strings — not real addresses
        if (val.length < 10) continue
        const owner = classifyOwner(pair.path, val, allPairs)
        candidates.push({
          field: 'address',
          value: val,
          owner,
          confidence: owner === 'homeowner' ? 0.85 : owner === 'unknown' ? 0.4 : 0.5,
          sourcePath: pair.path,
          sourceDocId: docId,
          sourceDocName: docName,
        })
      }
    }
  }

  return candidates
}

// Pick the best homeowner-owned candidate for a field, or null if none.
function pickHomeownerCandidate(candidates: EntityCandidate[], field: 'email' | 'phone' | 'address'): EntityCandidate | null {
  const eligible = candidates.filter(c => c.field === field && CUSTOMER_ALLOWED_OWNERS[field].includes(c.owner))
  if (eligible.length === 0) return null
  // Highest confidence wins; ties broken by sourcePath preference (customer.* > homeowner.* > claimInfo.property)
  eligible.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence
    const pref = (p: string) => p.includes('customer.') ? 0 : p.includes('homeowner.') ? 1 : 2
    return pref(a.sourcePath) - pref(b.sourcePath)
  })
  return eligible[0]
}

export interface ProofAction {
  action: string       // "db_update" | "follow_up_created" | "memory_saved"
  table?: string       // "Customer" | "FollowUp" etc.
  recordId?: string
  field?: string
  before?: any
  after?: any
  sourceDocId?: string
  sourceDocName?: string
}

export interface ResolvedIssue {
  detected: DetectedIssue
  status: ResolutionStatus
  resolutionDetail: string
  actions: string[]          // human-readable action descriptions
  proof: ProofAction[]       // machine-verified proof
  sourceIdsUsed: string[]    // doc IDs that were actually searched
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export async function runOperationsRadar(contractorId: string): Promise<{
  detected: number
  handled: number
  escalated: number      // needs_attention / needs_approval
  waiting: number        // waiting_customer / waiting_carrier / waiting_internal
  report: string
}> {
  // P3 FIX (BUG 23): Before running detectors, sweep existing missing_info
  // insights and resolve any whose customer now has all fields populated.
  // The detector only fires for customers with missing fields, so without
  // this sweep, completed-customer insights would stay in waiting_customer
  // forever.
  try {
    await sweepResolvedMissingInfoInsights(contractorId)
  } catch (err) {
    console.error('[radar] missing-info sweep failed:', err)
  }

  // Phase 1: Detect — wrap each detector in try/catch so one bad detector
  // doesn't take down the whole radar run.
  const issues: DetectedIssue[] = []
  const detectors: Array<[string, (cid: string) => Promise<DetectedIssue[]>]> = [
    ['detectStalledProjects', detectStalledProjects],
    ['detectOverdueTasks', detectOverdueTasks],
    ['detectDocumentIssues', detectDocumentIssues],
    ['detectUnderScopedEstimates', detectUnderScopedEstimates],
    ['detectMissingCustomerInfo', detectMissingCustomerInfo],
    ['detectOverdueFollowUps', detectOverdueFollowUps],
    ['detectProjectsWithoutDocs', detectProjectsWithoutDocs],
    ['detectCustomerCommunicationGaps', detectCustomerCommunicationGaps],
    ['detectDuplicateDocuments', detectDuplicateDocuments],
    ['detectScopeOffsetOpportunities', detectScopeOffsetOpportunities],
    ['detectConversationPromises', detectConversationPromises],
  ]
  for (const [name, fn] of detectors) {
    try {
      const found = await fn(contractorId)
      issues.push(...found)
    } catch (err) {
      console.error(`[radar] detector ${name} failed:`, err)
    }
  }

  // Phase 2: Investigate + resolve
  const resolved: ResolvedIssue[] = []
  let handled = 0
  let escalated = 0
  let waiting = 0

  for (const issue of issues) {
    // P0-3: Check if insight already exists (any status) — don't recreate dismissed/resolved
    let existing: Awaited<ReturnType<typeof db.insight.findUnique>> = null
    try {
      existing = await db.insight.findUnique({
        where: { contractorId_dedupKey: { contractorId, dedupKey: issue.dedupKey } },
      })
    } catch (err) {
      console.error('[radar] existing-insight lookup failed:', err)
    }

    if (existing) {
      // Dismissed / resolved / not_useful — skip entirely, with one exception:
      // P3 FIX (BUG 22) — duplicate-doc insights re-surface if the upload
      // count has grown since the operator last dismissed them. We encode the
      // count in the title ("uploaded N times"), so we can compare directly.
      if (['dismissed', 'resolved', 'not_useful'].includes(existing.status)) {
        let shouldResurface = false
        if (existing.source === 'document' && issue.title.includes('uploaded')) {
          const extractCount = (s: string) => parseInt(s.match(/uploaded (\d+) times/)?.[1] ?? '0', 10)
          const oldCount = extractCount(existing.title)
          const newCount = extractCount(issue.title)
          if (newCount > oldCount) {
            shouldResurface = true
          }
        }
        if (!shouldResurface) {
          continue
        }
        // Re-surface: flip the existing insight back to 'active' and continue
        // to re-investigation below.
        try {
          await db.insight.update({
            where: { id: existing.id },
            data: {
              title: issue.title,
              detail: issue.detail,
              status: 'active',
              dismissedAt: null,
              resolutionDetail: null,
              resolutionActions: null,
            },
          })
        } catch (err) {
          console.error('[radar] failed to re-surface dismissed duplicate insight:', err)
          continue
        }
      } else if (existing.status === 'handled') {
        // P3 FIX (BUG 12): 'handled' is terminal — don't re-investigate.
        // (If conditions change such that the issue re-occurs, a new dedupKey
        // would be needed; for the current detectors, handled means "we did
        // a real DB update", so re-investigating wouldn't change anything.)
        continue
      }
      // P3 FIX (BUG 12): previously only 'active' insights were re-investigated.
      // That meant once an insight was escalated (e.g. 'waiting_customer'), it
      // stayed in that state forever — even if conditions changed. Now we
      // re-investigate any non-handled, non-terminal insight so the radar can
      // update its status (e.g. waiting_customer → handled once customer replies).
      //
      // P3 FIX (BUG 23): for missing-customer-info insights, check if the
      // missing fields have changed. If the customer now has all the fields,
      // mark the insight resolved and skip.
      if (existing.source === 'customer' && issue.dedupKey.startsWith('missing_info:')) {
        const freshCustomer = await db.customer.findFirst({
          where: { id: issue.sourceId ?? '', contractorId },
          select: { email: true, phone: true, address: true },
        })
        if (freshCustomer) {
          const stillMissing = (issue.missingFields ?? []).filter(f => !freshCustomer[f as 'email' | 'phone' | 'address'])
          if (stillMissing.length === 0) {
            // All fields populated — resolve the insight and skip
            try {
              await db.insight.update({
                where: { id: existing.id },
                data: { status: 'resolved', resolvedAt: new Date(), resolutionDetail: 'Customer record now complete.' },
              })
            } catch {}
            continue
          }
          // If the missing set shrank, narrow the issue to just the remaining
          // fields so the operator sees the current state.
          if (stillMissing.length !== (issue.missingFields ?? []).length) {
            issue.missingFields = stillMissing
          }
        }
      }
    }

    // P3 FIX (BUG 18): wrap investigateAndResolve in try/catch so one bad
    // issue doesn't kill the whole batch.
    let result: ResolvedIssue
    try {
      result = await investigateAndResolve(contractorId, issue)
    } catch (err) {
      console.error(`[radar] investigate failed for "${issue.title}":`, err)
      result = escalateWithDetail(
        issue,
        'needs_attention',
        `Radar encountered an internal error while investigating this issue: ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    // P3 FIX (BUG 26): don't double-count in the report. If the existing
    // insight already has the same status as the new result, the operator
    // has already seen it — we still call saveInsight (to refresh the
    // resolutionDetail), but we don't push to `resolved` so the report
    // doesn't list the same insight N times across scans.
    const statusChanged = !existing || existing.status !== result.status
    if (statusChanged) {
      resolved.push(result)
      if (result.status === 'handled') handled++
      else if (result.status.startsWith('waiting_')) waiting++
      else escalated++
    }
    // If status didn't change, we still call saveInsight (to refresh the
    // resolutionDetail) but we don't double-count it in the report.

    try {
      await saveInsight(contractorId, result, existing?.id)
    } catch (err) {
      console.error(`[radar] saveInsight failed for "${issue.title}":`, err)
    }
  }

  const report = generateReport(contractorId, resolved)
  console.log(`[radar-p0] contractor ${contractorId}: ${issues.length} detected, ${handled} handled, ${escalated} escalated, ${waiting} waiting`)
  return { detected: issues.length, handled, escalated, waiting, report }
}

// ---------------------------------------------------------------------------
// P0-1: Truthful resolution — only mark handled when real DB update happens
// ---------------------------------------------------------------------------

async function investigateAndResolve(contractorId: string, issue: DetectedIssue): Promise<ResolvedIssue> {
  switch (issue.resolutionStrategy) {
    case 'search_documents':
      return await resolveBySearchingDocuments(contractorId, issue)
    case 'search_memory':
      return await resolveBySearchingMemory(contractorId, issue)
    case 'search_conversations':
      return await resolveBySearchingConversations(contractorId, issue)
    case 'create_follow_up':
      return await resolveByCreatingFollowUp(contractorId, issue)
    case 'update_record':
    case 'escalate_only':
    default:
      return escalate(issue)
  }
}

// P0-1 + P2: Search ONLY documents related to the specific customer/project,
// and only apply values whose entity owner is `homeowner`.
// Adjuster / carrier / contractor / mortgage values get saved to memory but
// NEVER written to the Customer record. Unknown-owner values escalate.
async function resolveBySearchingDocuments(contractorId: string, issue: DetectedIssue): Promise<ResolvedIssue> {
  const proof: ProofAction[] = []
  const actions: string[] = []
  const sourceIdsUsed: string[] = []

  // Only resolve missing customer info via document search
  if (issue.source !== 'customer' || !issue.sourceId || !issue.missingFields?.length) {
    return escalate(issue)
  }

  const customerId = issue.sourceId
  // P3 FIX (tenant isolation): verify the customer belongs to THIS contractor.
  // Without this check, a malicious caller could pass another contractor's
  // customer ID and the radar would happily fetch + update that customer.
  const customer = await db.customer.findFirst({
    where: { id: customerId, contractorId },
  })
  if (!customer) return escalate(issue)

  // P0-1: Search ONLY documents linked to this customer
  // Also search documents linked to this customer's projects
  const customerProjects = await db.project.findMany({
    where: { customerId },
    select: { id: true },
  })
  const projectIds = customerProjects.map(p => p.id)

  const relatedDocs = await db.document.findMany({
    where: {
      contractorId,
      status: 'reviewed',
      OR: [
        { customerId },
        ...(projectIds.length ? [{ projectId: { in: projectIds } }] : []),
      ],
    },
    select: { id: true, originalName: true, extractedData: true, customerId: true, projectId: true },
  })

  if (relatedDocs.length === 0) {
    // No documents for this customer — can't resolve
    return escalate(issue)
  }

  // P2: Walk every related document and collect entity-classified candidates.
  // Only `homeowner`-owned candidates may update the Customer record.
  // Adjuster / carrier / contractor / mortgage candidates are saved to memory
  // (so the info isn't lost) but never written to Customer.*.
  // Unknown-owner candidates are escalated for human review.
  const allCandidates: EntityCandidate[] = []
  const nonHomeownerCandidates: EntityCandidate[] = []  // for memory + escalation context

  for (const doc of relatedDocs) {
    sourceIdsUsed.push(doc.id)
    if (!doc.extractedData) continue

    try {
      const data = JSON.parse(doc.extractedData)
      const docCandidates = collectCandidates(data, issue.missingFields, doc.id, doc.originalName)
      allCandidates.push(...docCandidates)
    } catch {
      // Bad JSON — skip this doc
    }
  }

  // Build the set of updates — ONLY from homeowner-owned candidates.
  // Skip fields the customer already has (don't overwrite existing valid data).
  const updates: Record<string, string> = {}
  const updateSources: Record<string, EntityCandidate> = {}

  for (const field of issue.missingFields) {
    if (field === 'phone' && customer.phone) continue
    if (field === 'email' && customer.email) continue
    if (field === 'address' && customer.address) continue

    const best = pickHomeownerCandidate(allCandidates, field as 'email' | 'phone' | 'address')
    if (best) {
      updates[field] = best.value
      updateSources[field] = best
    }
  }

  // Collect non-homeowner candidates so we can save them to memory + escalate.
  // These are values we found but REFUSE to write to Customer.*.
  for (const c of allCandidates) {
    if (c.owner !== 'homeowner') {
      // Only keep ones that aren't already covered by a homeowner update
      const alreadyUpdated = updates[c.field] !== undefined
      if (!alreadyUpdated) {
        nonHomeownerCandidates.push(c)
      } else if (updateSources[c.field]?.value !== c.value) {
        // Also track conflicting non-homeowner values
        nonHomeownerCandidates.push(c)
      }
    }
  }

  // P0-1: If we have homeowner-owned updates, apply them to the Customer record.
  if (Object.keys(updates).length > 0) {
    const beforeValue: Record<string, any> = {}
    for (const field of Object.keys(updates)) {
      beforeValue[field] = (customer as any)[field]
    }

    await db.customer.update({
      where: { id: customerId },
      data: updates,
    })

    for (const [field, value] of Object.entries(updates)) {
      const src = updateSources[field]
      proof.push({
        action: 'db_update',
        table: 'Customer',
        recordId: customerId,
        field,
        before: beforeValue[field],
        after: value,
        sourceDocId: src?.sourceDocId,
        sourceDocName: src?.sourceDocName,
      })
      actions.push(`Updated ${customer.name}.${field} from "${src?.sourceDocName ?? 'unknown doc'}" (owner=homeowner, path=${src?.sourcePath}): "${value}"`)
    }

    // Save the homeowner-owned learnings to memory
    try {
      await db.contractorMemory.create({
        data: {
          contractorId,
          category: 'key_info',
          content: `Radar auto-resolved (entity=homeowner): ${customer.name} ${Object.keys(updates).join(', ')} found in "${updateSources[Object.keys(updates)[0]]?.sourceDocName ?? 'doc'}". Values: ${Object.entries(updates).map(([k,v]) => `${k}=${v}`).join(', ')}.`,
          source: 'ai',
        },
      })
      actions.push(`Saved homeowner-owned learning to memory: ${customer.name} info found in ${updateSources[Object.keys(updates)[0]]?.sourceDocName}`)
    } catch {}
  }

  // P2: Save non-homeowner candidates to memory (so adjuster/carrier info isn't lost)
  // but DO NOT write them to the Customer record.
  const savedNonHomeowner: string[] = []
  for (const c of nonHomeownerCandidates) {
    try {
      await db.contractorMemory.create({
        data: {
          contractorId,
          category: 'key_info',
          content: `Radar found ${c.field} for ${customer.name} but did NOT write to Customer record — owner=${c.owner} (source: "${c.sourceDocName}", path=${c.sourcePath}, value="${c.value}"). Saved for reference only; verify and reassign if needed.`,
          source: 'ai',
        },
      })
      savedNonHomeowner.push(`${c.field}(${c.owner})="${c.value}"`)
    } catch {}
  }
  if (savedNonHomeowner.length > 0) {
    actions.push(`Saved ${savedNonHomeowner.length} non-homeowner candidate(s) to memory (NOT written to Customer record): ${savedNonHomeowner.slice(0, 3).join(', ')}${savedNonHomeowner.length > 3 ? '...' : ''}`)
  }

  // Decide final status:
  //  - If we wrote at least one homeowner-owned update → handled (partial or full)
  //  - Else if there are unknown-owner candidates → escalate for review
  //  - Else if there are only adjuster/carrier/etc. candidates → escalate (waiting_carrier or needs_attention)
  //  - Else → escalate (no candidates found at all)
  if (Object.keys(updates).length > 0) {
    // Even if some fields were not resolvable, the issue is partially handled.
    // Re-detect next scan will pick up any still-missing fields.
    const stillMissing = issue.missingFields.filter(f => !updates[f])
    const detail = stillMissing.length > 0
      ? `Partially resolved: updated ${Object.keys(updates).join(', ')} for ${customer.name} from homeowner-owned source(s). Still missing: ${stillMissing.join(', ')} — only non-homeowner candidates were found for those fields (saved to memory, not written to Customer).`
      : `Found missing ${Object.keys(updates).join(', ')} for ${customer.name} from homeowner-owned source(s). Updated customer record and saved to memory.`

    return {
      detected: issue,
      status: 'handled',
      resolutionDetail: detail,
      actions,
      proof,
      sourceIdsUsed,
    }
  }

  // No homeowner-owned updates possible — escalate with proper classification.
  if (nonHomeownerCandidates.some(c => c.owner === 'unknown')) {
    // Unknown-owner email/phone found — must be reviewed by a human
    const unknowns = nonHomeownerCandidates.filter(c => c.owner === 'unknown')
    return escalateWithDetail(
      issue,
      'needs_attention',
      `Found ${unknowns.length} candidate(s) for ${customer.name} but could not determine who they belong to (owner=unknown). NOT written to Customer record. Candidates: ${unknowns.slice(0, 3).map(c => `${c.field}="${c.value}" (from ${c.sourceDocName})`).join(', ')}. Review and assign manually.`,
    )
  }

  if (nonHomeownerCandidates.length > 0) {
    // Only adjuster/carrier/etc. candidates found — these belong to other entities.
    const adjusterHits = nonHomeownerCandidates.filter(c => c.owner === 'adjuster')
    if (adjusterHits.length > 0) {
      return escalateWithDetail(
        issue,
        'waiting_carrier',
        `Found ${adjusterHits.length} adjuster-owned candidate(s) for ${customer.name} but no homeowner-owned values. Adjuster info saved to memory but NOT written to Customer record. Candidates: ${adjusterHits.slice(0, 3).map(c => `${c.field}="${c.value}" (from ${c.sourceDocName})`).join(', ')}. Contact customer directly to capture their own ${issue.missingFields.join('/')}.`,
      )
    }
    return escalateWithDetail(
      issue,
      'needs_attention',
      `Found ${nonHomeownerCandidates.length} non-homeowner candidate(s) for ${customer.name} (owners: ${[...new Set(nonHomeownerCandidates.map(c => c.owner))].join(', ')}). Saved to memory but NOT written to Customer record. Capture ${issue.missingFields.join('/')} directly from the customer.`,
    )
  }

  // No candidates found at all — escalate honestly.
  return escalate(issue)
}

// Escalate with a specific status + custom detail message (used by entity-owner logic
// and by the memory/conversation resolvers to pass context to the operator).
// Optional sourceIdsUsed lets the caller record what was actually searched even
// when the issue is escalated (so the operator can see "we looked at memory X, Y, Z").
function escalateWithDetail(
  issue: DetectedIssue,
  status: ResolutionStatus,
  detail: string,
  sourceIdsUsed: string[] = [],
): ResolvedIssue {
  return {
    detected: issue,
    status,
    resolutionDetail: detail,
    actions: ['Escalated to operator — needs human review'],
    proof: [],
    sourceIdsUsed,
  }
}

// P0-4: Make create_follow_up real
async function resolveByCreatingFollowUp(contractorId: string, issue: DetectedIssue): Promise<ResolvedIssue> {
  const proof: ProofAction[] = []
  const actions: string[] = []

  // Must have a customerId to create a follow-up
  if (!issue.customerId) {
    return escalate(issue)
  }

  // P3 FIX (tenant isolation): verify the customer belongs to THIS contractor.
  const customer = await db.customer.findFirst({
    where: { id: issue.customerId, contractorId },
  })
  if (!customer) {
    return escalate(issue)
  }

  // P3 FIX: prevent duplicate follow-ups for the same customer + same reason.
  // Without this, every radar scan would create a new follow-up for the same
  // communication-gap issue until the operator manually marks one as completed.
  const existingFollowUp = await db.followUp.findFirst({
    where: {
      customerId: issue.customerId,
      reason: issue.title,
      status: 'pending',
    },
    select: { id: true, dueDate: true },
  })
  if (existingFollowUp) {
    // Already a pending follow-up for this exact issue — don't create a duplicate.
    return escalateWithDetail(
      issue,
      'waiting_internal',
      `A follow-up task (ID: ${existingFollowUp.id}) already exists for this issue, due ${existingFollowUp.dueDate?.toDateString() ?? 'unknown'}. No new follow-up created.`,
    )
  }

  try {
    const followUp = await db.followUp.create({
      data: {
        customerId: issue.customerId,
        type: 'call',
        reason: issue.title,
        status: 'pending',
        dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        isAiSuggested: true,
      },
    })

    proof.push({
      action: 'follow_up_created',
      table: 'FollowUp',
      recordId: followUp.id,
    })
    actions.push(`Created follow-up task (ID: ${followUp.id}) for ${customer.name}`)

    // P3 FIX: status is 'waiting_internal' — WE created the follow-up, so WE
    // need to act on it. The customer isn't waiting on us; we're waiting on
    // ourselves to make the call. The previous code marked it 'waiting_customer'
    // which is misleading.
    return {
      detected: issue,
      status: 'waiting_internal',
      resolutionDetail: `Created a follow-up task to contact ${customer.name} about: ${issue.title}. The task is pending internal action.`,
      actions,
      proof,
      sourceIdsUsed: [],
    }
  } catch (err) {
    // P0-4: If creation fails, escalate instead of lying
    console.error('[radar] follow-up creation failed:', err)
    return escalate(issue)
  }
}

// P3 FIX: Search memory — DO NOT mark as 'handled' just because we found a
// memory entry that mentions the issue. The original P0 fix made this same
// mistake for documents (claiming "handled" without a real DB update). The
// same lie pattern existed here: finding a memory entry that mentions the
// customer/project doesn't mean the underlying issue is resolved — it just
// means someone talked about it before.
//
// Now: we surface the found memory as CONTEXT for the operator, and the
// insight is escalated (not handled) so the operator can decide what to do.
async function resolveBySearchingMemory(contractorId: string, issue: DetectedIssue): Promise<ResolvedIssue> {
  const sourceIdsUsed: string[] = []

  let matchingMemory: { id: string; content: string; category: string } | null = null
  try {
    const memories = await db.contractorMemory.findMany({
      where: { contractorId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, content: true, category: true },
    })

    const issueKeywords = issue.title.toLowerCase().split(/\s+/).filter(w => w.length > 4)
    for (const mem of memories) {
      sourceIdsUsed.push(mem.id)
      const content = mem.content.toLowerCase()
      if (issueKeywords.some(kw => content.includes(kw))) {
        matchingMemory = mem
        break
      }
    }
  } catch (err) {
    console.error('[radar] memory search failed:', err)
  }

  if (matchingMemory) {
    // Escalate WITH context — do NOT claim handled.
    return escalateWithDetail(
      issue,
      'needs_attention',
      `Found related context in memory but no automated fix was applied. Memory: "${matchingMemory.content.slice(0, 200)}". Review and decide if action is still needed.`,
      sourceIdsUsed,
    )
  }

  return escalate(issue)
}

// P3 FIX: Search conversations — same fix as memory search. Finding a chat
// message that mentions the issue does NOT mean the issue is resolved.
async function resolveBySearchingConversations(contractorId: string, issue: DetectedIssue): Promise<ResolvedIssue> {
  const sourceIdsUsed: string[] = []

  let matchingMsg: { id: string; content: string } | null = null
  try {
    const conversations = await db.conversation.findMany({
      where: { contractorId },
      include: { messages: { orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, content: true, createdAt: true } } },
      take: 5,
    })

    const issueKeywords = issue.title.toLowerCase().split(/\s+/).filter(w => w.length > 4)
    outer: for (const convo of conversations) {
      for (const msg of convo.messages) {
        sourceIdsUsed.push(msg.id)
        const content = msg.content.toLowerCase()
        if (issueKeywords.some(kw => content.includes(kw))) {
          matchingMsg = msg
          break outer
        }
      }
    }
  } catch (err) {
    console.error('[radar] conversation search failed:', err)
  }

  if (matchingMsg) {
    // Escalate WITH context — do NOT claim handled.
    return escalateWithDetail(
      issue,
      'needs_attention',
      `Found related context in conversation but no automated fix was applied. Message: "${matchingMsg.content.slice(0, 200)}". Review and decide if action is still needed.`,
      sourceIdsUsed,
    )
  }

  return escalate(issue)
}

// ---------------------------------------------------------------------------
// Escalate helper — classify escalation type
// ---------------------------------------------------------------------------
// P3 FIX: the old cascade mixed `&&` and `||` without parens, classified by
// title-substring only (ignoring source and type), and had multiple
// contradictions (e.g. "Overdue follow-up: call customer" matched BOTH
// "customer" → waiting_customer AND "overdue" → needs_attention, and the
// first match won — so overdue follow-ups were misclassified as
// waiting_customer when they're really OUR overdue task).
//
// The new classifyEscalationStatus() function is source+type-aware and
// resolves conflicts by checking the most-specific signals first.

function classifyEscalationStatus(issue: DetectedIssue): ResolutionStatus {
  const t = issue.title.toLowerCase()
  const d = issue.detail.toLowerCase()
  const src = issue.source
  const type = issue.type

  // 1. Technical issues that need admin attention — checked first because
  //    they're unambiguous keywords.
  if (t.includes('ocr') || d.includes('ocr provider')) return 'needs_attention'

  // 2. Document cleanup (duplicate uploads, failed analysis) — needs human
  //    decision. These come from source='document'.
  if (src === 'document' && (
    t.includes('uploaded') && t.includes('times') ||
    t.includes('duplicate') ||
    t.includes('failed analysis')
  )) return 'needs_attention'

  // 3. Carrier / adjuster / insurance / claim — the operator needs to follow
  //    up with the carrier. (Don't trigger on the word "claim" alone if the
  //    title is about a missing customer field — that's a customer issue.)
  if (src !== 'customer' && (
    t.includes('carrier') || t.includes('adjuster') || t.includes('insurance')
  )) return 'waiting_carrier'
  // Customer-source issues that explicitly mention adjuster/carrier (e.g.
  // "Customer email matched adjuster email — contact customer directly")
  if (src === 'customer' && (
    d.includes('adjuster-owned') || d.includes('carrier-owned') ||
    d.includes('contact customer directly')
  )) return 'waiting_carrier'

  // 4. Financial decisions — supplement opportunities, scope offsets,
  //    deductible-related items. Always needs owner approval.
  if (type === 'opportunity' || t.includes('scope offset') || t.includes('deductible') || t.includes('supplement')) {
    return 'needs_approval'
  }

  // 5. Overdue follow-ups / overdue tasks — these are OUR overdue actions.
  //    NOT waiting_customer (the customer isn't waiting on us, we're late).
  if (t.includes('overdue')) return 'needs_attention'

  // 6. Stalled projects / no-documents projects — operator should decide
  //    whether to chase the customer, archive, etc.
  if (src === 'project' && (t.includes('no activity') || t.includes('no documents'))) {
    return 'waiting_customer'
  }

  // 7. Communication gap (customer hasn't been contacted) — needs customer
  //    outreach, but the follow-up creation will turn this into waiting_internal.
  //    If we get here it means follow-up creation failed/skipped — escalate.
  if (t.includes('no communication') || t.includes('communication gap')) {
    return 'waiting_customer'
  }

  // 8. Missing customer info that we couldn't auto-resolve — operator needs
  //    to capture it directly from the customer.
  if (src === 'customer' && (t.includes('missing') || t.includes('incomplete'))) {
    return 'waiting_customer'
  }

  // 9. Promise unfulfilled — Jobrolo's own commitment. Internal action needed.
  if (t.includes('promise') || t.includes('unfulfilled')) {
    return 'needs_attention'
  }

  // 10. Under-scoped estimates — opportunity to upsell, needs approval.
  if (t.includes('under-scoped') || t.includes('may be under-scoped')) {
    return 'needs_approval'
  }

  // 11. Fallback by type
  if (type === 'risk') return 'needs_attention'
  if (type === 'recommendation') return 'needs_approval'
  // (type === 'opportunity' was already handled in step 4)

  // 12. Final fallback
  return 'needs_attention'
}

function escalate(issue: DetectedIssue): ResolvedIssue {
  const status = classifyEscalationStatus(issue)

  const statusMessages: Record<string, string> = {
    waiting_customer: 'Waiting on customer response.',
    waiting_carrier: 'Waiting on carrier/adjuster.',
    waiting_internal: 'Waiting on internal action.',
    needs_approval: 'Needs owner approval before proceeding.',
    needs_attention: 'Needs human attention.',
  }

  return {
    detected: issue,
    status,
    resolutionDetail: `Could not resolve automatically. ${statusMessages[status] || 'Needs human attention.'}`,
    actions: ['Escalated to operator'],
    proof: [],
    sourceIdsUsed: [],
  }
}

// ---------------------------------------------------------------------------
// P0-5 + P0-3: Save insight with proof fields + don't recreate dismissed
// ---------------------------------------------------------------------------

// P3 FIX (BUG 23): Sweep existing missing_info insights and resolve any whose
// customer now has all the previously-missing fields populated. The
// detectMissingCustomerInfo detector only fires for customers with missing
// fields, so without this sweep, completed-customer insights would stay in
// waiting_customer forever.
async function sweepResolvedMissingInfoInsights(contractorId: string): Promise<number> {
  // Find all non-terminal missing_info insights
  const insights = await db.insight.findMany({
    where: {
      contractorId,
      source: 'customer',
      dedupKey: { startsWith: 'missing_info:' },
      status: { notIn: ['dismissed', 'resolved', 'not_useful', 'handled'] },
    },
    select: { id: true, dedupKey: true, sourceId: true },
  })

  let resolvedCount = 0
  for (const ins of insights) {
    if (!ins.sourceId) continue
    const customer = await db.customer.findFirst({
      where: { id: ins.sourceId, contractorId },
      select: { email: true, phone: true, address: true },
    })
    if (!customer) {
      // Customer was deleted — mark insight resolved
      try {
        await db.insight.update({
          where: { id: ins.id },
          data: { status: 'resolved', resolvedAt: new Date(), resolutionDetail: 'Customer record no longer exists.' },
        })
        resolvedCount++
      } catch {}
      continue
    }
    // All fields populated?
    if (customer.email && customer.phone && customer.address) {
      try {
        await db.insight.update({
          where: { id: ins.id },
          data: { status: 'resolved', resolvedAt: new Date(), resolutionDetail: 'Customer record now complete.' },
        })
        resolvedCount++
      } catch {}
    }
  }
  if (resolvedCount > 0) {
    console.log(`[radar-p3] sweepResolvedMissingInfoInsights: resolved ${resolvedCount} stale missing-info insight(s)`)
  }
  return resolvedCount
}

async function saveInsight(contractorId: string, resolved: ResolvedIssue, existingId?: string) {
  const proofFields = resolved.status === 'handled' ? {
    actionsTaken: JSON.stringify(resolved.proof),
    recordsUpdated: JSON.stringify(resolved.proof
      .filter(p => p.action === 'db_update')
      .map(p => ({ table: p.table, id: p.recordId, fields: [p.field] }))
    ),
    sourceIdsUsed: JSON.stringify(resolved.sourceIdsUsed),
    beforeValue: JSON.stringify(resolved.proof
      .filter(p => p.action === 'db_update')
      .reduce((acc, p) => { if (p.field) acc[p.field] = p.before; return acc }, {} as Record<string, any>)
    ),
    afterValue: JSON.stringify(resolved.proof
      .filter(p => p.action === 'db_update')
      .reduce((acc, p) => { if (p.field) acc[p.field] = p.after; return acc }, {} as Record<string, any>)
    ),
  } : {}

  try {
    if (existingId) {
      // Update existing insight
      await db.insight.update({
        where: { id: existingId },
        data: {
          status: resolved.status,
          resolutionDetail: resolved.resolutionDetail,
          resolutionActions: JSON.stringify(resolved.actions),
          resolvedAt: resolved.status === 'handled' ? new Date() : null,
          ...proofFields,
        },
      })
    } else {
      // Create new insight
      await db.insight.create({
        data: {
          contractorId,
          type: resolved.detected.type,
          title: resolved.detected.title,
          detail: resolved.detected.detail,
          confidence: resolved.detected.confidence,
          source: resolved.detected.source,
          sourceId: resolved.detected.sourceId ?? null,
          sourceName: resolved.detected.sourceName ?? null,
          status: resolved.status,
          resolutionDetail: resolved.resolutionDetail,
          resolutionActions: JSON.stringify(resolved.actions),
          dedupKey: resolved.detected.dedupKey,
          resolvedAt: resolved.status === 'handled' ? new Date() : null,
          ...proofFields,
        },
      })
    }
  } catch (err: any) {
    if (err?.code === 'P2002') {
      // Duplicate — update existing if it was active
      try {
        await db.insight.updateMany({
          where: { contractorId, dedupKey: resolved.detected.dedupKey, status: 'active' },
          data: {
            status: resolved.status,
            resolutionDetail: resolved.resolutionDetail,
            resolutionActions: JSON.stringify(resolved.actions),
            resolvedAt: resolved.status === 'handled' ? new Date() : null,
            ...proofFields,
          },
        })
      } catch {}
    } else {
      console.error('[radar] save error:', err)
    }
  }
}

// ---------------------------------------------------------------------------
// Report generator
// ---------------------------------------------------------------------------

function generateReport(contractorId: string, resolved: ResolvedIssue[]): string {
  const handled = resolved.filter(r => r.status === 'handled')
  // P3 FIX (BUG 21): split non-handled into "needs your help" (needs_attention
  // / needs_approval) vs "in waiting state" (waiting_customer / waiting_carrier
  // / waiting_internal). The old report dumped everything into "I need your
  // help with:" which spammed the operator with insights that don't need
  // their action (e.g. "waiting on customer reply").
  const needsAction = resolved.filter(r => r.status === 'needs_attention' || r.status === 'needs_approval')
  const waiting = resolved.filter(r => r.status.startsWith('waiting_'))

  const lines: string[] = []

  if (handled.length > 0) {
    lines.push(`Here's what I handled:\n`)
    for (const h of handled) {
      lines.push(`✓ ${h.detected.title}`)
      lines.push(`${h.resolutionDetail}`)
      if (h.actions.length > 0) {
        for (const action of h.actions) {
          lines.push(`  → ${action}`)
        }
      }
      lines.push('')
    }
  }

  if (needsAction.length > 0) {
    lines.push(`I need your help with:\n`)
    for (const e of needsAction) {
      lines.push(`• ${e.detected.title}`)
      lines.push(`  ${e.resolutionDetail}`)
      lines.push('')
    }
  }

  if (waiting.length > 0) {
    lines.push(`Still in progress (no action needed right now):\n`)
    for (const w of waiting) {
      lines.push(`• ${w.detected.title}`)
      lines.push(`  ${w.resolutionDetail}`)
      lines.push('')
    }
  }

  if (resolved.length === 0) {
    return 'Everything looks good — no issues detected. I reviewed all projects, customers, documents, and tasks.'
  }

  return lines.join('\n').trim()
}

// ===========================================================================
// DETECTORS — P0-2: Use content hash / normalized name + size for dedup
// ===========================================================================

async function detectStalledProjects(contractorId: string): Promise<DetectedIssue[]> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const projects = await db.project.findMany({
    where: { contractorId, status: 'active', updatedAt: { lt: cutoff } },
    include: { customer: { select: { name: true, id: true } } },
  })
  return projects.map(p => {
    const days = Math.floor((Date.now() - p.updatedAt.getTime()) / 86400000)
    return {
      type: 'observation' as InsightType,
      title: `Project "${p.title}" — no activity for ${days} days`,
      detail: `${p.title}${p.customer?.name ? ` for ${p.customer.name}` : ''} was last updated ${days} days ago.`,
      confidence: 0.9, source: 'project', sourceId: p.id, sourceName: p.title,
      dedupKey: `stalled:${p.id}`,
      resolutionStrategy: 'search_conversations' as const,
      customerId: p.customer?.id ?? undefined,
      projectId: p.id,
    }
  })
}

async function detectOverdueTasks(contractorId: string): Promise<DetectedIssue[]> {
  const now = new Date()
  const tasks = await db.task.findMany({
    where: { project: { contractorId }, status: { in: ['open', 'in_progress'] }, dueDate: { lt: now } },
    include: { project: { select: { id: true, title: true, customerId: true } } },
  })
  return tasks.map(t => ({
    type: 'risk' as InsightType,
    title: `Overdue: "${t.title}" (${Math.floor((now.getTime() - (t.dueDate?.getTime() ?? now.getTime())) / 86400000)}d)`,
    detail: `Task on ${t.project?.title ?? 'Unknown'} is overdue. Priority: ${t.priority}.`,
    confidence: 0.95, source: 'task', sourceId: t.id, sourceName: t.title,
    dedupKey: `overdue_task:${t.id}`,
    resolutionStrategy: 'escalate_only' as const,
    projectId: t.project?.id,
    customerId: t.project?.customerId ?? undefined,
  }))
}

async function detectDocumentIssues(contractorId: string): Promise<DetectedIssue[]> {
  const insights: DetectedIssue[] = []

  // P0-2: Use originalName + size for dedup (not doc.id)
  const needsOcr = await db.document.findMany({ where: { contractorId, status: 'needs_ocr' }, select: { id: true, originalName: true, size: true } })
  for (const doc of needsOcr) {
    insights.push({
      type: 'risk', title: `"${doc.originalName}" needs OCR`,
      detail: 'Scanned PDF. Configure OCR provider to extract.',
      confidence: 0.85, source: 'document', sourceId: doc.id, sourceName: doc.originalName,
      dedupKey: `needs_ocr:${doc.originalName}:${doc.size}`,
      resolutionStrategy: 'escalate_only' as const,
    })
  }

  const failed = await db.document.findMany({ where: { contractorId, status: 'failed' }, select: { id: true, originalName: true, size: true } })
  for (const doc of failed) {
    insights.push({
      type: 'observation', title: `"${doc.originalName}" failed analysis`,
      detail: 'Try reprocessing.',
      confidence: 0.8, source: 'document', sourceId: doc.id, sourceName: doc.originalName,
      dedupKey: `failed_doc:${doc.originalName}:${doc.size}`,
      resolutionStrategy: 'escalate_only' as const,
    })
  }

  return insights
}

async function detectUnderScopedEstimates(contractorId: string): Promise<DetectedIssue[]> {
  const insights: DetectedIssue[] = []
  const docs = await db.document.findMany({
    where: { contractorId, fileType: 'estimate', status: 'reviewed' },
    select: { id: true, originalName: true, size: true, extractedData: true, customerId: true },
  })

  // P0-2: Deduplicate by originalName + size — only process each unique file once
  const seen = new Set<string>()
  for (const doc of docs) {
    const dedupHash = `${doc.originalName}:${doc.size}`
    if (seen.has(dedupHash)) continue
    seen.add(dedupHash)

    if (!doc.extractedData) continue
    try {
      const data = JSON.parse(doc.extractedData)
      const lineItems = data.lineItems || []
      const rcv = data.rcv || data.totalAmount || 0
      if (lineItems.length < 5 && rcv > 5000) {
        insights.push({
          type: 'opportunity',
          title: `"${doc.originalName}" may be under-scoped (${lineItems.length} items, $${rcv.toLocaleString()})`,
          detail: `Review for missing items. Supplement opportunity.`,
          confidence: 0.65, source: 'document', sourceId: doc.id, sourceName: doc.originalName,
          dedupKey: `under_scoped:${doc.originalName}:${doc.size}`,
          resolutionStrategy: 'escalate_only' as const,
          customerId: doc.customerId ?? undefined,
        })
      }
    } catch {}
  }

  return insights
}

async function detectMissingCustomerInfo(contractorId: string): Promise<DetectedIssue[]> {
  const customers = await db.customer.findMany({
    where: { contractorId, OR: [{ phone: null }, { phone: '' }, { email: null }, { email: '' }, { address: null }, { address: '' }] },
  })

  return customers.map(c => {
    const missing: string[] = []
    if (!c.phone) missing.push('phone')
    if (!c.email) missing.push('email')
    if (!c.address) missing.push('address')
    return {
      type: 'observation' as InsightType,
      title: `"${c.name}" missing ${missing.join(', ')}`,
      detail: `Customer record incomplete. Missing: ${missing.join(', ')}.`,
      confidence: 0.6, source: 'customer', sourceId: c.id, sourceName: c.name,
      dedupKey: `missing_info:${c.id}:${missing.join(',')}`,
      resolutionStrategy: 'search_documents' as const,
      customerId: c.id,
      missingFields: missing,
    }
  })
}

async function detectOverdueFollowUps(contractorId: string): Promise<DetectedIssue[]> {
  const now = new Date()
  const followUps = await db.followUp.findMany({
    where: { customer: { contractorId }, status: 'pending', dueDate: { lt: now } },
    include: { customer: { select: { name: true, id: true } } },
  })
  return followUps.map(f => ({
    type: 'follow_up' as InsightType,
    title: `Overdue follow-up: ${f.reason} (${Math.floor((now.getTime() - (f.dueDate?.getTime() ?? now.getTime())) / 86400000)}d)`,
    detail: `"${f.reason}" for ${f.customer?.name ?? 'Unknown'}.`,
    confidence: 0.9, source: 'customer', sourceId: f.customerId, sourceName: f.customer?.name,
    dedupKey: `overdue_followup:${f.id}`,
    resolutionStrategy: 'escalate_only' as const,
    customerId: f.customerId ?? undefined,
  }))
}

async function detectProjectsWithoutDocs(contractorId: string): Promise<DetectedIssue[]> {
  const projects = await db.project.findMany({
    where: { contractorId, status: 'active' },
    include: { _count: { select: { documents: true } }, customer: { select: { name: true, id: true } } },
  })
  return projects.filter(p => p._count.documents === 0).map(p => ({
    type: 'recommendation' as InsightType,
    title: `"${p.title}" has no documents`,
    detail: `Upload the insurance estimate to start scope analysis.`,
    confidence: 0.75, source: 'project', sourceId: p.id, sourceName: p.title,
    dedupKey: `no_docs:${p.id}`,
    resolutionStrategy: 'escalate_only' as const,
    customerId: p.customer?.id ?? undefined,
    projectId: p.id,
  }))
}

// ===========================================================================
// P1 DETECTORS — new business intelligence
// ===========================================================================

// P1-1: Customer communication gap — customer hasn't been contacted recently
// P3 FIX (BUG 5): the old version did 3 queries per customer (N+1 pattern).
// With 100 customers that's 300 queries. Now we batch:
//   - 1 query to fetch all workspace messages since cutoff (with workspaceId)
//   - 1 query to fetch all conversation messages since cutoff
//   - 1 query to fetch all relevant pending follow-ups
// Then we filter in memory. Total: 4 queries instead of 3N.
async function detectCustomerCommunicationGaps(contractorId: string): Promise<DetectedIssue[]> {
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) // 14 days
  const customers = await db.customer.findMany({
    where: { contractorId },
    include: {
      projects: { where: { status: 'active' }, select: { id: true, title: true, workspace: { select: { id: true } } } },
    },
  })
  if (customers.length === 0) return []

  // Build a set of customer names to look for in messages (lowercase for case-insensitive match)
  const customerNames = new Map<string, { id: string; name: string }>()
  for (const c of customers) {
    if (c.projects[0]?.workspace?.id) {
      customerNames.set(c.name.toLowerCase(), { id: c.id, name: c.name })
    }
  }
  if (customerNames.size === 0) return []

  // Batch 1: all workspace messages in the contractor's workspaces since cutoff
  // (We don't filter by customer name in SQL because SQLite LIKE is slow on
  // large message tables; instead we fetch recent messages and filter in memory.)
  const workspaceIds: string[] = []
  for (const c of customers) {
    const wid = c.projects[0]?.workspace?.id
    if (wid) workspaceIds.push(wid)
  }
  const workspaceMessages = await db.workspaceMessage.findMany({
    where: {
      chat: { workspaceId: { in: workspaceIds } },
      createdAt: { gt: cutoff },
    },
    select: { content: true },
    take: 500, // cap to avoid unbounded scans
  }).catch(() => [])

  // Batch 2: all conversation messages since cutoff
  const conversationMessages = await db.message.findMany({
    where: {
      conversation: { contractorId },
      createdAt: { gt: cutoff },
    },
    select: { content: true },
    take: 500,
  }).catch(() => [])

  // Build a set of which customer names appear in recent messages
  const contactedCustomerIds = new Set<string>()
  const allMessages = [...workspaceMessages, ...conversationMessages]
  for (const c of customers) {
    if (!c.projects[0]?.workspace?.id) continue
    const nameLower = c.name.toLowerCase()
    const wasMentioned = allMessages.some(m => m.content.toLowerCase().includes(nameLower))
    if (wasMentioned) contactedCustomerIds.add(c.id)
  }

  // Batch 3: all pending follow-ups due within next 14 days, for these customers
  const now = new Date()
  const twoWeeksOut = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
  const upcomingFollowUps = await db.followUp.findMany({
    where: {
      customer: { contractorId },
      status: 'pending',
      dueDate: { gte: now, lte: twoWeeksOut },
    },
    select: { customerId: true },
  }).catch(() => [])
  const customersWithUpcomingFollowUp = new Set(upcomingFollowUps.map(f => f.customerId))

  const issues: DetectedIssue[] = []
  for (const customer of customers) {
    if (!customer.projects[0]?.workspace?.id) continue
    if (contactedCustomerIds.has(customer.id)) continue
    if (customersWithUpcomingFollowUp.has(customer.id)) continue

    issues.push({
      type: 'risk' as InsightType,
      title: `No communication with "${customer.name}" in 14+ days`,
      detail: `${customer.name} has an active project but no messages, follow-ups, or conversation mentions in the last 14 days. Consider reaching out.`,
      confidence: 0.75,
      source: 'customer',
      sourceId: customer.id,
      sourceName: customer.name,
      dedupKey: `comm_gap:${customer.id}`,
      resolutionStrategy: 'create_follow_up' as const,
      customerId: customer.id,
    })
  }
  return issues
}

// P1-2: Duplicate document detection — same file uploaded multiple times
async function detectDuplicateDocuments(contractorId: string): Promise<DetectedIssue[]> {
  const docs = await db.document.findMany({
    where: { contractorId },
    select: { id: true, originalName: true, size: true, fileType: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  })

  // Group by originalName + size
  const groups: Record<string, typeof docs> = {}
  for (const doc of docs) {
    const key = `${doc.originalName}:${doc.size}`
    if (!groups[key]) groups[key] = []
    groups[key].push(doc)
  }

  const issues: DetectedIssue[] = []
  for (const [key, group] of Object.entries(groups)) {
    if (group.length > 1) {
      // Keep the most recent, flag the rest as duplicates
      const [newest, ...dups] = group
      issues.push({
        type: 'observation' as InsightType,
        title: `"${newest.originalName}" uploaded ${group.length} times`,
        detail: `This file has been uploaded ${group.length} times. Consider deleting the ${dups.length} duplicate(s) to keep the system clean. Newest copy: ${newest.createdAt.toDateString()}.`,
        confidence: 0.9,
        source: 'document',
        sourceId: newest.id,
        sourceName: newest.originalName,
        dedupKey: `dup_docs:${newest.originalName}:${newest.size}`,
        resolutionStrategy: 'escalate_only' as const,
      })
    }
  }
  return issues
}

// P1-3: Scope offset opportunities — deductible pool from excluded line items
async function detectScopeOffsetOpportunities(contractorId: string): Promise<DetectedIssue[]> {
  const scopes = await db.scopeAnalysis.findMany({
    where: { contractorId },
    include: { document: { select: { id: true, originalName: true, customerId: true } } },
  })

  const issues: DetectedIssue[] = []
  for (const scope of scopes) {
    if (!scope.lineItemsJson) continue
    try {
      const lineItems = JSON.parse(scope.lineItemsJson)
      const excludedItems = lineItems.filter((li: any) => !li.selected)
      if (excludedItems.length === 0) continue

      const excludedRcv = excludedItems.reduce((sum: number, li: any) => sum + (li.rcv || li.total || 0), 0)
      const deductible = scope.deductible ?? 0
      const depRatio = (scope.originalRcv ?? 0) > 0 ? (scope.originalAcv ?? 0) / (scope.originalRcv ?? 1) : 1
      const offsetPool = excludedRcv * depRatio
      const remainingOop = Math.max(0, deductible - offsetPool)
      const pocketFunds = Math.max(0, offsetPool - deductible)

      if (excludedRcv > 500) {
        const docName = scope.document?.originalName ?? 'Unknown'
        issues.push({
          type: 'opportunity' as InsightType,
          title: `"${docName}" — ${excludedItems.length} excluded items worth $${excludedRcv.toLocaleString()} RCV could offset deductible`,
          detail: `Excluded work: $${excludedRcv.toLocaleString()} RCV → ~$${offsetPool.toLocaleString(undefined, { maximumFractionDigits: 0 })} ACV offset. Deductible: $${deductible.toLocaleString()}. Remaining out-of-pocket: $${remainingOop.toLocaleString(undefined, { maximumFractionDigits: 0 })}.${pocketFunds > 0 ? ` Pocket/upgrades: $${pocketFunds.toLocaleString(undefined, { maximumFractionDigits: 0 })}.` : ''}`,
          confidence: 0.8,
          source: 'document',
          sourceId: scope.documentId,
          sourceName: docName,
          dedupKey: `scope_offset:${scope.documentId}`,
          resolutionStrategy: 'escalate_only' as const,
          customerId: scope.document?.customerId ?? undefined,
        })
      }
    } catch {}
  }
  return issues
}

// P1-4: Conversation promise tracker — detect promises made in chat
// P3 FIX (BUG 6): the old version did N+1 queries (one findFirst per promise
// message to check for a later user message). Now we batch by fetching the
// latest user message per conversation in a single query, and comparing
// timestamps in memory.
async function detectConversationPromises(contractorId: string): Promise<DetectedIssue[]> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // last 7 days

  // Search for promise patterns in messages
  const messages = await db.message.findMany({
    where: {
      conversation: { contractorId },
      role: 'assistant',
      createdAt: { gt: cutoff },
    },
    select: { id: true, content: true, createdAt: true, conversationId: true },
    take: 100,
    orderBy: { createdAt: 'desc' },
  })
  if (messages.length === 0) return []

  // Batch: fetch all user messages in the relevant conversations since the
  // oldest assistant message. We'll group by conversationId and find the
  // latest user message per conversation in memory.
  const conversationIds = [...new Set(messages.map(m => m.conversationId))]
  const oldestAssistantAt = messages.reduce(
    (min, m) => m.createdAt < min ? m.createdAt : min,
    messages[0].createdAt,
  )
  const userMessages = await db.message.findMany({
    where: {
      conversationId: { in: conversationIds },
      role: 'user',
      createdAt: { gte: oldestAssistantAt },
    },
    select: { conversationId: true, createdAt: true },
  })
  // Map: conversationId → latest user message createdAt
  const latestUserMsgByConvo = new Map<string, Date>()
  for (const um of userMessages) {
    const existing = latestUserMsgByConvo.get(um.conversationId)
    if (!existing || um.createdAt > existing) {
      latestUserMsgByConvo.set(um.conversationId, um.createdAt)
    }
  }

  const issues: DetectedIssue[] = []
  const promisePatterns = [
    /i'?ll (call|contact|reach out to|follow up with|message|email|text) (?:you|them|the customer|the adjuster|the carrier)/i,
    /i will (call|contact|reach out|follow up|message|email|text)/i,
    /let me (call|contact|reach out to|follow up with|message|email|text)/i,
    /i'?ll (send|forward|provide|share|get back to you)/i,
    /(?:within|in) (\d+) (?:hours?|days?)/i,
    /(?:promise|committed|scheduled) (?:to|for|by)/i,
  ]

  for (const msg of messages) {
    const content = msg.content
    for (const pattern of promisePatterns) {
      const match = content.match(pattern)
      if (match) {
        // Extract the promise context (sentence containing the match)
        const startIdx = Math.max(0, (match.index ?? 0) - 50)
        const endIdx = Math.min(content.length, (match.index ?? 0) + match[0].length + 100)
        const promiseText = content.slice(startIdx, endIdx).trim()

        // P3 FIX (BUG 6): in-memory check against the batched user-message map
        const latestUserAt = latestUserMsgByConvo.get(msg.conversationId)
        const hasFollowUp = latestUserAt ? latestUserAt > msg.createdAt : false

        const ageHours = Math.floor((Date.now() - msg.createdAt.getTime()) / (60 * 60 * 1000))

        if (!hasFollowUp && ageHours > 24) {
          issues.push({
            type: 'follow_up' as InsightType,
            title: `Promise unfulfilled: "${match[0]}" (${ageHours}h ago)`,
            detail: `Jobrolo promised: "${promiseText}". No follow-up activity detected in ${ageHours} hours. Consider checking if this was completed.`,
            confidence: 0.6,
            source: 'conversation',
            sourceId: msg.id,
            sourceName: 'Conversation',
            dedupKey: `promise:${msg.id}`,
            resolutionStrategy: 'escalate_only' as const,
          })
        }
        break // Only one promise per message
      }
    }
  }
  return issues
}
