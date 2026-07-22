import { prisma } from '../prisma'
import { estimateTokens } from './document-intake'

/**
 * Office Action Studio — retrieval + cost budget (the core cost lever)
 *
 * Instead of sending a full 50k-token specification to every objection's every
 * stage, each stage pulls only the top-K most relevant paragraphs for its query.
 * Embedding is done once at intake (requestCorpusEmbedding); this module embeds
 * the QUERY once and runs a pgvector cosine search over the case's chunks.
 *
 * See OFFICE_ACTION_CONTEXT_AND_COST.md.
 */

// Hard caps — keep the context window (and cost) bounded regardless of spec size.
export const RETRIEVAL_DEFAULTS = {
  topK: 8,
  maxContextTokens: 4000,
  digestMaxTokens: 2000
}

export interface RetrievedChunk {
  documentId: string
  kind: string
  sectionRef: string | null
  text: string
  tokenCount: number
  distance: number
}

export interface RetrieveOptions {
  caseId: string
  query: string
  /** Restrict to document kinds — e.g. ['SPECIFICATION'] for the s.59 basis finder. */
  kinds?: string[]
  /** Only as-filed material (excludes supplementary post-filing evidence). */
  newMatterSafeOnly?: boolean
  topK?: number
  maxTokens?: number
}

/**
 * Embed a query string and return the bit-string literal for the bit(512) column.
 * Voyage embeddings are ASYMMETRIC: this is a query, so it must go through
 * requestSearchQueryEmbedding (input_type: query). Embedding it as a document —
 * the old requestCorpusEmbedding default — silently degrades retrieval quality.
 */
async function embedQuery(text: string): Promise<{ literal: string; cast: string } | null> {
  try {
    // Destructured so TypeScript type-checks these names (a rename must not
    // silently degrade to a no-op).
    const {
      requestSearchQueryEmbedding, corpusEmbeddingToLiteral,
      PATENT_CORPUS_EMBEDDING_SQL_TYPE, PATENT_CORPUS_EMBEDDING_DIMENSIONS,
    } = await import('../patent-corpus-service')
    const vec = await requestSearchQueryEmbedding(text)
    if (!Array.isArray(vec) || !vec.length) return null
    return {
      literal: corpusEmbeddingToLiteral(vec),
      // Derived, not hardcoded — follows the corpus dtype if it ever changes.
      cast: `${PATENT_CORPUS_EMBEDDING_SQL_TYPE}(${PATENT_CORPUS_EMBEDDING_DIMENSIONS})`,
    }
  } catch (e) {
    console.warn('[OA context] query embedding failed:', e instanceof Error ? e.message : e)
    return null
  }
}

/**
 * Retrieve the most relevant case chunks for a query, packed to the token cap.
 * Returns [] on embedding failure so callers degrade to digest-only context
 * (never to full-spec stuffing).
 */
export async function retrieveContext(opts: RetrieveOptions): Promise<RetrievedChunk[]> {
  const topK = opts.topK ?? RETRIEVAL_DEFAULTS.topK
  const maxTokens = opts.maxTokens ?? RETRIEVAL_DEFAULTS.maxContextTokens

  const embedded = await embedQuery(opts.query)
  if (!embedded) return []

  const kindFilter = opts.kinds?.length
    ? `AND c."kind" IN (${opts.kinds.map(k => `'${k.replace(/'/g, "''")}'`).join(',')})`
    : ''
  const safeFilter = opts.newMatterSafeOnly ? `AND d."newMatterSafe" = true` : ''

  let rows: any[] = []
  try {
    rows = await prisma.$queryRawUnsafe(
      `SELECT c."documentId", c."kind", c."sectionRef", c."text", c."tokenCount",
              (c."embedding" <~> $1::${embedded.cast}) AS distance
         FROM "oa_document_chunks" c
         JOIN "oa_case_documents" d ON d."id" = c."documentId"
        WHERE c."caseId" = $2 AND c."embedding" IS NOT NULL ${kindFilter} ${safeFilter}
        ORDER BY distance ASC
        LIMIT ${Math.max(1, topK)}`,
      embedded.literal,
      opts.caseId
    )
  } catch (e) {
    console.warn('[OA context] vector search failed:', e instanceof Error ? e.message : e)
    return []
  }

  // Pack to the token cap.
  const packed: RetrievedChunk[] = []
  let used = 0
  for (const r of rows) {
    const tok = r.tokenCount || estimateTokens(r.text)
    if (used + tok > maxTokens && packed.length) break
    packed.push({
      documentId: r.documentId, kind: r.kind, sectionRef: r.sectionRef,
      text: r.text, tokenCount: tok, distance: Number(r.distance)
    })
    used += tok
  }
  return packed
}

/** Render retrieved chunks as a compact, citable context block for a prompt. */
export function renderContextBlock(chunks: RetrievedChunk[]): string {
  if (!chunks.length) return ''
  return chunks.map(c => `[${c.sectionRef || c.kind}]\n${c.text}`).join('\n\n')
}

