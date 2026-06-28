'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CheckCircle2, Loader2 } from 'lucide-react'

type InvitePreview = {
  user?: { name?: string; email?: string; role?: string; status?: string }
  contractor?: { company?: string | null; name?: string | null }
  workspaces?: Array<{ role?: string; permissions?: string; workspace?: { name?: string; type?: string; chats?: Array<{ title?: string; chatType?: string }> } }>
}

export default function InvitePage() {
  const router = useRouter()
  const [token] = useState(() => typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('token') ?? '')
  const [invite, setInvite] = useState<InvitePreview | null>(null)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(() => Boolean(token))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(() => token ? null : 'Invite token is missing.')

  useEffect(() => {
    if (!token) return
    ;(async () => {
      try {
        const res = await fetch(`/api/auth/invite/accept?token=${encodeURIComponent(token)}`)
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(data.error || 'This invite is invalid or expired.')
          return
        }
        setInvite(data.invite)
        setName(data.invite?.user?.name || '')
      } catch {
        setError('Could not load this invite. Please try again.')
      } finally {
        setLoading(false)
      }
    })()
  }, [token])

  const roleCopy = useMemo(() => {
    const role = String(invite?.user?.role ?? '').toLowerCase()
    if (role === 'customer') return {
      title: 'Join your homeowner chat',
      body: 'Create your password to message the team, see shared job updates, and stay connected to your project.',
    }
    if (role === 'crew' || role === 'subcontractor') return {
      title: 'Join the crew chat',
      body: 'Create your password to see install notes, job updates, photos, and crew coordination in one place.',
    }
    return {
      title: 'Join the Jobrolo team',
      body: 'Create your password to help manage chats, jobs, updates, and action items with the company.',
    }
  }, [invite?.user?.role])

  async function accept(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch('/api/auth/invite/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, name, password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Could not accept this invite.')
        return
      }
      if (data.workspaceId) window.localStorage.setItem('jobroloInviteWorkspaceId', data.workspaceId)
      if (data.chatId) window.localStorage.setItem('jobroloInviteChatId', data.chatId)
      router.push(data.redirectTo || '/')
      router.refresh()
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-8 text-white">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-md items-center">
        <div className="w-full">
          <div className="mb-6 text-center">
            <img src="/logo.png" alt="Jobrolo" className="mx-auto mb-4 h-14 w-14 rounded-2xl object-cover shadow-lg shadow-blue-500/20" />
            <p className="text-xs uppercase tracking-[0.35em] text-blue-300">Jobrolo invite</p>
            <h1 className="mt-2 text-3xl font-bold">{loading ? 'Loading invite…' : roleCopy.title}</h1>
            {invite ? <p className="mt-2 text-sm text-slate-300">{invite.contractor?.company || invite.contractor?.name} invited you to Jobrolo.</p> : null}
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/10 p-5 shadow-2xl backdrop-blur">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-slate-300">
                <Loader2 className="h-5 w-5 animate-spin" /> Loading secure invite…
              </div>
            ) : error && !invite ? (
              <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-100">{error}</div>
            ) : (
              <>
                <div className="mb-5 rounded-2xl border border-blue-400/20 bg-blue-500/10 p-4 text-sm text-blue-50">
                  <div className="mb-1 flex items-center gap-2 font-semibold"><CheckCircle2 className="h-4 w-4" /> What this gives you</div>
                  <p>{roleCopy.body}</p>
                  {invite?.workspaces?.[0]?.workspace?.name ? (
                    <p className="mt-2 text-blue-100">Workspace: {invite.workspaces[0].workspace.name}</p>
                  ) : null}
                </div>

                <form onSubmit={accept} className="space-y-4">
                  <div>
                    <Label htmlFor="name" className="text-slate-100">Name</Label>
                    <Input id="name" value={name} onChange={e => setName(e.target.value)} required disabled={submitting} className="mt-1 border-white/10 bg-slate-900 text-white" />
                  </div>
                  <div>
                    <Label htmlFor="email" className="text-slate-100">Email</Label>
                    <Input id="email" value={invite?.user?.email || ''} disabled className="mt-1 border-white/10 bg-slate-900/70 text-slate-300" />
                  </div>
                  <div>
                    <Label htmlFor="password" className="text-slate-100">Create password</Label>
                    <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={8} required disabled={submitting} className="mt-1 border-white/10 bg-slate-900 text-white" placeholder="At least 8 characters" />
                  </div>
                  {error ? <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-100">{error}</div> : null}
                  <Button type="submit" disabled={submitting} className="w-full bg-blue-600 text-white hover:bg-blue-700">
                    {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Joining…</> : 'Accept invite'}
                  </Button>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
