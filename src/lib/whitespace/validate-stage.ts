/**
 * Whitespace Studio — stage 6, adversarial validation.
 *
 * The loop that makes a hypothesis mean something. Four retrieval-shaped attacks
 * run against the local corpus, each generated to SUCCEED at refutation; top
 * hits are element-mapped against the hypothesis combination; a premium red-team
 * pass then names and executes the strongest remaining attack.
 *
 * Three commitments keep this honest rather than theatrical:
 *   1. The attack prompts are rewarded for refutation, not confirmation.
 *   2. Every query, hit count and mapping is logged as SEARCH_TRACE evidence.
 *   3. Attacks that COULD NOT run are logged too, lower disproofCompleteness,
 *      and are named in coverageLimitations. Absence of a disproof search is
 *      recorded as weakness, never as survival.
 *
 * One epistemic override: a single candidate mapping PRESENT for the full
 * combination forces confidence to 0 and status to REFUTED. One solid
 * refutation outweighs any amount of supporting evidence.
 */

import { Prisma, TaskCode } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { semanticLaneConfigured, semanticNeighbors } from './embedding'
import { runWhitespaceLLM, parseModelJson } from './llm'
import {
  buildDisproofQueriesPrompt,
  buildElementMappingPrompt,
  buildRedTeamPrompt,
  WS_REDTEAM_STAGE_CODE,
  WS_VALIDATE_STAGE_CODE,
} from './prompts'
import type {
  AttackRecord,
  GateOutcome,
  HypothesisScores,
  ValidationRecord,
  WhitespaceScope,
  WhitespaceType,
} from './types'

const ATTACK_HIT_LIMIT = 25
const MAPPING_CANDIDATES = 8
const SEARCH_TIMEOUT_MS = 20_000

interface AttackHit {
  familyKey: string
  publicationNumber: string
  title: string
  abstract: string | null
  claimsText: string | null
  strategy: AttackRecord['strategy']
}

interface MappedCandidate {
  publicationNumber: string
  basis: string
  fullCombination: 'PRESENT' | 'PARTIAL' | 'ABSENT'
  elements: Array<{ element: string; verdict: string; quote: string }>
}

