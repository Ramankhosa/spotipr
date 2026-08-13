// ============================================================================
// Novelty prescreen calibration harness — READ-ONLY exam of the embedding
// prescreen against completed novelty runs.
//
//   npx tsx scripts/novelty-prescreen-harness.ts            # all usable runs
//   npx tsx scripts/novelty-prescreen-harness.ts --limit 10 # newest 10 only
//
// For every completed run that has BOTH a retrieval pool and LLM feature maps,
// this replays the would-be Stage 1.7 prescreen (feature embeddings vs stored
// corpus vectors, via the Prior-Art Studio scorer) and grades it against what
// the expensive LLM analysis actually concluded. It answers three questions:
//
//   1. AGREEMENT  — when the LLM found a feature Present in a patent, would the
//                   prescreen (STRONG or PART) have flagged that patent too?
//   2. SEPARATION — raw similarity distributions for LLM-Present vs LLM-Absent
//                   vs never-mapped pool docs. The verdict floors (binary
//                   0.62/0.56, cosine 0.42/0.34) must sit ABOVE the
//                   Absent/unmapped mass or the prescreen passes noise.
//   3. ATTRITION  — k-cover width predicted from prescreen evidence vs the
//                   width the LLM evidence actually supports, per run. This is
//                   the over-provision multiplier for deep-analysis sizing.
//
// Reads the DB, makes ONE query-embedding call per run (~5-8 short texts via
// the configured provider: Voyage on prod, OpenAI on dev). Writes nothing.
// ============================================================================
import 'dotenv/config'
import { prisma } from '@/lib/prisma'
// The shared scorer is the calibration source of truth — the same module the
// Stage 1.7 pipeline path calls.
import { scoreElements } from '@/lib/element-scoring/scorer'
import { kCoverSelect, type CoverageImportantFeature } from '@/lib/novelty-kcover'

const LIMIT_ARG = process.argv.indexOf('--limit')
const RUN_LIMIT = LIMIT_ARG >= 0 ? Math.max(1, Number(process.argv[LIMIT_ARG + 1]) || 0) : 0
// --since YYYY-MM-DD: only grade runs created on/after this date. Use it to
// restrict calibration to the current retrieval era (Voyage + merged corpus) —
// older runs' pools were retrieved under a different embedding model and
// corpus, so their noise distribution is not what future runs will see.
const SINCE_ARG = process.argv.indexOf('--since')
const SINCE = SINCE_ARG >= 0 ? new Date(`${process.argv[SINCE_ARG + 1]}T00:00:00Z`) : null
const POOL_CAP = 300

type LlmStatus = 'Present' | 'Partial' | 'Absent'
type PrescreenVerdict = 'STRONG' | 'PART' | 'WEAK' | 'NONE' | 'UNAVAILABLE'

// Same normalization the report modules use: uppercase, strip separators, then
// strip the kind-code suffix so "US1234567A1" and "US1234567" collide.
const canonical = (value: unknown) => {
  const compact = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (compact.startsWith('PAPER')) return compact
  return compact.match(/^(.+\d)[A-Z]\d?$/)?.[1] || compact
}

const isPatentPn = (pn: string) => /^[A-Z]{2}[A-Z0-9]{4,}$/.test(pn) && !pn.startsWith('PAPER')

const featureKey = (value: unknown) => String(value || '').trim().toLowerCase()

const pct = (num: number, den: number) => (den > 0 ? `${(100 * num / den).toFixed(1)}%` : 'n/a')

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
}

function distLine(label: string, values: number[]): string {
  const mean = values.length ? values.reduce((s, v) => s + v, 0) / values.length : null
  const fmt = (v: number | null) => (v === null ? '   n/a' : v.toFixed(3))
  return `  ${label.padEnd(28)} n=${String(values.length).padStart(6)}  mean=${fmt(mean)}  p10=${fmt(percentile(values, 0.1))}  p50=${fmt(percentile(values, 0.5))}  p90=${fmt(percentile(values, 0.9))}`
}

