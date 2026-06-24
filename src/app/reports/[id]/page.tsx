import { RoofReportBuilder } from '@/components/jobrolo/roof-report-builder'

export default async function RoofReportBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <RoofReportBuilder reportId={id} />
}
