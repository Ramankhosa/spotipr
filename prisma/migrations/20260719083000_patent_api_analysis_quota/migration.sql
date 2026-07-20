-- Separate per-client daily quota for LLM-backed analysis endpoints.
-- Analysis calls are far more expensive than search, so they get their own
-- bucket instead of sharing the generic request quota.
ALTER TYPE "PatentApiUsagePeriod" ADD VALUE IF NOT EXISTS 'ANALYSIS_DAY';

ALTER TABLE "patent_api_clients" ADD COLUMN "dailyAnalysisLimit" INTEGER NOT NULL DEFAULT 200;
