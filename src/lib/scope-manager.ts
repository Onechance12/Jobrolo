// =============================================================================
// Scope Manager — line item selection, offset calculation, deductible pool
// =============================================================================
// Core insurance claim scope management:
//   1. Parse line items from a document's extractedData
//   2. Allow user to select/deselect items ("we're not doing the fence")
//   3. Recalculate RCV/ACV based on selected items only
//   4. Track deductible pool — how much deductible remains after offsets
//   5. Generate a breakdown showing what's included vs excluded
// =============================================================================

import { db } from '@/lib/db'

export interface ScopeLineItem {
  id: string
  lineNumber: string
  description: string
  quantity: number | null
  unit: string | null
  unitPrice: number | null
  total: number | null  // RCV for this line
  rcv: number | null
  acv: number | null
  trade: string
  category: string
  selected: boolean
  excludedReason: string | null
}

export interface ScopeBreakdown {
  lineItems: ScopeLineItem[]
  // Original totals from the estimate
  originalRcv: number
  originalAcv: number
  deductible: number
  depreciation: number
  // Selected (included) totals — work we ARE doing
  selectedRcv: number       // total RCV of selected items
  selectedAcv: number       // total ACV of selected items
  selectedItemCount: number
  // Excluded (offset) totals — work we are NOT doing
  excludedRcv: number       // total RCV of excluded items
  excludedAcv: number       // total ACV of excluded items (this is the offset pool)
  excludedItemCount: number
  // Deductible pool calculations
  offsetPoolTotal: number           // ACV value of work not being performed (excluded items)
  remainingOutOfPocket: number      // max(deductible - offsetPoolTotal, 0)
  pocketUpgradeExtraFunds: number   // max(offsetPoolTotal - deductible, 0)
  netClaim: number                  // selectedAcv - remainingOutOfPocket
  // Summary by trade
  trades: Array<{ trade: string; itemCount: number; rcv: number; acv: number; selectedCount: number; excludedCount: number }>
}

// ---------------------------------------------------------------------------
// Initialize a scope analysis from a document's extracted line items
// ---------------------------------------------------------------------------

export async function initScopeAnalysis(documentId: string, contractorId: string): Promise<ScopeBreakdown | null> {
  const doc = await db.document.findUnique({ where: { id: documentId } })
  if (!doc || doc.contractorId !== contractorId) return null

  const extractedData = doc.extractedData ? JSON.parse(doc.extractedData) : {}
  const rawLineItems = (extractedData.lineItems || []) as any[]
  const claimInfo = extractedData.claimInfo || {}

  if (!rawLineItems.length) return null

  // Build line items — calculate RCV as quantity × unitPrice when total is missing or wrong
  const lineItems: ScopeLineItem[] = rawLineItems.map((li, i) => {
    const qty = typeof li.quantity === 'number' ? li.quantity : parseFloat(li.quantity) || 0
    const up = typeof li.unitPrice === 'number' ? li.unitPrice : parseFloat(String(li.unitPrice || '0').replace(/[$,]/g, '')) || 0
    const storedTotal = typeof li.total === 'number' ? li.total : parseFloat(String(li.total || '0').replace(/[$,]/g, '')) || 0
    // If total seems wrong (much smaller than qty×price), recalculate
    const calculatedTotal = qty * up
    const rcv = (storedTotal > 0 && storedTotal >= calculatedTotal * 0.5) ? storedTotal : calculatedTotal
    
    return {
      id: `item-${i}`,
      lineNumber: String(i + 1),  // Always sequential — avoids parser numbering issues
      description: li.description || 'Unknown',
      quantity: qty || null,
      unit: li.unit ?? null,
      unitPrice: up || null,
      total: rcv,
      rcv: rcv,
      acv: null,
      trade: inferTrade(li.description || ''),
      category: inferCategory(li.description || ''),
      selected: true,
      excludedReason: null,
    }
  })

  // Original financials — check both claimInfo and top-level extractedData
  const originalRcv = claimInfo.rcv ?? extractedData.rcv ?? extractedData.totalAmount ?? 0
  const originalAcv = claimInfo.acv ?? extractedData.acv ?? 0
  const deductible = claimInfo.deductible ?? extractedData.deductible ?? 0
  const depreciation = claimInfo.depreciation ?? extractedData.depreciation ?? (originalRcv - originalAcv)

  // Calculate selected totals (all selected initially)
  const breakdown = calculateBreakdown(lineItems, originalRcv, originalAcv, deductible, depreciation)

  // Persist to database
  await db.scopeAnalysis.upsert({
    where: { documentId },
    create: {
      documentId,
      contractorId,
      originalRcv,
      originalAcv,
      deductible,
      depreciation,
      selectedRcv: breakdown.selectedRcv,
      selectedAcv: breakdown.selectedAcv,
      excludedRcv: 0,
      excludedAcv: 0,
      remainingOutOfPocket: deductible,
      lineItemsJson: JSON.stringify(lineItems),
      status: 'in_progress',
    },
    update: {
      originalRcv,
      originalAcv,
      deductible,
      depreciation,
      lineItemsJson: JSON.stringify(lineItems),
    },
  })

  return breakdown
}