export async function runValidateStage(input: {
  runId: string
  studyId: string
  hypothesisId: string
  scope: WhitespaceScope
  requestHeaders: Record<string, string>
}): Promise<{ status: string; type: WhitespaceType; confidence: number | null; attacksRun: number }> {
  const hypothesis = await prisma.whitespaceHypothesis.findUnique({ where: { id: input.hypothesisId } })
  if (!hypothesis || hypothesis.studyId !== input.studyId) {
    throw new Error('That hypothesis no longer exists.')
  }

  await prisma.whitespaceHypothesis.update({
    where: { id: hypothesis.id },
    data: { status: 'VALIDATING' },
  })

  const combination = (hypothesis.elementCombination ?? {}) as Record<string, unknown>
  const elements = Array.isArray(combination.elements)
    ? (combination.elements as unknown[]).filter((element): element is string => typeof element === 'string')
    : []
  const searchTerms = Array.isArray(combination.searchTerms)
    ? (combination.searchTerms as unknown[]).filter((term): term is string => typeof term === 'string')
    : []
  if (!elements.length) {
    throw new Error('This hypothesis carries no element combination to test.')
  }

  const attacks: AttackRecord[] = []
  const allHits = new Map<string, AttackHit>()

  // --- 1. compile the attack plan -------------------------------------------
  const cpcInScope = input.scope.classifications.filter(c => c.accepted).map(c => c.code)
  let plan: { synonymShifted: string[]; semanticParaphrases: string[]; cpcAdjacent: string[]; assigneeCandidates: string[] }
  try {
    const response = await runWhitespaceLLM({
      taskCode: TaskCode.WS_VALIDATE,
      stageCode: WS_VALIDATE_STAGE_CODE,
      prompt: buildDisproofQueriesPrompt({
        statement: hypothesis.statement,
        elements,
        searchTerms,
        cpcCodes: cpcInScope,
      }),
      requestHeaders: input.requestHeaders,
    })
    const parsed = parseModelJson<Record<string, unknown>>(response.output, 'Disproof query generation')
    plan = {
      synonymShifted: asStrings(parsed.synonymShifted, 4),
      semanticParaphrases: asStrings(parsed.semanticParaphrases, 3),
      cpcAdjacent: asStrings(parsed.cpcAdjacent, 4),
      assigneeCandidates: asStrings(parsed.assigneeCandidates, 5),
    }
  } catch (error) {
    // Fall back to the hypothesis's own search terms — a weaker attack is still
    // an attack, and the weakness is visible in the trace.
    plan = {
      synonymShifted: [searchTerms.join(' OR ') || elements.join(' ')],
      semanticParaphrases: [hypothesis.statement],
      cpcAdjacent: [],
      assigneeCandidates: [],
    }
    console.error('[Whitespace] Disproof query generation failed; using fallback queries:', error)
  }

  await heartbeat(input.runId)

  // --- 2. run the four attack strategies ------------------------------------
  for (const query of plan.synonymShifted) {
    const hits = await lexicalAttack(query)
    recordAttack(attacks, allHits, 'SYNONYM_SHIFTED', query, hits)
  }

  if (semanticLaneConfigured()) {
    for (const paraphrase of plan.semanticParaphrases) {
      const result = await semanticNeighbors({ queryText: paraphrase, limit: ATTACK_HIT_LIMIT })
      if (result.available) {
        const hits: AttackHit[] = result.neighbors.map(neighbor => ({
          familyKey: neighbor.familyKey,
          publicationNumber: neighbor.publicationNumber,
          title: neighbor.title || neighbor.publicationNumber,
          abstract: neighbor.abstract,
          claimsText: null,
          strategy: 'SEMANTIC_PARAPHRASE',
        }))
        recordAttack(attacks, allHits, 'SEMANTIC_PARAPHRASE', paraphrase, hits)
      } else {
        attacks.push({ strategy: 'SEMANTIC_PARAPHRASE', query: paraphrase, hits: 0, outcome: 'NOT_RUN', reason: result.reason })
      }
    }
  } else {
    attacks.push({
      strategy: 'SEMANTIC_PARAPHRASE',
      query: plan.semanticParaphrases.join(' | ') || hypothesis.statement,
      hits: 0,
      outcome: 'NOT_RUN',
      reason: 'Semantic lane not configured — paraphrase attacks were not run.',
    })
  }

  for (const code of plan.cpcAdjacent) {
    const hits = await cpcAttack(code, elements)
    recordAttack(attacks, allHits, 'CPC_ADJACENT', code, hits)
  }

  for (const assignee of plan.assigneeCandidates) {
    const hits = await assigneeAttack(assignee, elements)
    recordAttack(attacks, allHits, 'ASSIGNEE_PIVOT', assignee, hits)
  }

  // Literature disproof: no NPL provider is wired into this stage yet. Recorded
  // as un-run — never skipped silently, never counted as survival.
  attacks.push({
    strategy: 'LITERATURE',
    query: 'Has anyone published this combination?',
    hits: 0,
    outcome: 'NOT_RUN',
    reason: 'No non-patent-literature provider is configured for this deployment.',
  })

  await heartbeat(input.runId)

  // --- 3. element-map the closest hits --------------------------------------
  const candidates = Array.from(allHits.values()).slice(0, MAPPING_CANDIDATES)
  let mapped: MappedCandidate[] = []
  if (candidates.length) {
    const enriched = await enrichWithClaims(candidates)
    try {
      const response = await runWhitespaceLLM({
        taskCode: TaskCode.WS_VALIDATE,
        stageCode: WS_VALIDATE_STAGE_CODE,
        prompt: buildElementMappingPrompt({
          statement: hypothesis.statement,
          elements,
          candidates: enriched,
        }),
        requestHeaders: input.requestHeaders,
      })
      const parsed = parseModelJson<{ candidates: MappedCandidate[] }>(response.output, 'Element mapping')
      mapped = (parsed.candidates ?? []).filter(candidate => candidate && typeof candidate.publicationNumber === 'string')
    } catch (error) {
      console.error('[Whitespace] Element mapping failed:', error)
    }
  }

  applyMappingOutcomes(attacks, allHits, mapped)

  // --- 4. red team names and executes the strongest remaining attack --------
  let redTeam: {
    strongestRemainingAttack?: { description?: string; query?: string | null } | null
    feasibilityConcern?: string | null
    commercialConcern?: string | null
    regulatoryConcern?: string | null
    verdict?: string
    verdictReason?: string
  } = {}
  try {
    const response = await runWhitespaceLLM({
      taskCode: TaskCode.WS_REDTEAM,
      stageCode: WS_REDTEAM_STAGE_CODE,
      prompt: buildRedTeamPrompt({
        statement: hypothesis.statement,
        rationale: hypothesis.rationale,
        elements,
        attacksRun: attacks.map(attack => ({
          strategy: attack.strategy,
          query: attack.query,
          hits: attack.hits,
          outcome: attack.outcome,
        })),
        survivingNearest: mapped.map(candidate => ({
          publicationNumber: candidate.publicationNumber,
          title: allHitTitle(allHits, candidate.publicationNumber),
          verdict: candidate.fullCombination,
        })),
      }),
      requestHeaders: input.requestHeaders,
    })
    redTeam = parseModelJson(response.output, 'Red team')
  } catch (error) {
    console.error('[Whitespace] Red team pass failed:', error)
  }

  if (redTeam.strongestRemainingAttack?.query) {
    const query = String(redTeam.strongestRemainingAttack.query)
    const hits = await lexicalAttack(query)
    recordAttack(attacks, allHits, 'RED_TEAM', query, hits)
  }

  await heartbeat(input.runId)

  // --- 5. persist the evidence trail ----------------------------------------
  for (const attack of attacks) {
    await prisma.whitespaceEvidence.create({
      data: {
        studyId: input.studyId,
        hypothesisId: hypothesis.id,
        kind: 'SEARCH_TRACE',
        stance: 'CONTEXT',
        queryText: attack.query.slice(0, 2000),
        data: attack as unknown as Prisma.InputJsonValue,
      },
    })
  }
  for (const candidate of mapped) {
    if (candidate.fullCombination === 'ABSENT') continue
    const quote = candidate.elements.find(entry => entry.quote)?.quote ?? null
    await prisma.whitespaceEvidence.create({
      data: {
        studyId: input.studyId,
        hypothesisId: hypothesis.id,
        kind: 'PATENT_PASSAGE',
        refId: candidate.publicationNumber,
        passage: quote,
        stance: 'CONTRADICTORY',
        data: candidate as unknown as Prisma.InputJsonValue,
      },
    })
  }

  // --- 6. gates, scores, verdict --------------------------------------------
  const fullRefutation =
    mapped.some(candidate => candidate.fullCombination === 'PRESENT') || redTeam.verdict === 'REFUTED'
  const partialCount = mapped.filter(candidate => candidate.fullCombination === 'PARTIAL').length

  const gates = await evaluateGates({
    studyId: input.studyId,
    clusterId: hypothesis.clusterId,
    attacks,
    fullRefutation,
    partialCount,
    redTeam,
  })

  const scores = computeScores({
    prior: hypothesis.scores as unknown as HypothesisScores,
    attacks,
    gates,
    fullRefutation,
    partialCount,
    clusterId: hypothesis.clusterId,
    studyId: input.studyId,
  })

  const { type, status } = decideTypeAndStatus({ gates, fullRefutation, confidence: scores.confidence })

  const validation: ValidationRecord = {
    attacks,
    gates,
    attacksPlanned: attacks.length,
    attacksRun: attacks.filter(attack => attack.outcome !== 'NOT_RUN').length,
    redTeamNotes: redTeam.verdictReason ?? null,
    validatedAt: new Date().toISOString(),
  }

  const notRun = attacks.filter(attack => attack.outcome === 'NOT_RUN')
  const existingLimitations = Array.isArray(hypothesis.coverageLimitations)
    ? (hypothesis.coverageLimitations as unknown[]).filter((entry): entry is string => typeof entry === 'string')
    : []
  const coverageLimitations = [
    ...existingLimitations,
    ...notRun.map(attack => `${attack.strategy.replace(/_/g, ' ').toLowerCase()} attack not run — ${attack.reason ?? 'unavailable'}.`),
  ]

  await prisma.whitespaceHypothesis.update({
    where: { id: hypothesis.id },
    data: {
      type,
      status,
      scores: (scores as unknown) as Prisma.InputJsonValue,
      validation: (validation as unknown) as Prisma.InputJsonValue,
      coverageLimitations: coverageLimitations as unknown as Prisma.InputJsonValue,
    },
  })

  return { status, type, confidence: scores.confidence, attacksRun: validation.attacksRun }
}

