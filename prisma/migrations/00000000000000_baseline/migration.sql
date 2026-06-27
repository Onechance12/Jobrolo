-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Contractor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "company" TEXT,
    "logo" TEXT,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "subscriptionStatus" TEXT NOT NULL DEFAULT 'trialing',
    "status" TEXT NOT NULL DEFAULT 'active',
    "trialEndsAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contractor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "role" TEXT NOT NULL DEFAULT 'manager',
    "avatar" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "passwordHash" TEXT,
    "mfaSecret" TEXT,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMP(3),
    "lastLoginIp" TEXT,
    "passwordResetToken" TEXT,
    "passwordResetExpires" TIMESTAMP(3),
    "emailVerifiedAt" TIMESTAMP(3),
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "subContractorId" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "customerId" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "address" TEXT,
    "value" DOUBLE PRECISION,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subcontractor" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "specialty" TEXT NOT NULL,
    "license" TEXT,
    "insurance" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "rating" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subcontractor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "customerId" TEXT,
    "content" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'general',
    "isAiGenerated" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inspection" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "findings" TEXT NOT NULL,
    "photos" TEXT,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "inspectedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Inspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Estimate" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "projectId" TEXT,
    "title" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "closingProbability" DOUBLE PRECISION,
    "lastViewedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Estimate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "subcontractorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "validUntil" TIMESTAMP(3),
    "lineItems" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUp" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "estimateId" TEXT,
    "projectId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'call',
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "isAiSuggested" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "filePath" TEXT NOT NULL,
    "thumbnailPath" TEXT,
    "fileType" TEXT NOT NULL DEFAULT 'other',
    "aiCategory" TEXT,
    "aiSummary" TEXT,
    "extractedData" TEXT,
    "ocrText" TEXT,
    "extractionMethod" TEXT,
    "embeddedText" TEXT,
    "visionText" TEXT,
    "extractionComparison" TEXT,
    "extractionConfidence" DOUBLE PRECISION,
    "missingDataFlags" TEXT,
    "conflictFlags" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending_review',
    "customerId" TEXT,
    "projectId" TEXT,
    "estimateId" TEXT,
    "workspaceId" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceSheet" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "supplierId" TEXT,
    "supplierName" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "notes" TEXT,
    "extractedItems" TEXT,
    "aiSummary" TEXT,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceSheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialItem" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "priceSheetId" TEXT,
    "supplierId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sku" TEXT,
    "category" TEXT NOT NULL DEFAULT 'other',
    "unit" TEXT NOT NULL DEFAULT 'EA',
    "unitCost" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "contextType" TEXT,
    "contextData" TEXT,
    "attachments" TEXT,
    "actionResults" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "projectId" TEXT,
    "customerId" TEXT,
    "subcontractorId" TEXT,
    "supplierId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceChat" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "chatType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'internal',
    "lastActivity" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceChat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMessage" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "contextType" TEXT,
    "contextData" TEXT,
    "attachments" TEXT,
    "actionResults" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMember" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "permissions" TEXT NOT NULL DEFAULT 'read,write',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMemory" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" TEXT,
    "source" TEXT DEFAULT 'ai',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceAction" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'executed',
    "detail" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "sourceChatId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectActivity" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "userId" TEXT,
    "activityType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "metadataJson" TEXT,
    "relatedId" TEXT,
    "relatedType" TEXT,
    "source" TEXT NOT NULL DEFAULT 'user',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "scopes" TEXT NOT NULL DEFAULT 'read,write',
    "lastUsedAt" TIMESTAMP(3),
    "lastUsedIp" TEXT,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "userId" TEXT,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "detail" TEXT,
    "metadataJson" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentJob" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "priority" INTEGER NOT NULL DEFAULT 5,
    "inputJson" TEXT NOT NULL,
    "outputJson" TEXT,
    "heartbeat" TEXT,
    "thinkingJson" TEXT,
    "error" TEXT,
    "conversationId" TEXT,
    "workspaceId" TEXT,
    "chatId" TEXT,
    "userId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerMemory" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'ai',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "importance" INTEGER NOT NULL DEFAULT 5,
    "metadataJson" TEXT,
    "embeddingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMemory" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'ai',
    "importance" INTEGER NOT NULL DEFAULT 5,
    "metadataJson" TEXT,
    "embeddingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractorMemory" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'ai',
    "metadataJson" TEXT,
    "embeddingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractorMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentLesson" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "lessonType" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "correction" TEXT,
    "metadataJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentLesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationSummary" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "keyDecisions" TEXT,
    "actionItems" TEXT,
    "participants" TEXT,
    "tokenCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntityRelation" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "relationType" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "metadataJson" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntityRelation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VectorEmbedding" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL DEFAULT 0,
    "content" TEXT NOT NULL,
    "embedding" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT 'text-embedding-3-small',
    "tokenCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VectorEmbedding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CronRun" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "itemsProcessed" INTEGER NOT NULL DEFAULT 0,
    "outputJson" TEXT,
    "error" TEXT,

    CONSTRAINT "CronRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageRecord" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "bucket" TIMESTAMP(3) NOT NULL,
    "metadataJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingSession" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'in_progress',
    "messagesJson" TEXT NOT NULL DEFAULT '[]',
    "businessProfile" TEXT,
    "researchJson" TEXT,
    "confidence" INTEGER NOT NULL DEFAULT 0,
    "coveredTopics" TEXT NOT NULL DEFAULT '[]',
    "businessType" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScopeAnalysis" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "originalRcv" DOUBLE PRECISION,
    "originalAcv" DOUBLE PRECISION,
    "deductible" DOUBLE PRECISION,
    "depreciation" DOUBLE PRECISION,
    "selectedRcv" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "selectedAcv" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "excludedRcv" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "excludedAcv" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "remainingOutOfPocket" DOUBLE PRECISION,
    "lineItemsJson" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScopeAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Insight" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "source" TEXT NOT NULL,
    "sourceId" TEXT,
    "sourceName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "resolutionDetail" TEXT,
    "resolutionActions" TEXT,
    "actionsTaken" TEXT,
    "recordsUpdated" TEXT,
    "sourceIdsUsed" TEXT,
    "beforeValue" TEXT,
    "afterValue" TEXT,
    "feedback" TEXT,
    "dedupKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Insight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractorProfile" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "companyName" TEXT,
    "legalName" TEXT,
    "displayName" TEXT,
    "logoUrl" TEXT,
    "logoDocumentId" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "country" TEXT DEFAULT 'US',
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "licenseNumber" TEXT,
    "insuranceText" TEXT,
    "ownerName" TEXT,
    "publicContactName" TEXT,
    "publicContactTitle" TEXT,
    "brandPrimaryColor" TEXT DEFAULT '#2563EB',
    "brandAccentColor" TEXT DEFAULT '#06B6D4',
    "brandMode" TEXT NOT NULL DEFAULT 'dark',
    "defaultTerms" TEXT,
    "paymentInstructions" TEXT,
    "warrantyText" TEXT,
    "legalFooter" TEXT,
    "reportDisclaimer" TEXT,
    "contractDisclaimer" TEXT,
    "estimateDisclaimer" TEXT,
    "metadataJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractorProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentLink" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "projectId" TEXT,
    "customerId" TEXT,
    "entityType" TEXT NOT NULL DEFAULT 'project',
    "entityId" TEXT,
    "role" TEXT NOT NULL DEFAULT 'attachment',
    "label" TEXT,
    "notes" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "source" TEXT NOT NULL DEFAULT 'user',
    "metadataJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectTimelineEvent" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "customerId" TEXT,
    "eventType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "relatedType" TEXT,
    "relatedId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "source" TEXT NOT NULL DEFAULT 'system',
    "actorUserId" TEXT,
    "metadataJson" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectTimelineEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "projectId" TEXT,
    "customerId" TEXT,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'inspection',
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "notes" TEXT,
    "attendeesJson" TEXT,
    "createdById" TEXT,
    "externalProvider" TEXT,
    "externalEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectSchedule" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'lead',
    "productionStatus" TEXT NOT NULL DEFAULT 'not_scheduled',
    "scheduledStart" TIMESTAMP(3),
    "scheduledEnd" TIMESTAMP(3),
    "crewName" TEXT,
    "materialDeliveryAt" TIMESTAMP(3),
    "permitStatus" TEXT,
    "weatherHold" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "milestonesJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoofReport" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "projectId" TEXT,
    "customerId" TEXT,
    "title" TEXT NOT NULL,
    "reportNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "mode" TEXT NOT NULL DEFAULT 'inspection',
    "summaryTone" TEXT NOT NULL DEFAULT 'homeowner',
    "inspectionDate" TIMESTAMP(3),
    "inspectorName" TEXT,
    "propertyAddress" TEXT,
    "clientName" TEXT,
    "claimNumber" TEXT,
    "introduction" TEXT,
    "propertyReviewSummary" TEXT,
    "observedConditionsJson" TEXT,
    "recommendationsJson" TEXT,
    "conclusion" TEXT,
    "disclaimer" TEXT,
    "internalNotes" TEXT,
    "photoChecklistJson" TEXT,
    "missingPhotoChecklistJson" TEXT,
    "reportPdfPath" TEXT,
    "reportPdfDocumentId" TEXT,
    "shareToken" TEXT,
    "completedAt" TIMESTAMP(3),
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoofReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoofReportPhoto" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "documentId" TEXT,
    "imageUrl" TEXT,
    "category" TEXT NOT NULL DEFAULT 'other',
    "area" TEXT,
    "condition" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'informational',
    "caption" TEXT,
    "notes" TEXT,
    "tagsJson" TEXT,
    "aiCaptionStatus" TEXT NOT NULL DEFAULT 'draft',
    "isIncluded" BOOLEAN NOT NULL DEFAULT true,
    "isCoverPhoto" BOOLEAN NOT NULL DEFAULT false,
    "takenAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoofReportPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentTemplate" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'work_authorization',
    "status" TEXT NOT NULL DEFAULT 'active',
    "bodyHtml" TEXT NOT NULL,
    "variablesJson" TEXT,
    "requiresSignature" BOOLEAN NOT NULL DEFAULT true,
    "sourceUploadId" TEXT,
    "sourceDocumentId" TEXT,
    "sourceOriginalName" TEXT,
    "reviewStatus" TEXT NOT NULL DEFAULT 'approved',
    "importedFromUpload" BOOLEAN NOT NULL DEFAULT false,
    "detectedFieldsJson" TEXT,
    "clausesJson" TEXT,
    "signatureFieldsJson" TEXT,
    "parseWarningsJson" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentTemplateUpload" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "templateType" TEXT NOT NULL DEFAULT 'custom',
    "name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'uploaded',
    "embeddedText" TEXT,
    "ocrText" TEXT,
    "finalText" TEXT,
    "ocrProvider" TEXT,
    "ocrConfidence" DOUBLE PRECISION,
    "extractionConfidence" DOUBLE PRECISION,
    "conflictFlagsJson" TEXT,
    "missingFieldsJson" TEXT,
    "reviewNotesJson" TEXT,
    "detectedTitle" TEXT,
    "detectedType" TEXT,
    "parsedJson" TEXT,
    "templateId" TEXT,
    "error" TEXT,
    "metadataJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "parsedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "DocumentTemplateUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentTemplateField" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "uploadId" TEXT,
    "fieldKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'text',
    "variable" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "defaultValue" TEXT,
    "mappedSource" TEXT,
    "instructions" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "metadataJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentTemplateField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentTemplateClause" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "uploadId" TEXT,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "clauseType" TEXT NOT NULL DEFAULT 'general',
    "editable" BOOLEAN NOT NULL DEFAULT true,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "aiNotes" TEXT,
    "metadataJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentTemplateClause_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentTemplateVersion" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'snapshot',
    "bodyHtml" TEXT NOT NULL,
    "fieldsJson" TEXT,
    "clausesJson" TEXT,
    "changeSummary" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentTemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedDocument" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "templateId" TEXT,
    "projectId" TEXT,
    "customerId" TEXT,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'custom',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "bodyHtml" TEXT NOT NULL,
    "mergedDataJson" TEXT,
    "unsignedPdfPath" TEXT,
    "unsignedPdfDocumentId" TEXT,
    "signedPdfPath" TEXT,
    "signedPdfDocumentId" TEXT,
    "finalHtmlPath" TEXT,
    "signatureCertificateJson" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeneratedDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignatureRequest" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "generatedDocumentId" TEXT NOT NULL,
    "projectId" TEXT,
    "customerId" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "signerName" TEXT NOT NULL,
    "signerEmail" TEXT,
    "signerPhone" TEXT,
    "signatureToken" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "signedIp" TEXT,
    "signedUserAgent" TEXT,
    "signatureData" TEXT,
    "auditJson" TEXT,
    "signedPdfPath" TEXT,
    "signedPdfDocumentId" TEXT,
    "certificateJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SignatureRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignatureEvent" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "signatureRequestId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "detail" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignatureEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldVisit" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "projectId" TEXT,
    "customerId" TEXT,
    "appointmentId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'inspection',
    "status" TEXT NOT NULL DEFAULT 'planned',
    "mode" TEXT NOT NULL DEFAULT 'field',
    "title" TEXT,
    "arrivedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "accuracyMeters" DOUBLE PRECISION,
    "notes" TEXT,
    "outcome" TEXT,
    "nextAction" TEXT,
    "createdById" TEXT,
    "metadataJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FieldVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldLocationPing" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "userId" TEXT,
    "projectId" TEXT,
    "customerId" TEXT,
    "appointmentId" TEXT,
    "fieldVisitId" TEXT,
    "documentId" TEXT,
    "canvassingLeadId" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "accuracyMeters" DOUBLE PRECISION,
    "source" TEXT NOT NULL DEFAULT 'browser_gps',
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadataJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FieldLocationPing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocationResolution" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "userId" TEXT,
    "documentId" TEXT,
    "projectId" TEXT,
    "customerId" TEXT,
    "appointmentId" TEXT,
    "fieldVisitId" TEXT,
    "canvassingLeadId" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidenceLabel" TEXT NOT NULL DEFAULT 'low',
    "reason" TEXT,
    "source" TEXT NOT NULL DEFAULT 'resolver',
    "status" TEXT NOT NULL DEFAULT 'suggested',
    "candidatesJson" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocationResolution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionRequest" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "projectId" TEXT,
    "customerId" TEXT,
    "fieldVisitId" TEXT,
    "appointmentId" TEXT,
    "createdByUserId" TEXT,
    "requestedRole" TEXT NOT NULL DEFAULT 'project_manager',
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "payloadJson" TEXT,
    "dueAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "actionRequestId" TEXT NOT NULL,
    "approverRole" TEXT NOT NULL DEFAULT 'project_manager',
    "approverUserId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decisionNotes" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboxItem" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "projectId" TEXT,
    "customerId" TEXT,
    "userId" TEXT,
    "role" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "status" TEXT NOT NULL DEFAULT 'unread',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "actionRequestId" TEXT,
    "relatedType" TEXT,
    "relatedId" TEXT,
    "payloadJson" TEXT,
    "readAt" TIMESTAMP(3),
    "actionedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboxItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "userId" TEXT,
    "role" TEXT,
    "inAppEnabled" BOOLEAN NOT NULL DEFAULT true,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
    "smsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "urgentOnly" BOOLEAN NOT NULL DEFAULT false,
    "dailyDigest" BOOLEAN NOT NULL DEFAULT false,
    "mutedTypesJson" TEXT,
    "quietHoursJson" TEXT,
    "metadataJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationMessage" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "userId" TEXT,
    "role" TEXT,
    "projectId" TEXT,
    "customerId" TEXT,
    "inboxItemId" TEXT,
    "actionRequestId" TEXT,
    "channel" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "toAddress" TEXT,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "htmlBody" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "provider" TEXT NOT NULL DEFAULT 'console',
    "providerMessageId" TEXT,
    "dedupeKey" TEXT,
    "error" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "metadataJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunicationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanvassingSession" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "userId" TEXT,
    "title" TEXT,
    "territoryName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "metadataJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanvassingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanvassingLead" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "sessionId" TEXT,
    "createdById" TEXT,
    "projectId" TEXT,
    "customerId" TEXT,
    "address" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'new',
    "homeownerName" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "source" TEXT NOT NULL DEFAULT 'field_copilot',
    "metadataJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanvassingLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanvassingActivity" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "sessionId" TEXT,
    "leadId" TEXT,
    "userId" TEXT,
    "type" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "metadataJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CanvassingActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertyMemory" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "createdById" TEXT,
    "primaryLeadId" TEXT,
    "customerId" TEXT,
    "projectId" TEXT,
    "address" TEXT,
    "normalizedAddress" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "ownerName" TEXT,
    "ownerMailingAddress" TEXT,
    "parcelId" TEXT,
    "countyAccountId" TEXT,
    "marketValue" DOUBLE PRECISION,
    "assessedValue" DOUBLE PRECISION,
    "improvementValue" DOUBLE PRECISION,
    "landValue" DOUBLE PRECISION,
    "livingAreaSqft" INTEGER,
    "yearBuilt" INTEGER,
    "bedrooms" DOUBLE PRECISION,
    "bathrooms" DOUBLE PRECISION,
    "stories" DOUBLE PRECISION,
    "ownerOccupiedSignal" TEXT,
    "lastEnrichedAt" TIMESTAMP(3),
    "enrichmentStatus" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "propertyType" TEXT,
    "occupancyStatus" TEXT NOT NULL DEFAULT 'unknown',
    "solicitationStatus" TEXT NOT NULL DEFAULT 'ok',
    "roofCondition" TEXT NOT NULL DEFAULT 'unknown',
    "roofAgeSignal" TEXT,
    "damageSignal" TEXT,
    "opportunityScore" INTEGER NOT NULL DEFAULT 0,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "status" TEXT NOT NULL DEFAULT 'watch',
    "lastObservedAt" TIMESTAMP(3),
    "lastKnockedAt" TIMESTAMP(3),
    "nextFollowUpAt" TIMESTAMP(3),
    "summary" TEXT,
    "notes" TEXT,
    "tagsJson" TEXT,
    "dataSourceJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PropertyMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertyObservation" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "propertyMemoryId" TEXT NOT NULL,
    "canvassingLeadId" TEXT,
    "sessionId" TEXT,
    "userId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "roofCondition" TEXT,
    "damageSignal" TEXT,
    "severity" TEXT,
    "confidence" DOUBLE PRECISION,
    "photoDocumentId" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadataJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PropertyObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DoorAttempt" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "propertyMemoryId" TEXT NOT NULL,
    "canvassingLeadId" TEXT,
    "sessionId" TEXT,
    "userId" TEXT,
    "outcome" TEXT NOT NULL,
    "contactName" TEXT,
    "contactRole" TEXT,
    "summary" TEXT,
    "scriptUsed" TEXT,
    "objection" TEXT,
    "nextStep" TEXT,
    "followUpAt" TIMESTAMP(3),
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "metadataJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DoorAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StreetMemory" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "territoryName" TEXT,
    "streetName" TEXT NOT NULL,
    "city" TEXT,
    "state" TEXT,
    "lastWorkedAt" TIMESTAMP(3),
    "lastWorkedById" TEXT,
    "totalDoors" INTEGER NOT NULL DEFAULT 0,
    "totalAttempts" INTEGER NOT NULL DEFAULT 0,
    "conversations" INTEGER NOT NULL DEFAULT 0,
    "inspectionsSet" INTEGER NOT NULL DEFAULT 0,
    "noAnswers" INTEGER NOT NULL DEFAULT 0,
    "doNotKnockCount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "tagsJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StreetMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanvassingGamePlan" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "userId" TEXT,
    "sessionId" TEXT,
    "title" TEXT NOT NULL,
    "territoryName" TEXT,
    "focusMode" TEXT NOT NULL DEFAULT 'partner_choice',
    "energyLevel" TEXT,
    "customerFocus" TEXT,
    "timeBudgetMinutes" INTEGER,
    "goalDoors" INTEGER,
    "goalConversations" INTEGER,
    "goalInspections" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "strategySummary" TEXT,
    "recommendedStart" TEXT,
    "avoidNotes" TEXT,
    "scriptSuggestion" TEXT,
    "kpiSnapshotJson" TEXT,
    "recommendationsJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanvassingGamePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertyResearchRun" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "userId" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'approaching_house',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "query" TEXT,
    "requestedAddress" TEXT,
    "normalizedAddress" TEXT,
    "streetNamesJson" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "accuracyMeters" DOUBLE PRECISION,
    "focusMode" TEXT,
    "energyLevel" TEXT,
    "mindset" TEXT,
    "timeBudgetMinutes" INTEGER,
    "goalDoors" INTEGER,
    "goalConversations" INTEGER,
    "goalInspections" INTEGER,
    "resultSummary" TEXT,
    "confidence" DOUBLE PRECISION,
    "selectedCandidateId" TEXT,
    "createdMemoryId" TEXT,
    "providerSummaryJson" TEXT,
    "metadataJson" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PropertyResearchRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertyResearchCandidate" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "researchRunId" TEXT NOT NULL,
    "propertyMemoryId" TEXT,
    "address" TEXT,
    "normalizedAddress" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "ownerName" TEXT,
    "ownerMailingAddress" TEXT,
    "parcelId" TEXT,
    "countyAccountId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'jobrolo',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "matchReason" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "propertyType" TEXT,
    "marketValue" DOUBLE PRECISION,
    "assessedValue" DOUBLE PRECISION,
    "improvementValue" DOUBLE PRECISION,
    "landValue" DOUBLE PRECISION,
    "livingAreaSqft" INTEGER,
    "yearBuilt" INTEGER,
    "bedrooms" DOUBLE PRECISION,
    "bathrooms" DOUBLE PRECISION,
    "stories" DOUBLE PRECISION,
    "ownerOccupiedSignal" TEXT,
    "roofOpportunityScore" INTEGER NOT NULL DEFAULT 0,
    "stormExposureScore" INTEGER NOT NULL DEFAULT 0,
    "followUpScore" INTEGER NOT NULL DEFAULT 0,
    "overallScore" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'candidate',
    "rawJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PropertyResearchCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertyEnrichmentSnapshot" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "researchRunId" TEXT,
    "candidateId" TEXT,
    "propertyMemoryId" TEXT,
    "source" TEXT NOT NULL,
    "sourceLabel" TEXT,
    "sourceUrl" TEXT,
    "address" TEXT,
    "normalizedAddress" TEXT,
    "ownerName" TEXT,
    "ownerMailingAddress" TEXT,
    "parcelId" TEXT,
    "countyAccountId" TEXT,
    "propertyType" TEXT,
    "marketValue" DOUBLE PRECISION,
    "assessedValue" DOUBLE PRECISION,
    "improvementValue" DOUBLE PRECISION,
    "landValue" DOUBLE PRECISION,
    "livingAreaSqft" INTEGER,
    "yearBuilt" INTEGER,
    "bedrooms" DOUBLE PRECISION,
    "bathrooms" DOUBLE PRECISION,
    "stories" DOUBLE PRECISION,
    "ownerOccupiedSignal" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rawJson" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "PropertyEnrichmentSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StreetResearchRun" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "userId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "title" TEXT NOT NULL,
    "streetNamesJson" TEXT NOT NULL,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "focusMode" TEXT NOT NULL DEFAULT 'partner_choice',
    "energyLevel" TEXT,
    "mindset" TEXT,
    "timeBudgetMinutes" INTEGER,
    "goalDoors" INTEGER,
    "goalConversations" INTEGER,
    "goalInspections" INTEGER,
    "summary" TEXT,
    "recommendedStart" TEXT,
    "avoidNotes" TEXT,
    "scriptSuggestion" TEXT,
    "candidateSummaryJson" TEXT,
    "createdGamePlanId" TEXT,
    "metadataJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StreetResearchRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Contractor_email_key" ON "Contractor"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_contractorId_status_idx" ON "User"("contractorId", "status");

