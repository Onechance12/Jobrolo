-- Phone auth and contractor-owned communication numbers.
-- Additive only: no existing rows are rewritten or deleted.

ALTER TABLE "User" ADD COLUMN "phoneE164" TEXT;
ALTER TABLE "User" ADD COLUMN "phoneVerifiedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "User_phoneE164_key" ON "User"("phoneE164");
CREATE INDEX "User_contractorId_phoneE164_idx" ON "User"("contractorId", "phoneE164");

CREATE TABLE "CompanyPhoneNumber" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'twilio',
    "phoneNumber" TEXT NOT NULL,
    "phoneNumberSid" TEXT,
    "messagingServiceSid" TEXT,
    "friendlyName" TEXT,
    "purpose" TEXT NOT NULL DEFAULT 'company',
    "status" TEXT NOT NULL DEFAULT 'active',
    "isoCountry" TEXT NOT NULL DEFAULT 'US',
    "areaCode" TEXT,
    "capabilitiesJson" TEXT,
    "monthlyPrice" TEXT,
    "a2pStatus" TEXT,
    "metadataJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyPhoneNumber_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanyPhoneNumber_phoneNumber_key" ON "CompanyPhoneNumber"("phoneNumber");
CREATE UNIQUE INDEX "CompanyPhoneNumber_phoneNumberSid_key" ON "CompanyPhoneNumber"("phoneNumberSid");
CREATE INDEX "CompanyPhoneNumber_contractorId_status_idx" ON "CompanyPhoneNumber"("contractorId", "status");
CREATE INDEX "CompanyPhoneNumber_contractorId_purpose_idx" ON "CompanyPhoneNumber"("contractorId", "purpose");

ALTER TABLE "CompanyPhoneNumber" ADD CONSTRAINT "CompanyPhoneNumber_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
