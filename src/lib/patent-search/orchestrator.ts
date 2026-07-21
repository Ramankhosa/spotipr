import type {
  NormalizedPatentResult,
  PatentSearchQueryPlan,
  PatentSearchProviderId,
  PatentSearchProviderStats,
  PatentSearchRequest,
  PatentSearchResponse,
} from './types'
import { createPatentSearchQueryPlan } from './query-planner'
import {
  getPatentSearchProvider,
  listPatentSearchProviders,
  resolveFallbackProviderIds,
  resolveProviderIds,
} from './provider-registry'
import { canonicalPatentResultKey, clampLimit, uniqueStrings } from './utils'
import { compactLogDetails } from './provider-runtime'
import { isVoyageRerankerEnabled, rerankItems } from '@/lib/voyage-reranker-service'
import { getSettings } from '@/lib/settings/settings-service'
import { getProviderAccessGates } from '@/lib/settings/provider-access-service'

function logSearchEvent(event: string, details: Record<string, unknown>) {
  console.info('[PatentSearch]', JSON.stringify(compactLogDetails({ event, ...details })))
}

/**
 * Cross-encoders expect a natural-language information need, not the lexical
 * syntax sent to `websearch_to_tsquery` (for example `torque OR clutch`).
 */
export function rerankQueryForPlan(queryPlan: Partial<PatentSearchQueryPlan>, fallbackQuery = '') {
  return String(
    queryPlan.semanticQuery ||
    queryPlan.originalQuery ||
    queryPlan.searchQuery ||
    fallbackQuery ||
    ''
  ).replace(/\s+/g, ' ').trim()
}

function resultLogSummary(result: NormalizedPatentResult) {
  return {
    publicationNumber: result.publicationNumber,
    title: result.title,
    relevanceScore: result.relevanceScore,
    sourceProvider: result.sourceProvider,
    sourceProviders: result.sourceProviders,
  }
}

function normalizeCombinedScores(results: NormalizedPatentResult[]) {
  const max = Math.max(...results.map(result => result.hybridScore || 0), 0.0001)
  return results.map(result => {
    const normalized = Math.max(0.01, Math.min(0.99, (result.hybridScore || 0) / max))
    return {
      ...result,
      relevanceScore: result.relevanceScore ?? Number(normalized.toFixed(3)),
      scores: {
        ...(result.scores || {}),
        hybrid: normalized,
      },
    }
  })
}

function hasMetadataValue(value: unknown) {
  if (value === undefined || value === null) return false
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'string') return value.trim() !== '' && value.trim() !== '-'
  return true
}

function firstMetadataValue(...values: unknown[]) {
  return values.find(hasMetadataValue)
}

function mergeStringArrays(...values: unknown[]) {
  return uniqueStrings(values.flatMap(value => {
    if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean)
    if (typeof value === 'string' && value.trim()) return [value.trim()]
    return []
  }))
}

