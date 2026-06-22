import { processPendingNoveltySearchEmails, processPendingNoveltySearchJobs } from '../src/lib/novelty-search-job-service'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function main() {
  const workerId = process.env.NOVELTY_SEARCH_WORKER_ID || `novelty-worker-${process.pid}`
  const once = process.argv.includes('--once') || process.env.NOVELTY_SEARCH_WORKER_ONCE === 'true'
  const batch = Math.max(1, Number(process.env.NOVELTY_SEARCH_WORKER_BATCH || 1))

  do {
    const processed = await processPendingNoveltySearchJobs(workerId, batch)
    await processPendingNoveltySearchEmails(2)
    if (once) break
    if (!processed.length) await sleep(5000)
  } while (true)
}

main().catch(error => {
  console.error('[NoveltySearchWorker] Fatal error:', error)
  process.exit(1)
})
