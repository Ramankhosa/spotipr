/**
 * Invention Miner — Wilson score intervals for the engines' rates.
 *
 * WHY A RATE WITH AN INTERVAL, AND NOT A PRODUCT OF COUNTS.
 *
 * The headline number the unsolved engine prints is "how much of this field
 * admits the problem and does nothing about it". Written as `admitting ×
 * (1 − addressing/admitting)` — a count scaled by a rate — it silently ranks
 * BIG problems above UNSOLVED ones: a stock complaint admitted by 400 families
 * of which 380 answer it scores 20, and a genuine opening admitted by 7 of
 * which none answer it scores 7. The first is boilerplate, the second is the
 * product.
 *
 * So the signal is the RATE, and the rate carries its uncertainty. 0/1 and
 * 0/200 are both "100% unsolved" as a point estimate, and only the interval
 * distinguishes "we read one family" from "we read two hundred".
 *
 * WILSON, NOT NORMAL-APPROXIMATION. The normal interval
 * (p ± z·sqrt(p(1−p)/n)) is degenerate at exactly the values this engine lives
 * at: for p = 1 it has ZERO width, so 1/1 reports a 95% interval of [1, 1] —
 * a certainty from a single observation. Wilson's interval is derived by
 * inverting the score test rather than assuming normality of p̂, so it stays
 * inside [0,1], never collapses at the boundaries, and its lower bound falls
 * as n falls. That lower bound is what the engines rank on, which is exactly
 * the "sort by lower bound of the confidence interval" rule that keeps a
 * 1-of-1 result from outranking a 180-of-200 one.
 *
 * Pure. No I/O, no dependencies — every number here is arithmetic over two
 * integers, and the whole module is unit-tested against hand-checked values.
 */

/** Two-sided 95%. The only value the miner uses; named so it is never a literal. */
export const WILSON_Z_95 = 1.959963984540054

export interface WilsonInterval {
  successes: number
  trials: number
  /** The naive proportion. 0 when nothing was observed. */
  point: number
  /** Lower bound of the interval, clamped to [0, 1]. This is what ranks. */
  lower: number
  /** Upper bound of the interval, clamped to [0, 1]. */
  upper: number
  /** The z the interval was computed at, so a report can say "95%". */
  z: number
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/**
 * The Wilson score interval for `successes` of `trials`.
 *
 * ZERO TRIALS IS NOT ZERO PROBABILITY. With nothing observed the honest
 * interval is the whole unit line — point 0, lower 0, upper 1 — so a component
 * nobody admitted cannot rank above one that was measured. The engines also
 * refuse to publish a lead at trials = 0 for their own reasons; this is the
 * arithmetic backstop.
 */
export function wilsonInterval(successes: number, trials: number, z: number = WILSON_Z_95): WilsonInterval {
  const n = Math.max(0, Math.trunc(Number(trials) || 0))
  const k = Math.min(n, Math.max(0, Math.trunc(Number(successes) || 0)))
  const zScore = Number.isFinite(z) && z > 0 ? z : WILSON_Z_95

  if (n === 0) return { successes: 0, trials: 0, point: 0, lower: 0, upper: 1, z: zScore }

  const p = k / n
  const z2 = zScore * zScore
  const denominator = 1 + z2 / n
  const centre = (p + z2 / (2 * n)) / denominator
  const halfWidth = (zScore / denominator) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))

  return {
    successes: k,
    trials: n,
    point: p,
    lower: clamp01(centre - halfWidth),
    upper: clamp01(centre + halfWidth),
    z: zScore,
  }
}

/** The bound the engines rank on. See the module header for why it is the lower one. */
export function lowerWilsonBound(successes: number, trials: number, z: number = WILSON_Z_95): number {
  return wilsonInterval(successes, trials, z).lower
}

/**
 * One sentence naming the rate AND its denominator, for a lead's signals.
 *
 * Never "80% unsolved". A percentage with no denominator is the shape every
 * misread of this product takes, so the denominator is inside the sentence and
 * cannot be dropped by a caller that only prints the first clause.
 */
export function describeRate(label: string, interval: WilsonInterval): string {
  if (!interval.trials) return `${label}: not measured — no family in the sample admitted this problem.`
  const pct = (value: number) => `${Math.round(value * 1000) / 10}%`
  return (
    `${label}: ${interval.successes} of ${interval.trials} families (${pct(interval.point)}), ` +
    `95% interval ${pct(interval.lower)}–${pct(interval.upper)}.`
  )
}
