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

import { Prisma, TaskCode, type WhitespaceHypothesis } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { textMatchPredicate } from './field-map'
import { semanticLaneConfigured, semanticNeighbors } from './embedding'
import { STRATEGY_LABEL } from './labels'
import { runWhitespaceLLM, parseModelJson, type WhitespaceLLMContext } from './llm'
import { WhitespacePermanentError } from './run-lease'
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
import type { RunReporter } from './run-reporter'

const ATTACK_HIT_LIMIT = 25
/**
 * Candidates put to one element-mapping call. The call is a single batched
 * prompt (buildElementMappingPrompt caps each candidate at ~4KB of claims), so
 * 12 stays well inside budget while letting the round-robin below cover the top
 * hit of every attack even when all four strategies retrieved.
 */
const MAPPING_CANDIDATES = 12
const SEARCH_TIMEOUT_MS = 20_000

/** The steps this stage really takes, declared up front so the rail never guesses. */
const VALIDATE_STEPS = [
  { key: 'plan', label: 'Planning the attacks' },
  { key: 'attack', label: 'Running the attacks' },
  { key: 'map', label: 'Reading the closest hits against the hypothesis' },
  { key: 'redteam', label: 'Naming and running the strongest remaining attack' },
  { key: 'record', label: 'Recording the evidence' },
  { key: 'verdict', label: 'Applying the gates' },
]
const VALIDATE_COUNTERS = [
  { key: 'attacks', label: 'Attacks' },
  { key: 'hits', label: 'Families retrieved' },
  { key: 'mapped', label: 'Documents read' },
]

/** Exported for tests (candidate selection and mapping-outcome relabelling). */
export interface AttackHit {
  familyKey: string
  publicationNumber: string
  title: string
  abstract: string | null
  claimsText: string | null
  strategy: AttackRecord['strategy']
}

/**
 * An attack either ran (with however many hits) or it did not, and the reason
 * matters. A bare `AttackHit[] | null` collapsed "the database timed out" and
 * "the query contains no searchable words" into one message, and both of them
 * into the same bucket as "ran cleanly, found nothing" whenever the caller
 * forgot the distinction. Survival is scored off this type, so it is explicit.
 */
type AttackOutcome = { hits: AttackHit[] } | { hits: null; reason: string }

/**
 * Where an attack sits in the live narration: the reporter to tell and the
 * attack's place in the plan. The ordinal is carried rather than read off
 * `attacks.length`, which also holds the lane-unavailable and literature
 * records — and the red team's attack arrives after those.
 */
interface AttackNarration {
  reporter: RunReporter
  n: number
  total: number
}

/** Exported for tests. */
export interface MappedCandidate {
  publicationNumber: string
  basis: string
  fullCombination: 'PRESENT' | 'PARTIAL' | 'ABSENT'
  elements: Array<{ element: string; verdict: string; quote: string }>
}

interface ValidateStageInput {
  runId: string
  workerId: string
  reporter: RunReporter
  studyId: string
  hypothesisId: string
  scope: WhitespaceScope
  llmContext: WhitespaceLLMContext
}

export async function runValidateStage(
  input: ValidateStageInput
): Promise<{ status: string; type: WhitespaceType; confidence: number | null; attacksRun: number }> {
  const hypothesis = await prisma.whitespaceHypothesis.findUnique({ where: { id: input.hypothesisId } })
  if (!hypothesis || hypothesis.studyId !== input.studyId) {
    throw new WhitespacePermanentError('That hypothesis no longer exists.')
  }

  const priorStatus = hypothesis.status
  await prisma.whitespaceHypothesis.update({
    where: { id: hypothesis.id },
    data: { status: 'VALIDATING' },
  })

  // Any throw past this point used to leave the hypothesis stuck in VALIDATING —
  // the run-level failure handling lives elsewhere and never resets hypothesis
  // status. Put the prior status back before rethrowing; the error is unchanged.
  try {
    return await executeValidation(input, hypothesis)
  } catch (error) {
    try {
      await prisma.whitespaceHypothesis.update({ where: { id: hypothesis.id }, data: { status: priorStatus } })
    } catch (resetError) {
      console.error('[Whitespace] Could not reset hypothesis status after a failed validation:', resetError)
    }
    throw error
  }
}