function enrichPatentMetadata(
  chosen: NormalizedPatentResult,
  current: NormalizedPatentResult | undefined,
  result: NormalizedPatentResult
): NormalizedPatentResult {
  const merged: any = { ...chosen }
  const currentRaw: any = current?.raw || {}
  const resultRaw: any = result.raw || {}
  const chosenRaw: any = chosen.raw || {}

  merged.applicationNumber = firstMetadataValue(
    chosen.applicationNumber,
    (chosen as any).application_number,
    chosen.applicationNumberRaw,
    current?.applicationNumber,
    (current as any)?.application_number,
    current?.applicationNumberRaw,
    result.applicationNumber,
    (result as any).application_number,
    result.applicationNumberRaw,
    chosenRaw.applicationNumberRaw,
    currentRaw.applicationNumberRaw,
    resultRaw.applicationNumberRaw
  ) as any
  merged.applicationNumberRaw = firstMetadataValue(
    chosen.applicationNumberRaw,
    current?.applicationNumberRaw,
    result.applicationNumberRaw,
    chosenRaw.applicationNumberRaw,
    currentRaw.applicationNumberRaw,
    resultRaw.applicationNumberRaw,
    merged.applicationNumber
  ) as any
  merged.publicationDate = firstMetadataValue(
    chosen.publicationDate,
    (chosen as any).publication_date,
    current?.publicationDate,
    (current as any)?.publication_date,
    result.publicationDate,
    (result as any).publication_date,
    chosenRaw.publicationDate,
    currentRaw.publicationDate,
    resultRaw.publicationDate
  ) as any
  merged.filingDate = firstMetadataValue(
    chosen.filingDate,
    (chosen as any).filing_date,
    (chosen as any).applicationDate,
    current?.filingDate,
    (current as any)?.filing_date,
    (current as any)?.applicationDate,
    result.filingDate,
    (result as any).filing_date,
    (result as any).applicationDate,
    chosenRaw.filingDate,
    currentRaw.filingDate,
    resultRaw.filingDate
  ) as any
  merged.abstract = firstMetadataValue(chosen.abstract, current?.abstract, result.abstract, chosenRaw.abstract, currentRaw.abstract, resultRaw.abstract) as any
  merged.snippet = firstMetadataValue(chosen.snippet, current?.snippet, result.snippet, merged.abstract) as any
  merged.applicants = firstMetadataValue(chosen.applicants, (chosen as any).assignees, current?.applicants, (current as any)?.assignees, result.applicants, (result as any).assignees, chosenRaw.applicants, currentRaw.applicants, resultRaw.applicants) as any
  ;(merged as any).assignees = firstMetadataValue((chosen as any).assignees, chosen.applicants, (current as any)?.assignees, current?.applicants, (result as any).assignees, result.applicants, chosenRaw.applicants, currentRaw.applicants, resultRaw.applicants)
  merged.inventors = mergeStringArrays(chosen.inventors, current?.inventors, result.inventors, chosenRaw.inventors, currentRaw.inventors, resultRaw.inventors)
  merged.classifications = mergeStringArrays(chosen.classifications, current?.classifications, result.classifications, chosenRaw.classifications, currentRaw.classifications, resultRaw.classifications)
  merged.cpcCodes = mergeStringArrays(chosen.cpcCodes, current?.cpcCodes, result.cpcCodes, (chosen as any).cpc_codes, (current as any)?.cpc_codes, (result as any).cpc_codes)
  merged.ipcCodes = mergeStringArrays(chosen.ipcCodes, current?.ipcCodes, result.ipcCodes, (chosen as any).ipc_codes, (current as any)?.ipc_codes, (result as any).ipc_codes)
  return merged as NormalizedPatentResult
}

