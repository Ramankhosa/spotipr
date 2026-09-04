/**
 * Align patent_problem_statements.embedding with the configured embedding model.
 *
 * WHY THIS EXISTS AT ALL
 * The miner's statement index is a second vector space over extracted problems,
 * mechanisms and claim cores. Its column type is a property of the DEPLOYMENT,
 * not of the schema: production embeds Voyage binary (bit(512), Hamming), while
 * a dev box pinned to text-embedding-3-small embeds vector(1536) with cosine.
 * The creating migration reads the type off whichever local_patent_embeddings
 * column that deployment actually populates, so in the normal case this script
 * has nothing to do.
 *
 * It exists for the abnormal case: the corpus was re-embedded under a different
 * model after the miner's table was created, or the table was created on an
 * empty corpus and defaulted. Under a mismatch every statement write and every
 * statement query throws a type error that the callers catch, so the engines
 * would report "no statements indexed" and the gate would report unavailable
 * lanes — a pipeline that runs, reports success, and finds nothing. That is
 * exactly how Office Action retrieval failed silently before its own drift
 * check existed, which is why checkMinerIndexConfig() refuses to run the
 * engines on drift and names this script.
 *
 * WHY IT IS A SCRIPT AND NOT A MIGRATION
 * A column-level ALTER is a full-table rewrite, which the repo's migration
 * safety contract keeps out of `prisma migrate` (see 20260721120000). The
 * vector column is changed deliberately, by an operator.
 *
 * Statements written under a mismatched configuration necessarily have a NULL
 * embedding (no write could have succeeded), so dropping the column loses
 * nothing. The rows themselves are kept: their text is the expensive part and
 * re-embedding is cheap. A re-harvest re-indexes them.
 *
 *   npm run im:fix-embedding-column          # report only
 *   npm run im:fix-embedding-column -- --apply
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import {
  PATENT_CORPUS_EMBEDDING_SQL_TYPE,
  PATENT_CORPUS_EMBEDDING_DIMENSIONS,
  PATENT_CORPUS_EMBEDDING_MODEL,
  PATENT_CORPUS_EMBEDDING_DTYPE,
} from '../src/lib/patent-corpus-service'

const prisma = new PrismaClient()
const apply = process.argv.includes('--apply')

async function main() {
  const expected = `${PATENT_CORPUS_EMBEDDING_SQL_TYPE}(${PATENT_CORPUS_EMBEDDING_DIMENSIONS})`
  const rows = await prisma.$queryRawUnsafe<Array<{ type: string }>>(
    `SELECT format_type(a.atttypid, a.atttypmod) AS type
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
      WHERE c.relname = 'patent_problem_statements' AND a.attname = 'embedding' AND a.attnum > 0`
  )
  const actual = rows?.[0]?.type

  if (!actual) {
    console.error('Could not read patent_problem_statements.embedding — has the miner migration been applied?')
    process.exitCode = 1
    return
  }

  console.log(`model     ${PATENT_CORPUS_EMBEDDING_MODEL} (${PATENT_CORPUS_EMBEDDING_DTYPE})`)
  console.log(`expected  ${expected}`)
  console.log(`actual    ${actual}`)

  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase()
  if (norm(actual) === norm(expected)) {
    console.log('\nAlready aligned — the miner can index and query statements. Nothing to do.')
    return
  }

  // The index is rebuilt separately and only above a row floor: IVFFlat fixes
  // its centroids at build time, so an index created here on a table whose
  // vectors were just dropped would place every later insert into an arbitrary
  // list. scripts/build-miner-statement-index.ts is the one that builds it.
  const statements = [
    `DROP INDEX IF EXISTS "patent_problem_statements_embedding_idx"`,
    `ALTER TABLE "patent_problem_statements" DROP COLUMN IF EXISTS "embedding"`,
    `ALTER TABLE "patent_problem_statements" ADD COLUMN "embedding" ${expected}`,
  ]

  const total = await prisma.patentProblemStatement.count()

  if (!apply) {
    console.log('\nMISMATCH — the miner cannot index or compare statements until this is fixed.')
    console.log(`${total} statement row(s) present; their embeddings are NULL under the mismatch.`)
    console.log('Re-run with --apply to execute:\n')
    for (const s of statements) console.log(`  ${s};`)
    console.log('\nAfterwards: re-run Reading the field on any study that has already harvested,')
    console.log('then rebuild the index with `npm run im:build-statement-index` once the table is large.')
    return
  }

  console.log(`\nApplying (${total} statement row(s); text is kept, only the vectors are re-made)…`)
  for (const s of statements) {
    console.log(`  ${s}`)
    await prisma.$executeRawUnsafe(s)
  }
  console.log('\nDone. Re-run Reading the field to re-index; the extracted text is cached, so it costs no model calls.')
}

main()
  .catch(e => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
