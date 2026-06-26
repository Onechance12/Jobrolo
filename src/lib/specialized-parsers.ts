import { inferTrade, inferCategory } from './scope-parser'

export interface AbcSupplyItem {
  name: string
  sku?: string
  manufacturer?: string
  productLine?: string
  category: string
  unit: string
  unitPrice: number
  alternateUnit?: string
  alternateUnitPrice?: number
  quantity?: number
  extendedPrice?: number
  sourceLineNumber?: string
}

// Roofing-specific synonyms — when a user searches for one term, also match these
export const ROOFING_SYNONYMS: Record<string, string[]> = {
  'pipe jack': ['lead jack', 'bullet boot', 'pipe boot', 'pipe flashing', 'roof jack', '3 in 1', '3-in-1', 'auto caulk', 'storm collar', 'lead boot'],
  'pipe boot': ['lead jack', 'bullet boot', 'pipe jack', 'pipe flashing', 'roof jack', '3 in 1', '3-in-1', 'auto caulk'],
  'lead boot': ['lead jack', 'bullet boot', 'pipe jack', 'pipe boot', 'pipe flashing'],
  'bullet boot': ['lead jack', 'pipe jack', 'pipe boot', 'pipe flashing'],
  'shingle': ['timberline', 'heritage', 'royal sovereign', 'elk', 'atlas', 'certainteed', 'owens corning', 'gaf', 'tamko', 'iko', 'malarkey', 'landmark', 'pinnacle'],
  'underlayment': ['felt', 'synthetic', 'tiger paw', 'ice and water', 'ice & water', 'iws', 'mulehide', 'weatherwatch'],
  'starter': ['pro start', 'prostart', 'startermatch', 'weatherblocker', 'starter strip'],
  'hip and ridge': ['hip & ridge', 'hip &amp; ridge', 'timbertex', 'z ridge', 'designer h&r', 'designer hr', 'cobra'],
  'drip edge': ['drip', 'edging', 'flashing'],
  'valley': ['valley metal', 'valley roll', 'w valley'],
  'vent': ['turbine', 'static vent', 'power vent', 'ridge vent', 'airvent', 'lomanco'],
  'flashing': ['step flashing', 'base flashing', 'counter flashing', 'versa cap', 'gravel guard', 'cap flashing'],
  'nail': ['fastener', 'screw', 'coil', 'cap nail'],
  'caulk': ['sealant', 'cement', 'mastic', 'triple combo', 'tri combo'],
  'gutter': ['downspout', 'leader', 'elbow', 'gutter coil'],
  'skylight': ['curb mount', 'deck mount', 'velux'],
}

// Expanded category keywords — pipe jacks go in "Pipe Flashing" not "Sealants"
const CATEGORY_KEYWORDS: Array<{ name: string; keywords: string[] }> = [
  { name: 'Shingles', keywords: ['tamko', 'gaf ', 'certainteed', 'atlas', 'owens', 'iko', 'malarkey', 'elk', 'landmark', 'pinnacle', 'royal sovereign', 'timberline', 'heritage', 'designer', 'presidential', 'highland'] },
  { name: 'Underlayment', keywords: ['felt', 'underlayment', 'synthetic', 'undrl', 'ice and water', 'ice & water', 'ice & wtr', 'iws', 'mulehide', 'weatherwatch', 'storm guard', 'leak barrier'] },
  { name: 'Starter', keywords: ['starter', 'pro start', 'prostart', 'startermatch', 'weatherblocker'] },
  { name: 'Hip & Ridge', keywords: ['hip', 'ridge', 'timbertex', 'z ridge', 'cobra', 'ridglass'] },
  { name: 'Drip Edge', keywords: ['drip', 'edging', 'roof edge', 'rf edge', 'nrea'] },
  { name: 'Pipe Flashing', keywords: ['lead jack', 'bullet boot', 'pipe boot', 'pipe jack', 'roof jack', '3 in 1', '3-in-1', '3n1', 'base flash', 'auto caulk', 'storm collar', 'lead boot', 'neoprene', 'epdm'] },
  { name: 'Flashing', keywords: ['flashing', 'valley', 'step flashing', 'base flashing', 'counter flashing', 'versa cap', 'gravel guard', 'cap flashing', 'chimney'] },
  { name: 'Ventilation', keywords: ['vent', 'turbine', 'exhaust', 'intake', 'ridge vent', 'static vent', 'power vent', 'airvent', 'lomanco', 'cobra'] },
  { name: 'Fasteners', keywords: ['nail', 'screw', 'coil', 'cap nail', 'staple', 'fastener'] },
  { name: 'Sealants', keywords: ['sealant', 'cement', 'mastic', 'caulk', 'triple combo', 'tri combo', 'geocel', 'Henry'] },
  { name: 'Gutters', keywords: ['gutter', 'downspout', 'leader', 'elbow', 'gutter coil'] },
  { name: 'Decking', keywords: ['osb', 'plywood', 'decking', 'skip sheathing'] },
  { name: 'Skylights', keywords: ['skylight', 'curb mount', 'deck mount', 'velux'] },
]

