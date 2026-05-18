-- Patent drafting is billed once per tenant + patent.
-- Merge any historical duplicate session rows before enforcing the new key.

WITH canonical AS (
  SELECT DISTINCT ON ("tenantId", "patentId")
    id,
    "tenantId",
    "patentId"
  FROM "patent_drafting_usage"
  ORDER BY
    "tenantId",
    "patentId",
    "isCounted" DESC,
    "countedAt" ASC NULLS LAST,
    "createdAt" ASC
),
merged AS (
  SELECT
    "tenantId",
    "patentId",
    BOOL_OR("hasDescription") AS "hasDescription",
    BOOL_OR("hasClaims") AS "hasClaims",
    BOOL_OR("isCounted") AS "isCounted",
    MIN("countedAt") FILTER (WHERE "isCounted") AS "countedAt",
    MIN("countedMonth") FILTER (WHERE "isCounted") AS "countedMonth"
  FROM "patent_drafting_usage"
  GROUP BY "tenantId", "patentId"
)
UPDATE "patent_drafting_usage" p
SET
  "hasDescription" = m."hasDescription",
  "hasClaims" = m."hasClaims",
  "isCounted" = m."isCounted",
  "countedAt" = CASE WHEN m."isCounted" THEN COALESCE(p."countedAt", m."countedAt") ELSE p."countedAt" END,
  "countedMonth" = CASE WHEN m."isCounted" THEN COALESCE(p."countedMonth", m."countedMonth") ELSE p."countedMonth" END,
  "updatedAt" = NOW()
FROM canonical c
JOIN merged m
  ON m."tenantId" = c."tenantId"
 AND m."patentId" = c."patentId"
WHERE p.id = c.id;

DELETE FROM "patent_drafting_usage" p
USING (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY "tenantId", "patentId"
        ORDER BY "isCounted" DESC, "countedAt" ASC NULLS LAST, "createdAt" ASC
      ) AS rn
    FROM "patent_drafting_usage"
  ) ranked
  WHERE rn > 1
) d
WHERE p.id = d.id;

CREATE UNIQUE INDEX IF NOT EXISTS "patent_drafting_usage_tenantId_patentId_key"
  ON "patent_drafting_usage"("tenantId", "patentId");
