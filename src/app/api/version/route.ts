import { NextResponse } from 'next/server'
import { getDeployInfo } from '@/lib/deploy-info'

export const runtime = 'nodejs'

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    deploy: getDeployInfo(),
  })
}
