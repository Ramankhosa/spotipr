import { processPendingDiagramImageAnalysisJobs } from '../src/lib/diagram-image-analysis-job-service'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function main() {
  const workerId = process.env.DIAGRAM_IMAGE_ANALYSIS_WORKER_ID || `diagram-image-analysis-worker-${process.pid}`
  const once = process.argv.includes('--once') || process.env.DIAGRAM_IMAGE_ANALYSIS_WORKER_ONCE === 'true'
  const batch = Math.max(1, Number(process.env.DIAGRAM_IMAGE_ANALYSIS_WORKER_BATCH || 1))

  do {
    const processed = await processPendingDiagramImageAnalysisJobs(workerId, batch)
    if (once) break
    if (!processed.length) await sleep(5000)
  } while (true)
}

main().catch(error => {
  console.error('[DiagramImageAnalysisWorker] Fatal error:', error)
  process.exit(1)
})
