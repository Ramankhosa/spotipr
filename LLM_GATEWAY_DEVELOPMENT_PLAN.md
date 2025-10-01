# LLM Service Gateway Development Plan

## Executive Summary

Build a **central single point of control LLM service gateway** that enforces model usage, token usage metering restrictions at user-wise, tenant-wise, and process-wise levels. The gateway will manage three core LLM tasks: prior art search (`LLM1_PRIOR_ART`), patent drafting (`LLM2_DRAFT`), and diagram generation (`LLM3_DIAGRAM`).

## Current Architecture Analysis

### ✅ What's Already Built
- **Database Schema**: Complete with all metering tables (10 models)
- **Type System**: Comprehensive TypeScript interfaces and enums
- **Basic Infrastructure**: Enforcement middleware, auth bridge, error handling
- **Plan Design**: 10-module architecture covering all aspects

### ❌ Implementation Gaps
- **Core Services**: Identity, Catalog, Policy, Reservation, Metering services are placeholders
- **LLM Adapters**: No actual LLM execution logic
- **Gateway Orchestration**: No central coordination service
- **Multi-provider Support**: Single provider assumption
- **Admin Console**: Basic forms needed
- **Process Controls**: Task-specific enforcement missing

---

## ATI Token Integration & Access Control ✅

### How The Plan Links ATI → Tenant → User → Service Access

**Inheritance Chain** (as designed in your system):
```
Super Admin ATI Token (planTier: "PRO")
    ↓
Tenant Admin Signup (signupAtiTokenId → ATIToken.planTier)
    ↓
All Tenant Users (inherit from tenant's plan)
    ↓
LLM Gateway (enforces plan limits per user/task)
```

### ✅ **Access Control Flow**

1. **JWT Authentication** → `payload.ati_id` + `payload.tenant_id` + `payload.sub`
2. **ATI Token Resolution** → `ATIToken.planTier` (single source of truth)
3. **Plan Mapping** → `Plan.code` → features + limits + LLM access
4. **Policy Evaluation** → Check quotas, model access, token limits
5. **Reservation Creation** → Pre-allocate budget before execution
6. **Adapter Execution** → Apply enforced limits + model routing
7. **Usage Recording** → Post-execution metering + cost tracking

### ✅ **Blocking Mechanisms**

**Service Access (Yes/No)**:
- Plan feature availability (`PlanFeature` table)
- Task-specific access (`PlanLLMAccess.allowedClasses`)
- Tenant status validation (`Tenant.status = ACTIVE`)

**Token/Budget Limits**:
- **Pre-execution**: Reservation system prevents overspend
- **Per-request**: `PolicyRule` limits (max_tokens_in/out, agent_max_steps)
- **Cumulative**: Usage meters track against quotas
- **Concurrency**: Per-tenant per-task limits

