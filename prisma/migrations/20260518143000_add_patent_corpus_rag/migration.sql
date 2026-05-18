-- Robust patent corpus extraction and RAG storage.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$ BEGIN
  CREATE TYPE "PatentImportStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'COMPLETED_WITH_WARNINGS', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "PatentEmbeddingStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "local_patents"
  ADD COLUMN IF NOT EXISTS "applicationNumberRaw" TEXT,
  ADD COLUMN IF NOT EXISTS "country" TEXT,
  ADD COLUMN IF NOT EXISTS "filingDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "publicationDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "applicants" JSONB,
  ADD COLUMN IF NOT EXISTS "inventors" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "classifications" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "rawApplicantBlock" TEXT,
  ADD COLUMN IF NOT EXISTS "rawInventorBlock" TEXT,
  ADD COLUMN IF NOT EXISTS "rawClassificationBlock" TEXT,
  ADD COLUMN IF NOT EXISTS "rawText" TEXT,
  ADD COLUMN IF NOT EXISTS "numberOfPages" INTEGER,
  ADD COLUMN IF NOT EXISTS "numberOfClaims" INTEGER,
  ADD COLUMN IF NOT EXISTS "sourcePdfName" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceFileHash" TEXT,
  ADD COLUMN IF NOT EXISTS "sourcePageNumber" INTEGER,
  ADD COLUMN IF NOT EXISTS "ragText" TEXT,
  ADD COLUMN IF NOT EXISTS "embeddingText" TEXT,
  ADD COLUMN IF NOT EXISTS "extractionVersion" TEXT,
  ADD COLUMN IF NOT EXISTS "extractionConfidence" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "extractionWarnings" JSONB;

CREATE TABLE IF NOT EXISTS "patent_import_batches" (
  "id" TEXT NOT NULL,
  "status" "PatentImportStatus" NOT NULL DEFAULT 'QUEUED',
  "originalFileCount" INTEGER NOT NULL DEFAULT 0,
  "totalFiles" INTEGER NOT NULL DEFAULT 0,
  "processedFiles" INTEGER NOT NULL DEFAULT 0,
  "failedFiles" INTEGER NOT NULL DEFAULT 0,
  "totalPages" INTEGER NOT NULL DEFAULT 0,
  "patentPages" INTEGER NOT NULL DEFAULT 0,
  "patentsCreated" INTEGER NOT NULL DEFAULT 0,
  "patentsUpdated" INTEGER NOT NULL DEFAULT 0,
  "lowConfidencePages" INTEGER NOT NULL DEFAULT 0,
  "warningCount" INTEGER NOT NULL DEFAULT 0,
  "errorMessage" TEXT,
  "uploadedBy" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "patent_import_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "patent_import_files" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "status" "PatentImportStatus" NOT NULL DEFAULT 'QUEUED',
  "originalName" TEXT NOT NULL,
  "storedPath" TEXT NOT NULL,
  "mimeType" TEXT,
  "fileHash" TEXT NOT NULL,
  "fileSizeBytes" INTEGER NOT NULL,
  "totalPages" INTEGER NOT NULL DEFAULT 0,
  "patentPages" INTEGER NOT NULL DEFAULT 0,
  "patentsCreated" INTEGER NOT NULL DEFAULT 0,
  "patentsUpdated" INTEGER NOT NULL DEFAULT 0,
  "ignoredPages" INTEGER NOT NULL DEFAULT 0,
  "lowConfidencePages" INTEGER NOT NULL DEFAULT 0,
  "warningCount" INTEGER NOT NULL DEFAULT 0,
  "errorMessage" TEXT,
  "extractionVersion" TEXT,
  "lockedBy" TEXT,
  "lockedUntil" TIMESTAMP(3),
  "heartbeatAt" TIMESTAMP(3),
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "patent_import_files_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "local_patent_embeddings" (
  "id" TEXT NOT NULL,
  "localPatentId" INTEGER NOT NULL,
  "model" TEXT NOT NULL,
  "dimensions" INTEGER NOT NULL,
  "textHash" TEXT NOT NULL,
  "status" "PatentEmbeddingStatus" NOT NULL DEFAULT 'QUEUED',
  "errorMessage" TEXT,
  "embedding" vector(1536),
  "lockedBy" TEXT,
  "lockedUntil" TIMESTAMP(3),
  "heartbeatAt" TIMESTAMP(3),
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "embeddedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "local_patent_embeddings_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "patent_import_batches"
    ADD CONSTRAINT "patent_import_batches_uploadedBy_fkey"
    FOREIGN KEY ("uploadedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "patent_import_files"
    ADD CONSTRAINT "patent_import_files_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "patent_import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "local_patent_embeddings"
    ADD CONSTRAINT "local_patent_embeddings_localPatentId_fkey"
    FOREIGN KEY ("localPatentId") REFERENCES "local_patents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "patent_import_files_batchId_fileHash_key"
  ON "patent_import_files"("batchId", "fileHash");

CREATE UNIQUE INDEX IF NOT EXISTS "local_patent_embeddings_localPatentId_model_textHash_key"
  ON "local_patent_embeddings"("localPatentId", "model", "textHash");

CREATE INDEX IF NOT EXISTS "patent_import_batches_status_createdAt_idx"
  ON "patent_import_batches"("status", "createdAt");

CREATE INDEX IF NOT EXISTS "patent_import_batches_uploadedBy_createdAt_idx"
  ON "patent_import_batches"("uploadedBy", "createdAt");

CREATE INDEX IF NOT EXISTS "patent_import_files_status_nextAttemptAt_idx"
  ON "patent_import_files"("status", "nextAttemptAt");

CREATE INDEX IF NOT EXISTS "patent_import_files_batchId_status_idx"
  ON "patent_import_files"("batchId", "status");

CREATE INDEX IF NOT EXISTS "local_patent_embeddings_status_nextAttemptAt_idx"
  ON "local_patent_embeddings"("status", "nextAttemptAt");

CREATE INDEX IF NOT EXISTS "local_patent_embeddings_localPatentId_idx"
  ON "local_patent_embeddings"("localPatentId");

CREATE INDEX IF NOT EXISTS "local_patents_title_trgm_idx"
  ON "local_patents" USING GIN ("title" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "local_patents_search_tsv_idx"
  ON "local_patents" USING GIN (
    to_tsvector(
      'english'::regconfig,
      coalesce("ragText", '') || ' ' ||
      coalesce("title", '') || ' ' ||
      coalesce("abstract", '') || ' ' ||
      coalesce("abstractOriginal", '')
    )
  );

DO $$
BEGIN
  EXECUTE 'CREATE INDEX IF NOT EXISTS "local_patent_embeddings_embedding_hnsw_idx"
    ON "local_patent_embeddings" USING hnsw ("embedding" vector_cosine_ops)
    WHERE "embedding" IS NOT NULL';
EXCEPTION
  WHEN undefined_object OR feature_not_supported THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS "local_patent_embeddings_embedding_ivfflat_idx"
      ON "local_patent_embeddings" USING ivfflat ("embedding" vector_cosine_ops)
      WITH (lists = 100)
      WHERE "embedding" IS NOT NULL';
END $$;
