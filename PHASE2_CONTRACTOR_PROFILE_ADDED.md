# Phase 2 Complete — Contractor Company Profile

This phase adds the contractor/company profile layer that customer-facing Jobrolo outputs will use for branding, legal defaults, and merge fields.

## What was added

### Prisma schema
Added `ContractorProfile` with a unique `contractorId` relationship and fields for:

- company/legal/display name
- logo URL or logo document id
- address
- phone/email/website
- license number and insurance text
- public contact name/title
- brand colors and brand mode
- default terms
- payment instructions
- warranty text
- legal footer
- report, contract, and estimate disclaimers
- metadata JSON

The `Contractor` model now has a `profile` relation.

### Company profile helper
Added `src/lib/contractor-profile.ts`:

- `getContractorProfile()`
- `getOrCreateContractorProfile()`
- `upsertContractorProfile()`
- `publicContractorProfile()`
- `contractorMergeData()`
- `buildProjectMergeData()`
- `mergeTemplateVariables()`
- `renderCompanyHeaderHtml()`

This is the central source for company profile data and merge fields.

### API routes
Added:

- `GET /api/contractor/profile`
- `PATCH /api/contractor/profile`
- `PUT /api/contractor/profile`
- `GET /api/company-profile` alias
- `PATCH /api/company-profile` alias
- `GET /api/document-templates/merge-fields`

The profile API requires auth and tenant context. Logo document IDs are checked against the contractor before being used.

### Settings page
Added:

- `/settings/company`

This gives a basic company profile form and a merge-field preview.

### Document/report/signature integration
Updated:

- roof report print/share rendering uses the contractor profile header and legal/footer/disclaimer fields
- roof report creation defaults to the contractor profile contact/disclaimer when available
- generated documents merge approved templates with contractor, project, customer, and estimate fields
- signature page displays contractor profile identity/contact and legal footer
- `/api/data` includes `contractorProfile`
- project context/document packet includes `contractorProfile`

### Agent tools
Added to `tools-v2.ts`:

- `get_contractor_profile`
- `update_contractor_profile` — requires approval

Generated-document tools now use the contractor profile/project/customer merge context when filling templates.

## Important merge fields

Templates can use both legacy simple names and structured keys:

- `{{companyName}}`
- `{{company.name}}`
- `{{company.phone}}`
- `{{company.email}}`
- `{{company.website}}`
- `{{company.address}}`
- `{{company.licenseNumber}}`
- `{{company.defaultTerms}}`
- `{{company.paymentInstructions}}`
- `{{company.warrantyText}}`
- `{{company.legalFooter}}`
- `{{company.reportDisclaimer}}`
- `{{company.contractDisclaimer}}`
- `{{company.estimateDisclaimer}}`
- `{{customer.name}}`
- `{{customer.email}}`
- `{{customer.phone}}`
- `{{customer.address}}`
- `{{project.title}}`
- `{{project.address}}`
- `{{estimate.amount}}`
- `{{date.today}}`

## What to run after extracting

```bash
npm install
npx prisma generate
npx prisma db push
npx tsc --noEmit
npm run build
```

## Next phase

Phase 3 should be Contractor Template Intake:

- upload an existing agreement/estimate PDF
- OCR it
- preserve the original file
- extract text/clauses/fields/signature zones
- convert it into a reviewable Jobrolo template
- status flow: uploaded → parsed → needs_review → approved → archived
