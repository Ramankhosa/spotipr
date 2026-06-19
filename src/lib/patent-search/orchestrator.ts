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
    const candidateLimit = Math.max(limit, clampLimit(input.candidateLimit ?? limit, limit, 300))
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
          limit: candidateLimit,
          candidateLimit,
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

    const candidateResults = mergeProviderResults(providerResults, candidateLimit)
    const results = candidateResults.slice(0, limit)

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
      },
    }
  }
}

export const patentSearchOrchestrator = new PatentSearchOrchestrator()