// ---------------------------------------------------------------------------
// Toggle a line item's selection state
// ---------------------------------------------------------------------------

export async function toggleLineItem(
  documentId: string,
  contractorId: string,
  itemId: string,
  selected: boolean,
  reason?: string,
): Promise<ScopeBreakdown | null> {
  const scope = await db.scopeAnalysis.findUnique({ where: { documentId } })
  if (!scope || scope.contractorId !== contractorId) {
    // Auto-initialize if not exists
    const init = await initScopeAnalysis(documentId, contractorId)
    if (!init) return null
  }

  const scopeFresh = await db.scopeAnalysis.findUnique({ where: { documentId } })
  if (!scopeFresh) return null

  const lineItems: ScopeLineItem[] = JSON.parse(scopeFresh.lineItemsJson || '[]')
  const item = lineItems.find(li => li.id === itemId)
  if (!item) return null

  item.selected = selected
  item.excludedReason = selected ? null : (reason || 'Excluded by contractor')

  const breakdown = calculateBreakdown(
    lineItems,
    scopeFresh.originalRcv ?? 0,
    scopeFresh.originalAcv ?? 0,
    scopeFresh.deductible ?? 0,
    scopeFresh.depreciation ?? 0,
  )

  await db.scopeAnalysis.update({
    where: { documentId },
    data: {
      lineItemsJson: JSON.stringify(lineItems),
      selectedRcv: breakdown.selectedRcv,
      selectedAcv: breakdown.selectedAcv,
      excludedRcv: breakdown.excludedRcv,
      excludedAcv: breakdown.excludedAcv,
      remainingOutOfPocket: breakdown.remainingOutOfPocket,
    },
  })

  return breakdown
}

// ---------------------------------------------------------------------------
// Toggle by line number (easier for AI to call)
// ---------------------------------------------------------------------------

export async function toggleLineByNumber(
  documentId: string,
  contractorId: string,
  lineNumber: string,
  selected: boolean,
  reason?: string,
): Promise<ScopeBreakdown | null> {
  const scope = await db.scopeAnalysis.findUnique({ where: { documentId } })
  if (!scope) {
    await initScopeAnalysis(documentId, contractorId)
  }
  const scopeFresh = await db.scopeAnalysis.findUnique({ where: { documentId } })
  if (!scopeFresh || scopeFresh.contractorId !== contractorId) return null

  const lineItems: ScopeLineItem[] = JSON.parse(scopeFresh.lineItemsJson || '[]')
  
  // Find by line number — try exact match, then partial match
  let item = lineItems.find(li => li.lineNumber === lineNumber)
  if (!item) {
    item = lineItems.find(li => li.lineNumber.includes(lineNumber) || lineNumber.includes(li.lineNumber))
  }
  if (!item) {
    // Try by description match
    item = lineItems.find(li => li.description.toLowerCase().includes(lineNumber.toLowerCase()))
  }
  if (!item) return null

  item.selected = selected
  item.excludedReason = selected ? null : (reason || 'Excluded by contractor')

  const breakdown = calculateBreakdown(
    lineItems,
    scopeFresh.originalRcv ?? 0,
    scopeFresh.originalAcv ?? 0,
    scopeFresh.deductible ?? 0,
    scopeFresh.depreciation ?? 0,
  )

  await db.scopeAnalysis.update({
    where: { documentId },
    data: {
      lineItemsJson: JSON.stringify(lineItems),
      selectedRcv: breakdown.selectedRcv,
      selectedAcv: breakdown.selectedAcv,
      excludedRcv: breakdown.excludedRcv,
      excludedAcv: breakdown.excludedAcv,
      remainingOutOfPocket: breakdown.remainingOutOfPocket,
    },
  })

  return breakdown
}