// ---------------------------------------------------------------------------
// Attack retrieval
// ---------------------------------------------------------------------------

/**
 * Full-text attack over the whole readable corpus. Deliberately UNSCOPED: the
 * refuting art may live outside the study's years, jurisdictions and CPC codes,
 * and constraining the attack to the scope would be defending the hypothesis.
 */
async function lexicalAttack(query: string): Promise<AttackHit[]> {
  if (!query.trim()) return []
  try {
    const rows = await withTimeout<{
      familyKey: string
      publicationNumber: string
      title: string | null
      abstract: string | null
      claimsText: string | null
    }>(Prisma.sql`
      SELECT COALESCE(lp."familyId", lp."publicationNumber") AS "familyKey",
             lp."publicationNumber",
             lp."title",
             left(coalesce(lp."abstract", ''), 1500) AS abstract,
             left(coalesce(lp."claimsText", ''), 6000) AS "claimsText"
      FROM "local_patents" lp
      WHERE to_tsvector('english'::regconfig,
              coalesce(lp."ragText", '')   || ' ' ||
              coalesce(lp."title", '')     || ' ' ||
              coalesce(lp."abstract", '')  || ' ' ||
              coalesce(lp."abstractOriginal", ''))
            @@ websearch_to_tsquery('english'::regconfig, ${query})
        AND lp."corpusSources" @> ARRAY['google-patents-corpus']::TEXT[]
      LIMIT ${ATTACK_HIT_LIMIT}`)
    return rows.map(row => ({
      familyKey: row.familyKey,
      publicationNumber: row.publicationNumber,
      title: row.title || row.publicationNumber,
      abstract: row.abstract || null,
      claimsText: row.claimsText || null,
      strategy: 'SYNONYM_SHIFTED' as const,
    }))
  } catch (error) {
    console.error('[Whitespace] Lexical attack failed:', error instanceof Error ? error.message : error)
    return []
  }
}

