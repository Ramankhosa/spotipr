/**
 * Validates the whitespace semantic arm against the LIVE corpus.
 *
 *   npx tsx scripts/whitespace-semantic-calibrate.ts
 *   npx tsx scripts/whitespace-semantic-calibrate.ts --probe "solar tracker mount"
 *
 * WHAT THIS USED TO DO, AND WHY IT COULD NOT WORK
 *
 * It used to hunt for a single WHITESPACE_SEMANTIC_MAX_DISTANCE that admitted a
 * sensible number of documents for every probe. Run against production it
 * reported failure and advised raising the sample depth. Both the failure and
 * the advice were real bugs:
 *
 *   - It counted by fetching the nearest 8,000 neighbours and filtering them in
 *     JS, so any ceiling admitting more than 8,000 documents reported exactly
 *     8,000. It called that CENSORED and asked for a bigger sample — but 8,000
 *     already exceeded the 5,000-document acceptance ceiling, so those rows were
 *     definitively too loose, not unknown. No sample size could have changed it.
 *   - The search itself was hopeless anyway. At the ceiling where "moisture
 *     sensor, irrigation valve" first reached 100 documents, "lithium battery
 *     electrolyte additive" was already past 8,000. The probes need ceilings
 *     ~0.04 apart, so no single constant satisfies them — proven from the
 *     UNCENSORED rows, independent of sample depth.
 *
 * So the studio no longer uses a global constant. Each query's ceiling is set
 * from its OWN background distance distribution (see candidates.ts), and this
 * script's job is now to check that rule holds on this corpus: measure exactly,
 * report what the rule selects per probe, and confirm the numbers land in the
 * same range across unrelated subjects.
 *
 * Read-only. One full scan of the embedding table per probe.
 */
import {
  PATENT_CORPUS_EMBEDDING_DIMENSIONS,
  PATENT_CORPUS_EMBEDDING_DTYPE,
  PATENT_CORPUS_EMBEDDING_MODEL,
} from '../src/lib/patent-corpus-service'
import { resolveSelectivity } from '../src/lib/whitespace/candidates'
import {
  backgroundCeiling,
  calibrationDistanceProfile,
  corpusVectorRowEstimate,
  embedQueryText,
  semanticBackground,
  semanticLaneConfigured,
} from '../src/lib/whitespace/embedding'

/**
 * Deliberately unrelated subjects. A rule that behaves consistently across
 * technologies is a property of the model; one tuned on a single subject is a
 * property of that subject, and would mis-size every other field.
 */
const DEFAULT_PROBES = [
  'moisture sensor, humidity probe; irrigation valve, water valve',
  'heart rate sensor, photoplethysmography; wearable strap',
  'lithium battery electrolyte additive',
  'gene editing, CRISPR guide RNA delivery',
  'turbine blade cooling channel, gas turbine',
]

/** Reference ceilings, printed so the shape of the distribution is visible. */
const GRID = [0.15, 0.2, 0.25, 0.275, 0.3, 0.325, 0.35, 0.375, 0.4, 0.45, 0.5]
const SCAN_TIMEOUT_MS = Math.max(60_000, Number(process.env.WHITESPACE_CALIBRATION_TIMEOUT_MS) || 600_000)

function probesFromArgv(): string[] {
  const flag = process.argv.indexOf('--probe')
  if (flag !== -1 && process.argv[flag + 1]) return [process.argv[flag + 1]]
  return DEFAULT_PROBES
}

const pct = (part: number, whole: number) => (whole > 0 ? `${((100 * part) / whole).toFixed(4)}%` : 'n/a')

interface ProbeResult {
  probe: string
  scanned: number
  /** From the SAMPLED background — what production actually uses. */
  sampledMean: number
  sampledSd: number
  /** From the full scan — the truth the sample is estimating. */
  exactMean: number
  exactSd: number
  ceiling: number
  admitted: number
  gridCounts: number[]
}

