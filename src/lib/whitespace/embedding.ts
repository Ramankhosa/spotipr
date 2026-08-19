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
  | {
      available: true
      neighbors: SemanticNeighbor[]
      /** The normalised ceiling actually applied, or null when none was. */
      appliedMaxDistance: number | null
      /** Present only when the ceiling was resolved adaptively. */
      background?: SemanticBackground
    }
  | { available: false; reason: string }

export function semanticLaneConfigured(): boolean {
  return hasSearchEmbeddingApiKey()
}

/**
 * A database or provider error as one sentence a reader can act on.
 *
 * The lane's `reason` travels verbatim into the study's coverage notes and the
 * report, and a raw driver message ("Invalid `prisma.$queryRaw()` invocation …
 * Code: `57014`") told an attorney nothing except that something broke. The
 * full error still goes to the log; this is the sentence for the page.
 */
export function describeLaneError(error: unknown, budgetMs?: number): string {
  const message = error instanceof Error ? error.message : String(error)
  const code = (error as { meta?: { code?: string } })?.meta?.code
  if (code === '57014' || /57014|statement timeout|canceling statement/i.test(message)) {
    return budgetMs
      ? `the corpus did not answer within the ${Math.round(budgetMs / 1000)}s budget`
      : 'the corpus did not answer within the time budget'
  }
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|fetch failed|socket hang up/i.test(message)) {
    return 'the embedding service could not be reached'
  }
  if (/429|rate limit/i.test(message)) return 'the embedding service rate-limited the request'
  if (/401|403|invalid api key|unauthori[sz]ed/i.test(message)) return 'the embedding service rejected the API key'
  // Anything else: the first line, without the driver's decoration.
  const firstLine = message
    .split('\n')
    .map(line => line.trim())
    .find(line => line && !/^Invalid `prisma/.test(line) && !/^Raw query failed/.test(line))
  return (firstLine ?? 'unknown error').replace(/^Message:\s*/i, '').slice(0, 200)
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
export function semanticMatchSql(literalExpr: Prisma.Sql, maxDistance: number | Prisma.Sql): Prisma.Sql {
  // A SQL-valued ceiling is for set-valued callers (the dimension census unnests
  // one literal AND one ceiling per value), where the ceiling varies per ROW and
  // so cannot be folded into a JS constant. Both forms are on the normalised
  // [0,1] scale and both convert to the raw metric here, so no call site has to
  // remember which scale it is holding.
  const rawCeiling =
    typeof maxDistance === 'number'
      ? Prisma.sql`${maxDistance * DISTANCE_DENOMINATOR}`
      : Prisma.sql`((${maxDistance}) * ${DISTANCE_DENOMINATOR})`
  return Prisma.sql`(${EMBEDDING_COLUMN_SQL} ${EMBEDDING_DISTANCE_OP_SQL} (${literalExpr})${EMBEDDING_CAST_SQL}) <= ${rawCeiling}`
}

/** The rows semanticMatchSql may legally read (alias `e`): current model, COMPLETED, vector present. */
export function comparableVectorSql(): Prisma.Sql {
  return COMPARABLE_VECTOR
}

/**
 * A text literal cast to the corpus vector type — for set-valued callers that
 * unnest literals into a CTE and want the parse done ONCE per literal rather
 * than once per joined row. The result can be handed to semanticMatchSql as the
 * literal expression: its own cast then becomes a no-op on an already-typed
 * column.
 */
export function literalVectorSql(textExpr: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(${textExpr})${EMBEDDING_CAST_SQL}`
}

/**
 * A bound vector literal, parsed ONCE per statement execution.
 *
 * `$1::vector` in a WHERE or ORDER BY is a coercion of a parameter, and under a
 * generic plan (which Postgres may switch a repeated statement to after five
 * runs) that coercion is evaluated per row — a ~17 KB text literal re-parsed
 * for every candidate. Wrapping it in an uncorrelated scalar subquery makes it
 * an InitPlan: computed once, referenced by every row. The ANN index still
 * orders by it (pgvector's own examples use `ORDER BY v <-> (SELECT …)`).
 */
export function vectorParamSql(literal: string): Prisma.Sql {
  return Prisma.sql`(SELECT ${literal}${EMBEDDING_CAST_SQL})`
}

