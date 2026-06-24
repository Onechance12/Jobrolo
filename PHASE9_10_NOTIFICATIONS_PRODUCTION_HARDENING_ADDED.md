# Phase 9 + 10 — Notifications, Communication Layer, Production Hardening

## Goal

Phase 9 and Phase 10 were implemented together after a duplication review.

The important rule preserved in this phase:

> `InboxItem` remains the canonical in-app notification / role-routed work card. Email and SMS are delivery layers, not a second workflow system.

This avoids duplicating the existing Role Routing / ActionRequest / ApprovalRequest architecture.

---

## Duplication review

Existing pieces found and reused:

- `InboxItem` already existed for role-specific chat cards.
- `ActionRequest` already existed for work that needs action.
- `ApprovalRequest` already existed for approval gates.
- `CopilotCardFromMessage` already existed for chat-native cards.
- `rate-limit.ts` already existed, so no duplicate rate limiter was added.
- `next.config.ts` already had security headers, so this phase adjusted them rather than adding a second middleware layer.
- `/api/cron` already existed, so notification dispatch was added as a system workflow.
- `storage.ts` already existed, so storage hardening extended it instead of creating another storage helper.

New models added only where there was no existing equivalent:

- `NotificationPreference` — per-user/role delivery preferences.
- `CommunicationMessage` — outbound email/SMS/digest outbox.

---

## Phase 9 — Notifications + Communication Layer

### New files

- `src/lib/notifications.ts`
- `src/lib/communications.ts`
- `src/app/api/notifications/route.ts`
- `src/app/api/notifications/[id]/route.ts`
- `src/app/api/notifications/preferences/route.ts`
- `src/app/api/communications/outbox/route.ts`
- `src/app/api/communications/outbox/[id]/send/route.ts`
- `src/app/settings/notifications/page.tsx`

### New schema models

- `NotificationPreference`
- `CommunicationMessage`

### Behavior

When a role-routed `InboxItem` is created, Jobrolo now:

1. Keeps the in-app inbox/chat card as the source of truth.
2. Reads notification preferences for the user/role.
3. Queues email/SMS delivery only when preferences allow it.
4. Dedupes outbound messages with stable keys.
5. Optionally sends immediately if `NOTIFICATIONS_SEND_IMMEDIATELY=true` or urgency requires it.

### Communication providers

Email supports:

- `console`
- `resend`
- `sendgrid`
- `postmark`

SMS supports:

- `console`
- `twilio`

Outbound delivery is disabled/skipped in production unless:

```env
COMMUNICATIONS_ENABLED=true
```

This prevents accidental customer/crew text blasts while testing.

### Signature integration

Signature flows now queue communication events:

- Signature request created → optional signer email delivery with signing link.
- Signature completed → optional signed-copy email delivery.
- PM/coordinator notification created when signature request is sent or completed.

### Field/role routing integration

`field-copilot.ts` now calls `handleInboxItemCreated()` when role-routed inbox items are created.

Example:

Crew requests material → `InboxItem` for PM/coordinator → notification preferences checked → email/SMS queued if enabled.

---

## Phase 10 — Production Hardening

### Production readiness report

Added:

- `src/lib/production-readiness.ts`
- `GET /api/admin/readiness`

The readiness report checks:

- `NODE_ENV`
- `DATABASE_URL` provider
- `SESSION_SECRET`
- `CRON_SECRET`
- `NEXT_PUBLIC_APP_URL`
- `STORAGE_PROVIDER`
- S3/R2 credentials
- email provider readiness
- SMS provider readiness
- communication sending enabled/disabled
- demo mode guard
- database connection

### Preflight script

Added:

```bash
npm run preflight
npm run build:verify
npm run db:deploy
```

`npm run preflight` blocks dangerous production config such as:

- missing `SESSION_SECRET`
- missing `CRON_SECRET`
- `JOBROLO_DEMO=1` in production
- S3 provider selected without S3 credentials
- communication providers enabled without required secrets

### Storage hardening

`src/lib/storage.ts` now supports:

- local private storage
- S3/R2-compatible object storage for files saved through `saveFile()`
- authenticated reads through `/api/storage/...`
- `readStoredFile()` for local or `s3://bucket/key` paths

The storage route now resolves actual document-owned file paths instead of blindly constructing local paths.

### Security header adjustment

`next.config.ts` already had security headers. This phase adjusted `Permissions-Policy` so Field Copilot features can use browser GPS and photo capture:

```text
camera=(self), microphone=(), geolocation=(self)
```

This fixes a conflict where earlier headers blocked the location resolver.

### Cron integration

Added system workflow:

```text
dispatch_notifications
```

Call through `/api/cron?workflow=dispatch_notifications` with the existing `CRON_SECRET` bearer token.

---

## Environment variables added

See `.env.example` for the complete set.

Key additions:

```env
COMMUNICATIONS_ENABLED=false
NOTIFICATIONS_EMAIL_DEFAULT=false
NOTIFICATIONS_SMS_DEFAULT=false
NOTIFICATIONS_SEND_IMMEDIATELY=false
EMAIL_PROVIDER=console
EMAIL_FROM=Jobrolo <notifications@example.com>
SMS_PROVIDER=console
STORAGE_PROVIDER=local
```

Provider-specific keys:

```env
RESEND_API_KEY=
SENDGRID_API_KEY=
POSTMARK_SERVER_TOKEN=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=
```

---

## Still intentionally not done

- No customer marketing SMS campaigns.
- No automatic mass texting.
- No push notifications yet.
- No daily digest renderer yet beyond the queued model foundation.
- No production Postgres migration file generated in this sandbox.
- Existing legacy upload path still writes uploaded photos/docs locally; the hardened `saveFile()` path supports S3 for generated PDFs/reports and future upload refactors.

---

## Next recommended phase

Phase 11 should be a build/test stabilization pass or a focused mobile UX polish pass.

Do not add another major feature before running:

```bash
npm install
npx prisma generate
npx prisma db push
npx tsc --noEmit
npm run build
```
