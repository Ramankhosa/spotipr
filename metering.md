
# Phase 0 — Guardrails (meta)

**Goal:** prevent hallucinations by fixing vocabulary and outputs.

* **Canonical terms**: *Tenant, ATI, Plan, Feature, Task, Policy, Meter, Reservation.*
* **LLM tasks (exact codes)**: `LLM1_PRIOR_ART`, `LLM2_DRAFT`, `LLM3_DIAGRAM`.
* **Search APIs (categories)**: `PATENT_OPEN`, `NPL_OPEN`, `WEB_META` (optional later).

**Done means**

* A single README page with these terms and codes pinned in the repo/wiki.

---

# Module 1 — Identity & Tenant Resolution (Must-have, small)

**What**: Resolve `tenant_id` and `plan_id` from **ATI** for every request.

**Minimum data**

* `Tenant(id, name, status, ati_id)`
* `TenantPlan(tenant_id, plan_id, effective_from, expires_at, status)`
* `Plan(id, code, name, cycle, status)`

**Why**: Every other module depends on this.

**Done means**

* Middleware returns `(tenant_id, plan_id)` or a single error: `TENANT_UNRESOLVED`.
* Unit tests: valid/expired ATI; tenant suspended.

**Out of scope**: payments; pricing.

---

# Module 2 — Plan & Feature Catalog (Must-have, small)

**What**: Plans and the features they enable with coarse quotas.

**Minimum data**

* `Feature(id, code, name, unit)`
  Suggested codes: `PRIOR_ART_SEARCH`, `PATENT_DRAFTING`, `DIAGRAM_GENERATION`, `EMBEDDINGS`, `RERANK`.
* `PlanFeature(plan_id, feature_id, monthly_quota, daily_quota?)`

**Why**: Turns tiers into enforceable switches without micromanaging.

**Done means**

* Given `(tenant_id, feature_code)` → allow/deny and show remaining quota (best-effort) without calling any LLM/API.
* Unit tests: plan with/without feature; quota zero.

**Out of scope**: per-API vendor limits; advanced shaping.

---

# Module 3 — Task & Model Access (Must-have, small)

**What**: Bind **tasks** to allowed **model classes** per plan. (We do **not** need a full model marketplace now.)

**Minimum data**

* `Task(id, code, linked_feature)` where codes are exactly: `LLM1_PRIOR_ART`, `LLM2_DRAFT`, `LLM3_DIAGRAM`.
* `ModelClass(id, code)` where codes are: `BASE_S`, `BASE_M`, `PRO_M`, `PRO_L`, `ADVANCED`.
* `PlanLLMAccess(plan_id, task_code, allowed_classes[], default_class)`

**Why**: Different LLMs per purpose without vendor lock.

**Done means**

* Ask for `(plan_id, task_code)` → returns a **single default class** plus allowed list.
* Unit tests: Free blocks `ADVANCED`; Enterprise allows it.

**Out of scope**: exact vendor model IDs, pricing, auto routing.

---

# Module 4 — Minimal Policy Rules (Shape-before-spend) (Must-have, tiny)

**What**: A **very small** set of knobs applied **before** execution.

**Minimum data**

* `PolicyRule(scope, key, value)` where:

  * `scope` ∈ {`plan`, `tenant`} and **optionally** `task_code`
  * `key` ∈ {`max_tokens_in`, `max_tokens_out`, `agent_max_steps`, `retrieval_top_k`, `diagram_files_per_req`, `concurrency_limit`}
  * `value` = integer (no JSON, no arrays now)

**Why**: Prevents runaway cost; tiny footprint.

**Done means**

* Given `(tenant_id, task_code)`, policy engine returns concrete caps for the six keys; falls back to plan if tenant override missing.
* Unit tests: tenant override beats plan; missing rule uses sensible default.

**Out of scope**: domain allowlists, budgets, data residency (later).

---

# Module 5 — Enforcement Middleware (Must-have, core)

**What**: One gate that does **three** things synchronously before execution:

1. **Permit/Deny** (plan & feature present),
2. **Shape** params using Module 4 rules,
3. **Reserve** a small budget (tokens/calls).

**Minimum data**

* `UsageReservation(id, tenant_id, feature_id or task_code, reserved_units, status=pending, expires_at, idempotency_key)`

**Why**: Avoids post-facto surprises and duplicate spend on retries.

**Done means**

* For LLM calls: reserve `max_tokens_out` (or a constant small block, e.g., 1k) and release/adjust after.
* For search calls: reserve 1 unit per API call.
* Returns a **normalized instruction object** to the executor:

  * `{allowed: boolean, model_class, max_in, max_out, max_steps, top_k, max_files, reservation_id}`

**Tests**

* Idempotency: same idempotency_key → no double reservation.
* Expiry: expired reservations auto-released by a cleanup job.

**Out of scope**: cost pricing; multi-provider fallback.

---

# Module 6 — Execution Adapters (Slim)

**What**: Thin wrappers that **accept shaped params** and run the thing.

**Adapters**

