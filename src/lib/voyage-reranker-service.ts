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
// Voyage rerank caps documents per call; chunk larger candidate sets and merge by score.
const VOYAGE_RERANK_MAX_DOCS = Math.max(50, Number(process.env.VOYAGE_RERANK_MAX_DOCS || '1000') || 1000)
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

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function shouldRetry(status: number) {
  return status === 408 || status === 409 || status === 429 || status >= 500
}

async function rerankChunk(query: string, documents: string[]): Promise<Array<{ index: number; score: number }>> {
  const apiKey = process.env.VOYAGE_API_KEY
  if (!apiKey) throw new Error('VOYAGE_API_KEY is not configured.')

  let lastError: Error | null = null
  for (let attempt = 0; attempt < VOYAGE_RERANK_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), VOYAGE_RERANK_TIMEOUT_MS)
    try {
      const response = await fetch(VOYAGE_RERANK_ENDPOINT, {
        method: 'POST',
        signal: controller.signal,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, documents, model: VOYAGE_RERANK_MODEL, return_documents: false }),
      })
      if (!response.ok) {
        const body = await response.text()
        lastError = new Error(`Voyage rerank failed: ${response.status} ${body.slice(0, 400)}`)
        if (attempt < VOYAGE_RERANK_MAX_ATTEMPTS - 1 && shouldRetry(response.status)) {
          const retryAfter = Number(response.headers.get('retry-after') || 0)
          await sleep(retryAfter > 0 ? retryAfter * 1000 : Math.min(15000, 1000 * 2 ** attempt))
          continue
        }
        throw lastError
      }
      const json = await response.json()
      const results = Array.isArray(json?.data) ? json.data : []
      return results.map((row: any) => ({
        index: Number(row?.index ?? -1),
        score: Number(row?.relevance_score ?? row?.relevanceScore ?? 0),
      })).filter((row: { index: number }) => row.index >= 0)
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
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
export async function rerankItems<T>(query: string, items: Array<RerankItem<T>>): Promise<Array<RerankScored<T>>> {
  const cleanQuery = String(query || '').replace(/\s+/g, ' ').trim()
  const prepared = items
    .map((entry, originalIndex) => ({ ...entry, originalIndex, text: String(entry.text || '').replace(/\s+/g, ' ').trim() }))
    .filter(entry => entry.text)
  if (!cleanQuery || !prepared.length) {
    return prepared.map(entry => ({ item: entry.item, relevanceScore: 0, originalIndex: entry.originalIndex }))
  }

  const scored: Array<RerankScored<T>> = []
  for (let start = 0; start < prepared.length; start += VOYAGE_RERANK_MAX_DOCS) {
    const chunk = prepared.slice(start, start + VOYAGE_RERANK_MAX_DOCS)
    const docs = chunk.map(entry => entry.text.slice(0, VOYAGE_RERANK_MAX_DOC_CHARS))
    const ranked = await rerankChunk(cleanQuery, docs)
    for (const { index, score } of ranked) {
      const entry = chunk[index]
      if (entry) scored.push({ item: entry.item, relevanceScore: score, originalIndex: entry.originalIndex })
    }
  }
  scored.sort((a, b) => b.relevanceScore - a.relevanceScore)
  return scored
}