/** CPC-adjacent broadening: same combination, classified by a different reader. */
async function cpcAttack(code: string, elements: string[]): Promise<AttackHit[]> {
  const normalized = code.replace(/\s+/g, '').toUpperCase()
  if (!normalized) return []
  const elementQuery = elements.map(element => `"${element.replace(/["\\]/g, ' ')}"`).join(' OR ')
  try {
    const rows = await withTimeout<{
      familyKey: string
      publicationNumber: string
      title: string | null
      abstract: string | null
      claimsText: string | null
    }>(Prisma.sql`
      SELECT COALESCE(lp."familyId", lp."publicationNumber") AS "familyKey",
             lp."publicationNumber",
             lp."title",
             left(coalesce(lp."abstract", ''), 1500) AS abstract,
             left(coalesce(lp."claimsText", ''), 6000) AS "claimsText"
      FROM "local_patents" lp
      WHERE EXISTS (SELECT 1 FROM unnest(lp."classifications") c WHERE replace(upper(c), ' ', '') LIKE ${normalized + '%'})
        AND to_tsvector('english'::regconfig,
              coalesce(lp."ragText", '') || ' ' || coalesce(lp."title", '') || ' ' || coalesce(lp."abstract", ''))
            @@ websearch_to_tsquery('english'::regconfig, ${elementQuery})
        AND lp."corpusSources" @> ARRAY['google-patents-corpus']::TEXT[]
      LIMIT ${ATTACK_HIT_LIMIT}`)
    return rows.map(row => ({ ...row, title: row.title || row.publicationNumber, strategy: 'CPC_ADJACENT' as const }))
  } catch (error) {
    console.error('[Whitespace] CPC attack failed:', error instanceof Error ? error.message : error)
    return []
  }
}

