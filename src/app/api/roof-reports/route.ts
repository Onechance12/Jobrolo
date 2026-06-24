import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireContext } from '@/lib/security/context'
import { checkBodySize } from '@/lib/security/body-size'
import { defaultRoofReportDisclaimer, logProjectActivity } from '@/lib/field-ops'
import { getOrCreateContractorProfile } from '@/lib/contractor-profile'

const RoofReportSchema = z.object({
  projectId: z.string().optional(),
  customerId: z.string().optional(),
  title: z.string().min(1).max(200).default('Roof Inspection Report'),
  reportNumber: z.string().optional(),
  mode: z.string().default('inspection'),
  summaryTone: z.string().default('homeowner'),
  inspectionDate: z.string().datetime().optional(),
  inspectorName: z.string().optional(),
  propertyAddress: z.string().optional(),
  clientName: z.string().optional(),
  claimNumber: z.string().optional(),
  introduction: z.string().optional(),
  propertyReviewSummary: z.string().optional(),
  observedConditions: z.array(z.string()).optional(),
  recommendations: z.array(z.string()).optional(),
  conclusion: z.string().optional(),
  disclaimer: z.string().optional(),
})

export async function GET(req: NextRequest) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const projectId = searchParams.get('projectId') ?? undefined
  const customerId = searchParams.get('customerId') ?? undefined
  const reports = await db.roofReport.findMany({
    where: { contractorId: ctx.contractorId, ...(projectId ? { projectId } : {}), ...(customerId ? { customerId } : {}) },
    include: { photos: { orderBy: { sortOrder: 'asc' } } },
    orderBy: { updatedAt: 'desc' },
    take: 100,
  })
  return NextResponse.json({ reports })
}

export async function POST(req: NextRequest) {
  const sizeErr = checkBodySize(req)
  if (sizeErr) return sizeErr
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const parsed = RoofReportSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const input = parsed.data

  if (!input.projectId && !input.customerId) {
    return NextResponse.json({ error: 'Roof report must be attached to a project or customer' }, { status: 400 })
  }

  if (input.projectId) {
    const project = await db.project.findFirst({ where: { id: input.projectId, contractorId: ctx.contractorId }, include: { customer: true } })
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    input.propertyAddress ??= project.address ?? undefined
    input.customerId ??= project.customerId ?? undefined
    input.clientName ??= project.customer?.name ?? undefined
  }
  if (input.customerId) {
    const customer = await db.customer.findFirst({ where: { id: input.customerId, contractorId: ctx.contractorId } })
    if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    input.clientName ??= customer.name
    input.propertyAddress ??= customer.address ?? undefined
  }

  const profile = await getOrCreateContractorProfile(ctx.contractorId)

  const report = await db.roofReport.create({
    data: {
      contractorId: ctx.contractorId,
      projectId: input.projectId,
      customerId: input.customerId,
      title: input.title,
      reportNumber: input.reportNumber,
      mode: input.mode,
      summaryTone: input.summaryTone,
      inspectionDate: input.inspectionDate ? new Date(input.inspectionDate) : undefined,
      inspectorName: input.inspectorName ?? profile?.publicContactName ?? ctx.user?.name,
      propertyAddress: input.propertyAddress,
      clientName: input.clientName,
      claimNumber: input.claimNumber,
      introduction: input.introduction,
      propertyReviewSummary: input.propertyReviewSummary,
      observedConditionsJson: input.observedConditions ? JSON.stringify(input.observedConditions) : undefined,
      recommendationsJson: input.recommendations ? JSON.stringify(input.recommendations) : undefined,
      conclusion: input.conclusion,
      disclaimer: input.disclaimer ?? profile?.reportDisclaimer ?? defaultRoofReportDisclaimer(),
    },
    include: { photos: true },
  })

  await logProjectActivity({
    contractorId: ctx.contractorId,
    projectId: report.projectId,
    userId: ctx.user?.id,
    activityType: 'ROOF_REPORT_CREATED',
    title: `Roof report created: ${report.title}`,
    relatedType: 'roof_report',
    relatedId: report.id,
    metadata: { status: report.status, customerId: report.customerId },
  })

  return NextResponse.json({ report }, { status: 201 })
}
