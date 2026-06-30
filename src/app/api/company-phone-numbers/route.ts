import { db } from '@/lib/db'
import { requireContext, UnauthorizedError, ForbiddenError } from '@/lib/security/context'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireContext(req)
    if (!ctx.user || !['owner', 'admin', 'manager'].includes(ctx.user.role)) {
      throw new ForbiddenError('Only owner, admin, or manager roles can view company phone numbers')
    }
    const numbers = await db.companyPhoneNumber.findMany({
      where: { contractorId: ctx.contractorId },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    })
    return NextResponse.json({ success: true, numbers })
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: err.message }, { status: 401 })
    if (err instanceof ForbiddenError) return NextResponse.json({ error: err.message }, { status: 403 })
    console.error('[company-phone-numbers] list error:', err)
    return NextResponse.json({ error: 'Could not list company phone numbers' }, { status: 500 })
  }
}
