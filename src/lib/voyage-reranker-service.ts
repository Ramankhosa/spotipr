// Voyage reranker (https://api.voyageai.com/v1/rerank).
//
// Second-stage precision for the binary-embedding recall lane: the corpus provider
// retrieves a coarse top-K by Hamming distance (fast, memory-compressed), then this
// reranker re-scores query vs. document text to produce the final ordering. It also
// normalizes scores ACROSS corpora (Google binary/Hamming vs Indian float/cosine),
// since every candidate is re-scored on the same query→text basis.

const VOYAGE_RERANK_ENDPOINT = 'https://api.voyageai.com/v1/rerank'
const VOYAGE_RERANK_MODEL = process.env.VOYAGE_RERANK_MODEL || 'rerank-2.5-lite'
const VOYAGE_RERANK_TIMEOUT_MS = Math.max(2000, Number(process.env.VOYAGE_RERANK_TIMEOUT_MS || '30000') || 30000)
const VOYAGE_RERANK_MAX_ATTEMPTS = Math.max(1, Number(process.env.VOYAGE_RERANK_MAX_ATTEMPTS || '3') || 3)
// Voyage caps a rerank request at 1,000 documents. Keep the environment default
// inside that hard API limit; callers may supply the runtime/admin override.
const VOYAGE_RERANK_MAX_DOCS = Math.min(
  1000,
  Math.max(1, Math.floor(Number(process.env.VOYAGE_RERANK_MAX_DOCS || '1000') || 1000))
)
// Per-document text is truncated so a big candidate set stays within the request token
// budget; title + abstract is plenty of signal for reranking.
const VOYAGE_RERANK_MAX_DOC_CHARS = Math.max(200, Number(process.env.VOYAGE_RERANK_MAX_DOC_CHARS || '1600') || 1600)

export function hasVoyageRerankerKey() {
  return Boolean(process.env.VOYAGE_API_KEY)
}

export function isVoyageRerankerEnabled() {
  const flag = String(process.env.NOVELTY_RERANK_ENABLED || '').trim().toLowerCase()
  if (flag === '0' || flag === 'false' || flag === 'off' || flag === 'no') return false
  return hasVoyageRerankerKey()
}

export interface RerankItem<T> {
  item: T
  text: string
}

export interface RerankScored<T> {
  item: T
  relevanceScore: number
  originalIndex: number
}

export interface RerankOptions {
  maxDocumentsPerCall?: number
  externalAiUsage?: import('./external-ai-usage').ExternalAiUsageContext
}

