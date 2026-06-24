// =============================================================================
// Password hashing — bcryptjs (pure JS, no native deps)
// =============================================================================

import bcrypt from 'bcryptjs'

const SALT_ROUNDS = 12 // ~250ms per hash — strong enough for production

export async function hashPassword(plain: string): Promise<string> {
  if (!plain || plain.length < 8) {
    throw new Error('Password must be at least 8 characters')
  }
  return bcrypt.hash(plain, SALT_ROUNDS)
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  if (!plain || !hash) return false
  try {
    return await bcrypt.compare(plain, hash)
  } catch {
    return false
  }
}

export function generatePasswordResetToken(): string {
  // 32-byte random token, hex-encoded (64 chars)
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}