/** Assignee pivot: follow the people nearest the idea through their portfolios. */
async function assigneeAttack(assignee: string, elements: string[]): Promise<AttackHit[]> {
  if (!assignee.trim()) return []
  const elementQuery = elements.map(element => `"${element.replace(/["\\]/g, ' ')}"`).join(' OR ')
  try {
    const rows = await withTimeout<{
      familyKey: string
      publicationNumber: string
      title: string | null
      abstract: string | null
      claimsText: string | null
    }>(Prisma.sql`
      SELECT COALESCE(lp."familyId", lp."publicationNumber") AS "familyKey",
             lp."publicationNumber",
             lp."title",
             left(coalesce(lp."abstract", ''), 1500) AS abstract,
             left(coalesce(lp."claimsText", ''), 6000) AS "claimsText"
      FROM "local_patents" lp
      WHERE lp."applicants"::text ILIKE ${'%' + assignee.trim() + '%'}
        AND to_tsvector('english'::regconfig,
              coalesce(lp."ragText", '') || ' ' || coalesce(lp."title", '') || ' ' || coalesce(lp."abstract", ''))
            @@ websearch_to_tsquery('english'::regconfig, ${elementQuery})
      LIMIT ${ATTACK_HIT_LIMIT}`)
    return rows.map(row => ({ ...row, title: row.title || row.publicationNumber, strategy: 'ASSIGNEE_PIVOT' as const }))
  } catch (error) {
    console.error('[Whitespace] Assignee attack failed:', error instanceof Error ? error.message : error)
    return []
  }
}

function recordAttack(
  attacks: AttackRecord[],
  allHits: Map<string, AttackHit>,
  strategy: AttackRecord['strategy'],
  query: string,
  hits: AttackHit[]
) {
  // Outcome is provisional CLEAN until mapping says otherwise.
  attacks.push({ strategy, query, hits: hits.length, outcome: 'CLEAN' })
  for (const hit of hits) {
    if (!allHits.has(hit.familyKey)) allHits.set(hit.familyKey, { ...hit, strategy })
  }
}

async function enrichWithClaims(candidates: AttackHit[]) {
  const missing = candidates.filter(candidate => !candidate.claimsText).map(candidate => candidate.publicationNumber)
  if (missing.length) {
    const { fetchLocalPatentClaims, canonicalClaimsKey } = await import('@/lib/local-patent-claims-service')
    const claims = await fetchLocalPatentClaims(missing)
    for (const candidate of candidates) {
      if (!candidate.claimsText) {
        candidate.claimsText = claims.get(canonicalClaimsKey(candidate.publicationNumber)) ?? null
      }
    }
  }
  return candidates.map(candidate => ({
    publicationNumber: candidate.publicationNumber,
    title: candidate.title,
    abstract: candidate.abstract,
    claimsText: candidate.claimsText,
  }))
}

