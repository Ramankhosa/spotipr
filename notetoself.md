# Metering System Implementation Notes

## **Current Status** 📍
- **Date**: Saturday, September 27, 2025
- **Phase**: Architecture Complete, Implementation Starting
- **Next Task**: Database Schema Implementation
- **Completed**: Comprehensive metering.md specification with 10 modules
- **Architecture**: Modular, phased rollout design approved

## **Implementation Roadmap** 🗺️

### **Phase 1: Foundation (Week 1-2)**
- [ ] **Database Schema** - Add all metering tables to Prisma
- [ ] **Core Service Layer** - Create `src/lib/metering/` with types, errors, interfaces
- [ ] **Identity Resolution** - Module 1: tenant_id + plan_id from ATI
- [ ] **Policy Engine** - Modules 2-4: features, tasks, rules

### **Phase 2: Core Enforcement (Week 3-4)**
- [ ] **Enforcement Middleware** - Module 5: gatekeeper service
- [ ] **HTTP Middleware Integration** - Apply to existing API routes
- [ ] **Execution Adapters** - Module 6: thin wrappers for LLM calls
- [ ] **Metering & Logs** - Module 7: usage tracking

### **Phase 3: Admin & Monitoring (Week 5-6)**
- [ ] **Admin Console** - Module 8: plan/feature management UI
- [ ] **Alerts System** - Module 9: quota notifications
- [ ] **Testing Suite** - Integration tests for all modules
- [ ] **Rollout Strategy** - Gradual enforcement activation

## **Architecture Decisions** 🏗️

### **Service Layer Structure**
```
src/lib/metering/
├── index.ts              # Main exports & factory functions
├── types.ts              # Shared interfaces (TenantContext, EnforcementDecision, etc.)
├── errors.ts             # MeteringError class & error codes
├── identity.ts           # Module 1 - ATI → tenant/plan resolution
├── catalog.ts            # Module 2 - Plan/feature definitions
├── access.ts             # Module 3 - Task/model access control
├── policy.ts             # Module 4 - Pre-execution policy rules
├── enforcement.ts        # Module 5 - Core gatekeeper logic
├── reservation.ts        # Usage reservation management
├── metering.ts           # Module 7 - Usage tracking & logging
├── middleware.ts         # HTTP request integration
└── utils.ts              # Helper functions (period keys, etc.)
```

### **Key Design Principles**
1. **Reservation-First**: Reserve budget before execution (prevent overspend)
2. **Idempotency**: Every operation supports idempotency keys
3. **Fail-Safe**: Metering failures shouldn't break core functionality
4. **Minimal Interface**: Simple permit/deny + shaped params
5. **Configuration-Driven**: All rules in database, not code
6. **Observability**: Comprehensive logging from day one

### **Database Design Notes**
- **8 Core Tables**: TenantPlan, Plan, Feature, PlanFeature, Task, ModelClass, PlanLLMAccess, PolicyRule, UsageReservation, UsageMeter, UsageLog, QuotaAlert
- **Normalized**: Clean separation of concerns
- **Indexed**: Proper indexes for performance
- **Flexible**: JSON fields where needed, extensible enums

### **Integration Strategy**
- **Middleware Pattern**: Consistent integration across all API routes
- **Context Propagation**: Pass reservation_id through request lifecycle
- **Error Handling**: Standardized error responses with specific codes
- **Logging**: Structured logging with correlation IDs

## **Potential Challenges & Solutions** ⚠️

### **Performance**
- **Caching**: Redis for policy rules, usage counters
- **Async Processing**: Background jobs for non-critical metering
- **Connection Pooling**: Optimize Prisma connections

### **Race Conditions**
- **Database Transactions**: Use transactions for reservation + usage
- **Optimistic Locking**: version fields where needed
- **Idempotency Keys**: Prevent duplicate operations

### **Scale Considerations**
- **Tenant Isolation**: Database-level multi-tenancy
- **Shard Strategy**: Plan for horizontal scaling
- **Archive Strategy**: Old logs cleanup policies

