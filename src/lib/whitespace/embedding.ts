/**
 * Whitespace Studio — query-side embedding and ANN retrieval.
 *
 * Replicates the exact corpus path (Voyage → MRL-512 → binarise) via the shared
 * constants and converters in patent-corpus-service, because comparability with
 * the stored vectors is the whole point: a query embedded any other way measures
 * distance to nothing.
 *
 * Everything here degrades explicitly. If VOYAGE_API_KEY is absent or the corpus
 * carries no binary vectors for the field, callers receive a typed "unavailable"
 * result and must record the analysis as not-run — never silently skip it.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  PATENT_CORPUS_EMBEDDING_DIMENSIONS,
  corpusEmbeddingToLiteral,
  requestVoyageEmbeddings,
} from '@/lib/patent-corpus-service'

export interface SemanticNeighbor {
  id: string
  publicationNumber: string
  familyKey: string
  title: string | null
  abstract: string | null
  /** Hamming distance normalised to [0, 1] by the bit width. */
  distance: number
}

export type SemanticLaneResult =
  | { available: true; neighbors: SemanticNeighbor[] }
  | { available: false; reason: string }

export function semanticLaneConfigured(): boolean {
  return Boolean(process.env.VOYAGE_API_KEY)
}

/** Embeds query text into a pgvector bit-string literal, or null when unconfigured. */
export async function embedQueryText(text: string): Promise<string | null> {
  if (!semanticLaneConfigured()) return null
  const [vector] = await requestVoyageEmbeddings([text.slice(0, 8000)], { purpose: 'search-query' })
  if (!vector) return null
  return corpusEmbeddingToLiteral(vector)
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
  const cast = Prisma.raw(`::bit(${PATENT_CORPUS_EMBEDDING_DIMENSIONS})`)

  try {
    const [, , rows] = await prisma.$transaction([
      prisma.$executeRaw`SELECT set_config('statement_timeout', ${String(input.timeoutMs ?? 20_000)}, true)`,
      // pgvector defaults to one IVFFlat probe; use the calibrated value locally.
      prisma.$executeRaw`SELECT set_config('ivfflat.probes', '24', true)`,
      prisma.$queryRaw<
        Array<{
          id: string
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
               (e."embeddingBinary" <~> ${literal}${cast})::float AS distance
        FROM "local_patent_embeddings" e
        JOIN "local_patents" lp ON lp."id" = e."localPatentId"
        WHERE e."embeddingBinary" IS NOT NULL
        ${where}
        ORDER BY e."embeddingBinary" <~> ${literal}${cast}
        LIMIT ${input.limit}`),
    ])
    return {
      available: true,
      neighbors: rows.map(row => ({ ...row, distance: Number(row.distance) / PATENT_CORPUS_EMBEDDING_DIMENSIONS })),
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
 * per field, because absolute Hamming distances are not comparable across
 * technology domains.
 */
export function semanticNoveltyScore(dMin: number, p05: number, p50: number): number {
  const spread = p50 - p05
  if (!(spread > 0)) return 0
  return Math.min(1, Math.max(0, (dMin - p05) / spread))
}
