/**
 * Whitespace Studio — stage 3, signals.
 *
 * Per-cluster metrics and the terminology-divergence probe. NO LANGUAGE MODEL
 * TOUCHES ANY NUMBER IN THIS STAGE — that constraint is what makes the landscape
 * reproducible: same scope, same corpus, same signals, every time.
 *
 * Metric definitions follow plan §10.3 exactly:
 *   D(c)   = log1p(families) / log1p(P95 families across the study's clusters)
 *   V(c)   = 5-year filing CAGR, trailing 18 months excluded from computation
 *            (but never from display — the chart marks the lag instead)
 *   C(c)   = 0.5·D + 0.3·percentile(V) + 0.2·(1 − HHI_assignee)
 * Clusters are same-level cells, so no hierarchy-depth correction applies here;
 * that correction belongs to CPC-defined cells and ships with them.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { buildScopeFilter, corpusMembershipPredicate, textMatchPredicate } from './field-map'
import { PUBLICATION_LAG_MONTHS } from './field-map'
import { semanticLaneConfigured, semanticNeighbors } from './embedding'
import { heartbeatRun, WhitespacePermanentError } from './run-lease'
import type { SignalsStageResult, TermDivergence, WhitespaceScope } from './types'

const PROBE_TOP_N = 300
const PROBE_TIMEOUT_MS = 20_000
/** Ceiling on the lexical reach count; past it the figure is a floor, not a total. */
const LEXICAL_COUNT_CAP = 5_000
/** Below this many retrieved neighbours a share is noise, so no divergence is claimed. */
const MIN_NEIGHBOURS_FOR_DIVERGENCE = 40

/** Filing years averaged at each end of the CAGR window. */
const VELOCITY_WINDOW_YEARS = 3
/** Span between the two window midpoints, in years. */
const VELOCITY_SPAN_YEARS = 5
/** Below this many filings in the earlier window the ratio is noise, not a trend. */
const VELOCITY_MIN_BASE = 5

/**
 * Compound annual growth in filings, between two THREE-YEAR MEANS five years
 * apart, in percent. Null when the earlier window is too thin to divide by.
 *
 * Three-year means rather than the two single years the stage used before.
 * Cluster members are a sample of a sample — a mid-sized area contributes a
 * handful of filings per year — so one year at each end made velocity a ratio
 * of two small integers. Two members in the base year and five in the final one
 * printed "+20% a year" for an area that had not measurably moved, and one
 * member either side flipped the sign. Averaging three years at each end damps
 * that without hiding a real trend, and the span between the window midpoints
 * stays exactly five years so the figure keeps meaning what it says.
 *
 * Both windows sit at or before `lastCompleteYear`, so nothing inside the
 * publication-lag horizon — where filings are structurally undercounted and
 * every trend reads as a collapse — enters the computation.
 */
export function filingCagrPct(byYear: Map<number, number>, lastCompleteYear: number): number | null {
  const meanOver = (endYear: number): number => {
    let total = 0
    for (let year = endYear - (VELOCITY_WINDOW_YEARS - 1); year <= endYear; year++) {
      total += byYear.get(year) ?? 0
    }
    return total / VELOCITY_WINDOW_YEARS
  }
  const recent = meanOver(lastCompleteYear)
  const base = meanOver(lastCompleteYear - VELOCITY_SPAN_YEARS)
  if (base * VELOCITY_WINDOW_YEARS < VELOCITY_MIN_BASE) return null
  if (recent <= 0) return -100
  return Math.round((Math.pow(recent / base, 1 / VELOCITY_SPAN_YEARS) - 1) * 100)
}

