'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

/**
 * Legacy bridge.
 *
 * Jobrolo setup now lives in the real Command Center chat. The old standalone
 * onboarding room caused a disconnected second conversation after signup, so
 * this route only exists to catch old redirects/bookmarks and move the user
 * into the main product.
 */
export default function OnboardingRedirectPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/')
  }, [router])

  return (
    <main className="flex min-h-[100svh] items-center justify-center bg-slate-950 text-slate-100">
      <div className="flex items-center gap-3 rounded-2xl border border-blue-400/20 bg-slate-900/80 px-5 py-4 shadow-[0_0_32px_rgba(37,99,235,0.18)]">
        <Loader2 className="h-5 w-5 animate-spin text-blue-300" />
        <div>
          <div className="text-sm font-semibold">Opening Jobrolo Command Center…</div>
          <div className="text-xs text-slate-400">Setup continues in the main chat.</div>
        </div>
      </div>
    </main>
  )
}