// ---------------------------------------------------------------------------
// Get the current scope breakdown for a document
// ---------------------------------------------------------------------------

export async function getScopeBreakdown(documentId: string, contractorId: string): Promise<ScopeBreakdown | null> {
  let scope = await db.scopeAnalysis.findUnique({ where: { documentId } })
  if (!scope) {
    const init = await initScopeAnalysis(documentId, contractorId)
    if (!init) return null
    scope = await db.scopeAnalysis.findUnique({ where: { documentId } })
    if (!scope) return null
  }
  if (scope.contractorId !== contractorId) return null

  const lineItems: ScopeLineItem[] = JSON.parse(scope.lineItemsJson || '[]')
  return calculateBreakdown(
    lineItems,
    scope.originalRcv ?? 0,
    scope.originalAcv ?? 0,
    scope.deductible ?? 0,
    scope.depreciation ?? 0,
  )
}

// ---------------------------------------------------------------------------
// Calculate breakdown from line items + financials
// ---------------------------------------------------------------------------

function calculateBreakdown(
  lineItems: ScopeLineItem[],
  originalRcv: number,
  originalAcv: number,
  deductible: number,
  depreciation: number,
): ScopeBreakdown {
  let selectedRcv = 0
  let selectedAcv = 0
  let excludedRcv = 0
  let excludedAcv = 0
  let selectedCount = 0
  let excludedCount = 0

  // If we have line item totals, use them. Otherwise, estimate proportionally.
  const totalLineItemRcv = lineItems.reduce((sum, li) => sum + (li.rcv || li.total || 0), 0)
  const hasLineItemTotals = totalLineItemRcv > 0

  // Depreciation ratio — used to estimate ACV per line item
  // If RCV = $12,830 and ACV = $8,345, then depRatio = 8345/12830 = 0.651
  // Each line item's ACV = its RCV × depRatio
  const depRatio = originalRcv > 0 ? originalAcv / originalRcv : 1

  for (const li of lineItems) {
    const itemRcv = li.rcv || li.total || 0
    const itemAcv = itemRcv * depRatio

    if (li.selected) {
      selectedRcv += itemRcv
      selectedAcv += itemAcv
      selectedCount++
    } else {
      excludedRcv += itemRcv
      excludedAcv += itemAcv
      excludedCount++
    }
  }

  // If no line item totals, use proportional calculation
  if (!hasLineItemTotals || totalLineItemRcv < originalRcv * 0.5) {
    const selectedRatio = lineItems.length > 0 ? selectedCount / lineItems.length : 1
    selectedRcv = originalRcv * selectedRatio
    selectedAcv = originalAcv * selectedRatio
    excludedRcv = originalRcv * (1 - selectedRatio)
    excludedAcv = originalAcv * (1 - selectedRatio)
  }

  // ── Deductible Pool Calculations ──────────────────────────────────
  // Following the Replit build's logic:
  //
  // offsetPoolTotal = ACV value of work NOT being performed (excluded items)
  // remainingOutOfPocket = max(deductible - offsetPoolTotal, 0)
  // pocketUpgradeExtraFunds = max(offsetPoolTotal - deductible, 0)
  // netClaim = selectedAcv - remainingOutOfPocket
  //
  // Example:
  //   Deductible: $3,300
  //   Offset pool (excluded ACV): $1,000
  //   Remaining out-of-pocket: max(3300 - 1000, 0) = $2,300
  //   Pocket/upgrades: max(1000 - 3300, 0) = $0
  //   Net claim: selectedAcv - $2,300

  const offsetPoolTotal = excludedAcv
  const remainingOutOfPocket = Math.max(0, deductible - offsetPoolTotal)
  const pocketUpgradeExtraFunds = Math.max(0, offsetPoolTotal - deductible)
  const netClaim = Math.max(0, selectedAcv - remainingOutOfPocket)

  // Group by trade — track selected vs excluded per trade
  const tradeMap = new Map<string, { trade: string; itemCount: number; rcv: number; acv: number; selectedCount: number; excludedCount: number }>()
  for (const li of lineItems) {
    const trade = li.trade || 'General'
    if (!tradeMap.has(trade)) {
      tradeMap.set(trade, { trade, itemCount: 0, rcv: 0, acv: 0, selectedCount: 0, excludedCount: 0 })
    }
    const t = tradeMap.get(trade)!
    t.itemCount++
    t.rcv += li.rcv || li.total || 0
    t.acv += (li.rcv || li.total || 0) * depRatio
    if (li.selected) t.selectedCount++
    else t.excludedCount++
  }

  return {
    lineItems,
    originalRcv,
    originalAcv,
    deductible,
    depreciation,
    selectedRcv,
    selectedAcv,
    selectedItemCount: selectedCount,
    excludedRcv,
    excludedAcv,
    excludedItemCount: excludedCount,
    offsetPoolTotal,
    remainingOutOfPocket,
    pocketUpgradeExtraFunds,
    netClaim,
    trades: Array.from(tradeMap.values()).sort((a, b) => b.rcv - a.rcv),
  }
}

