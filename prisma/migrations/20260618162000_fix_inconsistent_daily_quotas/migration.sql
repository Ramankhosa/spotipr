-- A daily quota of 0 blocks every request for the day. Some admin flows
-- previously converted NULL daily quotas (unlimited) into 0 while leaving a
-- positive monthly quota, which makes the feature unusable for all tenants on
-- that plan. Keep "disabled" rows as 0/0, but restore unlimited daily access
-- for rows that are monthly-limited.
UPDATE "plan_features"
SET "dailyQuota" = NULL
WHERE "dailyQuota" = 0
  AND "monthlyQuota" > 0;
