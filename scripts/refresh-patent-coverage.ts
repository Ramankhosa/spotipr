import './load-env'
import { prisma } from '../src/lib/prisma'
import {
  PATENT_CORPUS_EMBEDDING_MODEL,
  refreshPatentCorpusCoverageSnapshot,
} from '../src/lib/patent-corpus-service'

/**
 * Recomputes the corpus coverage census and stores it in
 * patent_corpus_coverage_snapshots.
 *
 * The census is several full-table scans, so it is deliberately kept off every
 * request path — the public API only ever reads the snapshot this writes. Run it
 * after a deploy or a large import to populate the numbers immediately instead of
 * waiting for the corpus worker's interval.
 */
async function main() {
  const startedAt = Date.now()
  console.log(`[PatentCoverage] Computing census for model ${PATENT_CORPUS_EMBEDDING_MODEL}...`)
  const { stats, durationMs } = await refreshPatentCorpusCoverageSnapshot()
  console.log(JSON.stringify({
    embeddingModel: stats.embeddingModel,
    totalPatents: stats.totalPatents,
    patentsWithCompletedEmbedding: stats.patentsWithCompletedEmbedding,
    coveragePercent: stats.coveragePercent,
    sourceCoverage: stats.sourceCoverage,
    censusDurationMs: durationMs,
    totalDurationMs: Date.now() - startedAt,
  }, null, 2))
}

main()
  .catch(error => {
    console.error('[PatentCoverage] Refresh failed:', error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
