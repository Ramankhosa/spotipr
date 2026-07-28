-- Pause support for the FER reply pipeline.
--
-- The attorney can stop a prepare run between objections (typically to upload a
-- prior-art document the examiner cited), then resume it. The worker polls this
-- flag at each objection boundary and stops cleanly, leaving the draft flagged
-- inProgress so the next run continues instead of restarting.
ALTER TABLE "office_action_jobs" ADD COLUMN IF NOT EXISTS "cancelRequested" BOOLEAN NOT NULL DEFAULT false;