/** Re-labels each attack's outcome from the mapping verdicts of its hits. */
function applyMappingOutcomes(attacks: AttackRecord[], allHits: Map<string, AttackHit>, mapped: MappedCandidate[]) {
  const verdictByPublication = new Map(mapped.map(candidate => [candidate.publicationNumber, candidate.fullCombination]))
  for (const attack of attacks) {
    if (attack.outcome === 'NOT_RUN') continue
    let worst: 'CLEAN' | 'WEAKENING' | 'REFUTING' = 'CLEAN'
    for (const hit of Array.from(allHits.values())) {
      if (hit.strategy !== attack.strategy) continue
      const verdict = verdictByPublication.get(hit.publicationNumber)
      if (verdict === 'PRESENT') worst = 'REFUTING'
      else if (verdict === 'PARTIAL' && worst === 'CLEAN') worst = 'WEAKENING'
    }
    attack.outcome = worst
  }
}

function allHitTitle(allHits: Map<string, AttackHit>, publicationNumber: string): string {
  for (const hit of Array.from(allHits.values())) {
    if (hit.publicationNumber === publicationNumber) return hit.title
  }
  return publicationNumber
}

// ---------------------------------------------------------------------------
// Gates and scores
// ---------------------------------------------------------------------------

async function evaluateGates(input: {
  studyId: string
  clusterId: string | null
  attacks: AttackRecord[]
  fullRefutation: boolean
  partialCount: number
  redTeam: { feasibilityConcern?: string | null; commercialConcern?: string | null; regulatoryConcern?: string | null }
}): Promise<GateOutcome[]> {
  const gates: GateOutcome[] = []

  // G1 — data coverage: is the area readable at claim level?
  let claimsCoverage: number | null = null
  if (input.clusterId) {
    const area = await prisma.whitespaceAreaAnalysis.findFirst({
      where: { studyId: input.studyId, clusterId: input.clusterId },
    })
    const coverage = area?.textCoverage as Record<string, number> | null
    if (coverage && coverage.familiesTotal > 0) {
      claimsCoverage = coverage.withClaims / coverage.familiesTotal
    }
  }
  if (claimsCoverage === null) {
    gates.push({ gate: 'G1_DATA', outcome: 'FAILED', basis: 'No claim-level read of this area exists — run the deep dive first.' })
  } else if (claimsCoverage < 0.4) {
    gates.push({
      gate: 'G1_DATA',
      outcome: 'FAILED',
      basis: `Claims readable for ${Math.round(claimsCoverage * 100)}% of the area — below the 40% floor for claim-level conclusions.`,
    })
  } else {
    gates.push({ gate: 'G1_DATA', outcome: 'PASSED', basis: `${Math.round(claimsCoverage * 100)}% claims readable in the area.` })
  }

  // G2 — terminology: did vocabulary expansion surface dense material?
  const expansionAttacks = input.attacks.filter(
    attack => (attack.strategy === 'SYNONYM_SHIFTED' || attack.strategy === 'SEMANTIC_PARAPHRASE') && attack.outcome !== 'NOT_RUN'
  )
  const expansionRefuted = expansionAttacks.some(attack => attack.outcome === 'REFUTING')
  const expansionWeakened = expansionAttacks.some(attack => attack.outcome === 'WEAKENING')
  if (expansionRefuted) {
    gates.push({
      gate: 'G2_TERMINOLOGY',
      outcome: 'FAILED',
      basis: 'Vocabulary-shifted retrieval found the combination under words the scope did not use.',
    })
  } else if (expansionWeakened) {
    gates.push({
      gate: 'G2_TERMINOLOGY',
      outcome: 'PASSED_WITH_WEAKENING',
      basis: 'Expanded vocabulary found close-but-partial art; the gap narrows under other names.',
    })
  } else if (!expansionAttacks.length) {
    gates.push({ gate: 'G2_TERMINOLOGY', outcome: 'UNASSESSED', basis: 'No vocabulary-expansion attack could run.' })
  } else {
    gates.push({
      gate: 'G2_TERMINOLOGY',
      outcome: 'PASSED',
      basis: `${expansionAttacks.length} expanded searches ran; the combination stayed absent.`,
    })
  }

  // G3 — adjacent claims: already covered by broader claims elsewhere?
  if (input.fullRefutation) {
    gates.push({ gate: 'G3_ADJACENT_CLAIMS', outcome: 'FAILED', basis: 'A retrieved family maps PRESENT for the full combination.' })
  } else if (input.partialCount > 0) {
    gates.push({
      gate: 'G3_ADJACENT_CLAIMS',
      outcome: 'PASSED_WITH_WEAKENING',
      basis: `${input.partialCount} famil${input.partialCount === 1 ? 'y maps' : 'ies map'} PARTIAL against the combination.`,
    })
  } else {
    gates.push({ gate: 'G3_ADJACENT_CLAIMS', outcome: 'PASSED', basis: 'No retrieved family maps the full combination.' })
  }

  // G4 — feasibility. The evidence this gate wants (publication trend vs filing
  // trend, failure language) needs literature data this deployment lacks, so it
  // can pass only as UNASSESSED — which blocks GENUINE, deliberately.
  const literature = input.attacks.find(attack => attack.strategy === 'LITERATURE')
  if (literature?.outcome === 'NOT_RUN') {
    gates.push({
      gate: 'G4_FEASIBILITY',
      outcome: 'UNASSESSED',
      basis: input.redTeam.feasibilityConcern
        ? `No literature evidence available. Red team flags: ${input.redTeam.feasibilityConcern}`
        : 'No literature evidence available to test whether this was tried and abandoned.',
    })
  } else {
    gates.push({ gate: 'G4_FEASIBILITY', outcome: 'PASSED', basis: 'Literature evidence shows no rise-and-abandonment pattern.' })
  }

  // G5/G6 — advisory only; we have no market or regulatory data and say so.
  gates.push({
    gate: 'G5_COMMERCIAL',
    outcome: 'ADVISORY',
    basis: input.redTeam.commercialConcern ?? 'No market data available — unassessed.',
  })
  gates.push({
    gate: 'G6_REGULATORY',
    outcome: 'ADVISORY',
    basis: input.redTeam.regulatoryConcern ?? 'No regulatory data available — unassessed.',
  })

  return gates
}

