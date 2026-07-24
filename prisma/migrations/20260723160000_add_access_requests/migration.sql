-- CreateEnum
CREATE TYPE "AccessRequestKind" AS ENUM ('CONTACT', 'TRIAL');

-- CreateEnum
CREATE TYPE "AccessRequestStatus" AS ENUM ('NEW', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'RESOLVED', 'SPAM');

-- CreateTable
CREATE TABLE "access_requests" (
    "id" TEXT NOT NULL,
    "kind" "AccessRequestKind" NOT NULL,
    "status" "AccessRequestStatus" NOT NULL DEFAULT 'NEW',
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "organization" TEXT,
    "jobTitle" TEXT,
    "country" TEXT,
    "topic" TEXT,
    "message" TEXT,
    "useCase" TEXT,
    "teamSize" TEXT,
    "expectedVolume" TEXT,
    "jurisdictions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requestedDays" INTEGER,
    "sourcePage" TEXT,
    "referrer" TEXT,
    "userAgent" TEXT,
    "ipHash" TEXT,
    "existingUserId" TEXT,
    "assignedTo" TEXT,
    "internalNotes" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "decisionReason" TEXT,
    "grantedCampaignId" TEXT,
    "grantedInviteId" TEXT,
    "grantedTrialDays" INTEGER,
    "inviteSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "access_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_request_events" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "note" TEXT,
    "actorEmail" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_request_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "access_requests_kind_status_createdAt_idx" ON "access_requests"("kind", "status", "createdAt");

-- CreateIndex
CREATE INDEX "access_requests_status_createdAt_idx" ON "access_requests"("status", "createdAt");

-- CreateIndex
CREATE INDEX "access_requests_email_idx" ON "access_requests"("email");

-- CreateIndex
CREATE INDEX "access_requests_createdAt_idx" ON "access_requests"("createdAt");

-- CreateIndex
CREATE INDEX "access_request_events_requestId_createdAt_idx" ON "access_request_events"("requestId", "createdAt");

-- AddForeignKey
ALTER TABLE "access_request_events" ADD CONSTRAINT "access_request_events_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "access_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
