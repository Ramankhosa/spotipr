/**
 * Whitespace Studio — service layer.
 *
 * Owns study lifecycle, scope compilation, and run orchestration. Long stages
 * answer 202 and are polled, following the Prior-Art Studio pattern: a deep
 * census outlives reverse-proxy read timeouts, so the request must not be held
 * open waiting for it.
 *
 * Runs are DURABLE JOBS, not closures. A queued run carries its own scope,
 * params and (through its study) the tenant that pays for its model calls, so
 * any process may execute it — the inline drain kicked by the request, or
 * `scripts/whitespace-worker.ts`, or a fresh web instance after this one is
 * replaced mid-deploy. The lease in run-lease.ts is what makes racing safe.
 */

import { Prisma, TaskCode } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { runFieldMap } from './field-map'
import { type WhitespaceLLMContext } from './llm'
import { RunReporter } from './run-reporter'
import { hostname } from 'os'
import type { WhitespaceRunProgress } from './types'
import { buildFieldNarrationPrompt, buildScopeCompilePrompt, WS_SCOPE_STAGE_CODE } from './prompts'
import {
  isLeaseLost,
  isPermanentFailure,
  retryDelayMs,
  RUN_LEASE_MS,
  WhitespacePermanentError,
} from './run-lease'
import { normalizeScope, scopeIsRunnable, validateWhitespaceScope } from './scope-schema'
import {
  CORPUS_FIRST_YEAR,
  emptyWhitespaceScope,
  stableJson,
  type FieldMapResult,
  type TrailKind,
  type WhitespaceRunStage,
  type WhitespaceScope,
} from './types'

/** A run still PROCESSING after this is treated as lost to a restart. */
export const WHITESPACE_RUN_STALE_MS = 15 * 60 * 1000

// ---------------------------------------------------------------------------
// Study lifecycle
// ---------------------------------------------------------------------------

/**
 * The one place study access is decided.
 *
 * Ownership is still the user, and that is what every caller relied on. What is
 * new is the tenant check: a study records the organisation it was created
 * under, because that organisation's plan paid for its model calls and its
 * contents are that organisation's work product. When a user moves to a
 * different tenant, their old tenant's studies must not follow them across —
 * otherwise the first time studies become shareable, cross-tenant reads arrive
 * with them.
 *
 * Deliberately narrow: it only bites when BOTH sides carry a tenant and they
 * differ. A study created before tenanting, or a user not yet assigned to one,
 * is unaffected, so nobody is locked out of their own work by the check itself.
 *
 * Pass `viewerTenantId` to enforce it. The overload without it is not an
 * escape hatch — it means "no tenant claim to check", which is what a
 * background job holds.
 */
export async function getOwnedStudy(studyId: string, userId: string, viewerTenantId?: string | null) {
  const study = await prisma.whitespaceStudy.findUnique({ where: { id: studyId } })
  if (!study || study.userId !== userId) return null
  if (viewerTenantId && study.tenantId && study.tenantId !== viewerTenantId) {
    console.warn(
      `[Whitespace] Cross-tenant study read refused: study ${study.id} belongs to tenant ${study.tenantId}, viewer is in ${viewerTenantId}`
    )
    return null
  }
  return study
}

export async function appendTrail(
  studyId: string,
  kind: TrailKind,
  actor: string,
  summary: string,
  data?: Prisma.InputJsonValue
) {
  return prisma.whitespaceTrailEntry.create({
    data: { studyId, kind, actor, summary: summary.slice(0, 500), data },
  })
}

export function readScope(value: Prisma.JsonValue | null): WhitespaceScope {
  const parsed = validateWhitespaceScope(value)
  return parsed.success ? parsed.scope : emptyWhitespaceScope()
}

/**
 * Executor-side scope read. Display paths may fall back to an empty scope, but
 * a stage run against one would count nothing and present that as a result —
 * an invalid snapshot must refuse, and permanently: the snapshot will not
 * repair itself between retries.
 */
function readScopeStrict(value: Prisma.JsonValue | null): WhitespaceScope {
  const parsed = validateWhitespaceScope(value)
  if (!parsed.success) {
    throw new WhitespacePermanentError(
      'The scope saved with this run could no longer be read. Start the stage again from the current scope.'
    )
  }
  return parsed.scope
}

// ---------------------------------------------------------------------------
// Stage 0 — scope compile
// ---------------------------------------------------------------------------

