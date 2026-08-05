/**
 * Measures the embedding-distance distribution of the LIVE corpus, so
 * WHITESPACE_SEMANTIC_MAX_DISTANCE can be set from evidence instead of guessed.
 *
 *   npx tsx scripts/whitespace-semantic-calibrate.ts
 *   npx tsx scripts/whitespace-semantic-calibrate.ts --probe "solar tracker mount"
 *
 * Why this exists: the ceiling is a cut through ONE model's distance
 * distribution and does not transfer between models. Dev runs OpenAI
 * text-embedding-3-small (float, cosine); production runs Voyage voyage-3.5-lite
 * (binary, Hamming). A number measured on one is not evidence about the other,
 * so an uncalibrated installation leaves the semantic arm off until this script
 * has been run against its own corpus.
 *
 * Read-only. Issues a handful of bounded ANN queries and prints counts.
 */
import {
  PATENT_CORPUS_EMBEDDING_DIMENSIONS,
  PATENT_CORPUS_EMBEDDING_DTYPE,
  PATENT_CORPUS_EMBEDDING_MODEL,
} from '../src/lib/patent-corpus-service'
import { semanticLaneConfigured, semanticNeighbors } from '../src/lib/whitespace/embedding'

/**
 * Deliberately unrelated subjects. A ceiling that behaves consistently across
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

/** Sample depth. Large enough to see where the ranking flattens out. */
const SAMPLE = Math.max(1_000, Number(process.env.WHITESPACE_CALIBRATION_SAMPLE) || 8_000)

const quantile = (sorted: number[], p: number) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : NaN

function probesFromArgv(): string[] {
  const flag = process.argv.indexOf('--probe')
  if (flag !== -1 && process.argv[flag + 1]) return [process.argv[flag + 1]]
  return DEFAULT_PROBES
}

async function main() {
  console.log(
    `Model: ${PATENT_CORPUS_EMBEDDING_MODEL} (${PATENT_CORPUS_EMBEDDING_DTYPE}, ${PATENT_CORPUS_EMBEDDING_DIMENSIONS} dims, ` +
      `${PATENT_CORPUS_EMBEDDING_DTYPE === 'binary' ? 'Hamming' : 'cosine'} distance)`
  )
  console.log(`Distances below are NORMALISED to [0,1] — the same scale the studio applies its ceiling on.\n`)

  if (!semanticLaneConfigured()) {
    console.log('Semantic lane is not configured (no embedding API key). Nothing to measure.')
    return
  }

  const grid = [0.15, 0.2, 0.25, 0.275, 0.3, 0.325, 0.35, 0.375, 0.4, 0.45, 0.5]
  const perProbeCounts: number[][] = []
  let anyMeasured = false

  for (const probe of probesFromArgv()) {
    const started = Date.now()
    const result = await semanticNeighbors({ queryText: probe, limit: SAMPLE, timeoutMs: 120_000 })
    if (!result.available) {
      console.log(`"${probe}"\n  UNAVAILABLE — ${result.reason}\n`)
      continue
    }
    anyMeasured = true
    const d = result.neighbors.map(n => n.distance).sort((a, b) => a - b)
    console.log(`"${probe}"  n=${d.length} in ${Date.now() - started}ms`)
    console.log(
      `  min=${d[0]?.toFixed(4)} p1=${quantile(d, 1).toFixed(4)} p5=${quantile(d, 5).toFixed(4)} ` +
        `p25=${quantile(d, 25).toFixed(4)} p50=${quantile(d, 50).toFixed(4)} max=${d[d.length - 1]?.toFixed(4)}`
    )
    const counts = grid.map(t => d.filter(x => x <= t).length)
    console.log('  ' + grid.map((t, i) => `<=${t}: ${counts[i]}`).join('  '))
    console.log()
    perProbeCounts.push(counts)
  }

  if (!anyMeasured) {
    console.log('No probe returned results — check embedding coverage and the configured model.')
    return
  }

  // --- the recommendation --------------------------------------------------
  // A usable ceiling admits a field, not a corpus and not a handful: it has to
  // hold across unrelated subjects, or it is measuring the subject rather than
  // the model. The widest probe is the binding constraint — a ceiling chosen on
  // the narrowest one would blow up on every broader field.
  console.log('--- Recommendation ---')
  console.log(`Probes measured: ${perProbeCounts.length}, sample depth ${SAMPLE.toLocaleString()}`)

  const LOWER = Math.max(1, Number(process.env.WHITESPACE_CALIBRATION_MIN_FIELD) || 100)
  // Deliberately far below the candidate cap. The cap is a COST limit; this is a
  // judgement about what a field is. A ceiling admitting tens of thousands of
  // documents across every unrelated probe is not selecting a subject, and
  // saying so here is the whole point of calibrating rather than guessing.
  const UPPER = Math.max(LOWER * 2, Number(process.env.WHITESPACE_CALIBRATION_MAX_FIELD) || 5_000)
  console.log(`Looking for the largest ceiling where EVERY probe lands in ${LOWER.toLocaleString()}-${UPPER.toLocaleString()} documents.`)
  console.log(`Ceilings where any probe hit the sample depth are CENSORED — the true count is unknown, not passing.\n`)

  let recommended: number | null = null
  let censoredSeen = false
  grid.forEach((t, i) => {
    const counts = perProbeCounts.map(c => c[i])
    const min = Math.min(...counts)
    const max = Math.max(...counts)
    // A count equal to the sample depth means the probe ran out of rows before
    // it ran out of matches. Treating that as "only N matched" is exactly how a
    // far-too-loose ceiling looks acceptable.
    const censored = counts.some(c => c >= SAMPLE)
    if (censored) censoredSeen = true
    const ok = !censored && min >= LOWER && max <= UPPER
    console.log(
      `  ${t}: ${min.toLocaleString()}-${max.toLocaleString()} across probes  ${
        censored ? 'CENSORED (raise WHITESPACE_CALIBRATION_SAMPLE to measure)' : ok ? 'OK' : '--'
      }`
    )
    if (ok) recommended = t
  })

  console.log()
  if (recommended === null) {
    console.log(
      'No ceiling on the grid satisfies every probe. If the passing rows were CENSORED, raise ' +
        'WHITESPACE_CALIBRATION_SAMPLE and re-run — the measurement was truncated, not negative. ' +
        'Otherwise check embedding coverage: too few vectors looks identical to "nothing is similar".'
    )
    console.log('Leaving WHITESPACE_SEMANTIC_MAX_DISTANCE unset keeps the semantic arm OFF, which is the safe state.')
    return
  }
  if (censoredSeen) {
    console.log(
      'Note: looser ceilings were censored by the sample depth, so the value below is the largest MEASURED one. ' +
        'Raise WHITESPACE_CALIBRATION_SAMPLE if you want to explore past it.'
    )
  }

  console.log(`Set:  WHITESPACE_SEMANTIC_MAX_DISTANCE=${recommended}`)
  console.log(
    'Then re-run scripts/diagnose-whitespace-fieldmap.ts on a real scope and compare the lexical-only and hybrid ' +
      'counts before trusting it. This is a starting point measured from the corpus, not a substitute for looking ' +
      'at what it admits.'
  )
}

main().then(
  () => process.exit(0),
  error => {
    console.error(error)
    process.exit(1)
  }
)
