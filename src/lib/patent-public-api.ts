import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  corpusHasSearchableVectors,
  getPatentCorpusCoverageStats,
  hasSearchEmbeddingApiKey,
  peekPatentCorpusCoverageStats,
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

const EMPTY_INDIAN_COVERAGE = {
  totalPatents: 0,
  patentsWithCompletedEmbedding: 0,
  patentsWithoutCompletedEmbedding: 0,
  coveragePercent: 0,
}

function minimumCoveragePercent() {
  return Math.max(0, Math.min(100, Number(process.env.PATENT_PUBLIC_API_MIN_EMBEDDING_COVERAGE || 99)))
}

// pgvector cannot appear or disappear while the process runs, so this is cached
// instead of being re-queried on the path of every single search.
let pgvectorAvailableCache: { value: boolean; expiresAt: number } | null = null

async function pgvectorAvailable() {
  if (pgvectorAvailableCache && pgvectorAvailableCache.expiresAt > Date.now()) {
    return pgvectorAvailableCache.value
  }
  let available = false
  try {
    const rows = await prisma.$queryRaw<Array<{ available: boolean }>>`
      SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS "available"
    `
    available = rows[0]?.available === true
  } catch {
    available = false
  }
  // A negative may just be a transient database problem, so it is cached only
  // briefly rather than pinning the API into an unavailable state.
  pgvectorAvailableCache = { value: available, expiresAt: Date.now() + (available ? 600_000 : 15_000) }
  return available
}

/**
 * Full readiness, including the corpus census. This is the admin/reporting view:
 * the census is several full-table scans, so on a large corpus it is slow by
 * nature and must not be called from a request a user is waiting on. The search
 * path uses getPatentApiSearchReadiness() instead.
 */
export async function getPatentApiReadiness(options: { forceRefresh?: boolean } = {}) {
  const coverage = await getPatentCorpusCoverageStats(options)
  const indianCoverage = coverage.sourceCoverage?.[PATENT_CORPUS_SOURCE_INDIAN] || EMPTY_INDIAN_COVERAGE
  const minimumCoverage = minimumCoveragePercent()
  const pgvectorReady = await pgvectorAvailable()
  const embeddingApiKeyAvailable = hasSearchEmbeddingApiKey()
  const coverageReady = indianCoverage.totalPatents > 0 && indianCoverage.coveragePercent >= minimumCoverage
  return {
    enabled: patentPublicApiEnabled(),
    ready: patentPublicApiEnabled() && embeddingApiKeyAvailable && pgvectorReady && coverageReady,
    embeddingModel: PATENT_CORPUS_EMBEDDING_MODEL,
    embeddingApiKeyAvailable,
    pgvectorAvailable: pgvectorReady,
    minimumCoveragePercent: minimumCoverage,
    coverageReady,
    indianCorpus: indianCoverage,
  }
}

/**
 * Readiness for the search hot path, which must never block on the census. Uses
 * the cached census when one exists; until the first background census lands it
 * falls back to a constant-time index probe for "does this corpus have usable
 * vectors at all". Without this, a corpus large enough to make the census slow
 * makes every search slow — and with no statement timeout, hang outright.
 */
export async function getPatentApiSearchReadiness() {
  const census = peekPatentCorpusCoverageStats()
  const indianCoverage = census?.sourceCoverage?.[PATENT_CORPUS_SOURCE_INDIAN] || null
  const minimumCoverage = minimumCoveragePercent()
  const [pgvectorReady, probedVectors] = await Promise.all([
    pgvectorAvailable(),
    indianCoverage ? Promise.resolve(false) : corpusHasSearchableVectors(PATENT_CORPUS_SOURCE_INDIAN),
  ])
  const coverageReady = indianCoverage
    ? indianCoverage.totalPatents > 0 && indianCoverage.coveragePercent >= minimumCoverage
    : probedVectors
  return {
    enabled: patentPublicApiEnabled(),
    embeddingModel: PATENT_CORPUS_EMBEDDING_MODEL,
    embeddingApiKeyAvailable: hasSearchEmbeddingApiKey(),
    pgvectorAvailable: pgvectorReady,
    minimumCoveragePercent: minimumCoverage,
    coverageReady,
    // Null until the first census completes. These numbers are reporting detail,
    // not a gate, so a search is never held up waiting for them.
    indianCorpus: indianCoverage,
  }
}

export function assertPatentPublicApiEnabled() {
  if (!patentPublicApiEnabled()) {
    throw new PatentApiError('SERVICE_UNAVAILABLE', 'The patent corpus API is not enabled.', 503)
  }
}

/**
 * Coverage manifest returned with every search response so callers know
 * exactly what was searched — corpus, jurisdiction, size, and how much of it
 * is semantically indexed. Backed by the cached corpus coverage stats.
 */
export async function getPublicSearchCoverage() {
  const readiness = await getPatentApiSearchReadiness()
  return {
    corpus: 'indian-patent-journal',
    description: 'Indian patent corpus sourced from IP India Patent Journal publications.',
    jurisdiction: 'IN',
    // Null while the first background census is still running: the corpus size is
    // informational, and blocking a search to count a multi-million-row table is
    // never the right trade.
    documents: readiness.indianCorpus?.totalPatents ?? null,
    semanticCoveragePercent: readiness.indianCorpus?.coveragePercent ?? null,
    searchMode: 'hybrid-semantic-text',
    embeddingModel: readiness.embeddingModel,
  }
}

export async function assertPatentSearchReady() {
  assertPatentPublicApiEnabled()
  const readiness = await getPatentApiSearchReadiness()
  if (!readiness.embeddingApiKeyAvailable) {
    throw new PatentApiError('SEMANTIC_SEARCH_UNAVAILABLE', 'The query embedding service is unavailable.', 503)
  }
  if (!readiness.pgvectorAvailable) {
    throw new PatentApiError('SEMANTIC_SEARCH_UNAVAILABLE', 'Vector search is unavailable.', 503)
  }
  if (!readiness.coverageReady) {
    throw new PatentApiError(
      'CORPUS_NOT_READY',
      readiness.indianCorpus
        ? `Indian corpus embedding coverage is ${readiness.indianCorpus.coveragePercent}%; ${readiness.minimumCoveragePercent}% is required.`
        : 'The Indian corpus has no completed embeddings for the configured model.',
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
