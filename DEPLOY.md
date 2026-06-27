# Jobrolo — Render Deployment Guide

Jobrolo deploys from GitHub to Render. GitHub is the source of truth; environment variables and secrets belong in Render, not in the repo.

## Architecture

- App: Next.js on Render Web Service
- Database: Render Postgres
- Storage: Cloudflare R2 recommended for production; local storage is development/prototype only
- AI: OpenAI-compatible provider through `LLM_*` environment variables
- OCR: embedded PDF text first, OpenAI-compatible vision for rendered/scanned pages when configured, optional external OCR provider for heavier scans
- Jobs: prototype can run inline; production should move durable jobs to worker/cron

## Render Web Service

Build command:

```bash
npm install --include=dev && npx prisma generate && npm run preflight && npm run build
```

Start command:

```bash
npm run start
```

Health check:

```text
/api/health
```

Node:

```text
NODE_VERSION=22
```

## Required production environment variables

```env
NODE_ENV=production
APP_ENV=production
NODE_VERSION=22
DATABASE_URL=<Render Postgres internal URL>
SESSION_SECRET=<secure random value>
CRON_SECRET=<secure random value>
NEXT_PUBLIC_APP_URL=https://jobrolo.onrender.com
JOBROLO_DEMO=0
LLM_PROVIDER=openai-compatible
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
LLM_API_KEY=<secret>
```

Do not set `PORT`; Render injects it.

## Recommended production storage

Use private Cloudflare R2:

```env
STORAGE_PROVIDER=r2
R2_ACCOUNT_ID=...
R2_BUCKET=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_REGION=auto
```

`R2_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com` can be set explicitly, or omitted when `R2_ACCOUNT_ID` is present.

Files are served through authenticated Jobrolo routes such as `/api/storage/docs/...`; do not make the bucket public.

See [docs/storage-r2.md](docs/storage-r2.md).

## Prisma migration policy

Production must use migrations, not `prisma db push`.

Important: if a production database was originally bootstrapped with `prisma db push`, do not blindly add `npx prisma migrate deploy` to the Render build command. First check and reconcile migration history.

Safe inspection:

```bash
npx prisma migrate status --schema prisma/schema.prisma
```

If the existing production database already has the baseline schema but `_prisma_migrations` does not mark the baseline applied, resolve the baseline first:

```bash
npx prisma migrate resolve --applied 00000000000000_baseline --schema prisma/schema.prisma
```

Then apply pending migrations:

```bash
npx prisma migrate deploy --schema prisma/schema.prisma
```

Avoid in production:

```bash
npx prisma db push
npx prisma migrate reset
npx prisma migrate dev
```

After migration history is reconciled, the Render build command may be updated to:

```bash
npm install --include=dev && npx prisma generate && npx prisma migrate deploy --schema prisma/schema.prisma && npm run preflight && npm run build
```

## Communications / invites

Copyable invite links work without Twilio.

To send SMS automatically, configure:

```env
COMMUNICATIONS_ENABLED=true
SMS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM_NUMBER=...
```

Email delivery requires `COMMUNICATIONS_ENABLED=true` and a supported email provider such as Resend, SendGrid, or Postmark.

## Health checks

Main health:

```text
GET /api/health
```

Storage health as owner/admin/manager:

```text
GET /api/admin/storage/health
```

Storage usage as owner/admin/manager:

```text
GET /api/admin/storage/usage
```

AI usage as owner/admin/manager:

```text
GET /api/admin/ai-usage
```

## Prototype limitations to remember

- Local storage on Render is not durable; use R2 before real customer files matter.
- Inline jobs are acceptable for early testing but should become worker/cron-backed for production.
- AI usage logging requires the `AIUsageLog` migration/table.
- External crew/customer accounts must be tested carefully for scoped chat/file visibility before broad beta.
