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
import { buildScopeFilter } from './field-map'
import { PUBLICATION_LAG_MONTHS } from './field-map'
import { semanticLaneConfigured, semanticNeighbors } from './embedding'
import type { SignalsStageResult, TermDivergence, WhitespaceScope } from './types'

const PROBE_TOP_N = 300
const PROBE_TIMEOUT_MS = 20_000

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
    throw new Error('No areas exist yet — run the area map (CLUSTER) first.')
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
    const startYear = lastCompleteYear - 5
    const startCount = byYear.get(startYear) ?? 0
    const endCount = byYear.get(lastCompleteYear) ?? 0
    const velocityPct =
      startCount >= 3 ? Math.round((Math.pow(endCount / startCount, 1 / 5) - 1) * 100) : null

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

  await heartbeat(input.runId)

  // --- terminology-divergence probe ----------------------------------------
  const divergence = await terminologyProbe(input.scope, coverageNotes)

  const sampledYears = raw.filter(entry => entry.velocityPct === null).length
  if (sampledYears > 0) {
    coverageNotes.push(
      `${sampledYears} of ${raw.length} areas were too small for a filing-trend estimate; their velocity is shown as unavailable, not zero.`
    )
  }
  coverageNotes.push('Every number in this stage is computed from the corpus; no model produced any of them.')

  return {
    clustersScored: raw.length,
    divergence,
    coverageNotes,
    generatedAt: new Date().toISOString(),
  }
}

/**
 * For each scope concept, run the lexical lane and the semantic lane separately
 * and compare their top family sets. Low overlap with a productive semantic
 * lane means the field uses vocabulary the scope does not — the difference
 * between "nobody has done this" and "everybody calls it something else".
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

  for (const concept of scope.concepts.slice(0, 6)) {
    const terms = [concept.label, ...concept.synonyms].map(term => term.trim()).filter(Boolean)
    if (!terms.length) continue
    const tsquery = terms.map(term => `"${term.replace(/["\\]/g, ' ').trim()}"`).join(' OR ')

    let lexical: string[] = []
    try {
      const rows = await withTimeout<{ familyKey: string }>(
        Prisma.sql`
          SELECT DISTINCT COALESCE(lp."familyId", lp."publicationNumber") AS "familyKey"
          FROM "local_patents" lp
          WHERE ${baseFilter}
            AND to_tsvector('english'::regconfig,
                  coalesce(lp."ragText", '')   || ' ' ||
                  coalesce(lp."title", '')     || ' ' ||
                  coalesce(lp."abstract", '')  || ' ' ||
                  coalesce(lp."abstractOriginal", ''))
                @@ websearch_to_tsquery('english'::regconfig, ${tsquery})
            AND lp."corpusSources" @> ARRAY['google-patents-corpus']::TEXT[]
          LIMIT ${PROBE_TOP_N}`
      )
      lexical = rows.map(row => row.familyKey)
    } catch (error) {
      console.error('[Whitespace] Lexical probe failed:', error instanceof Error ? error.message : error)
    }

    if (!semanticAvailable) {
      results.push({
        concept: concept.label,
        lexicalCount: lexical.length,
        semanticCount: null,
        overlapPct: null,
        semanticOnlyVocabulary: null,
        divergent: false,
      })
      continue
    }

    const semantic = await semanticNeighbors({
      queryText: terms.join('; '),
      limit: PROBE_TOP_N,
      scopeFilter: baseFilter,
      timeoutMs: PROBE_TIMEOUT_MS,
    })
    if (!semantic.available) {
      results.push({
        concept: concept.label,
        lexicalCount: lexical.length,
        semanticCount: null,
        overlapPct: null,
        semanticOnlyVocabulary: null,
        divergent: false,
      })
      continue
    }

    const lexicalSet = new Set(lexical)
    const semanticKeys = semantic.neighbors.map(neighbor => neighbor.familyKey)
    const semanticSet = new Set(semanticKeys)
    let intersection = 0
    for (const key of Array.from(semanticSet)) if (lexicalSet.has(key)) intersection++
    const union = new Set([...Array.from(lexicalSet), ...Array.from(semanticSet)]).size
    const overlapPct = union > 0 ? Math.round((intersection / union) * 100) : null

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

    const semanticOnlyDense = semanticSet.size - intersection >= PROBE_TOP_N * 0.3
    results.push({
      concept: concept.label,
      lexicalCount: lexical.length,
      semanticCount: semanticKeys.length,
      overlapPct,
      semanticOnlyVocabulary: vocabulary || null,
      divergent: overlapPct !== null && overlapPct < 30 && semanticOnlyDense,
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

async function heartbeat(runId: string): Promise<void> {
  try {
    await prisma.whitespaceRun.update({ where: { id: runId }, data: { heartbeatAt: new Date() } })
  } catch {
    // Staleness detection only; never fail the stage for a missed heartbeat.
  }
}
