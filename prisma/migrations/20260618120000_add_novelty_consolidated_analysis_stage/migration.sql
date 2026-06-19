-- Add the workflow stage used by Deep Analysis consolidated LLM calls.
-- Without this row, Super Admin cannot configure the stage and runtime falls
-- back to the metering default input limit.

INSERT INTO "workflow_stages" (
  "id",
  "code",
  "displayName",
  "featureCode",
  "description",
  "sortOrder",
  "isActive",
  "createdAt",
  "updatedAt"
)
VALUES (
  'workflow_stage_novelty_consolidated_analysis',
  'NOVELTY_CONSOLIDATED_ANALYSIS',
  'Consolidated Deep Analysis',
  'NOVELTY_SEARCH',
  'Map invention features against shortlisted prior art and generate per-patent deep analysis',
  4,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO UPDATE SET
  "displayName" = EXCLUDED."displayName",
  "featureCode" = EXCLUDED."featureCode",
  "description" = EXCLUDED."description",
  "sortOrder" = EXCLUDED."sortOrder",
  "isActive" = true,
  "updatedAt" = CURRENT_TIMESTAMP;

-- Keep all novelty stages visible under the Novelty Search tab in Super Admin.
UPDATE "workflow_stages"
SET "featureCode" = 'NOVELTY_SEARCH',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" LIKE 'NOVELTY_%'
  AND "featureCode" <> 'NOVELTY_SEARCH';

-- Seed per-plan config for the new stage by copying each plan's closest
-- existing novelty config. Prefer Detailed Comparison because it already
-- handles patent-by-patent analysis payloads.
WITH target_stage AS (
  SELECT "id"
  FROM "workflow_stages"
  WHERE "code" = 'NOVELTY_CONSOLIDATED_ANALYSIS'
),
source_configs AS (
  SELECT
    c.*,
    ROW_NUMBER() OVER (
      PARTITION BY c."planId"
      ORDER BY CASE s."code"
        WHEN 'NOVELTY_COMPARISON' THEN 1
        WHEN 'NOVELTY_FEATURE_ANALYSIS' THEN 2
        WHEN 'NOVELTY_REPORT_GENERATION' THEN 3
        ELSE 4
      END
    ) AS rn
  FROM "plan_stage_model_configs" c
  JOIN "workflow_stages" s ON s."id" = c."stageId"
  WHERE s."code" IN (
    'NOVELTY_COMPARISON',
    'NOVELTY_FEATURE_ANALYSIS',
    'NOVELTY_REPORT_GENERATION'
  )
    AND c."isActive" = true
),
chosen_configs AS (
  SELECT *
  FROM source_configs
  WHERE rn = 1
),
missing_configs AS (
  SELECT chosen_configs.*, target_stage."id" AS "targetStageId"
  FROM chosen_configs
  CROSS JOIN target_stage
  LEFT JOIN "plan_stage_model_configs" existing
    ON existing."planId" = chosen_configs."planId"
   AND existing."stageId" = target_stage."id"
  WHERE existing."id" IS NULL
)
INSERT INTO "plan_stage_model_configs" (
  "id",
  "planId",
  "stageId",
  "modelId",
  "fallbackModelIds",
  "maxTokensIn",
  "maxTokensOut",
  "temperature",
  "isActive",
  "priority",
  "createdAt",
  "updatedAt"
)
SELECT
  'psmc_novelty_consolidated_' || md5("planId"),
  "planId",
  "targetStageId",
  "modelId",
  "fallbackModelIds",
  GREATEST(COALESCE("maxTokensIn", 0), 80000),
  COALESCE("maxTokensOut", 16000),
  COALESCE("temperature", 0.7),
  true,
  "priority",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM missing_configs
ON CONFLICT ("planId", "stageId") DO NOTHING;