export async function runSignalsStage(input: {
  runId: string
  studyId: string
  scope: WhitespaceScope
}): Promise<SignalsStageResult> {
  const coverageNotes: string[] = []

  const clusters = await prisma.whitespaceCluster.findMany({
    where: { studyId: input.studyId, depth: 0 },
    orderBy: { fieldEstimate: 'desc' },
  })
  if (!clusters.length) {
    throw new WhitespacePermanentError('No areas exist yet — run the area map (CLUSTER) first.')
  }

  const members = await prisma.whitespaceClusterMember.findMany({
    where: { studyId: input.studyId, clusterId: { not: null } },
    select: { clusterId: true, year: true, assigneeCanonical: true, publicationNumber: true },
  })

  const byCluster = new Map<string, typeof members>()
  for (const member of members) {
    if (!member.clusterId) continue
    const list = byCluster.get(member.clusterId) ?? []
    list.push(member)
    byCluster.set(member.clusterId, list)
  }

  // --- density normaliser: P95 of field estimates across clusters -----------
  const estimates = clusters.map(cluster => cluster.fieldEstimate).sort((a, b) => a - b)
  const p95 = estimates[Math.min(estimates.length - 1, Math.floor(estimates.length * 0.95))] || 1

  const lastCompleteYear = new Date().getFullYear() - Math.ceil(PUBLICATION_LAG_MONTHS / 12)

  const raw = clusters.map(cluster => {
    const clusterMembers = byCluster.get(cluster.id) ?? []

    // Velocity from the sample's year distribution. The sample weight cancels in
    // the ratio, so member counts are the right series for CAGR.
    const byYear = new Map<number, number>()
    for (const member of clusterMembers) {
      if (member.year) byYear.set(member.year, (byYear.get(member.year) ?? 0) + 1)
    }
    const velocityPct = filingCagrPct(byYear, lastCompleteYear)

    // Assignee HHI over the sample.
    const assigneeCounts = new Map<string, number>()
    let assigneeTotal = 0
    for (const member of clusterMembers) {
      if (!member.assigneeCanonical) continue
      assigneeCounts.set(member.assigneeCanonical, (assigneeCounts.get(member.assigneeCanonical) ?? 0) + 1)
      assigneeTotal++
    }
    let hhi: number | null = null
    if (assigneeTotal >= 10) {
      hhi = 0
      for (const count of Array.from(assigneeCounts.values())) hhi += (count / assigneeTotal) ** 2
    }

    // Jurisdictions from publication-number country prefixes.
    const jurisdictionCounts = new Map<string, number>()
    for (const member of clusterMembers) {
      const country = member.publicationNumber.slice(0, 2).toUpperCase()
      if (/^[A-Z]{2}$/.test(country)) {
        jurisdictionCounts.set(country, (jurisdictionCounts.get(country) ?? 0) + 1)
      }
    }

    const recentCount = clusterMembers.filter(
      member => member.year && member.year > lastCompleteYear - 5 && member.year <= lastCompleteYear
    ).length
    const datedCount = clusterMembers.filter(member => member.year && member.year <= lastCompleteYear).length

    return {
      cluster,
      density: Math.log1p(cluster.fieldEstimate) / Math.log1p(p95),
      velocityPct,
      hhi,
      recencyShare: datedCount >= 5 ? recentCount / datedCount : null,
      jurisdictions: Array.from(jurisdictionCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([country, families]) => ({ country, families })),
    }
  })

  // Crowdedness needs the velocity percentile across clusters.
  const velocities = raw.map(entry => entry.velocityPct).filter((value): value is number => value !== null).sort((a, b) => a - b)
  const velocityPercentile = (value: number | null): number => {
    if (value === null || !velocities.length) return 0.5
    const below = velocities.filter(velocity => velocity < value).length
    return below / velocities.length
  }

  for (const entry of raw) {
    const density = Math.min(1, entry.density)
    const crowdedness =
      0.5 * density + 0.3 * velocityPercentile(entry.velocityPct) + 0.2 * (1 - (entry.hhi ?? 0.5))

    const existing = (entry.cluster.metrics ?? {}) as Record<string, unknown>
    await prisma.whitespaceCluster.update({
      where: { id: entry.cluster.id },
      data: {
        metrics: {
          ...existing,
          density,
          velocityPct: entry.velocityPct,
          hhi: entry.hhi,
          crowdedness,
          recencyShare: entry.recencyShare,
          jurisdictions: entry.jurisdictions,
        } as unknown as Prisma.InputJsonValue,
      },
    })
  }

  await heartbeatRun(input.runId)

  // --- terminology-divergence probe ----------------------------------------
  const divergence = await terminologyProbe(input.scope, coverageNotes)

  const withoutTrend = raw.filter(entry => entry.velocityPct === null).length
  if (withoutTrend > 0) {
    coverageNotes.push(
      `${withoutTrend} of ${raw.length} areas were too small for a filing-trend estimate; their velocity is shown as unavailable, not zero.`
    )
  }
  coverageNotes.push(
    `Filing trend is compound annual growth between two ${VELOCITY_WINDOW_YEARS}-year averages ${VELOCITY_SPAN_YEARS} years apart, both ending on or before ${lastCompleteYear} — years inside the ~${PUBLICATION_LAG_MONTHS}-month publication lag are excluded from the computation.`
  )
  coverageNotes.push('Every number in this stage is computed from the corpus; no model produced any of them.')

  return {
    clustersScored: raw.length,
    divergence,
    coverageNotes,
    generatedAt: new Date().toISOString(),
  }
}

