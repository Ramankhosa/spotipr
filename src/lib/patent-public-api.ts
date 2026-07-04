import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  getPatentCorpusCoverageStats,
  hasSearchEmbeddingApiKey,
  PATENT_CORPUS_EMBEDDING_MODEL,
  PATENT_CORPUS_SOURCE_INDIAN,
} from '@/lib/patent-corpus-service'
import { normalizePatentNumberKey } from '@/lib/patent-number'
import { patentSearchOrchestrator } from '@/lib/patent-search'
import { PatentApiError } from '@/lib/patent-api-auth'

const PUBLIC_PATENT_SELECT = {
  publicationNumber: true,
  applicationNumberRaw: true,
  kind: true,
  country: true,
  filingDate: true,
  publicationDate: true,
  title: true,
  abstract: true,
  applicants: true,
  inventors: true,
  classifications: true,
  numberOfPages: true,
  numberOfClaims: true,
  sourcePdfName: true,
  sourcePageNumber: true,
  extractionConfidence: true,
} satisfies Prisma.LocalPatentSelect

type PublicPatentRow = Prisma.LocalPatentGetPayload<{ select: typeof PUBLIC_PATENT_SELECT }>

function dateOnly(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : null
}

function publicApplicants(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.map((item, index) => {
    if (typeof item === 'string') return { name: item, address: null, sequence: index + 1 }
    if (!item || typeof item !== 'object') return null
    const row = item as Record<string, unknown>
    const name = String(row.name || row.applicant || row.raw || '').trim()
    if (!name) return null
    const sequence = Number(row.sequence)
    return {
      name,
      address: row.address ? String(row.address) : null,
      sequence: Number.isFinite(sequence) && sequence > 0 ? sequence : index + 1,
    }
  }).filter(Boolean)
}

export function toPublicPatentRecord(row: PublicPatentRow, relevance?: {
  score?: number | null
  semanticScore?: number
  textScore?: number
  matchedFields?: string[]
}) {
  return {
    publicationNumber: row.publicationNumber,
    applicationNumber: row.applicationNumberRaw,
    kind: row.kind,
    country: String(row.country || '').toUpperCase() === 'INDIA' ? 'IN' : (row.country || 'IN'),
    title: row.title,
    abstract: row.abstract,
    applicants: publicApplicants(row.applicants),
    inventors: row.inventors,
    classifications: row.classifications,
    filingDate: dateOnly(row.filingDate),
    publicationDate: dateOnly(row.publicationDate),
    numberOfPages: row.numberOfPages,
    numberOfClaims: row.numberOfClaims,
    extractionConfidence: row.extractionConfidence,
    source: {
      name: 'IP India Patent Journal',
      document: row.sourcePdfName,
      page: row.sourcePageNumber,
    },
    ...(relevance ? {
      relevance: {
        score: relevance.score ?? null,
        semanticScore: relevance.semanticScore ?? null,
        textScore: relevance.textScore ?? null,
        matchedFields: relevance.matchedFields || [],
      },
    } : {}),
  }
}

export function patentPublicApiEnabled() {
  return String(process.env.PATENT_PUBLIC_API_ENABLED || '').toLowerCase() === 'true'
}

export async function getPatentApiReadiness(options: { forceRefresh?: boolean } = {}) {
  const coverage = await getPatentCorpusCoverageStats(options)
  const indianCoverage = coverage.sourceCoverage?.[PATENT_CORPUS_SOURCE_INDIAN] || {
    totalPatents: 0,
    patentsWithCompletedEmbedding: 0,
    patentsWithoutCompletedEmbedding: 0,
    coveragePercent: 0,
  }
  const minimumCoverage = Math.max(0, Math.min(100, Number(process.env.PATENT_PUBLIC_API_MIN_EMBEDDING_COVERAGE || 99)))
  let pgvectorAvailable = false
  try {
    const rows = await prisma.$queryRaw<Array<{ available: boolean }>>`
      SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS "available"
    `
    pgvectorAvailable = rows[0]?.available === true
  } catch {
    pgvectorAvailable = false
  }
  const embeddingApiKeyAvailable = hasSearchEmbeddingApiKey()
  const coverageReady = indianCoverage.totalPatents > 0 && indianCoverage.coveragePercent >= minimumCoverage
  return {
    enabled: patentPublicApiEnabled(),
    ready: patentPublicApiEnabled() && embeddingApiKeyAvailable && pgvectorAvailable && coverageReady,
    embeddingModel: PATENT_CORPUS_EMBEDDING_MODEL,
    embeddingApiKeyAvailable,
    pgvectorAvailable,
    minimumCoveragePercent: minimumCoverage,
    coverageReady,
    indianCorpus: indianCoverage,
  }
}

