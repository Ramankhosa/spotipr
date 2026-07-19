import { prisma } from '@/lib/prisma'
import { patentSearchOrchestrator } from '@/lib/patent-search'
import { getSettingsWithOverride } from './settings-service'
import type { NormalizedPatentResult } from '@/lib/patent-search/types'

// Calibration harness for retrieval tuning.
//
// Re-runs ONLY retrieval + rerank for a set of past novelty searches under a candidate
// configuration, and reports what changed against a baseline. The LLM stages are
// deliberately not executed: they are the expensive part of a novelty run, and none of
// the knobs being tuned here change their behaviour except by changing what reaches
// them. So a calibration sweep costs embedding + rerank calls, not deep analysis.
//
// The output that matters is the rerank score distribution. `rerank.minScore` is the
// only absolute cutoff in the pipeline, and the honest way to pick it is to look at
// where real prior art separates from filler across a benchmark set — not to guess.

export interface CalibrationSearchResult {
  searchId: string
  title: string
  ok: boolean
  error?: string
  candidateCount: number
  /** Rerank score percentiles across the returned candidates. */
  scores: {
    max: number | null
    p75: number | null
    median: number | null
    p25: number | null
    min: number | null
  }
  /** Publication numbers, in rank order, capped for storage. */
  topPublicationNumbers: string[]
  droppedBelowFloor: number
  usedFallbackProviders: boolean
  durationMs: number
}

export interface CalibrationComparison {
  searchId: string
  /** Candidates present in both runs, as a fraction of the baseline set. */
  overlapRatio: number
  baselineCount: number
  candidateCount: number
  /** Publication numbers this config found that the baseline did not. */
  gained: string[]
  /** Publication numbers the baseline found that this config lost. */
  lost: string[]
}

export interface CalibrationResults {
  searches: CalibrationSearchResult[]
  summary: {
    searchCount: number
    okCount: number
    meanCandidateCount: number
    /** Pooled score percentiles across every search in the set. */
    pooledScores: CalibrationSearchResult['scores']
    totalDroppedBelowFloor: number
    meanDurationMs: number
  }
  comparison?: {
    baselineRunId: string
    perSearch: CalibrationComparison[]
    meanOverlapRatio: number
  }
}

const MAX_STORED_PUBLICATION_NUMBERS = 60

function percentile(sortedDesc: number[], fraction: number): number | null {
  if (!sortedDesc.length) return null
  const index = Math.min(sortedDesc.length - 1, Math.floor((sortedDesc.length - 1) * fraction))
  const value = sortedDesc[index]
  return Number.isFinite(value) ? Number(value.toFixed(4)) : null
}

function scoreBand(scores: number[]): CalibrationSearchResult['scores'] {
  const sorted = [...scores].sort((a, b) => b - a)
  return {
    max: percentile(sorted, 0),
    p75: percentile(sorted, 0.25),
    median: percentile(sorted, 0.5),
    p25: percentile(sorted, 0.75),
    min: percentile(sorted, 1),
  }
}

function candidateScore(result: NormalizedPatentResult) {
  // rerankScore when reranking ran; otherwise the fused retrieval score, so a run with
  // reranking disabled still produces a distribution (just not a comparable one).
  const value = result.rerankScore ?? result.relevanceScore ?? 0
  return Number.isFinite(value) ? Number(value) : 0
}

/**
 * Replay one saved search's retrieval under `settings`.
 *
 * The stored approved Stage 0 plan is reused verbatim so the query is identical to the
 * original run — only the tuning differs. Without that, a comparison would be
 * confounded by query drift.
 */
