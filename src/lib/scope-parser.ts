// Scope parser — ported from Replit build. Rule-based Xactimate/Symbility extraction.
export function detectEstimateFormat(text: string): string { const l = text.toLowerCase(); if (l.includes('xactimate') || l.includes('price list:') || l.includes('age/life') || l.includes('dep %')) return 'xactimate'; if (l.includes('symbility') || l.includes('claimconnect')) return 'symbility'; return 'unknown' }
export function inferTrade(d: string): string { d = d.toLowerCase(); if (d.includes('roof') || d.includes('shingle') || d.includes('felt') || d.includes('drip edge') || d.includes('starter') || d.includes('ridge') || d.includes('valley') || d.includes('flashing') || d.includes('vent')) return 'Roofing'; if (d.includes('paint') || d.includes('prime')) return 'Paint'; if (d.includes('siding') || d.includes('window') || d.includes('door')) return 'Exterior'; if (d.includes('fence')) return 'Fence'; if (d.includes('gutter')) return 'Gutters'; if (d.includes('a/c') || d.includes('hvac')) return 'HVAC'; if (d.includes('clean') || d.includes('debris')) return 'Cleaning'; return 'General' }
export function inferCategory(d: string): string { d = d.toLowerCase(); if (d.includes('tear off') || d.includes('remove') || d.includes('dispose')) return 'Tear Off'; if (d.includes('laminated') && d.includes('shingle')) return 'Roof Covering'; if (d.includes('felt') || d.includes('underlayment')) return 'Underlayment'; if (d.includes('drip edge')) return 'Drip Edge'; if (d.includes('starter')) return 'Starter'; if (d.includes('ridge') || d.includes('hip')) return 'Ridge'; if (d.includes('valley')) return 'Valley'; if (d.includes('pipe jack') || d.includes('flashing')) return 'Flashing'; if (d.includes('vent')) return 'Ventilation'; if (d.includes('gutter')) return 'Gutters'; if (d.includes('fence')) return 'Fence'; return 'General' }
function parseMoney(v: string | null | undefined): number { if (!v) return 0; const n = Number(String(v).replace(/[$,]/g, '')); return Number.isFinite(n) ? n : 0 }
function parseMoneyOrNull(v: string | null | undefined): number | null { if (!v) return null; const c = String(v).replace(/[$,()<>\s]/g, ''); if (!c) return null; const n = Number(c); return Number.isFinite(n) ? n : null }

export interface ParsedLineItem { lineNumber: string; description: string; quantity: string; unit: string; unitPrice: string | null; tax: string | null; overheadAndProfit: string | null; rcv: string | null; depreciation: string | null; acv: string | null; trade: string; category: string; rawAmountBlock: string; selected: boolean; sourceIndex: number }
export function extractLineItems(text: string): ParsedLineItem[] {
  const norm = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ')
  return Array.from(norm.matchAll(/(?:^|\n)(\d+)\.\s+([\s\S]*?)(?=\n\d+\.\s+|\nTotals?:|\nTotal:|\nSummary|\nRecap|\nGrand Total|$)/g)).map(m => {
    const ln = m[1], block = m[2].replace(/\n+/g, ' ').trim(), si = m.index ?? 0

    // Xactimate/Wellington format: DESCRIPTION QUANTITY UNIT PRICE TAX RCV DEPREC ACV
    // e.g. "Clean with pressure/chemical spray 1,272.00 SF 0.48 1.05 611.61 (0.00) 611.61"
    // Depreciation can be (0.00), <56.92>, or 0.00
    const im = block.match(/^(.+?)\s+([\d,]+(?:\.\d+)?)\s*(SQ|LF|EA|SF|SY|HR|DAY|BID|MO|WK|YD|PCS|BOX|ROLL|BUNDLE)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s+[<(]?([\d,]+(?:\.\d+)?)[>)]?\s+([\d,]+(?:\.\d+)?)/i)
    if (im) {
      const desc = im[1].trim()
      return {
        lineNumber: ln,
        description: desc,
        quantity: im[2],
        unit: im[3],
        unitPrice: `$${im[4]}`,
        tax: `$${im[5]}`,
        overheadAndProfit: '$0.00',
        rcv: `$${im[6]}`,
        depreciation: `$${im[7]}`,
        acv: `$${im[8]}`,
        trade: inferTrade(desc),
        category: inferCategory(desc),
        rawAmountBlock: block,
        selected: true,
        sourceIndex: si,
      } as ParsedLineItem
    }

    // Fallback: old format with fewer fields (no tax/depreciation)
    const im2 = block.match(/^(.+?)\s+([\d,]+(?:\.\d+)?)\s*(SQ|LF|EA|SF|SY|HR|DAY|BID|MO|WK|YD)\s*([\d,]+(?:\.\d+)?)\s*([\d,]+(?:\.\d+)?)\s*([\d,]+(?:\.\d+)?)\s*([\d,]+(?:\.\d+)?)/i)
    if (im2) {
      const desc = im2[1].trim()
      const dep = block.match(/[<(]([\d,]+(?:\.\d+)?)[>)]/), acv = block.match(/[>)]\s*([\d,]+(?:\.\d+)?)\s*(?:$|[A-Z])/)
      return { lineNumber: ln, description: desc, quantity: im2[2], unit: im2[3], unitPrice: `$${im2[4]}`, tax: `$${im2[5]}`, overheadAndProfit: `$${im2[6]}`, rcv: `$${im2[7]}`, depreciation: dep ? `$${dep[1]}` : '$0.00', acv: acv ? `$${acv[1]}` : null, trade: inferTrade(desc), category: inferCategory(desc), rawAmountBlock: block, selected: true, sourceIndex: si } as ParsedLineItem
    }
    return null
  }).filter(Boolean) as ParsedLineItem[]
}