async function executeValidation(
  input: ValidateStageInput,
  hypothesis: WhitespaceHypothesis
): Promise<{ status: string; type: WhitespaceType; confidence: number | null; attacksRun: number }> {
  const combination = (hypothesis.elementCombination ?? {}) as Record<string, unknown>
  const elements = Array.isArray(combination.elements)
    ? (combination.elements as unknown[]).filter((element): element is string => typeof element === 'string')
    : []
  const searchTerms = Array.isArray(combination.searchTerms)
    ? (combination.searchTerms as unknown[]).filter((term): term is string => typeof term === 'string')
    : []
  if (!elements.length) {
    throw new WhitespacePermanentError('This hypothesis carries no element combination to test.')
  }

  const reporter = input.reporter
  await reporter.plan(VALIDATE_STEPS, VALIDATE_COUNTERS)

  const attacks: AttackRecord[] = []
  const allHits = new Map<string, AttackHit>()
  const hitFamiliesByAttack = new Map<string, Set<string>>()

  // --- 1. compile the attack plan -------------------------------------------
  await reporter.step('plan', `Planning attacks against ${elements.length} elements`)
  const cpcInScope = input.scope.classifications.filter(c => c.accepted).map(c => c.code)
  let plan: { synonymShifted: string[]; semanticParaphrases: string[]; cpcAdjacent: string[]; assigneeCandidates: string[] }
  // Narrated outside the try: a lost lease must surface, not read as a failed plan.
  reporter.event('model', `Writing disproof queries against ${elements.length} elements`)
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
      context: input.llmContext,
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
    reporter.event('note', 'Using the hypothesis’s own search terms')
    console.error('[Whitespace] Disproof query generation failed; using fallback queries:', error)
  }

  // The semantic lane is a deployment fact, not a per-query one: when it is off,
  // every paraphrase collapses into one record that could not run, and the plan
  // is counted the way the evidence trail will record it.
  const semanticConfigured = semanticLaneConfigured()
  const meaningAttacks = semanticConfigured ? plan.semanticParaphrases.length : 1
  const attackTotal = plan.synonymShifted.length + meaningAttacks + plan.cpcAdjacent.length + plan.assigneeCandidates.length
  reporter.count('attacks', 0, attackTotal)
  reporter.event(
    'count',
    `${attackTotal} attacks planned: ${plan.synonymShifted.length} vocabulary, ${meaningAttacks} meaning, ${plan.cpcAdjacent.length} adjacent-class, ${plan.assigneeCandidates.length} portfolio`
  )

  await reporter.heartbeat()

  // --- 2. run the four attack strategies ------------------------------------
  // Each attack is announced before its search runs — the panel names the
  // attack in flight, not the one just finished — and recorded after it.
  let attackOrdinal = 0
  const runAttack = async (
    strategy: AttackRecord['strategy'],
    query: string,
    search: () => Promise<AttackOutcome>
  ): Promise<void> => {
    const n = ++attackOrdinal
    await reporter.step('attack', `${strategyLabel(strategy)}, attack ${n} of ${attackTotal}`, { n, total: attackTotal })
    recordAttack(attacks, allHits, hitFamiliesByAttack, strategy, query, await search(), { reporter, n, total: attackTotal })
  }

  for (const query of plan.synonymShifted) {
    await runAttack('SYNONYM_SHIFTED', query, () => lexicalAttack(query))
  }

  if (semanticConfigured) {
    for (const paraphrase of plan.semanticParaphrases) {
      await runAttack('SEMANTIC_PARAPHRASE', paraphrase, async () => {
        const result = await semanticNeighbors({ queryText: paraphrase, limit: ATTACK_HIT_LIMIT })
        if (!result.available) return { hits: null, reason: result.reason }
        const hits: AttackHit[] = result.neighbors.map(neighbor => ({
          familyKey: neighbor.familyKey,
          publicationNumber: neighbor.publicationNumber,
          title: neighbor.title || neighbor.publicationNumber,
          abstract: neighbor.abstract,
          claimsText: null,
          strategy: 'SEMANTIC_PARAPHRASE',
        }))
        return { hits }
      })
    }
  } else {
    await runAttack('SEMANTIC_PARAPHRASE', plan.semanticParaphrases.join(' | ') || hypothesis.statement, async () => ({
      hits: null,
      reason: 'Semantic lane not configured — paraphrase attacks were not run.',
    }))
  }

  for (const code of plan.cpcAdjacent) {
    await runAttack('CPC_ADJACENT', code, () => cpcAttack(code, elements))
  }

  for (const assignee of plan.assigneeCandidates) {
    await runAttack('ASSIGNEE_PIVOT', assignee, () => assigneeAttack(assignee, elements))
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
  reporter.event('note', 'Literature search not available in this corpus')

  await reporter.heartbeat()

  // --- 3. element-map the closest hits --------------------------------------
  // Publication numbers the model invented or garbled, dropped rather than
  // trusted. Counted so the run can say the mapping was incomplete.
  let unmatchedMappings = 0
  // Verdicts whose fullCombination was missing or unrecognisable, likewise
  // dropped and counted — never coerced to ABSENT, which is the survival
  // direction and exactly the fail-open this stage exists to prevent.
  let malformedMappings = 0

  /** Null when the mapping call itself failed — distinct from "read, nothing usable". */
  const mapCandidates = async (candidates: AttackHit[]): Promise<MappedCandidate[] | null> => {
    if (!candidates.length) return []
    const enriched = await enrichWithClaims(candidates)
    reporter.event('model', `Comparing ${enriched.length} documents against the hypothesis`)
    const accepted: MappedCandidate[] = []
    try {
      const response = await runWhitespaceLLM({
        taskCode: TaskCode.WS_VALIDATE,
        stageCode: WS_VALIDATE_STAGE_CODE,
        prompt: buildElementMappingPrompt({
          statement: hypothesis.statement,
          elements,
          candidates: enriched,
        }),
        context: input.llmContext,
      })
      const parsed = parseModelJson<{ candidates: MappedCandidate[] }>(response.output, 'Element mapping')

      // Every verdict must name a document that was actually put to the model.
      // applyMappingOutcomes re-labels attacks by matching these publication
      // numbers against the retrieved hits, so a number the model reformatted
      // ("US 9,123,456 B2" for "US9123456B2") or invented outright matched
      // nothing and left its attack recorded CLEAN — a REFUTING verdict silently
      // downgraded to survival. Normalised comparison against the candidate set
      // closes that; anything still unmatched is counted, not guessed at.
      const byNormalised = new Map(enriched.map(entry => [normalisePublicationNumber(entry.publicationNumber), entry.publicationNumber]))
      for (const candidate of parsed.candidates ?? []) {
        if (!candidate || typeof candidate.publicationNumber !== 'string') continue
        const resolved = byNormalised.get(normalisePublicationNumber(candidate.publicationNumber))
        if (!resolved) {
          unmatchedMappings++
          console.warn(
            `[Whitespace] Element mapping named a document that was not in the candidate set: ${candidate.publicationNumber}`
          )
          continue
        }
        // The verdict object is unvalidated model JSON. A missing `elements`
        // array threw mid-persist — AFTER status was set VALIDATING, leaving
        // the hypothesis stuck — and an uncased "Present" failed the strict
        // === 'PRESENT' checks downstream, silently reading as ABSENT.
        const verdict =
          typeof candidate.fullCombination === 'string' ? candidate.fullCombination.trim().toUpperCase() : ''
        if (verdict !== 'PRESENT' && verdict !== 'PARTIAL' && verdict !== 'ABSENT') {
          malformedMappings++
          console.warn(`[Whitespace] Element mapping returned no usable verdict for ${resolved}; discarded.`)
          continue
        }
        accepted.push({
          ...candidate,
          publicationNumber: resolved,
          fullCombination: verdict,
          elements: Array.isArray(candidate.elements)
            ? candidate.elements.filter((entry): entry is MappedCandidate['elements'][number] =>
                Boolean(entry) && typeof entry === 'object'
              )
            : [],
        })
      }
    } catch (error) {
      console.error('[Whitespace] Element mapping failed:', error)
      return null
    }
    // Narrated outside the try: a lost lease must surface, not read as a failed mapping.
    for (const candidate of accepted) reporter.event('read', `Read ${candidate.publicationNumber} in full`)
    return accepted
  }

  const primaryCandidates = selectMappingCandidates(hitFamiliesByAttack, allHits, MAPPING_CANDIDATES)
  let mapped: MappedCandidate[] = []
  if (primaryCandidates.length) {
    await reporter.step('map', `Reading ${primaryCandidates.length} closest documents in full`)
    const primaryMapped = await mapCandidates(primaryCandidates)
    if (primaryMapped === null) await reporter.fail('map', 'the closest hits could not be read')
    else mapped = primaryMapped
  } else {
    await reporter.skip('map', 'nothing retrieved to read')
  }
  reporter.count('mapped', mapped.length)

  applyMappingOutcomes(attacks, hitFamiliesByAttack, allHits, mapped)

  // --- 4. red team names and executes the strongest remaining attack --------
  await reporter.step('redteam', 'Naming the strongest remaining attack')
  let redTeam: {
    strongestRemainingAttack?: { description?: string; query?: string | null } | null
    feasibilityConcern?: string | null
    commercialConcern?: string | null
    regulatoryConcern?: string | null
    verdict?: string
    verdictReason?: string
  } = {}
  let redTeamFailed = false
  reporter.event('model', `Reviewing ${attacks.length} attacks for the strongest one still untried`)
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
      context: input.llmContext,
    })
    redTeam = parseModelJson(response.output, 'Red team')
  } catch (error) {
    redTeamFailed = true
    console.error('[Whitespace] Red team pass failed:', error)
  }

  if (redTeamFailed) {
    await reporter.skip('redteam', 'the red team pass failed')
  } else if (!redTeam.strongestRemainingAttack?.query) {
    await reporter.skip('redteam', 'the red team named no further attack')
  } else {
    const query = String(redTeam.strongestRemainingAttack.query)
    const previouslySeen = new Set(Array.from(allHits.keys()))
    reporter.detail('Running the red team’s attack')
    const attempt = await lexicalAttack(query)
    // One more attack than the plan counted — the counter grows with it.
    recordAttack(attacks, allHits, hitFamiliesByAttack, 'RED_TEAM', query, attempt, {
      reporter,
      n: attackTotal + 1,
      total: attackTotal + 1,
    })

    // The red team's hits get the same element mapping as everyone else's.
    // Without this, the strongest remaining attack could retrieve 25 documents
    // and still be recorded CLEAN because nothing ever read them.
    const fresh = (attempt.hits ?? []).filter(hit => !previouslySeen.has(hit.familyKey)).slice(0, MAPPING_CANDIDATES)
    if (fresh.length) {
      reporter.detail(`Reading ${fresh.length} new documents the red team retrieved`)
      const alreadyMapped = new Set(mapped.map(candidate => candidate.publicationNumber))
      const redTeamMapped = await mapCandidates(fresh)
      if (redTeamMapped === null) {
        reporter.event('note', 'The red team’s hits could not be read')
      } else {
        const additions = redTeamMapped.filter(candidate => !alreadyMapped.has(candidate.publicationNumber))
        if (additions.length) {
          mapped = [...mapped, ...additions]
          reporter.count('mapped', mapped.length)
        }
      }
    }
    // Re-labelled unconditionally, not only when fresh hits mapped: the red-team
    // attack itself must be judged against the verdicts that already exist (its
    // hits are often families the primary mapping read), and if nothing of its
    // retrieval was read it gets the unread treatment like every other attack.
    applyMappingOutcomes(attacks, hitFamiliesByAttack, allHits, mapped)
  }

  await reporter.heartbeat()

  // --- 5. persist the evidence trail ----------------------------------------
  await reporter.step('record', `Recording ${attacks.length} search traces`)
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
  await reporter.step('verdict', 'Applying the gates')
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
    prior: priorScoresOf(hypothesis.scores),
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
  if (unmatchedMappings > 0) {
    coverageLimitations.push(
      `${unmatchedMappings} element-mapping verdict${unmatchedMappings === 1 ? '' : 's'} named a document that was not among the retrieved candidates and ${
        unmatchedMappings === 1 ? 'was' : 'were'
      } discarded — the closest art may not be fully read.`
    )
  }
  if (malformedMappings > 0) {
    coverageLimitations.push(
      `${malformedMappings} element-mapping verdict${malformedMappings === 1 ? '' : 's'} came back without a usable full-combination judgment and ${
        malformedMappings === 1 ? 'was' : 'were'
      } discarded — the closest art may not be fully read.`
    )
  }

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

  reporter.done()
  return { status, type, confidence: scores.confidence, attacksRun: validation.attacksRun }
}

