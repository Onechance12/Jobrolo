'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2 } from 'lucide-react'

export default function LoginPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ email: '', password: '' })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Login failed')
        return
      }
      router.push(data.redirectTo || '/')
      router.refresh()
    } catch (err) {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <img src="/logo.png" alt="Jobrolo" className="w-12 h-12 rounded-xl object-cover mb-3" />
          <h1 className="text-2xl font-bold text-slate-900">Welcome back</h1>
          <p className="text-sm text-slate-500 mt-1">Log in to your Jobrolo workspace.</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required disabled={loading} className="mt-1" placeholder="mike@company.com" />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <button type="button" onClick={() => router.push('/reset-password')} className="text-xs text-blue-600 hover:text-blue-700">
                Forgot password?
              </button>
            </div>
            <Input id="password" type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required disabled={loading} className="mt-1" placeholder="••••••••" />
          </div>

          {error && <div className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-md p-3">{error}</div>}

          <Button type="submit" disabled={loading} className="w-full bg-blue-600 hover:bg-blue-700 text-white">
            {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Logging in…</> : 'Log in'}
          </Button>

          <p className="text-center text-sm text-slate-500">
            New to Jobrolo?{' '}
            <button type="button" onClick={() => router.push('/signup')} className="text-blue-600 hover:text-blue-700 font-medium">
              Create an account
            </button>
          </p>
        </form>
      </div>
    </div>
  )
}
