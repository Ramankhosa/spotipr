# Claim Stage Quota Investigation

## Problem Statement

User is experiencing "Quota exceeded" errors at the claim stage even though they just started drafting. Previous logs showed 105,142 monthly units used for patent drafting.

## Investigation Findings

### 1. Claim Stage Operations

During the claim stage, the following LLM operations can occur:

#### A. Patent Type Decision (`decidePatentType`)
- **Location**: `src/lib/drafting-service.ts:739`
- **When**: Called during `handleGenerateClaims` if patent type hasn't been decided or components/logic changed
- **LLM Call**: `executeLLMOperation` with `taskCode: 'LLM2_DRAFT'`, `stageCode: 'DRAFT_IDEA_ENTRY'`
- **Output Size**: Small (~10 tokens - just returns patent type: PRODUCT/SYSTEM/PROCESS/COMPOSITION)
- **Usage Increment**: ~10 units

#### B. Claim Generation (`handleGenerateClaims`)
- **Location**: `src/app/api/patents/[patentId]/drafting/route.ts:4349`
- **When**: User clicks "Generate Claims" button
- **LLM Call**: `executeLLMOperation` with `taskCode: 'LLM2_DRAFT'`, `stageCode: 'DRAFT_CLAIM_GENERATION'`
- **Output Size**: Large (typically 1000-3000 tokens for a full claim set)
- **Usage Increment**: 1000-3000 units

#### C. Claim Refinement Preview (`handleClaimRefinementPreview`)
- **Location**: `src/app/api/patents/[patentId]/drafting/route.ts:5090`
- **When**: User requests claim refinement preview (optional stage)
- **LLM Call**: `executeLLMOperation` with `taskCode: 'LLM1_CLAIM_REFINEMENT'`, `stageCode: 'DRAFT_CLAIM_REFINEMENT'`
- **Output Size**: Large (similar to claim generation, 1000-3000 tokens)
- **Usage Increment**: 1000-3000 units

#### D. Add Component Numbers (`handleAddComponentNumbersToClaims`)
- **Location**: `src/app/api/patents/[patentId]/drafting/route.ts:5261`
- **When**: User adds reference numerals to claims (optional)
- **LLM Call**: `executeLLMOperation` with `taskCode: 'LLM2_DRAFT'`, `stageCode: 'DRAFT_CLAIM_GENERATION'`
- **Output Size**: Medium (~500-1000 tokens)
- **Usage Increment**: 500-1000 units

### 2. Usage Metering Logic

#### How Usage is Incremented

**Location**: `src/lib/metering/metering.ts:351-415`

```typescript
async updateUsageMeters(reservation: any, stats: UsageStats): Promise<void> {
  // Update monthly meter
  currentUsage: {
    increment: stats.outputTokens || stats.apiCalls || 1
  }
  // Update daily meter  
  currentUsage: {
    increment: stats.outputTokens || stats.apiCalls || 1
  }
}
```

**Key Finding**: Usage is incremented by `outputTokens` directly. This means:
- If a claim generation returns 2000 tokens → usage increases by 2000 units
- If a patent type decision returns 10 tokens → usage increases by 10 units
- If `outputTokens` is 0 or falsy → falls back to `apiCalls` (typically 1)

#### Usage Recording Flow

1. **LLM Operation Called** → `llmGateway.executeLLMOperation()`
2. **Reservation Created** → Policy service creates reservation
3. **LLM Provider Executes** → Returns response with `outputTokens`
4. **Usage Recorded** → `metering.recordUsage()` called once per operation
5. **Meters Updated** → `updateUsageMeters()` increments both daily and monthly meters

**No Double-Counting**: Each LLM operation calls `recordUsage` exactly once. Verified by checking all call sites.

### 3. Quota Configuration

#### Current Quota Values (from seed scripts)

**FREE_PLAN**:
- Monthly: 1000 units
- Daily: 100 units

**PRO_PLAN**:
- Monthly: 10,000 units  
- Daily: 1,000 units

**ENTERPRISE_PLAN**:
- Monthly: 50,000 units
- Daily: 5,000 units

**BASIC_PLAN** (from `seed-payment-plans.ts`):
- Monthly: 1 unit ⚠️ **EXTREMELY RESTRICTIVE**
- Daily: null (unlimited)

#### Quota Units Interpretation

The quotas appear to be **token-based** (not operation-based) because:
1. Increment logic uses `outputTokens` directly
2. Quota values are in thousands (1000, 10000, 50000)
3. Seed scripts mention "tokens" in comments (e.g., `adminplans-seed.js:49`)

### 4. Root Cause Analysis

#### Scenario: User at Claim Stage

**Typical Operations During Claim Stage**:
1. Patent type decision: ~10 tokens → +10 units
2. Claim generation: ~2000 tokens → +2000 units
3. Claim refinement preview (if used): ~2000 tokens → +2000 units
4. Add component numbers (if used): ~500 tokens → +500 units

