import { processPendingEmailDraftRequests } from '../src/lib/email-drafting-service'

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function main() {
  const workerId = process.env.EMAIL_DRAFTING_WORKER_ID || `email-worker-${process.pid}`
  const once = process.env.EMAIL_DRAFTING_WORKER_ONCE === 'true'
  const concurrency = Number(process.env.EMAIL_DRAFTING_WORKER_BATCH || '1')

  do {
    const processed = await processPendingEmailDraftRequests(workerId, Math.max(1, concurrency))
    if (once) {
      console.log(`[EmailDraftingWorker] Processed ${processed.length} request(s) in one-shot mode.`)
      break
    }
    if (!processed.length) {
      await sleep(5000)
    }
  } while (true)
}

main().catch(error => {
  console.error('[EmailDraftingWorker] Fatal error:', error)
  process.exit(1)
})