export function assertPatentPublicApiEnabled() {
  if (!patentPublicApiEnabled()) {
    throw new PatentApiError('SERVICE_UNAVAILABLE', 'The patent corpus API is not enabled.', 503)
  }
}

export async function assertPatentSearchReady() {
  assertPatentPublicApiEnabled()
  const readiness = await getPatentApiReadiness()
  if (!readiness.embeddingApiKeyAvailable) {
    throw new PatentApiError('SEMANTIC_SEARCH_UNAVAILABLE', 'The query embedding service is unavailable.', 503)
  }
  if (!readiness.pgvectorAvailable) {
    throw new PatentApiError('SEMANTIC_SEARCH_UNAVAILABLE', 'Vector search is unavailable.', 503)
  }
  if (!readiness.coverageReady) {
    throw new PatentApiError(
      'CORPUS_NOT_READY',
      `Indian corpus embedding coverage is ${readiness.indianCorpus.coveragePercent}%; ${readiness.minimumCoveragePercent}% is required.`,
      503
    )
  }
}

export async function searchPublicIndianPatents(query: string, limit: number) {
  await assertPatentSearchReady()
  const response = await patentSearchOrchestrator.search({
    query,
    searchMode: 'intelligent',
    providerIds: ['indian-corpus'],
    sourceMode: 'INDIAN_ONLY',
    llmExpansion: false,
    limit,
    candidateLimit: Math.min(200, Math.max(60, limit * 4)),
    disableLinkedProviderExpansion: true,
    strictSemantic: true,
    maxSemanticQueryWords: 256,
    suppressSensitiveLogging: true,
  })
  const provider = response.providerStats.find(item => item.providerId === 'indian-corpus')
  if (provider?.error) {
    throw new PatentApiError('SEMANTIC_SEARCH_UNAVAILABLE', 'Semantic patent search is temporarily unavailable.', 503)
  }

  const ranked = response.results.filter(result => result.sourceProvider === 'indian-corpus')
  const publicationNumbers = ranked.map(result => result.publicationNumber)
  const rows = publicationNumbers.length
    ? await prisma.localPatent.findMany({
        where: {
          publicationNumber: { in: publicationNumbers },
          corpusSources: { has: PATENT_CORPUS_SOURCE_INDIAN },
        },
        select: PUBLIC_PATENT_SELECT,
      })
    : []
  const byNumber = new Map(rows.map(row => [row.publicationNumber, row]))
  return ranked.flatMap(result => {
    const row = byNumber.get(result.publicationNumber)
    if (!row) return []
    return [toPublicPatentRecord(row, {
      score: result.relevanceScore,
      semanticScore: result.scores?.semantic,
      textScore: result.scores?.text,
      matchedFields: result.matchedFields,
    })]
  })
}

export async function getPublicIndianPatent(publicationNumber: string) {
  assertPatentPublicApiEnabled()
  const key = normalizePatentNumberKey(publicationNumber)
  if (!key) throw new PatentApiError('INVALID_REQUEST', 'A publication number is required.', 400)
  const row = await prisma.localPatent.findFirst({
    where: {
      publicationNumberKey: key,
      corpusSources: { has: PATENT_CORPUS_SOURCE_INDIAN },
    },
    select: PUBLIC_PATENT_SELECT,
  })
  if (!row) throw new PatentApiError('PATENT_NOT_FOUND', 'No Indian patent was found for that publication number.', 404)
  return toPublicPatentRecord(row)
}
