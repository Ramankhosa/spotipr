-- Corpus census: how many patents, from which source, with what text quality.
--
--   psql "$DATABASE_URL" -f scripts/epo-bdds-import/corpus-census.sql
--
-- Read-only. Uses the GIN index on corpusSources (@>, never = ANY) and the
-- small epo_ep_fulltext table. A bare predicate on an unindexed local_patents
-- column seq-scans 78 GB — avoided throughout.
--
-- TEXT QUALITY DEFINITIONS
--   claims FULL      : complete claim set (EPO EP full-text)
--   claims PARTIAL   : first independent claim only (Google, US publications)
--   description      : NOTHING in the corpus holds a full description. Google
--                      truncates at 5,000 chars; the EPO import stores 5,000 by
--                      the claims-full+description-5k policy. Rows counted as
--                      "complete" are only those whose whole description
--                      happened to be shorter than 5,000 characters.

\pset pager off
\timing on

\echo ''
\echo '=== 1. TOTAL CORPUS ======================================================'
SELECT count(*) AS total_patents FROM local_patents;

\echo ''
\echo '=== 2. BY SOURCE (a patent can carry more than one tag) =================='
SELECT 'google-patents-corpus' AS source,
       count(*) AS patents FROM local_patents
       WHERE "corpusSources" @> ARRAY['google-patents-corpus']::text[]
UNION ALL
SELECT 'indian-corpus', count(*) FROM local_patents
       WHERE "corpusSources" @> ARRAY['indian-corpus']::text[]
UNION ALL
SELECT 'epo-ep-fulltext (created by EPO import)', count(*) FROM local_patents
       WHERE "corpusSources" @> ARRAY['epo-ep-fulltext']::text[]
UNION ALL
SELECT 'epo-docdb', count(*) FROM local_patents
       WHERE "corpusSources" @> ARRAY['epo-docdb']::text[];

\echo ''
\echo '=== 3. CLAIMS QUALITY ===================================================='
\echo '    FULL    = complete claim set, from EPO EP full-text'
\echo '    PARTIAL = first independent claim only (Google, US) or legacy'
\echo '    NONE    = no claims stored (most of the Google corpus, all Indian)'
SELECT 'FULL (EPO complete claim sets)' AS claims_quality,
       (SELECT count(*) FROM epo_ep_fulltext WHERE "claimsComplete") AS patents
UNION ALL
SELECT 'PARTIAL (first claim only, legacy Google/US)',
       (SELECT count(*) FROM local_patents WHERE "claimsText" IS NOT NULL AND "claimsText" <> '')
       - (SELECT count(*) FROM epo_ep_fulltext WHERE "claimsComplete")
UNION ALL
SELECT 'NONE (no claims text at all)',
       (SELECT count(*) FROM local_patents)
       - (SELECT count(*) FROM local_patents WHERE "claimsText" IS NOT NULL AND "claimsText" <> '');

\echo ''
\echo '=== 4. DESCRIPTION QUALITY =============================================='
\echo '    Nothing in the corpus holds a FULL description — both importers cap'
\echo '    at 5,000 chars. "complete" below means the whole description simply'
\echo '    fitted inside that cap.'
SELECT count(*) FILTER (WHERE "descriptionComplete")        AS epo_naturally_complete,
       count(*) FILTER (WHERE NOT "descriptionComplete"
                          AND "descriptionText" IS NOT NULL) AS epo_truncated_5k,
       count(*) FILTER (WHERE "descriptionText" IS NULL)     AS epo_no_description,
       max("descriptionCharCount")                           AS max_chars_stored
FROM epo_ep_fulltext;

\echo ''
\echo '=== 5. EPO EP FULL-TEXT — the authoritative store ========================'
SELECT count(*)                                   AS ep_publications,
       count(*) FILTER (WHERE "claimsComplete")    AS with_complete_claims,
       count(*) FILTER (WHERE "descriptionText" IS NOT NULL) AS with_description,
       round(avg("claimsCount"), 1)                AS avg_claims_per_patent,
       max("claimsCount")                          AS max_claims,
       min("publicationYear")                      AS earliest_year,
       max("publicationYear")                      AS latest_year
FROM epo_ep_fulltext;

\echo ''
\echo '=== 6. EPO COVERAGE BY YEAR ============================================='
SELECT "publicationYear", count(*) AS publications
FROM epo_ep_fulltext
WHERE "publicationYear" IS NOT NULL
GROUP BY 1 ORDER BY 1 DESC;

\echo ''
\echo '=== 7. WHERE THE EPO TEXT LANDED IN local_patents ======================='
\echo '    filled  = an existing Google/Indian row that had no claims'
\echo '    created = a publication the corpus did not hold at all'
SELECT (SELECT count(DISTINCT "localPatentId") FROM epo_gapfill_audit) AS filled_existing_rows,
       (SELECT count(*) FROM local_patents
         WHERE "corpusSources" @> ARRAY['epo-ep-fulltext']::text[])    AS created_new_rows;

\echo ''
\echo '=== 8. INDIAN CORPUS ===================================================='
\echo '    Indian rows hold title + abstract only; claims/description come from'
\echo '    the separate InPASS + OCR lane, which is not yet built.'
SELECT count(*)                                                  AS indian_patents,
       count(*) FILTER (WHERE "claimsText" IS NOT NULL)          AS with_claims,
       count(*) FILTER (WHERE "descriptionText" IS NOT NULL)     AS with_description,
       count(*) FILTER (WHERE abstract IS NOT NULL AND abstract <> '') AS with_abstract
FROM local_patents
WHERE "corpusSources" @> ARRAY['indian-corpus']::text[];

\echo ''
\echo '=== 9. SUMMARY =========================================================='
SELECT
  (SELECT count(*) FROM local_patents)                                       AS total_patents,
  (SELECT count(*) FROM epo_ep_fulltext WHERE "claimsComplete")              AS full_claims,
  (SELECT count(*) FROM local_patents WHERE "claimsText" IS NOT NULL AND "claimsText" <> '')
    - (SELECT count(*) FROM epo_ep_fulltext WHERE "claimsComplete")          AS partial_claims,
  (SELECT count(*) FROM epo_ep_fulltext WHERE "descriptionText" IS NOT NULL) AS any_description,
  (SELECT count(*) FROM epo_ep_fulltext WHERE "descriptionComplete")         AS complete_description;
