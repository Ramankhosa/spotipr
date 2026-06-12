ALTER TABLE "local_patents"
ADD COLUMN "claimsText" TEXT,
ADD COLUMN "descriptionText" TEXT,
ADD COLUMN "ipIndiaDetails" JSONB,
ADD COLUMN "ipIndiaCapturedAt" TIMESTAMP(3);