function mergeProviderResults(providerResults: Array<{ providerId: PatentSearchProviderId; results: NormalizedPatentResult[] }>, limit: number) {
  const byKey = new Map<string, NormalizedPatentResult>()
  const scores = new Map<string, number>()

  for (const providerResult of providerResults) {
    providerResult.results.forEach((result, index) => {
      const key = canonicalPatentResultKey(result)
      const current = byKey.get(key)
      const currentScore = scores.get(key) || 0
      const providerWeight = providerResult.providerId === 'indian-corpus' ? 1.08 : 1
      const providerScore = providerWeight / (60 + index + 1)
      const sourceProviders = uniqueStrings([
        ...(current?.sourceProviders || (current?.sourceProvider ? [current.sourceProvider] : [])),
        ...(result.sourceProviders || [result.sourceProvider]),
      ]) as PatentSearchProviderId[]
      const chosen = !current || (result.relevanceScore || 0) > (current.relevanceScore || 0)
        ? result
        : current
      const enriched = enrichPatentMetadata(chosen, current, result)

      byKey.set(key, {
        ...enriched,
        sourceProviders,
        sourceProvider: enriched.sourceProvider,
        matchedFields: uniqueStrings([...(current?.matchedFields || []), ...(result.matchedFields || [])]),
        matchedFeatures: uniqueStrings([...(current?.matchedFeatures || []), ...(result.matchedFeatures || [])]),
        matchReasons: uniqueStrings([...(current?.matchReasons || []), ...(result.matchReasons || [])]),
        retrievalMatches: [
          ...(current?.retrievalMatches || []),
          ...(result.retrievalMatches || []),
        ].slice(0, 12),
        retrievalScore: Math.max(current?.retrievalScore || 0, result.retrievalScore || 0) || undefined,
        scores: {
          ...(current?.scores || {}),
          ...(result.scores || {}),
          ...(enriched.scores || {}),
        },
      })
      scores.set(key, currentScore + providerScore)
    })
  }

  const ranked = Array.from(byKey.entries())
    .map(([key, result]) => ({
      ...result,
      hybridScore: Number((scores.get(key) || result.hybridScore || 0).toFixed(6)),
    }))
    .sort((a, b) => (b.hybridScore || 0) - (a.hybridScore || 0))

  // A single large corpus must not crowd every other selected source out of the
  // bounded candidate pool. Reserve the best distinct hit from each source,
  // then fill the rest in global rank order.
  const promoted: NormalizedPatentResult[] = []
  const promotedKeys = new Set<string>()
  for (const { providerId } of providerResults) {
    const candidate = ranked.find(result => {
      const sources = result.sourceProviders || [result.sourceProvider]
      return sources.includes(providerId) && !promotedKeys.has(canonicalPatentResultKey(result))
    })
    if (!candidate) continue
    promoted.push(candidate)
    promotedKeys.add(canonicalPatentResultKey(candidate))
  }
  const merged = [
    ...promoted,
    ...ranked.filter(result => !promotedKeys.has(canonicalPatentResultKey(result))),
  ].slice(0, limit)

  return normalizeCombinedScores(merged)
}

export class PatentSearchOrchestrator {
  getProviders() {
    return listPatentSearchProviders()
  }

