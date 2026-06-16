import './load-env'
import fs from 'fs/promises'
import { IndianCorpusProvider } from '../src/lib/patent-search/providers/indian-corpus-provider'
import type { PatentSearchQueryPlan } from '../src/lib/patent-search/types'

type GoldenCase = {
  id?: string
  query: string
  title?: string
  inventionText?: string
  features?: string[]
  expected: string[]
}

function argValue(name: string) {
  const prefix = `${name}=`
  const found = process.argv.find(arg => arg.startsWith(prefix))
  return found ? found.slice(prefix.length) : null
}

function compactPatentNumber(value: unknown) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function retrievalQueries(query: string, features: string[] = []) {
  const queries = []
  if (query.trim()) {
    queries.push({
      id: 'concept',
      type: 'concept' as const,
      text: query,
      weight: 1.25,
      label: 'Core concept',
    })
  }
  features.slice(0, 8).forEach((feature, index) => {
    if (!feature.trim()) return
    queries.push({
      id: `feature-${index + 1}`,
      type: 'feature' as const,
      text: feature,
      weight: 1.1,
      featureIndex: index,
      featureIndexes: [index],
      label: feature,
    })
  })
  return queries
}

function queryPlan(testCase: GoldenCase): PatentSearchQueryPlan {
  const query = testCase.query.trim()
  const features = (testCase.features || []).map(feature => String(feature || '').trim()).filter(Boolean)
  return {
    originalQuery: query,
    normalizedQuery: query,
    searchQuery: query,
    semanticQuery: query,
    inventionFeatures: features,
    technicalKeywords: [],
    synonyms: [],
    mustHaveTerms: [],
    excludedTerms: [],
    cpcCodes: [],
    ipcCodes: [],
    classificationHints: [],
    fieldFilters: {},
    explicitFilters: {},
    searchVariants: query ? [query] : [],
    retrievalQueries: retrievalQueries(query, features),
    llmExpanded: false,
    confidence: 1,
    warnings: [],
  }
}

function reciprocalRank(results: string[], expected: Set<string>) {
  const index = results.findIndex(result => expected.has(result))
  return index >= 0 ? 1 / (index + 1) : 0
}

function recallAt(results: string[], expected: Set<string>, k: number) {
  if (!expected.size) return 0
  const top = new Set(results.slice(0, k))
  let hits = 0
  expected.forEach(value => {
    if (top.has(value)) hits += 1
  })
  return hits / expected.size
}

function precisionAt(results: string[], expected: Set<string>, k: number) {
  if (k <= 0) return 0
  const top = results.slice(0, k)
  if (!top.length) return 0
  return top.filter(result => expected.has(result)).length / k
}

async function main() {
  const file = argValue('--file') || 'scripts/patent-retrieval-golden.json'
  const limit = Math.max(50, Number(argValue('--limit') || '60') || 60)
  const raw = await fs.readFile(file, 'utf8').catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Golden set not found: ${file}. Copy scripts/patent-retrieval-golden.example.json and add expected publication numbers.`)
    }
    throw error
  })
  const cases = JSON.parse(raw) as GoldenCase[]
  if (!Array.isArray(cases) || cases.length === 0) {
    throw new Error('Golden set must be a non-empty JSON array.')
  }

  const provider = new IndianCorpusProvider()
  const rows = []
  let recall10 = 0
  let recall25 = 0
  let recall50 = 0
  let precision10 = 0
  let mrr = 0

  for (const testCase of cases) {
    const expected = new Set((testCase.expected || []).map(compactPatentNumber).filter(Boolean))
    const results = await provider.search({
      searchMode: 'intelligent',
      query: testCase.query,
      title: testCase.title,
      inventionText: testCase.inventionText || testCase.query,
      limit,
      sourceMode: 'INDIAN_ONLY',
      queryPlan: queryPlan(testCase),
    })
    const resultNumbers = results.map(result => compactPatentNumber(result.publicationNumber || result.pn)).filter(Boolean)
    const r10 = recallAt(resultNumbers, expected, 10)
    const r25 = recallAt(resultNumbers, expected, 25)
    const r50 = recallAt(resultNumbers, expected, 50)
    const p10 = precisionAt(resultNumbers, expected, 10)
    const rr = reciprocalRank(resultNumbers, expected)
    recall10 += r10
    recall25 += r25
    recall50 += r50
    precision10 += p10
    mrr += rr
    rows.push({
      id: testCase.id || testCase.query.slice(0, 60),
      expected: expected.size,
      recallAt10: Number(r10.toFixed(3)),
      recallAt25: Number(r25.toFixed(3)),
      recallAt50: Number(r50.toFixed(3)),
      precisionAt10: Number(p10.toFixed(3)),
      reciprocalRank: Number(rr.toFixed(3)),
      topScore: Number((results[0]?.rawRetrievalScore || results[0]?.retrievalScore || results[0]?.relevanceScore || 0).toFixed(3)),
      top5: resultNumbers.slice(0, 5),
    })
  }

  const count = cases.length
  console.table(rows)
  console.log(JSON.stringify({
    cases: count,
    recallAt10: Number((recall10 / count).toFixed(3)),
    recallAt25: Number((recall25 / count).toFixed(3)),
    recallAt50: Number((recall50 / count).toFixed(3)),
    precisionAt10: Number((precision10 / count).toFixed(3)),
    mrr: Number((mrr / count).toFixed(3)),
  }, null, 2))
}

main().catch(error => {
  console.error('[PatentRetrievalEval] Failed:', error)
  process.exitCode = 1
})