// ---------------------------------------------------------------------------
// Attack retrieval
// ---------------------------------------------------------------------------

/** Text-arm predicate for a single freeform websearch query, all readable corpora. */
function attackTextPredicate(query: string): Prisma.Sql {
  // One required group, no optional ones: never null.
  return textMatchPredicate({ required: [query], optional: [], minimumOptional: 0, groupLabels: [[]], exclusions: null })!
}

/**
 * Rejects an attack query that survives no words at all.
 *
 * `websearch_to_tsquery` returns an EMPTY tsquery for a string made only of
 * stopwords or punctuation, and an empty tsquery matches zero rows under `@@`.
 * So a degenerate model-written query ("a system for the same", "-----") came
 * back with zero hits and was recorded CLEAN — a search that could not possibly
 * have found anything, counted as evidence that nothing is there. Every attack
 * lane runs this first, for the same reason the census runs
 * assertConceptQueryUsable: a query that cannot match must never be mistaken
 * for a query that found nothing.
 */
async function tsqueryHasTerms(query: string): Promise<boolean> {
  try {
    const rows = await prisma.$queryRaw<Array<{ nodes: number }>>(
      Prisma.sql`SELECT numnode(websearch_to_tsquery('english'::regconfig, ${query}))::int AS nodes`
    )
    return Number(rows[0]?.nodes ?? 0) > 0
  } catch (error) {
    console.error('[Whitespace] Attack query check failed:', error instanceof Error ? error.message : error)
    return false
  }
}

