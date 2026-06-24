# Jobrolo Field Operations Add-on

This archive extends the cleaned WS20 baseline with the missing field workflow layer:

## Added database models
- `Appointment` — inspections, adjuster meetings, production dates, material deliveries, walkthroughs, calls
- `ProjectSchedule` — project stage, production schedule, crew, material delivery, weather hold, milestones
- `RoofReport` — Jobrolo roof inspection report header/summary/recommendations/conclusion/disclaimer/share token
- `RoofReportPhoto` — categorized inspection photos with condition/severity/caption/notes
- `DocumentTemplate` — reusable signable templates: contingency, inspection authorization, work authorization, change order, completion certificate
- `GeneratedDocument` — merged document body connected to project/customer
- `SignatureRequest` — signer details, status, token, audit fields, signature data
- `SignatureEvent` — signature audit trail events

## Added API routes
- `GET/POST /api/appointments`
- `GET/PATCH/DELETE /api/appointments/[id]`
- `GET/PUT /api/projects/[id]/schedule`
- `GET/POST /api/roof-reports`
- `GET/PATCH /api/roof-reports/[id]`
- `POST /api/roof-reports/[id]/photos`
- `GET /api/roof-reports/[id]/print` — print-ready HTML for browser Save as PDF
- `POST /api/roof-reports/[id]/share`
- `GET/POST /api/document-templates`
- `POST /api/document-templates/defaults`
- `GET/POST /api/generated-documents`
- `GET/POST /api/signature-requests`
- `POST /api/signature-requests/[id]/sign`

## Added public pages
- `/reports/share/[token]` — shared roof report viewer
- `/sign/[token]` — simple signable document viewer/form

## Added brain/tools
- `create_appointment`
- `list_schedule`
- `update_project_schedule`
- `create_roof_report`
- `create_generated_document`
- `create_signature_request`

Mutation tools require human approval through the existing `requiresApproval` gate.

## Important next step
After extracting this archive, run:

```bash
npm install
npx prisma generate
npx prisma db push
npm run build
```

Because the Prisma schema changed, the Prisma client must be regenerated before TypeScript/build will recognize the new models.

## Still needed later
- Real Google/Outlook Calendar sync
- Real PDF rendering service instead of browser print-to-PDF
- Full signature UI polish / signed PDF finalization
- Postgres migration and migrations
- External storage for Vercel/R2/S3