### **Testing Strategy**
- **Unit Tests**: Each service in isolation
- **Integration Tests**: Full request flows
- **Load Tests**: Performance under concurrent usage
- **Chaos Tests**: Failure scenario simulation

## **API Integration Patterns** 🔗

### **Route Pattern**
```typescript
export async function POST(request: NextRequest) {
  // 1. Authenticate user
  const auth = await authenticateRequest(request)
  if (auth.error) return auth.error

  // 2. Check metering
  const meteringCheck = await enforceMetering(request, {
    featureCode: 'PATENT_DRAFTING',
    taskCode: 'LLM2_DRAFT'
  })
  if (meteringCheck.error) return meteringCheck.error

  // 3. Execute with shaped params
  const result = await executor.execute(meteringCheck.decision)

  // 4. Commit usage
  await commitUsage(meteringCheck.reservationId, usageStats)

  return NextResponse.json(result)
}
```

### **Middleware Pattern**
```typescript
// Global middleware for automatic enforcement
export async function meteringMiddleware(request: NextRequest) {
  const routeConfig = getRouteMeteringConfig(request.nextUrl.pathname)
  if (!routeConfig) return NextResponse.next()

  return enforceMetering(request, routeConfig)
}
```

## **Future Considerations** 🔮

### **Phase 4: Advanced Features (Post-MVP)**
- Cost tracking & billing integration
- Advanced analytics & reporting
- Multi-provider LLM support
- Real-time usage dashboards
- Predictive quota alerts
- API marketplace features

### **Monitoring & Alerting**
- Prometheus metrics
- Grafana dashboards
- Error tracking (Sentry)
- Performance monitoring
- Business metrics (usage patterns, conversion rates)

### **Compliance & Security**
- GDPR data retention
- Audit trails for changes
- Encryption for sensitive data
- Rate limiting for abuse prevention
- API key rotation strategies

## **Key Reference Points** 📖

### **External Dependencies**
- **Prisma**: Database ORM with connection pooling
- **Redis**: Caching layer (policies, counters)
- **Background Jobs**: Bull/BullMQ for async processing
- **Monitoring**: Prometheus + Grafana stack

### **Code Quality Standards**
- **TypeScript**: Strict mode, no any types
- **Error Handling**: Never throw, always return structured errors
- **Logging**: Structured JSON logs with correlation IDs
- **Testing**: 80%+ coverage, integration tests for critical paths
- **Documentation**: JSDoc for all public APIs

### **Performance Targets**
- **Latency**: <50ms for enforcement checks
- **Throughput**: 1000+ requests/second
- **Availability**: 99.9% uptime
- **Accuracy**: 100% metering accuracy (no lost usage)

## **Rollback Strategy** 🛡️
- **Feature Flags**: All metering features behind flags
- **Gradual Rollout**: Per-tenant activation
- **Monitoring**: Extensive observability before full activation
- **Fallback Mode**: Bypass metering if system down

## **Success Metrics** 📊
- **User Impact**: Zero disruption to existing functionality
- **Accuracy**: 100% enforcement of plan limits
- **Performance**: No >5% latency increase
- **Maintainability**: Clear code structure, good test coverage
- **Business Value**: Cost control, tier enforcement, usage insights

---

## **🔮 Future Feature Development Guidelines**

### **LLM Integration Patterns (Consistency Rules)**

#### **1. Model Selection Logic**
- **ALWAYS** use `PlanLLMAccess` table for model availability per plan
- **NEVER** hardcode model names - always resolve from database
- **FALLBACK** hierarchy: `defaultClass` → `BASE_S` → error
- **VALIDATION** required: Check `allowedClasses` array before API calls