async function replaySearch(
  searchId: string,
  settingsOverride: Record<string, unknown>
): Promise<CalibrationSearchResult> {
  const startedAt = Date.now()
  const base: CalibrationSearchResult = {
    searchId,
    title: '',
    ok: false,
    candidateCount: 0,
    scores: { max: null, p75: null, median: null, p25: null, min: null },
    topPublicationNumbers: [],
    droppedBelowFloor: 0,
    usedFallbackProviders: false,
    durationMs: 0,
  }

  try {
    const run = await prisma.noveltySearchRun.findUnique({
      where: { id: searchId },
      select: {
        id: true,
        title: true,
        inventionDescription: true,
        jurisdiction: true,
        config: true,
        stage0Results: true,
      },
    })
    if (!run) return { ...base, error: 'Search run not found.', durationMs: Date.now() - startedAt }

    base.title = run.title || ''
    const stage0 = (run.stage0Results || {}) as any
    const config = (run.config || {}) as any
    const searchSource = config.searchSource || {}
    const searchQuery = String(stage0.searchQuery || '').trim()
    if (!searchQuery) {
      return { ...base, error: 'Run has no approved Stage 0 query to replay.', durationMs: Date.now() - startedAt }
    }

    const settings = await getSettingsWithOverride(settingsOverride)
    const candidateLimit = typeof settings['analysis.candidateLimit'] === 'number'
      ? settings['analysis.candidateLimit'] as number
      : 180
    const maxPatents = typeof settings['analysis.maxPatents'] === 'number'
      ? settings['analysis.maxPatents'] as number
      : 50

    const response = await patentSearchOrchestrator.search({
      searchMode: 'intelligent',
      query: searchQuery,
      title: run.title || '',
      inventionText: run.inventionDescription || '',
      filters: searchSource.filters || {},
      providerIds: searchSource.providerIds,
      jurisdictions: Array.isArray(searchSource.filters?.countries) && searchSource.filters.countries.length
        ? searchSource.filters.countries
        : [run.jurisdiction || 'IN'],
      sourceMode: searchSource.mode,
      llmExpansion: false,
      queryPlan: {
        searchQuery,
        normalizedQuery: searchQuery,
        semanticQuery: String(stage0.semanticQuery || searchQuery),
        inventionFeatures: Array.isArray(stage0.inventionFeatures) ? stage0.inventionFeatures : [],
        cpcCodes: Array.isArray(stage0.cpcCodes) ? stage0.cpcCodes : [],
        ipcCodes: Array.isArray(stage0.ipcCodes) ? stage0.ipcCodes : [],
        fieldFilters: searchSource.filters || {},
      },
      limit: maxPatents,
      candidateLimit,
      // Calibration measures the corpus, so a live-API fallback would contaminate the
      // comparison with results the tuning knobs do not control.
      disableProviderFallback: true,
      suppressSensitiveLogging: true,
    } as any)

    const candidates = response.candidateResults || response.results || []
    const scores = candidates.map(candidateScore).filter(score => score > 0)

    return {
      ...base,
      ok: true,
      candidateCount: candidates.length,
      scores: scoreBand(scores),
      topPublicationNumbers: candidates
        .slice(0, MAX_STORED_PUBLICATION_NUMBERS)
        .map(result => String(result.publicationNumber || ''))
        .filter(Boolean),
      droppedBelowFloor: Number(response.diagnostics?.droppedBelowFloor || 0),
      usedFallbackProviders: Boolean(response.diagnostics?.usedFallbackProviders),
      durationMs: Date.now() - startedAt,
    }
  } catch (error) {
    return {
      ...base,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
    }
  }
}

function compareToBaseline(
  current: CalibrationSearchResult[],
  baseline: CalibrationSearchResult[]
): { perSearch: CalibrationComparison[]; meanOverlapRatio: number } {
  const baselineById = new Map(baseline.map(entry => [entry.searchId, entry]))
  const perSearch: CalibrationComparison[] = []

  for (const entry of current) {
    const base = baselineById.get(entry.searchId)
    if (!base) continue
    const baseSet = new Set(base.topPublicationNumbers)
    const currentSet = new Set(entry.topPublicationNumbers)
    const shared = entry.topPublicationNumbers.filter(pn => baseSet.has(pn))
    perSearch.push({
      searchId: entry.searchId,
      baselineCount: base.topPublicationNumbers.length,
      candidateCount: entry.topPublicationNumbers.length,
      overlapRatio: baseSet.size ? Number((shared.length / baseSet.size).toFixed(3)) : 0,
      gained: entry.topPublicationNumbers.filter(pn => !baseSet.has(pn)).slice(0, 20),
      lost: base.topPublicationNumbers.filter(pn => !currentSet.has(pn)).slice(0, 20),
    })
  }

  const meanOverlapRatio = perSearch.length
    ? Number((perSearch.reduce((sum, entry) => sum + entry.overlapRatio, 0) / perSearch.length).toFixed(3))
    : 0
  return { perSearch, meanOverlapRatio }
}

