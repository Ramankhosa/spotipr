/**
 * Whitespace Studio — stage 5, hypothesis generation.
 *
 * Interactive rather than a background run: one premium call, and the user is
 * waiting to see what came out. The generator is fed ONLY measured signals —
 * cluster metrics, co-occurrence residuals, divergence probes — and its output
 * is created with type UNDETERMINED. Only the validation gate ladder can move a
 * hypothesis past that; the generator structurally cannot mark its own output
 * as genuine.
 *
 * Scores at generation time are the ones already measurable (density,
 * crowdedness, rarity, semantic novelty). Evidence quality, confidence and
 * strength stay null until validation has actually tried to refute the
 * hypothesis — printing a confidence before anyone attacked it would be
 * theatre.
 */

import { Prisma, TaskCode } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { hamming, hexToWords, WORDS, mulberry32 } from './binary-kmeans'
import { normalizeElement } from './deep-dive-stage'
import { resolveFieldDefinition } from './field-definition'
import { dedupeNeighborsByFamily, semanticNeighbors, semanticNoveltyScore, type SemanticNeighbor } from './embedding'
import { runWhitespaceLLM, parseModelJson, type WhitespaceLLMContext } from './llm'
import { buildHypothesizePrompt, WS_HYPOTHESIZE_STAGE_CODE } from './prompts'
import { CORPUS_FIRST_YEAR } from './types'
import type {
  DeepDiveResult,
  HypothesisScores,
  RarePair,
  SignalsStageResult,
  WhitespaceScope,
} from './types'

const MAX_HYPOTHESES = 8

export interface GeneratedHypothesis {
  id: string
  statement: string
  rationale: string
  strategy: string
  clusterId: string | null
  clusterLabel: string | null
  elements: string[]
  scores: HypothesisScores
}

