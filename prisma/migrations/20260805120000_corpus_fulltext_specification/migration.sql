-- ---------------------------------------------------------------------------
-- Full-text GIN over the SPECIFICATION: claims + description.
--
-- Why this exists
-- ---------------
-- Until now the keyword lane read only `ragText + title + abstract +
-- abstractOriginal` -- roughly 150 words per document. `claimsText` and
-- `descriptionText` were stored but never searchable, and the only code path
-- that touched them was an unindexable ILIKE.
--
-- For prior-art work that is the biggest recall ceiling in the product: the
-- teaching that anticipates a claim is very often in the description and is
-- mentioned nowhere in the abstract. A search that never reads the
-- specification cannot find it, and reports a confident "nothing found".
--
-- Rules this index lives by
-- -------------------------
-- 1. The expression MUST stay byte-identical to specificationDocumentExpression()
--    in src/lib/patent-search/providers/indian-corpus-provider.ts -- same field
--    order, same coalesce, same 'english'::regconfig. If they diverge, Postgres
--    silently stops using the index and the lane becomes a sequential scan of
--    45M rows that dies at the statement timeout.
--
-- 2. PARTIAL, on rows that actually carry text. Most of the worldwide corpus has
--    no stored specification (see the patent_text_availability view from
--    20260721120000), so a full index would be mostly empty entries over tens of
--    millions of rows. The query repeats the same predicate so the planner can
--    prove the match.
--
-- Build notes
-- -----------
-- This detoasts claims and description for every qualifying row, so it is slow
-- and large -- expect it to be the biggest index on the table. Prisma cannot run
-- CREATE INDEX CONCURRENTLY inside its migration transaction, so on a live
-- database with substantial stored text, run the CONCURRENTLY form below out of
-- band FIRST and let this migration's IF NOT EXISTS become a no-op:
--
--   SET maintenance_work_mem = '2GB';
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS local_patents_specification_tsv_idx
--     ON "local_patents" USING gin (to_tsvector(
--       'english'::regconfig,
--       coalesce("claimsText", '') || ' ' ||
--       coalesce("descriptionText", '')
--     ))
--     WHERE "claimsText" IS NOT NULL OR "descriptionText" IS NOT NULL;
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS local_patents_specification_tsv_idx
  ON "local_patents" USING gin (to_tsvector(
    'english'::regconfig,
    coalesce("claimsText", '') || ' ' ||
    coalesce("descriptionText", '')
  ))
  WHERE "claimsText" IS NOT NULL OR "descriptionText" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Supporting btree for the country filter.
--
-- buildCountryCondition() compares upper(coalesce("country", '')), which no
-- index covered -- so every jurisdiction-filtered lane degraded to a sequential
-- scan and surfaced to the attorney as a timed-out lane rather than a slow
-- filter. Expression index so the planner can match the predicate as written.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS local_patents_country_upper_idx
  ON "local_patents" (upper(coalesce("country", '')));
