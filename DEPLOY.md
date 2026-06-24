# Jobrolo — Deployment Guide

## Architecture

- **App**: Next.js 16 (Turbopack) on Railway
- **Database**: Postgres (Railway provisioned)
- **Storage**: S3-compatible (AWS S3, Cloudflare R2, or local fallback)
- **AI**: Z.ai SDK (free, rate-limited) or OpenAI-compatible API (APILayer, OpenAI)
- **OCR**: APILayer OCR.space (optional, for scanned PDFs)

## Quick Deploy (Railway)

1. **Push to GitHub** — Railway deploys from your repo.

2. **Create Railway project** with:
   - PostgreSQL database (auto-provisioned)
   - Next.js app (auto-detected from `package.json`)

3. **Set environment variables** (see `.env.production.example`):
   ```
   DATABASE_URL=<from Railway Postgres>
   DIRECT_DATABASE_URL=<same as DATABASE_URL>
   SESSION_SECRET=<openssl rand -hex 32>
   LLM_PROVIDER=openai-compatible
   LLM_API_KEY=<your key>
   LLM_BASE_URL=https://api.apilayer.com/marketplace/ai/v1
   LLM_MODEL=gpt-4o-mini
   STORAGE_PROVIDER=s3
   S3_BUCKET=<your bucket>
   S3_REGION=<your region>
   S3_ACCESS_KEY_ID=<your key>
   S3_SECRET_ACCESS_KEY=<your secret>
   NEXT_PUBLIC_APP_URL=https://your-app.up.railway.app
   ```

4. **Run migration** (first deploy only):
   ```bash
   npx prisma migrate deploy
   ```
   Or use Railway's build hook: `prisma migrate deploy && next build`

5. **Seed demo data** (optional):
   ```bash
   npx tsx scripts/seed.ts
   ```

6. **Set up cron** (optional — for stalled job detection, lead follow-ups):
   - Add a Railway Cron job hitting: `GET https://your-app.up.railway.app/api/cron?workflow=all`
   - With header: `Authorization: Bearer <CRON_SECRET>`

## Postgres Migration

The schema is already configured for Postgres. To migrate from SQLite:

1. Export your SQLite data (if needed):
   ```bash
   npx tsx scripts/export-sqlite.ts
   ```

2. Set `DATABASE_URL` to your Postgres connection string.

3. Push the schema:
   ```bash
   npx prisma db push
   ```

4. Import data (if you exported it):
   ```bash
   npx tsx scripts/import-postgres.ts
   ```

## Storage Configuration

### Local (dev only)
Files stored in `public/uploads/`. No configuration needed.

### S3 / Cloudflare R2 / MinIO
```env
STORAGE_PROVIDER=s3
S3_BUCKET=jobrolo-uploads
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com  # R2 only
S3_PUBLIC_URL=https://cdn.yourdomain.com  # optional CDN
```

## LLM Provider Configuration

### Z.ai (default, free)
No configuration needed. Rate-limited (~5 req/min).

### APILayer / OpenAI
```env
LLM_PROVIDER=openai-compatible
LLM_API_KEY=<your key>
LLM_BASE_URL=https://api.apilayer.com/marketplace/ai/v1
LLM_MODEL=gpt-4o-mini
LLM_VISION_MODEL=gpt-4o
```

## OCR Configuration

### No OCR (default)
Scanned PDFs marked as `needs_ocr`.

### APILayer OCR.space
```env
OCR_PROVIDER=apilayer_ocr
APILAYER_OCR_API_KEY=<your key>
```

## Health Check

`GET /api/health` returns:
```json
{
  "status": "healthy",
  "timestamp": "...",
  "checks": {
    "database": "ok",
    "ai_provider": "openai-compatible",
    "storage": "s3",
    "ocr_provider": "apilayer_ocr",
    "demo_mode": "off",
    "jobs_queued": "0",
    "jobs_processing": "0"
  }
}
```

## Auth

- JWT sessions in httpOnly cookies (30-day expiry)
- bcrypt password hashing (12 rounds)
- `JOBROLO_DEMO=1` bypasses auth for dev ONLY — never set in production
- Password reset requires email provider (not yet wired — set `RESET_EMAIL_PROVIDER` when ready)

## Worker Reliability

- AgentJobs persisted in Postgres (survives restarts)
- Stuck jobs auto-fail after 30 min (no heartbeat)
- `/api/cron?workflow=cleanup_stuck_jobs` cleans up timed-out jobs
- Job queue is processed inline (not separate worker process) — each API call that creates a job also processes it

## Troubleshooting

### Database connection errors
- Ensure `DATABASE_URL` and `DIRECT_DATABASE_URL` are set
- For Railway, both should be the same Postgres connection string
- Check that Postgres allows connections from your app's IP

### 429 rate limit errors
- Switch from `z-ai` to `openai-compatible` provider
- Set `LLM_PROVIDER=openai-compatible` + `LLM_API_KEY`

### Upload failures
- If using S3: verify `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` have write permissions
- If using local: ensure `public/uploads/` directory is writable
- Check file size (25MB max) and type (PDF, JPG, PNG, HEIC, DOCX, TXT, CSV)

### Chat not responding
- Check `/api/health` for database + AI provider status
- Check server logs for 429 errors from AI provider
- Verify `SESSION_SECRET` is set (JWT won't work without it)
