-- Create enums for subscription and payment status
DO $$ BEGIN
    CREATE TYPE "SubscriptionStatus" AS ENUM ('CREATED', 'AUTHENTICATED', 'ACTIVE', 'PENDING', 'HALTED', 'CANCELLED', 'COMPLETED', 'EXPIRED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUNDED', 'PENDING');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create AdminDiscount table (needed by Subscription and Payment)
CREATE TABLE IF NOT EXISTS "admin_discounts" (
    "id" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "discountType" TEXT NOT NULL,
    "discountValue" INTEGER NOT NULL,
    "currency" TEXT,
    "applicablePlans" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "maxUses" INTEGER,
    "maxUsesPerUser" INTEGER NOT NULL DEFAULT 1,
    "currentUses" INTEGER NOT NULL DEFAULT 0,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "restrictedToUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "restrictedToEmails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdByUserId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_discounts_pkey" PRIMARY KEY ("id")
);

-- Create unique index for code
CREATE UNIQUE INDEX IF NOT EXISTS "admin_discounts_code_key" ON "admin_discounts"("code");

-- Create indexes for AdminDiscount
CREATE INDEX IF NOT EXISTS "admin_discounts_code_idx" ON "admin_discounts"("code");
CREATE INDEX IF NOT EXISTS "admin_discounts_isActive_idx" ON "admin_discounts"("isActive");
CREATE INDEX IF NOT EXISTS "admin_discounts_validFrom_validUntil_idx" ON "admin_discounts"("validFrom", "validUntil");

-- Add foreign key for AdminDiscount -> User
DO $$ BEGIN
    ALTER TABLE "admin_discounts" ADD CONSTRAINT "admin_discounts_createdByUserId_fkey" 
        FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create Subscription table
CREATE TABLE IF NOT EXISTS "subscriptions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "razorpaySubscriptionId" TEXT,
    "razorpayPlanId" TEXT,
    "razorpayCustomerId" TEXT,
    "planId" TEXT NOT NULL,
    "planCode" TEXT NOT NULL,
    "billingCycle" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "amount" INTEGER NOT NULL,
    "discountId" TEXT,
    "discountAmount" INTEGER,
    "originalAmount" INTEGER,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'CREATED',
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "nextBillingDate" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- Create unique index for razorpaySubscriptionId
CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_razorpaySubscriptionId_key" ON "subscriptions"("razorpaySubscriptionId");

-- Create indexes for Subscription
CREATE INDEX IF NOT EXISTS "subscriptions_tenantId_idx" ON "subscriptions"("tenantId");
CREATE INDEX IF NOT EXISTS "subscriptions_userId_idx" ON "subscriptions"("userId");
CREATE INDEX IF NOT EXISTS "subscriptions_status_idx" ON "subscriptions"("status");
CREATE INDEX IF NOT EXISTS "subscriptions_razorpaySubscriptionId_idx" ON "subscriptions"("razorpaySubscriptionId");

-- Add foreign keys for Subscription
DO $$ BEGIN
    ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenantId_fkey" 
        FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_userId_fkey" 
        FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_planId_fkey" 
        FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_discountId_fkey" 
        FOREIGN KEY ("discountId") REFERENCES "admin_discounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create Payment table
CREATE TABLE IF NOT EXISTS "payments" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "razorpayOrderId" TEXT,
    "razorpayPaymentId" TEXT,
    "razorpaySignature" TEXT,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "method" TEXT,
    "planId" TEXT NOT NULL,
    "planCode" TEXT NOT NULL,
    "billingCycle" TEXT NOT NULL,
    "discountId" TEXT,
    "discountAmount" INTEGER,
    "receipt" TEXT,
    "description" TEXT,
    "failureCode" TEXT,
    "failureReason" TEXT,
    "paidAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "customerEmail" TEXT,
    "customerPhone" TEXT,
    "customerCountry" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- Create unique indexes for Payment
CREATE UNIQUE INDEX IF NOT EXISTS "payments_razorpayOrderId_key" ON "payments"("razorpayOrderId");
CREATE UNIQUE INDEX IF NOT EXISTS "payments_razorpayPaymentId_key" ON "payments"("razorpayPaymentId");
CREATE UNIQUE INDEX IF NOT EXISTS "payments_receipt_key" ON "payments"("receipt");

-- Create indexes for Payment
CREATE INDEX IF NOT EXISTS "payments_userId_idx" ON "payments"("userId");
CREATE INDEX IF NOT EXISTS "payments_tenantId_idx" ON "payments"("tenantId");
CREATE INDEX IF NOT EXISTS "payments_status_idx" ON "payments"("status");
CREATE INDEX IF NOT EXISTS "payments_razorpayOrderId_idx" ON "payments"("razorpayOrderId");
CREATE INDEX IF NOT EXISTS "payments_razorpayPaymentId_idx" ON "payments"("razorpayPaymentId");

-- Add foreign keys for Payment
DO $$ BEGIN
    ALTER TABLE "payments" ADD CONSTRAINT "payments_subscriptionId_fkey" 
        FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "payments" ADD CONSTRAINT "payments_userId_fkey" 
        FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "payments" ADD CONSTRAINT "payments_tenantId_fkey" 
        FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "payments" ADD CONSTRAINT "payments_planId_fkey" 
        FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "payments" ADD CONSTRAINT "payments_discountId_fkey" 
        FOREIGN KEY ("discountId") REFERENCES "admin_discounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
