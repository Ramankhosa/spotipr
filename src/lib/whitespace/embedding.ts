/**
 * Whitespace Studio — query-side embedding and ANN retrieval.
 *
 * Replicates the exact corpus path via the shared constants and converters in
 * patent-corpus-service, because comparability with the stored vectors is the
 * whole point: a query embedded any other way measures distance to nothing.
 *
 * Provider-agnostic on purpose. This module used to hardcode the Voyage path —
 * VOYAGE_API_KEY as the configured test, requestVoyageEmbeddings as the encoder,
 * "embeddingBinary" / <~> / ::bit(N) in the SQL. On an installation configured
 * for OpenAI (PATENT_CORPUS_EMBEDDING_PROVIDER=openai) that made every semantic
 * lane report "not configured" while ordinary corpus search worked fine, because
 * search goes through the shared entry points and this did not. Everything here
 * now derives from the same constants the corpus writer and the search providers
 * use, so the two sides cannot drift.
 *
 * Everything degrades explicitly. If no key is configured or the corpus carries
 * no vectors for the field, callers receive a typed "unavailable" result and must
 * record the analysis as not-run — never silently skip it.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  PATENT_CORPUS_EMBEDDING_COLUMN,
  PATENT_CORPUS_EMBEDDING_DIMENSIONS,
  PATENT_CORPUS_EMBEDDING_DISTANCE_OP,
  PATENT_CORPUS_EMBEDDING_DTYPE,
  PATENT_CORPUS_EMBEDDING_MODEL,
  PATENT_CORPUS_EMBEDDING_SQL_TYPE,
  corpusEmbeddingToLiteral,
  hasSearchEmbeddingApiKey,
  requestSearchQueryEmbeddings,
} from '@/lib/patent-corpus-service'

// Trusted module constants (never user input), so Prisma.raw is safe. Kept
// byte-compatible with indian-corpus-provider.ts, which resolves them the same way.
const EMBEDDING_COLUMN_SQL = Prisma.raw(`e."${PATENT_CORPUS_EMBEDDING_COLUMN}"`)
const EMBEDDING_CAST_SQL = Prisma.raw(
  PATENT_CORPUS_EMBEDDING_SQL_TYPE === 'bit'
    ? `::bit(${PATENT_CORPUS_EMBEDDING_DIMENSIONS})`
    : `::${PATENT_CORPUS_EMBEDDING_SQL_TYPE}`
)
const EMBEDDING_DISTANCE_OP_SQL = Prisma.raw(PATENT_CORPUS_EMBEDDING_DISTANCE_OP)

/**
 * Both distance families normalised onto [0, 1] so downstream percentile math
 * (semanticNoveltyScore) reads the same scale whichever provider is configured:
 * Hamming is a 0..N bit count, cosine distance is 0..2.
 */
const DISTANCE_DENOMINATOR = PATENT_CORPUS_EMBEDDING_DTYPE === 'binary' ? PATENT_CORPUS_EMBEDDING_DIMENSIONS : 2

/**
 * Only vectors written by the CURRENTLY configured model are comparable. Without
 * this the ANN query reaches rows embedded by a previous model — a different
 * dimensionality, which makes Postgres throw on the distance operator, and the
 * catch below turns that into a bland "semantic retrieval failed" that looks
 * exactly like an unconfigured lane. The search providers have always filtered
 * this way; this module did not.
 */
const COMPARABLE_VECTOR = Prisma.sql`
  e."model" = ${PATENT_CORPUS_EMBEDDING_MODEL}
  AND e."status" = 'COMPLETED'::"PatentEmbeddingStatus"
  AND ${EMBEDDING_COLUMN_SQL} IS NOT NULL`

export interface SemanticNeighbor {
  /** local_patents.id — an autoincrement Int, not a cuid. */
  id: number
  publicationNumber: string
  familyKey: string
  title: string | null
  abstract: string | null
  /** Distance normalised to [0, 1] by the metric's own range. */
  distance: number
}

export type SemanticLaneResult =
  | { available: true; neighbors: SemanticNeighbor[] }
  | { available: false; reason: string }

export function semanticLaneConfigured(): boolean {
  return hasSearchEmbeddingApiKey()
}

/** Embeds query text into a pgvector literal, or null when unconfigured. */
export async function embedQueryText(text: string): Promise<string | null> {
  if (!semanticLaneConfigured()) return null
  const [vector] = await requestSearchQueryEmbeddings([text.slice(0, 8000)])
  if (!vector) return null
  return corpusEmbeddingToLiteral(vector)
}

/**
 * Batched variant: one API call for many texts, results INDEX-ALIGNED with the
 * input — null where a text is blank or came back without a vector.
 *
 * The alignment is done here on purpose: the underlying providers silently
 * FILTER blank inputs before the request, so their response array can be
 * shorter than what was sent. A caller zipping request texts against response
 * vectors by index would attach the wrong embedding to every text after the
 * first blank — the kind of off-by-one that corrupts results without erroring.
 */
export async function embedQueryTexts(texts: string[]): Promise<Array<string | null>> {
  if (!texts.length) return []
  if (!semanticLaneConfigured()) return texts.map(() => null)

  const prepared = texts.map(text => text.trim().slice(0, 8000))
  const sendIdx: number[] = []
  const send: string[] = []
  prepared.forEach((text, index) => {
    if (text) {
      sendIdx.push(index)
      send.push(text)
    }
  })

  const results: Array<string | null> = texts.map(() => null)
  if (!send.length) return results
  const vectors = await requestSearchQueryEmbeddings(send)
  vectors.forEach((vector, position) => {
    if (vector) results[sendIdx[position]] = corpusEmbeddingToLiteral(vector)
  })
  return results
}