// ---- supplementary material (attorney-provided evidence) ----

export interface SupplementaryContext {
  /** Evidence text, packed to the token cap. */
  chunks: RetrievedChunk[]
  /** The attorney's usage instructions for each matching document. */
  notes: Array<{ title: string | null; intentNote: string | null }>
}

/**
 * Attorney-provided supplementary material (efficacy data, declarations…)
 * relevant to one objection: documents whose targetCodes include the
 * objection's canonical code (or that declare no target). Vector retrieval
 * first; if the document has no embeddings yet (indexing pending/failed),
 * falls back to its leading chunks so explicitly-provided evidence is never
 * silently dropped. This material is argument/affidavit evidence ONLY —
 * never Section 59 amendment basis.
 */
export async function retrieveSupplementaryContext(opts: {
  caseId: string
  objectionCode: string
  query: string
  maxTokens?: number
}): Promise<SupplementaryContext> {
  const maxTokens = opts.maxTokens ?? 1500
  const docs = await prisma.oaCaseDocument.findMany({
    where: { caseId: opts.caseId, kind: 'SUPPLEMENTARY' },
    select: { id: true, title: true, intentNote: true, targetCodes: true }
  })
  const matching = docs.filter(d => {
    const codes = Array.isArray(d.targetCodes) ? (d.targetCodes as any[]).map(String) : []
    return codes.length === 0 || codes.includes(opts.objectionCode)
  })
  if (!matching.length) return { chunks: [], notes: [] }
  const matchIds = new Set(matching.map(d => d.id))

  let chunks = (await retrieveContext({
    caseId: opts.caseId, query: opts.query,
    kinds: ['SUPPLEMENTARY'], newMatterSafeOnly: false, maxTokens
  })).filter(c => matchIds.has(c.documentId))

  if (!chunks.length) {
    // Deterministic fallback: leading chunks of each matching document.
    const rows = await prisma.oaDocumentChunk.findMany({
      where: { documentId: { in: Array.from(matchIds) } },
      orderBy: { id: 'asc' },
      take: 12,
      select: { documentId: true, kind: true, sectionRef: true, text: true, tokenCount: true }
    })
    let used = 0
    for (const r of rows) {
      const tok = r.tokenCount || estimateTokens(r.text)
      if (used + tok > maxTokens && chunks.length) break
      chunks.push({ documentId: r.documentId, kind: r.kind, sectionRef: r.sectionRef, text: r.text, tokenCount: tok, distance: 1 })
      used += tok
    }
  }

  return { chunks, notes: matching.map(d => ({ title: d.title, intentNote: d.intentNote })) }
}

/** Render the supplementary evidence as a clearly-bounded prompt block. */
export function renderSupplementaryBlock(supp: SupplementaryContext): string {
  if (!supp.chunks.length && !supp.notes.length) return ''
  const noteLines = supp.notes
    .filter(n => n.intentNote || n.title)
    .map(n => `- ${n.title || 'Supplementary document'}${n.intentNote ? `: ${n.intentNote}` : ''}`)
  return [
    'Attorney-provided supporting material (use for ARGUMENT/EVIDENCE only — it is post-filing material and MUST NOT be cited as Section 59 amendment basis):',
    noteLines.length ? noteLines.join('\n') : '',
    renderContextBlock(supp.chunks)
  ].filter(Boolean).join('\n')
}

// ---- cost estimation (uses the same per-model prices as the metering layer) ----

export interface CaseCostEstimate {
  objections: number
  inputTokens: number
  outputTokens: number
  breakdown: Record<string, number>
}

/**
 * Rough pre-flight estimate for an Auto run, in tokens. Assumes: one digest pass
 * (amortized), then per objection = digest + retrieved context + objection text
 * in, and a drafted section out. Deliberately conservative.
 */
export function estimateAutoRunTokens(params: {
  objectionCount: number
  digestTokens?: number
  perObjectionRetrievalTokens?: number
  avgObjectionTokens?: number
  avgSectionOutTokens?: number
  specTokens?: number
}): CaseCostEstimate {
  const digest = params.digestTokens ?? RETRIEVAL_DEFAULTS.digestMaxTokens
  const retrieval = params.perObjectionRetrievalTokens ?? RETRIEVAL_DEFAULTS.maxContextTokens
  const objTokens = params.avgObjectionTokens ?? 600
  const outPer = params.avgSectionOutTokens ?? 900
  const n = params.objectionCount

  // One digest pass reads the spec once (amortized across the case).
  const digestPassIn = (params.specTokens ?? 12000) + 400
  const perObjectionIn = digest + retrieval + objTokens
  const inputTokens = digestPassIn + n * perObjectionIn
  const outputTokens = digest + n * outPer

  return {
    objections: n,
    inputTokens,
    outputTokens,
    breakdown: {
      digestPassIn,
      perObjectionIn,
      totalPerObjectionIn: n * perObjectionIn
    }
  }
}
