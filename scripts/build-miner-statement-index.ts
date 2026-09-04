/**
 * Build the ANN index over patent_problem_statements.embedding.
 *
 * WHY THE MIGRATION DOES NOT DO THIS
 * IVFFlat fixes its centroids at BUILD time. An index created on an empty table
 * picks its lists from nothing, and every row inserted afterwards lands in an
 * effectively arbitrary list — a 24-probe scan then misses most true
 * neighbours, silently, with no error and no empty result to notice. The
 * corpus index has the same note on it in the schema: built out-of-band,
 * CONCURRENTLY, over rows that already existed, and REINDEXed after a large
 * refresh.
 *
 * So the miner's statement table is created without a vector index and stays
 * that way until it holds enough rows to place centroids. Below the floor,
 * exact scans are not a degradation — they are the correct answer, and on a
 * table of this size they are fast.
 *
 * Note the table is CORPUS-WIDE: statements accumulate across every study, so
 * the floor is reached by usage, not by any one run.
 *
 *   npm run im:build-statement-index          # report only
 *   npm run im:build-statement-index -- --apply
 *   npm run im:build-statement-index -- --apply --force   # below the floor, deliberately
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import {
  PATENT_CORPUS_EMBEDDING_DTYPE,
  PATENT_CORPUS_EMBEDDING_MODEL,
} from '../src/lib/patent-corpus-service'

const prisma = new PrismaClient()
const apply = process.argv.includes('--apply')
const force = process.argv.includes('--force')

const INDEX_NAME = 'patent_problem_statements_embedding_idx'
/**
 * Below this, centroids would be placed from too few points to be meaningful
 * and an exact scan is cheap anyway. Chosen to match the order of magnitude at
 * which pgvector's own guidance starts recommending IVFFlat.
 */
const ROW_FLOOR = 50_000

async function main() {
  const [{ rows }] = await prisma.$queryRawUnsafe<Array<{ rows: bigint }>>(
    `SELECT count(*)::bigint AS rows FROM "patent_problem_statements" WHERE "embedding" IS NOT NULL`
  )
  const embedded = Number(rows)

  const existing = await prisma.$queryRawUnsafe<Array<{ indexname: string }>>(
    `SELECT indexname FROM pg_indexes WHERE tablename = 'patent_problem_statements' AND indexname = $1`,
    INDEX_NAME
  )

  console.log(`model     ${PATENT_CORPUS_EMBEDDING_MODEL} (${PATENT_CORPUS_EMBEDDING_DTYPE})`)
  console.log(`embedded  ${embedded.toLocaleString()} statement(s)`)
  console.log(`index     ${existing.length ? 'present' : 'absent'}`)

  if (existing.length) {
    console.log('\nThe index exists. To rebuild it after a large change in row count:')
    console.log(`  REINDEX INDEX CONCURRENTLY "${INDEX_NAME}";`)
    console.log('or drop it and re-run this script so the list count is recomputed.')
    return
  }

  if (embedded < ROW_FLOOR && !force) {
    console.log(
      `\nBelow the ${ROW_FLOOR.toLocaleString()}-row floor. Statement queries are running as exact scans,`
    )
    console.log('which is correct and fast at this size. Nothing to do — re-run as the corpus of')
    console.log('extracted statements grows. Use --force only if you know why you want centroids now.')
    return
  }

  // pgvector's rule of thumb for datasets of this order; the corpus index uses
  // the same shape at a much larger scale (lists = 5000 over ~30M vectors).
  const lists = Math.max(100, Math.round(Math.sqrt(embedded)))
  const opClass = PATENT_CORPUS_EMBEDDING_DTYPE === 'binary' ? 'bit_hamming_ops' : 'vector_cosine_ops'
  const method = PATENT_CORPUS_EMBEDDING_DTYPE === 'binary' ? 'ivfflat' : 'hnsw'
  const statement =
    method === 'ivfflat'
      ? `CREATE INDEX CONCURRENTLY "${INDEX_NAME}" ON "patent_problem_statements" USING ivfflat ("embedding" ${opClass}) WITH (lists = ${lists}) WHERE "embedding" IS NOT NULL`
      : `CREATE INDEX CONCURRENTLY "${INDEX_NAME}" ON "patent_problem_statements" USING hnsw ("embedding" ${opClass}) WHERE "embedding" IS NOT NULL`

  if (!apply) {
    console.log('\nReady to build. Re-run with --apply to execute:\n')
    console.log(`  ${statement};`)
    console.log('\nCONCURRENTLY, so it does not lock out the harvest. It cannot run inside a')
    console.log('transaction, which is the other reason this is a script and not a migration.')
    return
  }

  console.log(`\nBuilding (${method}, ${method === 'ivfflat' ? `lists = ${lists}` : 'default parameters'})…`)
  console.log(`  ${statement}`)
  await prisma.$executeRawUnsafe(statement)
  console.log('\nDone. Statement lanes will use the index; queries already set their own')
  console.log('probes / ef_search per statement, so no further tuning is needed here.')
}

main()
  .catch(e => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
