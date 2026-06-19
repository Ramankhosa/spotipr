ALTER TABLE "local_patents"
  ADD COLUMN IF NOT EXISTS "corpusSources" TEXT[] NOT NULL DEFAULT ARRAY['indian-corpus']::TEXT[],
  ADD COLUMN IF NOT EXISTS "pqaiDetails" JSONB,
  ADD COLUMN IF NOT EXISTS "pqaiFetchedAt" TIMESTAMP(3);

UPDATE "local_patents"
SET "corpusSources" = ARRAY['indian-corpus']::TEXT[]
WHERE "corpusSources" IS NULL OR cardinality("corpusSources") = 0;

CREATE INDEX IF NOT EXISTS "local_patents_corpusSources_gin_idx"
  ON "local_patents" USING GIN ("corpusSources");

CREATE INDEX IF NOT EXISTS "local_patents_pqaiFetchedAt_idx"
  ON "local_patents"("pqaiFetchedAt");
