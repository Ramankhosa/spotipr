-- AlterEnum
-- PRIVATE ideas are owner-only: confidential pre-filing subject matter saved from a novelty
-- assessment must never appear in the shared Idea Bank listing or be reservable by others.
ALTER TYPE "IdeaBankStatus" ADD VALUE 'PRIVATE';

-- AlterTable
-- Provenance + carried-over intelligence for sessions created from a novelty assessment.
ALTER TABLE "drafting_sessions" ADD COLUMN     "novelty_handoff" JSONB;

-- AlterTable
-- Marker linking a completed assessment to the draft it produced.
ALTER TABLE "novelty_search_runs" ADD COLUMN     "drafting_handoff" JSONB;
