-- Public Indian patent corpus API clients, credentials, quotas, and usage logs.

DO $$ BEGIN
  CREATE TYPE "PatentApiClientStatus" AS ENUM ('ACTIVE', 'SUSPENDED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "PatentApiKeyStatus" AS ENUM ('ACTIVE', 'REVOKED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "PatentApiUsagePeriod" AS ENUM ('MINUTE', 'DAY', 'MONTH');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "local_patents"
  ADD COLUMN IF NOT EXISTS "publicationNumberKey" TEXT;

UPDATE "local_patents"
SET "publicationNumberKey" = upper(regexp_replace("publicationNumber", '[^A-Za-z0-9]', '', 'g'))
WHERE "publicationNumberKey" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "local_patents_publicationNumberKey_key"
  ON "local_patents"("publicationNumberKey");

CREATE TABLE IF NOT EXISTS "patent_api_clients" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT,
  "status" "PatentApiClientStatus" NOT NULL DEFAULT 'ACTIVE',
  "rateLimitPerMinute" INTEGER NOT NULL DEFAULT 30,
  "dailyRequestLimit" INTEGER NOT NULL DEFAULT 2000,
  "monthlyRequestLimit" INTEGER NOT NULL DEFAULT 50000,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "patent_api_clients_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "patent_api_keys" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "keyHash" TEXT NOT NULL,
  "keyPrefix" TEXT NOT NULL,
  "keyLastFour" TEXT NOT NULL,
  "status" "PatentApiKeyStatus" NOT NULL DEFAULT 'ACTIVE',
  "expiresAt" TIMESTAMP(3),
  "lastUsedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "patent_api_keys_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "patent_api_usage_buckets" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "periodType" "PatentApiUsagePeriod" NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "requestCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "patent_api_usage_buckets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "patent_api_request_logs" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "apiKeyId" TEXT,
  "requestId" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "statusCode" INTEGER NOT NULL,
  "durationMs" INTEGER NOT NULL,
  "resultCount" INTEGER,
  "queryHash" TEXT,
  "ipAddress" TEXT,
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "patent_api_request_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "patent_api_clients_slug_key" ON "patent_api_clients"("slug");
CREATE INDEX IF NOT EXISTS "patent_api_clients_status_idx" ON "patent_api_clients"("status");
CREATE INDEX IF NOT EXISTS "patent_api_clients_createdAt_idx" ON "patent_api_clients"("createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "patent_api_keys_keyHash_key" ON "patent_api_keys"("keyHash");
CREATE INDEX IF NOT EXISTS "patent_api_keys_clientId_status_idx" ON "patent_api_keys"("clientId", "status");
CREATE INDEX IF NOT EXISTS "patent_api_keys_keyPrefix_idx" ON "patent_api_keys"("keyPrefix");
CREATE UNIQUE INDEX IF NOT EXISTS "patent_api_usage_buckets_clientId_periodType_periodStart_key"
  ON "patent_api_usage_buckets"("clientId", "periodType", "periodStart");
CREATE INDEX IF NOT EXISTS "patent_api_usage_buckets_periodType_periodStart_idx"
  ON "patent_api_usage_buckets"("periodType", "periodStart");
CREATE INDEX IF NOT EXISTS "patent_api_request_logs_clientId_createdAt_idx"
  ON "patent_api_request_logs"("clientId", "createdAt");
CREATE INDEX IF NOT EXISTS "patent_api_request_logs_apiKeyId_createdAt_idx"
  ON "patent_api_request_logs"("apiKeyId", "createdAt");
CREATE INDEX IF NOT EXISTS "patent_api_request_logs_statusCode_createdAt_idx"
  ON "patent_api_request_logs"("statusCode", "createdAt");

DO $$ BEGIN
  ALTER TABLE "patent_api_clients"
    ADD CONSTRAINT "patent_api_clients_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "patent_api_keys"
    ADD CONSTRAINT "patent_api_keys_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "patent_api_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "patent_api_keys"
    ADD CONSTRAINT "patent_api_keys_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "patent_api_usage_buckets"
    ADD CONSTRAINT "patent_api_usage_buckets_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "patent_api_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "patent_api_request_logs"
    ADD CONSTRAINT "patent_api_request_logs_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "patent_api_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "patent_api_request_logs"
    ADD CONSTRAINT "patent_api_request_logs_apiKeyId_fkey"
    FOREIGN KEY ("apiKeyId") REFERENCES "patent_api_keys"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