/** Brace-balanced JSON extraction; models wrap output in prose more often than not. */
function extractBalancedJson(text: string): string | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const char = text[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '"') inString = !inString
    if (inString) continue
    if (char === '{') depth++
    if (char === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

function asStrings(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((v): v is string => typeof v === 'string')
    .map(v => v.trim())
    .filter(Boolean)
    .slice(0, max)
}

function asInt(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

export interface CompileScopeResult {
  scope: WhitespaceScope
  modelCode?: string
}

export async function compileScope(input: {
  brief: string
  existingTitle?: string
  framing?: 'FIELD' | 'INVENTION'
  requestHeaders: Record<string, string>
}): Promise<CompileScopeResult> {
  const { llmGateway } = await import('@/lib/metering/gateway')
  const prompt = buildScopeCompilePrompt({
    brief: input.brief,
    existingTitle: input.existingTitle,
    framing: input.framing,
  })

  // Stage-coded resolution is fail-closed: model-resolver throws unless a super
  // admin (or scripts/add-whitespace-stages.js) has mapped a model to this exact
  // plan + stage. Fall back to task-only routing so the module works on a fresh
  // install, exactly as Prior-Art Studio does for its query generator.
  let output: string | undefined
  let modelCode: string | undefined
  let usedFallbackTask = false

  const stageAttempt = await llmGateway.executeLLMOperation(
    { headers: input.requestHeaders },
    { taskCode: TaskCode.WS_SCOPE, stageCode: WS_SCOPE_STAGE_CODE, prompt }
  )
  if (stageAttempt.success && stageAttempt.response?.output) {
    output = stageAttempt.response.output
    modelCode = stageAttempt.response.metadata?.model || stageAttempt.response.modelClass
  } else if (stageAttempt.error?.code !== 'CONFIGURATION_ERROR') {
    // The stage IS configured and its model failed. Do not retry task-only:
    // that path resolves through MODEL_CLASS_DEFAULTS, a hardcoded table, so it
    // would abandon the configured model for a hardcoded one and then report
    // the second model's error — hiding the real fault. Fail loudly instead.
    throw new Error(
      stageAttempt.error?.message ||
        'The model configured for the scope compiler did not complete the request.'
    )
  } else {
    usedFallbackTask = true
    const taskAttempt = await llmGateway.executeLLMOperation(
      { headers: input.requestHeaders },
      { taskCode: TaskCode.WS_SCOPE, prompt }
    )
    if (!taskAttempt.success || !taskAttempt.response?.output) {
      // Both paths failed — surface the task-level error, which is the one that
      // reflects plan entitlement rather than missing stage configuration.
      throw new Error(
        taskAttempt.error?.message || stageAttempt.error?.message || 'Scope compiler is unavailable. Try again.'
      )
    }
    output = taskAttempt.response.output
    modelCode = taskAttempt.response.metadata?.model || taskAttempt.response.modelClass
  }
  if (usedFallbackTask) {
    console.warn(
      `[Whitespace] Stage ${WS_SCOPE_STAGE_CODE} is not configured for this plan — used task-only routing. Run scripts/add-whitespace-stages.js to enable per-stage model control.`
    )
  }

  const jsonText = extractBalancedJson(output)
  if (!jsonText) throw new Error('Scope compiler returned no JSON.')

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(jsonText) as Record<string, unknown>
  } catch {
    throw new Error('Scope compiler returned malformed JSON.')
  }

  const currentYear = new Date().getFullYear()
  const scope = emptyWhitespaceScope()
  scope.title = typeof parsed.title === 'string' ? parsed.title.trim().slice(0, 200) : input.existingTitle || ''
  scope.summary = typeof parsed.summary === 'string' ? parsed.summary.trim().slice(0, 2000) : ''

  scope.concepts = (Array.isArray(parsed.concepts) ? parsed.concepts.slice(0, 12) : [])
    .map((raw, i) => {
      const entry = raw as Record<string, unknown>
      const label = typeof entry.label === 'string' ? entry.label.trim().slice(0, 200) : ''
      return {
        id: `c${i + 1}`,
        label,
        synonyms: asStrings(entry.synonyms, 30),
        required: entry.required === true,
        origin: 'copilot' as const,
      }
    })
    .filter(c => c.label)

  scope.classifications = (Array.isArray(parsed.classifications) ? parsed.classifications.slice(0, 20) : [])
    .map(raw => {
      const entry = raw as Record<string, unknown>
      const code = typeof entry.code === 'string' ? entry.code.replace(/\s+/g, '').toUpperCase().slice(0, 40) : ''
      return {
        code,
        definition: typeof entry.definition === 'string' ? entry.definition.trim().slice(0, 500) : undefined,
        caution: typeof entry.caution === 'string' ? entry.caution.trim().slice(0, 300) : undefined,
        origin: 'copilot' as const,
        // A code the compiler flagged as broad starts unaccepted, so widening the
        // field is always a deliberate act by the user rather than a default.
        accepted: !entry.caution,
      }
    })
    .filter(c => c.code)

  scope.exclusions = (Array.isArray(parsed.exclusions) ? parsed.exclusions.slice(0, 20) : [])
    .map(raw => {
      const entry = raw as Record<string, unknown>
      return {
        term: typeof entry.term === 'string' ? entry.term.trim().slice(0, 200) : '',
        reason: typeof entry.reason === 'string' ? entry.reason.trim().slice(0, 300) : undefined,
        origin: 'copilot' as const,
      }
    })
    .filter(e => e.term)

  const modelAssumptions = (Array.isArray(parsed.assumptions) ? parsed.assumptions.slice(0, 20) : [])
    .map((raw, i) => {
      const entry = raw as Record<string, unknown>
      return {
        id: `a${i + 1}`,
        text: typeof entry.text === 'string' ? entry.text.trim().slice(0, 600) : '',
        kind: 'interpretation' as const,
      }
    })
    .filter(a => a.text)

  const filters = (parsed.filters ?? {}) as Record<string, unknown>
  scope.filters.yearFrom = Math.max(CORPUS_FIRST_YEAR, asInt(filters.yearFrom, CORPUS_FIRST_YEAR))
  scope.filters.yearTo = Math.min(currentYear, asInt(filters.yearTo, currentYear))
  scope.filters.jurisdictions = asStrings(filters.jurisdictions, 40)
    .map(j => j.toUpperCase())
    .filter(j => /^[A-Z]{2}$/.test(j))

  // Corpus assumptions are appended by us, not the model. They are facts about
  // our data rather than interpretations of the brief, and the user cannot
  // correct them away — only the ingestion roadmap can.
  scope.assumptions = [
    ...modelAssumptions,
    {
      id: 'corpus-window',
      text: `Corpus covers ${CORPUS_FIRST_YEAR} onward. Art published before ${CORPUS_FIRST_YEAR} is not searched by this study.`,
      kind: 'corpus' as const,
    },
    {
      id: 'corpus-claims',
      text: 'Claim text is readable mainly for US, EP and IN families. Claim-level findings do not cover jurisdictions where claims are unavailable.',
      kind: 'corpus' as const,
    },
    {
      id: 'corpus-signals',
      text: 'No citation data, legal status or commercial evidence is available. Legal status shown anywhere in this study is a kind-code proxy.',
      kind: 'corpus' as const,
    },
  ]

  if (!scope.concepts.length) throw new Error('Scope compiler produced no usable concepts.')

  return { scope: normalizeScope(scope), modelCode }
}

// ---------------------------------------------------------------------------
// Field narration
// ---------------------------------------------------------------------------

/** Compound growth over the last five complete years, excluding the lag window. */
function recentTrendPct(result: FieldMapResult): number | null {
  const usableYears = result.filingsByYear.filter(
    y => y.year <= new Date().getFullYear() - Math.ceil(result.publicationLagMonths / 12)
  )
  if (usableYears.length < 6) return null
  const window = usableYears.slice(-6)
  const first = window[0].families
  const last = window[window.length - 1].families
  if (!first) return null
  return Math.round(((last - first) / first) * 100)
}

async function narrateField(input: {
  scope: WhitespaceScope
  result: FieldMapResult
  llmContext: WhitespaceLLMContext
}): Promise<string | null> {
  try {
    const { result, scope } = input
    const peak = result.filingsByYear.reduce<{ year: number; families: number } | null>(
      (best, y) => (!best || y.families > best.families ? y : best),
      null
    )
    const topThree = result.assignees.slice(0, 3).reduce((sum, a) => sum + a.families, 0)

    const prompt = buildFieldNarrationPrompt({
      title: scope.title || 'this field',
      familyCount: result.familyCount,
      firstYear: result.filingsByYear[0]?.year ?? scope.filters.yearFrom,
      lastYear: result.filingsByYear[result.filingsByYear.length - 1]?.year ?? scope.filters.yearTo,
      peakYear: peak?.year ?? null,
      recentTrendPct: recentTrendPct(result),
      topAssignees: result.assignees.slice(0, 5),
      topSharePct: result.familyCount ? Math.round((topThree / result.familyCount) * 100) : null,
      jurisdictions: result.jurisdictions.slice(0, 5),
      claimsCoveragePct: result.familyCount
        ? Math.round((result.textCoverage.withClaims / result.familyCount) * 100)
        : 0,
    })

    // Routed through the stage helper, not the gateway directly. A task-only
    // call here bypassed stage configuration entirely and resolved through
    // MODEL_CLASS_DEFAULTS, so this one narration ran on a hardcoded model no
    // matter what the operator had assigned to Whitespace in Super Admin.
    const { runWhitespaceLLM } = await import('./llm')
    const response = await runWhitespaceLLM({
      taskCode: TaskCode.WS_SCOPE,
      stageCode: WS_SCOPE_STAGE_CODE,
      prompt,
      context: input.llmContext,
    })
    return response.output.trim() || null
  } catch (error) {
    // Narration is a convenience over numbers the user already has. If it fails,
    // the census still stands on its own.
    console.error('[Whitespace] Field narration failed:', error)
    return null
  }
}

// ---------------------------------------------------------------------------
// Run orchestration
// ---------------------------------------------------------------------------

/**
 * Fails a run that is live on paper but has no worker behind it.
 *
 * Now lease-aware. The claim query reclaims an expired lease by itself, so this
 * only has to deal with the terminal case: a run whose lease has expired AND
 * whose attempts are spent. Anything with attempts left is left alone for the
 * next claim to pick up, which is the whole point of the queue — the old version
 * failed every silent run outright and the user's only recourse was to start
 * over by hand.
 */
export async function resolveStaleRun<
  T extends {
    id: string
    status: string
    createdAt: Date
    heartbeatAt?: Date | null
    lockedUntil?: Date | null
    attemptCount?: number
    maxAttempts?: number
  }
>(row: T): Promise<T> {
  const live = row.status === 'QUEUED' || row.status === 'PROCESSING'
  if (!live) return row

  // A QUEUED run is waiting its turn, not stuck — only a PROCESSING run holds a
  // lease that can expire.
  if (row.status === 'QUEUED') return row

  const leaseExpired = row.lockedUntil ? row.lockedUntil.getTime() < Date.now() : true
  const lastSignal = Math.max(row.createdAt.getTime(), row.heartbeatAt?.getTime() ?? 0)
  const silent = Date.now() - lastSignal >= WHITESPACE_RUN_STALE_MS
  if (!leaseExpired || !silent) return row

  const attemptsLeft = (row.attemptCount ?? 1) < (row.maxAttempts ?? 1)
  const finalMessage =
    'This stage stopped before finishing and has used up its retries — run it again when you are ready.'
  // Guarded, not blind: `row` is a snapshot, and the run may have completed,
  // failed or been reclaimed since it was read. Only a row still PROCESSING on
  // an expired (or never-set) lease may be touched; anything else is returned
  // as it stands now, unmodified.
  const { count } = await prisma.whitespaceRun.updateMany({
    where: {
      id: row.id,
      status: 'PROCESSING',
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }],
    },
    data: attemptsLeft
      ? {
          // Hand it back to the queue rather than burying it. A worker restart is
          // exactly what the retry budget is for.
          status: 'QUEUED',
          lockedBy: null,
          lockedUntil: null,
          nextAttemptAt: new Date(),
          lastError: 'The worker running this stage stopped; it has been queued again.',
        }
      : {
          status: 'FAILED',
          lockedBy: null,
          lockedUntil: null,
          lastError: finalMessage,
          completedAt: new Date(),
        },
  })
  const fresh = await prisma.whitespaceRun.findUnique({ where: { id: row.id } })
  if (!fresh) return row
  if (count > 0 && !attemptsLeft) {
    await finalizeRunFailure(fresh, finalMessage)
  }
  // A requeued run needs a drain to come back for it: with no standalone
  // worker, nothing else will, and the user would watch "retrying" forever.
  if (count > 0 && attemptsLeft) kickInlineDrain()
  return fresh as unknown as T
}

