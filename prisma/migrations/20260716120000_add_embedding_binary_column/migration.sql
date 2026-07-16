-- Repair migration.
--
-- 20260713120000_google_patent_corpus was EDITED after production had already
-- applied it (commit 9533c29 added the embeddingBinary line to the applied file).
-- Prisma applies migrations by name exactly once, so production ended up with
-- familyId + embeddingHalf but WITHOUT embeddingBinary.
--
-- This migration delivers the missing column. IF NOT EXISTS makes it a no-op on
-- environments (e.g. dev) that already have it.
--
-- bit(512) is a native Postgres type; pgvector (>= 0.7) is only required later,
-- for the bit_hamming_ops ANN index built after the embedding backfill.

ALTER TABLE "local_patent_embeddings" ADD COLUMN IF NOT EXISTS "embeddingBinary" bit(512);
