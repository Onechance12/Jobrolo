# Phase 7 — Roof Report Builder Polish

Phase 7 turns the existing roof report foundation into a usable field/report workflow.

## Added

- `src/lib/roof-reports.ts`
  - report workspace resolver
  - photo checklist engine
  - grouped photo output
  - heuristic homeowner-friendly summary/recommendation generator
  - report finalization flow
  - report share-card posting into the project thread
  - server-side roof report PDF snapshot creation

- `src/components/jobrolo/roof-report-builder.tsx`
  - full report builder/review workspace
  - report details editor
  - customer-facing narrative editor
  - photo grouping by area/category
  - photo metadata controls: category, condition, severity, caption, included/cover
  - missing photo checklist
  - preview/share/finalize/create PDF actions

- Routes
  - `GET /reports`
  - `GET /reports/[id]`
  - `GET /api/roof-reports/[id]/workspace`
  - `POST /api/roof-reports/[id]/summary`
  - `POST /api/roof-reports/[id]/finalize`
  - `POST /api/roof-reports/[id]/pdf`
  - `POST /api/roof-reports/[id]/photos/bulk`
  - `PATCH /api/roof-reports/[id]/photos/[photoId]`
  - `DELETE /api/roof-reports/[id]/photos/[photoId]`

## Schema updates

`RoofReport` now stores:

- `mode`
- `summaryTone`
- `internalNotes`
- `photoChecklistJson`
- `missingPhotoChecklistJson`
- `reportPdfPath`
- `reportPdfDocumentId`
- `completedAt`

`RoofReportPhoto` now stores:

- `area`
- `tagsJson`
- `aiCaptionStatus`
- `isIncluded`
- `isCoverPhoto`
- `takenAt`
- `updatedAt`

## Chat-native cards

Added a `roof_report` card type in `copilot-cards.tsx`.

Jobrolo can now post a roof report card into the same project thread with:

- Open builder
- Preview report
- Share link
- PDF link

## Agent tools

Added:

- `get_roof_report_workspace`
- `generate_roof_report_summary`
- `finalize_roof_report`
- `create_roof_report_pdf`

## Public share polish

The public shared report page now embeds report image data server-side when possible so shared roof report photos can render without requiring the homeowner to be authenticated.

## Storage patch

Added missing local storage helper and authenticated `/api/storage/[dir]/[filename]` route. The route verifies the file belongs to the current contractor for private app usage.

## Still later

- true high-fidelity PDF rendering from HTML/photos
- drag-and-drop photo ordering
- direct mobile camera capture into report categories
- AI vision damage tagging from images
- customer-facing report themes
- email/SMS delivery of report links