/**
 * Queues a stage and returns immediately.
 *
 * The run is a durable job now, not a closure. Everything the executor needs —
 * scope, params, and (through the study) the tenant whose plan pays for the
 * model calls — is on the row, so any process can pick it up: the inline drain
 * kicked below, or `scripts/whitespace-worker.ts`, or a second web instance
 * after this one is replaced mid-deploy. The lease makes those safe to race.
 */
export async function startWhitespaceRun(input: {
  studyId: string
  stage: WhitespaceRunStage
  scope: WhitespaceScope
  scopeVersion: number
  requestHeaders: Record<string, string>
  params?: Prisma.InputJsonValue
}): Promise<{ runId: string; existing: boolean }> {
  const runnable = scopeIsRunnable(input.scope)
  if (!runnable.runnable) throw new Error(runnable.reason || 'Scope is not runnable.')

  // Dedupe live runs per stage AND per params: two deep dives on different
  // clusters are different work, two on the same cluster are the same run.
  const liveRuns = await prisma.whitespaceRun.findMany({
    where: { studyId: input.studyId, stage: input.stage, status: { in: ['QUEUED', 'PROCESSING'] } },
    orderBy: { createdAt: 'desc' },
  })
  for (const live of liveRuns) {
    const resolved = await resolveStaleRun(live)
    // stableJson, not JSON.stringify: resolved.params round-tripped through
    // jsonb, which reorders object keys, so a plain stringify comparison let
    // identical multi-key params (a dimension re-census registry) through as
    // "different work" and started duplicate live runs.
    //
    // Same scope version too: after a scope edit, a live run over the OLD scope
    // is different work — attaching to it would silently answer the new scope
    // with the old scope's results.
    if (
      (resolved.status === 'QUEUED' || resolved.status === 'PROCESSING') &&
      resolved.scopeVersion === input.scopeVersion &&
      stableJson(resolved.params ?? null) === stableJson(input.params ?? null)
    ) {
      return { runId: resolved.id, existing: true }
    }
  }

  const run = await prisma.whitespaceRun.create({
    data: {
      studyId: input.studyId,
      stage: input.stage,
      scopeVersion: input.scopeVersion,
      scopeSnapshot: input.scope as unknown as Prisma.InputJsonValue,
      params: input.params,
      status: 'QUEUED',
      nextAttemptAt: new Date(),
      attemptCount: 0,
    },
  })

  // Drain in-process too, so an installation with no worker deployed behaves
  // exactly as it did before. It competes for the same lease as the worker, so
  // the two can never execute the same run.
  kickInlineDrain({ studyId: input.studyId, headers: input.requestHeaders })

  return { runId: run.id, existing: false }
}