function maxDocumentsPerCall(value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return VOYAGE_RERANK_MAX_DOCS
  return Math.min(1000, Math.max(1, Math.floor(value)))
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function shouldRetry(status: number) {
  return status === 408 || status === 409 || status === 429 || status >= 500
}

async function rerankChunk(
  query: string,
  documents: string[],
  externalAiUsage?: import('./external-ai-usage').ExternalAiUsageContext,
): Promise<Array<{ index: number; score: number }>> {
  const apiKey = process.env.VOYAGE_API_KEY
  if (!apiKey) throw new Error('VOYAGE_API_KEY is not configured.')

  let lastError: Error | null = null
  for (let attempt = 0; attempt < VOYAGE_RERANK_MAX_ATTEMPTS; attempt += 1) {
    const requestStartedAt = Date.now()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), VOYAGE_RERANK_TIMEOUT_MS)
    try {
      const response = await fetch(VOYAGE_RERANK_ENDPOINT, {
        method: 'POST',
        signal: controller.signal,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          documents,
          model: VOYAGE_RERANK_MODEL,
          return_documents: false,
          truncation: true,
        }),
      })
      if (!response.ok) {
        const body = await response.text()
        lastError = new Error(`Voyage rerank failed: ${response.status} ${body.slice(0, 400)}`)
        if (externalAiUsage) {
          const { recordExternalAiUsage } = await import('./external-ai-usage')
          await recordExternalAiUsage(externalAiUsage, {
            provider: 'voyage',
            operation: 'rerank',
            model: VOYAGE_RERANK_MODEL,
            status: 'FAILED',
            inputCount: documents.length,
            latencyMs: Date.now() - requestStartedAt,
            attempt: attempt + 1,
            error: lastError.message,
          })
          ;(lastError as Error & { externalUsageRecorded?: boolean }).externalUsageRecorded = true
        }
        if (attempt < VOYAGE_RERANK_MAX_ATTEMPTS - 1 && shouldRetry(response.status)) {
          const retryAfter = Number(response.headers.get('retry-after') || 0)
          await sleep(retryAfter > 0 ? retryAfter * 1000 : Math.min(15000, 1000 * 2 ** attempt))
          continue
        }
        throw lastError
      }
      const json = await response.json()
      const results = Array.isArray(json?.data) ? json.data : []
      if (results.length !== documents.length) {
        throw new Error(
          `Voyage rerank returned ${results.length} scores for ${documents.length} documents.`
        )
      }
      const seen = new Set<number>()
      const mapped = results.map((row: any) => {
        const index = Number(row?.index)
        const score = Number(row?.relevance_score ?? row?.relevanceScore)
        if (!Number.isInteger(index) || index < 0 || index >= documents.length || seen.has(index) || !Number.isFinite(score)) {
          throw new Error('Voyage rerank returned an invalid score mapping.')
        }
        seen.add(index)
        return { index, score }
      })
      if (externalAiUsage) {
        const { recordExternalAiUsage } = await import('./external-ai-usage')
        await recordExternalAiUsage(externalAiUsage, {
          provider: 'voyage',
          operation: 'rerank',
          model: VOYAGE_RERANK_MODEL,
          status: 'COMPLETED',
          inputCount: documents.length,
          totalTokens: Number.isFinite(Number(json?.usage?.total_tokens)) ? Number(json.usage.total_tokens) : undefined,
          latencyMs: Date.now() - requestStartedAt,
          attempt: attempt + 1,
        })
      }
      return mapped
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      if (externalAiUsage && !(lastError as Error & { externalUsageRecorded?: boolean }).externalUsageRecorded) {
        const { recordExternalAiUsage } = await import('./external-ai-usage')
        await recordExternalAiUsage(externalAiUsage, {
          provider: 'voyage',
          operation: 'rerank',
          model: VOYAGE_RERANK_MODEL,
          status: 'FAILED',
          inputCount: documents.length,
          latencyMs: Date.now() - requestStartedAt,
          attempt: attempt + 1,
          error: lastError.message,
        })
        ;(lastError as Error & { externalUsageRecorded?: boolean }).externalUsageRecorded = true
      }
      if (attempt < VOYAGE_RERANK_MAX_ATTEMPTS - 1 && (lastError.name === 'AbortError' || /fetch failed|network/i.test(lastError.message))) {
        await sleep(Math.min(15000, 1000 * 2 ** attempt))
        continue
      }
      throw lastError
    } finally {
      clearTimeout(timeout)
    }
  }
  throw lastError || new Error('Voyage rerank failed.')
}

/**
 * Rerank `items` by relevance to `query`. Returns them ordered by descending Voyage
 * relevance score (chunked across the per-request document cap, then merged). On any
 * failure this THROWS — callers should catch and fall back to their existing ordering,
 * so a reranker outage degrades ranking quality but never breaks the search.
 */
export async function rerankItems<T>(
  query: string,
  items: Array<RerankItem<T>>,
  options: RerankOptions = {}
): Promise<Array<RerankScored<T>>> {
  const cleanQuery = String(query || '').replace(/\s+/g, ' ').trim()
  const prepared = items
    .map((entry, originalIndex) => ({ ...entry, originalIndex, text: String(entry.text || '').replace(/\s+/g, ' ').trim() }))
  if (!cleanQuery || !prepared.length) {
    return prepared.map(entry => ({ item: entry.item, relevanceScore: 0, originalIndex: entry.originalIndex }))
  }

  const rankable = prepared.filter(entry => entry.text)
  if (!rankable.length) {
    return prepared.map(entry => ({ item: entry.item, relevanceScore: 0, originalIndex: entry.originalIndex }))
  }

  const chunkSize = maxDocumentsPerCall(options.maxDocumentsPerCall)
  const scored: Array<RerankScored<T>> = []
  for (let start = 0; start < rankable.length; start += chunkSize) {
    const chunk = rankable.slice(start, start + chunkSize)
    const docs = chunk.map(entry => entry.text.slice(0, VOYAGE_RERANK_MAX_DOC_CHARS))
    const ranked = await rerankChunk(cleanQuery, docs, options.externalAiUsage)
    for (const { index, score } of ranked) {
      const entry = chunk[index]
      if (entry) scored.push({ item: entry.item, relevanceScore: score, originalIndex: entry.originalIndex })
    }
  }
  scored.sort((a, b) => b.relevanceScore - a.relevanceScore)
  // A missing title/abstract must not make a candidate disappear. Keep documents
  // that could not be reranked at the end with a zero score; a configured score
  // floor can still remove them explicitly in the orchestrator.
  const unrankable = prepared
    .filter(entry => !entry.text)
    .map(entry => ({ item: entry.item, relevanceScore: 0, originalIndex: entry.originalIndex }))
  return [...scored, ...unrankable]
}
