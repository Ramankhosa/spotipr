-- Google Patents corpus import support.

-- LocalPatent: DOCDB family id from the BigQuery import, used for one-per-family
-- dedup and family-level provenance.
ALTER TABLE "local_patents" ADD COLUMN IF NOT EXISTS "familyId" TEXT;
CREATE INDEX IF NOT EXISTS "local_patents_familyId_idx" ON "local_patents"("familyId");

-- LocalPatentEmbedding: shortened vector columns for Voyage embeddings.
--   embeddingHalf   halfvec(512) — float16, cosine (optional float path)
--   embeddingBinary bit(512)     — Matryoshka 512 + binary quantization, Hamming.
-- Requires pgvector >= 0.7 for the halfvec and bit index operator classes.
ALTER TABLE "local_patent_embeddings" ADD COLUMN IF NOT EXISTS "embeddingHalf" halfvec(512);
ALTER TABLE "local_patent_embeddings" ADD COLUMN IF NOT EXISTS "embeddingBinary" bit(512);

-- NOTE: ANN indexes are intentionally NOT created here. Build them AFTER the bulk
-- import + embedding backfill completes (IVFFlat centroids need data):
--   see scripts/google-patents-import/README.md ("Build the vector index").
-- Binary (default for the Google corpus):
--   CREATE INDEX CONCURRENTLY local_patent_embeddings_binary_ivf_idx
--     ON local_patent_embeddings USING ivfflat ("embeddingBinary" bit_hamming_ops)
--     WITH (lists = 4000) WHERE "embeddingBinary" IS NOT NULL;
