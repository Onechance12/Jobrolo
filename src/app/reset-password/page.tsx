'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, CheckCircle2 } from 'lucide-react'

export default function ResetPasswordPage() {
  const router = useRouter()
  const initialToken = typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('token') ?? ''
  const [stage, setStage] = useState<'request' | 'confirm' | 'done'>(() => initialToken ? 'confirm' : 'request')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [token, setToken] = useState(initialToken)
  const [newPassword, setNewPassword] = useState('')

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/auth/reset-password/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Request failed')
        return
      }
      setStage('done')
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/auth/reset-password/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Reset failed')
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

  if (stage === 'done') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-md text-center">
          <CheckCircle2 className="w-12 h-12 text-blue-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Check your email</h1>
          <p className="text-sm text-slate-500 mb-6">If an account exists for {email}, we've sent a password reset link. Click the link in the email to set a new password.</p>
          <Button onClick={() => router.push('/login')} variant="outline">Back to login</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <img src="/logo-512.png" alt="Jobrolo" className="w-12 h-12 rounded-xl object-cover mb-3" />
          <h1 className="text-2xl font-bold text-slate-900">{stage === 'confirm' ? 'Set new password' : 'Reset password'}</h1>
        </div>

        <form onSubmit={stage === 'request' ? handleRequest : handleConfirm} className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
          {stage === 'request' ? (
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required disabled={loading} className="mt-1" placeholder="mike@company.com" />
            </div>
          ) : (
            <>
              <div>
                <Label htmlFor="token">Reset token</Label>
                <Input id="token" type="text" value={token} onChange={e => setToken(e.target.value)} required disabled={loading} className="mt-1" placeholder="Paste the token from your email" />
              </div>
              <div>
                <Label htmlFor="newPassword">New password</Label>
                <Input id="newPassword" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required disabled={loading} minLength={8} className="mt-1" placeholder="At least 8 characters" />
              </div>
            </>
          )}

          {error && <div className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-md p-3">{error}</div>}

          <Button type="submit" disabled={loading} className="w-full bg-blue-600 hover:bg-blue-700 text-white">
            {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{stage === 'request' ? 'Sending…' : 'Resetting…'}</> : (stage === 'request' ? 'Send reset link' : 'Set new password')}
          </Button>

          <p className="text-center text-sm text-slate-500">
            <button type="button" onClick={() => router.push('/login')} className="text-blue-600 hover:text-blue-700 font-medium">Back to login</button>
          </p>
        </form>
      </div>
    </div>
  )
}
