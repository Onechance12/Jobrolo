# Phase 3 — Contractor Template Intake

This phase adds the foundation for contractor-specific template intake: a contractor can upload an existing agreement, authorization, estimate/proposal template, warranty, change order, or completion certificate, then Jobrolo uses existing OCR/document extraction plus AI structure parsing to convert it into a reusable reviewable template.

## What was added

### Prisma models

- `DocumentTemplateUpload` — tracks the original uploaded document, extracted/OCR text, parse status, review status, conflicts, missing fields, and generated template ID.
- `DocumentTemplateField` — stores detected fillable fields such as customer name, project address, claim number, signature, initials, dates, and price fields.
- `DocumentTemplateClause` — stores detected clauses while preserving the contractor's original language.
- `DocumentTemplateVersion` — snapshots template versions for review/approval history.

`DocumentTemplate` was extended with source upload/document metadata, review status, imported flags, detected fields, clauses, signature fields, parse warnings, and approval fields.

### Template intake library

New file:

- `src/lib/template-intake.ts`

Exports:

- `createTemplateUploadFromDocument()`
- `analyzeTemplateUpload()`
- `analyzeTemplateText()`
- `saveTemplateAnalysis()`
- `getTemplateReview()`
- `approveDocumentTemplate()`
- `generateDocumentFromTemplate()`
- `TEMPLATE_VARIABLES`

The parser is intentionally conservative: it preserves contractor legal/business wording and makes the AI structure fields/clauses/signature zones rather than rewriting terms.

### API routes

New routes:

- `GET /api/document-templates/uploads`
- `POST /api/document-templates/uploads`
- `GET /api/document-templates/uploads/[id]`
- `POST /api/document-templates/uploads/[id]/analyze`
- `GET /api/document-templates/[id]`
- `PATCH /api/document-templates/[id]`
- `POST /api/document-templates/[id]/approve`

### Agent tools

Added tools in `src/lib/agent/tools-v2.ts`:

- `create_template_upload_from_document`
- `analyze_template_upload`
- `list_document_templates`
- `get_template_review`
- `approve_document_template`
- `generate_document_from_template`

Mutation tools require approval. Read-only template review/list tools do not.

### UI placeholder page

Added:

- `/templates/intake`

This page documents the intake workflow and API flow. It is a foundation page, not the final drag/drop template builder.

## Workflow

1. Contractor uploads an existing agreement/template through normal document upload.
2. Jobrolo processes the file through OCR/document extraction.
3. The contractor or AI creates a `DocumentTemplateUpload` from the processed `Document`.
4. `analyze_template_upload` converts the OCR/extracted text into a reviewable `DocumentTemplate` with fields/clauses/signature zones.
5. Contractor reviews and approves the template.
6. Approved templates can generate project/customer-specific `GeneratedDocument` records.
7. Generated documents can move into signature requests and job packet workflows.

## Safety rules

- Original uploaded file is preserved.
- AI does not silently rewrite legal terms.
- Imported templates are `needs_review` until approved.
- Imported templates must be approved before live customer-facing document generation.
- Mutation tools require approval.
- Every record is scoped by `contractorId`.

## Next phase

Phase 4 should build the review/editor UI and make the review process easier:

- clause editor
- field mapping editor
- signature/initial/date field editor
- template preview
- approve/archive controls
- warnings/conflicts display
