import { TaskCode } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { generateJWT } from '@/lib/auth'
import { llmGateway } from '@/lib/metering/gateway'
import {
  NOVELTY_SEARCH_NORMALIZATION_PROMPT_V2,
  PR_35A_FEATURE_MAPPING_BATCH_PROMPT_V3,
} from '@/lib/novelty-search-service'
import { PATENT_CORPUS_SOURCE_INDIAN } from '@/lib/patent-corpus-service'
import { normalizePatentNumberKey } from '@/lib/patent-number'
import { PatentApiError } from '@/lib/patent-api-auth'
import { assertPatentPublicApiEnabled } from '@/lib/patent-public-api'

export const PATENT_API_ANALYSIS_LIMITS = {
  descriptionMinChars: 40,
  descriptionMaxChars: 20_000,
  titleMaxChars: 300,
  featuresMin: 1,
  featuresMax: 12,
  featureMinChars: 3,
  featureMaxChars: 300,
} as const

const CLAIMS_EXCERPT_MAX_CHARS = 6_000
const ABSTRACT_MAX_CHARS = 4_000
const SERVICE_USER_CACHE_MS = 5 * 60_000

let serviceUserCache: { userId: string; expiresAt: number } | null = null

export function patentApiAnalysisEnabled() {
  return Boolean((process.env.PATENT_PUBLIC_API_LLM_USER_EMAIL || '').trim())
}

/**
 * Public-API analysis calls run through the standard LLM gateway (model
 * resolution, metering, reservations) by impersonating a dedicated platform
 * service user, mirroring how background workers execute headless stages.
 */
async function resolveAnalysisRequestHeaders(): Promise<Record<string, string>> {
  const email = (process.env.PATENT_PUBLIC_API_LLM_USER_EMAIL || '').trim().toLowerCase()
  if (!email) {
    throw new PatentApiError('ANALYSIS_UNAVAILABLE', 'AI analysis endpoints are not enabled.', 503)
  }
  const cachedId = serviceUserCache && serviceUserCache.expiresAt > Date.now() ? serviceUserCache.userId : null
  const user = await prisma.user.findFirst({
    where: cachedId ? { id: cachedId } : { email: { equals: email, mode: 'insensitive' } },
    include: { tenant: true },
  })
  if (!user || !user.tenantId) {
    serviceUserCache = null
    console.error('[PatentPublicAPI] Analysis service user is missing or has no tenant:', email)
    throw new PatentApiError('ANALYSIS_UNAVAILABLE', 'AI analysis endpoints are not available.', 503)
  }
  serviceUserCache = { userId: user.id, expiresAt: Date.now() + SERVICE_USER_CACHE_MS }
  const token = generateJWT({
    sub: user.id,
    email: user.email,
    tenant_id: user.tenantId,
    roles: user.roles,
    ati_id: user.tenant?.atiId || null,
    tenant_ati_id: user.tenant?.atiId || null,
    scope: user.tenant?.atiId === 'PLATFORM' ? 'platform' : 'tenant',
  })
  return { authorization: `Bearer ${token}` }
}

function extractJsonObject(raw: string): any | null {
  const text = String(raw || '').trim()
  const unfenced = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
  try {
    return JSON.parse(unfenced)
  } catch {}
  const start = unfenced.indexOf('{')
  const end = unfenced.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(unfenced.slice(start, end + 1))
    } catch {}
  }
  return null
}

function clamp01(value: unknown): number | null {
  const num = Number(value)
  if (!Number.isFinite(num)) return null
  return Math.max(0, Math.min(1, num))
}

function stringList(value: unknown, maxItems: number, maxChars = 500): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map(item => item.trim().slice(0, maxChars))
    .slice(0, maxItems)
}

async function runAnalysisLLM(stageCode: string, prompt: string): Promise<string> {
  const headers = await resolveAnalysisRequestHeaders()
  const result = await llmGateway.executeLLMOperation(
    { headers },
    { taskCode: TaskCode.LLM5_NOVELTY_ASSESS, stageCode, prompt }
  )
  if (!result.success || !result.response?.output) {
    const code = (result.error as any)?.code || 'UNKNOWN'
    console.error('[PatentPublicAPI] Analysis LLM call failed:', stageCode, code, result.error?.message)
    if (code === 'TENANT_UNRESOLVED' || code === 'MODEL_UNRESOLVED' || code === 'STAGE_CONFIG_MISSING') {
      throw new PatentApiError('ANALYSIS_UNAVAILABLE', 'AI analysis endpoints are not available.', 503)
    }
    if (String(code).includes('QUOTA') || String(code).includes('LIMIT')) {
      throw new PatentApiError('ANALYSIS_CAPACITY_EXHAUSTED', 'AI analysis capacity is temporarily exhausted. Retry later.', 503)
    }
    throw new PatentApiError('ANALYSIS_FAILED', 'The AI analysis could not be completed.', 502)
  }
  return result.response.output
}

