import { processPendingPatentDraftingJobs } from '../src/lib/patent-drafting-job-service'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function main() {
  const workerId = process.env.PATENT_DRAFTING_WORKER_ID || `patent-drafting-worker-${process.pid}`
  const once = process.argv.includes('--once') || process.env.PATENT_DRAFTING_WORKER_ONCE === 'true'
  const batch = Math.max(1, Number(process.env.PATENT_DRAFTING_WORKER_BATCH || 1))

  do {
    const processed = await processPendingPatentDraftingJobs(workerId, batch)
    if (once) break
    if (!processed.length) await sleep(5000)
  } while (true)
}

main().catch(error => {
  console.error('[PatentDraftingWorker] Fatal error:', error)
  process.exit(1)
})