async function main() {
  const runs = await (prisma as any).noveltySearchRun.findMany({
    where: {
      stage35Results: { not: null },
      ...(SINCE && !isNaN(SINCE.getTime()) ? { createdAt: { gte: SINCE } } : {}),
    },
    select: { id: true, createdAt: true, stage0Results: true, stage1Results: true, stage35Results: true },
    orderBy: { createdAt: 'desc' },
  })
  if (SINCE) console.log(`Filtering to runs created on/after ${SINCE.toISOString().slice(0, 10)}`)

  // Aggregates across runs
  const confusion: Record<LlmStatus, Record<PrescreenVerdict, number>> = {
    Present: { STRONG: 0, PART: 0, WEAK: 0, NONE: 0, UNAVAILABLE: 0 },
    Partial: { STRONG: 0, PART: 0, WEAK: 0, NONE: 0, UNAVAILABLE: 0 },
    Absent: { STRONG: 0, PART: 0, WEAK: 0, NONE: 0, UNAVAILABLE: 0 },
  }
  const sims = { present: [] as number[], absent: [] as number[], unmapped: [] as number[] }
  const perRun: Array<{
    id: string; date: string; features: number; pool: number; scoreable: number;
    presentRecall: string; predictedK: number; actualK: number; ratio: string;
  }> = []
  let processed = 0
  let semanticFailures = 0

  for (const run of runs) {
    if (RUN_LIMIT && processed >= RUN_LIMIT) break
    const stage0 = run.stage0Results as any
    const stage1 = run.stage1Results as any
    const featureMap = (run.stage35Results as any)?.feature_map
    const features: string[] = Array.isArray(stage0?.inventionFeatures) ? stage0.inventionFeatures : []
    const pool = (Array.isArray(stage1?.retrievalCandidates) && stage1.retrievalCandidates.length
      ? stage1.retrievalCandidates
      : stage1?.rawPriorArtResults) as any[]
    if (!Array.isArray(featureMap) || !featureMap.length || !features.length || !Array.isArray(pool) || !pool.length) continue

    // Feature types (for k-cover), mirroring the pipeline's important set.
    const typeByFeature = new Map<string, CoverageImportantFeature['type']>()
    for (const detail of Array.isArray(stage0?.featureDetails) ? stage0.featureDetails : []) {
      const type = detail?.feature_type
      if (type === 'novelty_candidate' || type === 'core_technical' || type === 'implementation' || type === 'generic_weak') {
        typeByFeature.set(featureKey(detail.feature), type)
      }
    }
    const importantFeatures: CoverageImportantFeature[] = features
      .filter(f => {
        const type = typeByFeature.get(featureKey(f)) || 'core_technical'
        return type === 'novelty_candidate' || type === 'core_technical'
      })
      .map(f => ({ feature: featureKey(f), type: typeByFeature.get(featureKey(f)) === 'novelty_candidate' ? 'novelty_candidate' : 'core_technical' }))

    // Patent-only pool, deduped by canonical number, capped like stage17 would.
    const poolPns: string[] = []
    const canonicalToPoolPn = new Map<string, string>()
    for (const candidate of pool) {
      const raw = String(candidate?.publicationNumber || candidate?.publication_number || candidate?.pn || '').trim()
      const key = canonical(raw)
      if (!raw || !key || !isPatentPn(key) || canonicalToPoolPn.has(key)) continue
      canonicalToPoolPn.set(key, raw)
      poolPns.push(raw)
      if (poolPns.length >= POOL_CAP) break
    }
    if (!poolPns.length) continue

    // The prescreen replay: one embedding call + one SQL scan.
    const elements = features.map((text, index) => ({ id: `F${index}`, text, origin: 'manual' } as any))
    let cells: Record<string, Record<string, any>> = {}
    let semanticAvailable = false
    try {
      const scored = await scoreElements({ elements, publicationNumbers: poolPns, traceId: `harness:${run.id}` })
      cells = scored.cells
      semanticAvailable = scored.semanticAvailable
    } catch (error: any) {
      console.error(`  scoring failed for ${run.id}: ${error?.message}`)
    }
    if (!semanticAvailable) {
      semanticFailures += 1
      continue
    }
    processed += 1

    const featureIdByKey = new Map(features.map((f, index) => [featureKey(f), `F${index}`]))
    const verdictFor = (poolPn: string | undefined, feature: string): { verdict: PrescreenVerdict; similarity?: number } => {
      const elementId = featureIdByKey.get(featureKey(feature))
      const cell = poolPn && elementId ? cells[poolPn]?.[elementId] : undefined
      if (!cell) return { verdict: 'UNAVAILABLE' }
      return { verdict: cell.verdict as PrescreenVerdict, similarity: cell.similarity }
    }

    // Grade against the LLM's answer key.
    const mappedCanonicals = new Set<string>()
    let runPresent = 0
    let runPresentHit = 0
    const actualCovered = new Map<string, Set<string>>()
    for (const map of featureMap) {
      const key = canonical(map?.pn)
      if (!key) continue
      mappedCanonicals.add(key)
      const poolPn = canonicalToPoolPn.get(key)
      for (const cell of Array.isArray(map?.feature_analysis) ? map.feature_analysis : []) {
        const status = String(cell?.status || '') as LlmStatus
        if (status !== 'Present' && status !== 'Partial' && status !== 'Absent') continue
        const graded = verdictFor(poolPn, cell.feature)
        confusion[status][graded.verdict] += 1
        if (typeof graded.similarity === 'number') {
          if (status === 'Present') sims.present.push(graded.similarity)
          if (status === 'Absent') sims.absent.push(graded.similarity)
        }
        if (status === 'Present' || status === 'Partial') {
          if (!actualCovered.has(key)) actualCovered.set(key, new Set())
          actualCovered.get(key)!.add(featureKey(cell.feature))
        }
        if (status === 'Present') {
          runPresent += 1
          if (graded.verdict === 'STRONG' || graded.verdict === 'PART') runPresentHit += 1
        }
      }
    }

    // Similarity mass of pool docs the LLM never mapped (mostly irrelevant art).
    for (const [key, poolPn] of Array.from(canonicalToPoolPn.entries())) {
      if (mappedCanonicals.has(key)) continue
      for (const feature of features) {
        const graded = verdictFor(poolPn, feature)
        if (typeof graded.similarity === 'number') sims.unmapped.push(graded.similarity)
      }
    }

    // k-cover width: prescreen-predicted vs LLM-actual.
    const predictedCandidates = Array.from(canonicalToPoolPn.entries()).map(([key, poolPn], index) => ({
      key,
      coveredFeatures: features.filter(f => {
        const graded = verdictFor(poolPn, f)
        return graded.verdict === 'STRONG' || graded.verdict === 'PART'
      }).map(featureKey),
      sourceOrder: index,
    }))
    const actualCandidates = Array.from(actualCovered.entries()).map(([key, covered], index) => ({
      key,
      coveredFeatures: Array.from(covered),
      sourceOrder: index,
    }))
    const predictedK = kCoverSelect(predictedCandidates, importantFeatures).selectedKeys.length
    const actualK = kCoverSelect(actualCandidates, importantFeatures).selectedKeys.length

    perRun.push({
      id: run.id.slice(0, 12),
      date: run.createdAt.toISOString().slice(0, 10),
      features: features.length,
      pool: poolPns.length,
      scoreable: Object.keys(cells).length,
      presentRecall: pct(runPresentHit, runPresent),
      predictedK,
      actualK,
      ratio: predictedK > 0 ? (actualK / predictedK).toFixed(2) : 'n/a',
    })

    await new Promise(resolve => setTimeout(resolve, 300)) // be polite to the embedding API
  }

  // ---------------- report ----------------
  console.log(`\n==== Runs processed: ${processed} (semantic unavailable: ${semanticFailures}) ====\n`)

  console.log('Per-run: predictedK = refs the prescreen thinks cover the invention; actualK = refs the LLM evidence supports')
  console.log('run          date        feats  pool  scoreable  PresentRecall  predK  actK  act/pred')
  for (const row of perRun) {
    console.log(
      `${row.id} ${row.date}  ${String(row.features).padStart(5)} ${String(row.pool).padStart(5)}` +
      ` ${String(row.scoreable).padStart(9)}  ${row.presentRecall.padStart(12)}  ${String(row.predictedK).padStart(5)}` +
      ` ${String(row.actualK).padStart(5)}  ${row.ratio.padStart(7)}`
    )
  }

  console.log('\n==== 1. AGREEMENT (LLM verdict rows x prescreen verdict columns) ====')
  console.log('LLM \\ prescreen   STRONG    PART    WEAK    NONE  UNAVAILABLE')
  for (const status of ['Present', 'Partial', 'Absent'] as LlmStatus[]) {
    const row = confusion[status]
    console.log(
      `${status.padEnd(16)} ${String(row.STRONG).padStart(7)} ${String(row.PART).padStart(7)}` +
      ` ${String(row.WEAK).padStart(7)} ${String(row.NONE).padStart(7)} ${String(row.UNAVAILABLE).padStart(12)}`
    )
  }
  const p = confusion.Present
  const scoreablePresent = p.STRONG + p.PART + p.WEAK + p.NONE
  console.log(`\n  Present recall by STRONG|PART : ${pct(p.STRONG + p.PART, scoreablePresent)}   (gate: >=60% full design, 40-60% degrade)`)
  console.log(`  Present hidden by NONE        : ${pct(p.NONE, scoreablePresent)}   (gate: <=20% full design, 20-35% degrade)`)
  const strongTotal = confusion.Present.STRONG + confusion.Partial.STRONG + confusion.Absent.STRONG
  console.log(`  STRONG precision (P|Part)     : ${pct(confusion.Present.STRONG + confusion.Partial.STRONG, strongTotal)}`)

  console.log('\n==== 2. SEPARATION (raw similarity; floors must clear the Absent/unmapped mass) ====')
  console.log(distLine('LLM Present cells', sims.present))
  console.log(distLine('LLM Absent cells', sims.absent))
  console.log(distLine('never-mapped pool docs', sims.unmapped))

  console.log('\n==== 3. ATTRITION (deep-analysis over-provision multiplier) ====')
  const ratios = perRun.map(row => Number(row.ratio)).filter(Number.isFinite)
  console.log(distLine('actualK / predictedK', ratios))
  console.log('\nDone. Send the full output back.')
  await prisma.$disconnect()
}

main().catch(error => { console.error(error); process.exit(1) })
