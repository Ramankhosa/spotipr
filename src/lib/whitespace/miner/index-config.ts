/**
 * Invention Miner — runtime check that the statement vector column matches the
 * configured embedding model.
 *
 * `patent_problem_statements.embedding` has no fixed type in the schema: the
 * migration creates it from whichever `local_patent_embeddings` column this
 * deployment actually populates (prod: bit(512) Voyage binary; a dev box pinned
 * to OpenAI: vector(1536)). Prisma declares it as Unsupported("bit(512)") and
 * never reads it — all access is raw SQL — so nothing in the type system will
 * ever notice the two drifting apart.
 *
 * This exact drift is what silently emptied Office Action retrieval: the chunk
 * column stayed bit(512) while the pinned model produced vector(1536), every
 * vector search threw a type error inside a catch that returned [], and every
 * reply was drafted with no specification basis while every run reported
 * success. checkRetrievalConfig() was added to name that fault out loud; this is
 * the same check for the miner's own table, and it must be consulted before any
 * conclusion that depends on statement retrieval ("no publication in the field
 * admits this problem") is written down.
 */

import { prisma } from '@/lib/prisma'

const STATEMENT_TABLE = 'patent_problem_statements'
const STATEMENT_COLUMN = 'embedding'

/**
 * Cached per process — the column type only changes with a migration, and a
 * restart follows one. A NULL read is NOT cached: a fresh checkout that has not
 * migrated yet must be able to answer correctly once it has, without a restart.
 */
let columnTypePromise: Promise<string | null> | null = null

async function statementEmbeddingColumnType(): Promise<string | null> {
  if (!columnTypePromise) {
    columnTypePromise = prisma
      .$queryRawUnsafe<Array<{ type: string }>>(
        `SELECT format_type(a.atttypid, a.atttypmod) AS type
           FROM pg_attribute a
           JOIN pg_class c ON c.oid = a.attrelid
          WHERE c.relname = '${STATEMENT_TABLE}' AND a.attname = '${STATEMENT_COLUMN}' AND a.attnum > 0`
      )
      .then(rows => rows?.[0]?.type || null)
      .catch(() => null)
  }
  const resolved = await columnTypePromise
  if (!resolved) columnTypePromise = null
  return resolved
}

/**
 * Does the stored statement column accept vectors of the configured dtype?
 *
 * Returns ok when it CANNOT TELL — a checkout with no database, or one that has
 * not run the miner migration, must not have its app broken by a check whose
 * whole job is to catch a deployment fault. Crying wolf here would train
 * operators to ignore the one message that matters.
 *
 * The reason is user-facing: one sentence, naming the fix.
 */
export async function checkMinerIndexConfig(): Promise<{ ok: true } | { ok: false; reason: string }> {
  const actual = await statementEmbeddingColumnType()
  if (!actual) return { ok: true } // no DB, or the miner migration has not run — cannot tell

  const { PATENT_CORPUS_EMBEDDING_SQL_TYPE, PATENT_CORPUS_EMBEDDING_DIMENSIONS, PATENT_CORPUS_EMBEDDING_MODEL } =
    await import('@/lib/patent-corpus-service')
  const expected = `${PATENT_CORPUS_EMBEDDING_SQL_TYPE}(${PATENT_CORPUS_EMBEDDING_DIMENSIONS})`
  const normalize = (value: string) => value.replace(/\s+/g, '').toLowerCase()
  if (normalize(actual) === normalize(expected)) return { ok: true }

  return {
    ok: false,
    reason:
      `${STATEMENT_TABLE}.${STATEMENT_COLUMN} is ${actual} but PATENT_CORPUS_EMBEDDING_MODEL=${PATENT_CORPUS_EMBEDDING_MODEL} produces ${expected}, `
      + `so no statement can be compared with any other until the column is rebuilt with scripts/fix-miner-statement-embedding-column.ts.`,
  }
}
