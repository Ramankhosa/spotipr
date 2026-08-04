/**
 * Whitespace Studio — service layer.
 *
 * Owns study lifecycle, scope compilation, and run orchestration. Long stages
 * answer 202 and are polled, following the Prior-Art Studio pattern: a deep
 * census outlives reverse-proxy read timeouts, so the request must not be held
 * open waiting for it.
 */

import { Prisma, TaskCode } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { runFieldMap } from './field-map'
import { buildFieldNarrationPrompt, buildScopeCompilePrompt, WS_SCOPE_STAGE_CODE } from './prompts'
import { normalizeScope, scopeIsRunnable, validateWhitespaceScope } from './scope-schema'
import {
  CORPUS_FIRST_YEAR,
  emptyWhitespaceScope,
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

export async function getOwnedStudy(studyId: string, userId: string) {
  const study = await prisma.whitespaceStudy.findUnique({ where: { id: studyId } })
  if (!study || study.userId !== userId) return null
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
  requestHeaders: Record<string, string>
}): Promise<string | null> {
  try {
    const { llmGateway } = await import('@/lib/metering/gateway')
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

    const attempt = await llmGateway.executeLLMOperation(
      { headers: input.requestHeaders },
      { taskCode: TaskCode.WS_SCOPE, prompt }
    )
    return attempt.success && attempt.response?.output ? attempt.response.output.trim() : null
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

export async function resolveStaleRun<T extends { id: string; status: string; createdAt: Date; heartbeatAt?: Date | null }>(
  row: T
): Promise<T> {
  const live = row.status === 'QUEUED' || row.status === 'PROCESSING'
  // Staleness is measured from the last heartbeat, not creation: legitimate long
  // stages (a deep dive is many model calls) beat regularly, while a run lost to
  // a restart goes silent and gets failed here on next read.
  const lastSignal = Math.max(row.createdAt.getTime(), row.heartbeatAt?.getTime() ?? 0)
  if (!live || Date.now() - lastSignal < WHITESPACE_RUN_STALE_MS) return row
  const failed = await prisma.whitespaceRun.update({
    where: { id: row.id },
    data: {
      status: 'FAILED',
      lastError: 'The server restarted or the run exceeded its time budget — run this stage again.',
      completedAt: new Date(),
    },
  })
  return failed as unknown as T
}

/**
 * Starts a stage as a detached run and returns immediately.
 *
 * Deliberately the lightweight pattern rather than the lease queue: the census
 * is minutes, not tens of minutes, and a lost run is recovered by resolveStaleRun
 * plus a re-run rather than by a worker retry. Deep dives and validation, which
 * are longer and more expensive, move to the durable queue when they land.
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
    if (
      (resolved.status === 'QUEUED' || resolved.status === 'PROCESSING') &&
      JSON.stringify(resolved.params ?? null) === JSON.stringify(input.params ?? null)
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
      status: 'PROCESSING',
      heartbeatAt: new Date(),
      attemptCount: 1,
    },
  })

  setTimeout(() => {
    void executeRun({ ...input, runId: run.id }).catch(async error => {
      const message = error instanceof Error ? error.message : 'Stage failed.'
      console.error('[Whitespace] Run failed:', { runId: run.id, stage: input.stage, message })
      try {
        if (input.stage === 'VALIDATE') {
          const params = (input.params ?? {}) as Record<string, unknown>
          const hypothesisId = typeof params.hypothesisId === 'string' ? params.hypothesisId : ''
          if (hypothesisId) {
            await prisma.whitespaceHypothesis.updateMany({
              where: { id: hypothesisId, studyId: input.studyId, status: 'VALIDATING' },
              data: { status: 'INCONCLUSIVE' },
            })
          }
        }
        await prisma.whitespaceRun.update({
          where: { id: run.id },
          data: { status: 'FAILED', lastError: message.slice(0, 2000), completedAt: new Date() },
        })
        await appendTrail(input.studyId, 'RUN', 'system', `${input.stage} failed: ${message.slice(0, 200)}`)
      } catch (persistError) {
        console.error('[Whitespace] Could not record run failure:', persistError)
      }
    })
  }, 0)

  return { runId: run.id, existing: false }
}

async function executeRun(input: {
  runId: string
  studyId: string
  stage: WhitespaceRunStage
  scope: WhitespaceScope
  requestHeaders: Record<string, string>
  params?: Prisma.InputJsonValue
}): Promise<void> {
  const startedAt = Date.now()
  const params = (input.params ?? {}) as Record<string, unknown>

  let results: Prisma.InputJsonValue
  let gateCounts: Prisma.InputJsonValue | undefined
  let trailSummary: string

  switch (input.stage) {
    case 'FIELD_MAP': {
      const result = await runFieldMap(input.scope)
      const narrative = await narrateField({
        scope: input.scope,
        result,
        requestHeaders: input.requestHeaders,
      })
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
        studyId: input.studyId,
        scope: input.scope,
        requestHeaders: input.requestHeaders,
      })
      results = result as unknown as Prisma.InputJsonValue
      trailSummary = `Area map complete — ${result.clusterCount} areas from a ${result.sampledFamilies.toLocaleString()}-family sample`
      break
    }
    case 'SIGNALS': {
      const { runSignalsStage } = await import('./signals-stage')
      const result = await runSignalsStage({
        runId: input.runId,
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
        studyId: input.studyId,
        clusterId,
        requestHeaders: input.requestHeaders,
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
        studyId: input.studyId,
        hypothesisId,
        scope: input.scope,
        requestHeaders: input.requestHeaders,
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
        studyId: input.studyId,
        scope: input.scope,
        requestHeaders: input.requestHeaders,
        suppliedRegistry,
      })
      results = result as unknown as Prisma.InputJsonValue
      gateCounts = {
        corpus: result.publicationCount,
        afterFilters: result.publicationCount,
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

  await prisma.whitespaceRun.update({
    where: { id: input.runId },
    data: {
      status: 'COMPLETED',
      results,
      gateCounts,
      durationMs: Date.now() - startedAt,
      completedAt: new Date(),
      heartbeatAt: new Date(),
    },
  })

  await appendTrail(input.studyId, 'RUN', 'system', trailSummary)
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
}) {
  return {
    runId: row.id,
    stage: row.stage,
    status: row.status,
    results: row.status === 'COMPLETED' ? row.results : null,
    gateCounts: row.gateCounts,
    // Live narration is readable while PROCESSING; results stay hidden until
    // COMPLETED — partial results are never exposed, narration is.
    progress: row.status === 'PROCESSING' ? (row.progress ?? null) : null,
    error: row.lastError,
    durationMs: row.durationMs,
    startedAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  }
}