/**
 * Distances from ONE query vector to the corpus at large — the null distribution
 * that vector sits in.
 *
 * This exists because an absolute distance ceiling is not portable across
 * queries. Measured on the production corpus, five unrelated probes produced
 * distance curves offset from each other by 15-25 Hamming bits: at the ceiling
 * where "moisture sensor, irrigation valve" first reached 100 documents,
 * "lithium battery electrolyte" was already past 8,000. That offset is a
 * property of the QUERY VECTOR, not of the subject's density, so no single
 * constant can serve both — which is exactly how the studio ended up with the
 * semantic arm switched off on a binary installation.
 *
 * Subtracting each query's own background removes the offset and makes one
 * configured selectivity mean the same thing for every query.
 */
export interface SemanticBackground {
  /** Rows the estimate was drawn from. */
  sampled: number
  /** Mean NORMALISED distance from the query to an arbitrary corpus document. */
  mean: number
  /** Standard deviation, same scale. */
  sd: number
}

/**
 * Rows the background sample aims to draw. At 20k the standard error of the mean
 * is sd/141 — far finer than the effect being measured — while staying a bounded
 * scan on a 45M-row corpus.
 */
const BACKGROUND_TARGET_ROWS = Math.max(
  1_000,
  Number(process.env.WHITESPACE_BACKGROUND_SAMPLE_ROWS) || 20_000
)

/** reltuples for the embeddings table; -1/0 means never analysed. Cached per process. */
let rowEstimate: number | null = null
export async function corpusVectorRowEstimate(): Promise<number> {
  if (rowEstimate !== null) return rowEstimate
  try {
    const rows = await prisma.$queryRaw<Array<{ rows: number }>>`
      SELECT GREATEST(c.reltuples, 0)::float8 AS rows
      FROM pg_class c
      WHERE c.oid = 'local_patent_embeddings'::regclass`
    rowEstimate = Number(rows[0]?.rows ?? 0) || 0
  } catch {
    rowEstimate = 0
  }
  return rowEstimate
}

/**
 * TABLESAMPLE percentage that yields roughly BACKGROUND_TARGET_ROWS.
 *
 * Over-sampled 4x because SYSTEM samples BLOCKS and the comparability filter
 * (current model, COMPLETED) then discards a share of what those blocks hold;
 * the LIMIT trims the excess. An unanalysed or small table falls back to 100,
 * which is a full scan — correct, and cheap precisely because such a table is
 * small. Formatted, not bound: TABLESAMPLE's argument is evaluated once and the
 * value is derived from reltuples, never from user input.
 */
async function backgroundSamplePercent(): Promise<number> {
  const total = await corpusVectorRowEstimate()
  if (total <= 0) return 100
  const percent = (100 * BACKGROUND_TARGET_ROWS * 4) / total
  return Math.min(100, Math.max(0.01, percent))
}

/**
 * Background stats for each literal, INDEX-ALIGNED with the input; null where the
 * literal was absent or the sample was too thin to estimate a spread from.
 *
 * Deliberately sampled from the WHOLE corpus rather than the study's scope. The
 * quantity being measured is where this query vector sits relative to the corpus
 * geometry, which the scope does not change — and a narrow scope (the study that
 * exposed this bug matched 66 publications) cannot supply enough rows to
 * estimate anything at all.
 */
export async function semanticBackground(input: {
  literals: Array<string | null>
  timeoutMs?: number
}): Promise<Array<SemanticBackground | null>> {
  const results: Array<SemanticBackground | null> = input.literals.map(() => null)
  // Nulls travel as '' so WITH ORDINALITY keeps every row aligned with its
  // caller-side index; the WHERE drops them after the index is assigned.
  const padded = input.literals.map(literal => literal ?? '')
  if (!padded.some(Boolean)) return results

  const percent = (await backgroundSamplePercent()).toFixed(4)
  const SAMPLE_CLAUSE = Prisma.raw(`TABLESAMPLE SYSTEM (${percent})`)
  const DISTANCE = Prisma.sql`(bg.v ${EMBEDDING_DISTANCE_OP_SQL} q.v)::float8`

  // The literals are parsed into vectors ONCE, in their own materialised CTE.
  // Casting `q.lit` inside the distance expression re-parsed a ~17 KB text
  // literal for every one of the 20,000 background rows it was joined against —
  // measured at ~22 s on the dev corpus for a query whose distances take
  // milliseconds — which is what pushed the estimate past its budget and
  // silently switched the semantic arm off.
  const [, rows] = await prisma.$transaction([
    prisma.$executeRaw`SELECT set_config('statement_timeout', ${String(input.timeoutMs ?? 20_000)}, true)`,
    prisma.$queryRaw<Array<{ idx: number; sampled: number; mean: number; sd: number }>>(Prisma.sql`
      WITH bg AS MATERIALIZED (
        SELECT ${EMBEDDING_COLUMN_SQL} AS v
        FROM "local_patent_embeddings" e ${SAMPLE_CLAUSE}
        WHERE ${COMPARABLE_VECTOR}
        LIMIT ${BACKGROUND_TARGET_ROWS}
      ),
      q AS MATERIALIZED (
        SELECT t.idx::int AS idx, t.lit${EMBEDDING_CAST_SQL} AS v
        FROM unnest(${padded}::text[]) WITH ORDINALITY AS t(lit, idx)
        WHERE t.lit <> ''
      )
      SELECT q.idx                                          AS idx,
             count(*)::int                                  AS sampled,
             avg(${DISTANCE})::float8                       AS mean,
             COALESCE(stddev_samp(${DISTANCE}), 0)::float8  AS sd
      FROM q
      CROSS JOIN bg
      GROUP BY q.idx`),
  ])

  for (const row of rows) {
    const index = Number(row.idx) - 1
    const sampled = Number(row.sampled)
    const sd = Number(row.sd) / DISTANCE_DENOMINATOR
    // A degenerate spread means the sample cannot support a cut; saying so lets
    // the caller fall back honestly instead of emitting a ceiling of `mean`.
    if (index < 0 || index >= results.length || sampled < 100 || !(sd > 0)) continue
    results[index] = { sampled, mean: Number(row.mean) / DISTANCE_DENOMINATOR, sd }
  }
  return results
}

