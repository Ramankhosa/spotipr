/**
 * Invention Miner — SQL fragments for the STATEMENT vector space.
 *
 * `patent_problem_statements` is the miner's second vector space: one row per
 * problem, mechanism or claim core extracted from a publication, embedded so
 * that "has anyone else admitted this problem?" becomes a nearest-neighbour
 * question instead of a keyword one.
 *
 * It deliberately does NOT reuse `semanticMatchSql` / `comparableVectorSql` from
 * ../embedding. Those three fragments are hardcoded to the CORPUS table's shape:
 *   - the alias `e` is baked into the column reference,
 *   - the column is one of embedding / embeddingHalf / embeddingBinary, and this
 *     table has a single column named "embedding" whatever the dtype,
 *   - the row filter tests `e."status" = 'COMPLETED'::"PatentEmbeddingStatus"`
 *     and `e."model"`, neither of which exists on this table.
 * Calling them here would not fail cleanly — it would produce SQL referencing a
 * missing alias or a missing enum, which the callers' catch blocks report as a
 * bland "semantic retrieval failed", i.e. exactly the shape of a lane that is
 * merely unconfigured.
 *
 * The dtype, dimensionality and distance operator still come from the same
 * PATENT_CORPUS_EMBEDDING_* constants as everything else, because the statement
 * vectors are produced by the same provider as the corpus vectors and the
 * migration creates this column with whatever type the corpus column has.
 */

import { Prisma } from '@prisma/client'
import {
  PATENT_CORPUS_EMBEDDING_DIMENSIONS,
  PATENT_CORPUS_EMBEDDING_DISTANCE_OP,
  PATENT_CORPUS_EMBEDDING_DTYPE,
  PATENT_CORPUS_EMBEDDING_SQL_TYPE,
} from '@/lib/patent-corpus-service'
import { vectorParamSql } from '../embedding'

/** Kept byte-identical to ../embedding's EMBEDDING_CAST_SQL. */
const CAST_SQL = Prisma.raw(
  PATENT_CORPUS_EMBEDDING_SQL_TYPE === 'bit'
    ? `::bit(${PATENT_CORPUS_EMBEDDING_DIMENSIONS})`
    : `::${PATENT_CORPUS_EMBEDDING_SQL_TYPE}`
)

const DISTANCE_OP_SQL = Prisma.raw(PATENT_CORPUS_EMBEDDING_DISTANCE_OP)

/**
 * Hamming spans 0..N bits, cosine distance spans 0..2, so both are divided onto
 * [0,1] and every threshold in the miner means the same thing on either
 * installation.
 *
 * Duplicated from ../embedding rather than imported because DISTANCE_DENOMINATOR
 * is module-private there and this module may not edit that file. It is derived
 * from the same constant by the same expression, so the two cannot disagree
 * without the shared constant itself changing.
 */
const DISTANCE_DENOMINATOR =
  PATENT_CORPUS_EMBEDDING_DTYPE === 'binary' ? PATENT_CORPUS_EMBEDDING_DIMENSIONS : 2

/**
 * Aliases are written by this module's callers, never by a user — but they reach
 * SQL through Prisma.raw, so they are validated rather than trusted. A typo that
 * silently produced `"lp x"."embedding"` would be a syntax error; anything worse
 * would be an injection.
 */
function assertAlias(alias: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) {
    throw new Error(`Invalid SQL alias for the statement table: ${JSON.stringify(alias)}`)
  }
  return alias
}

/** `"<alias>"."embedding"` — the statement table's vector column, whatever its dtype. */
export function statementColumnSql(alias: string): Prisma.Sql {
  return Prisma.raw(`"${assertAlias(alias)}"."embedding"`)
}

