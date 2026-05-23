ALTER TABLE "local_patents"
  ADD COLUMN IF NOT EXISTS "sourceImportFileId" TEXT;

WITH ranked_matches AS (
  SELECT
    p."id" AS "localPatentId",
    f."id" AS "fileId",
    ROW_NUMBER() OVER (
      PARTITION BY p."id"
      ORDER BY
        CASE WHEN f."originalName" = p."sourcePdfName" THEN 0 ELSE 1 END,
        CASE f."status"
          WHEN 'COMPLETED' THEN 0
          WHEN 'COMPLETED_WITH_WARNINGS' THEN 1
          WHEN 'FAILED' THEN 2
          WHEN 'PROCESSING' THEN 3
          ELSE 4
        END,
        f."completedAt" DESC NULLS LAST,
        f."createdAt" DESC
    ) AS rn
  FROM "local_patents" p
  JOIN "patent_import_files" f
    ON f."fileHash" = p."sourceFileHash"
  WHERE p."sourceImportFileId" IS NULL
    AND p."sourceFileHash" IS NOT NULL
)
UPDATE "local_patents" p
SET "sourceImportFileId" = ranked_matches."fileId"
FROM ranked_matches
WHERE p."id" = ranked_matches."localPatentId"
  AND ranked_matches.rn = 1;

DO $$
BEGIN
  ALTER TABLE "local_patents"
    ADD CONSTRAINT "local_patents_sourceImportFileId_fkey"
    FOREIGN KEY ("sourceImportFileId") REFERENCES "patent_import_files"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "local_patents_sourceImportFileId_idx"
  ON "local_patents"("sourceImportFileId");