async function main() {
  console.log(
    `Model: ${PATENT_CORPUS_EMBEDDING_MODEL} (${PATENT_CORPUS_EMBEDDING_DTYPE}, ${PATENT_CORPUS_EMBEDDING_DIMENSIONS} dims, ` +
      `${PATENT_CORPUS_EMBEDDING_DTYPE === 'binary' ? 'Hamming' : 'cosine'} distance)`
  )
  console.log('Distances are NORMALISED to [0,1] — the same scale the studio applies its ceiling on.\n')

  if (!semanticLaneConfigured()) {
    console.log('Semantic lane is not configured (no embedding key). Nothing to measure.')
    return
  }

  const { selectivity, z } = await resolveSelectivity()
  const estimate = await corpusVectorRowEstimate()
  console.log(`Corpus (reltuples estimate): ${estimate.toLocaleString()} embedding rows`)
  console.log(
    `Adaptive rule in force: ceiling = mean - ${z.toFixed(3)} x sd of each query's own background ` +
      `(target selectivity ${selectivity.toExponential(2)}, i.e. ~${Math.round(selectivity * estimate).toLocaleString()} documents).\n`
  )

  const results: ProbeResult[] = []
  for (const probe of probesFromArgv()) {
    const started = Date.now()
    const literal = await embedQueryText(probe)
    if (!literal) {
      console.log(`"${probe}"\n  UNAVAILABLE — the encoder returned no vector.\n`)
      continue
    }

    // The sampled background is what production resolves the ceiling from, so
    // measure it the same way rather than substituting the exact figure — the
    // point is to check the ESTIMATE is good enough, not to bypass it.
    const [sampled] = await semanticBackground({ literals: [literal] })
    if (!sampled) {
      console.log(`"${probe}"\n  UNAVAILABLE — the background sample was too thin to estimate a spread.\n`)
      continue
    }
    const ceiling = backgroundCeiling(sampled, z)

    // Exact, in one scan: the grid plus the ceiling the rule just chose.
    const profile = await calibrationDistanceProfile({
      literal,
      ceilings: [...GRID, ceiling],
      timeoutMs: SCAN_TIMEOUT_MS,
    })
    const admitted = profile.counts[GRID.length]

    console.log(`"${probe}"  scanned ${profile.scanned.toLocaleString()} in ${Date.now() - started}ms`)
    console.log(
      `  background: sampled mean=${sampled.mean.toFixed(4)} sd=${sampled.sd.toFixed(4)} (n=${sampled.sampled.toLocaleString()})` +
        `   exact mean=${profile.mean.toFixed(4)} sd=${profile.sd.toFixed(4)}`
    )
    console.log(`  ceiling ${ceiling.toFixed(4)} admits ${admitted.toLocaleString()} documents (${pct(admitted, profile.scanned)} of corpus)`)
    console.log('  ' + GRID.map((t, i) => `<=${t}: ${profile.counts[i].toLocaleString()}`).join('  '))
    console.log()

    results.push({
      probe,
      scanned: profile.scanned,
      sampledMean: sampled.mean,
      sampledSd: sampled.sd,
      exactMean: profile.mean,
      exactSd: profile.sd,
      ceiling,
      admitted,
      gridCounts: profile.counts.slice(0, GRID.length),
    })
  }

  if (!results.length) {
    console.log('No probe could be measured — check embedding coverage and the configured model.')
    return
  }

  // --- does the adaptive rule hold across unrelated subjects? -----------------
  console.log('--- Adaptive rule ---')
  const admitted = results.map(r => r.admitted)
  const low = Math.min(...admitted)
  const high = Math.max(...admitted)
  const spread = low > 0 ? high / low : Infinity
  for (const r of results) {
    console.log(
      `  ${r.admitted.toString().padStart(9)} docs  ceiling ${r.ceiling.toFixed(4)}  ` +
        `(sample err: mean ${(r.sampledMean - r.exactMean >= 0 ? '+' : '') + (r.sampledMean - r.exactMean).toFixed(4)}, ` +
        `sd ${(r.sampledSd - r.exactSd >= 0 ? '+' : '') + (r.sampledSd - r.exactSd).toFixed(4)})  ${r.probe.slice(0, 44)}`
    )
  }
  console.log(`\n  Field sizes span ${low.toLocaleString()}-${high.toLocaleString()} documents (${spread.toFixed(1)}x).`)
  if (spread <= 20) {
    console.log('  HOLDS — one selectivity sizes every probe comparably. This is what a portable rule looks like.')
  } else {
    console.log(
      '  WIDE — subjects differ by more than 20x. That may be genuine (patenting really is denser in some fields),\n' +
        '  but if one probe is orders of magnitude off, check its embedding coverage before trusting the rule there.'
    )
  }
  if (low === 0) {
    console.log('  A probe admitted NOTHING. Either the corpus has no such documents, or its vectors are missing.')
  }
  console.log(
    `\n  Tune with WHITESPACE_SEMANTIC_TARGET_FIELD (documents per field) or pin the share directly with\n` +
      `  WHITESPACE_SEMANTIC_SELECTIVITY. Neither needs re-measuring when the corpus grows — the rule rescales.`
  )

  // --- the absolute-mode question, answered honestly -------------------------
  // Kept because an operator may still pin WHITESPACE_SEMANTIC_MAX_DISTANCE. The
  // counts here are exact, so nothing is censored and nothing is "unknown": a
  // ceiling either satisfies every probe or it is definitively rejected.
  const LOWER = Math.max(1, Number(process.env.WHITESPACE_CALIBRATION_MIN_FIELD) || 100)
  const UPPER = Math.max(LOWER * 2, Number(process.env.WHITESPACE_CALIBRATION_MAX_FIELD) || 5_000)
  console.log(`\n--- Absolute mode (only if you intend to pin one constant) ---`)
  console.log(`Largest ceiling putting EVERY probe in ${LOWER.toLocaleString()}-${UPPER.toLocaleString()} documents:`)

  let best: number | null = null
  let tooTight = ''
  let tooLoose = ''
  for (let i = 0; i < GRID.length; i++) {
    const t = GRID[i]
    const counts = results.map(r => r.gridCounts[i])
    const min = Math.min(...counts)
    const max = Math.max(...counts)
    const ok = min >= LOWER && max <= UPPER
    if (ok) best = t
    if (!ok && min < LOWER) tooTight = results[counts.indexOf(min)].probe
    if (!ok && max > UPPER) tooLoose = results[counts.indexOf(max)].probe
    console.log(`  ${String(t).padEnd(6)} ${min.toLocaleString()}-${max.toLocaleString()} across probes  ${ok ? 'OK' : 'no'}`)
  }

  console.log()
  if (best !== null) {
    console.log(`  WHITESPACE_SEMANTIC_MAX_DISTANCE=${best} would satisfy every probe measured here.`)
    console.log('  The adaptive default still rescales with the corpus and this will not — prefer leaving it unset.')
  } else {
    console.log('  No single ceiling satisfies every probe, and no amount of extra measurement will change that:')
    if (tooTight) console.log(`    too tight for  "${tooTight.slice(0, 60)}"`)
    if (tooLoose) console.log(`    too loose for  "${tooLoose.slice(0, 60)}"`)
    console.log('  They need different ceilings. That is precisely why the default is adaptive — leave')
    console.log('  WHITESPACE_SEMANTIC_MAX_DISTANCE unset and the studio sets each query its own.')
  }
}

main().then(
  () => process.exit(0),
  error => {
    console.error(error)
    process.exit(1)
  }
)
