'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2 } from 'lucide-react'

export default function SignupPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', email: '', password: '', companyName: '', website: '' })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Signup failed')
        return
      }
      router.push(data.redirectTo || '/onboarding')
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
          <h1 className="text-2xl font-bold text-slate-900">Create your Jobrolo account</h1>
          <p className="text-sm text-slate-500 mt-1">Your AI operations manager is ready to learn your business.</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
          <div>
            <Label htmlFor="name">Name <span className="text-rose-500">*</span></Label>
            <Input id="name" type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required disabled={loading} className="mt-1" placeholder="Mike Johnson" />
          </div>
          <div>
            <Label htmlFor="email">Email <span className="text-rose-500">*</span></Label>
            <Input id="email" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required disabled={loading} className="mt-1" placeholder="mike@company.com" />
          </div>
          <div>
            <Label htmlFor="password">Password <span className="text-rose-500">*</span></Label>
            <Input id="password" type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required disabled={loading} minLength={8} className="mt-1" placeholder="At least 8 characters" />
          </div>
          <div className="pt-2 border-t border-slate-100">
            <p className="text-xs text-slate-500 mb-3">Optional — helps your AI onboard faster:</p>
            <div className="space-y-3">
              <div>
                <Label htmlFor="companyName">Company Name</Label>
                <Input id="companyName" type="text" value={form.companyName} onChange={e => setForm({ ...form, companyName: e.target.value })} disabled={loading} className="mt-1" placeholder="Mike's Roofing LLC" />
              </div>
              <div>
                <Label htmlFor="website">Company Website</Label>
                <Input id="website" type="text" value={form.website} onChange={e => setForm({ ...form, website: e.target.value })} disabled={loading} className="mt-1" placeholder="mikesroofing.com" />
              </div>
            </div>
          </div>

          {error && <div className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-md p-3">{error}</div>}

          <Button type="submit" disabled={loading} className="w-full bg-blue-600 hover:bg-blue-700 text-white">
            {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating account…</> : 'Create account'}
          </Button>

          <p className="text-center text-sm text-slate-500">
            Already have an account?{' '}
            <button type="button" onClick={() => router.push('/login')} className="text-blue-600 hover:text-blue-700 font-medium">
              Log in
            </button>
          </p>
        </form>
      </div>
    </div>
  )
}