// ---------------------------------------------------------------------------
// The lease queue
// ---------------------------------------------------------------------------

type ClaimedRun = {
  id: string
  studyId: string
  stage: string
  scopeSnapshot: Prisma.JsonValue
  params: Prisma.JsonValue | null
  attemptCount: number
  maxAttempts: number
}

/**
 * Leases one runnable job, or returns null.
 *
 * `FOR UPDATE SKIP LOCKED` inside the subquery is what makes concurrent drains
 * safe: two workers selecting at the same instant take different rows instead of
 * both taking the newest one. The predicate also reclaims runs whose lease
 * expired, which is how a job survives the worker that was holding it dying.
 */
export async function claimWhitespaceRun(workerId: string): Promise<ClaimedRun | null> {
  const now = new Date()
  // The claim starts a fresh attempt, so the previous attempt's error and
  // narration are cleared — a reclaimed run must not show them as its own.
  // The reclaim branch respects the attempt budget: a run whose worker died on
  // its last attempt belongs to the dead-run sweep, not to another claim.
  const rows = await prisma.$queryRaw<ClaimedRun[]>(Prisma.sql`
    UPDATE "whitespace_runs" r
    SET "status"       = 'PROCESSING',
        "lockedBy"     = ${workerId},
        "lockedUntil"  = ${new Date(now.getTime() + RUN_LEASE_MS)},
        "heartbeatAt"  = ${now},
        "attemptCount" = r."attemptCount" + 1,
        "progress"     = NULL,
        "lastError"    = NULL
    WHERE r."id" = (
      SELECT c."id"
      FROM "whitespace_runs" c
      WHERE (c."status" = 'QUEUED' AND c."nextAttemptAt" <= ${now})
         OR (c."status" = 'PROCESSING' AND c."lockedUntil" IS NOT NULL AND c."lockedUntil" < ${now}
             AND c."attemptCount" < c."maxAttempts")
      ORDER BY c."nextAttemptAt" ASC, c."createdAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING r."id", r."studyId", r."stage", r."scopeSnapshot", r."params",
              r."attemptCount", r."maxAttempts"`)
  return rows[0] ?? null
}