/**
 * The ceiling `z` standard deviations below the query's background mean, clamped
 * to [0,1]. The background is a sum of many near-independent per-dimension
 * contributions (512 bits for Hamming, 1536 terms for cosine), so it is Gaussian
 * by the CLT and z maps to a share of the corpus through the normal CDF.
 */
export function backgroundCeiling(background: SemanticBackground, z: number): number {
  return Math.min(1, Math.max(0, background.mean - z * background.sd))
}

/**
 * Exact distance profile for one query vector: how many comparable documents lie
 * within each ceiling, plus the true mean and sd.
 *
 * OFFLINE CALIBRATION ONLY. This is a FULL SCAN of the embedding table and must
 * never be reached from a request path — it is deliberately not wired to
 * anything but scripts/whitespace-semantic-calibrate.ts.
 *
 * It exists because the calibration script used to COUNT by taking the top 8,000
 * neighbours and filtering them in JS. Every ceiling that admitted more than
 * 8,000 documents therefore reported exactly 8,000, and the script read that as
 * "unknown, raise the sample" rather than as "at least 8,000" — which was
 * already a definitive answer. It sent operators into an unbounded re-run loop
 * over a question its own data had settled. One scan answers the whole grid at
 * once, exactly, with no ceiling and no sample depth to censor it.
 */