-- CreateIndex
CREATE INDEX "Task_projectId_status_idx" ON "Task"("projectId", "status");

-- CreateIndex
CREATE INDEX "Note_projectId_idx" ON "Note"("projectId");

-- CreateIndex
CREATE INDEX "Inspection_projectId_idx" ON "Inspection"("projectId");

-- CreateIndex
CREATE INDEX "Estimate_customerId_idx" ON "Estimate"("customerId");

-- CreateIndex
CREATE INDEX "Estimate_projectId_idx" ON "Estimate"("projectId");

-- CreateIndex
CREATE INDEX "Quote_projectId_idx" ON "Quote"("projectId");

-- CreateIndex
CREATE INDEX "FollowUp_customerId_status_idx" ON "FollowUp"("customerId", "status");

-- CreateIndex
CREATE INDEX "Document_contractorId_createdAt_idx" ON "Document"("contractorId", "createdAt");

-- CreateIndex
CREATE INDEX "Document_projectId_idx" ON "Document"("projectId");

-- CreateIndex
CREATE INDEX "Document_workspaceId_idx" ON "Document"("workspaceId");

-- CreateIndex
CREATE INDEX "PriceSheet_contractorId_idx" ON "PriceSheet"("contractorId");

-- CreateIndex
CREATE INDEX "MaterialItem_contractorId_idx" ON "MaterialItem"("contractorId");