export type PublicFeatureExtraction = ReturnType<typeof toPublicFeatureExtraction>

function toPublicFeatureExtraction(parsed: any) {
  const features = stringList(parsed?.invention_features, PATENT_API_ANALYSIS_LIMITS.featuresMax)
  const featureSet = new Set(features)
  const detailRows = Array.isArray(parsed?.feature_details) ? parsed.feature_details : []
  const featureDetails = detailRows
    .filter((row: any) => row && typeof row.feature === 'string' && featureSet.has(row.feature.trim()))
    .map((row: any) => ({
      feature: row.feature.trim(),
      featureType: typeof row.feature_type === 'string' ? row.feature_type : null,
      disclosureSupport: typeof row.user_disclosure === 'string' ? row.user_disclosure : null,
      technicalRole: typeof row.technical_role === 'string' ? row.technical_role : null,
      sourceExcerpt: typeof row.source_excerpt === 'string' && row.source_excerpt.trim() ? row.source_excerpt.trim() : null,
      claimPositioningText: typeof row.claimable_text === 'string' ? row.claimable_text : null,
      searchText: typeof row.embedding_search_text === 'string' ? row.embedding_search_text : null,
      confidence: clamp01(row.feature_confidence),
    }))
  return {
    features,
    featureDetails,
    noveltyFocus: stringList(parsed?.novelty_focus, 4).filter(item => featureSet.has(item)),
    suggestedSearchQuery: typeof parsed?.searchQuery === 'string' && parsed.searchQuery.trim() ? parsed.searchQuery.trim() : null,
    inventionTypes: stringList(parsed?.inventionType, 6, 40),
    classificationHints: {
      cpc: stringList(parsed?.cpcCodes, 8, 20),
      ipc: stringList(parsed?.ipcCodes, 8, 20),
    },
    confidence: clamp01(parsed?.confidence),
    warnings: stringList(parsed?.warnings, 10),
  }
}

/**
 * Extract atomic invention features from a plain-English disclosure using the
 * same normalization stage that powers the in-app novelty search.
 */
export async function extractPublicInventionFeatures(input: { title?: string | null; description: string }) {
  assertPatentPublicApiEnabled()
  const description = String(input.description || '').trim()
  const title = String(input.title || '').trim()
  const limits = PATENT_API_ANALYSIS_LIMITS
  if (description.length < limits.descriptionMinChars || description.length > limits.descriptionMaxChars) {
    throw new PatentApiError(
      'INVALID_REQUEST',
      `description must contain between ${limits.descriptionMinChars} and ${limits.descriptionMaxChars.toLocaleString('en-US')} characters.`,
      400
    )
  }
  if (title.length > limits.titleMaxChars) {
    throw new PatentApiError('INVALID_REQUEST', `title must contain at most ${limits.titleMaxChars} characters.`, 400)
  }

  const prompt = NOVELTY_SEARCH_NORMALIZATION_PROMPT_V2
    .replace('{title}', title || 'Untitled Invention')
    .replace('{rawIdea}', description)
  const output = await runAnalysisLLM('NOVELTY_QUERY_GENERATION', prompt)
  const parsed = extractJsonObject(output)
  const result = parsed ? toPublicFeatureExtraction(parsed) : null
  if (!result || !result.features.length) {
    throw new PatentApiError('ANALYSIS_FAILED', 'No invention features could be extracted from the description.', 502)
  }
  return result
}

export type PublicFeatureFinding = {
  feature: string
  status: 'present' | 'partial' | 'absent' | 'unknown'
  evidence: { quote: string; field: 'title' | 'abstract' | 'claims' } | null
  confidence: number | null
  reason: string | null
}

function normalizeFeatureKey(value: string) {
  return value.trim().toLowerCase()
}

