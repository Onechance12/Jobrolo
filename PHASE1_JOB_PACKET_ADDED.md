# Phase 1 Added — Job Packet + Project Context + OCR Review Visibility

This patch makes Jobrolo behave more like the source-of-truth operating system we discussed. The goal of Phase 1 is not more UI polish; it is connecting the brain, files, appointments, roof reports, generated docs, signatures, and OCR review data back to the correct job/project.

## Added schema models

### `DocumentLink`
Universal file/job packet link layer. A document can now be attached to a project/customer and to a specific operational entity such as:

- project
- appointment
- roof_report
- generated_document
- signature_request
- scope_analysis
- task
- estimate
- template

Each link has a role such as:

- carrier_estimate
- inspection_photo
- signed_copy
- authorization
- contract
- supplement
- report_photo
- evidence
- attachment

### `ProjectTimelineEvent`
Unified job timeline layer for source-of-truth context. This is separate from existing `ProjectActivity` and is meant to give the AI agent and job packet a single chronological view of what happened on the job.

## Added backend helper

New file:

`src/lib/project-context.ts`

Exports:

- `getProjectContext(ctx, projectId)`
- `getProjectContextByContractor(projectId, contractorId)`
- `getProjectDocumentPacket(projectId, contractorId)`
- `linkDocumentToJobPacket(input)`
- `createProjectTimelineEvent(input)`

## OCR visibility

The project packet now exposes OCR/extraction review information per document:

- extraction confidence
- extraction method
- conflict count
- missing data count
- conflicts JSON
- missing data JSON
- embedded text length
- vision/OCR text length
- final OCR text length
- review notes
- warnings
- review status: `not_processed`, `ok`, `review_recommended`, `review_required`

This lets the AI say things like:

- “The carrier estimate needs OCR review.”
- “The deductible is missing from the extracted data.”
- “Embedded text and OCR disagree on claim number.”

## Added API routes

- `GET /api/projects/[id]/context`
- `GET /api/projects/[id]/packet`
- `GET /api/projects/[id]/document-links`
- `POST /api/projects/[id]/document-links`

## Agent tools added

Added to `src/lib/agent/tools-v2.ts`:

- `get_project_context`
- `get_project_document_packet`
- `link_document_to_project`

Updated operational agent tools so AI-created records must attach to a job/project or customer:

- `create_appointment`
- `create_roof_report`
- `create_generated_document`

If the agent cannot identify the project/customer, it should ask which job to attach the action to instead of creating orphan records.

## Routes updated

- Uploads now create job packet document links when `projectId` is supplied.
- Uploads create timeline events when linked to a project.
- Appointment creation logs timeline events.
- Roof report creation logs timeline events.
- Generated document creation logs timeline events.
- Signature request creation logs timeline events.

## Prompt rules updated

The main Jobrolo prompt now instructs the agent:

- Jobrolo is the source of truth.
- Operational records must attach to the correct project/job.
- If the project is unknown, ask which job to attach it to.
- Use `get_project_context` / `get_project_document_packet` before giving job-specific operational recommendations.

## Commands to run after extracting

```bash
npm install
npx prisma generate
npx prisma db push
npx tsc --noEmit
npm run build
```

## Next recommended phase

Phase 2 should be Contractor Profile:

- company name
- logo
- phone/email/address
- license number
- brand colors
- warranty/legal footer
- report/document defaults

That profile will feed roof reports, generated documents, estimate/proposal templates, and signing pages.

## Phase 1 Completion Additions

This pass also completes the source-of-truth layer with:

- `GET /api/projects/[id]/timeline` — unified job timeline.
- `POST /api/projects/[id]/timeline` — manually add timeline events with tenant/project ownership checks.
- `GET /api/ocr-review?projectId=...` — contractor-wide or project-specific OCR review queue.
- Agent tools:
  - `get_project_timeline`
  - `get_ocr_review_queue`
- Document worker timeline bridge:
  - completed analyses create `document_analyzed` events.
  - low-confidence/conflicted/failed OCR creates `document_review_needed` events.

These additions make OCR review visible to the AI operator and place document-processing results inside the project/job timeline.
