import './load-env'
import {
  processPendingPatentEmbeddings,
  processPendingPatentImportFiles,
} from '../src/lib/patent-corpus-service'
import {
  processPendingIpIndiaJournalArchive,
  queueLatestIpIndiaJournalFiles,
} from '../src/lib/ipindia-journal-archive-service'

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function envNumber(name: string, fallback: number) {
  const value = process.env[name]
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function envBoolean(name: string, fallback: boolean) {
  const value = process.env[name]
  if (value === undefined || value === '') return fallback
  return !['0', 'false', 'no', 'off'].includes(value.toLowerCase())
}

async function main() {
  const workerId = process.env.PATENT_CORPUS_WORKER_ID || `patent-corpus-worker-${process.pid}`
  const once = process.env.PATENT_CORPUS_WORKER_ONCE === 'true' || process.argv.includes('--once')
  const fileBatch = Math.max(1, envNumber('PATENT_CORPUS_FILE_BATCH', 1))
  const journalBatch = Math.max(0, envNumber('IPINDIA_JOURNAL_WORKER_BATCH', 1))
  const journalDelayMs = Math.max(0, envNumber('IPINDIA_JOURNAL_WORKER_DELAY_MS', 10000))
  const dailyLatestCheck = envBoolean('IPINDIA_JOURNAL_DAILY_CHECK', true)
  const dailyLatestCheckIntervalMs = Math.max(60 * 60 * 1000, envNumber('IPINDIA_JOURNAL_DAILY_CHECK_INTERVAL_MS', 24 * 60 * 60 * 1000))
  const latestCheckLimit = Math.max(1, envNumber('IPINDIA_JOURNAL_LATEST_CHECK_LIMIT', 1))
  const embeddingClaimMax = Math.max(1, envNumber('PATENT_CORPUS_EMBEDDING_CLAIM_MAX', 512))
  const embeddingBatch = Math.max(0, Math.min(envNumber('PATENT_CORPUS_EMBEDDING_BATCH', 128), embeddingClaimMax))
  let lastDailyLatestCheckAt = 0

  async function maybeQueueLatestJournals() {
    if (once || !dailyLatestCheck) return null
    if (Date.now() - lastDailyLatestCheckAt < dailyLatestCheckIntervalMs) return null
    lastDailyLatestCheckAt = Date.now()
    try {
      const result = await queueLatestIpIndiaJournalFiles({ limit: latestCheckLimit, retryFailed: true })
      if (result.queued > 0) {
        console.log(`[PatentCorpusWorker] Daily IP India latest check queued ${result.queued} PDF(s).`)
      }
      return result
    } catch (error) {
      console.warn('[PatentCorpusWorker] Daily IP India latest check failed:', error)
      return null
    }
  }

  do {
    await maybeQueueLatestJournals()
    const journals = journalBatch > 0
      ? await processPendingIpIndiaJournalArchive(workerId, journalBatch)
      : []
    const imported = await processPendingPatentImportFiles(workerId, fileBatch)
    const embedded = embeddingBatch > 0
      ? await processPendingPatentEmbeddings(workerId, embeddingBatch)
      : []

    if (once) {
      console.log(`[PatentCorpusWorker] Downloaded/imported ${journals.length} IP India PDF(s), extracted ${imported.length} file(s), processed ${embedded.length} embedding(s).`)
      break
    }

    if (journals.length && journalDelayMs > 0) {
      await sleep(journalDelayMs)
    }

    if (!journals.length && !imported.length && !embedded.length) {
      await sleep(5000)
    }
  } while (true)
}

main().catch(error => {
  console.error('[PatentCorpusWorker] Fatal error:', error)
  process.exit(1)
})
