#!/usr/bin/env node
// Runs one Jobrolo worker tick by calling the authenticated cron endpoint.
// Use this only after the app is running. A real deployment should run this
// from a scheduled worker/cron or a dedicated background process.
const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
const secret = process.env.CRON_SECRET
if (!secret) {
  console.error('CRON_SECRET is required')
  process.exit(1)
}
const res = await fetch(`${appUrl.replace(/\/$/, '')}/api/cron?workflow=agent_jobs`, {
  headers: { Authorization: `Bearer ${secret}` },
})
console.log(await res.text())
process.exit(res.ok ? 0 : 1)
