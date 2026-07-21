-- Reset the EP full-text lane so it can be re-imported from scratch.
--
-- Run with:
--   psql "$DATABASE_URL" -f scripts/epo-bdds-import/reset-ep-fulltext.sql
--
-- SAFE BY DESIGN: this only touches EPO-owned data.
--   * epo_ep_fulltext rows sourced from product 32 are deleted
--   * ep-fulltext ledger rows are reset to QUEUED so they will be re-fetched
--   * claims/description that THIS SERVICE wrote into local_patents are reverted
--     to NULL — identified precisely by claimsSource='epo-ep-fulltext', so text
--     from the Google or IPIndia importers is never touched
--   * rows THIS SERVICE created are deleted, identified by corpusSources
--
-- It does NOT touch: title, abstract, embeddingText, or local_patent_embeddings.
-- No existing vector can be invalidated by running this.

\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Before: what are we about to change?
-- ---------------------------------------------------------------------------
\echo '=== BEFORE ==='
SELECT 'epo_ep_fulltext rows'        AS item, count(*)::text AS value FROM epo_ep_fulltext
UNION ALL SELECT 'ledger LOADED (ep-fulltext)', count(*)::text FROM epo_bdds_file
          WHERE lane = 'ep-fulltext' AND status = 'LOADED'
UNION ALL SELECT 'local_patents filled by EPO', count(*)::text FROM local_patents
          WHERE "claimsSource" = 'epo-ep-fulltext'
UNION ALL SELECT 'local_patents created by EPO', count(*)::text FROM local_patents
          WHERE 'epo-ep-fulltext' = ANY("corpusSources")
UNION ALL SELECT 'COMPLETED embeddings (must not change)', count(*)::text
          FROM local_patent_embeddings WHERE status = 'COMPLETED';

-- ---------------------------------------------------------------------------
-- 2. Delete rows this service CREATED.
--    Must run before the revert below, otherwise these rows would be stripped
--    of their text and then left behind as empty shells.
-- ---------------------------------------------------------------------------
DELETE FROM local_patents
WHERE 'epo-ep-fulltext' = ANY("corpusSources");

-- ---------------------------------------------------------------------------
-- 3. Revert claims/description this service FILLED into pre-existing rows.
--    The marker columns make this exact: only rows we stamped are affected.
-- ---------------------------------------------------------------------------
UPDATE local_patents
SET "claimsText"              = CASE WHEN "claimsSource" = 'epo-ep-fulltext' THEN NULL ELSE "claimsText" END,
    "claimsSource"            = CASE WHEN "claimsSource" = 'epo-ep-fulltext' THEN NULL ELSE "claimsSource" END,
    "claimsCompleteness"      = CASE WHEN "claimsSource" = 'epo-ep-fulltext' THEN NULL ELSE "claimsCompleteness" END,
    "descriptionText"         = CASE WHEN "descriptionSource" = 'epo-ep-fulltext' THEN NULL ELSE "descriptionText" END,
    "descriptionSource"       = CASE WHEN "descriptionSource" = 'epo-ep-fulltext' THEN NULL ELSE "descriptionSource" END,
    "descriptionCompleteness" = CASE WHEN "descriptionSource" = 'epo-ep-fulltext' THEN NULL ELSE "descriptionCompleteness" END,
    "textUpdatedAt"           = NULL,
    "embeddingTextSource"     = NULL
WHERE "claimsSource" = 'epo-ep-fulltext' OR "descriptionSource" = 'epo-ep-fulltext';

-- ---------------------------------------------------------------------------
-- 4. Drop the stored EP text and its audit trail.
-- ---------------------------------------------------------------------------
DELETE FROM epo_ep_fulltext;
DELETE FROM epo_ep_coverage;
DELETE FROM epo_gapfill_audit
WHERE "sourceDeliveryId" IN (SELECT "deliveryId" FROM epo_bdds_delivery WHERE lane = 'ep-fulltext');

-- ---------------------------------------------------------------------------
-- 5. Requeue the ledger. Files go back to QUEUED, so the next run re-fetches
--    them; nothing is deleted, so download history is preserved.
-- ---------------------------------------------------------------------------
UPDATE epo_bdds_file
SET status = 'QUEUED', "recordsLoaded" = 0, "completedAt" = NULL,
    "errorMessage" = NULL, "attemptCount" = 0, "updatedAt" = now()
WHERE lane = 'ep-fulltext';

-- ---------------------------------------------------------------------------
-- 6. After: confirm. The embedding count MUST be identical to step 1.
-- ---------------------------------------------------------------------------
\echo '=== AFTER ==='
SELECT 'epo_ep_fulltext rows'        AS item, count(*)::text AS value FROM epo_ep_fulltext
UNION ALL SELECT 'ledger QUEUED (ep-fulltext)', count(*)::text FROM epo_bdds_file
          WHERE lane = 'ep-fulltext' AND status = 'QUEUED'
UNION ALL SELECT 'local_patents filled by EPO', count(*)::text FROM local_patents
          WHERE "claimsSource" = 'epo-ep-fulltext'
UNION ALL SELECT 'local_patents created by EPO', count(*)::text FROM local_patents
          WHERE 'epo-ep-fulltext' = ANY("corpusSources")
UNION ALL SELECT 'COMPLETED embeddings (must not change)', count(*)::text
          FROM local_patent_embeddings WHERE status = 'COMPLETED';

COMMIT;