```typescript
// CONSISTENT PATTERN - Always use this approach
async function selectModelForTask(tenantId: string, taskCode: TaskCode): Promise<ModelClass> {
  const access = await prisma.planLLMAccess.findFirst({
    where: { planId: tenantContext.planId, taskCode }
  })
  if (!access?.allowedClasses.includes(model)) {
    throw new MeteringError('MODEL_CLASS_UNAVAILABLE')
  }
  return access.defaultClass
}
```

#### **2. Token Usage Tracking**
- **MANDATORY** token counting for all LLM calls
- **SEPARATE** input vs output tokens in `UsageStats`
- **COMMIT** usage immediately after completion via `reservationId`
- **VALIDATE** token limits from policy engine before API calls

```typescript
// CONSISTENT USAGE RECORDING
const usageStats: UsageStats = {
  inputTokens: response.usage?.prompt_tokens,
  outputTokens: response.usage?.completion_tokens,
  modelClass: selectedModel,
  apiCode: 'OPENAI' // or 'ANTHROPIC', etc.
}
await metering.recordUsage(reservationId, usageStats)
```

#### **3. Error Handling for LLM Calls**
- **RETRY** on transient errors (429, 500, network)
- **NO RETRY** on 400, 401, 403 (policy violations)
- **LOG** all failures with structured data
- **GRACEFUL DEGRADATION** to simpler models when advanced models fail

```typescript
// CONSISTENT ERROR HANDLING
try {
  const result = await callLLM(model, prompt, limits)
  return result
} catch (error) {
  if (error.status === 429) {
    // Retry with exponential backoff
    return retryWithBackoff(() => callLLM(model, prompt, limits))
  }
  if (error.status >= 400 && error.status < 500) {
    // Client error - don't retry
    throw new MeteringError('LLM_POLICY_VIOLATION', error.message)
  }
  // Server error - log and potentially retry
  await logLLMError(reservationId, error)
  throw error
}
```

### **API Search Integration Patterns**

#### **1. Search API Standardization**
- **SINGLE ENTRY POINT** for all search types (`PATENT_OPEN`, `NPL_OPEN`, `WEB_META`)
- **UNIFIED INTERFACE** regardless of underlying API (PatentsView, OpenAlex, etc.)
- **RESULT NORMALIZATION** to consistent schema
- **COST TRACKING** per API call (not token-based)

```typescript
// CONSISTENT SEARCH PATTERN
interface SearchRequest {
  query: string
  filters: SearchFilters
  maxResults: number
  tenantId: string
  reservationId: string
}

interface SearchResult {
  id: string
  title: string
  authors: string[]
  source: string
  relevanceScore: number
  apiSource: string // 'PATENTSVIEW', 'OPENALEX', etc.
}

// Usage recording for searches (API calls, not tokens)
const searchUsage: UsageStats = {
  apiCalls: 1,
  apiCode: 'PATENT_OPEN'
}
```

#### **2. Rate Limiting & Cost Control**
- **API-SPECIFIC LIMITS** separate from LLM limits
- **COST TRACKING** per API provider
- **BUDGET ENFORCEMENT** before API calls
- **PROVIDER FALLBACK** when primary API exhausted

#### **3. Result Caching Strategy**
- **CACHE** search results for identical queries
- **TTL** based on data freshness requirements
- **INVALIDATION** on significant updates
- **COST OPTIMIZATION** via cache hits

### **Feature-Specific Integration Rules**

#### **LLM1_PRIOR_ART (Reasoning Task)**
- **MODEL PREFERENCE**: `PRO_M` or `ADVANCED` for complex analysis
- **OUTPUT FORMAT**: Structured JSON with confidence scores
- **TOKEN ALLOCATION**: Higher input limits for document analysis
- **RETRY LOGIC**: Allow regeneration for low-confidence results

#### **LLM2_DRAFT (Drafting Task)**
- **MODEL PREFERENCE**: `PRO_L` or `ADVANCED` for creative writing
- **OUTPUT FORMAT**: Clean markdown with sections
- **TOKEN ALLOCATION**: Balanced input/output for iterative refinement
- **VALIDATION**: Grammar and coherence checks

