CREATE TABLE "whitespace_worker_health" (
  "id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "details" JSONB,
  CONSTRAINT "whitespace_worker_health_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "whitespace_worker_health_status_heartbeatAt_idx"
  ON "whitespace_worker_health"("status", "heartbeatAt");
