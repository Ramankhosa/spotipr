/**
 * Whitespace Studio — standalone run worker.
 *
 * Runs the same lease queue the web process drains inline, in a process that is
 * not replaced on every deploy. Deploy it alongside the app the way
 * `patentnest-novelty-worker` is deployed, and long stages — a dimension census
 * is minutes of database work — stop dying when the web tier restarts.
 *
 *   npm run ws:worker            # loop until stopped
 *   npm run ws:worker -- --once  # drain what is queued, then exit
 *
 * Safe to run several of these, and safe to run none: the claim is a
 * `FOR UPDATE SKIP LOCKED` lease, so workers take different runs and never the
 * same one, and with no worker at all the web process still drains inline
 * exactly as it did before the queue existed.
 */

import { drainWhitespaceRuns } from '../src/lib/whitespace/service'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function main() {
  const workerId = process.env.WHITESPACE_WORKER_ID || `whitespace-worker-${process.pid}`
  const once = process.argv.includes('--once') || process.env.WHITESPACE_WORKER_ONCE === 'true'
  const batch = Math.max(1, Number(process.env.WHITESPACE_WORKER_BATCH || 1))
  const idleMs = Math.max(1000, Number(process.env.WHITESPACE_WORKER_IDLE_MS || 5000))

  console.log(`[WhitespaceWorker] ${workerId} starting (batch ${batch}${once ? ', single pass' : ''})`)

  let stopping = false
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      // Finish the run in hand rather than abandoning it mid-census; its lease
      // would otherwise have to expire before anyone could pick it up again.
      console.log(`[WhitespaceWorker] ${signal} received — stopping after the current run.`)
      stopping = true
    })
  }

  do {
    let handled: string[] = []
    try {
      handled = await drainWhitespaceRuns(workerId, batch)
      if (handled.length) console.log(`[WhitespaceWorker] handled ${handled.length} run(s): ${handled.join(', ')}`)
    } catch (error) {
      // A failed drain is a claim-level problem (the database is down, say).
      // Individual run failures are recorded on their rows and never reach here.
      console.error('[WhitespaceWorker] Drain failed:', error instanceof Error ? error.message : error)
      await sleep(idleMs)
    }
    if (once || stopping) break
    if (!handled.length) await sleep(idleMs)
  } while (true)

  console.log('[WhitespaceWorker] stopped.')
  process.exit(0)
}

main().catch(error => {
  console.error('[WhitespaceWorker] Fatal error:', error)
  process.exit(1)
})
