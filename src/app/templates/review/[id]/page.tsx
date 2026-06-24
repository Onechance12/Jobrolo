'use client'

import { useParams } from 'next/navigation'
import { TemplateReviewWorkspace } from '@/components/jobrolo/template-review-workspace'

export default function TemplateReviewPage() {
  const params = useParams<{ id: string }>()
  return <TemplateReviewWorkspace templateId={params.id} />
}