export async function generateHypotheses(input: {
  studyId: string
  userId: string
  scope: WhitespaceScope
  llmContext: WhitespaceLLMContext
}): Promise<{ hypotheses: GeneratedHypothesis[]; modelCode?: string }> {
  const clusters = await prisma.whitespaceCluster.findMany({
    where: { studyId: input.studyId, depth: 0 },
    orderBy: { fieldEstimate: 'desc' },
  })
  if (!clusters.length) {
    throw new Error('Break the field into areas first — hypotheses are proposed against measured area signals.')
  }

  const hasSignals = clusters.some(cluster => {
    const metrics = cluster.metrics as Record<string, unknown> | null
    return metrics && metrics.density !== null && metrics.density !== undefined
  })
  if (!hasSignals) {
    throw new Error('Run signals first — the generator is only allowed to reason from measured numbers.')
  }

  // --- assemble the measured inputs -----------------------------------------
  const areas = await prisma.whitespaceAreaAnalysis.findMany({
    where: { studyId: input.studyId, status: 'COMPLETED' },
  })
  const rarePairs: Array<RarePair & { clusterLabel: string; clusterId: string }> = []
  for (const area of areas) {
    const results = area.results as unknown as DeepDiveResult | null
    if (!results?.rarePairs) continue
    for (const pair of results.rarePairs.slice(0, 8)) {
      rarePairs.push({ ...pair, clusterLabel: results.clusterLabel, clusterId: area.clusterId })
    }
  }
  rarePairs.sort((a, b) => b.rarity - a.rarity)

  const signalsRun = await prisma.whitespaceRun.findFirst({
    where: { studyId: input.studyId, stage: 'SIGNALS', status: 'COMPLETED' },
    orderBy: { createdAt: 'desc' },
  })
  const divergence = ((signalsRun?.results as unknown as SignalsStageResult | null)?.divergence ?? []).filter(
    entry => entry.divergent
  )

  const clusterSummaries = clusters.map(cluster => {
    const metrics = (cluster.metrics ?? {}) as Record<string, any>
    return {
      id: cluster.id,
      label: cluster.label,
      description: cluster.description,
      grade: String(metrics.grade ?? 'usable'),
      density: typeof metrics.density === 'number' ? metrics.density : null,
      velocityPct: typeof metrics.velocityPct === 'number' ? metrics.velocityPct : null,
      crowdedness: typeof metrics.crowdedness === 'number' ? metrics.crowdedness : null,
      fieldEstimate: cluster.fieldEstimate,
    }
  })

  // --- one premium call ------------------------------------------------------
  const prompt = buildHypothesizePrompt({
    fieldTitle: input.scope.title || 'this field',
    scopeSummary: input.scope.summary || '',
    clusters: clusterSummaries.map(({ id: _id, ...rest }) => rest),
    rarePairs: rarePairs.slice(0, 12),
    divergentConcepts: divergence.map(entry => ({
      concept: entry.concept,
      overlapPct: entry.overlapPct ?? 0,
      semanticOnlyVocabulary: entry.semanticOnlyVocabulary,
    })),
    maxHypotheses: MAX_HYPOTHESES,
  })
  const response = await runWhitespaceLLM({
    taskCode: TaskCode.WS_HYPOTHESIZE,
    stageCode: WS_HYPOTHESIZE_STAGE_CODE,
    prompt,
    context: input.llmContext,
  })
  const parsed = parseModelJson<{
    hypotheses: Array<{
      statement?: unknown
      rationale?: unknown
      strategy?: unknown
      clusterLabel?: unknown
      elements?: unknown
      searchTerms?: unknown
    }>
  }>(response.output, 'Hypothesis generation')

  // --- field NN-distance percentiles for semantic novelty -------------------
  // Computed from the sample's own stored bit vectors: for a subsample of
  // members, the distance to their nearest co-sampled neighbour. Self-calibrated
  // per field, no external call needed.
  const percentiles = await fieldNeighborPercentiles(input.studyId)

  const coverageBase = buildCoverageLimitations(input.scope)

  // Hoisted out of the per-hypothesis loop, and built from the same hybrid field
  // the census and area map used — a nearest-neighbour distance measured against
  // a different field than the percentiles were calibrated on is not a novelty
  // score, it is noise. Resolved even when percentiles are null: the novelty
  // SCORE needs calibration, but the nearest-art capture below is worth having
  // on a small sample too.
  //
  // Consumer: the census's own rule (reuse), so the field is the one the
  // percentiles were calibrated on.
  const field = await resolveFieldDefinition(input.scope, { studyId: input.studyId, reuse: true })
  const fieldFilter: Prisma.Sql | null = field.where

  const created: GeneratedHypothesis[] = []
  for (const raw of (parsed.hypotheses ?? []).slice(0, MAX_HYPOTHESES)) {
    const statement = typeof raw.statement === 'string' ? raw.statement.trim().slice(0, 600) : ''
    const rationale = typeof raw.rationale === 'string' ? raw.rationale.trim().slice(0, 1200) : ''
    if (!statement || !rationale) continue
    const strategy = typeof raw.strategy === 'string' ? raw.strategy : 'RARE_COMBINATION'
    const clusterLabel = typeof raw.clusterLabel === 'string' ? raw.clusterLabel : null
    // Matched trimmed and case-insensitively: the model echoes labels back with
    // drifted case and stray whitespace, and a strict === yielded clusterId
    // null — which later guarantees gate G1 fails and mistypes the hypothesis
    // as DATA_WHITESPACE.
    const clusterLabelKey = clusterLabel?.trim().toLowerCase() || null
    const cluster = clusterLabelKey
      ? clusterSummaries.find(summary => summary.label.trim().toLowerCase() === clusterLabelKey) ?? null
      : null
    const elements = Array.isArray(raw.elements)
      ? raw.elements.filter((element): element is string => typeof element === 'string').slice(0, 5)
      : []
    const searchTerms = Array.isArray(raw.searchTerms)
      ? raw.searchTerms.filter((term): term is string => typeof term === 'string').slice(0, 8)
      : []

    // Rarity: the best matching measured pair among this hypothesis's elements.
    // Compared on NORMALISED labels — the pairs were measured over strings the
    // deep dive normalised, and the generator writes them back in whatever case
    // and punctuation it likes, so strict equality practically never matched
    // and every hypothesis lost the rarity signal it was generated from.
    const elementKeys = new Set(elements.map(normalizeElement))
    const matchedPair = rarePairs.find(
      pair => elementKeys.has(normalizeElement(pair.a)) && elementKeys.has(normalizeElement(pair.b))
    )

    // One probe serves two readings: the nearest distance calibrates semantic
    // novelty (percentiles permitting), and the nearest DOCUMENTS are kept as
    // evidence — "the system says novel" means nothing to an attorney without
    // the closest thing that already exists sitting next to it. Widening the
    // limit costs no extra index work (the scoped pool is fixed) and no extra
    // embed calls.
    const nearest = await semanticNeighbors({
      queryText: statement,
      limit: 24,
      scopeFilter: fieldFilter ?? undefined,
    })

    // Semantic novelty: distance from the statement to the nearest family in
    // the field, against the field's own percentiles. Unavailable → null, and
    // the limitation is recorded rather than a number invented.
    let semanticNovelty: number | null = null
    if (percentiles && nearest.available && nearest.neighbors.length) {
      semanticNovelty = semanticNoveltyScore(nearest.neighbors[0].distance, percentiles.p05, percentiles.p50)
    }

    const scores: HypothesisScores = {
      density: cluster?.density ?? null,
      rarity: matchedPair?.rarity ?? null,
      semanticNovelty,
      evidenceQuality: null,
      confidence: null,
      crowdedness: cluster?.crowdedness ?? null,
      strength: null,
    }

    const coverageLimitations = [...coverageBase]
    if (semanticNovelty === null) {
      coverageLimitations.push('Semantic novelty not measured — semantic lane unavailable at generation time.')
    }
    if (!matchedPair) {
      coverageLimitations.push('No measured rarity signal backs this combination — it rests on area-level signals only.')
    }
    if (!nearest.available) {
      coverageLimitations.push('Closest existing art not captured — semantic search was unavailable at generation time.')
    }

    const row = await prisma.whitespaceHypothesis.create({
      data: {
        studyId: input.studyId,
        clusterId: cluster?.id ?? null,
        type: 'UNDETERMINED',
        statement,
        rationale,
        elementCombination: { elements, searchTerms, strategy } as unknown as Prisma.InputJsonValue,
        scores: scores as unknown as Prisma.InputJsonValue,
        status: 'DRAFT',
        coverageLimitations: coverageLimitations as unknown as Prisma.InputJsonValue,
        createdBy: input.userId,
      },
    })

    if (matchedPair) {
      await prisma.whitespaceEvidence.create({
        data: {
          studyId: input.studyId,
          hypothesisId: row.id,
          clusterId: cluster?.id ?? null,
          kind: 'STATISTIC',
          stance: 'CONTEXT',
          passage: `"${matchedPair.a}" and "${matchedPair.b}" co-occur in ${matchedPair.observed} of ${matchedPair.supportA}+${matchedPair.supportB} supporting families vs ${matchedPair.expected.toFixed(1)} expected by chance (z = ${matchedPair.z.toFixed(2)}).`,
          data: matchedPair as unknown as Prisma.InputJsonValue,
        },
      })
    }

    if (nearest.available && nearest.neighbors.length) {
      await prisma.whitespaceEvidence.createMany({
        data: nearestArtEvidenceRows(nearest.neighbors, statement).map(evidence => ({
          studyId: input.studyId,
          hypothesisId: row.id,
          clusterId: cluster?.id ?? null,
          kind: evidence.kind,
          stance: evidence.stance,
          refId: evidence.refId,
          passage: evidence.passage,
          queryText: evidence.queryText,
          score: evidence.score,
          data: evidence.data as unknown as Prisma.InputJsonValue,
        })),
      })
    }

    created.push({
      id: row.id,
      statement,
      rationale,
      strategy,
      clusterId: cluster?.id ?? null,
      clusterLabel: cluster?.label ?? null,
      elements,
      scores,
    })
  }

  if (!created.length) {
    throw new Error('The generator returned nothing testable. Run it again, or run deep dives first to give it rarity signals.')
  }

  return { hypotheses: created, modelCode: response.modelCode }
}