/**
 * Resolves who pays for this run's model calls, without a request to read.
 *
 * The old executor carried the caller's raw HTTP headers into every stage, which
 * is why the work could not leave the request that started it — a worker has no
 * headers. The gateway also accepts a tenant context directly, and everything
 * that context needs is already durable: the study knows its tenant and its
 * owner, and the tenant's active plan is a row. So the queue reconstructs it.
 */
async function resolveStudyLlmContext(
  studyId: string
): Promise<{ tenantContext: { tenantId: string; planId: string; userId?: string } }> {
  const study = await prisma.whitespaceStudy.findUnique({
    where: { id: studyId },
    select: { userId: true, tenantId: true },
  })
  if (!study?.tenantId) {
    throw new WhitespacePermanentError(
      'This study is not attached to an organisation, so there is no plan to run its model calls against. Ask an admin to add you to one.'
    )
  }
  const tenant = await prisma.tenant.findUnique({
    where: { id: study.tenantId },
    include: {
      tenantPlans: {
        where: {
          status: 'ACTIVE',
          effectiveFrom: { lte: new Date() },
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        orderBy: { effectiveFrom: 'desc' },
        take: 1,
      },
    },
  })
  const planId = tenant?.tenantPlans[0]?.planId
  if (!tenant || tenant.status !== 'ACTIVE' || !planId) {
    throw new WhitespacePermanentError(
      'Your organisation has no active plan, so this stage cannot run. Check the subscription and try again.'
    )
  }
  return { tenantContext: { tenantId: tenant.id, planId, userId: study.userId } }
}

/**
 * Claims and runs up to `batch` jobs. Returns the run ids it completed or failed.
 *
 * Used by both the standalone worker and the inline drain, so retry accounting,
 * failure recording and the VALIDATE status rollback exist in exactly one place.
 */
export async function drainWhitespaceRuns(
  workerId: string,
  batch = 1,
  fallback?: { studyId: string; headers: Record<string, string> }
): Promise<string[]> {
  await sweepDeadRuns()

  const handled: string[] = []
  for (let i = 0; i < batch; i++) {
    const run = await claimWhitespaceRun(workerId)
    if (!run) break
    handled.push(run.id)
    const startedAt = Date.now()

    try {
      // The tenant context is the durable path. Request headers are only a
      // fallback for the inline drain on installations where the study predates
      // a tenant, and are never available to the worker.
      let llmContext: LlmContext
      try {
        llmContext = await resolveStudyLlmContext(run.studyId)
      } catch (contextError) {
        // The header fallback belongs ONLY to the study whose request kicked
        // this drain: another study's run billed against these headers would
        // charge the wrong tenant, and a permanent refusal (no active plan)
        // must stay a refusal rather than run on borrowed credentials.
        if (!fallback || fallback.studyId !== run.studyId) throw contextError
        llmContext = { headers: fallback.headers }
      }

      await executeRun({
        runId: run.id,
        studyId: run.studyId,
        stage: run.stage as WhitespaceRunStage,
        scope: readScopeStrict(run.scopeSnapshot),
        params: run.params ?? undefined,
        llmContext,
        startedAt,
        workerId,
        attemptCount: run.attemptCount,
      })
    } catch (error) {
      // A lost lease means another worker legitimately holds the run now;
      // recording a failure here would clobber that worker's live attempt.
      if (isLeaseLost(error)) {
        console.warn(`[Whitespace] Run ${run.id} lost its lease mid-stage; the current holder's attempt stands.`)
        continue
      }
      await recordRunFailure(run, error, workerId)
    }
  }
  return handled
}

/**
 * Fails expired-lease runs whose attempt budget is already spent.
 *
 * The claim's reclaim branch refuses them (attemptCount < maxAttempts), so
 * without this sweep a run whose worker died on its LAST attempt would sit
 * PROCESSING forever — invisible to the queue and stuck "running" for the user.
 */
async function sweepDeadRuns(): Promise<void> {
  const message =
    'The worker running this stage stopped and its retries are spent — run it again when you are ready.'
  try {
    // attemptCount >= maxAttempts is a column-to-column comparison, which the
    // query builder cannot express; expired leases are rare enough to filter here.
    const expired = await prisma.whitespaceRun.findMany({
      where: { status: 'PROCESSING', lockedUntil: { lt: new Date() } },
      select: { id: true, studyId: true, stage: true, params: true, attemptCount: true, maxAttempts: true },
    })
    for (const run of expired) {
      if (run.attemptCount < run.maxAttempts) continue
      const { count } = await prisma.whitespaceRun.updateMany({
        // Re-guarded per row: a racing claim or completion since the read wins.
        where: { id: run.id, status: 'PROCESSING', lockedUntil: { lt: new Date() } },
        data: {
          status: 'FAILED',
          lockedBy: null,
          lockedUntil: null,
          lastError: message,
          completedAt: new Date(),
        },
      })
      if (count > 0) await finalizeRunFailure(run, message)
    }
  } catch (sweepError) {
    console.error('[Whitespace] Dead-run sweep failed:', sweepError)
  }
}

/**
 * The bookkeeping every FINAL failure owes, wherever it is decided — the retry
 * budget running out, a stale-run resolution, or the dead-worker sweep. A
 * VALIDATE run's hypothesis left VALIDATING would sit "Being tested" forever,
 * and the trail entry is how the user learns the stage died at all.
 */
async function finalizeRunFailure(
  run: { id: string; studyId: string; stage: string; params: Prisma.JsonValue | null },
  message: string
): Promise<void> {
  try {
    if (run.stage === 'VALIDATE') {
      const params = (run.params ?? {}) as Record<string, unknown>
      const hypothesisId = typeof params.hypothesisId === 'string' ? params.hypothesisId : ''
      if (hypothesisId) {
        await prisma.whitespaceHypothesis.updateMany({
          where: { id: hypothesisId, studyId: run.studyId, status: 'VALIDATING' },
          data: { status: 'INCONCLUSIVE' },
        })
      }
    }
    await appendTrail(run.studyId, 'RUN', 'system', `${run.stage} failed: ${message.slice(0, 200)}`)
  } catch (finalizeError) {
    console.error('[Whitespace] Could not finalize run failure:', finalizeError)
  }
}

/**
 * Applies the retry budget, or gives up and says so.
 *
 * Fenced on the lease like every other run write: a worker that lost its lease
 * (a hung model call past RUN_LEASE_MS) and then failed for some OTHER reason
 * used to flip the NEW holder's PROCESSING row to QUEUED or FAILED — discarding
 * a live attempt and starting a third. When the fence misses, the current
 * holder's attempt stands and nothing here is recorded.
 *
 * Exported for tests only.
 */
export async function recordRunFailure(run: ClaimedRun, error: unknown, workerId: string): Promise<void> {
  const message = error instanceof Error ? error.message : 'Stage failed.'
  const permanent = isPermanentFailure(error)
  const willRetry = !permanent && run.attemptCount < run.maxAttempts
  console.error('[Whitespace] Run failed:', {
    runId: run.id,
    stage: run.stage,
    attempt: `${run.attemptCount}/${run.maxAttempts}`,
    permanent,
    willRetry,
    message,
  })

  try {
    const delayMs = retryDelayMs(run.attemptCount)
    const { count } = await prisma.whitespaceRun.updateMany({
      where: { id: run.id, lockedBy: workerId, status: 'PROCESSING' },
      data: willRetry
        ? {
            status: 'QUEUED',
            lockedBy: null,
            lockedUntil: null,
            nextAttemptAt: new Date(Date.now() + delayMs),
            lastError: message.slice(0, 2000),
          }
        : {
            status: 'FAILED',
            lockedBy: null,
            lockedUntil: null,
            lastError: message.slice(0, 2000),
            completedAt: new Date(),
          },
    })
    if (count === 0) {
      console.warn(
        `[Whitespace] Run ${run.id} lost its lease before its failure could be recorded; the current holder's attempt stands.`
      )
      return
    }

    if (willRetry) {
      // With no standalone worker, nothing drains later: the inline drain exits
      // when a claim comes back empty, and is only kicked by new POSTs — so a
      // backoff with nobody scheduled to return is a retry that never runs.
      // Exactly one re-kick per recorded failure keeps the chain bounded, and
      // no fallback headers on purpose: the kicking request is long gone.
      const timer = setTimeout(() => kickInlineDrain(), delayMs + 1_000)
      timer.unref?.()
    } else {
      // A hypothesis left VALIDATING would sit "Being tested" forever. Only
      // released once the run is genuinely finished with — a pending retry is
      // still testing.
      await finalizeRunFailure(run, message)
    }
  } catch (persistError) {
    console.error('[Whitespace] Could not record run failure:', persistError)
  }
}

/**
 * In-process drain, at most one at a time.
 *
 * Keeps a single-process install working with no worker deployed, which is how
 * every existing installation runs today. The guard matters: without it a burst
 * of POSTs would start a drain each and multiply the load the queue exists to
 * bound.
 */
let inlineDrainRunning = false
function kickInlineDrain(fallback?: { studyId: string; headers: Record<string, string> }): void {
  if (inlineDrainRunning) return
  inlineDrainRunning = true
  // Host-qualified and salted: two web hosts with the same pid used to share a
  // lockedBy and both pass the lease fence.
  const workerId = `inline-${hostname()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
  setTimeout(() => {
    void (async () => {
      try {
        // Keep draining while there is work, so a queued second stage does not
        // wait for the next request to arrive.
        for (let pass = 0; pass < 20; pass++) {
          const handled = await drainWhitespaceRuns(workerId, 1, fallback)
          if (!handled.length) break
        }
      } catch (error) {
        console.error('[Whitespace] Inline drain failed:', error)
      } finally {
        inlineDrainRunning = false
      }
    })()
  }, 0)
}

type LlmContext = WhitespaceLLMContext

/** The census's real steps, in the order field-map.ts runs its facets. */
const FIELD_MAP_STEPS = [
  { key: 'rule', label: 'Fitting the match rule' },
  { key: 'stage', label: 'Reading every publication the scope matches' },
  { key: 'size', label: 'Counting families' },
  { key: 'trend', label: 'Counting filings by year' },
  { key: 'where', label: 'Counting jurisdictions' },
  { key: 'classes', label: 'Counting classification codes' },
  { key: 'status', label: 'Sorting grants from applications' },
  { key: 'text', label: 'Checking how much text is readable' },
  { key: 'who', label: 'Ranking who is filing' },
  { key: 'narrate', label: 'Writing the plain-English summary' },
]
const FIELD_MAP_COUNTERS = [
  { key: 'families', label: 'Families' },
  { key: 'publications', label: 'Publications' },
  { key: 'claims', label: 'Families with readable claims' },
]

async function executeRun(input: {
  runId: string
  studyId: string
  stage: WhitespaceRunStage
  scope: WhitespaceScope
  llmContext: LlmContext
  params?: Prisma.InputJsonValue
  startedAt: number
  workerId: string
  attemptCount: number
}): Promise<void> {
  const params = (input.params ?? {}) as Record<string, unknown>

  // One reporter per attempt. Closed — awaited — BEFORE the completion write,
  // so no late narration flush can trip the status fence after the run is
  // no longer PROCESSING.
  const reporter = new RunReporter({
    runId: input.runId,
    workerId: input.workerId,
    stage: input.stage,
    attempt: input.attemptCount,
  })

  let results!: Prisma.InputJsonValue
  let gateCounts: Prisma.InputJsonValue | undefined
  let trailSummary!: string

  try {
  switch (input.stage) {
    case 'FIELD_MAP': {
      await reporter.plan(FIELD_MAP_STEPS, FIELD_MAP_COUNTERS)
      await reporter.step('rule', 'Fitting the match rule against the corpus')
      // A producer: fits the match rule fresh and persists it on the result,
      // where every later stage of this scope reads it back.
      const { resolveFieldDefinition } = await import('./field-definition')
      const { candidateCoverageNote } = await import('./candidates')
      const field = await resolveFieldDefinition(input.scope, { studyId: input.studyId, reuse: false })
      const result = await runFieldMap(input.scope, {
        candidateIds: field.candidates.ids,
        candidateNote: candidateCoverageNote(field.candidates),
        fieldRule: field.rule,
        reporter,
      })
      await reporter.step('narrate', 'Summarising the census in plain English')
      const narrative = await narrateField({
        scope: input.scope,
        result,
        llmContext: input.llmContext,
      })
      if (!narrative) await reporter.fail('narrate', 'summary unavailable — the census stands on its numbers')
      reporter.done()
      results = { ...result, narrative } as unknown as Prisma.InputJsonValue
      gateCounts = result.gateCounts as unknown as Prisma.InputJsonValue
      trailSummary = `Field map complete — ${result.familyCount.toLocaleString()} families, ${Math.round(
        (result.textCoverage.withClaims / Math.max(1, result.familyCount)) * 100
      )}% claim coverage`
      break
    }
    case 'CLUSTER': {
      const { runClusterStage } = await import('./cluster-stage')
      const result = await runClusterStage({
        runId: input.runId,
        workerId: input.workerId,
        reporter,
        studyId: input.studyId,
        scope: input.scope,
        llmContext: input.llmContext,
      })
      results = result as unknown as Prisma.InputJsonValue
      trailSummary = `Area map complete — ${result.clusterCount} areas from a ${result.sampledFamilies.toLocaleString()}-family sample`
      break
    }
    case 'SIGNALS': {
      const { runSignalsStage } = await import('./signals-stage')
      const result = await runSignalsStage({
        runId: input.runId,
        workerId: input.workerId,
        reporter,
        studyId: input.studyId,
        scope: input.scope,
      })
      results = result as unknown as Prisma.InputJsonValue
      trailSummary = `Signals computed for ${result.clustersScored} areas${
        result.divergence.some(entry => entry.divergent) ? ' — terminology divergence detected' : ''
      }`
      break
    }
    case 'DEEP_DIVE': {
      const clusterId = typeof params.clusterId === 'string' ? params.clusterId : ''
      if (!clusterId) throw new Error('A deep dive needs the area to read (clusterId).')
      const { runDeepDiveStage } = await import('./deep-dive-stage')
      const result = await runDeepDiveStage({
        runId: input.runId,
        workerId: input.workerId,
        reporter,
        studyId: input.studyId,
        clusterId,
        llmContext: input.llmContext,
      })
      results = result as unknown as Prisma.InputJsonValue
      trailSummary = `Deep dive on "${result.clusterLabel}" — ${result.familiesExtracted} of ${result.familiesConsidered} families read at claim level`
      break
    }
    case 'VALIDATE': {
      const hypothesisId = typeof params.hypothesisId === 'string' ? params.hypothesisId : ''
      if (!hypothesisId) throw new Error('Validation needs the hypothesis to attack (hypothesisId).')
      const { runValidateStage } = await import('./validate-stage')
      const result = await runValidateStage({
        runId: input.runId,
        workerId: input.workerId,
        reporter,
        studyId: input.studyId,
        hypothesisId,
        scope: input.scope,
        llmContext: input.llmContext,
      })
      results = result as unknown as Prisma.InputJsonValue
      trailSummary = `Validation finished — ${result.attacksRun} attacks run, outcome ${result.status}${
        result.confidence !== null ? ` (confidence ${result.confidence})` : ''
      }`
      break
    }
    case 'DIMENSION_MAP': {
      const { runDimensionMapStage } = await import('./dimension-stage')
      // params.registry carries a user-edited registry for a re-census; its
      // absence means full discovery.
      const suppliedRegistry =
        params.registry && typeof params.registry === 'object' && Array.isArray((params.registry as { dimensions?: unknown }).dimensions)
          ? (params.registry as { dimensions: Array<{ label: string; description?: string; values: Array<{ label: string; synonyms: string[] }> }> })
          : null
      const result = await runDimensionMapStage({
        runId: input.runId,
        workerId: input.workerId,
        reporter,
        studyId: input.studyId,
        scope: input.scope,
        llmContext: input.llmContext,
        suppliedRegistry,
      })
      results = result as unknown as Prisma.InputJsonValue
      // Same rule as the field census: only measured steps are reported. The
      // dimension census stages the scope in one pass too, so the pre-filter and
      // pre-concept populations do not exist — repeating the post-gate count
      // three times dressed one measurement up as a three-step funnel.
      gateCounts = {
        corpus: null,
        afterFilters: null,
        afterConcepts: result.publicationCount,
        families: result.familyCount,
      } as unknown as Prisma.InputJsonValue
      trailSummary = `Dimension map complete — ${result.registry.length} viewpoints, ${result.gaps.length} candidate gaps, ${Math.round(
        result.unclassifiedShare * 100
      )}% of the field unplaced`
      break
    }
    default:
      throw new Error(`Stage ${input.stage} is not implemented yet.`)
  }
  } catch (error) {
    // A lease already lost wins over whatever the stage tripped on afterwards:
    // the failure must not be recorded against the new holder's attempt.
    if (isLeaseLost(reporter.fatal)) throw reporter.fatal
    throw error
  } finally {
    await reporter.close()
  }

  // Fenced on the lease, like the heartbeat: if another worker reclaimed this
  // run mid-stage, its attempt is the live one, and writing our snapshot over
  // it would bury whatever that worker goes on to produce.
  const completion = await prisma.whitespaceRun.updateMany({
    where: { id: input.runId, lockedBy: input.workerId, status: 'PROCESSING' },
    data: {
      status: 'COMPLETED',
      results,
      gateCounts,
      durationMs: Date.now() - input.startedAt,
      completedAt: new Date(),
      heartbeatAt: new Date(),
      lastError: null,
      progress: Prisma.DbNull,
    },
  })
  if (completion.count === 0) {
    console.warn(
      `[Whitespace] Run ${input.runId} finished after its lease was lost — result discarded, the current holder's attempt stands.`
    )
    return
  }

  try {
    await appendTrail(input.studyId, 'RUN', 'system', trailSummary)
  } catch (trailError) {
    // The run is COMPLETED; a failed trail insert must not requeue or fail it.
    console.error('[Whitespace] Could not append run trail entry:', trailError)
  }
}