function cleanName(raw: string): string {
  let name = raw.trim()
  // Remove leading quotes, dashes, slashes
  name = name.replace(/^["'\-\/\.]+/, '')
  // Remove trailing quotes
  name = name.replace(/["']+$/, '')
  // If name contains multiple price/unit patterns merged, take only the first part
  // (e.g. "Valley Metal RL75.45 24" x 50' Galv Roll Valley Metal RL122.90" → "Valley Metal")
  const mergeMatch = name.match(/^(.+?)\s+(?:RL|PC|BD|SQ|EA|LF)\s*[\d.]+/)
  if (mergeMatch) name = mergeMatch[1].trim()
  // Collapse whitespace
  name = name.replace(/\s+/g, ' ').trim()
  // Remove embedded price/unit fragments
  name = name.replace(/\s+(?:RL|PC)\s*[\d.]+\s*/g, ' ').trim()
  // Remove fragment artifacts
  name = name.replace(/^[\/\-]+\s*/, '').trim()
  return name
}

function categorize(name: string): string {
  const nl = name.toLowerCase()
  for (const c of CATEGORY_KEYWORDS) {
    if (c.keywords.some(k => nl.includes(k))) return c.name
  }
  return 'Other'
}

export function parseAbcSupplyPriceList(text: string): AbcSupplyItem[] {
  const items: AbcSupplyItem[] = []
  const he = text.indexOf('Unit Price')
  let body = he > 0 ? text.slice(he + 11) : text
  body = body.replace(/Page \d+ of \d+/gi, '').replace(/ABC Supply #?\d*/gi, '')
  
  const mfrs = ['GAF', 'Tamko', 'CertainTeed', 'Certainteed', 'Atlas', 'Owens Corning', 'Owens', 'IKO', 'Malarkey', 'Elk', 'CertainTeed']
  
  // Improved regex: match unit followed by price, with optional alternate unit+price
  // BD 37.82 or BD 37.82 113.46 (bundle + square pricing)
  const pr = /(?:^|\s)((?:BD|SQ|LF|EA|PCS|BOX|ROLL|BUNDLE|PC|RL)\s*)(\d+\.?\d*)(?:\s+(\d+\.?\d*))?/g
  
  let m, lastEnd = 0
  while ((m = pr.exec(body)) !== null) {
    const fullMatch = m[0]
    const unitMatch = fullMatch.match(/(BD|SQ|LF|EA|PCS|BOX|ROLL|BUNDLE|PC|RL)/g) || []
    const priceMatch = fullMatch.match(/(\d+\.?\d*)/g) || []
    
    if (!priceMatch.length) { lastEnd = m.index + fullMatch.length; continue }
    
    let rawName = body.slice(lastEnd, m.index).trim().replace(/\s+/g, ' ').trim()
    const name = cleanName(rawName)
    
    if (!name || name.length < 3 || name.includes('Effective Date') || name.includes('White Settlement') || name.includes('Scott St') || name.includes('Customer Price')) {
      lastEnd = m.index + fullMatch.length
      continue
    }
    
    // Skip if name looks like a price fragment or page header
    if (/^[\d.\s]+$/.test(name) || name.match(/^\d/)) {
      lastEnd = m.index + fullMatch.length
      continue
    }
    
    const category = categorize(name)
    let manufacturer: string | undefined, productLine: string | undefined
    const nl = name.toLowerCase()
    for (const mfr of mfrs) {
      if (nl.startsWith(mfr.toLowerCase())) {
        manufacturer = mfr
        productLine = name.slice(mfr.length).trim().replace(/\s*\(.*?\)\s*/g, '').trim() || undefined
        break
      }
    }
    
    const item: AbcSupplyItem = {
      name,
      category,
      unit: unitMatch[0] || 'EA',
      unitPrice: parseFloat(priceMatch[0]),
    }
    if (unitMatch.length > 1 && priceMatch.length > 1) {
      item.alternateUnit = unitMatch[1]
      item.alternateUnitPrice = parseFloat(priceMatch[1])
    }
    items.push(item)
    lastEnd = m.index + fullMatch.length
  }
  
  return items
}

export function parseQxoBidProposalPriceList(text: string): AbcSupplyItem[] {
  const items: AbcSupplyItem[] = []
  if (!/bid proposal|new con pricing|qxo|branch number/i.test(text)) return items

  const normalized = text
    .replace(/\r/g, '\n')
    .replace(/\s+/g, ' ')
    .replace(/Page\s+\d+\s+of\s+\d+/gi, ' ')
    .trim()

  const rowPattern = /(?:^|\s)(\d{1,4})\s+(\d+(?:\.\d+)?)\s+([A-Z]{1,5})\s+(?:([A-Z]{1,5})\s+)?(\d+(?:\.\d{2,4}))\s+(?:\d+(?:\.\d{2,4})\s+)?(\d+(?:\.\d{2}))\s+(.+?)(?=\s+\d{1,4}\s+\d+(?:\.\d+)?\s+[A-Z]{1,5}\s+(?:[A-Z]{1,5}\s+)?\d+(?:\.\d{2,4})\s+(?:\d+(?:\.\d{2,4})\s+)?\d+(?:\.\d{2})\s+|$)/g
  let match: RegExpExecArray | null
  while ((match = rowPattern.exec(normalized)) !== null) {
    const [, lineNumber, quantityRaw, quantityUnit, priceUnitRaw, unitPriceRaw, extendedRaw, descriptionRaw] = match
    const unit = (priceUnitRaw || quantityUnit || 'EA').toUpperCase()
    const quantity = Number(quantityRaw)
    const unitPrice = Number(unitPriceRaw)
    const extendedPrice = Number(extendedRaw)
    const cleanDescription = cleanQxoDescription(descriptionRaw)
    if (!cleanDescription || cleanDescription.length < 4) continue
    if (!Number.isFinite(unitPrice) || unitPrice < 0) continue

    const sku = extractQxoSku(cleanDescription)
    const name = stripQxoSku(cleanDescription)
    items.push({
      name,
      sku,
      category: categorize(name),
      unit,
      unitPrice,
      quantity: Number.isFinite(quantity) ? quantity : undefined,
      extendedPrice: Number.isFinite(extendedPrice) ? extendedPrice : undefined,
      sourceLineNumber: lineNumber,
    })
  }

  return items
}

function cleanQxoDescription(value: string) {
  return value
    .replace(/\s+(?:Total|Subtotal|Grand Total|Terms|Signature|Accepted By)\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractQxoSku(value: string) {
  const match = value.match(/\b((?=[A-Z0-9-]*\d)[A-Z0-9-]{5,})\b/)
  return match?.[1]
}

function stripQxoSku(value: string) {
  return value
    .replace(/\b(?=[A-Z0-9-]*\d)[A-Z0-9-]{5,}\b/g, '')
    .replace(/\b\d+BDL\/SQ\b/gi, '')
    .replace(/\b\d+SQ\/RL\b/gi, '')
    .replace(/\b\d+(?:RL|CTN|BDL|SQ|PC|EA)?\/(?:PALLET|PLT|TL|CTN)\b/gi, '')
    .replace(/\s*"(?:FORMER NAME|FORMERLY)[^"]*"/gi, '')
    .replace(/\bFORMERLY\s+\d+\s+\w+\s+PER\s+\w+\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface XactimateLineItem { lineNumber: string; description: string; quantity: number | null; unit: string; unitPrice: number | null; rcv: number | null; depreciation: number | null; acv: number | null; trade: string; category: string }

export function parseXactimateLineItems(text: string): XactimateLineItem[] {
  const items: XactimateLineItem[] = []
  const chunks = text.split(/(?=\d{1,3}\.\s+[A-Z])/)
  for (const chunk of chunks) {
    const t = chunk.trim(); if (!t) continue
    const nm = t.match(/^(\d{1,3})\.\s+/); if (!nm) continue
    const ln = nm[1]
    const um = t.match(/([\d,]+(?:\.\d+)?)\s+(SQ|LF|EA|SF|SY|HR|DAY|BID|MO|WK|YD|PCS|BOX|ROLL|BUNDLE)\s+/i); if (!um) continue
    const qty = parseFloat(um[1].replace(/,/g, '')), unit = um[2].toUpperCase()
    const after = t.slice((um.index ?? 0) + um[0].length)
    let up: number | null = null, rcv: number | null = null, dep: number | null = null, acv: number | null = null

    // Format 1: Full Xactimate with age/life/condition/percentage
    const fm = after.match(/^([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s+(?:\d+\/\d+\s*yr?s?\.?|N\/A)\s+(?:Avg\.|New|Poor|Fair|Good|NA)\s+(?:NA|\d+%)\s+\(([\d,]+(?:\.\d+)?)\)\s+([\d,]+(?:\.\d+)?)/i)
    if (fm) { up = parseFloat(fm[1].replace(/,/g, '')); rcv = parseFloat(fm[2].replace(/,/g, '')); dep = parseFloat(fm[3].replace(/,/g, '')); acv = parseFloat(fm[4].replace(/,/g, '')) }
    // Format 2: Wellington format — PRICE TAX RCV (DEPREC) ACV
    // e.g. "0.48 1.05 611.61 (0.00) 611.61" or "1.21 32.53 1,571.65 <56.92> 1,514.73"
    else {
      const wm = after.match(/^([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s+[<(]?([\d,]+(?:\.\d+)?)[>)]?\s+([\d,]+(?:\.\d+)?)/)
      if (wm) {
        up = parseFloat(wm[1].replace(/,/g, ''))
        // wm[2] = tax, wm[3] = RCV, wm[4] = depreciation, wm[5] = ACV
        rcv = parseFloat(wm[3].replace(/,/g, ''))
        dep = parseFloat(wm[4].replace(/,/g, ''))
        acv = parseFloat(wm[5].replace(/,/g, ''))
      }
      // Format 3: Simple — PRICE RCV
      else {
        const sm = after.match(/^([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)/)
        if (sm) { up = parseFloat(sm[1].replace(/,/g, '')); rcv = parseFloat(sm[2].replace(/,/g, '')) }
      }
    }
    let desc = t.slice(nm[0].length, um.index).trim()
    if (desc.length < 3 || desc.toLowerCase().includes('why does') || desc.toLowerCase().includes('page:')) continue
    items.push({ lineNumber: ln, description: desc, quantity: Number.isFinite(qty) ? qty : null, unit, unitPrice: up, rcv, depreciation: dep, acv, trade: inferTrade(desc), category: inferCategory(desc) })
  }
  return items
}
