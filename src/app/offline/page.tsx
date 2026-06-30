import Image from 'next/image'

export default function OfflinePage() {
  return (
    <main className="min-h-dvh bg-slate-950 text-white">
      <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center px-6 py-10">
        <div className="mb-6 flex items-center gap-3">
          <Image src="/logo-512.png" alt="Jobrolo" width={52} height={52} className="rounded-2xl shadow-[0_0_30px_rgba(37,99,235,0.45)]" priority />
          <div>
            <p className="text-lg font-semibold leading-tight">Jobrolo</p>
            <p className="text-sm text-slate-400">Offline mode</p>
          </div>
        </div>

        <section className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/30">
          <p className="text-xl font-semibold">You are offline.</p>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Jobrolo can keep field notes, GPS observations, drafts, and evidence queued on this device after offline field mode is enabled.
            Reconnect to sync with the real Jobrolo database.
          </p>

          <div className="mt-5 rounded-2xl border border-amber-400/25 bg-amber-400/10 p-4 text-sm text-amber-100">
            Local offline data is temporary device context. The server database stays the source of truth.
          </div>

          <div className="mt-5 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-emerald-100">Field notes queue</span>
            <span className="rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3 py-1 text-cyan-100">GPS snapshots</span>
            <span className="rounded-full border border-blue-400/25 bg-blue-400/10 px-3 py-1 text-blue-100">Evidence sync</span>
          </div>
        </section>
      </div>
    </main>
  )
}
