-- Partial full-text GIN over the EPO OPS-fetched rows.
--
-- Completes the per-corpus index family: google (20260719120000) and
-- indian/pqai (20260619170000) already have one, epo-ops did not — which meant
-- any text lane that wanted to read EPO-fetched documents either leaned on the
-- 8.6 GB non-partial local_patents_search_tsv_idx (slated for retirement once
-- the partial indexes prove out) or excluded those rows entirely, as the
-- Whitespace census did.
--
-- The expression MUST stay byte-identical to searchDocumentExpression() in
-- src/lib/patent-search/providers/indian-corpus-provider.ts and to the sibling
-- partial indexes -- same field order, same coalesce, same 'english'::regconfig.
-- If they diverge, Postgres silently stops using this index.
--
-- ON AN EXISTING LARGE DATABASE: build CONCURRENTLY out-of-band FIRST (this is
-- a tiny index -- epo-ops rows number in the thousands -- but the build still
-- scans local_patents, so schedule it like the others; see
-- scripts/google-patents-import/). CREATE INDEX IF NOT EXISTS then makes this
-- migration a no-op. On a fresh/empty database it runs inline instantly.

CREATE INDEX IF NOT EXISTS local_patents_epo_search_tsv_idx
  ON local_patents USING GIN (
    to_tsvector('english'::regconfig,
      coalesce("ragText", '')   || ' ' ||
      coalesce("title", '')     || ' ' ||
      coalesce("abstract", '')  || ' ' ||
      coalesce("abstractOriginal", ''))
  )
  WHERE "corpusSources" @> ARRAY['epo-ops']::TEXT[];
