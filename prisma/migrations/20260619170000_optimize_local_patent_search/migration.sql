-- Keep local patent retrieval fast as the corpus grows.
--
-- These partial indexes match the search document expression used by
-- IndianCorpusProvider. They let Postgres avoid scanning unrelated corpus
-- categories when India-only or stored international searches are selected.

CREATE INDEX IF NOT EXISTS "local_patents_indian_search_tsv_idx"
  ON "local_patents" USING GIN (
    to_tsvector(
      'english'::regconfig,
      coalesce("ragText", '') || ' ' ||
      coalesce("title", '') || ' ' ||
      coalesce("abstract", '') || ' ' ||
      coalesce("abstractOriginal", '')
    )
  )
  WHERE "corpusSources" @> ARRAY['indian-corpus']::TEXT[];

CREATE INDEX IF NOT EXISTS "local_patents_pqai_search_tsv_idx"
  ON "local_patents" USING GIN (
    to_tsvector(
      'english'::regconfig,
      coalesce("ragText", '') || ' ' ||
      coalesce("title", '') || ' ' ||
      coalesce("abstract", '') || ' ' ||
      coalesce("abstractOriginal", '')
    )
  )
  WHERE "corpusSources" @> ARRAY['pqai']::TEXT[];

CREATE INDEX IF NOT EXISTS "local_patents_indian_metadata_tsv_idx"
  ON "local_patents" USING GIN (
    to_tsvector(
      'simple'::regconfig,
      array_to_string("classifications", ' ') || ' ' ||
      array_to_string("inventors", ' ') || ' ' ||
      coalesce("applicants"::text, '')
    )
  )
  WHERE "corpusSources" @> ARRAY['indian-corpus']::TEXT[];

CREATE INDEX IF NOT EXISTS "local_patents_pqai_metadata_tsv_idx"
  ON "local_patents" USING GIN (
    to_tsvector(
      'simple'::regconfig,
      array_to_string("classifications", ' ') || ' ' ||
      array_to_string("inventors", ' ') || ' ' ||
      coalesce("applicants"::text, '')
    )
  )
  WHERE "corpusSources" @> ARRAY['pqai']::TEXT[];

ANALYZE "local_patents";
