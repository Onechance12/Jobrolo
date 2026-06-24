# Phase 6 — Final Documents + Signed PDF Output

Phase 6 makes generated/signable documents produce durable PDF artifacts that are saved back into the job packet and surfaced inside the chat-first operator thread.

## What changed

### Schema additions

`GeneratedDocument` now tracks:

- `unsignedPdfPath`
- `unsignedPdfDocumentId`
- `signedPdfDocumentId`
- `finalHtmlPath`
- `signatureCertificateJson`
- `finalizedAt`

`SignatureRequest` now tracks:

- `signedPdfPath`
- `signedPdfDocumentId`
- `certificateJson`

The existing `signedPdfPath` field on `GeneratedDocument` remains supported.

### New final document service

Added:

- `src/lib/final-documents.ts`

Core functions:

- `createUnsignedDocumentPdf()`
- `finalizeSignedDocument()`
- `getSignedDocumentArtifacts()`
- `createSimplePdfBuffer()`
- `htmlToPlainText()`

The MVP PDF generator is dependency-light and server-side. It converts the approved document HTML into a text-based PDF snapshot and adds a signature certificate/audit section for signed copies. This avoids adding Puppeteer/Playwright for the MVP. A richer HTML-to-PDF renderer can replace the internal PDF writer later without changing the API shape.

### New API routes

Added:

- `GET /api/generated-documents/[id]/pdf`
- `POST /api/generated-documents/[id]/pdf`
- `POST /api/signature-requests/[id]/pdf`

Updated:

- `POST /api/generated-documents`
- `POST /api/signature-requests`
- `POST /api/signature-requests/[id]/sign`

### Signing flow

When a signer completes a signature:

1. `SignatureRequest.status` becomes `signed`.
2. The generated document status becomes `signed`.
3. Jobrolo creates a final signed PDF.
4. The PDF is saved as a private `Document` record.
5. The PDF is linked to the job packet via `DocumentLink` with role `signed_copy`.
6. A project timeline event is created.
7. A chat-native signed document card is posted to the project workspace thread.

### Unsigned PDF preview

Generated documents can now produce an unsigned PDF preview before being sent for signature.

The preview is saved as a private document and linked to the generated document/job packet.

### Chat-native PDF cards

Updated:

- `src/components/jobrolo/copilot-cards.tsx`

New supported card behavior:

- `generated_document_pdf`
- `signed_document`

The thread can now show:

- “PDF preview ready”
- “Document signed”
- Preview/download buttons
- Signed PDF saved status

### Agent tools

Added tools:

- `create_document_pdf_preview`
- `get_document_pdf_artifacts`

These let Jobrolo create previews and inspect final document artifacts from the chat-first workflow.

## Security notes

- PDFs are saved in private storage, not public uploads.
- Files are served through `/api/storage/docs/...`, which verifies contractor-owned `Document` records before streaming.
- Signed PDF generation is idempotent: if a signed PDF already exists for the request, Jobrolo returns the existing artifact instead of creating duplicates.
- Public signing remains token-scoped. Authenticated office users access final PDFs through the private storage route.

## MVP limitation

The PDF renderer is intentionally simple: it generates valid PDF snapshots from plain text extracted from the document HTML. It does not yet preserve all HTML styling, tables, signatures as drawn ink, or exact page layout.

Later upgrade path:

- Replace `createSimplePdfBuffer()` with a full renderer such as Playwright/Puppeteer, react-pdf, or a dedicated document service.
- Keep the same routes, records, job packet links, and chat cards.

## Still needed later

- Rich HTML-to-PDF rendering
- Email/SMS delivery of signed copies
- Customer-accessible signed-copy download flow
- Better visual signature capture
- Final document version comparison
- Batch document packets
