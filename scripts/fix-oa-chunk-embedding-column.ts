/**
 * Align oa_document_chunks.embedding with the configured embedding model.
 *
 * WHY THIS IS A SCRIPT AND NOT A MIGRATION
 * A column-level ALTER on this table is a full-table rewrite, which the repo's
 * migration safety contract forbids in `prisma migrate` (see
 * 20260721120000_epo_bdds_ingest). Same class as
 * local_patent_embeddings.embeddingBinary: the vector column is changed
 * deliberately, by an operator, outside Prisma.
 *
 * WHAT IT FIXES
 * The column was created as bit(512) for the Voyage corpus contract
 * (voyage-3.5-lite, 512-dim binary, Hamming <~>), but deployments run with
 * PATENT_CORPUS_EMBEDDING_MODEL=text-embedding-3-small, which produces
 * vector(1536) with cosine distance. Under that mismatch every chunk write and
 * every retrieval query threw a type error that the callers caught, so Office
 * Action retrieval returned nothing for every objection while the run reported
 * success — replies were drafted with no specification basis.
 *
 * Existing embeddings under a mismatched configuration are necessarily NULL (no
 * write could have succeeded), so nothing is lost. Documents are reset to
 * PENDING; the next prepare run re-indexes them.
 *
 *   npm run oa:fix-embedding-column          # report only
 *   npm run oa:fix-embedding-column -- --apply
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
      WHERE c.relname = 'oa_document_chunks' AND a.attname = 'embedding' AND a.attnum > 0`
  )
  const actual = rows?.[0]?.type

  if (!actual) {
    console.error('Could not read oa_document_chunks.embedding — does the table exist?')
    process.exitCode = 1
    return
  }

  console.log(`model     ${PATENT_CORPUS_EMBEDDING_MODEL} (${PATENT_CORPUS_EMBEDDING_DTYPE})`)
  console.log(`expected  ${expected}`)
  console.log(`actual    ${actual}`)

  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase()
  if (norm(actual) === norm(expected)) {
    console.log('\nAlready aligned — Office Action retrieval can run. Nothing to do.')
    return
  }

  const opClass = PATENT_CORPUS_EMBEDDING_DTYPE === 'binary' ? 'bit_hamming_ops' : 'vector_cosine_ops'
  const statements = [
    `DROP INDEX IF EXISTS "oa_document_chunks_embedding_idx"`,
    `ALTER TABLE "oa_document_chunks" DROP COLUMN IF EXISTS "embedding"`,
    `ALTER TABLE "oa_document_chunks" ADD COLUMN "embedding" ${expected}`,
    `CREATE INDEX "oa_document_chunks_embedding_idx" ON "oa_document_chunks" USING ivfflat ("embedding" ${opClass}) WITH (lists = 100)`,
    `UPDATE "oa_case_documents" SET "indexStatus" = 'PENDING' WHERE "kind" IN ('SPECIFICATION', 'SUPPLEMENTARY')`,
  ]

  if (!apply) {
    console.log('\nMISMATCH — Office Action retrieval cannot work until this is fixed.')
    console.log('Re-run with --apply to execute:\n')
    for (const s of statements) console.log(`  ${s};`)
    console.log('\nAlso update the `embedding` type in prisma/schema.prisma to match, so')
    console.log('`prisma migrate diff` stops proposing it.')
    return
  }

  const chunks = await prisma.oaDocumentChunk.count()
  console.log(`\nApplying (${chunks} chunk row(s); their embeddings are NULL under the mismatch)…`)
  for (const s of statements) {
    console.log(`  ${s}`)
    await prisma.$executeRawUnsafe(s)
  }
  console.log('\nDone. Case documents are marked PENDING; the next prepare run re-indexes them.')
  console.log('Update the `embedding` type in prisma/schema.prisma to match.')
}

main()
  .catch(e => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
