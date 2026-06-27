-- Add durable, tenant-scoped command shortcuts.
-- This is additive only; it does not alter existing app data.

CREATE TABLE "CommandShortcut" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "userId" TEXT,
    "scope" TEXT NOT NULL DEFAULT 'user',
    "role" TEXT,
    "group" TEXT,
    "label" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "icon" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "metadataJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommandShortcut_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CommandShortcut" ADD CONSTRAINT "CommandShortcut_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommandShortcut" ADD CONSTRAINT "CommandShortcut_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "CommandShortcut_contractorId_userId_active_sortOrder_idx" ON "CommandShortcut"("contractorId", "userId", "active", "sortOrder");

CREATE INDEX "CommandShortcut_contractorId_scope_role_active_sortOrder_idx" ON "CommandShortcut"("contractorId", "scope", "role", "active", "sortOrder");

CREATE INDEX "CommandShortcut_contractorId_group_idx" ON "CommandShortcut"("contractorId", "group");
