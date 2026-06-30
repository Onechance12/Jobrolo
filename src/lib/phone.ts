export type NormalizedPhone =
  | { ok: true; e164: string; national: string; digits: string }
  | { ok: false; error: string }

export function normalizePhoneE164(input: string | null | undefined, defaultCountry: 'US' = 'US'): NormalizedPhone {
  const raw = String(input || '').trim()
  if (!raw) return { ok: false, error: 'Phone number is required' }

  if (raw.startsWith('+')) {
    const digits = raw.replace(/[^\d]/g, '')
    if (digits.length < 8 || digits.length > 15) return { ok: false, error: 'Enter a valid phone number with country code' }
    return { ok: true, e164: `+${digits}`, national: formatUsPhone(digits), digits }
  }

  const digits = raw.replace(/[^\d]/g, '')
  if (defaultCountry === 'US') {
    if (digits.length === 10) return { ok: true, e164: `+1${digits}`, national: formatUsPhone(`1${digits}`), digits: `1${digits}` }
    if (digits.length === 11 && digits.startsWith('1')) return { ok: true, e164: `+${digits}`, national: formatUsPhone(digits), digits }
  }

  if (digits.length >= 8 && digits.length <= 15) return { ok: true, e164: `+${digits}`, national: `+${digits}`, digits }
  return { ok: false, error: 'Enter a valid phone number' }
}

export function phoneOnlyEmail(phoneE164: string) {
  const digits = phoneE164.replace(/[^\d]/g, '')
  return `phone-${digits}@phone.jobrolo.local`
}

export function isPhoneOnlyEmail(email: string | null | undefined) {
  return /^phone-\d+@phone\.jobrolo\.local$/i.test(String(email || ''))
}

function formatUsPhone(digitsWithCountry: string) {
  const digits = digitsWithCountry.startsWith('1') ? digitsWithCountry.slice(1) : digitsWithCountry
  if (digits.length !== 10) return `+${digitsWithCountry}`
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}
