-- Invention whitespace: a second study kind riding the existing whitespace engine.
--
-- WhitespaceRun.stage is a bare TEXT column, so the new DIMENSION_MAP stage
-- needs no DDL here — only the study-kind flag, the structured invention brief,
-- the live-progress column, and the new task code.

-- AlterEnum
ALTER TYPE "TaskCode" ADD VALUE 'WS_DIMENSIONS';

-- AlterTable
ALTER TABLE "whitespace_studies" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'FIELD';
ALTER TABLE "whitespace_studies" ADD COLUMN "inventionJson" JSONB;

-- AlterTable
ALTER TABLE "whitespace_runs" ADD COLUMN "progress" JSONB;