const NO_SEARCHABLE_WORDS =
  'The query contained no searchable words after common-word removal, so it could not have matched anything — recorded as not run rather than as a clean attack.'

/**
 * LIKE/ILIKE wildcards in model-written strings made literal. The values are
 * parameterised (injection-safe), but a stray % or _ in a CPC code or assignee
 * name silently broadened the attack's scope — wrong retrieval, not a breach.
 */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}

/**
 * Full-text attack over the whole readable corpus. Deliberately UNSCOPED: the
 * refuting art may live outside the study's years, jurisdictions and CPC codes,
 * and constraining the attack to the scope would be defending the hypothesis.
 *
 * Reports `hits: null` when the search could not run — a failed or impossible
 * search is not an empty result, and recording it as one would count a dead
 * lane as a clean attack.
 */
async function lexicalAttack(query: string): Promise<AttackOutcome> {
  if (!query.trim()) return { hits: null, reason: 'The attack query was empty.' }
  if (!(await tsqueryHasTerms(query))) return { hits: null, reason: NO_SEARCHABLE_WORDS }
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
      WHERE ${attackTextPredicate(query)}
      LIMIT ${ATTACK_HIT_LIMIT}`)
    return {
      hits: rows.map(row => ({
        familyKey: row.familyKey,
        publicationNumber: row.publicationNumber,
        title: row.title || row.publicationNumber,
        abstract: row.abstract || null,
        claimsText: row.claimsText || null,
        strategy: 'SYNONYM_SHIFTED' as const,
      })),
    }
  } catch (error) {
    console.error('[Whitespace] Lexical attack failed:', error instanceof Error ? error.message : error)
    return { hits: null, reason: 'The search failed or timed out.' }
  }
}

/** CPC-adjacent broadening: same combination, classified by a different reader. */
async function cpcAttack(code: string, elements: string[]): Promise<AttackOutcome> {
  const normalized = code.replace(/\s+/g, '').toUpperCase()
  if (!normalized) return { hits: null, reason: 'The CPC code was empty.' }
  const elementQuery = elements.map(element => `"${element.replace(/["\\]/g, ' ')}"`).join(' OR ')
  if (!(await tsqueryHasTerms(elementQuery))) return { hits: null, reason: NO_SEARCHABLE_WORDS }
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
      WHERE EXISTS (SELECT 1 FROM unnest(lp."classifications") c WHERE replace(upper(c), ' ', '') LIKE ${escapeLikePattern(normalized) + '%'})
        AND ${attackTextPredicate(elementQuery)}
      LIMIT ${ATTACK_HIT_LIMIT}`)
    return {
      hits: rows.map(row => ({
        ...row,
        title: row.title || row.publicationNumber,
        strategy: 'CPC_ADJACENT' as const,
      })),
    }
  } catch (error) {
    console.error('[Whitespace] CPC attack failed:', error instanceof Error ? error.message : error)
    return { hits: null, reason: 'The search failed or timed out.' }
  }
}

/** Assignee pivot: follow the people nearest the idea through their portfolios. */
async function assigneeAttack(assignee: string, elements: string[]): Promise<AttackOutcome> {
  if (!assignee.trim()) return { hits: null, reason: 'The assignee name was empty.' }
  const elementQuery = elements.map(element => `"${element.replace(/["\\]/g, ' ')}"`).join(' OR ')
  if (!(await tsqueryHasTerms(elementQuery))) return { hits: null, reason: NO_SEARCHABLE_WORDS }
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
      WHERE lp."applicants"::text ILIKE ${'%' + escapeLikePattern(assignee.trim()) + '%'}
        AND ${attackTextPredicate(elementQuery)}
      LIMIT ${ATTACK_HIT_LIMIT}`)
    return {
      hits: rows.map(row => ({
        ...row,
        title: row.title || row.publicationNumber,
        strategy: 'ASSIGNEE_PIVOT' as const,
      })),
    }
  } catch (error) {
    console.error('[Whitespace] Assignee attack failed:', error instanceof Error ? error.message : error)
    return { hits: null, reason: 'The search failed or timed out.' }
  }
}

/** The reader-facing strategy name; never the model-written query. */
function strategyLabel(strategy: AttackRecord['strategy']): string {
  return STRATEGY_LABEL[strategy] ?? strategy
}

function recordAttack(
  attacks: AttackRecord[],
  allHits: Map<string, AttackHit>,
  hitFamiliesByAttack: Map<string, Set<string>>,
  strategy: AttackRecord['strategy'],
  query: string,
  outcome: AttackOutcome,
  narration?: AttackNarration
) {
  if (outcome.hits === null) {
    // A search that could not run is recorded as NOT_RUN — it lowers disproof
    // completeness instead of masquerading as a clean attack.
    attacks.push({ strategy, query, hits: 0, outcome: 'NOT_RUN', reason: outcome.reason })
  } else {
    const hits = outcome.hits
    // Outcome is provisional CLEAN until mapping says otherwise.
    attacks.push({ strategy, query, hits: hits.length, outcome: 'CLEAN' })
    const attackKey = keyForAttack(strategy, query)
    const families = hitFamiliesByAttack.get(attackKey) ?? new Set<string>()
    for (const hit of hits) {
      families.add(hit.familyKey)
      if (!allHits.has(hit.familyKey)) allHits.set(hit.familyKey, { ...hit, strategy })
    }
    hitFamiliesByAttack.set(attackKey, families)
  }

  if (!narration) return
  // One line per attack: strategy, place in the plan, hit count. Never the
  // query — it is model-written text — and never a verdict.
  const { reporter, n, total } = narration
  const result =
    outcome.hits === null ? 'could not run' : `${outcome.hits.length} hit${outcome.hits.length === 1 ? '' : 's'}`
  reporter.event('attack', `${strategyLabel(strategy)}, attack ${n} of ${total} — ${result}`)
  reporter.count('attacks', n, total)
  reporter.count('hits', allHits.size)
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

/**
 * Mapping candidates drawn round-robin across attacks — the top hit of each
 * attack, then the second of each, and so on, up to the limit. The previous
 * rule ("first N of allHits in insertion order") was an ORDER-BY-less slice of
 * the FIRST lexical attack's LIMIT 25: semantic, CPC and assignee hits were
 * essentially never element-mapped, applyMappingOutcomes left those attacks
 * CLEAN, and a VALIDATED verdict could issue with ~95% of retrieved art unread
 * — the exact failure mode the red-team lane names for itself, live on every
 * primary lane. Exported for tests.
 */
export function selectMappingCandidates(
  hitFamiliesByAttack: Map<string, Set<string>>,
  allHits: Map<string, AttackHit>,
  limit: number
): AttackHit[] {
  const perAttack = Array.from(hitFamiliesByAttack.values()).map(families => Array.from(families))
  const chosen: AttackHit[] = []
  const seen = new Set<string>()
  for (let depth = 0; chosen.length < limit; depth++) {
    let anyLeft = false
    for (const families of perAttack) {
      if (depth >= families.length) continue
      anyLeft = true
      const familyKey = families[depth]
      if (seen.has(familyKey)) continue
      seen.add(familyKey)
      const hit = allHits.get(familyKey)
      if (hit) {
        chosen.push(hit)
        if (chosen.length >= limit) break
      }
    }
    if (!anyLeft) break
  }
  return chosen
}

/**
 * Re-labels each attack's outcome from the mapping verdicts of its hits.
 *
 * An attack that retrieved hits of which NONE was element-mapped is re-labelled
 * NOT_RUN with the reason recorded: leaving it CLEAN would count unread
 * retrieval as survival. NOT_RUN is what the ladder already treats as "could
 * not be completed" — it lowers disproofCompleteness, earns no survival share,
 * and G2 will not count it as vocabulary tested. Exported for tests.
 */
export function applyMappingOutcomes(
  attacks: AttackRecord[],
  hitFamiliesByAttack: Map<string, Set<string>>,
  allHits: Map<string, AttackHit>,
  mapped: MappedCandidate[]
) {
  const verdictByPublication = new Map(mapped.map(candidate => [candidate.publicationNumber, candidate.fullCombination]))
  for (const attack of attacks) {
    if (attack.outcome === 'NOT_RUN') continue
    let worst: 'CLEAN' | 'WEAKENING' | 'REFUTING' = 'CLEAN'
    let anyRead = false
    const hitFamilies = hitFamiliesByAttack.get(keyForAttack(attack.strategy, attack.query)) ?? new Set<string>()
    for (const familyKey of Array.from(hitFamilies)) {
      const hit = allHits.get(familyKey)
      if (!hit) continue
      const verdict = verdictByPublication.get(hit.publicationNumber)
      if (!verdict) continue
      anyRead = true
      if (verdict === 'PRESENT') worst = 'REFUTING'
      else if (verdict === 'PARTIAL' && worst === 'CLEAN') worst = 'WEAKENING'
    }
    if (attack.hits > 0 && !anyRead) {
      attack.outcome = 'NOT_RUN'
      attack.reason = `retrieved ${attack.hits} document${
        attack.hits === 1 ? '' : 's'
      } but none was element-mapped — its art is unread, so the attack counts as not completed rather than as clean.`
      continue
    }
    attack.outcome = worst
  }
}

function keyForAttack(strategy: AttackRecord['strategy'], query: string): string {
  return `${strategy}\u0000${query}`
}

/** Publication numbers for comparison only: case, spaces, commas and hyphens dropped. */
function normalisePublicationNumber(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '')
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
    gates.push({
      gate: 'G1_DATA',
      outcome: 'FAILED',
      basis: 'No claim-level read of this area exists — run the deep dive first.',
      measured: null,
    })
  } else if (claimsCoverage < 0.4) {
    gates.push({
      gate: 'G1_DATA',
      outcome: 'FAILED',
      basis: `Claims readable for ${Math.round(claimsCoverage * 100)}% of the area — below the 40% floor for claim-level conclusions.`,
      measured: claimsCoverage,
    })
  } else {
    gates.push({
      gate: 'G1_DATA',
      outcome: 'PASSED',
      basis: `${Math.round(claimsCoverage * 100)}% claims readable in the area.`,
      measured: claimsCoverage,
    })
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

/**
 * The prior score vector, read defensively. The schema says `scores` is always
 * the full vector, but a null or legacy row threw mid-stage on the first field
 * access. Every missing or non-numeric field defaults to null — the vector's
 * own "unmeasured" value, which every downstream formula already handles —
 * rather than to a fabricated measurement of 0.
 */
function priorScoresOf(value: unknown): HypothesisScores {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const num = (key: string): number | null => (typeof raw[key] === 'number' ? (raw[key] as number) : null)
  return {
    density: num('density'),
    rarity: num('rarity'),
    semanticNovelty: num('semanticNovelty'),
    evidenceQuality: num('evidenceQuality'),
    confidence: num('confidence'),
    crowdedness: num('crowdedness'),
    strength: num('strength'),
  }
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
  const textCoverage = g1?.outcome === 'PASSED' ? (g1.measured ?? 0) : 0

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

/** Exported for tests: the gate ladder is the product's central epistemic claim. */
export function decideTypeAndStatus(input: {
  gates: GateOutcome[]
  fullRefutation: boolean
  confidence: number | null
}): { type: WhitespaceType; status: string } {
  if (input.fullRefutation) return { type: 'UNDETERMINED', status: 'REFUTED' }

  const gate = (name: GateOutcome['gate']) => input.gates.find(entry => entry.gate === name)

  // Strict ladder order: the first failing gate types the hypothesis and stops it.
  if (gate('G1_DATA')?.outcome === 'FAILED') return { type: 'DATA_WHITESPACE', status: 'INCONCLUSIVE' }
  if (gate('G2_TERMINOLOGY')?.outcome === 'FAILED') return { type: 'TERMINOLOGY_WHITESPACE', status: 'REFUTED' }

  const g2 = gate('G2_TERMINOLOGY')
  const g3 = gate('G3_ADJACENT_CLAIMS')
  const g4 = gate('G4_FEASIBILITY')

  // A vocabulary attack that could not run is not a vocabulary attack survived.
  // This module's own contract is that absence of a disproof search lowers
  // confidence rather than counting as survival, and G2 UNASSESSED means exactly
  // that: no synonym-shifted or paraphrase search reached the corpus. Every
  // VALIDATED verdict below therefore requires G2 to have actually run.
  const terminologyTested = g2?.outcome === 'PASSED' || g2?.outcome === 'PASSED_WITH_WEAKENING'

  if (g3?.outcome === 'PASSED_WITH_WEAKENING') {
    // Partially covered: the attorney-relevant kind of candidate.
    return { type: 'CLAIM_WHITESPACE', status: terminologyTested ? 'VALIDATED' : 'INCONCLUSIVE' }
  }

  const mandatoryPassed =
    gate('G1_DATA')?.outcome === 'PASSED' && terminologyTested && g3?.outcome === 'PASSED' && g4?.outcome === 'PASSED'

  if (mandatoryPassed && (input.confidence ?? 0) >= 0.75) {
    return { type: 'GENUINE', status: 'VALIDATED' }
  }
  if (g4?.outcome === 'UNASSESSED' && terminologyTested) {
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