/**
 * For each scope concept: retrieve the semantically nearest families, then ask
 * how many of them the concept's OWN WORDING would also have found. Low
 * agreement means the field uses vocabulary the scope does not — the difference
 * between "nobody has done this" and "everybody calls it something else".
 *
 * The measurement is deliberately directional, and that is the fix. It used to
 * Jaccard the semantic top-300 against a lexical `SELECT DISTINCT … LIMIT 300`
 * with NO ORDER BY — an arbitrary 300 of however many thousands matched. Two
 * sets drawn from different populations by different rules barely intersect
 * whatever the vocabulary looks like, so overlap was near zero for healthy
 * scopes too and the studio warned "the field uses vocabulary your scope does
 * not" on almost every concept. Testing the RETRIEVED families against the
 * lexical predicate has no such freedom: every neighbour is checked, the answer
 * is exact, and it is the question the banner actually claims to answer.
 */
async function terminologyProbe(scope: WhitespaceScope, coverageNotes: string[]): Promise<TermDivergence[]> {
  const results: TermDivergence[] = []
  const semanticAvailable = semanticLaneConfigured()
  if (!semanticAvailable) {
    coverageNotes.push('Terminology divergence could not be measured — the semantic lane is not configured.')
  }

  // Base predicate: the scope minus its concept text, so both lanes search the
  // same slice and differ only in how they express the concept.
  const baseScope: WhitespaceScope = { ...scope, concepts: [], exclusions: [] }
  const baseFilter = buildScopeFilter(baseScope)
  // The lexical lane's per-corpus arms carry the corpus restriction inside
  // textMatchPredicate; the semantic lane matches by vector and never touches
  // it. Without repeating the restriction here, its top-N could include
  // epo-ops/pqai rows the lexical lane structurally cannot see — deflating the
  // overlap and reporting "terminology divergence" that was really just the
  // two lanes reading different corpora.
  const semanticFilter = Prisma.sql`${baseFilter} AND ${corpusMembershipPredicate()}`

  for (const concept of scope.concepts.slice(0, 6)) {
    const terms = [concept.label, ...concept.synonyms].map(term => term.trim()).filter(Boolean)
    if (!terms.length) continue
    // One OR group over the concept's terms, matched with the same per-corpus
    // arms the census uses — so the two lanes disagree only in vocabulary,
    // never in which corpus slice they were allowed to see.
    const tsquery = terms.map(term => `"${term.replace(/["\\]/g, ' ').trim()}"`).join(' OR ')
    const textPredicate = textMatchPredicate({ groups: [tsquery], groupLabels: [[concept.label]], exclusions: null })

    // How much of the field this concept's wording reaches at all. Bounded by a
    // subquery LIMIT so a broad concept cannot turn a diagnostic into a full
    // corpus count; past the cap the number is a floor and is only ever
    // displayed as context, never as a denominator.
    let lexicalCount = 0
    try {
      const rows = await withTimeout<{ families: bigint }>(
        Prisma.sql`
          SELECT COUNT(*)::bigint AS families
          FROM (
            SELECT DISTINCT COALESCE(lp."familyId", lp."publicationNumber") AS family_key
            FROM "local_patents" lp
            WHERE ${baseFilter}
              AND ${textPredicate}
            LIMIT ${LEXICAL_COUNT_CAP}
          ) t`
      )
      lexicalCount = Number(rows[0]?.families ?? 0)
    } catch (error) {
      console.error('[Whitespace] Lexical probe failed:', error instanceof Error ? error.message : error)
    }

    const unmeasured = (): void => {
      results.push({
        concept: concept.label,
        lexicalCount,
        semanticCount: null,
        overlapPct: null,
        semanticOnlyVocabulary: null,
        divergent: false,
      })
    }

    if (!semanticAvailable) {
      unmeasured()
      continue
    }

    const semantic = await semanticNeighbors({
      queryText: terms.join('; '),
      limit: PROBE_TOP_N,
      scopeFilter: semanticFilter,
      timeoutMs: PROBE_TIMEOUT_MS,
    })
    if (!semantic.available || !semantic.neighbors.length) {
      unmeasured()
      continue
    }

    // The exact test: which of the retrieved neighbours the concept's own
    // wording also matches. One statement, every neighbour checked.
    const neighborIds = semantic.neighbors.map(neighbor => neighbor.id)
    let lexicalSet: Set<string>
    try {
      const matchedRows = await withTimeout<{ familyKey: string }>(
        Prisma.sql`
          SELECT DISTINCT COALESCE(lp."familyId", lp."publicationNumber") AS "familyKey"
          FROM "local_patents" lp
          WHERE lp."id" = ANY(${neighborIds}::int[])
            AND ${textPredicate}`
      )
      lexicalSet = new Set(matchedRows.map(row => row.familyKey))
    } catch (error) {
      // The agreement test is the measurement. Without it there is no
      // divergence figure — reporting one from the half that did run would be
      // exactly the fabricated number this stage exists to avoid.
      console.error('[Whitespace] Agreement probe failed:', error instanceof Error ? error.message : error)
      unmeasured()
      continue
    }

    const semanticKeys = semantic.neighbors.map(neighbor => neighbor.familyKey)
    const semanticSet = new Set(semanticKeys)
    let intersection = 0
    for (const key of Array.from(semanticSet)) if (lexicalSet.has(key)) intersection++
    const overlapPct = semanticSet.size > 0 ? Math.round((intersection / semanticSet.size) * 100) : null

    // Vocabulary of the semantic-only hits, extracted deterministically: the
    // most frequent title words that appear in none of the scope's own terms.
    const scopeVocabulary = new Set(
      terms
        .flatMap(term => term.toLowerCase().split(/\W+/))
        .filter(word => word.length > 2)
    )
    const wordCounts = new Map<string, number>()
    for (const neighbor of semantic.neighbors) {
      if (lexicalSet.has(neighbor.familyKey)) continue
      for (const word of (neighbor.title || '').toLowerCase().split(/\W+/)) {
        if (word.length < 4 || scopeVocabulary.has(word) || STOP_WORDS.has(word)) continue
        wordCounts.set(word, (wordCounts.get(word) ?? 0) + 1)
      }
    }
    const vocabulary = Array.from(wordCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([word]) => word)
      .join(', ')

    // Enough retrieved material for the share to mean anything, and enough of it
    // unreachable by wording to be worth telling the user about.
    const semanticOnly = semanticSet.size - intersection
    const measurable = semanticSet.size >= MIN_NEIGHBOURS_FOR_DIVERGENCE
    results.push({
      concept: concept.label,
      lexicalCount,
      semanticCount: semanticSet.size,
      overlapPct,
      semanticOnlyVocabulary: vocabulary || null,
      divergent: measurable && overlapPct !== null && overlapPct < 30 && semanticOnly >= 30,
    })
  }

  return results
}

const STOP_WORDS = new Set([
  'with', 'from', 'that', 'this', 'have', 'having', 'method', 'methods', 'system', 'systems',
  'apparatus', 'device', 'devices', 'thereof', 'based', 'using', 'therefor', 'same', 'process',
])

async function withTimeout<T>(query: Prisma.Sql): Promise<T[]> {
  const [, rows] = await prisma.$transaction([
    prisma.$executeRaw`SELECT set_config('statement_timeout', ${String(PROBE_TIMEOUT_MS)}, true)`,
    prisma.$queryRaw<T[]>(query),
  ])
  return rows
}
