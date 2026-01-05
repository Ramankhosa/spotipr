-- AddNoveltySearchFeatureCode
-- This migration adds NOVELTY_SEARCH to the FeatureCode enum
-- NOVELTY_SEARCH is a separate feature from PRIOR_ART_SEARCH with its own quota

-- Add NOVELTY_SEARCH to FeatureCode enum
ALTER TYPE "FeatureCode" ADD VALUE IF NOT EXISTS 'NOVELTY_SEARCH';

