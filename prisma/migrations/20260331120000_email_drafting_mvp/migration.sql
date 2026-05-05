ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "emailDraftingEnabled" BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'PATENT_DRAFT_EXPORT';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "EmailDraftRequestStatus" AS ENUM (
    'RECEIVED',
    'VALIDATING',
    'PARSING',
    'INITIALIZING',
    'NORMALIZING',
    'CLAIMS_SETUP',
    'PRIOR_ART_CONTEXT',
    'COMPONENTS',
    'FIGURES',
    'DRAFTING',
    'REVIEW',
    'EXPORT',
    'DELIVERED',
    'DELIVERED_WITH_WARNINGS',
    'REJECTED',
    'FAILED',
    'CANCELED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "EmailDraftAttachmentKind" AS ENUM (
    'MAIN_BRIEF',
    'CLAIMS',
    'PRIOR_ART',
    'SUPPLEMENTAL',
    'UNSUPPORTED_IMAGE',
    'UNSUPPORTED_OTHER'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "EmailDraftAttachmentStatus" AS ENUM (
    'STORED',
    'PARSED',
    'IGNORED',
    'FAILED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "tenant_inbound_aliases" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "localPart" TEXT NOT NULL,
  "domain" TEXT NOT NULL DEFAULT 'patentnest.ai',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "defaultJurisdictions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "defaultFilingType" TEXT NOT NULL DEFAULT 'utility',
  "defaultAllowRefine" BOOLEAN NOT NULL DEFAULT true,
  "defaultDeliveryTtlDays" INTEGER NOT NULL DEFAULT 7,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenant_inbound_aliases_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "email_draft_requests" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "aliasId" TEXT,
  "projectId" TEXT,
  "patentId" TEXT,
  "sessionId" TEXT,
  "subject" TEXT,
  "senderEmail" TEXT NOT NULL,
  "senderDisplayName" TEXT,
  "recipientEmail" TEXT NOT NULL,
  "messageId" TEXT,
  "receiptId" TEXT,
  "requestHash" TEXT NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "rawMimeStorageKey" TEXT,
  "rawMimeText" TEXT,
  "parsedPayload" JSONB,
  "normalizationBrief" TEXT,
  "warnings" JSONB,
  "status" "EmailDraftRequestStatus" NOT NULL DEFAULT 'RECEIVED',
  "progressPct" INTEGER NOT NULL DEFAULT 5,
  "currentStage" TEXT,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "lockedBy" TEXT,
  "lockedUntil" TIMESTAMP(3),
  "heartbeatAt" TIMESTAMP(3),
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_draft_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "email_draft_attachments" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "kind" "EmailDraftAttachmentKind" NOT NULL DEFAULT 'SUPPLEMENTAL',
  "parseStatus" "EmailDraftAttachmentStatus" NOT NULL DEFAULT 'STORED',
  "filename" TEXT NOT NULL,
  "mimeType" TEXT,
  "sha256" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "attachmentOrder" INTEGER NOT NULL DEFAULT 0,
  "extractedText" TEXT,
  "warning" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_draft_attachments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "email_draft_events" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "stage" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "message" TEXT,
  "meta" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_draft_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "document_access_links" (
  "id" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "requestId" TEXT,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "lastAccessedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "document_access_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "tenant_inbound_aliases_domain_localPart_key"
ON "tenant_inbound_aliases"("domain", "localPart");

CREATE INDEX IF NOT EXISTS "tenant_inbound_aliases_tenantId_isActive_idx"
ON "tenant_inbound_aliases"("tenantId", "isActive");

CREATE UNIQUE INDEX IF NOT EXISTS "email_draft_requests_patentId_key"
ON "email_draft_requests"("patentId");

CREATE UNIQUE INDEX IF NOT EXISTS "email_draft_requests_sessionId_key"
ON "email_draft_requests"("sessionId");

CREATE UNIQUE INDEX IF NOT EXISTS "email_draft_requests_dedupeKey_key"
ON "email_draft_requests"("dedupeKey");

CREATE INDEX IF NOT EXISTS "email_draft_requests_status_nextAttemptAt_idx"
ON "email_draft_requests"("status", "nextAttemptAt");

CREATE INDEX IF NOT EXISTS "email_draft_requests_userId_status_idx"
ON "email_draft_requests"("userId", "status");

CREATE INDEX IF NOT EXISTS "email_draft_requests_tenantId_createdAt_idx"
ON "email_draft_requests"("tenantId", "createdAt");

CREATE INDEX IF NOT EXISTS "email_draft_requests_messageId_idx"
ON "email_draft_requests"("messageId");

CREATE INDEX IF NOT EXISTS "email_draft_requests_receiptId_idx"
ON "email_draft_requests"("receiptId");

CREATE INDEX IF NOT EXISTS "email_draft_attachments_requestId_kind_idx"
ON "email_draft_attachments"("requestId", "kind");

CREATE INDEX IF NOT EXISTS "email_draft_events_requestId_createdAt_idx"
ON "email_draft_events"("requestId", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "document_access_links_tokenHash_key"
ON "document_access_links"("tokenHash");

CREATE INDEX IF NOT EXISTS "document_access_links_userId_expiresAt_idx"
ON "document_access_links"("userId", "expiresAt");

ALTER TABLE "tenant_inbound_aliases"
ADD CONSTRAINT "tenant_inbound_aliases_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "email_draft_requests"
ADD CONSTRAINT "email_draft_requests_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "email_draft_requests"
ADD CONSTRAINT "email_draft_requests_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "email_draft_requests"
ADD CONSTRAINT "email_draft_requests_aliasId_fkey"
FOREIGN KEY ("aliasId") REFERENCES "tenant_inbound_aliases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "email_draft_requests"
ADD CONSTRAINT "email_draft_requests_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "email_draft_requests"
ADD CONSTRAINT "email_draft_requests_patentId_fkey"
FOREIGN KEY ("patentId") REFERENCES "patents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "email_draft_requests"
ADD CONSTRAINT "email_draft_requests_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "drafting_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "email_draft_attachments"
ADD CONSTRAINT "email_draft_attachments_requestId_fkey"
FOREIGN KEY ("requestId") REFERENCES "email_draft_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "email_draft_events"
ADD CONSTRAINT "email_draft_events_requestId_fkey"
FOREIGN KEY ("requestId") REFERENCES "email_draft_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "document_access_links"
ADD CONSTRAINT "document_access_links_documentId_fkey"
FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "document_access_links"
ADD CONSTRAINT "document_access_links_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "document_access_links"
ADD CONSTRAINT "document_access_links_requestId_fkey"
FOREIGN KEY ("requestId") REFERENCES "email_draft_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
