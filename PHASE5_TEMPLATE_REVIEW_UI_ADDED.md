# Phase 5 — Template Review UI

Phase 5 turns the Phase 3 template-intake backend into a usable contractor review workflow.

## What this phase adds

### Template review workspace

New component:

- `src/components/jobrolo/template-review-workspace.tsx`

New routes:

- `/templates`
- `/templates/intake`
- `/templates/review/[id]`

The review workspace lets a contractor or admin:

- create a template upload from an existing uploaded document ID
- see all template uploads
- run OCR/AI analysis on a template upload
- open a parsed template for human review
- review detected fields
- edit merge-variable mappings
- review detected clauses
- edit clause text/metadata
- review signature/date/initial fields
- review and edit generated template body HTML
- see warnings and add/remove review warnings
- preview the template before approval
- approve the template
- archive the template
- inspect source upload/version snapshots

## API updates

### `GET /api/document-templates`

Now supports:

- `status=all`
- `reviewStatus=needs_review|approved|archived|...`
- `imported=1`
- `needsReview=1`

This lets the UI list imported templates waiting for review, not only active templates.

### `GET /api/document-templates/uploads`

Now supports:

- `status=all`

### `PATCH /api/document-templates/[id]`

Now supports review edits beyond only name/body/status:

- `fields`
- `clauses`
- `signatureFields`
- `parseWarnings`
- `reviewStatus`
- `changeSummary`

When fields or clauses are edited, the UI updates the normalized rows and writes a new `DocumentTemplateVersion` snapshot.

## Chat-first card integration

`src/components/jobrolo/copilot-cards.tsx` now supports a `template_review` card type.

A message can include:

```json
{
  "contextType": "template_review",
  "contextData": {
    "templateId": "...",
    "name": "Contingency Agreement",
    "reviewStatus": "needs_review",
    "fieldCount": 8,
    "clauseCount": 6,
    "signatureFieldCount": 2
  }
}
```

The chat renders a review card with a link to `/templates/review/[id]`.

## Sidebar entry point

The sidebar now includes a Templates entry point so template review is reachable without manually typing a URL.

## Product rule preserved

AI can parse and structure contractor forms, but imported contractor templates should not become customer-facing until a human approves them.

This phase keeps that rule:

- parsed imports remain `needs_review`
- the review UI exposes warnings and source data
- approval writes approved status and version snapshot
- generated documents still require approved imported templates