  async search(input: PatentSearchRequest): Promise<PatentSearchResponse> {
    // deepSearch trades wall-clock for recall: a supervised attorney search can
    // take 30-60s, so its ceilings are set by usefulness, not snappiness.
    const limit = clampLimit(input.limit, 20, input.deepSearch ? 200 : 100)
    const candidateLimit = Math.max(limit, clampLimit(input.candidateLimit ?? limit, limit, input.deepSearch ? 1200 : 300))
    const queryPlan = await createPatentSearchQueryPlan(input)
    // Runtime tuning + admin provider gates, resolved once so the whole search runs
    // under one consistent configuration. Both fail open to code defaults.
    const [settings, accessGates] = await Promise.all([
      getSettings().catch(() => ({} as Record<string, number | boolean>)),
      getProviderAccessGates().catch(() => ({
        disabled: new Set<PatentSearchProviderId>(),
        fallbackBlocked: new Set<PatentSearchProviderId>(),
      })),
    ])
    const providerIds = resolveProviderIds({
      providerIds: input.providerIds,
      sourceMode: input.sourceMode,
      jurisdictions: input.jurisdictions,
      disableLinkedProviderExpansion: input.disableLinkedProviderExpansion,
      adminDisabled: accessGates.disabled,
    })
    const warnings = [...queryPlan.warnings]
    const providerStats: PatentSearchProviderStats[] = []
    const providerResults: Array<{ providerId: PatentSearchProviderId; results: NormalizedPatentResult[] }> = []
    const suppressSensitiveLogging = input.suppressSensitiveLogging === true

    logSearchEvent('dispatch', {
      searchMode: input.searchMode,
      sourceMode: input.sourceMode,
      providerIds,
      query: suppressSensitiveLogging ? undefined : queryPlan.searchQuery,
      inventionFeatures: suppressSensitiveLogging ? undefined : queryPlan.inventionFeatures,
      epoTitleKeywords: suppressSensitiveLogging ? undefined : queryPlan.epoTitleKeywords,
      epoAbstractKeywords: suppressSensitiveLogging ? undefined : queryPlan.epoAbstractKeywords,
      displayLimit: limit,
      candidateLimit,
    })

    if (input.searchMode === 'manual') {
      if (providerIds.includes('indian-corpus')) {
        warnings.push('India: exact fielded search is available for local corpus records.')
      }
      if (providerIds.includes('pqai')) {
        warnings.push('PQAI: manual fields are converted into a provider query; not all filters can be enforced by PQAI.')
      }
    }

    const runProviders = async (ids: PatentSearchProviderId[], lane: 'primary' | 'fallback') => {
      await Promise.all(ids.map(async providerId => {
        const provider = getPatentSearchProvider(providerId)
        if (!provider) {
          providerStats.push({
            providerId,
            label: String(providerId),
            enabled: false,
            requested: true,
            resultCount: 0,
            error: 'Provider is not registered.',
          })
          warnings.push(`Provider ${providerId} is not registered.`)
          return
        }
        if (!provider.enabled) {
          providerStats.push({
            providerId,
            label: provider.label,
            enabled: false,
            requested: true,
            resultCount: 0,
            error: 'Provider is not enabled.',
          })
          // A disabled fallback is expected (missing optional credentials), not a
          // problem the user needs to be told about.
          if (lane === 'primary') warnings.push(`${provider.label} is planned but not enabled yet.`)
          return
        }

        try {
          const startedAt = Date.now()
          logSearchEvent('provider_started', {
            providerId,
            label: provider.label,
            lane,
            query: suppressSensitiveLogging ? undefined : queryPlan.searchQuery,
            requestedLimit: candidateLimit,
          })
          const results = await provider.search({
            ...input,
            limit: candidateLimit,
            candidateLimit,
            queryPlan,
          })
          logSearchEvent('provider_completed', {
            providerId,
            label: provider.label,
            lane,
            resultCount: results.length,
            durationMs: Date.now() - startedAt,
            results: suppressSensitiveLogging ? undefined : results.map(resultLogSummary),
          })
          providerStats.push({
            providerId,
            label: provider.label,
            enabled: true,
            requested: true,
            resultCount: results.length,
          })
          providerResults.push({ providerId, results })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          logSearchEvent('provider_failed', { providerId, label: provider.label, lane, error: message })
          providerStats.push({
            providerId,
            label: provider.label,
            enabled: provider.enabled,
            requested: true,
            resultCount: 0,
            error: message,
          })
          warnings.push(`${provider.label} search failed: ${message}`)
        }
      }))
    }

    await runProviders(providerIds, 'primary')

    // Local-corpus-first: the stored corpus answers almost every search on its own.
    // Live provider APIs are metered and slow, so they only run when the corpus came
    // back completely empty — a genuinely unindexed technology area, or a country
    // filter narrower than our coverage.
    const primaryResultCount = providerResults.reduce((count, entry) => count + entry.results.length, 0)
    let usedFallbackProviders: PatentSearchProviderId[] = []
    if (primaryResultCount === 0 && input.disableProviderFallback !== true) {
      usedFallbackProviders = resolveFallbackProviderIds({
        jurisdictions: input.jurisdictions,
        alreadySearched: providerIds,
        fallbackBlocked: accessGates.fallbackBlocked,
      })
      if (usedFallbackProviders.length) {
        logSearchEvent('fallback_dispatch', {
          reason: 'local_corpus_returned_no_results',
          providerIds: usedFallbackProviders,
        })
        await runProviders(usedFallbackProviders, 'fallback')
      }
    }

    // Live PQAI/EPO searches persist their normalized results into the matching
    // local corpus. Because providers run concurrently, an empty corpus search
    // can finish before that persistence. Retry only that empty corpus once,
    // after the corresponding live provider has completed successfully.
    const corpusRefreshPairs: Array<{
      corpusId: PatentSearchProviderId
      liveId: PatentSearchProviderId
    }> = [
      { corpusId: 'pqai-corpus', liveId: 'pqai' },
      { corpusId: 'epo-ops-corpus', liveId: 'epo-ops' },
    ]
    for (const { corpusId, liveId } of corpusRefreshPairs) {
      const corpusResult = providerResults.find(result => result.providerId === corpusId)
      const liveResult = providerResults.find(result => result.providerId === liveId)
      if (!corpusResult || corpusResult.results.length > 0 || !liveResult?.results.length) continue
      const provider = getPatentSearchProvider(corpusId)
      if (!provider?.enabled) continue

      const startedAt = Date.now()
      logSearchEvent('provider_refresh_started', {
        providerId: corpusId,
        afterProviderId: liveId,
        reason: 'live_results_persisted_after_empty_corpus_search',
      })
      try {
        const refreshedResults = await provider.search({
          ...input,
          limit: candidateLimit,
          candidateLimit,
          queryPlan,
        })
        corpusResult.results = refreshedResults
        const stat = providerStats.find(item => item.providerId === corpusId)
        if (stat) stat.resultCount = refreshedResults.length
        logSearchEvent('provider_refresh_completed', {
          providerId: corpusId,
          afterProviderId: liveId,
          resultCount: refreshedResults.length,
          durationMs: Date.now() - startedAt,
          results: suppressSensitiveLogging ? undefined : refreshedResults.map(resultLogSummary),
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        warnings.push(`${provider.label} refresh after ${liveId} persistence failed: ${message}`)
        logSearchEvent('provider_refresh_failed', {
          providerId: corpusId,
          afterProviderId: liveId,
          error: message,
        })
      }
    }

    // Primary (corpus) providers keep their configured order and rank ahead of any
    // fallback provider that ran, which matters for the per-source promotion in
    // mergeProviderResults.
    const providerOrder = [...providerIds, ...usedFallbackProviders]
    providerResults.sort((a, b) => providerOrder.indexOf(a.providerId) - providerOrder.indexOf(b.providerId))
    let candidateResults = mergeProviderResults(providerResults, candidateLimit)

    // Second-stage reranking: the binary-embedding recall lane (Google corpus) and the
    // float lane (Indian corpus) return candidates scored on different bases (Hamming vs
    // cosine). The Voyage reranker re-scores query -> title+abstract for the whole merged
    // pool, producing one comparable ordering and recovering the precision binary trades
    // away. Gated by NOVELTY_RERANK_ENABLED + VOYAGE_API_KEY; failure keeps the merge order.
    const rerankEnabled = settings['rerank.enabled'] !== false && isVoyageRerankerEnabled()
    const minRerankScore = typeof settings['rerank.minScore'] === 'number'
      ? Math.max(0, Math.min(1, settings['rerank.minScore'] as number))
      : 0
    const rerankMaxDocsPerCall = typeof settings['rerank.maxDocsPerCall'] === 'number'
      ? Math.min(1000, Math.max(1, Math.floor(settings['rerank.maxDocsPerCall'] as number)))
      : undefined
    const rerankQuery = rerankQueryForPlan(queryPlan, input.query)
    let rerankApplied = false
    let droppedBelowFloor = 0
    if (rerankEnabled && rerankQuery && candidateResults.length > 1) {
      const rerankStartedAt = Date.now()
      try {
        const scored = await rerankItems(
          rerankQuery,
          candidateResults.map(result => ({
            item: result,
            text: `${result.title || ''}\n${result.abstract || result.snippet || ''}`,
          })),
          {
            maxDocumentsPerCall: rerankMaxDocsPerCall,
            externalAiUsage: input.externalAiUsage,
          },
        )
        if (scored.length) {
          rerankApplied = true
          candidateResults = scored.map(entry => ({
            ...entry.item,
            rerankScore: entry.relevanceScore,
            // The pre-rerank relevanceScore is normalised against the best hit in its
            // own result set, so the top result always scored ~0.99 regardless of how
            // good it actually was, and it did not reflect the rerank ordering the
            // list is now sorted by. The Voyage score is absolute and comparable
            // across searches, so it becomes the score of record.
            relevanceScore: Number(entry.relevanceScore.toFixed(3)),
            scores: {
              ...(entry.item.scores || {}),
              rerank: entry.relevanceScore,
              // Keep the fused retrieval score for diagnostics and calibration.
              preRerankRelevance: entry.item.relevanceScore ?? undefined,
            },
          }))

          // Absolute cutoff. Without it the corpus always fills the candidate quota,
          // so a search with no genuinely close prior art looked identical to one
          // with plenty. A floor lets the pipeline legitimately return fewer — or no
          // — candidates. 0 disables it and preserves the old top-N behaviour.
          if (minRerankScore > 0) {
            const beforeFloor = candidateResults.length
            candidateResults = candidateResults.filter(
              result => (result.rerankScore ?? 0) >= minRerankScore
            )
            droppedBelowFloor = beforeFloor - candidateResults.length
            if (droppedBelowFloor > 0) {
              logSearchEvent('rerank_floor_applied', {
                minRerankScore,
                dropped: droppedBelowFloor,
                remaining: candidateResults.length,
              })
            }
            if (!candidateResults.length) {
              warnings.push(
                `No prior art scored above the ${minRerankScore} relevance threshold.`
              )
            }
          }

          logSearchEvent('rerank_completed', {
            candidateCount: candidateResults.length,
            durationMs: Date.now() - rerankStartedAt,
            topScore: scored[0]?.relevanceScore,
            medianScore: scored.length
              ? scored[Math.floor(scored.length / 2)]?.relevanceScore
              : undefined,
            minRerankScore,
            maxDocsPerCall: rerankMaxDocsPerCall,
            droppedBelowFloor,
          })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        warnings.push(`Reranking skipped: ${message}`)
        logSearchEvent('rerank_failed', { error: message })
      }
    }

    const results = candidateResults.slice(0, limit)
    const providerContributionCounts = Object.fromEntries(providerOrder.map(providerId => [
      providerId,
      candidateResults.filter(result => (result.sourceProviders || [result.sourceProvider]).includes(providerId)).length,
    ])) as Partial<Record<PatentSearchProviderId, number>>

    logSearchEvent('aggregate_completed', {
      providerStats,
      providerContributionCounts,
      providerCandidateCount: providerResults.reduce((count, providerResult) => count + providerResult.results.length, 0),
      candidateResultCount: candidateResults.length,
      displayResultCount: results.length,
      candidatePublicationNumbers: suppressSensitiveLogging ? undefined : candidateResults.map(result => result.publicationNumber),
    })

    return {
      queryPlan,
      providerStats: providerStats.sort((a, b) => String(a.providerId).localeCompare(String(b.providerId))),
      warnings: uniqueStrings(warnings),
      results,
      candidateResults,
      diagnostics: {
        displayLimit: limit,
        candidateLimit,
        resultCount: results.length,
        candidateResultCount: candidateResults.length,
        providerCandidateCount: providerResults.reduce((count, providerResult) => count + providerResult.results.length, 0),
        providerContributionCounts,
        primaryProviderIds: providerIds,
        fallbackProviderIds: usedFallbackProviders,
        usedFallbackProviders: usedFallbackProviders.length > 0,
        rerankApplied,
        minRerankScore,
        droppedBelowFloor,
      },
    }
  }
}

export const patentSearchOrchestrator = new PatentSearchOrchestrator()
