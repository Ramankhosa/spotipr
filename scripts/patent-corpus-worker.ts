import './load-env'
import {
  hasCorpusEmbeddingApiKey,
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

function realtimeEmbeddingsEnabled() {
  const mode = String(process.env.PATENT_CORPUS_EMBEDDING_MODE || '').trim().toLowerCase()
  if (mode) return !['batch', 'off', 'disabled', 'false', '0'].includes(mode)
  return envBoolean('PATENT_CORPUS_REALTIME_EMBEDDINGS', true)
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
  const realtimeEmbeddings = realtimeEmbeddingsEnabled()
  const embeddingBatch = realtimeEmbeddings
    ? Math.max(0, Math.min(envNumber('PATENT_CORPUS_EMBEDDING_BATCH', 32), embeddingClaimMax))
    : 0
  let lastDailyLatestCheckAt = 0

  console.log('[PatentCorpusWorker] Started:', {
    workerId,
    fileBatch,
    journalBatch,
    realtimeEmbeddings,
    embeddingBatch,
    hasOpenAIKey: hasCorpusEmbeddingApiKey(),
    hasDedicatedCorpusOpenAIKey: Boolean(process.env.OPENAI_CORPUS_API_KEY),
  })
  if (embeddingBatch > 0 && !hasCorpusEmbeddingApiKey()) {
    console.warn('[PatentCorpusWorker] Embedding processing is enabled but OPENAI_CORPUS_API_KEY and OPENAI_API_KEY are missing in this PM2 process.')
  }

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
    const embedded = embeddingBatch > 0 && hasCorpusEmbeddingApiKey()
      ? await processPendingPatentEmbeddings(workerId, embeddingBatch)
      : []
    if (embedded.length > 0) {
      const completed = embedded.filter((embedding: any) => embedding?.status === 'COMPLETED').length
      const failedRows = embedded.filter((embedding: any) => embedding?.status === 'FAILED')
      const details = {
        event: 'embedding_batch_processed',
        workerId,
        processed: embedded.length,
        completed,
        failed: failedRows.length,
        failedSamples: failedRows.slice(0, 3).map((embedding: any) => ({
          id: embedding.id,
          attemptCount: embedding.attemptCount,
          errorMessage: String(embedding.errorMessage || '').slice(0, 500),
          nextAttemptAt: embedding.nextAttemptAt,
        })),
      }
      if (failedRows.length) console.warn('[PatentCorpusWorker]', JSON.stringify(details))
      else console.log('[PatentCorpusWorker]', JSON.stringify(details))
    }

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
