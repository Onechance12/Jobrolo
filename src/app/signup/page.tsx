'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, LockKeyhole, LogIn, Sparkles, UserPlus } from 'lucide-react'

type EntryMode = 'signup' | 'login'

export default function SignupPage() {
  const router = useRouter()
  const [mode, setMode] = useState<EntryMode | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [signupForm, setSignupForm] = useState({ name: '', email: '', password: '', companyName: '', website: '' })
  const [loginForm, setLoginForm] = useState({ email: '', password: '' })

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(signupForm),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Signup failed')
        return
      }
      router.push(data.redirectTo || '/onboarding')
      router.refresh()
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Login failed')
        return
      }
      router.push(data.redirectTo || '/')
      router.refresh()
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const chooseMode = (nextMode: EntryMode) => {
    setMode(nextMode)
    setError(null)
  }

  return (
    <div className="min-h-screen bg-[#050914] px-4 py-6 text-slate-100">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-2xl flex-col">
        <header className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="Jobrolo" className="h-11 w-11 rounded-2xl object-cover shadow-[0_0_28px_rgba(37,99,235,0.45)]" />
            <div>
              <div className="text-sm font-semibold text-white">Jobrolo</div>
              <div className="text-xs text-slate-400">Account entry</div>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-blue-300/20 bg-blue-500/10 px-3 py-1.5 text-xs text-blue-100">
            <LockKeyhole className="h-3.5 w-3.5" />
            Secure setup
          </div>
        </header>

        <main className="flex flex-1 flex-col justify-center gap-4">
          <div className="flex gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-blue-700 text-white shadow-[0_0_18px_rgba(37,99,235,0.45)]">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="max-w-[86%] rounded-2xl rounded-tl-md border border-white/10 bg-[#0b1220] px-4 py-3 text-[15px] leading-relaxed text-slate-100">
              Hey — I’m Jobrolo. Are we signing you into an existing workspace, or creating a new company workspace?
              <div className="mt-3 rounded-xl border border-amber-300/20 bg-amber-400/10 p-3 text-xs leading-relaxed text-amber-100">
                If someone texted or emailed you an invite, use that invite link instead. That attaches you to the right company, chat, and permissions.
              </div>
            </div>
          </div>

          <div className="ml-12 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => chooseMode('login')}
              className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition ${mode === 'login' ? 'border-blue-300/50 bg-blue-500/25 text-white' : 'border-white/10 bg-white/[0.06] text-slate-200 hover:border-blue-300/35 hover:bg-blue-500/15'}`}
            >
              <LogIn className="h-4 w-4" />
              Sign in
            </button>
            <button
              type="button"
              onClick={() => chooseMode('signup')}
              className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition ${mode === 'signup' ? 'border-cyan-300/50 bg-cyan-500/20 text-white' : 'border-white/10 bg-white/[0.06] text-slate-200 hover:border-cyan-300/35 hover:bg-cyan-500/15'}`}
            >
              <UserPlus className="h-4 w-4" />
              Create workspace
            </button>
          </div>

          {mode === 'login' ? (
            <div className="ml-0 sm:ml-12">
              <form onSubmit={handleLogin} className="rounded-3xl border border-blue-400/20 bg-[#08111f] p-5 shadow-2xl shadow-black/30">
                <div className="mb-4">
                  <div className="text-sm font-semibold text-white">Welcome back.</div>
                  <div className="text-xs text-slate-400">Sign in and I’ll route you to the right place.</div>
                </div>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="login-email" className="text-slate-200">Email</Label>
                    <Input id="login-email" type="email" value={loginForm.email} onChange={e => setLoginForm({ ...loginForm, email: e.target.value })} required disabled={loading} className="mt-1 border-white/10 bg-slate-950 text-white" placeholder="you@company.com" />
                  </div>
                  <div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="login-password" className="text-slate-200">Password</Label>
                      <button type="button" onClick={() => router.push('/reset-password')} className="text-xs text-blue-300 hover:text-blue-200">
                        Forgot password?
                      </button>
                    </div>
                    <Input id="login-password" type="password" value={loginForm.password} onChange={e => setLoginForm({ ...loginForm, password: e.target.value })} required disabled={loading} className="mt-1 border-white/10 bg-slate-950 text-white" placeholder="••••••••" />
                  </div>
                </div>
                {error ? <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-100">{error}</div> : null}
                <Button type="submit" disabled={loading} className="mt-5 w-full bg-blue-600 text-white hover:bg-blue-700">
                  {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Signing in…</> : 'Sign in'}
                </Button>
              </form>
            </div>
          ) : null}

          {mode === 'signup' ? (
            <div className="ml-0 sm:ml-12">
              <form onSubmit={handleSignup} className="rounded-3xl border border-cyan-400/20 bg-[#08111f] p-5 shadow-2xl shadow-black/30">
                <div className="mb-4">
                  <div className="text-sm font-semibold text-white">Let’s create your company workspace.</div>
                  <div className="text-xs text-slate-400">After this, I’ll continue onboarding in chat and lock tools until setup is complete.</div>
                </div>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="name" className="text-slate-200">Your name</Label>
                    <Input id="name" type="text" value={signupForm.name} onChange={e => setSignupForm({ ...signupForm, name: e.target.value })} required disabled={loading} className="mt-1 border-white/10 bg-slate-950 text-white" placeholder="Chance Pearson" />
                  </div>
                  <div>
                    <Label htmlFor="email" className="text-slate-200">Email</Label>
                    <Input id="email" type="email" value={signupForm.email} onChange={e => setSignupForm({ ...signupForm, email: e.target.value })} required disabled={loading} className="mt-1 border-white/10 bg-slate-950 text-white" placeholder="you@company.com" />
                  </div>
                  <div>
                    <Label htmlFor="password" className="text-slate-200">Create password</Label>
                    <Input id="password" type="password" value={signupForm.password} onChange={e => setSignupForm({ ...signupForm, password: e.target.value })} required disabled={loading} minLength={8} className="mt-1 border-white/10 bg-slate-950 text-white" placeholder="At least 8 characters" />
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                    <p className="mb-3 text-xs text-slate-400">Optional, but it helps onboarding start smarter:</p>
                    <div className="space-y-3">
                      <div>
                        <Label htmlFor="companyName" className="text-slate-200">Company name</Label>
                        <Input id="companyName" type="text" value={signupForm.companyName} onChange={e => setSignupForm({ ...signupForm, companyName: e.target.value })} disabled={loading} className="mt-1 border-white/10 bg-slate-950 text-white" placeholder="Your Roofing Company" />
                      </div>
                      <div>
                        <Label htmlFor="website" className="text-slate-200">Company website</Label>
                        <Input id="website" type="text" value={signupForm.website} onChange={e => setSignupForm({ ...signupForm, website: e.target.value })} disabled={loading} className="mt-1 border-white/10 bg-slate-950 text-white" placeholder="yourcompany.com" />
                      </div>
                    </div>
                  </div>
                </div>
                {error ? <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-100">{error}</div> : null}
                <Button type="submit" disabled={loading} className="mt-5 w-full bg-blue-600 text-white hover:bg-blue-700">
                  {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating workspace…</> : 'Create workspace'}
                </Button>
              </form>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  )
}
