'use client'

import { FormEvent, useEffect, useState } from 'react'

type Profile = Record<string, string | null | undefined>

const fields: Array<{ key: string; label: string; type?: string; textarea?: boolean; placeholder?: string }> = [
  { key: 'companyName', label: 'Company Name', placeholder: 'Your Company Name' },
  { key: 'legalName', label: 'Legal Name' },
  { key: 'displayName', label: 'Display Name' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'website', label: 'Website' },
  { key: 'licenseNumber', label: 'License Number' },
  { key: 'logoUrl', label: 'Logo URL or /api/storage/... URL' },
  { key: 'addressLine1', label: 'Address Line 1' },
  { key: 'addressLine2', label: 'Address Line 2' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'postalCode', label: 'Postal Code' },
  { key: 'brandPrimaryColor', label: 'Primary Brand Color', placeholder: '#2563EB' },
  { key: 'brandAccentColor', label: 'Accent Brand Color', placeholder: '#06B6D4' },
  { key: 'publicContactName', label: 'Public Contact Name' },
  { key: 'publicContactTitle', label: 'Public Contact Title' },
  { key: 'defaultTerms', label: 'Default Terms', textarea: true },
  { key: 'paymentInstructions', label: 'Payment Instructions', textarea: true },
  { key: 'warrantyText', label: 'Warranty Text', textarea: true },
  { key: 'legalFooter', label: 'Legal Footer', textarea: true },
  { key: 'reportDisclaimer', label: 'Roof Report Disclaimer', textarea: true },
  { key: 'contractDisclaimer', label: 'Contract Disclaimer', textarea: true },
  { key: 'estimateDisclaimer', label: 'Estimate Disclaimer', textarea: true },
]

export default function CompanySettingsPage() {
  const [profile, setProfile] = useState<Profile>({})
  const [mergePreview, setMergePreview] = useState<Record<string, unknown>>({})
  const [status, setStatus] = useState('Loading...')

  useEffect(() => {
    fetch('/api/contractor/profile')
      .then(r => r.ok ? r.json() : Promise.reject(new Error('Not authorized')))
      .then(data => {
        setProfile(data.profile ?? {})
        setMergePreview(data.mergePreview ?? {})
        setStatus('')
      })
      .catch(err => setStatus(err.message))
  }, [])

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setStatus('Saving...')
    const form = new FormData(e.currentTarget)
    const body: Record<string, string> = {}
    fields.forEach(f => {
      const value = String(form.get(f.key) ?? '').trim()
      if (value) body[f.key] = value
    })
    const res = await fetch('/api/contractor/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setStatus(data.error ? JSON.stringify(data.error) : 'Save failed')
      return
    }
    setProfile(data.profile ?? {})
    setMergePreview(data.mergePreview ?? {})
    setStatus('Saved')
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl shadow-blue-500/10 backdrop-blur">
          <p className="text-sm uppercase tracking-[0.3em] text-cyan-300">Jobrolo Settings</p>
          <h1 className="mt-2 text-4xl font-bold tracking-tight">Contractor Company Profile</h1>
          <p className="mt-2 max-w-3xl text-slate-300">This company profile feeds roof reports, generated agreements, estimates, signing pages, and future imported templates. Jobrolo uses it as the contractor-specific source of truth for customer-facing documents.</p>
        </div>

        <form key={String(profile.updatedAt ?? profile.id ?? 'new')} onSubmit={save} className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <section className="grid gap-4 rounded-3xl border border-white/10 bg-white/5 p-6">
            {fields.map(field => (
              <label key={field.key} className="grid gap-2">
                <span className="text-sm font-medium text-slate-200">{field.label}</span>
                {field.textarea ? (
                  <textarea name={field.key} defaultValue={String(profile[field.key] ?? '')} rows={4} className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none focus:border-cyan-300" />
                ) : (
                  <input name={field.key} type={field.type ?? 'text'} placeholder={field.placeholder} defaultValue={String(profile[field.key] ?? '')} className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none focus:border-cyan-300" />
                )}
              </label>
            ))}
            <button className="rounded-2xl bg-cyan-400 px-5 py-3 font-semibold text-slate-950 hover:bg-cyan-300">Save Company Profile</button>
            {status ? <p className="text-sm text-slate-300">{status}</p> : null}
          </section>

          <aside className="h-fit rounded-3xl border border-white/10 bg-white/5 p-6">
            <h2 className="text-xl font-semibold">Merge Field Preview</h2>
            <p className="mt-2 text-sm text-slate-400">These are the variables templates can use.</p>
            <div className="mt-4 max-h-[680px] overflow-auto rounded-2xl bg-slate-900 p-4 text-xs text-slate-300">
              <pre>{JSON.stringify(mergePreview, null, 2)}</pre>
            </div>
          </aside>
        </form>
      </div>
    </main>
  )
}