export function extractFinancials(text: string) {
  const tm = text.match(/CoverageItem Total%ACV Total%[\s\S]*?Total([\d,]+\.\d{2})100\.00%([\d,]+\.\d{2})100\.00%/)
  const gtm = text.match(/Grand Total[\s\S]*?RCV[:\s]*([\d,]+\.\d{2})/i)
  const litm = text.match(/Line Item Total\s*([\d,]+\.\d{2})/)
  const rawRcv = tm?.[1] ?? gtm?.[1] ?? litm?.[1] ?? null, rawAcv = tm?.[2] ?? null
  const rcv = rawRcv ? `$${rawRcv}` : 'Not extracted yet', acv = rawAcv ? `$${rawAcv}` : 'Not extracted yet'
  const ded = text.match(/Less Deductible\(([\d,]+\.\d{2})\)/)?.[1] ?? text.match(/Deductible[:\s]+\(?([\d,]+\.\d{2})\)?/i)?.[1] ?? null
  const acvN = rawAcv ? Number(rawAcv.replace(/,/g, '')) : null, dedN = ded ? Number(ded.replace(/,/g, '')) : null
  const net = acvN !== null && dedN !== null ? `$${(acvN - dedN).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'Not extracted yet'
  return { rcv, acv, deductible: ded ? `$${ded}` : 'Not extracted yet', netClaim: net, overhead: 'Not extracted yet', profit: 'Not extracted yet', overheadAndProfit: 'Not extracted yet', taxes: 'Not extracted yet', recoverableDepreciation: 'Not extracted yet', nonRecoverableDepreciation: 'Not extracted yet' }
}

export function parseScope(text: string) { return { format: detectEstimateFormat(text), financials: extractFinancials(text), lineItems: extractLineItems(text), structures: [{ name: 'Scope of Loss', type: 'structure', trades: [], roofSquares: null, installSquares: null, totals: { selectedItems: 0, tax: '$0.00', overheadAndProfit: '$0.00', rcv: '$0.00', depreciation: '$0.00', acv: '$0.00' }, lineItems: [] }] } }
export function summarizeScope(scopeData: any) { if (!scopeData) return { rcv: null, acv: null, deductible: null, lineItemCount: 0, structureCount: 0 }; const s = Array.isArray(scopeData.structures) ? scopeData.structures : []; let count = 0, rcv = 0; for (const st of s) for (const item of (st.lineItems || [])) { count++; const r = parseMoneyOrNull(item?.rcv); if (r) rcv += r } return { rcv: parseMoneyOrNull(scopeData.financials?.rcv) ?? (count > 0 ? rcv : null), acv: parseMoneyOrNull(scopeData.financials?.acv), deductible: parseMoneyOrNull(scopeData.financials?.deductible), lineItemCount: count, structureCount: s.length } }