function computeScores(input: {
  prior: HypothesisScores
  attacks: AttackRecord[]
  gates: GateOutcome[]
  fullRefutation: boolean
  partialCount: number
  clusterId: string | null
  studyId: string
}): HypothesisScores {
  const runnable = input.attacks.filter(attack => attack.outcome !== 'NOT_RUN')
  const planned = input.attacks.length
  const disproofCompleteness = planned > 0 ? runnable.length / planned : 0

  const g1 = input.gates.find(gate => gate.gate === 'G1_DATA')
  const textCoverage = g1?.outcome === 'PASSED' ? extractCoverage(g1.basis) : 0

  // Source diversity: how many independent kinds of evidence actually exist.
  const kinds = new Set<string>(['SEARCH_TRACE'])
  if (input.prior.rarity !== null) kinds.add('STATISTIC')
  if (input.partialCount > 0 || input.fullRefutation) kinds.add('PATENT_PASSAGE')
  const sourceDiversity = kinds.size / 3

  const evidenceQuality = 0.35 * textCoverage + 0.25 * sourceDiversity + 0.4 * disproofCompleteness

  // Survival starts at 0.5; each clean attack adds its share; weakening adds half.
  let survival = 0.5
  const share = planned > 0 ? 0.5 / planned : 0
  for (const attack of runnable) {
    if (attack.outcome === 'CLEAN') survival += share
    else if (attack.outcome === 'WEAKENING') survival += share / 2
  }
  survival = Math.min(1, survival)

  const semanticNovelty = input.prior.semanticNovelty
  const rarity = input.prior.rarity

  let confidence: number | null =
    0.4 * survival + 0.3 * evidenceQuality + 0.2 * (semanticNovelty ?? 0) + 0.1 * (rarity ?? 0)

  // Hard cap until every mandatory gate has actually passed.
  const mandatory = input.gates.filter(gate =>
    ['G1_DATA', 'G2_TERMINOLOGY', 'G3_ADJACENT_CLAIMS', 'G4_FEASIBILITY'].includes(gate.gate)
  )
  const allMandatoryPassed = mandatory.every(
    gate => gate.outcome === 'PASSED' || gate.outcome === 'PASSED_WITH_WEAKENING'
  )
  if (!allMandatoryPassed && confidence !== null) confidence = Math.min(confidence, 0.6)

  // The override: one solid refutation outweighs everything.
  if (input.fullRefutation) confidence = 0

  const crowdedness = input.prior.crowdedness
  const strength =
    input.fullRefutation || semanticNovelty === null || rarity === null
      ? input.fullRefutation
        ? 0
        : null
      : Math.pow(semanticNovelty, 0.3) *
        Math.pow(rarity, 0.25) *
        Math.pow(1 - (crowdedness ?? 0.5), 0.2) *
        Math.pow(evidenceQuality, 0.25)

  return {
    density: input.prior.density,
    rarity,
    semanticNovelty,
    evidenceQuality: round3(evidenceQuality),
    confidence: confidence === null ? null : round3(confidence),
    crowdedness,
    strength: strength === null ? null : round3(strength),
  }
}

