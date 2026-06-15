CREATE TABLE IF NOT EXISTS "ipindia_journal_archive_control" (
  "id" TEXT NOT NULL,
  "downloadsPaused" BOOLEAN NOT NULL DEFAULT false,
  "pausedAt" TIMESTAMP(3),
  "pausedBy" TEXT,
  "resumedAt" TIMESTAMP(3),
  "resumedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ipindia_journal_archive_control_pkey" PRIMARY KEY ("id")
);

INSERT INTO "ipindia_journal_archive_control" ("id")
VALUES ('global')
ON CONFLICT ("id") DO NOTHING;
