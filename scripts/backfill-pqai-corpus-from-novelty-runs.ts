import './load-env'
import { prisma } from '../src/lib/prisma'
import { persistPqaiPatentResults } from '../src/lib/patent-corpus-service'
import type { NormalizedPatentResult } from '../src/lib/patent-search/types'

function argValue(name: string) {
  const prefix = `${name}=`
  const found = process.argv.find(arg => arg.startsWith(prefix))
  return found ? found.slice(prefix.length) : null
}

function uniqueByPublication(results: any[]) {
  const seen = new Set<string>()
  const unique: any[] = []
  for (const result of results) {
    const pn = String(result?.publicationNumber || result?.publication_number || result?.pn || result?.id || '').trim()
    if (!pn) continue
    const key = pn.toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(result)
  }
  return unique
}

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : []
}

function hasPqaiProvider(result: any, forcePqai: boolean) {
  if (forcePqai) return true
  const providers = [
    result?.providerId,
    result?.sourceProvider,
    result?.provider,
    ...asArray(result?.sourceProviders),
  ].map(value => String(value || '').toLowerCase())
  return providers.includes('pqai')
}

function normalizeStoredResult(result: any): NormalizedPatentResult {
  const publicationNumber = String(result.publicationNumber || result.publication_number || result.pn || result.id || '').trim()
  return {
    ...result,
    providerId: 'pqai',
    sourceProvider: 'pqai',
    sourceProviders: Array.from(new Set([...(asArray(result.sourceProviders) as string[]), 'pqai'])),
    publicationNumber,
    publication_number: result.publication_number || publicationNumber,
    pn: result.pn || publicationNumber,
    title: result.title || publicationNumber || 'Untitled Patent',
    abstract: result.abstract || result.snippet || result.description || null,
    snippet: result.snippet || result.abstract || result.description || null,
    raw: result.raw || result,
  }
}

function collectStage1Candidates(stage1: any) {
  return uniqueByPublication([
    ...asArray(stage1?.retrievalCandidates),
    ...asArray(stage1?.candidateResults),
    ...asArray(stage1?.rawPriorArtResults),
    ...asArray(stage1?.priorArtResults),
    ...asArray(stage1?.pqaiResults),
    ...asArray(stage1?.visiblePriorArtResults),
    ...asArray(stage1?.gatedCandidates),
    ...asArray(stage1?.fallbackCandidates),
  ])
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const batchSize = Math.max(1, Number(argValue('--batch') || '100') || 100)
  const limit = Math.max(0, Number(argValue('--limit') || '0') || 0)
  let cursor = ''
  let scannedRuns = 0
  let candidateCount = 0
  let persisted = { created: 0, updated: 0, queuedEmbeddings: 0, skipped: 0 }

  while (true) {
    const take = limit ? Math.min(batchSize, Math.max(0, limit - scannedRuns)) : batchSize
    if (take <= 0) break
    const runs = await (prisma as any).noveltySearchRun.findMany({
      where: cursor ? { id: { gt: cursor } } : {},
      orderBy: { id: 'asc' },
      take,
      select: { id: true, stage1Results: true },
    })
    if (!runs.length) break

    for (const run of runs) {
      cursor = run.id
      scannedRuns += 1
      if (!run.stage1Results) continue
      const stage1 = (run.stage1Results as any)?.stage1 || run.stage1Results || {}
      const forcePqai = ['PQAI_ONLY', 'PQAI_PLUS_INDIAN'].includes(String(stage1?.searchSource?.mode || ''))
      const pqaiCandidates = collectStage1Candidates(stage1)
        .filter(candidate => hasPqaiProvider(candidate, forcePqai))
        .map(normalizeStoredResult)
      candidateCount += pqaiCandidates.length
      if (!dryRun && pqaiCandidates.length > 0) {
        const stats = await persistPqaiPatentResults(pqaiCandidates, { query: stage1?.queryPlan?.searchQuery || stage1?.queryPlan?.originalQuery || undefined })
        persisted = {
          created: persisted.created + stats.created,
          updated: persisted.updated + stats.updated,
          queuedEmbeddings: persisted.queuedEmbeddings + stats.queuedEmbeddings,
          skipped: persisted.skipped + stats.skipped,
        }
      }
    }

    if (limit && scannedRuns >= limit) break
  }

  console.log(JSON.stringify({
    dryRun,
    scannedRuns,
    candidateCount,
    ...persisted,
  }, null, 2))
}

main()
  .catch(error => {
    console.error('[BackfillPqaiCorpus] Failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