function collectFindings(entry: any, features: string[]): PublicFeatureFinding[] {
  const byFeature = new Map<string, PublicFeatureFinding>()
  const register = (row: any, status: PublicFeatureFinding['status']) => {
    if (!row || typeof row.feature !== 'string') return
    const key = normalizeFeatureKey(row.feature)
    if (!key || byFeature.has(key)) return
    const field = row.field === 'title' || row.field === 'abstract' || row.field === 'claims' ? row.field : 'abstract'
    const quote = typeof row.quote === 'string' ? row.quote.trim() : ''
    byFeature.set(key, {
      feature: row.feature.trim(),
      status,
      evidence: (status === 'present' || status === 'partial') && quote ? { quote, field } : null,
      confidence: status === 'present' || status === 'partial' ? clamp01(row.confidence) : null,
      reason: typeof row.reason === 'string' && row.reason.trim() ? row.reason.trim() : null,
    })
  }
  for (const row of Array.isArray(entry?.present) ? entry.present : []) register(row, 'present')
  for (const row of Array.isArray(entry?.partial) ? entry.partial : []) register(row, 'partial')
  for (const row of Array.isArray(entry?.absent) ? entry.absent : []) register(row, 'absent')
  for (const row of Array.isArray(entry?.unknown) ? entry.unknown : []) register(row, 'unknown')
  return features.map(feature => {
    const found = byFeature.get(normalizeFeatureKey(feature))
    if (found) return { ...found, feature }
    return {
      feature,
      status: 'unknown' as const,
      evidence: null,
      confidence: null,
      reason: 'The analysis did not classify this feature.',
    }
  })
}

/**
 * Map invention features against one corpus patent and return an element-wise
 * evidence chart (verbatim quotes with their source field) using the same
 * feature-analysis stage as the in-app novelty pipeline.
 */
export async function mapFeaturesToPublicPatent(input: { features: string[]; publicationNumber: string }) {
  assertPatentPublicApiEnabled()
  const limits = PATENT_API_ANALYSIS_LIMITS
  const features = Array.isArray(input.features)
    ? input.features.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim())
    : []
  if (features.length < limits.featuresMin || features.length > limits.featuresMax) {
    throw new PatentApiError('INVALID_REQUEST', `features must contain between ${limits.featuresMin} and ${limits.featuresMax} entries.`, 400)
  }
  for (const feature of features) {
    if (feature.length < limits.featureMinChars || feature.length > limits.featureMaxChars) {
      throw new PatentApiError(
        'INVALID_REQUEST',
        `Each feature must contain between ${limits.featureMinChars} and ${limits.featureMaxChars} characters.`,
        400
      )
    }
  }
  const key = normalizePatentNumberKey(input.publicationNumber)
  if (!key) throw new PatentApiError('INVALID_REQUEST', 'A publication number is required.', 400)
  const row = await prisma.localPatent.findFirst({
    where: { publicationNumberKey: key, corpusSources: { has: PATENT_CORPUS_SOURCE_INDIAN } },
    select: { publicationNumber: true, title: true, abstract: true, claimsText: true },
  })
  if (!row) throw new PatentApiError('PATENT_NOT_FOUND', 'No Indian patent was found for that publication number.', 404)

  const abstract = (row.abstract || '').replace(/\s+/g, ' ').trim().slice(0, ABSTRACT_MAX_CHARS)
  const claimsExcerpt = (row.claimsText || '').replace(/\s+/g, ' ').trim().slice(0, CLAIMS_EXCERPT_MAX_CHARS)
  // Mirrors the internal batch block: the claims line is emitted only when the
  // corpus holds claims for the reference, never as an empty placeholder.
  const patentBatchText = `
Reference 1:
Reference ID: ${row.publicationNumber}
Type: Patent
Title: ${row.title}
Abstract: ${abstract || 'Not available'}
${claimsExcerpt ? `Claims (excerpt): ${claimsExcerpt}\n` : ''}Retrieval hints: none
---
`
  const prompt = PR_35A_FEATURE_MAPPING_BATCH_PROMPT_V3
    .replace('{invention_features}', JSON.stringify(features))
    .replace('{patent_batch}', patentBatchText)
  const output = await runAnalysisLLM('NOVELTY_FEATURE_ANALYSIS', prompt)
  const parsed = extractJsonObject(output)
  const entry = Array.isArray(parsed?.feature_map) ? parsed.feature_map[0] : null
  if (!entry) {
    throw new PatentApiError('ANALYSIS_FAILED', 'The feature mapping could not be completed.', 502)
  }
  const findings = collectFindings(entry, features)
  const coverage = findings.reduce(
    (acc, finding) => {
      acc[finding.status] += 1
      return acc
    },
    { present: 0, partial: 0, absent: 0, unknown: 0 }
  )
  return {
    publicationNumber: row.publicationNumber,
    title: row.title,
    coverage,
    featureFindings: findings,
    evidenceBasis: {
      title: true,
      abstract: Boolean(abstract),
      claims: Boolean(claimsExcerpt),
    },
    qualityFlags: {
      lowEvidence: parsed?.quality_flags?.low_evidence === true,
      ambiguousAbstracts: parsed?.quality_flags?.ambiguous_abstracts === true,
      languageMismatch: parsed?.quality_flags?.language_mismatch === true,
    },
  }
}
