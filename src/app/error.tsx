'use client'
import { useEffect } from 'react'
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error('[Jobrolo] Page error:', error) }, [error])
  return <div className="h-dvh flex flex-col items-center justify-center gap-4 p-6 text-center"><img src="/logo.png" alt="Jobrolo" className="w-12 h-12 rounded-lg object-cover" /><h2 className="text-lg font-semibold text-slate-900">Something went wrong</h2><p className="text-sm text-slate-500 max-w-sm">{error.message || 'An unexpected error occurred.'}</p><div className="flex gap-2"><button onClick={reset} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">Try again</button><button onClick={() => window.location.reload()} className="px-4 py-2 rounded-lg bg-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-300">Refresh</button></div></div>
}