function decideTypeAndStatus(input: {
  gates: GateOutcome[]
  fullRefutation: boolean
  confidence: number | null
}): { type: WhitespaceType; status: string } {
  if (input.fullRefutation) return { type: 'UNDETERMINED', status: 'REFUTED' }

  const gate = (name: GateOutcome['gate']) => input.gates.find(entry => entry.gate === name)

  // Strict ladder order: the first failing gate types the hypothesis and stops it.
  if (gate('G1_DATA')?.outcome === 'FAILED') return { type: 'DATA_WHITESPACE', status: 'INCONCLUSIVE' }
  if (gate('G2_TERMINOLOGY')?.outcome === 'FAILED') return { type: 'TERMINOLOGY_WHITESPACE', status: 'REFUTED' }

  const g3 = gate('G3_ADJACENT_CLAIMS')
  const g4 = gate('G4_FEASIBILITY')

  if (g3?.outcome === 'PASSED_WITH_WEAKENING') {
    // Partially covered: the attorney-relevant kind of candidate.
    return { type: 'CLAIM_WHITESPACE', status: 'VALIDATED' }
  }

  const mandatoryPassed =
    gate('G1_DATA')?.outcome === 'PASSED' &&
    (gate('G2_TERMINOLOGY')?.outcome === 'PASSED' || gate('G2_TERMINOLOGY')?.outcome === 'PASSED_WITH_WEAKENING') &&
    g3?.outcome === 'PASSED' &&
    g4?.outcome === 'PASSED'

  if (mandatoryPassed && (input.confidence ?? 0) >= 0.75) {
    return { type: 'GENUINE', status: 'VALIDATED' }
  }
  if (g4?.outcome === 'UNASSESSED') {
    // Survived everything we could run; feasibility unread. A candidate, not a verdict.
    return { type: 'PATENT_WHITESPACE', status: 'VALIDATED' }
  }
  return { type: 'PATENT_WHITESPACE', status: 'INCONCLUSIVE' }
}

// ---------------------------------------------------------------------------

function asStrings(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim())).slice(0, max)
}

function extractCoverage(basis: string): number {
  const match = basis.match(/(\d+)%/)
  return match ? Number(match[1]) / 100 : 0.5
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

async function withTimeout<T>(query: Prisma.Sql): Promise<T[]> {
  const [, rows] = await prisma.$transaction([
    prisma.$executeRaw`SELECT set_config('statement_timeout', ${String(SEARCH_TIMEOUT_MS)}, true)`,
    prisma.$queryRaw<T[]>(query),
  ])
  return rows
}

async function heartbeat(runId: string): Promise<void> {
  try {
    await prisma.whitespaceRun.update({ where: { id: runId }, data: { heartbeatAt: new Date() } })
  } catch {
    // Staleness detection only.
  }
}
