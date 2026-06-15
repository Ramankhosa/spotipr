DO $$ BEGIN
  CREATE TYPE "IpIndiaJournalFileStatus" AS ENUM (
    'DISCOVERED',
    'QUEUED',
    'DOWNLOADING',
    'DOWNLOADED',
    'IMPORTED',
    'EXTRACTED',
    'EMBEDDED',
    'SKIPPED',
    'FAILED'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "ipindia_journal_files" (
  "id" TEXT NOT NULL,
  "journalKey" TEXT NOT NULL,
  "portalFileName" TEXT NOT NULL,
  "journalNo" TEXT NOT NULL,
  "publicationDateRaw" TEXT,
  "availabilityDateRaw" TEXT,
  "publicationDate" TIMESTAMP(3),
  "availabilityDate" TIMESTAMP(3),
  "part" INTEGER NOT NULL,
  "label" TEXT,
  "fileName" TEXT NOT NULL,
  "outputFile" TEXT,
  "storedPath" TEXT,
  "fileHash" TEXT,
  "fileSizeBytes" INTEGER,
  "downloadedBytes" INTEGER,
  "expectedBytes" INTEGER,
  "status" "IpIndiaJournalFileStatus" NOT NULL DEFAULT 'DISCOVERED',
  "errorMessage" TEXT,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedBy" TEXT,
  "lockedUntil" TIMESTAMP(3),
  "heartbeatAt" TIMESTAMP(3),
  "lastDiscoveredAt" TIMESTAMP(3),
  "downloadStartedAt" TIMESTAMP(3),
  "downloadedAt" TIMESTAMP(3),
  "importedAt" TIMESTAMP(3),
  "extractedAt" TIMESTAMP(3),
  "embeddedAt" TIMESTAMP(3),
  "patentImportBatchId" TEXT,
  "patentImportFileId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ipindia_journal_files_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "ipindia_journal_files"
    ADD CONSTRAINT "ipindia_journal_files_patentImportBatchId_fkey"
    FOREIGN KEY ("patentImportBatchId") REFERENCES "patent_import_batches"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "ipindia_journal_files"
    ADD CONSTRAINT "ipindia_journal_files_patentImportFileId_fkey"
    FOREIGN KEY ("patentImportFileId") REFERENCES "patent_import_files"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "ipindia_journal_files_journalKey_key"
  ON "ipindia_journal_files"("journalKey");

CREATE UNIQUE INDEX IF NOT EXISTS "ipindia_journal_files_portalFileName_key"
  ON "ipindia_journal_files"("portalFileName");

CREATE UNIQUE INDEX IF NOT EXISTS "ipindia_journal_files_patentImportFileId_key"
  ON "ipindia_journal_files"("patentImportFileId");

CREATE INDEX IF NOT EXISTS "ipindia_journal_files_status_nextAttemptAt_idx"
  ON "ipindia_journal_files"("status", "nextAttemptAt");

CREATE INDEX IF NOT EXISTS "ipindia_journal_files_availabilityDate_part_idx"
  ON "ipindia_journal_files"("availabilityDate", "part");

CREATE INDEX IF NOT EXISTS "ipindia_journal_files_journalNo_idx"
  ON "ipindia_journal_files"("journalNo");

CREATE INDEX IF NOT EXISTS "ipindia_journal_files_fileHash_idx"
  ON "ipindia_journal_files"("fileHash");

CREATE INDEX IF NOT EXISTS "ipindia_journal_files_patentImportBatchId_idx"
  ON "ipindia_journal_files"("patentImportBatchId");
