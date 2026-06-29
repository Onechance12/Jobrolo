-- Add Jobrolo's spreadsheet-like project financial truth table.
-- Additive only: this does not alter or delete existing documents, estimates, scopes, or pricing records.

CREATE TABLE "ProjectFinancialEntry" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "customerId" TEXT,
    "documentId" TEXT,
    "entryType" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'cost',
    "category" TEXT NOT NULL DEFAULT 'other',
    "description" TEXT NOT NULL,
    "vendorName" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "quantity" DOUBLE PRECISION,
    "unit" TEXT,
    "unitAmount" DOUBLE PRECISION,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'candidate',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "occurredAt" TIMESTAMP(3),
    "notes" TEXT,
    "metadataJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectFinancialEntry_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ProjectFinancialEntry" ADD CONSTRAINT "ProjectFinancialEntry_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectFinancialEntry" ADD CONSTRAINT "ProjectFinancialEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectFinancialEntry" ADD CONSTRAINT "ProjectFinancialEntry_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProjectFinancialEntry" ADD CONSTRAINT "ProjectFinancialEntry_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ProjectFinancialEntry_contractorId_projectId_idx" ON "ProjectFinancialEntry"("contractorId", "projectId");
CREATE INDEX "ProjectFinancialEntry_contractorId_customerId_idx" ON "ProjectFinancialEntry"("contractorId", "customerId");
CREATE INDEX "ProjectFinancialEntry_contractorId_documentId_idx" ON "ProjectFinancialEntry"("contractorId", "documentId");
CREATE INDEX "ProjectFinancialEntry_contractorId_entryType_idx" ON "ProjectFinancialEntry"("contractorId", "entryType");
CREATE INDEX "ProjectFinancialEntry_contractorId_direction_idx" ON "ProjectFinancialEntry"("contractorId", "direction");
CREATE INDEX "ProjectFinancialEntry_contractorId_status_idx" ON "ProjectFinancialEntry"("contractorId", "status");
CREATE INDEX "ProjectFinancialEntry_contractorId_occurredAt_idx" ON "ProjectFinancialEntry"("contractorId", "occurredAt");
