/**
 * Deletes stored journal PDFs past their retention window.
 *
 * The queue runner already does this, but only when it goes idle -- on a quiet
 * system that may never happen. Run this from cron for a deterministic sweep.
 *
 *   npm run patent-corpus:cleanup
 *   npm run patent-corpus:cleanup -- --limit 1000
 *
 * Extracted patent records and embeddings are never touched.
 */
import { cleanupOldStoredPdfs } from '../src/lib/patent-corpus-service'
import { prisma } from '../src/lib/prisma'

function parseLimit() {
  const index = process.argv.indexOf('--limit')
  if (index === -1) return 200
  const value = Number(process.argv[index + 1])
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 200
}

async function main() {
  const limit = parseLimit()
  const started = Date.now()
  const result = await cleanupOldStoredPdfs(limit)
  const seconds = ((Date.now() - started) / 1000).toFixed(1)

  console.log(
    `[PatentCorpus] Retention sweep finished in ${seconds}s -- checked ${result.checked} file(s), deleted ${result.deleted} PDF(s).`
  )
  if (result.checked === limit) {
    console.log(`[PatentCorpus] Hit the ${limit}-file limit; run again to continue.`)
  }
}

main()
  .catch(error => {
    console.error('[PatentCorpus] Retention sweep failed:', error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
