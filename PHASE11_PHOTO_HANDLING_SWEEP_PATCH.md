# Phase 11 Photo Handling Sweep Patch

This patch tightens the photo/document upload path before GitHub upload/testing.

## Fixed

- Restored authenticated private storage route: `/api/storage/[dir]/[filename]`.
  - Serves `photos`, `thumbnails`, `docs`, and `tts-cache` through auth.
  - Prevents raw file-system paths from being exposed.
  - Fixes photo previews, document previews, signed PDFs, and roof report image/PDF links that rely on `/api/storage/...` URLs.

- Patched DOCX extraction in `document-worker.ts` to read through the storage abstraction instead of assuming local filesystem paths.
  - This keeps document analysis compatible with local storage and S3/R2 storage.

- Patched upload response metadata to return the real stored `mimeType`.
  - Chat/workspace attachment rendering no longer incorrectly labels all photos as `image/jpeg`.

- Added roof-report-aware upload support to `/api/upload`.
  - Uploads can now include `roofReportId`/`reportId` and optional photo metadata.
  - Photo uploads to a report automatically create a `RoofReportPhoto`, link the document to the report/job packet, and refresh the missing-photo checklist.
  - Supported metadata: `photoCategory`, `category`, `slotKey`, `photoArea`, `photoCondition`, `photoSeverity`, `photoCaption`, `photoNotes`, `takenAt`.

- Added HEIF extension handling to safe URL resolution.

## Still intentionally not solved in this patch

- Full inspection placeholder/slot model is not added yet. Current report photo matching still uses `category` as the slot-like key.
- Best next roof-report patch is a dedicated `RoofReportPhotoSlot` model with required placeholders such as Front Elevation, Right Elevation, Rear Elevation, Left Elevation, Interior Ceiling, etc.
