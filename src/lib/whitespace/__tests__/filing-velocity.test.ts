/**
 * Pins the area filing-trend metric.
 *
 * It used to divide one year's member count by another's, five years apart.
 * Cluster members are a sample of a sample, so those are small integers: two
 * filings in the base year and five in the final one printed "+20% a year" for
 * an area that had not measurably moved, and one member either side flipped the
 * sign. These cases are the ones that were wrong.
 */

import { describe, expect, it } from 'vitest'
import { filingCagrPct } from '../signals-stage'

const series = (counts: Record<number, number>) => new Map(Object.entries(counts).map(([y, n]) => [Number(y), n]))

describe('filingCagrPct', () => {
  const last = 2024

  it('reads flat filing as no growth', () => {
    const flat = series({ 2017: 10, 2018: 10, 2019: 10, 2020: 10, 2021: 10, 2022: 10, 2023: 10, 2024: 10 })
    expect(filingCagrPct(flat, last)).toBe(0)
  })

  it('reads a genuine doubling over five years as ~+15% a year', () => {
    const growing = series({ 2017: 10, 2018: 10, 2019: 10, 2020: 14, 2021: 16, 2022: 20, 2023: 20, 2024: 20 })
    expect(filingCagrPct(growing, last)).toBe(15) // 2^(1/5) − 1 = 14.9%
  })

  it('does not turn one extra filing into a trend', () => {
    // The old single-year form read 2019 -> 2024 as 3 -> 4, i.e. "+6% a year",
    // off two integers a single member could move. Averaged, the windows are
    // near-identical and the answer is flat.
    const noisy = series({ 2017: 4, 2018: 3, 2019: 3, 2020: 4, 2021: 3, 2022: 4, 2023: 3, 2024: 4 })
    expect(Math.abs(filingCagrPct(noisy, last)!)).toBeLessThanOrEqual(2)
  })

  it('ignores years inside the publication-lag horizon', () => {
    // 2025 and 2026 are structurally undercounted. Including them would drag any
    // area's trend towards a collapse; both windows end at or before 2024, so
    // adding them must not change the answer at all.
    const base = { 2017: 10, 2018: 10, 2019: 10, 2020: 15, 2021: 18, 2022: 20, 2023: 20, 2024: 20 }
    const withLagYears = series({ ...base, 2025: 4, 2026: 1 })
    expect(filingCagrPct(withLagYears, last)).toBe(filingCagrPct(series(base), last))
  })

  it('reports nothing rather than a number when the base window is too thin', () => {
    const sparse = series({ 2019: 1, 2024: 6 })
    expect(filingCagrPct(sparse, last)).toBeNull()
  })

  it('reports a full collapse as −100%, not NaN', () => {
    const collapsed = series({ 2017: 10, 2018: 10, 2019: 10 })
    expect(filingCagrPct(collapsed, last)).toBe(-100)
  })
})
