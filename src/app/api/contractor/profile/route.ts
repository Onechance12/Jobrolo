import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireContext } from '@/lib/security/context'
import { checkBodySize } from '@/lib/security/body-size'
import { requireAnyRoleResponse } from '@/lib/security/permissions'
import { buildProjectMergeData, getOrCreateContractorProfile, publicContractorProfile, upsertContractorProfile } from '@/lib/contractor-profile'

const ProfileSchema = z.object({
  companyName: z.string().max(200).nullable().optional(),
  legalName: z.string().max(200).nullable().optional(),
  displayName: z.string().max(200).nullable().optional(),
  logoUrl: z.string().max(1000).nullable().optional(),
  logoDocumentId: z.string().max(200).nullable().optional(),
  addressLine1: z.string().max(250).nullable().optional(),
  addressLine2: z.string().max(250).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  state: z.string().max(100).nullable().optional(),
  postalCode: z.string().max(30).nullable().optional(),
  country: z.string().max(60).nullable().optional(),
  phone: z.string().max(80).nullable().optional(),
  email: z.string().email().nullable().optional(),
  website: z.string().max(500).nullable().optional(),
  licenseNumber: z.string().max(120).nullable().optional(),
  insuranceText: z.string().max(2000).nullable().optional(),
  ownerName: z.string().max(200).nullable().optional(),
  publicContactName: z.string().max(200).nullable().optional(),
  publicContactTitle: z.string().max(200).nullable().optional(),
  brandPrimaryColor: z.string().max(20).nullable().optional(),
  brandAccentColor: z.string().max(20).nullable().optional(),
  brandMode: z.enum(['dark', 'light', 'auto']).nullable().optional(),
  defaultTerms: z.string().max(20_000).nullable().optional(),
  paymentInstructions: z.string().max(20_000).nullable().optional(),
  warrantyText: z.string().max(20_000).nullable().optional(),
  legalFooter: z.string().max(20_000).nullable().optional(),
  reportDisclaimer: z.string().max(20_000).nullable().optional(),
  contractDisclaimer: z.string().max(20_000).nullable().optional(),
  estimateDisclaimer: z.string().max(20_000).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export async function GET(req: NextRequest) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const profile = await getOrCreateContractorProfile(ctx.contractorId)
  const { data: mergePreview } = await buildProjectMergeData({ contractorId: ctx.contractorId })
  return NextResponse.json({ profile: publicContractorProfile(profile), mergePreview })
}

export async function PATCH(req: NextRequest) {
  const sizeErr = checkBodySize(req)
  if (sizeErr) return sizeErr
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const roleErr = requireAnyRoleResponse(ctx, ['owner', 'admin', 'manager', 'project_manager', 'coordinator'])
  if (roleErr) return roleErr
  const parsed = ProfileSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const profile = await upsertContractorProfile(ctx.contractorId, parsed.data)
  const { data: mergePreview } = await buildProjectMergeData({ contractorId: ctx.contractorId })
  return NextResponse.json({ profile: publicContractorProfile(profile), mergePreview })
}

export const PUT = PATCH
