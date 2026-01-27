-- CreateEnum
CREATE TYPE "RegistrationSource" AS ENUM ('MANUAL_ATI', 'PAID_SIGNUP', 'TRIAL');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN "registrationSource" "RegistrationSource" NOT NULL DEFAULT 'MANUAL_ATI';
ALTER TABLE "tenants" ADD COLUMN "selectedPlanCode" TEXT;
ALTER TABLE "tenants" ADD COLUMN "selectedBillingCycle" TEXT;
