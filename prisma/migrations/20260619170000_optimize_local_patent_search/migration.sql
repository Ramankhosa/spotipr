-- Keep local patent retrieval fast as the corpus grows.
--
-- These partial indexes match the search document expression used by
-- IndianCorpusProvider. They let Postgres avoid scanning unrelated corpus
-- categories when India-only or stored international searches are selected.

-- PostgreSQL marks the built-in array_to_string(anyarray, text) as STABLE,
-- which prevents it from being used directly in an expression index. For
-- text arrays the result is deterministic, so expose the narrow text[] form
-- as IMMUTABLE and use the exact same function in the runtime query.
CREATE OR REPLACE FUNCTION "immutable_text_array_to_string"(TEXT[], TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
AS $function$
  SELECT array_to_string($1, $2)
$function$;

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
      "immutable_text_array_to_string"("classifications", ' ') || ' ' ||
      "immutable_text_array_to_string"("inventors", ' ') || ' ' ||
      coalesce("applicants"::text, '')
    )
  )
  WHERE "corpusSources" @> ARRAY['indian-corpus']::TEXT[];

CREATE INDEX IF NOT EXISTS "local_patents_pqai_metadata_tsv_idx"
  ON "local_patents" USING GIN (
    to_tsvector(
      'simple'::regconfig,
      "immutable_text_array_to_string"("classifications", ' ') || ' ' ||
      "immutable_text_array_to_string"("inventors", ' ') || ' ' ||
      coalesce("applicants"::text, '')
    )
  )
  WHERE "corpusSources" @> ARRAY['pqai']::TEXT[];

ANALYZE "local_patents";
