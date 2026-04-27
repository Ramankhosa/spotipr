-- ============================================================================
-- Add Gemini Nano Banana Pro to LLM Control
--
-- Runtime sketch generation requests force imageConfig.imageSize = '2K' in
-- src/lib/sketch-service.ts. Do not configure 4K for Sketches (AI Generated).
--
-- Usage:
--   psql -U your_user -d your_database -f scripts/add-gemini-image-models.sql
-- ============================================================================

INSERT INTO llm_models (
  id, code, "displayName", provider,
  "contextWindow", "supportsVision", "supportsStreaming",
  "inputCostPer1M", "outputCostPer1M",
  "isActive", "isDefault",
  "createdAt", "updatedAt"
) VALUES (
  'gemini-3-pro-image-preview-' || substr(gen_random_uuid()::text, 1, 8),
  'gemini-3-pro-image-preview',
  'Gemini 3 Pro Image Preview (Nano Banana Pro)',
  'google',
  128000,
  true,
  false,
  100,
  400,
  true,
  false,
  NOW(),
  NOW()
) ON CONFLICT (code) DO UPDATE SET
  "displayName" = EXCLUDED."displayName",
  provider = EXCLUDED.provider,
  "contextWindow" = EXCLUDED."contextWindow",
  "supportsVision" = EXCLUDED."supportsVision",
  "supportsStreaming" = EXCLUDED."supportsStreaming",
  "inputCostPer1M" = EXCLUDED."inputCostPer1M",
  "outputCostPer1M" = EXCLUDED."outputCostPer1M",
  "isActive" = true,
  "updatedAt" = NOW();

SELECT code, "displayName", provider, "supportsVision", "supportsStreaming", "isActive"
FROM llm_models
WHERE code = 'gemini-3-pro-image-preview';
