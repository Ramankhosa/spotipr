-- India filing forms: inventors, signatory, filing details, firm house-style presets.

-- AlterEnum: Form 1 para 3B has a dedicated "Educational Institute" tick box.
ALTER TYPE "ApplicantCategory" ADD VALUE IF NOT EXISTS 'educational_institute';

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "FilingApplicationType" AS ENUM ('ordinary', 'convention', 'pct_np');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "FilingSpecType" AS ENUM ('provisional', 'complete');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AlterTable: nationality + authorised signatory + project-layer filing settings
ALTER TABLE "applicant_profiles"
    ADD COLUMN IF NOT EXISTS "applicantNationality" TEXT,
    ADD COLUMN IF NOT EXISTS "signatoryName" TEXT,
    ADD COLUMN IF NOT EXISTS "signatoryDesignation" TEXT,
    ADD COLUMN IF NOT EXISTS "signatoryMobile" TEXT,
    ADD COLUMN IF NOT EXISTS "signatoryEmail" TEXT,
    ADD COLUMN IF NOT EXISTS "filingSettings" JSONB;

-- CreateTable
CREATE TABLE "firm_filing_presets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "appliesTo" JSONB,
    "settings" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "firm_filing_presets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patent_inventors" (
    "id" TEXT NOT NULL,
    "patentId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "honorific" TEXT,
    "nameBody" TEXT NOT NULL,
    "familyNameFirst" BOOLEAN NOT NULL DEFAULT false,
    "nationality" TEXT NOT NULL,
    "countryOfResidence" TEXT NOT NULL,
    "addressLine1" TEXT NOT NULL,
    "street" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "pinCode" TEXT NOT NULL,
    "isAdditionalInventor" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patent_inventors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patent_filing_details" (
    "id" TEXT NOT NULL,
    "patentId" TEXT NOT NULL,
    "applicationType" "FilingApplicationType" NOT NULL DEFAULT 'ordinary',
    "specType" "FilingSpecType" NOT NULL DEFAULT 'provisional',
    "isDivisional" BOOLEAN NOT NULL DEFAULT false,
    "isPatentOfAddition" BOOLEAN NOT NULL DEFAULT false,
    "officeBranch" TEXT NOT NULL DEFAULT 'Delhi',
    "applicantRefNo" TEXT,
    "specPages" INTEGER NOT NULL DEFAULT 0,
    "claimsCount" INTEGER NOT NULL DEFAULT 0,
    "claimsPages" INTEGER NOT NULL DEFAULT 0,
    "abstractPages" INTEGER NOT NULL DEFAULT 0,
    "drawingsCount" INTEGER NOT NULL DEFAULT 0,
    "drawingsPages" INTEGER NOT NULL DEFAULT 0,
    "feeAmount" INTEGER,
    "feeMode" TEXT NOT NULL DEFAULT 'efiling',
    "applicationNo" TEXT,
    "filingDate" TIMESTAMP(3),
    "parentApplicationNo" TEXT,
    "parentFilingDate" TIMESTAMP(3),
    "filingSettings" JSONB,
    "signatoryOverride" JSONB,
    "presetId" TEXT,
    "resolvedSnapshot" JSONB,
    "lastGeneratedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patent_filing_details_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "firm_filing_presets_tenantId_name_key" ON "firm_filing_presets"("tenantId", "name");
CREATE INDEX "firm_filing_presets_tenantId_isDefault_idx" ON "firm_filing_presets"("tenantId", "isDefault");
CREATE INDEX "patent_inventors_patentId_sortOrder_idx" ON "patent_inventors"("patentId", "sortOrder");
CREATE UNIQUE INDEX "patent_filing_details_patentId_key" ON "patent_filing_details"("patentId");

-- AddForeignKey
ALTER TABLE "firm_filing_presets" ADD CONSTRAINT "firm_filing_presets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "patent_inventors" ADD CONSTRAINT "patent_inventors_patentId_fkey" FOREIGN KEY ("patentId") REFERENCES "patents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "patent_filing_details" ADD CONSTRAINT "patent_filing_details_patentId_fkey" FOREIGN KEY ("patentId") REFERENCES "patents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
