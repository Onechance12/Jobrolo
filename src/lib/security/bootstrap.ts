// =============================================================================
// Tenant Bootstrap — creates a new contractor + user + workspace + channels
// =============================================================================
// Used by /api/auth/signup. Creates the minimum viable tenant:
//   1. Contractor (the company)
//   2. User (the owner, with hashed password)
//   3. Workspace (the contractor's own workspace — "Command Center")
//   4. WorkspaceChat channels (main + management to start)
// Onboarding agent later adds more channels based on business type.
// =============================================================================

import { db } from '@/lib/db'
import { hashPassword } from './password'

export interface SignupInput {
  name: string
  email: string
  password?: string
  companyName?: string
  website?: string
  phone?: string
  phoneE164?: string
  phoneVerifiedAt?: Date | null
}

export interface SignupResult {
  userId: string
  contractorId: string
  workspaceId: string
}

export async function bootstrapTenant(input: SignupInput): Promise<SignupResult> {
  const { name, email, password, companyName, website, phone, phoneE164, phoneVerifiedAt } = input

  // 1. Create Contractor (the company)
  const contractor = await db.contractor.create({
    data: {
      name,
      email,
      phone: phoneE164 || phone || undefined,
      company: companyName || null,
      plan: 'pro',
      subscriptionStatus: 'trialing',
      status: 'active',
      trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14-day trial
    },
  })

  // 2. Create User (the owner) with hashed password
  const passwordHash = password ? await hashPassword(password) : null
  const user = await db.user.create({
    data: {
      contractorId: contractor.id,
      name,
      email,
      phone: phoneE164 || phone || undefined,
      phoneE164: phoneE164 || undefined,
      role: 'owner',
      status: 'active',
      passwordHash,
      emailVerifiedAt: process.env.NODE_ENV === 'production' ? null : new Date(), // Dev: auto-verify. Prod: requires real email verification.
      phoneVerifiedAt: phoneVerifiedAt || undefined,
    },
  })

  // 3. Create the contractor's main workspace ("Command Center")
  const workspace = await db.workspace.create({
    data: {
      contractorId: contractor.id,
      name: companyName || `${name}'s Workspace`,
      type: 'project', // will be re-typed by onboarding agent if needed
      color: 'bg-blue-500',
      status: 'active',
    },
  })

  // 4. Create starter channels — just main + management. Onboarding agent
  //    adds customer/crew/supplier/finance/sales/insurance based on business type.
  for (const chatType of ['main', 'management']) {
    await db.workspaceChat.create({
      data: {
        workspaceId: workspace.id,
        chatType,
        title: chatType === 'main' ? 'Command Center' : 'Management',
      },
    })
  }

  // 5. If website was provided, stash it in contractor memory for the onboarding agent
  if (website) {
    await db.contractorMemory.create({
      data: {
        contractorId: contractor.id,
        category: 'default',
        content: `Company website: ${website}`,
        source: 'user',
      },
    })
  }

  return {
    userId: user.id,
    contractorId: contractor.id,
    workspaceId: workspace.id,
  }
}
