// =============================================================================
// Entity Extractor — regex-based extraction for insurance + contractor entities
// =============================================================================
// Fast deterministic extraction. Used as a complement to AI extraction —
// catches entities the AI might miss, and provides ground truth when AI is
// rate-limited.
//
// P2 ENTITY OWNERSHIP RULES (do not violate):
//   - customer.email / customer.phone / customer.address can ONLY be populated
//     from text that is explicitly labeled as the homeowner's contact info
//     (e.g. "Insured Phone:", "Homeowner Email:", "Customer Contact:").
//   - Adjuster phones/emails go into claimInfo.adjusterPhone / adjusterEmail.
//   - Carrier phones/emails go into carrierPhone / carrierEmail.
//   - Contractor / mortgage contacts go into their own fields.
//   - Bare (unlabeled) emails/phones go into `unknownEmails` / `unknownPhones`
//     — they are NOT auto-assigned to customer.*. The radar will escalate
//     those for human review.
// =============================================================================

export interface ExtractedEntities {
  claimInfo: {
    claimNumber?: string
    policyNumber?: string
    carrier?: string
    carrierPhone?: string
    carrierEmail?: string
    insured?: string
    adjuster?: string
    adjusterPhone?: string
    adjusterEmail?: string
    dateOfLoss?: string
    deductible?: number
    rcv?: number
    acv?: number
    depreciation?: number
    mortgageCompany?: string
    mortgagePhone?: string
    mortgageEmail?: string
  }
  customer: {
    name?: string
    address?: string
    phone?: string
    email?: string
  }
  contractor: {
    name?: string
    phone?: string
    email?: string
  }
  project: {
    address?: string
    description?: string
  }
  phones: string[]
  emails: string[]
  dates: string[]
  dollarAmounts: number[]
  // P2: emails/phones we couldn't confidently attribute to any entity.
  // Stored for transparency — NEVER auto-applied to customer.*.
  unknownEmails: string[]
  unknownPhones: string[]
}

