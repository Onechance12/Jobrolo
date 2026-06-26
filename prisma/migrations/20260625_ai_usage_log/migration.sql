CREATE TABLE "AIUsageLog" (
  "id" TEXT NOT NULL,
  "contractorId" TEXT NOT NULL,
  "userId" TEXT,
  "customerId" TEXT,
  "projectId" TEXT,
  "documentId" TEXT,
  "purpose" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "inputTokens" INTEGER,
  "outputTokens" INTEGER,
  "totalTokens" INTEGER,
  "imageCount" INTEGER NOT NULL DEFAULT 0,
  "webSearchCalls" INTEGER NOT NULL DEFAULT 0,
  "estimatedCost" DOUBLE PRECISION,
  "success" BOOLEAN NOT NULL DEFAULT true,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AIUsageLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AIUsageLog_contractorId_createdAt_idx" ON "AIUsageLog"("contractorId", "createdAt");
CREATE INDEX "AIUsageLog_contractorId_purpose_createdAt_idx" ON "AIUsageLog"("contractorId", "purpose", "createdAt");
CREATE INDEX "AIUsageLog_documentId_idx" ON "AIUsageLog"("documentId");