/** How many nearest-art families each hypothesis keeps as evidence. */
const NEAREST_ART_FAMILIES = 8

/**
 * The nearest-art evidence rows for one hypothesis, from the same neighbour
 * probe that scored its semantic novelty. Pure — the write site adds the ids.
 *
 * `data.role` is the discriminator: validation also writes PATENT_PASSAGE rows
 * (stance CONTRADICTORY), so kind alone cannot identify these. `data.rank`
 * carries display order because createMany stamps near-identical createdAt.
 * Stance is CONTEXT by design — nobody has read these against the claim; they
 * are "the closest thing that exists", not a verdict either way.
 */
export function nearestArtEvidenceRows(
  neighbors: SemanticNeighbor[],
  statement: string
): Array<{
  kind: 'PATENT_PASSAGE'
  stance: 'CONTEXT'
  refId: string
  passage: string | null
  queryText: string
  score: number
  data: { role: 'NEAREST_ART'; title: string | null; familyKey: string; rank: number }
}> {
  return dedupeNeighborsByFamily(neighbors, NEAREST_ART_FAMILIES).map((neighbor, index) => ({
    kind: 'PATENT_PASSAGE',
    stance: 'CONTEXT',
    refId: neighbor.publicationNumber,
    passage: neighbor.abstract ? neighbor.abstract.slice(0, 1000) : null,
    queryText: statement,
    score: neighbor.distance,
    data: { role: 'NEAREST_ART', title: neighbor.title, familyKey: neighbor.familyKey, rank: index + 1 },
  }))
}

