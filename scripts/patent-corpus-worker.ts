import {
  processPendingPatentEmbeddings,
  processPendingPatentImportFiles,
} from '../src/lib/patent-corpus-service'

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function envNumber(name: string, fallback: number) {
  const value = process.env[name]
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

async function main() {
  const workerId = process.env.PATENT_CORPUS_WORKER_ID || `patent-corpus-worker-${process.pid}`
  const once = process.env.PATENT_CORPUS_WORKER_ONCE === 'true' || process.argv.includes('--once')
  const fileBatch = Math.max(1, envNumber('PATENT_CORPUS_FILE_BATCH', 1))
  const embeddingBatch = Math.max(0, envNumber('PATENT_CORPUS_EMBEDDING_BATCH', 4))

  do {
    const imported = await processPendingPatentImportFiles(workerId, fileBatch)
    const embedded = embeddingBatch > 0
      ? await processPendingPatentEmbeddings(workerId, embeddingBatch)
      : []

    if (once) {
      console.log(`[PatentCorpusWorker] Imported ${imported.length} file(s), processed ${embedded.length} embedding(s).`)
      break
    }

    if (!imported.length && !embedded.length) {
      await sleep(5000)
    }
  } while (true)
}

main().catch(error => {
  console.error('[PatentCorpusWorker] Fatal error:', error)
  process.exit(1)
})
