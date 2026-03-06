-- Add PENDING_PAYMENT value to TenantStatus enum
-- This is needed for self-service paid signups that are awaiting payment completion
ALTER TYPE "TenantStatus" ADD VALUE IF NOT EXISTS 'PENDING_PAYMENT';
