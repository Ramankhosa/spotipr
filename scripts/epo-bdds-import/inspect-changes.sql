-- Inspect what the EPO import actually changed in local_patents.
--
--   psql "$DATABASE_URL" -f scripts/epo-bdds-import/inspect-changes.sql
--
-- Read-only. Every query is driven from a SMALL table (epo_ep_fulltext ~200k,
-- epo_gapfill_audit) or an indexed column, never a bare attribute on the 46M-row
-- local_patents — a predicate like "claimsSource = '...'" has no index and will
-- seq-scan the whole 78 GB heap.

\pset pager off
\timing on

\echo ''
\echo '=== 1. HEADLINE COUNTS ==================================================='
SELECT
  (SELECT count(*) FROM epo_ep_fulltext)                                   AS ep_fulltext_rows,
  (SELECT count(DISTINCT "localPatentId") FROM epo_gapfill_audit)          AS rows_we_filled,
  (SELECT count(*) FROM local_patents
    WHERE "corpusSources" @> ARRAY['epo-ep-fulltext']::text[])             AS rows_we_created;

\echo ''
\echo '=== 2. FILLED — existing corpus rows that GAINED claims =================='
\echo '    (driven from the audit table; local_patents reached by primary key)'
SELECT lp."publicationNumber",
       lp.country,
       lp."claimsSource",
       lp."claimsCompleteness",
       length(lp."claimsText")      AS claims_chars,
       length(lp."descriptionText") AS desc_chars,
       lp."descriptionCompleteness",
       left(lp.title, 55)           AS title
FROM (SELECT DISTINCT "localPatentId" FROM epo_gapfill_audit LIMIT 5) a
JOIN local_patents lp ON lp.id = a."localPatentId";

\echo ''
\echo '=== 3. FILLED — full text of ONE row, to eyeball the actual content ======'
SELECT lp."publicationNumber",
       lp.title,
       left(lp."claimsText", 700)      AS claims_first_700,
       left(lp."descriptionText", 400) AS description_first_400
FROM (SELECT DISTINCT "localPatentId" FROM epo_gapfill_audit LIMIT 1) a
JOIN local_patents lp ON lp.id = a."localPatentId";

\echo ''
\echo '=== 4. CREATED — new rows, A-publications (embedded on title+abstract) ==='
SELECT "publicationNumber", kind, "publicationDate", "embeddingTextSource",
       length(abstract)      AS abstract_chars,
       length("claimsText")  AS claims_chars,
       "classifications"[1:3] AS first_ipc,
       left(title, 45)       AS title
FROM local_patents
WHERE "corpusSources" @> ARRAY['epo-ep-fulltext']::text[]
  AND "embeddingTextSource" = 'title+abstract'
LIMIT 5;

\echo ''
\echo '=== 5. CREATED — granted specs (no abstract, embedded on claim 1) ========'
\echo '    abstract_is_null MUST be true: we embed claim 1, we never fake an abstract'
SELECT "publicationNumber", kind, "publicationDate",
       abstract IS NULL      AS abstract_is_null,
       "embeddingTextSource",
       length("claimsText")  AS claims_chars,
       left("embeddingText", 150) AS embedding_text_start
FROM local_patents
WHERE "corpusSources" @> ARRAY['epo-ep-fulltext']::text[]
  AND "embeddingTextSource" = 'title+first-claim'
LIMIT 5;

\echo ''
\echo '=== 6. SAFETY — nothing should have overwritten pre-existing text ========'
\echo '    Every filled row must show claimsSource = epo-ep-fulltext.'
\echo '    A row we filled that shows any other source would mean we clobbered it.'
SELECT lp."claimsSource", count(*) AS rows
FROM (SELECT DISTINCT "localPatentId" FROM epo_gapfill_audit) a
JOIN local_patents lp ON lp.id = a."localPatentId"
GROUP BY 1;

\echo ''
\echo '=== 7. SAFETY — created rows must never be missing their identity ========'
SELECT count(*) FILTER (WHERE title IS NULL OR title = '')          AS no_title,
       count(*) FILTER (WHERE "embeddingText" IS NULL)              AS no_embedding_text,
       count(*) FILTER (WHERE "publicationNumberKey" IS NULL)       AS no_key,
       count(*) FILTER (WHERE "claimsText" IS NULL)                 AS no_claims,
       count(*)                                                     AS total_created
FROM local_patents
WHERE "corpusSources" @> ARRAY['epo-ep-fulltext']::text[];

\echo ''
\echo '=== 8. SHAPE — created rows by kind and embedding basis =================='
SELECT kind, "embeddingTextSource", count(*) AS rows
FROM local_patents
WHERE "corpusSources" @> ARRAY['epo-ep-fulltext']::text[]
GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 12;

\echo ''
\echo '=== 9. TEXT SIZES — sanity-check the claims-full+description-5k policy ==='
\echo '    max description should be exactly 5000; claims should be uncapped'
SELECT min("claimsCount")            AS min_claims,
       round(avg("claimsCount"), 1)  AS avg_claims,
       max("claimsCount")            AS max_claims,
       round(avg(length("claimsText")))     AS avg_claims_chars,
       max(length("claimsText"))            AS max_claims_chars,
       max("descriptionCharCount")          AS max_desc_chars,
       count(*) FILTER (WHERE "descriptionComplete") AS desc_complete_rows
FROM epo_ep_fulltext;

\echo ''
\echo '=== 10. COVERAGE — which years are in, and how completely ================'
SELECT "publicationYear", status, "loadedDocs", "textPolicy"
FROM epo_ep_coverage ORDER BY "publicationYear" DESC;

\echo ''
\echo '=== 11. PROVENANCE VIEW — how the app now sees text availability ========='
\echo '    joins epo_ep_fulltext (small) to local_patents by unique key'
SELECT v."publicationNumber", v.country, v."claimsAvailability",
       v."descriptionAvailability", v."claimsCount"
FROM (SELECT "publicationNumber" FROM epo_ep_fulltext LIMIT 5) e
JOIN patent_text_availability v ON v."publicationNumber" = e."publicationNumber";

\echo ''
\echo '=== 12. UNTOUCHED PROOF — a random pre-existing row must be unmarked ====='
\echo '    google/indian rows we never wrote to keep all five markers NULL'
SELECT "publicationNumber",
       "claimsSource" IS NULL   AS claims_marker_null,
       "textUpdatedAt" IS NULL  AS never_touched_by_us,
       "corpusSources"
FROM local_patents
WHERE "corpusSources" @> ARRAY['google-patents-corpus']::text[]
  AND NOT ("corpusSources" @> ARRAY['epo-ep-fulltext']::text[])
LIMIT 3;