* `LLM1_PRIOR_ART` (reasoning): use `model_class`; obey `max_in/out`, `max_steps`.
* `LLM2_DRAFT` (drafting): ditto; enforce per-section size in the caller (not here).
* `LLM3_DIAGRAM` (code gen): obey `max_out` and `max_files`; restrict to PlantUML/Mermaid grammar mode if available.
* `PRIOR_ART_SEARCH` (APIs): just call allowed open endpoints (PatentsView, OpenAlex). **Skip web/meta** for now.

**Why**: Keeps logic centralized; prevents bypass of the gate.

**Done means**

* Each adapter reports **actual usage** (tokens in/out or api_calls=1).
* On completion, the adapter calls Module 7 to **commit** usage with the `reservation_id`.

**Out of scope**: rich templates, multi-pass critique, paid APIs.

---

# Module 7 — Metering & Logs (Must-have, minimal)

**What**: One fast counter per tenant×feature/task×period + a detailed append-only log.

**Minimum data**

* `UsageMeter(tenant_id, feature_or_task, period_type{DAILY|MONTHLY}, period_key, current_usage)`
* `UsageLog(id, tenant_id, user_id?, feature_or_task, task_code?, model_class?, api_code?, input_tokens?, output_tokens?, api_calls?, started_at, completed_at, status, error?, idempotency_key)`

**Why**: Meters are for enforcement and quick “remaining” checks; logs are for audits.

**Done means**

* Atomic increment on commit; reject commits without a valid reservation.
* Simple daily & monthly counters update; no complex summaries yet.

**Tests**

* Race: simultaneous commits update meters correctly.
* Failure path writes `status=FAILED` but still releases reservation.

**Out of scope**: costs, materialized views, fancy analytics.

---

# Module 8 — Minimal Admin Console (Tiny)

**What**: Just the fields admins must edit now.

* Plans: create/update; assign to tenant.
* PlanFeature: set monthly_quota.
* PlanLLMAccess: set default & allowed classes per task.
* PolicyRule: set the six integer caps (Module 4).

**Why**: Avoid config through SQL; reduce errors.

**Done means**

* Form validation; publishing triggers a small cache bust.
* “Simulate policy” button: choose tenant+task → shows decision (model_class, caps).

**Out of scope**: charts, big dashboards.

---

# Module 9 — Basic Alerts (Tiny)

**What**: Only two signals to start:

* **80/100%** of monthly **PlanFeature** quota (feature level).
* **Reservation denied** due to concurrency limit.

**Why**: High-signal, low-noise.

**Done means**

* Tenant admin sees banner + email/webhook stub (even if not wired yet).
* Single table `QuotaAlert(tenant_id, feature_or_task, type, threshold, notified_at)`.

**Out of scope**: budgets in currency, anomaly ML, per-user alerts.

---

# Module 10 — Rollout & Tests (Process)

**Silent metering week**

* Gate runs in **permit+shape** mode; reservations created, but hard denies OFF (except invalid tenant/plan).
* Compare shaped params to actual adapter usage; fix deltas.

**Flip order**

* Turn on **hard caps** for: `concurrency_limit`, `agent_max_steps`, and PlanFeature monthly quotas.
* Keep daily quotas as soft warnings for first cycle.

**Test checklist**

* Tenant with Free plan cannot run `WEB_META` or `ADVANCED` class models.
* `LLM3_DIAGRAM` blocks > `diagram_files_per_req`.
* Concurrency 2 → 3rd request gets a clean 429 + Retry-After header.
* Duplicate retry with the same `idempotency_key` does not double count.
* Reservation expires releases capacity.

---

## Minimal Table List (only what we actually need now)

1. `Tenant` / `TenantPlan` / `Plan`
2. `Feature` / `PlanFeature`
3. `Task` / `ModelClass` / `PlanLLMAccess`
4. `PolicyRule`
5. `UsageReservation`
6. `UsageMeter`
7. `UsageLog`
8. `QuotaAlert` (optional but tiny)

> Everything else (Model registry, ApiProvider, UsageSummary, AuditLog, Budgets) can wait until we’re stable.

---

## Contingencies & Edge-case handling (kept lean)

* **Retries/timeouts**: require `idempotency_key` in every adapter call; commit enforces it.
* **Runaway agent**: enforce `agent_max_steps` in both the **policy engine** and the **adapter** (belt & suspenders).
* **Clock/period bugs**: servers compute period keys; never trust client time.
* **Bypass attempts**: adapters refuse to run without a **decision payload** from the gate (contains reservation_id).
* **Hot tenants**: `concurrency_limit` is per tenant×task; denial is friendly with a known error code and retry hint.
* **Misconfig**: “Simulate policy” must pass before allowing publish; policy changes cache-bust gate.

---

## Reasoning recap (why this shape)

* We **separate “Feature vs Task”** so your three LLM use-cases get clean controls without bloating schema.
* We keep **six policy keys** only—enough to stop cost explosions and enforce tiers; no premature complexity.
* We **reserve before spending** (small but crucial) to avoid double billing and race conditions.
* We defer dashboards, budgets, vendor catalogs until we see real usage patterns.

---

If you want, I can turn this into a one-page **implementation checklist** (Jira-ready) with exact tickets per module.