// ---------------------------------------------------------------------------
// Trade/category inference (simplified versions)
// ---------------------------------------------------------------------------

function inferTrade(desc: string): string {
  const d = desc.toLowerCase()
  if (d.includes('roof') || d.includes('shingle') || d.includes('felt') || d.includes('underlayment') || d.includes('drip edge') || d.includes('starter') || d.includes('ridge') || d.includes('valley') || d.includes('flashing') || d.includes('vent') || d.includes('pipe jack')) return 'Roofing'
  if (d.includes('paint') || d.includes('prime')) return 'Paint'
  if (d.includes('siding') || d.includes('window') || d.includes('door')) return 'Exterior'
  if (d.includes('fence')) return 'Fence'
  if (d.includes('gutter') || d.includes('downspout')) return 'Gutters'
  if (d.includes('clean') || d.includes('debris')) return 'Cleaning'
  if (d.includes('skylight')) return 'Skylights'
  return 'General'
}

function inferCategory(desc: string): string {
  const d = desc.toLowerCase()
  if (d.includes('tear off') || d.includes('remove') || d.includes('dispose') || d.includes('detach')) return 'Tear Off'
  if (d.includes('laminated') || d.includes('shingle') || d.includes('comp')) return 'Roof Covering'
  if (d.includes('felt') || d.includes('underlayment') || d.includes('synthetic')) return 'Underlayment'
  if (d.includes('drip edge')) return 'Drip Edge'
  if (d.includes('starter')) return 'Starter'
  if (d.includes('ridge') || d.includes('hip')) return 'Ridge'
  if (d.includes('valley')) return 'Valley'
  if (d.includes('pipe jack') || d.includes('flashing') || d.includes('pipe boot') || d.includes('lead jack')) return 'Flashing'
  if (d.includes('vent') || d.includes('exhaust') || d.includes('turbine')) return 'Ventilation'
  if (d.includes('gutter')) return 'Gutters'
  if (d.includes('fence')) return 'Fence'
  if (d.includes('paint') || d.includes('prime')) return 'Paint'
  if (d.includes('window') || d.includes('screen')) return 'Windows'
  if (d.includes('clean') || d.includes('pressure')) return 'Cleaning'
  if (d.includes('skylight')) return 'Skylights'
  return 'General'
}