**Total for Complete Claim Stage**: ~4,510 units

#### Why User Hit Quota

**If User Has BASIC_PLAN** (monthly quota: 1):
- Even a single patent type decision (10 tokens) exceeds the quota
- This is clearly a configuration error

**If User Has FREE_PLAN** (monthly quota: 1000):
- A single claim generation (~2000 tokens) exceeds the monthly quota
- User would need to stay under 1000 tokens/month total

**If User Has 105,142 Monthly Units Used**:
- This suggests they've made many LLM operations
- At ~2000 tokens per claim generation, that's ~52 claim generations
- Or they've been drafting multiple patents with all stages

### 5. Potential Issues

#### Issue 1: Quota Units Mismatch

**Problem**: If quotas are meant to be "operations" (not tokens), then incrementing by `outputTokens` is incorrect.

**Example**:
- Quota: 1000 operations/month
- Claim generation returns 2000 tokens
- Current behavior: Increments by 2000 (counts as 2000 operations)
- Expected behavior: Increment by 1 (counts as 1 operation)

**Evidence**: The `PatentDraftingUsage` table tracks completions separately, suggesting there might be two quota systems:
- Token-based quotas (UsageMeter) - for cost control
- Completion-based quotas (PatentDraftingUsage) - for feature limits

#### Issue 2: BASIC_PLAN Quota Too Low

**Problem**: BASIC_PLAN has `monthlyQuota: 1`, which is unusable.

**Impact**: Even a single small LLM operation exceeds the quota.

**Recommendation**: Should match FREE_PLAN at minimum (1000 monthly, 100 daily).

#### Issue 3: Multiple LLM Calls Per User Action

**Problem**: A single user action (e.g., "Generate Claims") can trigger multiple LLM calls:
- Patent type decision (if needed)
- Claim generation

**Impact**: User sees quota exceeded even though they only clicked one button.

**Mitigation**: Consider caching patent type decisions or combining operations.

### 6. Recommendations

#### Immediate Actions

1. **Check User's Plan**: Verify which plan the user has and what their quotas are
2. **Check Actual Usage**: Query `UsageMeter` table to see current usage vs quota
3. **Fix BASIC_PLAN**: Update BASIC_PLAN quotas to reasonable values (1000+ monthly)

#### Code Changes

1. **Clarify Quota Units**: 
   - Document whether quotas are token-based or operation-based
   - If operation-based, change increment logic to always use `apiCalls` (1) instead of `outputTokens`

2. **Add Usage Logging**:
   - Log quota check results before operations
   - Log usage increments with context (operation type, tokens, quota remaining)

3. **Optimize Claim Stage**:
   - Cache patent type decisions to avoid redundant LLM calls
   - Consider combining operations where possible

#### Database Queries for Investigation

```sql
-- Check user's current plan and quotas
SELECT 
  u.id as userId,
  u.email,
  tp.planId,
  p.code as planCode,
  p.name as planName,
  pf.monthlyQuota,
  pf.dailyQuota,
  f.code as featureCode
FROM users u
JOIN tenant_plans tp ON u.tenantId = tp.tenantId AND tp.status = 'ACTIVE'
JOIN plans p ON tp.planId = p.id
JOIN plan_features pf ON p.id = pf.planId
JOIN features f ON pf.featureId = f.id
WHERE f.code = 'PATENT_DRAFTING'
AND u.email = '<user_email>';

-- Check current usage
SELECT 
  um.periodType,
  um.periodKey,
  um.currentUsage,
  f.code as featureCode,
  um.taskCode
FROM usage_meters um
JOIN features f ON um.featureId = f.id
JOIN users u ON um.tenantId = u.tenantId
WHERE f.code = 'PATENT_DRAFTING'
AND u.email = '<user_email>'
ORDER BY um.periodKey DESC, um.periodType;

-- Check recent LLM operations
SELECT 
  ul.createdAt,
  ul.inputTokens,
  ul.outputTokens,
  ul.taskCode,
  ul.meta->>'purpose' as purpose,
  ul.meta->>'stageCode' as stageCode
FROM usage_logs ul
JOIN users u ON ul.userId = u.id
WHERE u.email = '<user_email>'
AND ul.taskCode LIKE 'LLM%'
ORDER BY ul.createdAt DESC
LIMIT 50;
```

### 7. Conclusion

The quota exceeded error is likely legitimate if:
- User has BASIC_PLAN (quota: 1) - configuration error
- User has FREE_PLAN (quota: 1000) and made multiple claim generations
- User has accumulated 105,142 units from previous operations

The system is correctly counting usage, but:
1. BASIC_PLAN quotas are misconfigured (too low)
2. Quota units may be misunderstood (tokens vs operations)
3. Multiple LLM calls per user action can quickly consume quota

**Next Steps**: 
1. Query database to verify user's plan and current usage
2. Fix BASIC_PLAN quotas if applicable
3. Consider whether quotas should be operation-based instead of token-based
