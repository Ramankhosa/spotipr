-- EPO BDDS ingestion: ledger, EP full-text side table, DOCDB enrichment side
-- table, coverage tracking, and text-provenance markers.
--
-- SAFETY CONTRACT FOR THIS MIGRATION
--   * local_patents gains ONLY nullable marker columns. In PG 11+ an ADD COLUMN
--     that is nullable with no default is metadata-only: instant on 45.4M rows,
--     NO heap rewrite. Nothing existing is altered or backfilled.
--   * local_patent_embeddings is NOT touched. In particular the
--     `ALTER "embeddingBinary" SET DATA TYPE bit(512)` that `prisma migrate diff`
--     perpetually proposes is deliberately absent — it is a full-table rewrite
--     that Prisma itself warns can lose the column data.
--   * The four trigram GIN indexes on local_patents are PARTIAL (see migration
--     20260713140000). This migration does not touch or recreate them.
--   * No EPO content is written into local_patents by this migration or by the
--     normal import path; it lands in the epo_* tables below.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "EpoBddsFileStatus" AS ENUM (
    'QUEUED', 'DOWNLOADED', 'VERIFIED', 'LOADED', 'FAILED', 'SKIPPED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "EpoCoverageStatus" AS ENUM ('NOT_IMPORTED', 'PARTIAL', 'IMPORTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Ledger. The existing PatentImportBatch/PatentImportFile pair cannot be reused:
-- it requires uploadedBy -> User, a storedPath, and PDF page counts, none of
-- which apply to a BDDS delivery.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "epo_bdds_delivery" (
  "id"            TEXT PRIMARY KEY,
  "productId"     INTEGER NOT NULL,
  "productName"   TEXT NOT NULL,
  "lane"          TEXT NOT NULL,               -- ep-fulltext | docdb | inpadoc
  "deliveryId"    INTEGER NOT NULL,
  "deliveryName"  TEXT NOT NULL,
  "publishedAt"   TIMESTAMP(3),
  "expiresAt"     TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "epo_bdds_delivery_product_delivery_key"
  ON "epo_bdds_delivery"("productId", "deliveryId");
CREATE INDEX IF NOT EXISTS "epo_bdds_delivery_lane_idx" ON "epo_bdds_delivery"("lane");

-- One row per (product, delivery, file). This is what makes a run resumable:
-- a file already at LOADED is never downloaded, parsed or loaded again.
CREATE TABLE IF NOT EXISTS "epo_bdds_file" (
  "id"            TEXT PRIMARY KEY,
  "productId"     INTEGER NOT NULL,
  "deliveryId"    INTEGER NOT NULL,
  "fileId"        INTEGER NOT NULL,
  "lane"          TEXT NOT NULL,
  "fileName"      TEXT NOT NULL,
  -- Advertised size is a human string on the wire ("1.5 GB"); this is the
  -- parsed estimate. bytesDownloaded is the verified truth.
  "sizeBytes"     BIGINT,
  "bytesDownloaded" BIGINT,
  "checksum"      TEXT,
  -- The API never states the algorithm. Detected empirically on first download
  -- and recorded here, per file.
  "checksumAlgo"  TEXT,
  -- Slice coordinates parsed from fileName, so --year/--authority can skip a
  -- file without downloading it. NULL means the filename carried no such
  -- information and record-level filtering is required instead.
  "authority"     TEXT,
  "pubYearFrom"   INTEGER,
  "pubYearTo"     INTEGER,
  "status"        "EpoBddsFileStatus" NOT NULL DEFAULT 'QUEUED',
  "attemptCount"  INTEGER NOT NULL DEFAULT 0,
  "recordsLoaded" INTEGER NOT NULL DEFAULT 0,
  "errorMessage"  TEXT,
  "startedAt"     TIMESTAMP(3),
  "completedAt"   TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "epo_bdds_file_coordinates_key"
  ON "epo_bdds_file"("productId", "deliveryId", "fileId");
CREATE INDEX IF NOT EXISTS "epo_bdds_file_status_idx" ON "epo_bdds_file"("status");
CREATE INDEX IF NOT EXISTS "epo_bdds_file_lane_year_idx" ON "epo_bdds_file"("lane", "pubYearTo");

-- ---------------------------------------------------------------------------
-- Phase 1 — EP full-text.
--
-- Claims AND description are stored in FULL. A record is never half-captured;
-- what varies is which YEARS have been imported, which epo_ep_coverage tracks.
-- This table is a 1:1 extension of local_patents keyed on publicationNumber —
-- NOT a second copy of the publication. No title/abstract/date/CPC is
-- duplicated here.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "epo_ep_fulltext" (
  "publicationNumber"    TEXT PRIMARY KEY,
  "publicationNumberKey" TEXT NOT NULL,
  "kind"                 TEXT,
  "lang"                 TEXT,
  "publicationYear"      INTEGER,
  "claimsText"           TEXT,
  "claimsCount"          INTEGER,
  "claimsComplete"       BOOLEAN NOT NULL DEFAULT FALSE,
  "descriptionText"      TEXT,
  "descriptionCharCount" INTEGER,
  "descriptionComplete"  BOOLEAN NOT NULL DEFAULT FALSE,
  -- What capture policy produced this row, e.g.
  -- 'claims-full+description-full'. Recorded so a later policy change knows
  -- exactly which rows need upgrading rather than re-deriving it.
  "textPolicy"           TEXT NOT NULL,
  "sourceProductId"      INTEGER,
  "sourceDeliveryId"     INTEGER,
  "ingestedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "epo_ep_fulltext_pubkey_idx"
  ON "epo_ep_fulltext"("publicationNumberKey");
CREATE INDEX IF NOT EXISTS "epo_ep_fulltext_year_idx"
  ON "epo_ep_fulltext"("publicationYear");

-- FTS over CLAIMS ONLY. A GIN tsvector over full descriptions across millions
-- of documents would add tens of GB for little retrieval benefit; descriptions
-- stay stored and retrievable (and chunkable for downstream embeddings) but
-- are not full-text indexed. The table is empty at migration time so this is
-- instant; for a very large backfill, drop and rebuild it afterwards.
CREATE INDEX IF NOT EXISTS "epo_ep_fulltext_claims_tsv_idx"
  ON "epo_ep_fulltext"
  USING GIN (to_tsvector('english', COALESCE("claimsText", '')));

-- Per-year slice status. This is the authoritative answer to
-- "do we hold EP <year> completely?".
CREATE TABLE IF NOT EXISTS "epo_ep_coverage" (
  "id"              TEXT PRIMARY KEY,
  "productId"       INTEGER NOT NULL,
  "publicationYear" INTEGER NOT NULL,
  "status"          "EpoCoverageStatus" NOT NULL DEFAULT 'NOT_IMPORTED',
  "textPolicy"      TEXT,
  "expectedDocs"    INTEGER,
  "loadedDocs"      INTEGER NOT NULL DEFAULT 0,
  "importedAt"      TIMESTAMP(3),
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "epo_ep_coverage_product_year_key"
  ON "epo_ep_coverage"("productId", "publicationYear");

-- ---------------------------------------------------------------------------
-- Phase 2 — DOCDB enrichment.
--
-- applicants / inventors / IPC for publications we already hold. Insert-only
-- and deliberately NOT a foreign key: this is why Phase 2 does not have to
-- UPDATE 45M rows of local_patents, which would rewrite 78 GB of heap under
-- MVCC and could fill the disk.
--
-- publicationNumberKey MUST be produced by the same expression the Google
-- loader uses (scripts/google-patents-import/04-postgres-load-and-upsert.sql:68):
--   NULLIF(regexp_replace(upper(publication_number), '[^A-Z0-9]', '', 'g'), '')
-- i.e. uppercase, strip non-alphanumerics, KEEP the kind code. Do not confuse
-- it with `pub_canonical`, which strips the kind code and is only for BigQuery
-- claims lookups.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "epo_patent_bib" (
  "publicationNumberKey" TEXT PRIMARY KEY,
  "publicationNumber"    TEXT NOT NULL,
  "applicants"           JSONB,
  "inventors"            TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "ipc"                  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "docdbFamilyId"        TEXT,
  "sourceProductId"      INTEGER,
  "sourceDeliveryId"     INTEGER,
  "ingestedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "epo_patent_bib_family_idx" ON "epo_patent_bib"("docdbFamilyId");

-- ---------------------------------------------------------------------------
-- Audit for the opt-in `fieldfill` command — the ONLY thing that ever writes to
-- local_patents. One row per column filled, so every write is reversible and
-- reviewable.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "epo_gapfill_audit" (
  "id"             TEXT PRIMARY KEY,
  "localPatentId"  INTEGER NOT NULL,
  "column"         TEXT NOT NULL,
  "sourceDeliveryId" INTEGER,
  "filledAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "epo_gapfill_audit_patent_idx" ON "epo_gapfill_audit"("localPatentId");
CREATE INDEX IF NOT EXISTS "epo_gapfill_audit_filled_idx" ON "epo_gapfill_audit"("filledAt");

-- ---------------------------------------------------------------------------
-- Text-provenance markers on local_patents.
--
-- All five are NULLABLE with no default => metadata-only ADD COLUMN, instant,
-- no heap rewrite. They are NOT backfilled: marking all 45.4M legacy rows would
-- be a full-table UPDATE, exactly the rewrite we are avoiding.
--
--   NULL      -> this service never touched the row. Legacy, which today means
--                Google-US-partial (first independent claim + 5,000-char
--                description) for US rows, and no text at all for everything
--                else. The patent_text_availability view resolves that by rule.
--   NOT NULL  -> this service wrote it, and these columns say exactly what it is.
--
-- `textUpdatedAt IS NOT NULL` is therefore the permanent, queryable answer to
-- "which rows have we ever modified?".
-- ---------------------------------------------------------------------------
ALTER TABLE "local_patents" ADD COLUMN IF NOT EXISTS "claimsSource" TEXT;
ALTER TABLE "local_patents" ADD COLUMN IF NOT EXISTS "claimsCompleteness" TEXT;
ALTER TABLE "local_patents" ADD COLUMN IF NOT EXISTS "descriptionSource" TEXT;
ALTER TABLE "local_patents" ADD COLUMN IF NOT EXISTS "descriptionCompleteness" TEXT;
ALTER TABLE "local_patents" ADD COLUMN IF NOT EXISTS "textUpdatedAt" TIMESTAMP(3);

-- What embeddingText was built from.
--
--   NULL              -> legacy: title + abstract (every pre-existing row)
--   'title+abstract'  -> we wrote it, standard basis
--   'title+first-claim' -> we wrote it for a GRANTED EP specification, which
--                          carries no abstract. Claim 1 stands in: measured at
--                          ~1,034 chars against a typical abstract's ~800-1,200,
--                          so it is comparable in length, and it states what the
--                          invention is. Its register is legal rather than
--                          descriptive, so vectors for these rows may sit
--                          slightly differently — this column is how you find
--                          them if that ever needs evaluating or redoing.
--
-- Nullable, no default => metadata-only ADD COLUMN, no rewrite.
ALTER TABLE "local_patents" ADD COLUMN IF NOT EXISTS "embeddingTextSource" TEXT;

-- ---------------------------------------------------------------------------
-- The upgrade work list: rows still holding legacy partial text.
--
-- NOT created here. A non-concurrent CREATE INDEX takes ACCESS EXCLUSIVE on
-- local_patents, which would block all reads and writes on a 45M-row table in
-- production, and CREATE INDEX CONCURRENTLY cannot run inside the transaction
-- Prisma wraps this migration in. Build it out-of-band, following the same
-- precedent as the ANN indexes in 20260713120000:
--
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "local_patents_legacy_partial_text_idx"
--     ON "local_patents" ("id")
--     WHERE "claimsSource" IS NULL AND "claimsText" IS NOT NULL;
--
-- It is partial, so it only covers rows that actually hold legacy text.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- One resolver so nothing in the codebase has to infer text provenance.
-- A view: no storage, cannot drift.
--
-- Precedence: EPO full text > an explicit marker we wrote > the legacy rule.
-- This is what src/lib/local-patent-claims-service.ts should read instead of a
-- bare non-NULL check (see the note at its line 13).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW "patent_text_availability" AS
SELECT
  lp."id",
  lp."publicationNumber",
  lp."country",
  CASE
    WHEN eft."claimsComplete"                    THEN 'FULL_EPO'
    WHEN lp."claimsCompleteness" IS NOT NULL     THEN lp."claimsCompleteness"
    WHEN lp."claimsText" IS NOT NULL             THEN 'FIRST_CLAIM_ONLY'
    WHEN lp."country" = 'US'                     THEN 'ON_DEMAND_BIGQUERY'
    ELSE 'NONE'
  END AS "claimsAvailability",
  CASE
    WHEN eft."descriptionComplete"               THEN 'FULL_EPO'
    WHEN lp."descriptionCompleteness" IS NOT NULL THEN lp."descriptionCompleteness"
    WHEN lp."descriptionText" IS NOT NULL        THEN 'TRUNCATED_5K'
    ELSE 'NONE'
  END AS "descriptionAvailability",
  COALESCE(
    CASE WHEN eft."publicationNumber" IS NOT NULL THEN 'epo-ep-fulltext' END,
    lp."claimsSource"
  ) AS "claimsSource",
  eft."textPolicy",
  eft."claimsCount",
  eft."descriptionCharCount"
FROM "local_patents" lp
LEFT JOIN "epo_ep_fulltext" eft
  ON eft."publicationNumber" = lp."publicationNumber";
