-- Prior-Art Studio: enforce one live run per session at the database boundary.
-- Keep the newest pre-existing RUNNING row and fail older duplicates before
-- creating the partial unique index.

WITH ranked AS (
  SELECT "id",
         row_number() OVER (PARTITION BY "sessionId" ORDER BY "createdAt" DESC, "id" DESC) AS rn
  FROM "prior_art_studio_runs"
  WHERE "status" = 'RUNNING'
)
UPDATE "prior_art_studio_runs" AS run
SET "status" = 'FAILED',
    "error" = COALESCE(run."error", 'Superseded while enforcing the single-running-search invariant.'),
    "completedAt" = COALESCE(run."completedAt", CURRENT_TIMESTAMP)
FROM ranked
WHERE run."id" = ranked."id"
  AND ranked.rn > 1;

CREATE UNIQUE INDEX "prior_art_studio_runs_one_running_per_session_idx"
ON "prior_art_studio_runs" ("sessionId")
WHERE "status" = 'RUNNING';