#### **LLM3_DIAGRAM (Code Generation)**
- **MODEL PREFERENCE**: `PRO_M` with PlantUML/Mermaid training
- **OUTPUT FORMAT**: Valid syntax only (PlantUML/Mermaid)
- **TOKEN ALLOCATION**: Lower limits, focused on code generation
- **SANITIZATION**: Remove unsafe code patterns

#### **PRIOR_ART_SEARCH**
- **MULTI-SOURCE**: Combine patent + academic sources
- **DEDUPLICATION**: Remove duplicate results across sources
- **RANKING**: Relevance scoring with ML models
- **CITATION**: Include source URLs and access dates

### **Cost Optimization Strategies**

#### **1. Model Selection Optimization**
- **DOWNGRADE** to cheaper models when possible
- **ESTIMATE** cost before execution
- **BATCH** requests where supported
- **CACHE** common prompts/responses

#### **2. Usage Pattern Analysis**
- **MONITOR** usage patterns per tenant
- **OPTIMIZE** based on success rates
- **SUGGEST** cheaper alternatives
- **ALERT** on unusual spending

#### **3. Graceful Degradation**
- **FALLBACK** to simpler models on failures
- **REDUCE** quality settings when approaching limits
- **QUEUE** requests during high load
- **NOTIFY** users of performance impacts

### **Testing & Quality Assurance**

#### **1. LLM Output Validation**
- **SCHEMA VALIDATION** for structured outputs
- **CONTENT FILTERING** for inappropriate content
- **ACCURACY CHECKS** against known test cases
- **PERFORMANCE METRICS** (latency, token efficiency)

#### **2. Integration Testing**
- **END-TO-END** flows with real API calls (in staging)
- **METERING ACCURACY** verification
- **ERROR HANDLING** under failure conditions
- **PERFORMANCE** under load

#### **3. Cost Control Testing**
- **BUDGET ENFORCEMENT** validation
- **RATE LIMIT** testing
- **COST CALCULATION** accuracy
- **OVERAGE HANDLING** verification

### **Future Extensibility Considerations**

#### **1. New LLM Providers**
- **ADAPTER PATTERN** for easy provider addition
- **CONFIGURATION-DRIVEN** provider settings
- **COST CALCULATION** standardization
- **MODEL MAPPING** to internal classes

#### **2. Advanced Features**
- **STREAMING** responses for better UX
- **FUNCTION CALLING** for tool integration
- **MULTI-MODAL** inputs (images, documents)
- **CONVERSATION MEMORY** for context

#### **3. Analytics & Insights**
- **USAGE PATTERNS** analysis
- **COST OPTIMIZATION** recommendations
- **PERFORMANCE METRICS** dashboards
- **A/B TESTING** for model comparisons

### **Operational Excellence**

#### **1. Monitoring & Alerting**
- **ERROR RATES** per model/provider
- **LATENCY TRACKING** with percentiles
- **COST ANOMALIES** detection
- **USAGE SPIKES** alerts

#### **2. Incident Response**
- **ROLLBACK** procedures for model issues
- **COMMUNICATION** templates for outages
- **RECOVERY** processes for data loss
- **POST-MORTEM** analysis requirements

#### **3. Security Considerations**
- **PROMPT INJECTION** protection
- **PII FILTERING** in logs
- **API KEY ROTATION** procedures
- **AUDIT TRAILS** for sensitive operations

---

## **Schema Development Learnings**

### **1. Enum Constraints > Unique Constraints**
- **ENUMS PROVIDE STRONGER VALIDATION** than unique constraints alone
- **TYPE-LEVEL PREVENTION** stops invalid data before database insertion
- **EXAMPLE**: `FeatureCode` enum prevents bad feature codes entirely vs. allowing insertion then failing on duplicates
- **BEST PRACTICE**: Use enums for controlled vocabularies (features, tasks, models, statuses)

