-- Additional indexes for modular patent search providers.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "local_patents_abstract_trgm_idx"
  ON "local_patents" USING GIN ("abstract" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "local_patents_publicationNumber_trgm_idx"
  ON "local_patents" USING GIN ("publicationNumber" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "local_patents_applicationNumberRaw_trgm_idx"
  ON "local_patents" USING GIN ("applicationNumberRaw" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "local_patents_classifications_gin_idx"
  ON "local_patents" USING GIN ("classifications");

CREATE INDEX IF NOT EXISTS "local_patents_filingDate_idx"
  ON "local_patents"("filingDate");

CREATE INDEX IF NOT EXISTS "local_patents_publicationDate_idx"
  ON "local_patents"("publicationDate");