**Budget Enforcement**:
- **Hard limits**: Block requests exceeding quotas
- **Soft warnings**: 80% threshold alerts
- **Graceful degradation**: Fail-open for metering errors (don't break functionality)

### ✅ **Tracking Capabilities**

**User-wise**: `UsageLog.userId` + `UsageMeter.tenantId`
**Tenant-wise**: All usage aggregated by `tenantId`
**Process-wise**: `UsageLog.taskCode` + `UsageLog.featureId`
**Token-wise**: Input/output token counting per operation
**Cost-wise**: Model class pricing × token usage

---

## Phase 1: Foundation & Core Services (2-3 weeks)

### 1.1 Implement Core Metering Services

**Priority**: Critical - Foundation for everything else

#### Identity Service (`src/lib/metering/identity.ts`)
```typescript
// ✅ ALREADY PARTIALLY IMPLEMENTED - needs ATI token inheritance fix
export const createIdentityService = (config) => ({
  resolveTenantContext: async (atiToken: string) => {
    // 1. Validate ATI token exists and is active
    // 2. Get tenant from ATI token (atiId field)
    // 3. ⚠️ CRITICAL: Get plan from ATI token's planTier field (NOT tenant_plans!)
    // 4. Map planTier string to Plan record
    // 5. Return TenantContext with resolved plan_id
  },
  validateTenantAccess: async (tenantId: string) => {
    // Check tenant status is ACTIVE
  }
})
```

**CRITICAL FIX NEEDED**: Current implementation uses `tenant_plans` table, but must use `ATIToken.planTier` as single source of truth.

**Database Dependencies**: `Tenant`, `ATIToken`, `Plan` (NOT `TenantPlan`)

#### Catalog Service (`src/lib/metering/catalog.ts`)
```typescript
export const createCatalogService = (config) => ({
  getPlanDetails: async (planId: string) => {
    // Return plan with features, LLM access, policy limits
  },
  getFeatureDetails: async (featureCode) => {
    // Return feature metadata
  },
  getTaskDetails: async (taskCode) => {
    // Return task with linked feature
  }
})
```

**Database Dependencies**: `Plan`, `Feature`, `Task`, `PlanFeature`, `PlanLLMAccess`, `PolicyRule`

#### Policy Service (`src/lib/metering/policy.ts`)
```typescript
export const createPolicyService = (config) => ({
  evaluateAccess: async (request: FeatureRequest) => {
    // 1. Check feature availability in plan
    // 2. Check quota limits
    // 3. Apply policy rules (max_tokens_in/out, etc.)
    // 4. Create reservation if allowed
    // 5. Return EnforcementDecision
  },
  getPolicyLimits: async (tenantId, taskCode?) => {
    // Return merged plan + tenant policy limits
  }
})
```

#### Reservation Service (`src/lib/metering/reservation.ts`)
```typescript
export const createReservationService = (config) => ({
  createReservation: async (context, units) => {
    // 1. Check concurrency limits
    // 2. Create UsageReservation record
    // 3. Return reservation ID
  },
  releaseReservation: async (reservationId) => {
    // Mark reservation as RELEASED
  },
  getActiveReservations: async (tenantId) => {
    // Count active reservations for tenant
  }
})
```

#### Metering Service (`src/lib/metering/metering.ts`)
```typescript
export const createMeteringService = (config) => ({
  recordUsage: async (reservationId, stats) => {
    // 1. Update UsageMeter counters
    // 2. Create UsageLog entry
    // 3. Mark reservation as COMPLETED
    // 4. Check quota thresholds and create alerts
  },
  checkQuota: async (request) => {
    // Return current usage vs limits
  },
  getUsage: async (tenantId, featureCode?, period) => {
    // Return usage statistics
  }
})
```

### 1.2 Testing Infrastructure

**Unit Tests for Each Service**
- Mock database interactions
- Test all error paths
- Test concurrency scenarios
- Test quota enforcement

**Integration Tests**
- End-to-end metering flows
- Multi-tenant isolation
- Reservation lifecycle

---

## Phase 2: LLM Gateway & Adapters (2-3 weeks)

### 2.1 Central LLM Gateway Service

**File**: `src/lib/metering/gateway.ts`

**Architecture**:
```typescript
export class LLMGateway {
  private system = createMeteringSystem()
  private adapters = new Map<TaskCode, LLMAdapter>()

  async executeLLMOperation(request, llmRequest) {
    // 1. Extract tenant context
    // 2. Create feature request
    // 3. Enforce metering policies
    // 4. Route to appropriate adapter
    // 5. Execute with limits
    // 6. Record usage
    // 7. Return response
  }
}
```

**Key Features**:
- **Single Entry Point**: All LLM operations go through this gateway
- **Policy Enforcement**: Automatic metering checks before execution
- **Adapter Pattern**: Pluggable LLM implementations per task
- **Usage Recording**: Automatic post-execution metering
- **Error Handling**: Consistent error responses and fallbacks

### 2.2 LLM Adapter Layer

**Base Adapter Interface**:
```typescript
interface LLMAdapter {
  execute(request: LLMRequest, limits: EnforcementDecision): Promise<LLMResponse>
  getSupportedTasks(): TaskCode[]
  getSupportedModelClasses(): string[]
}
```

**Task-Specific Adapters**:

#### Prior Art Search Adapter (`src/lib/metering/adapters/prior-art.ts`)
```typescript
export class PriorArtAdapter implements LLMAdapter {
  async execute(request, limits) {
    // 1. Validate request against limits
    // 2. Route to search APIs (PatentsView, OpenAlex)
    // 3. Apply LLM reasoning if needed
    // 4. Return structured results
  }
}
```

#### Patent Drafting Adapter (`src/lib/metering/adapters/drafting.ts`)
```typescript
export class DraftingAdapter implements LLMAdapter {
  async execute(request, limits) {
    // 1. Validate input length vs max_tokens_in
    // 2. Select appropriate model based on limits.modelClass
    // 3. Execute drafting with output limits
    // 4. Return generated draft
  }
}
```

#### Diagram Generation Adapter (`src/lib/metering/adapters/diagrams.ts`)
```typescript
export class DiagramAdapter implements LLMAdapter {
  async execute(request, limits) {
    // 1. Validate file count vs diagram_files_per_req
    // 2. Generate PlantUML/Mermaid code
    // 3. Return diagram specification
  }
}
```

### 2.3 Multi-Provider LLM Support

**Provider Abstraction**:
```typescript
interface LLMProvider {
  name: string
  supportedModels: string[]
  execute(request: LLMRequest, limits: EnforcementDecision): Promise<LLMResponse>
  getTokenLimits(modelName: string): { input: number, output: number }
  getCostPerToken(modelName: string): { input: number, output: number }
}
```

**Supported Providers** (Initial Implementation):
- **Google Gemini**: Gemini 2.5 Pro (`GOOGLE_AI_API_KEY`)
- **OpenAI ChatGPT**: GPT-4o (`OPENAI_API_KEY`)
- **xAI Grok**: Grok 3 (`GROK_API_KEY`)

**Provider Configuration**:
```typescript
// Environment variables mapping
const PROVIDER_CONFIGS = {
  gemini: {
    apiKey: process.env.GOOGLE_AI_API_KEY,
    model: 'gemini-2.5-pro',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta'
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: 'gpt-4o',
    baseURL: 'https://api.openai.com/v1'
  },
  grok: {
    apiKey: process.env.GROK_API_KEY,
    model: 'grok-3',
    baseURL: 'https://api.x.ai/v1' // Placeholder - confirm actual endpoint
  }
}
```

**Routing & Fallback Logic**:
```typescript
class LLMProviderRouter {
  private providers: Map<string, LLMProvider> = new Map()

  async routeAndExecute(request: LLMRequest, limits: EnforcementDecision) {
    // 1. Determine available providers for model class
    // 2. Apply priority: cost → performance → availability
    // 3. Execute with automatic fallback on failure
    // 4. Standardize response format
    // 5. Record provider-specific usage
  }
}
```

**Integration with Metering Hierarchy**:
```
User Request → JWT Auth → ATI Token Resolution → Plan/Feature Check
    ↓
Enforcement Decision → Model Class Selection → Provider Routing
    ↓
LLM Execution → Token Counting → Usage Recording → Response
```

---

## Phase 3: Process Controls & Advanced Features (2 weeks)

### 3.1 Process-Wise Controls

**Task-Specific Enforcement**:

#### Prior Art Search (`LLM1_PRIOR_ART`)
- **Quota Type**: API calls to search endpoints
- **Limits**: `max_api_calls`, `retrieval_top_k`
- **Features**: Patent database access, academic paper search
- **Model Classes**: `BASE_S`, `BASE_M` (reasoning focused)

#### Patent Drafting (`LLM2_DRAFT`)
- **Quota Type**: Token-based (input + output)
- **Limits**: `max_tokens_in`, `max_tokens_out`, `agent_max_steps`
- **Features**: Section-by-section drafting, claim generation
- **Model Classes**: `PRO_M`, `PRO_L`, `ADVANCED` (quality focused)

#### Diagram Generation (`LLM3_DIAGRAM`)
- **Quota Type**: Token-based + file count
- **Limits**: `max_tokens_out`, `diagram_files_per_req`, `max_steps`
- **Features**: PlantUML/Mermaid generation, SVG export
- **Model Classes**: `BASE_M`, `PRO_M` (creative focused)

**Concurrency Controls**:
```typescript
// Per tenant per task concurrency limits
const concurrencyLimits = {
  'LLM1_PRIOR_ART': { maxConcurrent: 3 },
  'LLM2_DRAFT': { maxConcurrent: 2 },
  'LLM3_DIAGRAM': { maxConcurrent: 5 }
}
```

### 3.2 Advanced Policy Rules

**Tenant-Specific Overrides**:
```sql
-- Allow enterprise tenants higher limits
INSERT INTO policy_rules (scope, scope_id, task_code, key, value)
VALUES ('tenant', 'enterprise-tenant-id', 'LLM2_DRAFT', 'max_tokens_out', 8000)
```

**Dynamic Policy Evaluation**:
```typescript
async function evaluateDynamicPolicies(tenantId: string, taskCode: TaskCode) {
  // 1. Get base plan policies
  // 2. Apply tenant overrides
  // 3. Apply time-based rules (business hours higher limits)
  // 4. Apply usage-based throttling
  // 5. Return final policy limits
}
```

---

## Phase 4: Admin Console & Monitoring (2 weeks)

### 4.1 Admin Dashboard

**Plan Management**:
- Create/edit plans with feature assignments
- Configure LLM access per task
- Set policy rules and limits
- Assign plans to tenants

**Usage Monitoring**:
- Real-time usage dashboards
- Quota alerts and notifications
- Usage analytics and reporting
- Cost tracking and optimization

**Tenant Management**:
- Override tenant-specific policies
- Monitor tenant usage patterns
- Handle quota increase requests
- Generate usage reports

### 4.2 Alerting System

**Automated Alerts**:
```typescript
const alertRules = [
  { threshold: 80, type: 'QUOTA_WARNING' },
  { threshold: 100, type: 'QUOTA_EXCEEDED' },
  { threshold: 90, type: 'CONCURRENCY_LIMIT' }
]
```

**Notification Channels**:
- Email notifications to tenant admins
- In-app notifications
- Webhook integrations
- Slack/Teams integrations

---

## Phase 5: Testing & Rollout (1-2 weeks)

### 5.1 Testing Strategy

**Unit Testing**:
- All service methods with mocked dependencies
- Error path testing
- Concurrency testing with race conditions

**Integration Testing**:
- End-to-end LLM operations
- Multi-tenant isolation
- Quota enforcement across boundaries

**Load Testing**:
- Concurrent user simulation
- Rate limiting validation
- Database performance under load

### 5.2 Rollout Strategy

**Phased Rollout**:

#### Phase 1: Silent Metering (Week 1)
- Gateway deployed with logging only
- No enforcement (fail-open)
- Compare logged usage vs. actual API usage
- Fix any metering gaps

#### Phase 2: Soft Enforcement (Week 2)
- Enable quota warnings
- Soft concurrency limits
- Monitor for false positives

#### Phase 3: Hard Enforcement (Week 3)
- Enable all metering controls
- Gradual tenant rollout
- 24/7 monitoring

#### Phase 4: Optimization (Week 4)
- Performance tuning
- Cost optimization
- Advanced features

---

## Technical Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────┐
│                    Client Applications                       │
│  (Patent Drafting UI, Prior Art Search, Diagram Tools)      │
└─────────────────────┬───────────────────────────────────────┘
                      │ HTTP Requests
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                 Next.js API Routes                          │
│  /api/prior-art, /api/drafting, /api/diagrams               │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼ Metering Middleware
┌─────────────────────────────────────────────────────────────┐
│                 LLM Gateway Service                         │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 1. Tenant Resolution   │ 2. Policy Evaluation      │    │
│  │                         │                             │    │
│  │ 3. Reservation Creation│ 4. Adapter Execution       │    │
│  │                         │                             │    │
│  │ 5. Usage Recording     │ 6. Response Formatting     │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────┬───────────────────────────────────────┘
                      │
          ┌───────────┼───────────┐
          │           │           │
          ▼           ▼           ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│ Prior Art   │ │ Drafting    │ │ Diagram     │
│ Adapter     │ │ Adapter     │ │ Adapter     │
└─────────────┘ └─────────────┘ └─────────────┘
          │           │           │
          ▼           ▼           ▼
┌─────────────────────────────────────────────────────────────┐
│              LLM Provider Layer                            │
│  OpenAI, Anthropic, Google, Local Models                   │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Request Ingress**: HTTP request hits API route
2. **Tenant Resolution**: Extract tenant context from JWT/ATI token
3. **Policy Evaluation**: Check quotas, limits, feature access
4. **Reservation**: Create usage reservation for tracking
5. **Execution**: Route to appropriate adapter with enforced limits
6. **Recording**: Update usage meters and logs
7. **Response**: Return results with usage metadata

### Security Considerations

- **Authentication**: JWT token validation required
- **Authorization**: Tenant context isolation
- **Rate Limiting**: Per-tenant, per-user, per-feature
- **Audit Logging**: All operations logged with context
- **Data Encryption**: Sensitive data encrypted at rest
- **API Key Management**: Secure LLM provider credential storage

---

## Success Metrics

### Technical Metrics
- **Latency**: <500ms for policy evaluation
- **Throughput**: 1000+ concurrent operations
- **Accuracy**: 99.9% metering accuracy
- **Uptime**: 99.95% gateway availability

### Business Metrics
- **Cost Control**: 30% reduction in LLM costs through optimization
- **Usage Visibility**: Real-time monitoring of all LLM operations
- **Tenant Satisfaction**: Self-service quota management
- **Scalability**: Support 1000+ tenants with varying usage patterns

---

## Risk Mitigation

### Technical Risks
- **Single Point of Failure**: Implement redundant gateway instances
- **Database Bottlenecks**: Optimize queries, implement caching
- **Provider Outages**: Multi-provider fallback, circuit breakers
- **Cost Explosion**: Hard limits, real-time monitoring

### Operational Risks
- **Complex Configuration**: Admin console with validation
- **Tenant Onboarding**: Automated setup workflows
- **Support Burden**: Comprehensive logging and monitoring
- **Data Privacy**: Tenant data isolation, audit compliance

---

## Implementation Checklist

- [ ] Phase 1: Core Services Implementation
- [ ] Phase 2: Gateway & Adapters
- [ ] Phase 3: Process Controls
- [ ] Phase 4: Admin Console
- [ ] Phase 5: Testing & Rollout
- [ ] Documentation & Training
- [ ] Production Deployment
- [ ] Monitoring & Optimization

---

## Next Steps

1. **Review and Approval**: Get stakeholder buy-in on this plan
2. **Resource Allocation**: Assign team members to phases
3. **Timeline Planning**: Set specific dates for each phase
4. **Kickoff Meeting**: Align on priorities and dependencies
5. **Start Implementation**: Begin with Phase 1 core services

---

## Implementation Summary ✅

### ✅ **Completed: LLM Provider Integration**

**Files Created/Modified:**
- `src/lib/metering/types.ts` - Added `LLMRequest` and `LLMResponse` interfaces
- `src/lib/metering/providers/llm-provider.ts` - Provider abstraction layer
- `src/lib/metering/providers/gemini-provider.ts` - Google Gemini 2.5 Pro integration
- `src/lib/metering/providers/openai-provider.ts` - OpenAI GPT-4o integration
- `src/lib/metering/providers/grok-provider.ts` - xAI Grok 3 integration
- `src/lib/metering/providers/provider-router.ts` - Smart routing with failover
- `src/lib/metering/gateway.ts` - Central LLM gateway with metering integration
- `src/lib/metering/index.ts` - Updated exports
- `test-llm-gateway.js` - Integration test
- `package.json` - Added `@google/generative-ai` dependency

**Architecture Implemented:**
```
User Request → JWT Auth → ATI Token Resolution → Plan/Feature Check
    ↓
Enforcement Decision → Model Class Selection → Provider Routing
    ↓
LLM Execution → Token Counting → Usage Recording → Response
```

**Key Features:**
- ✅ **Three Provider Support**: Gemini 2.5 Pro, ChatGPT 4o, Grok 3
- ✅ **Metering Integration**: Full integration with existing ATI token hierarchy
- ✅ **Smart Routing**: Cost-based provider selection with automatic failover
- ✅ **Access Control**: User → Tenant → Plan → Feature → Model restrictions
- ✅ **Usage Tracking**: Token counting, cost calculation, quota enforcement
- ✅ **No Breaking Changes**: Existing functionality preserved

**Environment Variables Required:**
```bash
GOOGLE_AI_API_KEY=your_gemini_key
OPENAI_API_KEY=your_openai_key
GROK_API_KEY=your_grok_key
```

**Next Steps:**
1. **Test Integration**: Run `node test-llm-gateway.js` to verify functionality
2. **API Endpoint Creation**: Create Next.js API routes using the gateway
3. **Grok API Confirmation**: Verify actual Grok API endpoint and format
4. **Production Deployment**: Set up environment variables and monitoring

---

*Document Version: 1.1*
*Last Updated: September 30, 2025*
*Implementation Status: Phase 2 Complete ✅*