/**
 * The distance operator applied bare: `"<alias>"."embedding" <op> (query)::cast`.
 *
 * This is the ONLY form pgvector's index can serve. An ANN index scan is chosen
 * by matching the ORDER BY pathkey against `<indexed column> <operator>
 * <constant>`; wrap that in a cast or divide it by anything and the planner can
 * no longer match it, silently falling back to a sequential scan of every
 * statement. So: ORDER BY this, SELECT and filter on statementDistanceSql.
 *
 * It costs nothing today — the migration deliberately leaves this table
 * unindexed until there are enough rows to place IVFFlat centroids, so every
 * scan is exact — and it is the difference between a working and a useless
 * query the day scripts/build-miner-statement-index.ts runs.
 *
 * `queryExpr` may be a bound literal (statementVectorLiteralSql), a column from
 * an unnest CTE, or any other vector-valued expression; the cast applied here is
 * a no-op on an already-typed expression, so callers never have to remember
 * which form they are holding.
 */
export function statementRawDistanceSql(alias: string, queryExpr: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`${statementColumnSql(alias)} ${DISTANCE_OP_SQL} (${queryExpr})${CAST_SQL}`
}

/**
 * Distance from a statement row to a query vector, NORMALISED to [0,1] — the
 * scale every threshold, score and report sentence in the miner is expressed in.
 *
 * For SELECT lists and WHERE clauses. See statementRawDistanceSql for why an
 * ORDER BY must not use this one.
 */
export function statementDistanceSql(alias: string, queryExpr: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`((${statementRawDistanceSql(alias, queryExpr)})::float8 / ${DISTANCE_DENOMINATOR})`
}

/**
 * pgvector's IVFFlat default is ONE probe and its HNSW default is ef_search 40.
 * Neither default is a search — one probe reads a single centroid's list, and a
 * 40-row HNSW scan silently truncates any larger LIMIT (that exact default is
 * what quietly gutted the corpus semantic arm; see ../embedding:532-560). A
 * statement query that does not set these does not return "the nearest
 * statements", it returns a near-arbitrary subset of them, ranked plausibly and
 * wrong — which reads on the page as "nobody else raised this problem", the most
 * consequential sentence the miner can emit.
 *
 * Set transaction-locally (`set_config(..., true)`) so the value cannot leak to
 * the next statement on a pooled connection. Emit this as the FIRST operation of
 * the same `prisma.$transaction([...])` as the query it is sizing, exactly as
 * ../embedding does — outside a transaction the `true` makes it a no-op.
 *
 * dtype-aware: only the GUC that governs this deployment's index family is set,
 * so the fragment does not depend on both extensions' parameters existing.
 * Harmless while the table has no vector index at all (the migration leaves it
 * unindexed until there are enough rows to place IVFFlat centroids): the planner
 * then runs an exact scan and both settings are ignored.
 */
export function statementIndexSettingsSql(opts?: { probes?: number; efSearch?: number }): Prisma.Sql {
  // 24 probes is the value ../embedding uses against the corpus index; keeping
  // them equal means a miner recall figure is comparable with a corpus one.
  const probes = String(Math.max(1, Math.trunc(opts?.probes ?? 24)))
  // pgvector clamps hnsw.ef_search at 1,000, and an HNSW scan returns at most
  // ef_search rows, so this is also the row ceiling on a float installation.
  const efSearch = String(Math.max(1, Math.min(1_000, Math.trunc(opts?.efSearch ?? 200))))

  return PATENT_CORPUS_EMBEDDING_DTYPE === 'binary'
    ? Prisma.sql`SELECT set_config('ivfflat.probes', ${probes}, true)`
    : Prisma.sql`SELECT set_config('hnsw.ef_search', ${efSearch}, true)`
}

/**
 * A bound vector literal parsed ONCE per execution rather than once per row.
 *
 * Delegates to ../embedding's vectorParamSql: the wrapping scalar subquery
 * (InitPlan) trick and the dtype cast are identical for both vector spaces, and
 * a second implementation of it would be a second thing to keep in step.
 */
export function statementVectorLiteralSql(literal: string): Prisma.Sql {
  return vectorParamSql(literal)
}