/**
 * Run a calibration sweep. Searches are replayed sequentially: they contend for the
 * same Postgres and Voyage capacity as live traffic, and a calibration run must never
 * be the reason a user's search times out.
 */
export async function runCalibration(params: {
  label: string
  searchIds: string[]
  configOverride: Record<string, unknown>
  baselineRunId?: string
  createdBy?: string
}) {
  const searchIds = Array.from(new Set(params.searchIds.filter(Boolean))).slice(0, 25)
  if (!searchIds.length) throw new Error('Select at least one search to calibrate against.')

  const run = await prisma.retrievalCalibrationRun.create({
    data: {
      label: params.label,
      configJson: params.configOverride as any,
      searchIds,
      baselineId: params.baselineRunId || null,
      status: 'RUNNING',
      createdBy: params.createdBy,
    },
  })

  try {
    const searches: CalibrationSearchResult[] = []
    for (const searchId of searchIds) {
      searches.push(await replaySearch(searchId, params.configOverride))
    }

    const ok = searches.filter(entry => entry.ok)
    const pooled = scoreBand(
      ok.flatMap(entry => [entry.scores.max, entry.scores.median, entry.scores.min]
        .filter((value): value is number => typeof value === 'number'))
    )

    const results: CalibrationResults = {
      searches,
      summary: {
        searchCount: searches.length,
        okCount: ok.length,
        meanCandidateCount: ok.length
          ? Math.round(ok.reduce((sum, entry) => sum + entry.candidateCount, 0) / ok.length)
          : 0,
        pooledScores: pooled,
        totalDroppedBelowFloor: searches.reduce((sum, entry) => sum + entry.droppedBelowFloor, 0),
        meanDurationMs: ok.length
          ? Math.round(ok.reduce((sum, entry) => sum + entry.durationMs, 0) / ok.length)
          : 0,
      },
    }

    if (params.baselineRunId) {
      const baseline = await prisma.retrievalCalibrationRun.findUnique({
        where: { id: params.baselineRunId },
        select: { resultsJson: true },
      })
      const baselineSearches = (baseline?.resultsJson as any)?.searches as CalibrationSearchResult[] | undefined
      if (Array.isArray(baselineSearches)) {
        results.comparison = {
          baselineRunId: params.baselineRunId,
          ...compareToBaseline(searches, baselineSearches),
        }
      }
    }

    await prisma.retrievalCalibrationRun.update({
      where: { id: run.id },
      data: { status: 'COMPLETED', resultsJson: results as any, completedAt: new Date() },
    })

    return { id: run.id, results }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await prisma.retrievalCalibrationRun.update({
      where: { id: run.id },
      data: { status: 'FAILED', error: message, completedAt: new Date() },
    })
    throw error
  }
}

export async function listCalibrationRuns(limit = 20) {
  return prisma.retrievalCalibrationRun.findMany({
    orderBy: { startedAt: 'desc' },
    take: Math.max(1, Math.min(100, limit)),
    select: {
      id: true, label: true, status: true, error: true, configJson: true,
      searchIds: true, baselineId: true, startedAt: true, completedAt: true, createdBy: true,
    },
  })
}

export async function getCalibrationRun(id: string) {
  return prisma.retrievalCalibrationRun.findUnique({ where: { id } })
}

/** Recent completed novelty searches, offered as the benchmark set in the UI. */
export async function listBenchmarkCandidates(limit = 40) {
  const runs = await prisma.noveltySearchRun.findMany({
    where: { stage0Results: { not: null as any } },
    orderBy: { createdAt: 'desc' },
    take: Math.max(1, Math.min(100, limit)),
    select: { id: true, title: true, jurisdiction: true, createdAt: true, status: true },
  })
  return runs
}
