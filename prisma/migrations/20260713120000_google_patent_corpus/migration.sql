-- Google Patents corpus import support.

-- LocalPatent: DOCDB family id from the BigQuery import, used for one-per-family
-- dedup and family-level provenance.
ALTER TABLE "local_patents" ADD COLUMN IF NOT EXISTS "familyId" TEXT;
CREATE INDEX IF NOT EXISTS "local_patents_familyId_idx" ON "local_patents"("familyId");

-- LocalPatentEmbedding: half-precision shortened vector column for voyage-3-lite
-- (512 dims). Requires pgvector >= 0.7 for the halfvec type.
ALTER TABLE "local_patent_embeddings" ADD COLUMN IF NOT EXISTS "embeddingHalf" halfvec(512);

-- NOTE: the ANN index on "embeddingHalf" is intentionally NOT created here. Build it
-- AFTER the bulk import + embedding backfill completes (IVFFlat centroids need data):
--   see scripts/google-patents-import/README.md ("Build the vector index").