/** Client-facing shape for a run row, used by both the start and poll routes. */
export function runPayload(row: {
  id: string
  stage: string
  status: string
  results: Prisma.JsonValue | null
  gateCounts: Prisma.JsonValue | null
  progress?: Prisma.JsonValue | null
  lastError: string | null
  durationMs: number | null
  createdAt: Date
  completedAt: Date | null
  attemptCount?: number
  maxAttempts?: number
  nextAttemptAt?: Date | null
  heartbeatAt?: Date | null
}) {
  const now = Date.now()
  const processing = row.status === 'PROCESSING'
  const progress = processing ? ((row.progress as WhitespaceRunProgress | null) ?? null) : null
  // The attempt's own start: the reporter stamps it on its first write, and
  // until then the claim's heartbeatAt is that moment. Never createdAt — that
  // includes queue wait, backoff and earlier attempts.
  const attemptStartedAt = progress?.startedAt ?? (processing ? row.heartbeatAt?.getTime() ?? null : null)
  return {
    runId: row.id,
    stage: row.stage,
    status: row.status,
    results: row.status === 'COMPLETED' ? row.results : null,
    gateCounts: row.gateCounts,
    // Live narration is readable while PROCESSING; results stay hidden until
    // COMPLETED — partial results are never exposed, narration is.
    progress,
    error: row.lastError,
    durationMs: row.durationMs,
    startedAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    attempt: row.attemptCount ?? null,
    maxAttempts: row.maxAttempts ?? null,
    nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
    heartbeatAt: row.heartbeatAt?.toISOString() ?? null,
    // Server clock, so a client can measure silence without trusting its own.
    serverNow: new Date(now).toISOString(),
    elapsedMs: processing && attemptStartedAt !== null ? Math.max(0, now - attemptStartedAt) : null,
  }
}