export async function calibrationDistanceProfile(input: {
  literal: string
  /** Normalised [0,1] ceilings to count under. */
  ceilings: number[]
  timeoutMs?: number
}): Promise<{ scanned: number; mean: number; sd: number; counts: number[] }> {
  const buckets = Prisma.join(
    input.ceilings.map(ceiling => Prisma.sql`count(*) FILTER (WHERE s.d <= ${ceiling * DISTANCE_DENOMINATOR})::bigint`),
    ', '
  )
  const [, rows] = await prisma.$transaction([
    prisma.$executeRaw`SELECT set_config('statement_timeout', ${String(input.timeoutMs ?? 600_000)}, true)`,
    prisma.$queryRaw<Array<{ scanned: bigint; mean: number; sd: number; counts: bigint[] }>>(Prisma.sql`
        SELECT count(*)::bigint                                AS scanned,
               COALESCE(avg(s.d), 0)::float8                   AS mean,
               COALESCE(stddev_samp(s.d), 0)::float8           AS sd,
               ARRAY[${buckets}]                               AS counts
        FROM (
          SELECT (${EMBEDDING_COLUMN_SQL} ${EMBEDDING_DISTANCE_OP_SQL} ${vectorParamSql(input.literal)})::float8 AS d
          FROM "local_patent_embeddings" e
          WHERE ${COMPARABLE_VECTOR}
        ) s`),
  ])
  const row = rows[0]
  return {
    scanned: Number(row?.scanned ?? 0),
    mean: Number(row?.mean ?? 0) / DISTANCE_DENOMINATOR,
    sd: Number(row?.sd ?? 0) / DISTANCE_DENOMINATOR,
    counts: (row?.counts ?? []).map(Number),
  }
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
  /**
   * Resolve the ceiling from this query's own background instead of a constant:
   * `mean - z * sd`. Ignored when `maxDistance` is given. Falls back to no
   * ceiling (pure top-K) when the background cannot be estimated, which is
   * reported through `appliedMaxDistance: null` rather than silently.
   */
  adaptive?: { z: number }
  timeoutMs?: number
}): Promise<SemanticLaneResult> {
  if (!semanticLaneConfigured()) {
    return { available: false, reason: 'Semantic search is not configured (no embedding key).' }
  }

  let literal: string | null
  try {
    literal = await embedQueryText(input.queryText)
  } catch (error) {
    console.error('[Whitespace] Query embedding failed:', error instanceof Error ? error.message : error)
    return {
      available: false,
      reason: `Query embedding failed: ${describeLaneError(error)}.`,
    }
  }
  if (!literal) return { available: false, reason: 'Query embedding returned no vector.' }

  let appliedMaxDistance = input.maxDistance ?? null
  let background: SemanticBackground | undefined
  if (input.maxDistance === undefined && input.adaptive) {
    try {
      const [stats] = await semanticBackground({ literals: [literal], timeoutMs: input.timeoutMs })
      if (stats) {
        background = stats
        appliedMaxDistance = backgroundCeiling(stats, input.adaptive.z)
      }
    } catch (error) {
      // A failed background estimate must not fail retrieval: the caller still
      // gets the nearest N, and appliedMaxDistance stays null so it knows the
      // result is a ranking rather than a set.
      console.error(
        '[Whitespace] Background estimate failed; falling back to uncapped top-K:',
        error instanceof Error ? error.message : error
      )
    }
  }

  const where = input.scopeFilter ? Prisma.sql`AND ${input.scopeFilter}` : Prisma.empty
  // Parsed once per execution (InitPlan), not once per candidate row.
  const query = vectorParamSql(literal)
  // Applied in the raw metric the operator returns, so the comparison stays on
  // the same scale the index orders by.
  const distanceCeiling =
    appliedMaxDistance === null
      ? Prisma.empty
      : Prisma.sql`AND (${EMBEDDING_COLUMN_SQL} ${EMBEDDING_DISTANCE_OP_SQL} ${query}) <= ${
          appliedMaxDistance * DISTANCE_DENOMINATOR
        }`

  // pgvector's HNSW scan returns AT MOST hnsw.ef_search rows (default 40).
  // The binary corpus is IVFFlat, but the float column's ANN index is HNSW
  // (migration 20260518143000 prefers it) — and there a candidate retrieval
  // with limit 20,000 silently came back with ~40 rows, quietly gutting the
  // semantic arm while looking perfectly healthy. ef_search is capped at 1000
  // by pgvector, so retrievals past that may still be truncated on HNSW; the
  // planner's exact scan takes over on small corpora, and IVFFlat (production)
  // has no such row cap.
  //
  // A scopeFilter makes the row cap far more dangerous, because the filter is
  // applied AFTER the index has already chosen its rows. Sizing ef_search off
  // `limit` alone meant hypothesize's nearest-neighbour probe (limit 1) asked
  // the index for 40 candidates corpus-wide and then required them to fall
  // inside one study's field: for any field that is a small share of the
  // corpus, the answer was reliably zero rows. That reads as "no neighbour
  // found", so semanticNovelty came back null for every hypothesis — and
  // `strength` is a product that any null pillar collapses, so the studio's
  // headline ranking score was null across the board. When a filter is present
  // the pool has to be big enough that some of it survives the filter.
  const SCOPED_CANDIDATE_POOL = 1_000
  const wanted = input.scopeFilter ? Math.max(input.limit, SCOPED_CANDIDATE_POOL) : input.limit
  const efSearch = String(Math.max(40, Math.min(1000, wanted)))
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
               (${EMBEDDING_COLUMN_SQL} ${EMBEDDING_DISTANCE_OP_SQL} ${query})::float AS distance
        FROM "local_patent_embeddings" e
        JOIN "local_patents" lp ON lp."id" = e."localPatentId"
        WHERE ${COMPARABLE_VECTOR}
        ${where}
        ${distanceCeiling}
        ORDER BY ${EMBEDDING_COLUMN_SQL} ${EMBEDDING_DISTANCE_OP_SQL} ${query}
        LIMIT ${input.limit}`),
    ])
    return {
      available: true,
      neighbors: rows.map(row => ({ ...row, distance: Number(row.distance) / DISTANCE_DENOMINATOR })),
      appliedMaxDistance,
      background,
    }
  } catch (error) {
    console.error('[Whitespace] Semantic retrieval failed:', error instanceof Error ? error.message : error)
    return {
      available: false,
      reason: `Semantic retrieval failed: ${describeLaneError(error, input.timeoutMs ?? 20_000)}.`,
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
