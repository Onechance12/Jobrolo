import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { getContractorProfile, publicContractorProfile } from '@/lib/contractor-profile'
import { sanitizeHtml } from '@/lib/security/html'

export default async function SignDocumentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const request = await db.signatureRequest.findFirst({
    where: { signatureToken: token, status: { in: ['pending', 'viewed'] } },
    include: { generatedDocument: true },
  })
  if (!request) notFound()

  const profile = publicContractorProfile(await getContractorProfile(request.contractorId))

  await db.signatureRequest.update({
    where: { id: request.id },
    data: {
      status: request.status === 'pending' ? 'viewed' : request.status,
      events: { create: { contractorId: request.contractorId, type: 'viewed', detail: 'Signer opened document' } },
    },
  }).catch(() => null)

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100">
      <div className="mx-auto max-w-4xl rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl shadow-blue-500/10 backdrop-blur">
        <div className="mb-6 border-b border-white/10 pb-4">
          <p className="text-sm uppercase tracking-[0.3em] text-cyan-300">{profile?.displayName ?? 'Jobrolo Signature'}</p>
          <h1 className="mt-2 text-3xl font-bold">{request.title}</h1>
          {profile?.phone || profile?.email ? <p className="mt-1 text-sm text-slate-400">{[profile?.phone, profile?.email].filter(Boolean).join(' • ')}</p> : null}
          <p className="mt-1 text-slate-300">Signer: {request.signerName}</p>
        </div>
        <article className="prose prose-invert max-w-none rounded-2xl bg-white p-6 text-slate-950" dangerouslySetInnerHTML={{ __html: sanitizeHtml(request.generatedDocument.bodyHtml) }} />
        {profile?.legalFooter ? <p className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4 text-xs text-slate-400">{profile.legalFooter}</p> : null}
        <form method="post" action={`/api/signature-requests/${request.id}/sign`} className="mt-6 space-y-4 rounded-2xl border border-white/10 bg-slate-900 p-5">
          <input type="hidden" name="token" value={token} />
          <label className="block text-sm font-medium text-slate-200">Type your legal name to sign</label>
          <input name="signerName" defaultValue={request.signerName} className="w-full rounded-xl border border-white/10 bg-white/10 px-4 py-3 text-white outline-none focus:border-cyan-300" />
          <label className="block text-sm font-medium text-slate-200">Signature</label>
          <input name="signatureData" placeholder="/s/ Your Name" className="w-full rounded-xl border border-white/10 bg-white/10 px-4 py-3 text-white outline-none focus:border-cyan-300" />
          <p className="text-xs text-slate-400">By signing, the signer confirms intent to sign electronically. The system records timestamp, IP address, and user agent for the audit trail.</p>
          <button className="rounded-xl bg-cyan-400 px-5 py-3 font-semibold text-slate-950 hover:bg-cyan-300">Sign Document</button>
        </form>
      </div>
    </main>
  )
}