/**
 * p05/p50 of nearest-neighbour Hamming distances within the study's sample,
 * from the bit vectors stored on cluster members. Null when the sample is too
 * small to calibrate against.
 */
async function fieldNeighborPercentiles(studyId: string): Promise<{ p05: number; p50: number } | null> {
  const members = await prisma.whitespaceClusterMember.findMany({
    where: { studyId, bits: { not: null } },
    select: { bits: true },
    take: 4000,
  })
  if (members.length < 50) return null

  const vectors = members.map(member => hexToWords(member.bits!))
  const random = mulberry32(17)
  const probeCount = Math.min(300, vectors.length)
  const probes: number[] = []
  const used = new Set<number>()
  while (probes.length < probeCount) {
    const index = Math.floor(random() * vectors.length)
    if (!used.has(index)) {
      used.add(index)
      probes.push(index)
    }
  }

  const distances: number[] = []
  for (const probe of probes) {
    let nearest = Number.POSITIVE_INFINITY
    for (let i = 0; i < vectors.length; i++) {
      if (i === probe) continue
      const distance = hamming(vectors[probe], vectors[i])
      if (distance < nearest) nearest = distance
    }
    if (Number.isFinite(nearest)) distances.push(nearest / (WORDS * 32))
  }
  if (distances.length < 20) return null
  distances.sort((a, b) => a - b)
  return {
    p05: distances[Math.floor(distances.length * 0.05)],
    p50: distances[Math.floor(distances.length * 0.5)],
  }
}

/** The corpus facts every hypothesis carries from birth. */
function buildCoverageLimitations(scope: WhitespaceScope): string[] {
  const limitations = [
    `No art before ${CORPUS_FIRST_YEAR} was searched — outside corpus.`,
    'No citation data, legal status, or commercial evidence is available to this analysis.',
    'Semantic analysis is based on title and abstract embeddings, not full claim scope.',
    'Trade-secret protection is undetectable in patent data.',
  ]
  if (scope.filters.jurisdictions.length) {
    limitations.push(`Search restricted to ${scope.filters.jurisdictions.join(', ')} — other jurisdictions unexamined.`)
  }
  return limitations
}
