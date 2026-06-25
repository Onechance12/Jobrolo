import { db } from '@/lib/db'
import { toFileUrl } from '@/lib/file-url'

export type ContractorProfileInput = {
  companyName?: string | null
  legalName?: string | null
  displayName?: string | null
  logoUrl?: string | null
  logoDocumentId?: string | null
  addressLine1?: string | null
  addressLine2?: string | null
  city?: string | null
  state?: string | null
  postalCode?: string | null
  country?: string | null
  phone?: string | null
  email?: string | null
  website?: string | null
  licenseNumber?: string | null
  insuranceText?: string | null
  ownerName?: string | null
  publicContactName?: string | null
  publicContactTitle?: string | null
  brandPrimaryColor?: string | null
  brandAccentColor?: string | null
  brandMode?: string | null
  defaultTerms?: string | null
  paymentInstructions?: string | null
  warrantyText?: string | null
  legalFooter?: string | null
  reportDisclaimer?: string | null
  contractDisclaimer?: string | null
  estimateDisclaimer?: string | null
  metadata?: unknown
}

function clean(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function cleanUrl(value: string | null | undefined): string | undefined {
  const v = clean(value)
  if (!v) return undefined
  if (v.startsWith('/api/storage/')) return v
  if (v.startsWith('/')) return v
  if (/^https?:\/\//i.test(v)) return v
  return undefined
}

function cleanHex(value: string | null | undefined, fallback: string) {
  const v = clean(value)
  if (!v) return fallback
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toUpperCase() : fallback
}

export function formatCompanyAddress(profile: any): string {
  const cityLine = [profile.city, profile.state, profile.postalCode].filter(Boolean).join(', ').replace(', ', ', ')
  return [profile.addressLine1, profile.addressLine2, cityLine, profile.country && profile.country !== 'US' ? profile.country : null]
    .filter(Boolean)
    .join('\n')
}

export function publicContractorProfile(profile: any) {
  if (!profile) return null
  return {
    id: profile.id,
    contractorId: profile.contractorId,
    companyName: profile.companyName,
    legalName: profile.legalName,
    displayName: profile.displayName ?? profile.companyName ?? profile.legalName,
    logoUrl: profile.logoUrl,
    logoDocumentId: profile.logoDocumentId,
    phone: profile.phone,
    email: profile.email,
    website: profile.website,
    address: formatCompanyAddress(profile),
    addressLine1: profile.addressLine1,
    addressLine2: profile.addressLine2,
    city: profile.city,
    state: profile.state,
    postalCode: profile.postalCode,
    country: profile.country,
    licenseNumber: profile.licenseNumber,
    insuranceText: profile.insuranceText,
    ownerName: profile.ownerName,
    publicContactName: profile.publicContactName,
    publicContactTitle: profile.publicContactTitle,
    brandPrimaryColor: profile.brandPrimaryColor ?? '#2563EB',
    brandAccentColor: profile.brandAccentColor ?? '#06B6D4',
    brandMode: profile.brandMode ?? 'dark',
    defaultTerms: profile.defaultTerms,
    paymentInstructions: profile.paymentInstructions,
    warrantyText: profile.warrantyText,
    legalFooter: profile.legalFooter,
    reportDisclaimer: profile.reportDisclaimer,
    contractDisclaimer: profile.contractDisclaimer,
    estimateDisclaimer: profile.estimateDisclaimer,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  }
}

export async function getContractorProfile(contractorId: string) {
  const profile = await db.contractorProfile.findUnique({ where: { contractorId } }).catch(() => null)
  return profile
}

export async function getOrCreateContractorProfile(contractorId: string) {
  const contractor = await db.contractor.findUnique({ where: { id: contractorId } })
  if (!contractor) return null
  return db.contractorProfile.upsert({
    where: { contractorId },
    update: {},
    create: {
      contractorId,
      companyName: contractor.company ?? contractor.name,
      displayName: contractor.company ?? contractor.name,
      phone: contractor.phone,
      email: contractor.email,
      brandPrimaryColor: '#2563EB',
      brandAccentColor: '#06B6D4',
      brandMode: 'dark',
      reportDisclaimer: 'This roof report documents visible conditions observed at the time of inspection. It is not a determination of insurance coverage, carrier liability, code compliance, or claim approval. Hidden damage, latent defects, and conditions not visible during inspection may exist.',
      legalFooter: 'Review all agreement language before use. Final terms are subject to the contractor\'s approved documents and applicable law.',
    },
  })
}

export async function upsertContractorProfile(contractorId: string, input: ContractorProfileInput) {
  const logoDocumentId = clean(input.logoDocumentId)
  let logoUrl = cleanUrl(input.logoUrl)
  if (logoDocumentId) {
    const logoDoc = await db.document.findFirst({ where: { id: logoDocumentId, contractorId }, select: { filePath: true } })
    if (!logoDoc) throw new Error('Logo document not found')
    logoUrl = toFileUrl(logoDoc.filePath) ?? undefined
  }

  const data = {
    companyName: clean(input.companyName),
    legalName: clean(input.legalName),
    displayName: clean(input.displayName),
    logoUrl,
    logoDocumentId,
    addressLine1: clean(input.addressLine1),
    addressLine2: clean(input.addressLine2),
    city: clean(input.city),
    state: clean(input.state),
    postalCode: clean(input.postalCode),
    country: clean(input.country) ?? 'US',
    phone: clean(input.phone),
    email: clean(input.email),
    website: clean(input.website),
    licenseNumber: clean(input.licenseNumber),
    insuranceText: clean(input.insuranceText),
    ownerName: clean(input.ownerName),
    publicContactName: clean(input.publicContactName),
    publicContactTitle: clean(input.publicContactTitle),
    brandPrimaryColor: cleanHex(input.brandPrimaryColor, '#2563EB'),
    brandAccentColor: cleanHex(input.brandAccentColor, '#06B6D4'),
    brandMode: ['dark', 'light', 'auto'].includes(clean(input.brandMode) ?? '') ? clean(input.brandMode) : 'dark',
    defaultTerms: clean(input.defaultTerms),
    paymentInstructions: clean(input.paymentInstructions),
    warrantyText: clean(input.warrantyText),
    legalFooter: clean(input.legalFooter),
    reportDisclaimer: clean(input.reportDisclaimer),
    contractDisclaimer: clean(input.contractDisclaimer),
    estimateDisclaimer: clean(input.estimateDisclaimer),
    metadataJson: input.metadata ? JSON.stringify(input.metadata) : undefined,
  }

  const profile = await db.contractorProfile.upsert({ where: { contractorId }, create: { contractorId, ...data }, update: data })
  if (profile.companyName) {
    await db.contractor.update({ where: { id: contractorId }, data: { company: profile.companyName } }).catch(() => null)
  }
  return profile
}

export function contractorMergeData(profile: any) {
  const displayName = profile?.displayName ?? profile?.companyName ?? profile?.legalName ?? 'Your Contractor'
  const address = profile ? formatCompanyAddress(profile) : ''
  return {
    companyName: displayName,
    'company.name': displayName,
    'company.legalName': profile?.legalName ?? displayName,
    'company.displayName': displayName,
    'company.phone': profile?.phone ?? '',
    'company.email': profile?.email ?? '',
    'company.website': profile?.website ?? '',
    'company.address': address,
    'company.licenseNumber': profile?.licenseNumber ?? '',
    'company.insuranceText': profile?.insuranceText ?? '',
    'company.ownerName': profile?.ownerName ?? '',
    'company.publicContactName': profile?.publicContactName ?? '',
    'company.publicContactTitle': profile?.publicContactTitle ?? '',
    'company.defaultTerms': profile?.defaultTerms ?? '',
    'company.paymentInstructions': profile?.paymentInstructions ?? '',
    'company.warrantyText': profile?.warrantyText ?? '',
    'company.legalFooter': profile?.legalFooter ?? '',
    'company.reportDisclaimer': profile?.reportDisclaimer ?? '',
    'company.contractDisclaimer': profile?.contractDisclaimer ?? '',
    'company.estimateDisclaimer': profile?.estimateDisclaimer ?? '',
    'brand.primaryColor': profile?.brandPrimaryColor ?? '#2563EB',
    'brand.accentColor': profile?.brandAccentColor ?? '#06B6D4',
  }
}

export async function buildProjectMergeData(input: {
  contractorId: string
  projectId?: string | null
  customerId?: string | null
  extra?: Record<string, unknown>
}) {
  const profile = await getOrCreateContractorProfile(input.contractorId)
  const project = input.projectId ? await db.project.findFirst({ where: { id: input.projectId, contractorId: input.contractorId }, include: { customer: true } }) : null
  const customerId = input.customerId ?? project?.customerId ?? null
  const customer = customerId ? await db.customer.findFirst({ where: { id: customerId, contractorId: input.contractorId } }) : null
  const latestEstimate = input.projectId ? await db.estimate.findFirst({ where: { contractorId: input.contractorId, projectId: input.projectId }, orderBy: { updatedAt: 'desc' } }) : null

  const data: Record<string, unknown> = {
    ...contractorMergeData(profile),
    projectId: project?.id ?? '',
    'project.id': project?.id ?? '',
    projectTitle: project?.title ?? '',
    'project.title': project?.title ?? '',
    propertyAddress: project?.address ?? customer?.address ?? '',
    'project.address': project?.address ?? customer?.address ?? '',
    customerId: customer?.id ?? '',
    clientName: customer?.name ?? '',
    customerName: customer?.name ?? '',
    'customer.name': customer?.name ?? '',
    'customer.email': customer?.email ?? '',
    'customer.phone': customer?.phone ?? '',
    'customer.address': customer?.address ?? '',
    estimateAmount: latestEstimate?.amount ?? '',
    'estimate.amount': latestEstimate?.amount ?? '',
    'estimate.title': latestEstimate?.title ?? '',
    today: new Date().toLocaleDateString('en-US'),
    'date.today': new Date().toLocaleDateString('en-US'),
    ...(input.extra ?? {}),
  }
  return { data, profile: publicContractorProfile(profile), project, customer, latestEstimate }
}

export function mergeTemplateVariables(body: string, data: Record<string, unknown> = {}) {
  return body.replace(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g, (_match, key) => String(data[key] ?? ''))
}

export function renderCompanyHeaderHtml(profile: any): string {
  if (!profile) return ''
  const p = publicContractorProfile(profile)
  if (!p) return ''
  const primary = p.brandPrimaryColor ?? '#2563EB'
  const accent = p.brandAccentColor ?? '#06B6D4'
  const logo = p.logoUrl ? `<img src="${escapeHtml(p.logoUrl)}" alt="${escapeHtml(p.displayName ?? 'Company logo')}" style="max-height:58px;max-width:180px;object-fit:contain" />` : ''
  return `
    <section class="company-header" style="border:1px solid #e2e8f0;border-left:5px solid ${escapeHtml(primary)};border-radius:16px;padding:16px;margin-bottom:24px;background:linear-gradient(135deg,rgba(37,99,235,.06),rgba(6,182,212,.05));">
      <div style="display:flex;gap:16px;align-items:center;justify-content:space-between;">
        <div>
          <div style="font-size:24px;font-weight:800;color:#0f172a">${escapeHtml(p.displayName ?? 'Company')}</div>
          <div style="color:#475569;font-size:13px;line-height:1.45">${[p.phone, p.email, p.website].filter(Boolean).map(escapeHtml).join(' • ')}</div>
          ${p.address ? `<div style="color:#64748b;font-size:12px;white-space:pre-line;margin-top:4px">${escapeHtml(p.address)}</div>` : ''}
          ${p.licenseNumber ? `<div style="color:${escapeHtml(accent)};font-size:12px;margin-top:4px"><b>License:</b> ${escapeHtml(p.licenseNumber)}</div>` : ''}
        </div>
        ${logo}
      </div>
    </section>
  `
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