/**
 * The semantic match test as a composable fragment, for callers that build
 * their own statements (the dimension census's per-value hit extraction).
 * `literalExpr` may be a bind parameter or a column reference (e.g. `q.lit`
 * from an unnest); `maxDistance` is on the normalised [0,1] scale and is
 * converted to the raw metric here, so every caller compares on the scale the
 * index orders by. Assumes the embeddings table is aliased `e`.
 */
export function semanticMatchSql(literalExpr: Prisma.Sql, maxDistance: number): Prisma.Sql {
  return Prisma.sql`(${EMBEDDING_COLUMN_SQL} ${EMBEDDING_DISTANCE_OP_SQL} (${literalExpr})${EMBEDDING_CAST_SQL}) <= ${
    maxDistance * DISTANCE_DENOMINATOR
  }`
}

/** The rows semanticMatchSql may legally read (alias `e`): current model, COMPLETED, vector present. */
export function comparableVectorSql(): Prisma.Sql {
  return COMPARABLE_VECTOR
}

/**
 * ANN retrieval over the corpus, optionally restricted by a scope predicate
 * (aliased `lp`). The restriction matters: semantic novelty is self-calibrated
 * per field, so neighbours must come from the same field the percentiles do.
 */
export async function semanticNeighbors(input: {
  queryText: string
  limit: number
  /** Additional WHERE against local_patents aliased lp. */
  scopeFilter?: Prisma.Sql
  /**
   * Ceiling on NORMALISED distance ([0,1]); neighbours beyond it are dropped.
   *
   * Top-K alone is not a similarity test — it returns the K nearest however far
   * they are, so on any corpus a large K eventually admits unrelated documents.
   * Callers that use this to DEFINE a set (rather than to rank one) must pass it.
   */
  maxDistance?: number
  timeoutMs?: number
}): Promise<SemanticLaneResult> {
  if (!semanticLaneConfigured()) {
    return { available: false, reason: 'Semantic search is not configured (no embedding key).' }
  }

  let literal: string | null
  try {
    literal = await embedQueryText(input.queryText)
  } catch (error) {
    return {
      available: false,
      reason: `Query embedding failed: ${error instanceof Error ? error.message : 'unknown error'}`,
    }
  }
  if (!literal) return { available: false, reason: 'Query embedding returned no vector.' }

  const where = input.scopeFilter ? Prisma.sql`AND ${input.scopeFilter}` : Prisma.empty
  // Applied in the raw metric the operator returns, so the comparison stays on
  // the same scale the index orders by.
  const distanceCeiling =
    input.maxDistance === undefined
      ? Prisma.empty
      : Prisma.sql`AND (${EMBEDDING_COLUMN_SQL} ${EMBEDDING_DISTANCE_OP_SQL} ${literal}${EMBEDDING_CAST_SQL}) <= ${
          input.maxDistance * DISTANCE_DENOMINATOR
        }`

  // pgvector's HNSW scan returns AT MOST hnsw.ef_search rows (default 40).
  // The binary corpus is IVFFlat, but the float column's ANN index is HNSW
  // (migration 20260518143000 prefers it) — and there a candidate retrieval
  // with limit 20,000 silently came back with ~40 rows, quietly gutting the
  // semantic arm while looking perfectly healthy. ef_search is capped at 1000
  // by pgvector, so retrievals past that may still be truncated on HNSW; the
  // planner's exact scan takes over on small corpora, and IVFFlat (production)
  // has no such row cap.
  const efSearch = String(Math.max(40, Math.min(1000, input.limit)))
  try {
    const [, , , rows] = await prisma.$transaction([
      prisma.$executeRaw`SELECT set_config('statement_timeout', ${String(input.timeoutMs ?? 20_000)}, true)`,
      // pgvector defaults to one IVFFlat probe; use the calibrated value locally.
      prisma.$executeRaw`SELECT set_config('ivfflat.probes', '24', true)`,
      prisma.$executeRaw`SELECT set_config('hnsw.ef_search', ${efSearch}, true)`,
      prisma.$queryRaw<
        Array<{
          id: number
          publicationNumber: string
          familyKey: string
          title: string | null
          abstract: string | null
          distance: number
        }>
      >(Prisma.sql`
        SELECT lp."id",
               lp."publicationNumber",
               COALESCE(lp."familyId", lp."publicationNumber") AS "familyKey",
               lp."title",
               lp."abstract",
               (${EMBEDDING_COLUMN_SQL} ${EMBEDDING_DISTANCE_OP_SQL} ${literal}${EMBEDDING_CAST_SQL})::float AS distance
        FROM "local_patent_embeddings" e
        JOIN "local_patents" lp ON lp."id" = e."localPatentId"
        WHERE ${COMPARABLE_VECTOR}
        ${where}
        ${distanceCeiling}
        ORDER BY ${EMBEDDING_COLUMN_SQL} ${EMBEDDING_DISTANCE_OP_SQL} ${literal}${EMBEDDING_CAST_SQL}
        LIMIT ${input.limit}`),
    ])
    return {
      available: true,
      neighbors: rows.map(row => ({ ...row, distance: Number(row.distance) / DISTANCE_DENOMINATOR })),
    }
  } catch (error) {
    return {
      available: false,
      reason: `Semantic retrieval failed: ${error instanceof Error ? error.message : 'unknown error'}`,
    }
  }
}

/**
 * Semantic novelty per 10.3: distance to the nearest family, normalised by the
 * field's own nearest-neighbour distance percentiles (p05, p50). Self-calibrating
 * per field, because absolute distances are not comparable across
 * technology domains.
 */
export function semanticNoveltyScore(dMin: number, p05: number, p50: number): number {
  const spread = p50 - p05
  if (!(spread > 0)) return 0
  return Math.min(1, Math.max(0, (dMin - p05) / spread))
}
