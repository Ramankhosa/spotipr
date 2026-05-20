import type {
  NormalizedPatentResult,
  PatentSearchProviderId,
  PatentSearchProviderStats,
  PatentSearchRequest,
  PatentSearchResponse,
} from './types'
import { createPatentSearchQueryPlan } from './query-planner'
import { getPatentSearchProvider, listPatentSearchProviders, resolveProviderIds } from './provider-registry'
import { canonicalPatentResultKey, clampLimit, uniqueStrings } from './utils'

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

      byKey.set(key, {
        ...chosen,
        sourceProviders,
        sourceProvider: chosen.sourceProvider,
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
          ...(chosen.scores || {}),
        },
      })
      scores.set(key, currentScore + providerScore)
    })
  }

  const merged = Array.from(byKey.entries())
    .map(([key, result]) => ({
      ...result,
      hybridScore: Number((scores.get(key) || result.hybridScore || 0).toFixed(6)),
    }))
    .sort((a, b) => (b.hybridScore || 0) - (a.hybridScore || 0))
    .slice(0, limit)

  return normalizeCombinedScores(merged)
}

export class PatentSearchOrchestrator {
  getProviders() {
    return listPatentSearchProviders()
  }

  async search(input: PatentSearchRequest): Promise<PatentSearchResponse> {
    const limit = clampLimit(input.limit, 20, 100)
    const queryPlan = await createPatentSearchQueryPlan(input)
    const providerIds = resolveProviderIds({
      providerIds: input.providerIds,
      sourceMode: input.sourceMode,
      jurisdictions: input.jurisdictions,
    })
    const warnings = [...queryPlan.warnings]
    const providerStats: PatentSearchProviderStats[] = []
    const providerResults: Array<{ providerId: PatentSearchProviderId; results: NormalizedPatentResult[] }> = []

    if (input.searchMode === 'manual') {
      if (providerIds.includes('indian-corpus')) {
        warnings.push('India: exact fielded search is available for local corpus records.')
      }
      if (providerIds.includes('pqai')) {
        warnings.push('PQAI: manual fields are converted into a provider query; not all filters can be enforced by PQAI.')
      }
    }

    await Promise.all(providerIds.map(async providerId => {
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
        warnings.push(`${provider.label} is planned but not enabled yet.`)
        return
      }

      try {
        const results = await provider.search({
          ...input,
          limit,
          queryPlan,
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

    return {
      queryPlan,
      providerStats: providerStats.sort((a, b) => String(a.providerId).localeCompare(String(b.providerId))),
      warnings: uniqueStrings(warnings),
      results: mergeProviderResults(providerResults, limit),
    }
  }
}

export const patentSearchOrchestrator = new PatentSearchOrchestrator()