-- CreateIndex
CREATE INDEX "MaterialItem_priceSheetId_idx" ON "MaterialItem"("priceSheetId");

-- CreateIndex
CREATE INDEX "Conversation_contractorId_updatedAt_idx" ON "Conversation"("contractorId", "updatedAt");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_projectId_key" ON "Workspace"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_customerId_key" ON "Workspace"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_subcontractorId_key" ON "Workspace"("subcontractorId");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_supplierId_key" ON "Workspace"("supplierId");

-- CreateIndex
CREATE INDEX "Workspace_contractorId_type_idx" ON "Workspace"("contractorId", "type");

-- CreateIndex
CREATE INDEX "WorkspaceChat_workspaceId_chatType_idx" ON "WorkspaceChat"("workspaceId", "chatType");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceChat_workspaceId_chatType_key" ON "WorkspaceChat"("workspaceId", "chatType");

-- CreateIndex
CREATE INDEX "WorkspaceMessage_chatId_createdAt_idx" ON "WorkspaceMessage"("chatId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_userId_key" ON "WorkspaceMember"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "WorkspaceMemory_workspaceId_category_idx" ON "WorkspaceMemory"("workspaceId", "category");

-- CreateIndex
CREATE INDEX "WorkspaceMemory_workspaceId_createdAt_idx" ON "WorkspaceMemory"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkspaceAction_workspaceId_createdAt_idx" ON "WorkspaceAction"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectActivity_projectId_createdAt_idx" ON "ProjectActivity"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectActivity_contractorId_source_idx" ON "ProjectActivity"("contractorId", "source");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_contractorId_idx" ON "ApiKey"("contractorId");

-- CreateIndex
CREATE INDEX "ApiKey_keyHash_idx" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "AuditLog_contractorId_createdAt_idx" ON "AuditLog"("contractorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_contractorId_resourceType_resourceId_idx" ON "AuditLog"("contractorId", "resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "AuditLog_actor_idx" ON "AuditLog"("actor");

-- CreateIndex
CREATE INDEX "AgentJob_contractorId_status_priority_createdAt_idx" ON "AgentJob"("contractorId", "status", "priority", "createdAt");

-- CreateIndex
CREATE INDEX "AgentJob_contractorId_type_createdAt_idx" ON "AgentJob"("contractorId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "AgentJob_status_expiresAt_idx" ON "AgentJob"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "CustomerMemory_contractorId_customerId_category_createdAt_idx" ON "CustomerMemory"("contractorId", "customerId", "category", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerMemory_contractorId_category_idx" ON "CustomerMemory"("contractorId", "category");

-- CreateIndex
CREATE INDEX "ProjectMemory_contractorId_projectId_category_createdAt_idx" ON "ProjectMemory"("contractorId", "projectId", "category", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectMemory_contractorId_category_idx" ON "ProjectMemory"("contractorId", "category");

-- CreateIndex
CREATE INDEX "ContractorMemory_contractorId_category_idx" ON "ContractorMemory"("contractorId", "category");

-- CreateIndex
CREATE INDEX "AgentLesson_contractorId_agentName_lessonType_idx" ON "AgentLesson"("contractorId", "agentName", "lessonType");

-- CreateIndex
CREATE INDEX "AgentLesson_contractorId_createdAt_idx" ON "AgentLesson"("contractorId", "createdAt");

-- CreateIndex
CREATE INDEX "ConversationSummary_contractorId_conversationId_idx" ON "ConversationSummary"("contractorId", "conversationId");

-- CreateIndex
CREATE INDEX "ConversationSummary_contractorId_createdAt_idx" ON "ConversationSummary"("contractorId", "createdAt");

-- CreateIndex
CREATE INDEX "EntityRelation_contractorId_sourceType_sourceId_idx" ON "EntityRelation"("contractorId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "EntityRelation_contractorId_targetType_targetId_idx" ON "EntityRelation"("contractorId", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "EntityRelation_contractorId_relationType_idx" ON "EntityRelation"("contractorId", "relationType");

-- CreateIndex
CREATE UNIQUE INDEX "EntityRelation_sourceType_sourceId_relationType_targetType__key" ON "EntityRelation"("sourceType", "sourceId", "relationType", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "VectorEmbedding_contractorId_entityType_entityId_idx" ON "VectorEmbedding"("contractorId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "VectorEmbedding_contractorId_model_idx" ON "VectorEmbedding"("contractorId", "model");

-- CreateIndex
CREATE UNIQUE INDEX "VectorEmbedding_entityType_entityId_chunkIndex_key" ON "VectorEmbedding"("entityType", "entityId", "chunkIndex");

-- CreateIndex
CREATE INDEX "CronRun_contractorId_jobName_startedAt_idx" ON "CronRun"("contractorId", "jobName", "startedAt");

-- CreateIndex
CREATE INDEX "CronRun_jobName_status_idx" ON "CronRun"("jobName", "status");

-- CreateIndex
CREATE INDEX "UsageRecord_contractorId_metric_bucket_idx" ON "UsageRecord"("contractorId", "metric", "bucket");

-- CreateIndex
CREATE UNIQUE INDEX "UsageRecord_contractorId_metric_bucket_key" ON "UsageRecord"("contractorId", "metric", "bucket");

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingSession_contractorId_key" ON "OnboardingSession"("contractorId");

-- CreateIndex
CREATE INDEX "OnboardingSession_contractorId_status_idx" ON "OnboardingSession"("contractorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ScopeAnalysis_documentId_key" ON "ScopeAnalysis"("documentId");

-- CreateIndex
CREATE INDEX "ScopeAnalysis_contractorId_documentId_idx" ON "ScopeAnalysis"("contractorId", "documentId");

-- CreateIndex
CREATE INDEX "ScopeAnalysis_documentId_idx" ON "ScopeAnalysis"("documentId");

-- CreateIndex
CREATE INDEX "Insight_contractorId_status_type_idx" ON "Insight"("contractorId", "status", "type");

-- CreateIndex
CREATE INDEX "Insight_contractorId_source_sourceId_idx" ON "Insight"("contractorId", "source", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "Insight_contractorId_dedupKey_key" ON "Insight"("contractorId", "dedupKey");

-- CreateIndex
CREATE UNIQUE INDEX "ContractorProfile_contractorId_key" ON "ContractorProfile"("contractorId");

-- CreateIndex
CREATE INDEX "ContractorProfile_contractorId_idx" ON "ContractorProfile"("contractorId");

-- CreateIndex
CREATE INDEX "DocumentLink_contractorId_projectId_idx" ON "DocumentLink"("contractorId", "projectId");

-- CreateIndex
CREATE INDEX "DocumentLink_contractorId_customerId_idx" ON "DocumentLink"("contractorId", "customerId");

-- CreateIndex
CREATE INDEX "DocumentLink_contractorId_documentId_idx" ON "DocumentLink"("contractorId", "documentId");

-- CreateIndex
CREATE INDEX "DocumentLink_contractorId_entityType_entityId_idx" ON "DocumentLink"("contractorId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "DocumentLink_contractorId_role_idx" ON "DocumentLink"("contractorId", "role");

-- CreateIndex
CREATE INDEX "ProjectTimelineEvent_contractorId_projectId_occurredAt_idx" ON "ProjectTimelineEvent"("contractorId", "projectId", "occurredAt");

-- CreateIndex
CREATE INDEX "ProjectTimelineEvent_contractorId_eventType_idx" ON "ProjectTimelineEvent"("contractorId", "eventType");

-- CreateIndex
CREATE INDEX "ProjectTimelineEvent_contractorId_relatedType_relatedId_idx" ON "ProjectTimelineEvent"("contractorId", "relatedType", "relatedId");

-- CreateIndex
CREATE INDEX "Appointment_contractorId_startTime_idx" ON "Appointment"("contractorId", "startTime");

-- CreateIndex
CREATE INDEX "Appointment_contractorId_projectId_idx" ON "Appointment"("contractorId", "projectId");

-- CreateIndex
CREATE INDEX "Appointment_contractorId_customerId_idx" ON "Appointment"("contractorId", "customerId");

-- CreateIndex
CREATE INDEX "Appointment_contractorId_type_status_idx" ON "Appointment"("contractorId", "type", "status");

-- CreateIndex
CREATE INDEX "ProjectSchedule_contractorId_stage_idx" ON "ProjectSchedule"("contractorId", "stage");

-- CreateIndex
CREATE INDEX "ProjectSchedule_contractorId_scheduledStart_idx" ON "ProjectSchedule"("contractorId", "scheduledStart");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectSchedule_contractorId_projectId_key" ON "ProjectSchedule"("contractorId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "RoofReport_shareToken_key" ON "RoofReport"("shareToken");

-- CreateIndex
CREATE INDEX "RoofReport_contractorId_projectId_idx" ON "RoofReport"("contractorId", "projectId");

-- CreateIndex
CREATE INDEX "RoofReport_contractorId_customerId_idx" ON "RoofReport"("contractorId", "customerId");

-- CreateIndex
CREATE INDEX "RoofReport_contractorId_status_idx" ON "RoofReport"("contractorId", "status");

-- CreateIndex
CREATE INDEX "RoofReport_contractorId_mode_idx" ON "RoofReport"("contractorId", "mode");

-- CreateIndex
CREATE INDEX "RoofReportPhoto_contractorId_reportId_idx" ON "RoofReportPhoto"("contractorId", "reportId");

-- CreateIndex
CREATE INDEX "RoofReportPhoto_documentId_idx" ON "RoofReportPhoto"("documentId");

-- CreateIndex
CREATE INDEX "RoofReportPhoto_contractorId_category_idx" ON "RoofReportPhoto"("contractorId", "category");

-- CreateIndex
CREATE INDEX "DocumentTemplate_contractorId_type_status_idx" ON "DocumentTemplate"("contractorId", "type", "status");

-- CreateIndex
CREATE INDEX "DocumentTemplateUpload_contractorId_status_idx" ON "DocumentTemplateUpload"("contractorId", "status");

-- CreateIndex
CREATE INDEX "DocumentTemplateUpload_contractorId_documentId_idx" ON "DocumentTemplateUpload"("contractorId", "documentId");

-- CreateIndex
CREATE INDEX "DocumentTemplateUpload_contractorId_templateId_idx" ON "DocumentTemplateUpload"("contractorId", "templateId");

-- CreateIndex
CREATE INDEX "DocumentTemplateUpload_contractorId_templateType_idx" ON "DocumentTemplateUpload"("contractorId", "templateType");

-- CreateIndex
CREATE INDEX "DocumentTemplateField_contractorId_templateId_idx" ON "DocumentTemplateField"("contractorId", "templateId");

-- CreateIndex
CREATE INDEX "DocumentTemplateField_contractorId_uploadId_idx" ON "DocumentTemplateField"("contractorId", "uploadId");

-- CreateIndex
CREATE INDEX "DocumentTemplateField_contractorId_fieldKey_idx" ON "DocumentTemplateField"("contractorId", "fieldKey");

-- CreateIndex
CREATE INDEX "DocumentTemplateClause_contractorId_templateId_idx" ON "DocumentTemplateClause"("contractorId", "templateId");

-- CreateIndex
CREATE INDEX "DocumentTemplateClause_contractorId_uploadId_idx" ON "DocumentTemplateClause"("contractorId", "uploadId");

-- CreateIndex
CREATE INDEX "DocumentTemplateClause_contractorId_clauseType_idx" ON "DocumentTemplateClause"("contractorId", "clauseType");

-- CreateIndex
CREATE INDEX "DocumentTemplateVersion_contractorId_templateId_version_idx" ON "DocumentTemplateVersion"("contractorId", "templateId", "version");

-- CreateIndex
CREATE INDEX "GeneratedDocument_contractorId_projectId_idx" ON "GeneratedDocument"("contractorId", "projectId");

-- CreateIndex
CREATE INDEX "GeneratedDocument_contractorId_customerId_idx" ON "GeneratedDocument"("contractorId", "customerId");

-- CreateIndex
CREATE INDEX "GeneratedDocument_contractorId_type_status_idx" ON "GeneratedDocument"("contractorId", "type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SignatureRequest_signatureToken_key" ON "SignatureRequest"("signatureToken");

-- CreateIndex
CREATE INDEX "SignatureRequest_contractorId_status_idx" ON "SignatureRequest"("contractorId", "status");

-- CreateIndex
CREATE INDEX "SignatureRequest_contractorId_projectId_idx" ON "SignatureRequest"("contractorId", "projectId");

-- CreateIndex
CREATE INDEX "SignatureRequest_signatureToken_idx" ON "SignatureRequest"("signatureToken");

-- CreateIndex
CREATE INDEX "SignatureEvent_contractorId_signatureRequestId_createdAt_idx" ON "SignatureEvent"("contractorId", "signatureRequestId", "createdAt");

-- CreateIndex
CREATE INDEX "FieldVisit_contractorId_projectId_idx" ON "FieldVisit"("contractorId", "projectId");

-- CreateIndex
CREATE INDEX "FieldVisit_contractorId_customerId_idx" ON "FieldVisit"("contractorId", "customerId");

-- CreateIndex
CREATE INDEX "FieldVisit_contractorId_appointmentId_idx" ON "FieldVisit"("contractorId", "appointmentId");

-- CreateIndex
CREATE INDEX "FieldVisit_contractorId_createdById_status_idx" ON "FieldVisit"("contractorId", "createdById", "status");

-- CreateIndex
CREATE INDEX "FieldVisit_contractorId_type_status_idx" ON "FieldVisit"("contractorId", "type", "status");

-- CreateIndex
CREATE INDEX "FieldLocationPing_contractorId_userId_capturedAt_idx" ON "FieldLocationPing"("contractorId", "userId", "capturedAt");

-- CreateIndex
CREATE INDEX "FieldLocationPing_contractorId_projectId_idx" ON "FieldLocationPing"("contractorId", "projectId");

-- CreateIndex
CREATE INDEX "FieldLocationPing_contractorId_fieldVisitId_idx" ON "FieldLocationPing"("contractorId", "fieldVisitId");

-- CreateIndex
CREATE INDEX "FieldLocationPing_contractorId_documentId_idx" ON "FieldLocationPing"("contractorId", "documentId");

-- CreateIndex
CREATE INDEX "LocationResolution_contractorId_documentId_idx" ON "LocationResolution"("contractorId", "documentId");

-- CreateIndex
CREATE INDEX "LocationResolution_contractorId_projectId_idx" ON "LocationResolution"("contractorId", "projectId");

-- CreateIndex
CREATE INDEX "LocationResolution_contractorId_userId_createdAt_idx" ON "LocationResolution"("contractorId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "LocationResolution_contractorId_status_idx" ON "LocationResolution"("contractorId", "status");

-- CreateIndex
CREATE INDEX "ActionRequest_contractorId_projectId_idx" ON "ActionRequest"("contractorId", "projectId");

-- CreateIndex
CREATE INDEX "ActionRequest_contractorId_requestedRole_status_idx" ON "ActionRequest"("contractorId", "requestedRole", "status");

-- CreateIndex
CREATE INDEX "ActionRequest_contractorId_type_status_idx" ON "ActionRequest"("contractorId", "type", "status");

-- CreateIndex
CREATE INDEX "ActionRequest_contractorId_createdAt_idx" ON "ActionRequest"("contractorId", "createdAt");

-- CreateIndex
CREATE INDEX "ApprovalRequest_contractorId_actionRequestId_idx" ON "ApprovalRequest"("contractorId", "actionRequestId");

-- CreateIndex
CREATE INDEX "ApprovalRequest_contractorId_approverRole_status_idx" ON "ApprovalRequest"("contractorId", "approverRole", "status");

-- CreateIndex
CREATE INDEX "ApprovalRequest_contractorId_approverUserId_status_idx" ON "ApprovalRequest"("contractorId", "approverUserId", "status");

-- CreateIndex
CREATE INDEX "InboxItem_contractorId_role_status_idx" ON "InboxItem"("contractorId", "role", "status");

-- CreateIndex
CREATE INDEX "InboxItem_contractorId_userId_status_idx" ON "InboxItem"("contractorId", "userId", "status");

-- CreateIndex
CREATE INDEX "InboxItem_contractorId_projectId_idx" ON "InboxItem"("contractorId", "projectId");

-- CreateIndex
CREATE INDEX "InboxItem_contractorId_actionRequestId_idx" ON "InboxItem"("contractorId", "actionRequestId");

-- CreateIndex
CREATE INDEX "NotificationPreference_contractorId_userId_idx" ON "NotificationPreference"("contractorId", "userId");

-- CreateIndex
CREATE INDEX "NotificationPreference_contractorId_role_idx" ON "NotificationPreference"("contractorId", "role");

-- CreateIndex
CREATE INDEX "CommunicationMessage_contractorId_status_channel_idx" ON "CommunicationMessage"("contractorId", "status", "channel");

-- CreateIndex
CREATE INDEX "CommunicationMessage_contractorId_inboxItemId_idx" ON "CommunicationMessage"("contractorId", "inboxItemId");

-- CreateIndex
CREATE INDEX "CommunicationMessage_contractorId_actionRequestId_idx" ON "CommunicationMessage"("contractorId", "actionRequestId");

-- CreateIndex
CREATE INDEX "CommunicationMessage_contractorId_userId_status_idx" ON "CommunicationMessage"("contractorId", "userId", "status");

-- CreateIndex
CREATE INDEX "CommunicationMessage_contractorId_dedupeKey_idx" ON "CommunicationMessage"("contractorId", "dedupeKey");

-- CreateIndex
CREATE INDEX "CanvassingSession_contractorId_userId_status_idx" ON "CanvassingSession"("contractorId", "userId", "status");

-- CreateIndex
CREATE INDEX "CanvassingLead_contractorId_sessionId_idx" ON "CanvassingLead"("contractorId", "sessionId");

-- CreateIndex
CREATE INDEX "CanvassingLead_contractorId_status_idx" ON "CanvassingLead"("contractorId", "status");

-- CreateIndex
CREATE INDEX "CanvassingLead_contractorId_projectId_idx" ON "CanvassingLead"("contractorId", "projectId");

-- CreateIndex
CREATE INDEX "CanvassingActivity_contractorId_sessionId_idx" ON "CanvassingActivity"("contractorId", "sessionId");

-- CreateIndex
CREATE INDEX "CanvassingActivity_contractorId_leadId_idx" ON "CanvassingActivity"("contractorId", "leadId");

-- CreateIndex
CREATE INDEX "CanvassingActivity_contractorId_userId_createdAt_idx" ON "CanvassingActivity"("contractorId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "PropertyMemory_contractorId_normalizedAddress_idx" ON "PropertyMemory"("contractorId", "normalizedAddress");

-- CreateIndex
CREATE INDEX "PropertyMemory_contractorId_status_priority_idx" ON "PropertyMemory"("contractorId", "status", "priority");

-- CreateIndex
CREATE INDEX "PropertyMemory_contractorId_primaryLeadId_idx" ON "PropertyMemory"("contractorId", "primaryLeadId");

-- CreateIndex
CREATE INDEX "PropertyMemory_contractorId_projectId_idx" ON "PropertyMemory"("contractorId", "projectId");

-- CreateIndex
CREATE INDEX "PropertyMemory_contractorId_lastObservedAt_idx" ON "PropertyMemory"("contractorId", "lastObservedAt");

-- CreateIndex
CREATE INDEX "PropertyMemory_contractorId_nextFollowUpAt_idx" ON "PropertyMemory"("contractorId", "nextFollowUpAt");

-- CreateIndex
CREATE INDEX "PropertyObservation_contractorId_propertyMemoryId_observedA_idx" ON "PropertyObservation"("contractorId", "propertyMemoryId", "observedAt");

-- CreateIndex
CREATE INDEX "PropertyObservation_contractorId_canvassingLeadId_idx" ON "PropertyObservation"("contractorId", "canvassingLeadId");

-- CreateIndex
CREATE INDEX "PropertyObservation_contractorId_type_idx" ON "PropertyObservation"("contractorId", "type");

-- CreateIndex
CREATE INDEX "DoorAttempt_contractorId_propertyMemoryId_createdAt_idx" ON "DoorAttempt"("contractorId", "propertyMemoryId", "createdAt");

-- CreateIndex
CREATE INDEX "DoorAttempt_contractorId_canvassingLeadId_idx" ON "DoorAttempt"("contractorId", "canvassingLeadId");

-- CreateIndex
CREATE INDEX "DoorAttempt_contractorId_userId_createdAt_idx" ON "DoorAttempt"("contractorId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "DoorAttempt_contractorId_outcome_idx" ON "DoorAttempt"("contractorId", "outcome");

-- CreateIndex
CREATE INDEX "StreetMemory_contractorId_streetName_city_state_idx" ON "StreetMemory"("contractorId", "streetName", "city", "state");

-- CreateIndex
CREATE INDEX "StreetMemory_contractorId_territoryName_idx" ON "StreetMemory"("contractorId", "territoryName");

-- CreateIndex
CREATE INDEX "StreetMemory_contractorId_lastWorkedAt_idx" ON "StreetMemory"("contractorId", "lastWorkedAt");

-- CreateIndex
CREATE INDEX "CanvassingGamePlan_contractorId_userId_status_idx" ON "CanvassingGamePlan"("contractorId", "userId", "status");

-- CreateIndex
CREATE INDEX "CanvassingGamePlan_contractorId_sessionId_idx" ON "CanvassingGamePlan"("contractorId", "sessionId");

-- CreateIndex
CREATE INDEX "CanvassingGamePlan_contractorId_territoryName_idx" ON "CanvassingGamePlan"("contractorId", "territoryName");

-- CreateIndex
CREATE INDEX "PropertyResearchRun_contractorId_userId_status_idx" ON "PropertyResearchRun"("contractorId", "userId", "status");

-- CreateIndex
CREATE INDEX "PropertyResearchRun_contractorId_mode_createdAt_idx" ON "PropertyResearchRun"("contractorId", "mode", "createdAt");

-- CreateIndex
CREATE INDEX "PropertyResearchRun_contractorId_normalizedAddress_idx" ON "PropertyResearchRun"("contractorId", "normalizedAddress");

-- CreateIndex
CREATE INDEX "PropertyResearchCandidate_contractorId_researchRunId_idx" ON "PropertyResearchCandidate"("contractorId", "researchRunId");

-- CreateIndex
CREATE INDEX "PropertyResearchCandidate_contractorId_normalizedAddress_idx" ON "PropertyResearchCandidate"("contractorId", "normalizedAddress");

-- CreateIndex
CREATE INDEX "PropertyResearchCandidate_contractorId_overallScore_idx" ON "PropertyResearchCandidate"("contractorId", "overallScore");

-- CreateIndex
CREATE INDEX "PropertyEnrichmentSnapshot_contractorId_propertyMemoryId_idx" ON "PropertyEnrichmentSnapshot"("contractorId", "propertyMemoryId");

-- CreateIndex
CREATE INDEX "PropertyEnrichmentSnapshot_contractorId_normalizedAddress_idx" ON "PropertyEnrichmentSnapshot"("contractorId", "normalizedAddress");

-- CreateIndex
CREATE INDEX "PropertyEnrichmentSnapshot_contractorId_source_capturedAt_idx" ON "PropertyEnrichmentSnapshot"("contractorId", "source", "capturedAt");

-- CreateIndex
CREATE INDEX "StreetResearchRun_contractorId_userId_status_idx" ON "StreetResearchRun"("contractorId", "userId", "status");

-- CreateIndex
CREATE INDEX "StreetResearchRun_contractorId_focusMode_idx" ON "StreetResearchRun"("contractorId", "focusMode");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_subContractorId_fkey" FOREIGN KEY ("subContractorId") REFERENCES "Subcontractor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subcontractor" ADD CONSTRAINT "Subcontractor_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Estimate" ADD CONSTRAINT "Estimate_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Estimate" ADD CONSTRAINT "Estimate_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Estimate" ADD CONSTRAINT "Estimate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_subcontractorId_fkey" FOREIGN KEY ("subcontractorId") REFERENCES "Subcontractor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "Estimate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "Estimate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceSheet" ADD CONSTRAINT "PriceSheet_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceSheet" ADD CONSTRAINT "PriceSheet_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialItem" ADD CONSTRAINT "MaterialItem_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialItem" ADD CONSTRAINT "MaterialItem_priceSheetId_fkey" FOREIGN KEY ("priceSheetId") REFERENCES "PriceSheet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialItem" ADD CONSTRAINT "MaterialItem_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_subcontractorId_fkey" FOREIGN KEY ("subcontractorId") REFERENCES "Subcontractor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceChat" ADD CONSTRAINT "WorkspaceChat_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMessage" ADD CONSTRAINT "WorkspaceMessage_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "WorkspaceChat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMessage" ADD CONSTRAINT "WorkspaceMessage_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMemory" ADD CONSTRAINT "WorkspaceMemory_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMemory" ADD CONSTRAINT "WorkspaceMemory_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceAction" ADD CONSTRAINT "WorkspaceAction_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectActivity" ADD CONSTRAINT "ProjectActivity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectActivity" ADD CONSTRAINT "ProjectActivity_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentJob" ADD CONSTRAINT "AgentJob_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerMemory" ADD CONSTRAINT "CustomerMemory_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMemory" ADD CONSTRAINT "ProjectMemory_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractorMemory" ADD CONSTRAINT "ContractorMemory_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentLesson" ADD CONSTRAINT "AgentLesson_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationSummary" ADD CONSTRAINT "ConversationSummary_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityRelation" ADD CONSTRAINT "EntityRelation_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CronRun" ADD CONSTRAINT "CronRun_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingSession" ADD CONSTRAINT "OnboardingSession_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScopeAnalysis" ADD CONSTRAINT "ScopeAnalysis_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Insight" ADD CONSTRAINT "Insight_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractorProfile" ADD CONSTRAINT "ContractorProfile_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoofReportPhoto" ADD CONSTRAINT "RoofReportPhoto_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "RoofReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignatureRequest" ADD CONSTRAINT "SignatureRequest_generatedDocumentId_fkey" FOREIGN KEY ("generatedDocumentId") REFERENCES "GeneratedDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignatureEvent" ADD CONSTRAINT "SignatureEvent_signatureRequestId_fkey" FOREIGN KEY ("signatureRequestId") REFERENCES "SignatureRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
