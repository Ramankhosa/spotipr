-- Make the fuzzy-text (trigram GIN) indexes PARTIAL — Indian corpus only.
--
-- Rationale: trigram GIN powers fielded/fuzzy text search, which only the Indian
-- corpus uses. The Google Patents corpus (110M rows) is a vector + reranker lane and
-- never touches these indexes. Left non-partial, the abstract trigram GIN alone would
-- balloon to ~150GB once the Google rows land — the single thing that would blow a
-- 500GB disk. Scoping them to `corpusSources @> {indian-corpus}` keeps them tiny
-- (~1M rows) with zero impact on Indian search.
--
-- MUST run BEFORE importing the Google corpus. Fast (only Indian rows exist yet).
--
-- Prisma note: schema.prisma still models these as non-partial @@index (Prisma cannot
-- express a partial WHERE). Prod `prisma migrate deploy` applies this file verbatim and
-- is unaffected. Local `prisma migrate dev` may report drift — that is expected and
-- harmless (dev DBs have no Google rows).

DROP INDEX IF EXISTS "local_patents_title_trgm_idx";
CREATE INDEX "local_patents_title_trgm_idx"
  ON "local_patents" USING gin ("title" gin_trgm_ops)
  WHERE "corpusSources" @> ARRAY['indian-corpus']::text[];

DROP INDEX IF EXISTS "local_patents_abstract_trgm_idx";
CREATE INDEX "local_patents_abstract_trgm_idx"
  ON "local_patents" USING gin ("abstract" gin_trgm_ops)
  WHERE "corpusSources" @> ARRAY['indian-corpus']::text[];

DROP INDEX IF EXISTS "local_patents_publicationNumber_trgm_idx";
CREATE INDEX "local_patents_publicationNumber_trgm_idx"
  ON "local_patents" USING gin ("publicationNumber" gin_trgm_ops)
  WHERE "corpusSources" @> ARRAY['indian-corpus']::text[];

DROP INDEX IF EXISTS "local_patents_applicationNumberRaw_trgm_idx";
CREATE INDEX "local_patents_applicationNumberRaw_trgm_idx"
  ON "local_patents" USING gin ("applicationNumberRaw" gin_trgm_ops)
  WHERE "corpusSources" @> ARRAY['indian-corpus']::text[];
