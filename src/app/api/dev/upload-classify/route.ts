import { NextRequest, NextResponse } from 'next/server'
import { checkBodySize } from '@/lib/security/body-size'
import { requireDevBridge, safeText } from '@/lib/dev-bridge'
import { classifyUploadForSkills } from '@/lib/skills/context'
import type { UploadSkillInput } from '@/lib/skills/types'

export const runtime = 'nodejs'

function stringValue(value: unknown, max = 2000) {
  return safeText(value, max) || undefined
}

function numberValue(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function booleanValue(value: unknown) {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return undefined
  return value.map(item => stringValue(item, 500)).filter((item): item is string => Boolean(item)).slice(0, 20)
}

export async function POST(req: NextRequest) {
  const unauthorized = requireDevBridge(req)
  if (unauthorized) return unauthorized

  const sizeErr = checkBodySize(req, 128 * 1024)
  if (sizeErr) return sizeErr

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Expected JSON object.' }, { status: 400 })
  }

  const record = body as Record<string, unknown>
  const filename = stringValue(record.filename, 500)
  if (!filename) return NextResponse.json({ error: 'filename is required.' }, { status: 400 })

  const input: UploadSkillInput = {
    filename,
    mimeType: stringValue(record.mimeType, 200),
    visibleText: stringValue(record.visibleText, 6000),
    extractedText: stringValue(record.extractedText, 6000),
    contentHints: stringArray(record.contentHints),
    metadataTitle: stringValue(record.metadataTitle, 500),
    uploadPurpose: stringValue(record.uploadPurpose, 200),
    suggestedUploadPurpose: stringValue(record.suggestedUploadPurpose, 200),
    uploadIntentSource: stringValue(record.uploadIntentSource, 1000),
    actionSource: stringValue(record.actionSource, 200),
    activeRoute: stringValue(record.activeRoute, 500),
    captureMode: stringValue(record.captureMode, 50) as UploadSkillInput['captureMode'],
    captureSource: stringValue(record.captureSource, 200),
    captureLatitude: numberValue(record.captureLatitude),
    captureLongitude: numberValue(record.captureLongitude),
    captureAccuracyMeters: numberValue(record.captureAccuracyMeters),
    capturedAt: stringValue(record.capturedAt, 100),
    photoSection: stringValue(record.photoSection, 200),
    photoSectionLabel: stringValue(record.photoSectionLabel, 200),
    hasCustomerContext: booleanValue(record.hasCustomerContext),
    hasProjectContext: booleanValue(record.hasProjectContext),
    hasWorkspaceContext: booleanValue(record.hasWorkspaceContext),
    recentUserText: stringValue(record.recentUserText, 2000),
  }

  const classification = classifyUploadForSkills(input)
  return NextResponse.json({
    status: 'ok',
    dryRun: true,
    note: 'Classifier dry-run only. No file was uploaded, attached, imported, or mutated.',
    input,
    classification,
  })
}
