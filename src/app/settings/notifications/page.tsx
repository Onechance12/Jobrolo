'use client'

import { FormEvent, useEffect, useState } from 'react'

type Preference = {
  id?: string
  inAppEnabled?: boolean
  emailEnabled?: boolean
  smsEnabled?: boolean
  urgentOnly?: boolean
  dailyDigest?: boolean
  role?: string | null
  userId?: string | null
}

export default function NotificationSettingsPage() {
  const [pref, setPref] = useState<Preference>({ inAppEnabled: true, emailEnabled: false, smsEnabled: false, urgentOnly: false, dailyDigest: false })
  const [status, setStatus] = useState('Loading...')

  useEffect(() => {
    fetch('/api/notifications/preferences')
      .then(r => r.ok ? r.json() : Promise.reject(new Error('Not authorized')))
      .then(data => {
        const first = data.preferences?.find((p: Preference) => p.userId) ?? data.preferences?.[0]
        if (first) setPref({ ...pref, ...first })
        setStatus('')
      })
      .catch(err => setStatus(err.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setStatus('Saving...')
    const form = new FormData(e.currentTarget)
    const body = {
      inAppEnabled: form.get('inAppEnabled') === 'on',
      emailEnabled: form.get('emailEnabled') === 'on',
      smsEnabled: form.get('smsEnabled') === 'on',
      urgentOnly: form.get('urgentOnly') === 'on',
      dailyDigest: form.get('dailyDigest') === 'on',
    }
    const res = await fetch('/api/notifications/preferences', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { setStatus(data.error ? JSON.stringify(data.error) : 'Save failed'); return }
    setPref(data.preference ?? pref)
    setStatus('Saved')
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100">
      <div className="mx-auto max-w-3xl rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl shadow-blue-500/10 backdrop-blur">
        <p className="text-sm uppercase tracking-[0.3em] text-cyan-300">Jobrolo Settings</p>
        <h1 className="mt-2 text-4xl font-bold tracking-tight">Notifications</h1>
        <p className="mt-2 text-slate-300">Control how Jobrolo routes approvals, field updates, signed documents, supplier tasks, and role alerts to you. In-app cards remain the source of truth; email/SMS are delivery layers.</p>
        <form onSubmit={save} className="mt-8 space-y-5">
          {[
            ['inAppEnabled', 'Show in-app cards', 'Recommended. Keeps Jobrolo as the system of record.'],
            ['emailEnabled', 'Send email notifications', 'Requires EMAIL_PROVIDER and COMMUNICATIONS_ENABLED.'],
            ['smsEnabled', 'Send SMS notifications', 'Requires SMS_PROVIDER/Twilio and opt-in.'],
            ['urgentOnly', 'Only send urgent/high priority externally', 'Useful for owners and PMs.'],
            ['dailyDigest', 'Use daily digest instead of immediate external messages', 'Digest delivery can be scheduled from cron later.'],
          ].map(([key, label, help]) => (
            <label key={key} className="flex items-start gap-3 rounded-2xl border border-white/10 bg-slate-900/60 p-4">
              <input name={key} type="checkbox" defaultChecked={Boolean((pref as any)[key])} className="mt-1 h-4 w-4" />
              <span>
                <span className="block font-semibold">{label}</span>
                <span className="block text-sm text-slate-400">{help}</span>
              </span>
            </label>
          ))}
          <button className="rounded-xl bg-cyan-500 px-5 py-3 font-semibold text-slate-950 hover:bg-cyan-300" type="submit">Save notification settings</button>
          {status ? <p className="text-sm text-slate-300">{status}</p> : null}
        </form>
      </div>
    </main>
  )
}
