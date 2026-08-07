-- Filing forms: LLM-assisted inventor extraction from pasted text.
-- Cheap mechanical extraction; the attorney reviews every field before it is saved.
--
-- NOTE FOR DEPLOY: adding an enum value requires `prisma generate` and a restart of
-- patentnest and patentnest-novelty-worker, or policy resolution throws
-- "Value FILING_INVENTOR_PARSE not found in enum TaskCode" at runtime.
ALTER TYPE "TaskCode" ADD VALUE IF NOT EXISTS 'FILING_INVENTOR_PARSE';
