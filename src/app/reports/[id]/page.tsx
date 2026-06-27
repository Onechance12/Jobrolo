import { redirect } from 'next/navigation'

export default async function RoofReportBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(`/api/roof-reports/${id}/print`)
}
