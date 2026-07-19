import { processPendingOfficeActionJobs } from '../src/lib/office-action-job-service'

/**
 * Office Action Studio background worker — drains the OfficeActionJob queue
 * (citation resolution today; more job types later). Mirrors the novelty/
 * drafting workers: loop, process a batch, sleep when idle. `--once` for CI.
 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function main() {
  const workerId = process.env.OA_WORKER_ID || `oa-worker-${process.pid}`
  const once = process.argv.includes('--once') || process.env.OA_WORKER_ONCE === 'true'
  const batch = Math.max(1, Number(process.env.OA_WORKER_BATCH || 2))

  do {
    const processed = await processPendingOfficeActionJobs(workerId, batch)
    if (processed.length) console.log(`[OfficeActionWorker] processed ${processed.length} job(s)`)
    if (once) break
    if (!processed.length) await sleep(5000)
  } while (true)
}

main().catch(error => {
  console.error('[OfficeActionWorker] Fatal error:', error)
  process.exit(1)
})
