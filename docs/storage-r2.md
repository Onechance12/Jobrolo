# Jobrolo Cloudflare R2 storage setup

Jobrolo should use Cloudflare R2 for production uploads, photos, PDFs, generated documents, and thumbnails. Keep the bucket private. Jobrolo serves files through authenticated API routes instead of exposing raw R2 URLs.

## Cloudflare setup

1. In Cloudflare, create an R2 bucket for Jobrolo.
2. Keep the bucket private. Do not enable public bucket access for the app.
3. Create an R2 API token/access key. Prefer bucket-scoped Object Read & Write access for only the Jobrolo bucket.
4. Copy the Account ID, Access Key ID, and Secret Access Key once.

## Render environment variables

Add these directly in Render. Do not put secrets in GitHub.

```bash
STORAGE_PROVIDER=r2
R2_ACCOUNT_ID=...
R2_BUCKET=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
R2_REGION=auto
```

`R2_ENDPOINT` can be omitted if `R2_ACCOUNT_ID` is present. The app also supports S3-compatible fallback names (`S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION`) for compatibility, but the R2 names are clearer.

## What changes when R2 is enabled

- New uploads are written to R2.
- `Document.filePath` stores a private object pointer such as `r2://bucket/contractors/.../original/file.pdf`.
- `Document.thumbnailPath` stores the private thumbnail pointer.
- Browser-facing URLs remain authenticated Jobrolo URLs like `/api/storage/docs/...` and `/api/storage/thumbnails/...`.
- Local storage still works for development.
- Existing local files are not deleted or automatically migrated.

## Health check

After redeploying with R2 env vars, sign in as owner/admin and call:

```text
GET /api/admin/storage/health
```

Expected:

- `provider: "r2"`
- `configured: true`
- `canWrite: true`
- `canRead: true`
- `canDelete: true`

The response may show bucket name and endpoint host, but it never exposes access keys.

## Usage check

As owner/admin:

```text
GET /api/admin/storage/usage
```

This reports document count, photo count, PDF-like count, total stored bytes from Document rows, thumbnail count, and last upload. This is an early foundation for future storage pricing.

## Migration dry-run

Do not run destructive migrations. This script never deletes local files.

Dry-run:

```bash
node scripts/migrate-local-storage-to-r2.mjs
```

Execute:

```bash
node scripts/migrate-local-storage-to-r2.mjs --execute
```

Optional limit:

```bash
node scripts/migrate-local-storage-to-r2.mjs --limit=50
```

The script uploads local originals/thumbnails to R2 and updates `Document.filePath`/`thumbnailPath` only after upload succeeds.

## Live test sequence

1. Deploy with `STORAGE_PROVIDER=r2`.
2. Call `/api/admin/storage/health`.
3. Upload one small PDF.
4. Open the PDF through Jobrolo.
5. Upload one image.
6. Confirm original image and thumbnail open through Jobrolo.
7. Redeploy the Render service.
8. Re-open the same uploaded file to confirm persistence.

## Direct browser uploads

Deferred for now. Because uploads currently pass through Jobrolo, CORS and presigned browser uploads are not needed yet. Direct-to-R2 uploads can be added later for large photo batches, but must preserve auth, tenant scoping, and metadata creation.