export function extractEntities(text: string): ExtractedEntities {
  const result: ExtractedEntities = {
    claimInfo: {},
    customer: {},
    contractor: {},
    project: {},
    phones: [],
    emails: [],
    dates: [],
    dollarAmounts: [],
    unknownEmails: [],
    unknownPhones: [],
  }

  if (!text) return result

  // ----- Claim number -----
  // "Claim Number: CLM-2024-1234" / "Claim # 1234567" / "Claim No. ABC123"
  const claimM = text.match(/claim\s*(?:number|#|no\.?)\s*[:#]?\s*([A-Z0-9][A-Z0-9\-\/]{4,20})/i)
  if (claimM) result.claimInfo.claimNumber = claimM[1].trim()

  // ----- Policy number -----
  const policyM = text.match(/policy\s*(?:number|#|no\.?)\s*[:#]?\s*([A-Z0-9][A-Z0-9\-\/]{4,25})/i)
  if (policyM) result.claimInfo.policyNumber = policyM[1].trim()

  // ----- Carrier (insurance company) -----
  // "Carrier: State Farm" / "Insurance Company: Allstate"
  // Truncate at newlines and at common following labels to prevent bleed.
  const carrierM = text.match(/(?:carrier|insurance\s+company)\s*[:]\s*([A-Z][A-Za-z0-9\s&.,]{2,40})/i)
  if (carrierM) {
    let carrier = carrierM[1].trim()
    // Cut at newline first
    carrier = carrier.split(/\n/)[0].trim()
    // Then cut at common following labels
    carrier = carrier.replace(/\s+(?:Date|Policy|Claim|Insured|Property|Phone|Email|Address|Fax).*/i, '')
    result.claimInfo.carrier = carrier
  }

  // ----- Insured name (homeowner) -----
  // "Insured: John Smith" / "Insured Name: Jane Doe"
  const insuredM = text.match(/insured(?:\s+name)?\s*[:]\s*([A-Z][a-zA-Z\s\-\.]{2,40})/)
  if (insuredM) {
    const name = insuredM[1].trim().replace(/\s+(?:Property|Address|Claim|Policy|Date).*/i, '')
    result.claimInfo.insured = name
    result.customer.name = name
  }

  // P2: Homeowner-labeled phone/email — these are SAFE to put in customer.*
  // "Insured Phone:", "Homeowner Phone:", "Customer Phone:", "Customer Cell:"
  const homeownerPhoneM = text.match(/(?:insured|homeowner|customer|client)\s*(?:'s)?\s*(?:phone|tel|telephone|cell|mobile)\s*[:]\s*([\(\d][\d\s\(\)\-\.]{9,16})/i)
  if (homeownerPhoneM) {
    result.customer.phone = homeownerPhoneM[1].trim()
  }

  const homeownerEmailM = text.match(/(?:insured|homeowner|customer|client)\s*(?:'s)?\s*email\s*[:]\s*([\w.+-]+@[\w-]+\.[\w.-]+)/i)
  if (homeownerEmailM) {
    result.customer.email = homeownerEmailM[1].trim()
  }

  // ----- Adjuster -----
  const adjusterM = text.match(/adjuster(?:\s+name)?\s*[:]\s*([A-Z][a-zA-Z\s\-\.]{2,40})/)
  if (adjusterM) result.claimInfo.adjuster = adjusterM[1].trim().replace(/\s+(?:Phone|Email|Date|Carrier).*/i, '')

  const adjusterPhoneM = text.match(/adjuster(?:'s)?\s+(?:phone|tel)\s*[:]\s*([\(\d][\d\s\(\)\-\.]{9,16})/i)
  if (adjusterPhoneM) result.claimInfo.adjusterPhone = adjusterPhoneM[1].trim()

  const adjusterEmailM = text.match(/adjuster(?:'s)?\s+email\s*[:]\s*([\w.+-]+@[\w-]+\.[\w.-]+)/i)
  if (adjusterEmailM) result.claimInfo.adjusterEmail = adjusterEmailM[1].trim()

  // P2: Carrier phone/email — labeled explicitly
  const carrierPhoneM = text.match(/(?:carrier|insurance\s+company)\s*(?:'s)?\s*(?:phone|tel)\s*[:]\s*([\(\d][\d\s\(\)\-\.]{9,16})/i)
  if (carrierPhoneM) result.claimInfo.carrierPhone = carrierPhoneM[1].trim()

  const carrierEmailM = text.match(/(?:carrier|insurance\s+company)\s*(?:'s)?\s*email\s*[:]\s*([\w.+-]+@[\w-]+\.[\w.-]+)/i)
  if (carrierEmailM) result.claimInfo.carrierEmail = carrierEmailM[1].trim()

  // ----- Date of loss -----
  const dolM = text.match(/date\s+of\s+loss\s*[:]\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\w+\s+\d{1,2},?\s*\d{4})/i)
  if (dolM) result.claimInfo.dateOfLoss = dolM[1].trim()

  // ----- Deductible -----
  const dedM = text.match(/deductible\s*[:]\s*\$?\s*([\d,]+(?:\.\d{2})?)/i)
  if (dedM) {
    const v = parseFloat(dedM[1].replace(/,/g, ''))
    if (!isNaN(v)) result.claimInfo.deductible = v
  }

  // ----- RCV / ACV / Depreciation -----
  const rcvM = text.match(/(?:^|\n|\s)RCV\s*[:]\s*\$?\s*([\d,]+(?:\.\d{2})?)/i)
  if (rcvM) {
    const v = parseFloat(rcvM[1].replace(/,/g, ''))
    if (!isNaN(v)) result.claimInfo.rcv = v
  }

  const acvM = text.match(/(?:^|\n|\s)ACV\s*[:]\s*\$?\s*([\d,]+(?:\.\d{2})?)/i)
  if (acvM) {
    const v = parseFloat(acvM[1].replace(/,/g, ''))
    if (!isNaN(v)) result.claimInfo.acv = v
  }

  // "Less Deductible" pattern also captures depreciation-like data
  const depM = text.match(/depreciation\s*[:]\s*\$?\s*([\d,]+(?:\.\d{2})?)/i)
  if (depM) {
    const v = parseFloat(depM[1].replace(/,/g, ''))
    if (!isNaN(v)) result.claimInfo.depreciation = v
  }

  // ----- Mortgage company -----
  const mortM = text.match(/mortgage(?:\s+company)?\s*[:]\s*([A-Z][A-Za-z0-9\s&.,]{2,50})/i)
  if (mortM) result.claimInfo.mortgageCompany = mortM[1].trim().replace(/\s+(?:Loan|Account|Date).*/i, '')

  const mortPhoneM = text.match(/mortgage(?:\s+company)?\s*(?:'s)?\s*(?:phone|tel)\s*[:]\s*([\(\d][\d\s\(\)\-\.]{9,16})/i)
  if (mortPhoneM) result.claimInfo.mortgagePhone = mortPhoneM[1].trim()

  const mortEmailM = text.match(/mortgage(?:\s+company)?\s*(?:'s)?\s*email\s*[:]\s*([\w.+-]+@[\w-]+\.[\w.-]+)/i)
  if (mortEmailM) result.claimInfo.mortgageEmail = mortEmailM[1].trim()

  // ----- Contractor -----
  const contractorM = text.match(/contractor(?:\s+name)?\s*[:]\s*([A-Z][A-Za-z0-9\s&.,\-]{2,50})/i)
  if (contractorM) result.contractor.name = contractorM[1].trim().replace(/\s+(?:Phone|Email|License|Date).*/i, '')

  const contractorPhoneM = text.match(/contractor(?:'s)?\s+(?:phone|tel)\s*[:]\s*([\(\d][\d\s\(\)\-\.]{9,16})/i)
  if (contractorPhoneM) result.contractor.phone = contractorPhoneM[1].trim()

  const contractorEmailM = text.match(/contractor(?:'s)?\s+email\s*[:]\s*([\w.+-]+@[\w-]+\.[\w.-]+)/i)
  if (contractorEmailM) result.contractor.email = contractorEmailM[1].trim()

  // ----- Customer address / project address -----
  // "Property: 123 Main St, Springfield, IL 62701" / "Project Address: ..."
  // Truncate at newline first to prevent bleed into following labels.
  const propM = text.match(/(?:property|project|job\s+site|loss\s+address)\s*[:]\s*([\d][A-Za-z0-9\s\.,#\-]{5,60})/i)
  if (propM) {
    let addr = propM[1].trim()
    // Cut at newline first
    addr = addr.split(/\n/)[0].trim()
    // Then cut at common following labels
    addr = addr.replace(/\s+(?:Insured|Claim|Policy|Carrier|Date|Adjuster|Mortgage|Phone|Email|Fax).*/i, '')
    result.project.address = addr
    result.customer.address = addr
  }

  // ----- All phone numbers -----
  // P2: Build a set of "known owner" phones so we can classify unknowns.
  const knownPhones = new Set<string>([
    result.claimInfo.adjusterPhone,
    result.claimInfo.carrierPhone,
    result.claimInfo.mortgagePhone,
    result.contractor.phone,
    result.customer.phone,
  ].filter((p): p is string => Boolean(p && p.trim())))

  const phoneMatches = text.matchAll(/\(?\d{3}\)?[-.\s]?\d{3}[-.]?\d{4}/g)
  for (const m of phoneMatches) {
    const phone = m[0].trim()
    if (!result.phones.includes(phone)) result.phones.push(phone)
    // P2: Track phones that didn't match any entity-labeled pattern.
    if (!knownPhones.has(phone) && !result.unknownPhones.includes(phone)) {
      result.unknownPhones.push(phone)
    }
  }

  // ----- All emails -----
  // P2: Build a set of "known owner" emails so we can classify unknowns.
  const knownEmails = new Set<string>([
    result.claimInfo.adjusterEmail,
    result.claimInfo.carrierEmail,
    result.claimInfo.mortgageEmail,
    result.contractor.email,
    result.customer.email,
  ].filter((e): e is string => Boolean(e && e.trim())))

  const emailMatches = text.matchAll(/[\w.+-]+@[\w-]+\.[\w.-]+/g)
  for (const m of emailMatches) {
    const email = m[0].trim()
    if (!result.emails.includes(email)) result.emails.push(email)
    // P2: Track emails that didn't match any entity-labeled pattern.
    if (!knownEmails.has(email) && !result.unknownEmails.includes(email)) {
      result.unknownEmails.push(email)
    }
  }

  // ----- All dates -----
  const datePatterns = [
    /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g,
    /\b\d{1,2}-\d{1,2}-\d{2,4}\b/g,
    /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s*\d{4}\b/gi,
  ]
  for (const p of datePatterns) {
    for (const m of text.matchAll(p)) {
      const d = m[0].trim()
      if (!result.dates.includes(d)) result.dates.push(d)
    }
  }

  // ----- All dollar amounts -----
  const dollarMatches = text.matchAll(/\$\s*([\d,]+(?:\.\d{2})?)/g)
  for (const m of dollarMatches) {
    const v = parseFloat(m[1].replace(/,/g, ''))
    if (!isNaN(v) && !result.dollarAmounts.includes(v)) result.dollarAmounts.push(v)
  }

  // P2: REMOVED the old "first phone goes to customer.phone" heuristic.
  // It was the second leading cause of customer-record corruption — bare
  // phone numbers in a doc were often the adjuster's or contractor's.
  // Now customer.phone is only set when the text explicitly labels it as
  // the homeowner's (see homeownerPhoneM above). Bare phones go to
  // `unknownPhones` and the radar will escalate for human review.

  return result
}

/**
 * Merge AI-extracted entities with regex-extracted entities.
 * Regex wins for things it catches (deterministic); AI fills in the rest.
 *
 * P2: We also sanitize the AI's `customer` sub-object. If the AI put an
 * adjuster/carrier email/phone into customer.email/customer.phone (which
 * still happens occasionally despite the prompt), we detect the value match
 * and remove it from customer.* so downstream code can't poison the
 * Customer record.
 */
export function mergeEntities(aiExtracted: Record<string, unknown> | null, regexExtracted: ExtractedEntities): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...(aiExtracted ?? {}) }

  // Merge claimInfo — regex takes precedence for fields it found
  const aiClaim = (merged.claimInfo ?? {}) as Record<string, unknown>
  const mergedClaim: Record<string, unknown> = { ...aiClaim }
  for (const [k, v] of Object.entries(regexExtracted.claimInfo)) {
    if (v !== undefined && v !== null && v !== '') {
      mergedClaim[k] = v
    }
  }
  merged.claimInfo = mergedClaim

  // Merge customer
  const aiCustomer = (merged.customer ?? {}) as Record<string, unknown>
  const mergedCustomer: Record<string, unknown> = { ...aiCustomer }

  // P2: If AI returned customer as a STRING (some prompts return just the name),
  // convert it to an object so the merge doesn't corrupt the shape.
  if (typeof mergedCustomer === 'string') {
    const name = mergedCustomer
    merged.customer = { name }
  } else {
    for (const [k, v] of Object.entries(regexExtracted.customer)) {
      if (v !== undefined && v !== null && v !== '') {
        mergedCustomer[k] = v
      }
    }
    merged.customer = mergedCustomer
  }

  // Merge contractor (new in P2)
  const aiContractor = (merged.contractor ?? {}) as Record<string, unknown>
  const mergedContractor: Record<string, unknown> = { ...aiContractor }
  for (const [k, v] of Object.entries(regexExtracted.contractor)) {
    if (v !== undefined && v !== null && v !== '') {
      mergedContractor[k] = v
    }
  }
  merged.contractor = mergedContractor

  // Merge project
  const aiProject = (merged.project ?? {}) as Record<string, unknown>
  const mergedProject: Record<string, unknown> = { ...aiProject }
  for (const [k, v] of Object.entries(regexExtracted.project)) {
    if (v !== undefined && v !== null && v !== '') {
      mergedProject[k] = v
    }
  }
  merged.project = mergedProject

  // Phones, emails, dates, dollarAmounts — regex always wins (deterministic)
  if (regexExtracted.phones.length) merged.phones = regexExtracted.phones
  if (regexExtracted.emails.length) merged.emails = regexExtracted.emails
  if (regexExtracted.dates.length) merged.dates = regexExtracted.dates
  if (regexExtracted.dollarAmounts.length) merged.dollarAmounts = regexExtracted.dollarAmounts
  if (regexExtracted.unknownEmails.length) merged.unknownEmails = regexExtracted.unknownEmails
  if (regexExtracted.unknownPhones.length) merged.unknownPhones = regexExtracted.unknownPhones

  // P2: SANITIZE — if customer.email matches claimInfo.adjusterEmail or carrierEmail,
  // remove it from customer.email. The AI sometimes copies the adjuster email
  // into customer.email despite the prompt instructions.
  const claimInfo = (merged.claimInfo ?? {}) as Record<string, unknown>
  const customer = merged.customer as Record<string, unknown>
  if (customer && typeof customer === 'object') {
    const adjusterEmail = String(claimInfo.adjusterEmail ?? '').toLowerCase().trim()
    const carrierEmail = String(claimInfo.carrierEmail ?? '').toLowerCase().trim()
    const mortgageEmail = String(claimInfo.mortgageEmail ?? '').toLowerCase().trim()
    const contractorEmail = String(mergedContractor.email ?? '').toLowerCase().trim()

    const custEmail = String(customer.email ?? '').toLowerCase().trim()
    if (custEmail && [adjusterEmail, carrierEmail, mortgageEmail, contractorEmail].includes(custEmail)) {
      delete customer.email
    }

    const adjusterPhone = String(claimInfo.adjusterPhone ?? '').toLowerCase().replace(/\D/g, '').trim()
    const carrierPhone = String(claimInfo.carrierPhone ?? '').toLowerCase().replace(/\D/g, '').trim()
    const mortgagePhone = String(claimInfo.mortgagePhone ?? '').toLowerCase().replace(/\D/g, '').trim()
    const contractorPhone = String(mergedContractor.phone ?? '').toLowerCase().replace(/\D/g, '').trim()

    const custPhone = String(customer.phone ?? '').toLowerCase().replace(/\D/g, '').trim()
    if (custPhone && [adjusterPhone, carrierPhone, mortgagePhone, contractorPhone].includes(custPhone)) {
      delete customer.phone
    }
  }

  return merged
}
