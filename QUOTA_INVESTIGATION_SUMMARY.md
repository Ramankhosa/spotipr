# Quota Investigation Summary

## Issues Found

### 1. Critical Bug: `getCurrentUsage` Function (FIXED ✅)

**Location**: `src/lib/metering/metering.ts:413-426`

**Problem**: The function was querying `UsageMeter` table using `featureCode` (a string like 'PATENT_DRAFTING') directly as `featureId`, but `featureId` in the database is a UUID that references the `Feature` table.

**Impact**: 
- Usage meters were never found (query always returned 0)
- Quota checks were incorrect because they couldn't read actual usage
- However, the actual usage (105,142) still exceeded the limit (1), so the error was still triggered

**Fix Applied**: 
- Modified `getCurrentUsage` to first look up the `featureId` UUID from the `featureCode` string
- Now properly queries usage meters using the correct UUID

### 2. Null Quota Handling Bug (FIXED ✅)

**Location**: `src/lib/metering/metering.ts:245-271`

**Problem**: The quota check logic didn't properly handle `null` quotas (which should mean unlimited). When `dailyQuota` was `null` or `0`, the check `dailyRemaining > 0` would always fail.

**Impact**: 
- Plans with `null` daily quotas (unlimited) would incorrectly fail quota checks
- BASIC_PLAN has `dailyQuota: 0` which would always fail

**Fix Applied**:
- Changed quota calculation to use `??` (nullish coalescing) instead of `||` to preserve `null` values
- Updated quota check logic to treat `null` remaining as unlimited (always allowed)
- Now properly handles: `null` = unlimited, `0` = no quota allowed, `> 0` = limited quota

### 3. BASIC_PLAN Quota Configuration Issue (NEEDS REVIEW ⚠️)

**Current Configuration**:
- Plan ID: `cmkryww8q000015hn6kkib8va`
- Plan Code: `BASIC_PLAN`
- PATENT_DRAFTING quotas:
  - Monthly: **1** (extremely restrictive!)
  - Daily: **0** (no daily quota)

**Actual Usage**:
- Monthly usage: **105,142** units
- Daily usage: varies (e.g., 6,189 on 2026-01-23)

**Problem**: 
The monthly quota of 1 is way too restrictive for a paid plan ($59/month). Users are hitting this limit immediately.

**Conflicting Configurations Found**:
1. `scripts/seed-payment-plans.ts`: BASIC_PLAN with `monthlyQuota: 1, dailyQuota: null`
2. `scripts/seed-production-plans.js`: FREE_PLAN with `monthlyQuota: 1000, dailyQuota: 100`

**Recommendation**: 
BASIC_PLAN should have quotas similar to or better than FREE_PLAN since it's a paid plan. Suggested values:
- Monthly quota: **1000** (same as FREE_PLAN) or higher
- Daily quota: **100** (same as FREE_PLAN) or `null` (unlimited daily)

## Root Cause Analysis

The user was getting "Quota exceeded" errors because:

1. **Actual usage (105,142) far exceeded the monthly limit (1)** - This is the primary reason
2. **The `getCurrentUsage` bug** meant quota checks couldn't read actual usage correctly, but since usage was so high, it still triggered the error
3. **Daily quota of 0** meant any daily usage would fail the check

## Next Steps

1. ✅ **Fixed**: `getCurrentUsage` bug - now properly looks up featureId
2. ✅ **Fixed**: Null quota handling - now treats null as unlimited
3. ⚠️ **Action Required**: Review and update BASIC_PLAN quotas in the database
   - Current: monthly=1, daily=0
   - Recommended: monthly=1000, daily=100 (or null for unlimited daily)

## How to Update BASIC_PLAN Quotas

You can update the quotas using:

```sql
-- First, find the planFeature ID
SELECT pf.id, p.code, f.code, pf.monthlyQuota, pf.dailyQuota
FROM plan_features pf
JOIN plans p ON pf.planId = p.id
JOIN features f ON pf.featureId = f.id
WHERE p.code = 'BASIC_PLAN' AND f.code = 'PATENT_DRAFTING';

-- Then update (replace <planFeatureId> with actual ID)
UPDATE plan_features
SET monthlyQuota = 1000, dailyQuota = 100
WHERE id = '<planFeatureId>';
```

Or use the admin API endpoint: `PUT /api/v1/admin/plan-quotas`

## Testing

After fixes, verify:
1. Quota checks can read actual usage correctly
2. Plans with null daily quotas work correctly (unlimited daily)
3. BASIC_PLAN users can draft patents within reasonable limits
