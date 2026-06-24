# Phase 12 — Production Stabilization / P0 Hardening

This phase intentionally stops feature work and hardens the alpha before GitHub/build testing.

## Fixed / changed

### 1. Private storage route restored
Added:

- `src/app/api/storage/[dir]/[filename]/route.ts`

The route validates authentication, prevents path traversal, maps requested files back to tenant-owned `Document` records, supports docs/photos/thumbnails/TTS cache, returns content type, and never exposes raw filesystem paths.

### 2. Production database direction moved to Postgres
Changed:

- `prisma/schema.prisma` provider from `sqlite` to `postgresql`
- Kept `prisma/schema.sqlite.prisma` as a legacy local reference
- Updated `.env.example`, package scripts, and preflight expectations

Production/external beta should use:

```bash
DATABASE_URL=postgresql://...
npx prisma migrate dev --name baseline
npx prisma migrate deploy
```

Do not use `prisma db push` for production data.

### 3. Durable worker path added
Changed queue behavior so inline processing is dev-only by default. In production, set:

```bash
AGENT_JOBS_INLINE=false
```

Then run worker/cron processing with:

```bash
npm run worker:loop
# or call /api/cron?workflow=agent_jobs with CRON_SECRET
```

Added:

- `processQueuedAgentJobs()`
- `agent_jobs` cron workflow
- `/api/admin/jobs` for admin visibility and manual worker ticks

### 4. Approval replay workflow added
Approval-required AI tools no longer dead-end. They now create:

- `ActionRequest`
- `ApprovalRequest`
- `InboxItem`

Approving `/api/action-requests/[id]/decision` replays the stored tool call with `approved: true`, updates the request, and returns the tool result.

### 5. Server-side permissions tightened
Added:

- `src/lib/security/permissions.ts`

Applied role checks to sensitive mutation routes including contractor profile, templates, generated documents, signatures, admin jobs, and action-request decisions. This is not the final permission matrix, but it moves critical actions from UI-only role hiding toward server enforcement.

### 6. Public/generated HTML sanitized
Added:

- `src/lib/security/html.ts`

Sanitization now strips scripts, event handlers, javascript URLs, dangerous tags, embedded objects, forms, and unsafe inline patterns before rendering public signature documents or generating PDFs.

Patched:

- public signing page
- generated document creation
- document template create/update
- template intake generated HTML
- PDF rendering
- template review preview

### 7. CSRF/origin guard added
Added:

- `middleware.ts`

Cookie-authenticated API write requests now enforce same-origin/referer checks. API-key integrations are exempt because they do not rely on browser cookies.

### 8. CSP hardened
Removed `unsafe-eval` from production script CSP while keeping it in development for tooling.

### 9. Subscription/trial state clarified
Added `subscriptionStatus` to `Contractor`:

- `trialing`
- `active`
- `past_due`
- `canceled`
- `expired`

The session context now checks trial expiry against `subscriptionStatus` instead of only `plan=free`.

## Still required before serious external beta

1. Run dependency-backed build:

```bash
npm install
npx prisma generate
npx prisma migrate dev --name baseline
npx tsc --noEmit
npm run build
npm run preflight
```

2. Commit the generated Postgres baseline migration SQL.
3. Review every route for final role/permission matrix.
4. Replace in-memory rate limiting with Redis/Upstash implementation or enforce it at the platform edge.
5. Run workflow smoke tests: signup, login, upload, storage view, property memory, document generation, signature, PDF, roof report, approval replay, worker jobs, tenant isolation.
6. Add real test coverage before public SaaS.

## Honest status

This is now a stronger production-hardening baseline, but it is still an internal alpha until the real install/build/migration cycle passes.