### **2. Schema Testing Strategy**
- **TEST RELATIONSHIPS, NOT DATA CREATION** - Focus on validating joins and constraints
- **USE EXISTING DATA** for relationship tests instead of creating duplicates
- **VALIDATE ENUMS** by attempting invalid values and confirming rejection
- **TEST COMPLEX QUERIES** with nested includes early
- **CLEANUP PROPERLY** with cascading deletes respecting foreign key constraints

### **3. Prisma Enum Behavior**
- **ENUM VALUES ARE TYPE-CHECKED** at compile time and runtime
- **INVALID ENUM VALUES** fail immediately with clear error messages
- **SCHEMA CHANGES REQUIRE** explicit enum updates (prevents accidental additions)
- **MIGRATIONS INCLUDE** enum changes automatically

### **4. Relationship Testing Patterns**
- **TEST BIDIRECTIONAL RELATIONSHIPS** - Both sides of foreign keys
- **VALIDATE CASCADE BEHAVIOR** - Delete operations and their effects
- **CHECK COMPLEX INCLUDES** - Multi-level nested queries work correctly
- **VERIFY CONSTRAINTS** - Foreign keys, unique combinations, required fields

### **5. Database Integrity Best Practices**
- **STRONG TYPING FIRST** - Use enums and constrained types over runtime validation
- **RELATIONSHIPS OVER MANUAL JOINS** - Let Prisma handle foreign key relationships
- **CONSTRAINTS AS SAFETY NETS** - Database constraints catch application logic errors
- **MIGRATION SAFETY** - Test migrations with data rollback capabilities
- **FIELD EXISTENCE VERIFICATION** - Always verify field existence on models before querying (e.g., `planTier` on `Tenant` vs `ATIToken`)
- **RELATIONSHIP QUERY PATTERNS** - Use `include` for related data instead of separate queries when possible

---

## **Implementation Reminders**

- **ALWAYS** check metering before LLM/API calls
- **NEVER** trust client-provided limits
- **ALWAYS** record usage after successful operations
- **NEVER** expose internal model names to clients
- **ALWAYS** validate outputs against expected schemas
- **NEVER** retry on policy violations (400-499 errors)
- **ALWAYS** implement graceful degradation
- **NEVER** hardcode model configurations

### **Schema Development Reminders**
- **ALWAYS** use enums for controlled values (features, tasks, models, statuses)
- **NEVER** rely solely on unique constraints for data validation
- **ALWAYS** test relationships and complex queries during schema changes
- **NEVER** skip enum validation testing
- **ALWAYS** ensure bidirectional relationship consistency
- **NEVER** create test data that conflicts with existing schemas

### **Plan Inheritance Architecture**
- **SINGLE SOURCE OF TRUTH**: Super admin sets plan via ATI token (`ATIToken.planTier`)
- **INHERITANCE CHAIN**: Super Admin ATI Token → Tenant Admin → Tenant Employee ATI Tokens
- **NO PLAN CHOICE**: Tenant admins cannot choose plans - they inherit from signup token
- **CONSISTENT TIERS**: All tenant users have same plan tier set by super admin
- **PREVENTS INCONSISTENCY**: Eliminates tenant_plans table dependency issues

### **ATI Token Management Reminders**
- **ALWAYS** inherit plan tier from tenant admin's signup ATI token (`user.signupAtiTokenId → ATIToken.planTier`)
- **NEVER** get plan tier from tenant_plans table - creates inconsistency with super admin intent
- **NEVER** allow tenant admins to choose different plans - plan is set by super admin at tenant level
- **ALWAYS** use signup ATI token as single source of truth for tenant plan tier
- **NEVER** query non-existent fields on Prisma models (causes runtime errors)
- **ALWAYS** test ATI token inheritance with different plan tiers (FREE, PRO, etc.)

---

**Last Updated**: September 27, 2025
**Next Review**: After Phase 1 completion
**Contact**: Implementation notes for future reference
