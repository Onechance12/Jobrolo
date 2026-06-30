'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, Phone } from 'lucide-react'

export default function LoginPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ email: '', password: '' })
  const [phoneForm, setPhoneForm] = useState({ phone: '', code: '' })
  const [phoneStep, setPhoneStep] = useState<'phone' | 'code'>('phone')
  const [phoneMessage, setPhoneMessage] = useState<string | null>(null)

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

  const sendPhoneCode = async () => {
    setError(null)
    setPhoneMessage(null)
    setLoading(true)
    try {
      const res = await fetch('/api/auth/phone/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phoneForm.phone }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Could not send phone code')
        return
      }
      setPhoneStep('code')
      setPhoneMessage(`Code sent to ${data.phoneDisplay || data.phoneE164}.`)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const verifyPhoneCode = async () => {
    setError(null)
    setPhoneMessage(null)
    setLoading(true)
    try {
      const res = await fetch('/api/auth/phone/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(phoneForm),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Phone verification failed')
        return
      }
      if (data.needsSignup) {
        router.push('/signup')
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

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <img src="/logo-512.png" alt="Jobrolo" className="w-12 h-12 rounded-xl object-cover mb-3" />
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

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
              <Phone className="h-4 w-4 text-blue-600" />
              Sign in with phone
            </div>
            <div className="grid gap-2">
              <Input
                type="tel"
                value={phoneForm.phone}
                onChange={e => setPhoneForm({ ...phoneForm, phone: e.target.value })}
                disabled={loading}
                placeholder="Mobile number"
              />
              {phoneStep === 'code' ? (
                <Input
                  type="text"
                  inputMode="numeric"
                  value={phoneForm.code}
                  onChange={e => setPhoneForm({ ...phoneForm, code: e.target.value })}
                  disabled={loading}
                  placeholder="Verification code"
                />
              ) : null}
              <Button
                type="button"
                variant={phoneStep === 'code' ? 'default' : 'outline'}
                disabled={loading || !phoneForm.phone.trim() || (phoneStep === 'code' && !phoneForm.code.trim())}
                onClick={() => phoneStep === 'code' ? void verifyPhoneCode() : void sendPhoneCode()}
              >
                {phoneStep === 'code' ? 'Verify code' : 'Send code'}
              </Button>
            </div>
            {phoneMessage ? <p className="mt-2 text-xs text-slate-500">{phoneMessage}</p> : null}
          </div>

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
