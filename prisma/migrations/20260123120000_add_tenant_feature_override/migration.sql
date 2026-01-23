-- CreateTable: TenantFeatureOverride
-- Allows Super Admin to set custom quotas per tenant (for Enterprise customers with negotiated limits)
-- Safe to run multiple times (uses IF NOT EXISTS / DO NOTHING patterns)

-- Create the table if it doesn't exist
CREATE TABLE IF NOT EXISTS "tenant_feature_overrides" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "monthlyQuota" INTEGER,
    "dailyQuota" INTEGER,
    "monthlyTokenLimit" INTEGER,
    "dailyTokenLimit" INTEGER,
    "reason" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "tenant_feature_overrides_pkey" PRIMARY KEY ("id")
);

-- Create unique index if it doesn't exist
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_feature_overrides_tenantId_featureId_key" ON "tenant_feature_overrides"("tenantId", "featureId");

-- Add foreign key constraints (wrapped in DO block to handle if already exists)
DO $$
BEGIN
    -- Add tenant foreign key if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'tenant_feature_overrides_tenantId_fkey'
    ) THEN
        ALTER TABLE "tenant_feature_overrides" 
        ADD CONSTRAINT "tenant_feature_overrides_tenantId_fkey" 
        FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    -- Add feature foreign key if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'tenant_feature_overrides_featureId_fkey'
    ) THEN
        ALTER TABLE "tenant_feature_overrides" 
        ADD CONSTRAINT "tenant_feature_overrides_featureId_fkey" 
        FOREIGN KEY ("featureId") REFERENCES "features"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

