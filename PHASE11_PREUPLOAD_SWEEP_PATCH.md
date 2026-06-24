# Phase 11 — Pre-upload Sweep Patch

This sweep was performed before pushing/uploading the Phase 9-10 baseline for live testing.

## Checks performed

- Confirmed archive hygiene: no `.git`, `.env`, `.next`, `node_modules`, local DB, storage folder, uploads, worklog, or TypeScript cache should be packaged.
- Ran static local import resolution across all `src/**/*.ts(x)` files.
- Ran Prisma schema duplicate model/field scan.
- Ran `node scripts/preflight.mjs` successfully.
- Scanned frontend API calls for missing backend routes.
- Ran a no-dependency TypeScript parse/static sweep to catch syntax-level issues before install.

## Critical fixes made

### Restored missing upload route

`/api/upload` was referenced by the chat upload hooks but was missing from the Phase 9-10 full ZIP.

Restored:

- `src/app/api/upload/route.ts`

This is required for document/photo upload, field location upload resolution, OCR queueing, and job packet linking.

### Restored authenticated storage route

`/api/storage/[dir]/[filename]` was referenced throughout the app but was missing from the Phase 9-10 full ZIP.

Restored:

- `src/app/api/storage/[dir]/[filename]/route.ts`

This route verifies tenant ownership before streaming private files.

### Patched upload storage provider compatibility

Updated:

- `src/lib/upload.ts`

Uploads now use the central `src/lib/storage.ts` provider instead of writing directly to local filesystem paths only. This keeps uploads compatible with both:

- local private storage
- S3/R2-compatible storage

HEIC conversion now reads through `readStoredFile()` and writes the converted JPEG/thumbnail through `saveFile()`.

### Patched DOCX extraction for storage providers

Updated:

- `src/lib/document-ai.ts`

DOCX extraction now reads the file through `readStoredFile()` and passes a buffer to Mammoth. This avoids local-path-only behavior when using S3/R2 storage.

### Patched chat job result type

Updated:

- `src/lib/chat-job.ts`

The in-memory chat job result type now includes:

- `contextType`
- `contextData`

This matches the chat-native card system.

### Patched production start script and Node types

Updated:

- `package.json`

Changes:

- app name set to `jobrolo`
- `start` script uses `node` instead of `bun`
- added `@types/node` dev dependency

### Minor type hardening

Updated:

- `src/lib/agent/tools-v2.ts`
- `src/lib/copilot-proactive.ts`
- `src/lib/onboarding/agent.ts`
- `src/components/jobrolo/radar-panel.tsx`
- `src/components/jobrolo/workspace-sidebar.tsx`

These changes remove avoidable unknown/iterator type issues surfaced during the no-dependency TypeScript sweep.

## Remaining required verification

A real dependency-backed build still must be run locally/GitHub:

```bash
npm install
npx prisma generate
npx prisma db push
npx tsc --noEmit
npm run build
npm run preflight
```

The sweep could not run the full build because dependencies are intentionally not included in the ZIP.
