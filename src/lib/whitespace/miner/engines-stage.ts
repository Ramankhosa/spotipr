/**
 * Invention Miner — stage 2, the engines.
 *
 * Turns the statements the harvest indexed into ranked `invention_leads`. The
 * harvest decided what we READ; this stage decides what the user is SHOWN, and
 * a user shown a plausible lead does not audit its denominators — so the
 * honesty rules here matter more than the yield.
 *
 * THE CONTRACT, in the order the failures actually happen:
 *
 *  1. A THIN HARVEST IS A FAILURE, NOT A CAVEAT. A provider outage during the
 *     harvest leaves a technically-successful reading of almost nothing. Every
 *     engine is a ratio over that reading, so its leads would carry denominators
 *     that read as "this field is quiet" rather than "we did not read it". Below
 *     a 60% extraction coverage floor every engine is SKIPPED with the reason
 *     and the stage completes with zero leads and an explicit note — never
 *     silently, and never with a lead.
 *
 *  2. THE FIELD IS A JOIN, NOT A CPC GUESS. Everything counted here joins
 *     `miner_field_publications` for this study AND this scope fingerprint. A
 *     statement is "inside the field" because the census predicate put it there,
 *     never because its classification looks right.
 *
 *  3. ABSENCE IS ALWAYS MEASURED, AND ALWAYS CARRIES ITS DENOMINATOR. Every
 *     absence claim on a lead names the families searched, the field size and
 *     the text tier, in the fixed wording of `absenceSentence` — "no mechanism
 *     in the readable text of these families is directed at X", never
 *     "unsolved", never "no patent does X". An exclusion that could not be
 *     measured is recorded as unmeasured, never as a pass.
 *
 *  4. BOILERPLATE IS DROPPED, AND THE DROP IS SHOWN. Genre conventions
 *     maximise every ranking factor at once, so they are excluded by two hard
 *     tests rather than penalised — and both the finding and the exclusion
 *     reason are reported, so the user sees what was found as well as what was
 *     shown.
 *
 *  5. NARRATION SAYS WHAT WAS DONE, NEVER WHAT WAS FOUND. "N problem statements
 *     read" is work. "Grouped into M problems" is a FINDING — it is the answer
 *     to "how many distinct problems does this field have" — and findings, lead
 *     titles and scores appear when the run completes, not while it runs.
 *
 *  6. THERE IS NO COMPOSITE SCORE. `scores.demand` is measured; every other
 *     score is null until the gate measures it. A product of buckets reads as a
 *     probability this system cannot support (see the InventionLead doc
 *     comment), and no arithmetic here produces one.
 */

import { Prisma, TaskCode } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { WhitespacePermanentError } from '../run-lease'
import { isStatementTimeout } from '../field-map'
import { semanticNeighbors } from '../embedding'
import { normalizeElement } from '../deep-dive-stage'
import { studyKindOf, type LabelledCount, type WhitespaceScope } from '../types'
import type { RunReporter } from '../run-reporter'
import type { WhitespaceLLMContext } from '../llm'
import { parseModelJson } from '../llm'
import { checkMinerIndexConfig } from './index-config'
import { scopeFingerprint } from './scope-fingerprint'
import { describeTierMix, TIER_RANK, type TextTier } from './text-tiers'
import {
  statementColumnSql,
  statementDistanceSql,
  statementIndexSettingsSql,
  statementRawDistanceSql,
} from './vector-sql'
import {
  assertMinerStagesConfigured,
  MINER_EXTRACT_STAGE_CODE,
  MINER_LEAD_TITLES_STAGE_CODE,
  runMinerLLM,
} from './llm'
import { buildLeadTitlePrompt, MAX_LEAD_TITLE_CHARS } from './prompts'
import { runMiniHarvest, statementTextHash, cpcSubclassPrefixes, type MinerHarvestResult } from './harvest-stage'
import {
  bimodalityNote,
  componentBimodality,
  connectedComponents,
  nearestNeighbourCut,
  oneNearestDistances,
  type Component,
  type StatementEdge,
} from './engines/clustering'
import {
  absenceSentence,
  checkExclusions,
  keyTerms,
  problemHeadNoun,
  rankUnsolved,
  summariseAddressing,
  type AddressingCandidate,
} from './engines/unsolved'
import { describeRate, wilsonInterval } from './engines/wilson'
import {
  eligibleFamilies,
  frontierPairs,
  FRONTIER_BADGE,
  jaccard,
  MIN_FRONTIER_GROUP_FAMILIES,
  MIN_NARROWINGS_PER_FAMILY,
  NO_GROUP_SKIP,
  NO_NARROWINGS_SKIP,
  type FrontierFamily,
} from './engines/frontier'
import {
  DEMAND_WINDOW_YEARS,
  EXPIRY_HORIZON_YEARS,
  expiryCoverageLines,
  groupByExpiry,
  publishableExpiryGroups,
  type ExpiryFamily,
} from './engines/expiry'
import {
  enablingCondition,
  gateTransferCandidate,
  MIN_READABLE_FIELD_SHARE,
  MINI_HARVEST_CAP,
  NEIGHBOUR_LIMIT,
  NO_SUBCLASS_SKIP,
  readableShareSkip,
  resolveFieldSubclasses,
  sharesFieldSubclass,
  TRANSFER_COMPONENTS,
} from './engines/transfer'
import { createHash } from 'node:crypto'

// ---------------------------------------------------------------------------
// Budgets and floors — every one is a real limit, and every guessed one says so
// ---------------------------------------------------------------------------

/**
 * The share of the chosen sample the harvest must actually have read.
 *
 * Below this the engines do not run. See contract rule 1: the alternative is a
 * COMPLETED run whose leads are arithmetic over a provider outage, and whose
 * denominators an attorney reads as a fact about the technology.
 */
export const MIN_EXTRACTION_COVERAGE = clampFraction(process.env.WHITESPACE_MINER_MIN_COVERAGE, 0.6)

/** Neighbours per node in the problem graph. */
export const GRAPH_K = 8

/**
 * Statements the k-NN graph may hold.
 *
 * The graph is an EXACT all-pairs scan inside the node set (the statement table
 * is deliberately left unindexed until there are enough rows to place IVFFlat
 * centroids — see the migration), so this is a quadratic budget: 4,000 nodes is
 * 16M distance computations, which is seconds on bit(512) and around a minute
 * on vector(1536). A GUESSED THRESHOLD — the first live run should measure the
 * graph query's wall time and this should be tuned to it.
 */
const GRAPH_STATEMENT_CAP = Math.max(200, Number(process.env.WHITESPACE_MINER_GRAPH_CAP) || 4_000)

/** Ceiling on the graph query. Past it the stage refuses rather than guessing a cut. */
const GRAPH_TIMEOUT_MS = Math.max(30_000, Number(process.env.WHITESPACE_MINER_GRAPH_TIMEOUT_MS) || 180_000)

/** Ceiling on the per-family nearest-mechanism pass and the term counts. */
const ENGINE_TIMEOUT_MS = 90_000

/**
 * Readable field publications the whole-field term count reads.
 *
 * The count materialises a tsvector per row, which detoasts descriptions, so it
 * is bounded rather than unbounded-exact. Under the cap it IS exact over the
 * whole field; over it, the count is over a random subset of that size and the
 * denominator on every lead says so. A GUESSED THRESHOLD.
 */
const TERM_COUNT_SCAN_CAP = Math.max(500, Number(process.env.WHITESPACE_MINER_TERM_SCAN_CAP) || 8_000)

/** Components a component must hold this many statements to be a problem at all. */
const MIN_COMPONENT_STATEMENTS = 3
/** Families a component must be admitted by before a rate over it means anything. */
const MIN_COMPONENT_FAMILIES = 3
/** Admitting families at a tier before that tier's rate is allowed to be the headline. */
const MIN_TIER_ADMITTING = 3

/** Components the unsolved engine ranks. Beyond this the tail is noise. */
const UNSOLVED_COMPONENTS = 24
/** Expiry groups turned into leads. */
const EXPIRY_LEADS = 4
/** Claim-core groups the frontier engine reads. */
const FRONTIER_GROUPS = 8

export const LEADS_PER_ENGINE = 8
export const LEADS_TOTAL = 24

/** Statement rows read or written per round trip. */
const DB_CHUNK = 500
/** Iterations of a JS loop between awaited heartbeats. */
const HEARTBEAT_EVERY = 1_000

function clampFraction(raw: string | undefined, fallback: number): number {
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 && value < 1 ? value : fallback
}

const ENGINE_STEPS = [
  { key: 'load', label: 'Loading the harvested statements' },
  { key: 'graph', label: 'Linking similar problem statements' },
  { key: 'unsolved', label: 'Measuring how each problem is addressed' },
  { key: 'transfer', label: 'Reading outside the field' },
  { key: 'frontier', label: 'Reading the dependent-claim frontier' },
  { key: 'expiry', label: 'Finding platforms nearing the end of protection' },
  { key: 'record', label: 'Saving the leads' },
]
const ENGINE_COUNTERS = [
  { key: 'statements', label: 'Statements read' },
  { key: 'families', label: 'Families read' },
  { key: 'outOfFieldRead', label: 'Publications read outside the field' },
  { key: 'leads', label: 'Leads saved' },
]

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export type LeadOrigin = 'UNSOLVED_PROBLEM' | 'CROSS_DOMAIN_TRANSFER' | 'CLAIM_FRONTIER' | 'EXPIRY_FRONTIER'

export interface EngineReport {
  key: 'unsolved' | 'transfer' | 'frontier' | 'expiry'
  origin: LeadOrigin
  ran: boolean
  /** Present when the engine did not run, in the exact copy the UI shows. */
  skipReason: string | null
  /** What the engine looked at and what it dropped, with denominators. */
  inputs: Record<string, unknown>
  /** Leads this engine contributed AFTER the cross-engine dedupe. */
  leads: number
  /** Candidates it produced that a later dedupe folded into an earlier lead. */
  deduped: number
}

export interface MinerEnginesResult {
  scopeFingerprint: string
  harvestRunId: string
  coverage: {
    familiesInField: number
    readableFieldFamilies: number
    readableFieldShare: number
    sampledFamilies: number
    extractedFamilies: number
    extractionCoverage: number
    tierMix: Record<string, number>
  }
  graph: {
    k: number
    statements: number
    families: number
    statementCap: number
    truncated: boolean
    cut: number | null
    p05: number | null
    p50: number | null
    componentSizes: number[]
    /** Components split or dropped by the bimodality guard. */
    bimodal: Array<{ groupA: string; groupB: string; sharedShare: number; action: 'split' | 'excluded' }>
  }
  engines: EngineReport[]
  leadsWritten: number
  leadsByOrigin: Record<string, number>
  leadsMarkedStale: number
  outOfFieldRead: number
  resolvedModels: Record<string, string>
  tokensUsed: { input: number; output: number }
  coverageNotes: string[]
  generatedAt: string
}

// ---------------------------------------------------------------------------
// Pure helpers — exported because tested
// ---------------------------------------------------------------------------

/**
 * A lead's identity: the problem component plus the mechanism, hashed.
 *
 * STABLE ACROSS RE-RUNS is the whole requirement — `invention_leads` is unique
 * on (studyId, fingerprint) and a re-run must UPDATE the lead rather than
 * duplicate it, or the attorney's review, gate and brief are orphaned on a row
 * nobody looks at again.
 *
 * The component's key is its MEDOID statement's text hash, not a positional
 * index and not a digest of every member: the medoid is the component's most
 * central statement, so adding or removing a few peripheral statements on a
 * re-run leaves it alone, while a positional index changes the moment one
 * component grows past another.
 */
export function leadFingerprint(componentKey: string, mechanismHash: string): string {
  return createHash('sha256').update(`${componentKey}\u0000${mechanismHash}`).digest('hex').slice(0, 32)
}

/** The sentinel mechanism hash for a lead with no mechanism. */
export const NO_MECHANISM = 'no-mechanism'

/**
 * The component's medoid, approximated from the k-NN edge list.
 *
 * The exact medoid is the member minimising total distance to every other
 * member, which needs the component's full distance matrix — a second quadratic
 * pass over data we already spent one on. The densest node is the same thing to
 * within the precision anything here uses: most in-component neighbours inside
 * the cut, ties broken by the smallest mean distance to them, then by id so the
 * answer never depends on iteration order.
 */
export function componentMedoid(
  members: readonly string[],
  edges: readonly StatementEdge[],
  cut: number
): string | null {
  if (!members.length) return null
  if (members.length === 1) return members[0]
  const inComponent = new Set(members)
  const degree = new Map<string, number>()
  const total = new Map<string, number>()
  for (const edge of edges) {
    if (edge.distance > cut) continue
    if (!inComponent.has(edge.a) || !inComponent.has(edge.b)) continue
    for (const node of [edge.a, edge.b]) {
      degree.set(node, (degree.get(node) ?? 0) + 1)
      total.set(node, (total.get(node) ?? 0) + edge.distance)
    }
  }
  let best = members[0]
  let bestDegree = degree.get(best) ?? 0
  let bestMean = bestDegree ? (total.get(best) as number) / bestDegree : Number.POSITIVE_INFINITY
  for (const member of members) {
    const memberDegree = degree.get(member) ?? 0
    const memberMean = memberDegree ? (total.get(member) as number) / memberDegree : Number.POSITIVE_INFINITY
    if (
      memberDegree > bestDegree ||
      (memberDegree === bestDegree && memberMean < bestMean) ||
      (memberDegree === bestDegree && memberMean === bestMean && member < best)
    ) {
      best = member
      bestDegree = memberDegree
      bestMean = memberMean
    }
  }
  return best
}

/**
 * Two to six normalised elements, or null when the lead cannot be described.
 *
 * A lead with fewer than two elements is not a claimable combination, and
 * padding it with generic words to reach two would be inventing the thing the
 * engines exist not to invent — so the lead is not written.
 */
export function normaliseElements(raw: readonly string[]): string[] | null {
  const seen = new Set<string>()
  const kept: string[] = []
  for (const value of raw) {
    const element = normalizeElement(String(value ?? ''))
    if (element.length < 3 || seen.has(element)) continue
    seen.add(element)
    kept.push(element)
    if (kept.length >= 6) break
  }
  return kept.length >= 2 ? kept : null
}

/** The richest tier with enough admitting families to speak from, else the biggest. */
export function primaryTier(byTier: Record<string, { admitting: number }>): TextTier | null {
  const tiers = (Object.keys(byTier) as TextTier[]).filter(tier => TIER_RANK[tier] !== undefined)
  const rich = tiers
    .filter(tier => byTier[tier].admitting >= MIN_TIER_ADMITTING)
    .sort((a, b) => TIER_RANK[b] - TIER_RANK[a])
  if (rich.length) return rich[0]
  const biggest = tiers
    .filter(tier => byTier[tier].admitting > 0)
    .sort((a, b) => byTier[b].admitting - byTier[a].admitting || TIER_RANK[b] - TIER_RANK[a])
  return biggest[0] ?? null
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0
}

// ---------------------------------------------------------------------------
// Internal row shapes
// ---------------------------------------------------------------------------

interface StatementNode {
  id: string
  familyKey: string
  publicationNumber: string
  text: string
  textHash: string
  filingYear: number | null
  applicantNorm: string | null
  cpcSubclasses: string[]
  tier: TextTier | null
}

interface ProblemComponent {
  key: string
  medoidId: string
  medoidText: string
  members: string[]
  families: string[]
  /** Set when the bimodality guard split the parent component. */
  splitFrom: { groupA: string; groupB: string; sharedShare: number } | null
}

/** One engine's candidate, before dedupe, naming and persistence. */
export interface LeadDraft {
  origin: LeadOrigin
  engine: EngineReport['key']
  fingerprint: string
  componentKey: string
  fallbackTitle: string
  problemStatement: string
  proposedMechanism: string | null
  elements: string[]
  rationale: string
  signals: Record<string, unknown>
  sourceRefs: Record<string, unknown>
  scores: Record<string, number | null>
  coverageLimitations: string[]
  evidence: Array<{
    kind: 'STATISTIC' | 'PATENT_PASSAGE'
    refId: string | null
    passage: string | null
    stance: 'CONTEXT'
    data?: Record<string, unknown>
  }>
  rank: number
}

// ---------------------------------------------------------------------------
// The stage
// ---------------------------------------------------------------------------

export interface MinerEnginesInput {
  runId: string
  workerId: string
  reporter: RunReporter
  studyId: string
  scope: WhitespaceScope
  llmContext: WhitespaceLLMContext
}

export async function runMinerEnginesStage(input: MinerEnginesInput): Promise<MinerEnginesResult> {
  const { reporter } = input
  await reporter.plan(ENGINE_STEPS, ENGINE_COUNTERS)
  const coverageNotes: string[] = []
  const fingerprint = scopeFingerprint(input.scope)

  // =========================================================================
  // Preconditions. All permanent, all before any work.
  // =========================================================================
  await reporter.step('load', 'Checking the harvest this stage reads')

  const study = await prisma.whitespaceStudy.findUnique({
    where: { id: input.studyId },
    select: { id: true, kind: true, scopeVersion: true },
  })
  if (!study) throw new WhitespacePermanentError('That study no longer exists.')

  const kind = studyKindOf(study.kind)
  if (kind !== 'MINER') {
    throw new WhitespacePermanentError(
      `The Invention Miner runs on a miner study, and this is a ${
        kind === 'INVENTION' ? 'invention' : 'landscape'
      } study. Create a study of the Invention Miner kind for this scope, or run the whitespace stages on this one.`
    )
  }

  // The statement column must still match the configured model. Every engine
  // here is a nearest-neighbour question, and a column that cannot be compared
  // makes each of them return "nothing is close" — which reads on the page as
  // "nobody else raised this problem", the most consequential sentence the
  // miner can emit.
  const indexConfig = await checkMinerIndexConfig()
  if (!indexConfig.ok) {
    throw new WhitespacePermanentError(
      `The miner cannot compare statements, so no engine here could measure anything: ${indexConfig.reason}`
    )
  }

  const harvest = await newestMatchingHarvest(input.studyId, fingerprint)
  if (!harvest) {
    throw new WhitespacePermanentError(
      'The engines read the statements a harvest indexed, and no completed harvest matches this study’s current scope. Read the field again for this scope.'
    )
  }

  const resolvedModels = await assertMinerStagesConfigured(input.llmContext, [
    { stageCode: MINER_LEAD_TITLES_STAGE_CODE, taskCode: TaskCode.IM_EXTRACT },
    { stageCode: MINER_EXTRACT_STAGE_CODE, taskCode: TaskCode.IM_EXTRACT },
  ])

  const result = harvest.result
  const sampled = Math.max(0, result.sampled || 0)
  const extracted = Math.max(0, result.extracted || 0)
  const extractionCoverage = sampled > 0 ? extracted / sampled : 0
  coverageNotes.push(...(result.coverageNotes ?? []))

  const fieldCounts = await countFieldFamilies(input.studyId, fingerprint)
  const engines: EngineReport[] = [
    { key: 'unsolved', origin: 'UNSOLVED_PROBLEM', ran: false, skipReason: null, inputs: {}, leads: 0, deduped: 0 },
    { key: 'transfer', origin: 'CROSS_DOMAIN_TRANSFER', ran: false, skipReason: null, inputs: {}, leads: 0, deduped: 0 },
    { key: 'frontier', origin: 'CLAIM_FRONTIER', ran: false, skipReason: null, inputs: {}, leads: 0, deduped: 0 },
    { key: 'expiry', origin: 'EXPIRY_FRONTIER', ran: false, skipReason: null, inputs: {}, leads: 0, deduped: 0 },
  ]
  const engineOf = (key: EngineReport['key']) => engines.find(engine => engine.key === key) as EngineReport

  const baseCoverage = {
    familiesInField: result.familiesInField || 0,
    readableFieldFamilies: fieldCounts.readable,
    readableFieldShare: fieldCounts.total > 0 ? fieldCounts.readable / fieldCounts.total : 0,
    sampledFamilies: sampled,
    extractedFamilies: extracted,
    extractionCoverage: Math.round(extractionCoverage * 1000) / 1000,
    tierMix: (result.byTierSampled ?? {}) as unknown as Record<string, number>,
  }

  // -------------------------------------------------------------------------
  // The coverage floor. Rule 1: never silently.
  // -------------------------------------------------------------------------
  if (extractionCoverage < MIN_EXTRACTION_COVERAGE) {
    const reason =
      `The harvest read ${extracted.toLocaleString()} of the ${sampled.toLocaleString()} families it chose ` +
      `(${percent(extracted, sampled)}%), below the ${Math.round(MIN_EXTRACTION_COVERAGE * 100)}% these engines ` +
      'need. Every engine here is a ratio over that reading, so leads mined from it would carry denominators that ' +
      'read as a caveat about the field when they are a failure of the harvest. Run the harvest again.'
    for (const engine of engines) engine.skipReason = reason
    for (const key of ['graph', 'unsolved', 'transfer', 'frontier', 'expiry'] as const) {
      await reporter.skip(key, 'the harvest read too little of the field')
    }
    await reporter.step('record', 'Recording the refusal')
    const staleCount = await markAllLeadsStale(input.studyId)
    reporter.count('leads', 0)
    reporter.done()
    return {
      scopeFingerprint: fingerprint,
      harvestRunId: harvest.runId,
      coverage: baseCoverage,
      graph: {
        k: GRAPH_K,
        statements: 0,
        families: 0,
        statementCap: GRAPH_STATEMENT_CAP,
        truncated: false,
        cut: null,
        p05: null,
        p50: null,
        componentSizes: [],
        bimodal: [],
      },
      engines,
      leadsWritten: 0,
      leadsByOrigin: {},
      leadsMarkedStale: staleCount,
      outOfFieldRead: 0,
      resolvedModels,
      tokensUsed: { input: 0, output: 0 },
      coverageNotes: [...coverageNotes, reason],
      generatedAt: new Date().toISOString(),
    }
  }

  // =========================================================================
  // Load — the statements, joined to the staged field
  // =========================================================================
  const tierByPublication = await loadFieldTiers(input.studyId, fingerprint)
  const nodes = await loadStatementNodes(input.studyId, fingerprint, 'PROBLEM', GRAPH_STATEMENT_CAP, tierByPublication)
  const graphFamilies = new Set(nodes.map(node => node.familyKey))
  reporter.count('statements', nodes.length)
  reporter.count('families', graphFamilies.size, sampled)
  reporter.event(
    'count',
    `${nodes.length.toLocaleString()} problem statements read from ${graphFamilies.size.toLocaleString()} families`
  )

  const graphTruncated = nodes.length >= GRAPH_STATEMENT_CAP
  if (graphTruncated) {
    coverageNotes.push(
      `The problem graph was capped at ${GRAPH_STATEMENT_CAP.toLocaleString()} statements, drawn at random across ` +
        'families. Every rate below is over the families that reached the graph, not over the whole harvest.'
    )
  }

  // =========================================================================
  // Graph
  // =========================================================================
  await reporter.step('graph', `Linking ${nodes.length.toLocaleString()} problem statements`)
  let edges: StatementEdge[] = []
  let graphError: string | null = null
  if (nodes.length >= MIN_COMPONENT_STATEMENTS) {
    try {
      edges = await knnEdges(nodes.map(node => node.id), GRAPH_K)
    } catch (error) {
      graphError = isStatementTimeout(error)
        ? `The ${nodes.length.toLocaleString()} problem statements in this field could not be linked within ` +
          `${Math.round(GRAPH_TIMEOUT_MS / 1000)}s. The statement vector index has not been built on this ` +
          'deployment, so the comparison is an exact scan; run scripts/build-miner-statement-index.ts, or narrow ' +
          'the scope.'
        : `The problem statements could not be linked: ${error instanceof Error ? error.message : String(error)}.`
    }
  } else {
    graphError = `Only ${nodes.length} problem statements were indexed for this field — too few to link.`
  }

  const cut = graphError ? null : nearestNeighbourCut(oneNearestDistances(nodes.map(node => node.id), edges))
  if (!graphError && !cut) {
    graphError =
      'This field’s problem statements produced too few nearest-neighbour distances to calibrate a linking ' +
      'threshold from, and a threshold guessed from anything else would decide how many problems the field has.'
  }

  if (graphError || !cut) {
    const reason = graphError as string
    for (const engine of engines) engine.skipReason = reason
    await reporter.fail('graph', 'the problem statements could not be linked')
    for (const key of ['unsolved', 'transfer', 'frontier', 'expiry'] as const) {
      await reporter.skip(key, 'the problem statements could not be linked')
    }
    await reporter.step('record', 'Recording the refusal')
    const staleCount = await markAllLeadsStale(input.studyId)
    reporter.count('leads', 0)
    reporter.done()
    return {
      scopeFingerprint: fingerprint,
      harvestRunId: harvest.runId,
      coverage: baseCoverage,
      graph: {
        k: GRAPH_K,
        statements: nodes.length,
        families: graphFamilies.size,
        statementCap: GRAPH_STATEMENT_CAP,
        truncated: graphTruncated,
        cut: null,
        p05: null,
        p50: null,
        componentSizes: [],
        bimodal: [],
      },
      engines,
      leadsWritten: 0,
      leadsByOrigin: {},
      leadsMarkedStale: staleCount,
      outOfFieldRead: 0,
      resolvedModels,
      tokensUsed: { input: 0, output: 0 },
      coverageNotes: [...coverageNotes, reason],
      generatedAt: new Date().toISOString(),
    }
  }

  const nodeById = new Map(nodes.map(node => [node.id, node]))
  const rawComponents = connectedComponents(nodes.map(node => node.id), edges, cut.cut)
  const { components, bimodal } = await applyBimodalityGuard(rawComponents, nodeById, edges, cut.cut, coverageNotes, reporter)
  // NOT narrated: how many distinct problems this field has is a FINDING.
  await reporter.heartbeat()

  const familiesOfComponent = new Map(components.map(component => [component.key, new Set(component.families)]))
  const componentByFamily = new Map<string, string[]>()
  for (const component of components) {
    for (const familyKey of component.families) {
      const list = componentByFamily.get(familyKey)
      if (list) list.push(component.key)
      else componentByFamily.set(familyKey, [component.key])
    }
  }

  // Everything both the unsolved and the transfer engine need about each family.
  const mechanisms = await loadStatementNodes(
    input.studyId,
    fingerprint,
    'MECHANISM',
    GRAPH_STATEMENT_CAP,
    tierByPublication
  )
  const claimScopes = await loadClaimScopes(input.studyId, fingerprint, reporter)

  const drafts: LeadDraft[] = []
  let tokensIn = 0
  let tokensOut = 0
  let outOfFieldRead = 0

  // =========================================================================
  // Engine (i) — unsolved problems
  // =========================================================================
  await reporter.step('unsolved', 'Measuring how each problem is addressed')
  const unsolvedOutcome = await runUnsolvedEngine({
    studyId: input.studyId,
    fingerprint,
    components,
    nodeById,
    mechanisms,
    claimScopes,
    cut: cut.cut,
    sampledFamilies: graphFamilies.size,
    familiesInField: baseCoverage.familiesInField,
    reporter,
  })
  Object.assign(engineOf('unsolved'), { ran: true, inputs: unsolvedOutcome.inputs })
  drafts.push(...unsolvedOutcome.drafts)
  await reporter.heartbeat()

  // =========================================================================
  // Engine (ii) — cross-domain transfer
  // =========================================================================
  const transferReport = engineOf('transfer')
  if (baseCoverage.readableFieldShare < MIN_READABLE_FIELD_SHARE) {
    transferReport.skipReason = readableShareSkip(fieldCounts.readable, fieldCounts.total)
    await reporter.skip('transfer', 'the field holds too little readable text to prove an absence')
  } else {
    const censusClassifications = await censusClassificationFacet(input.studyId, fingerprint)
    const subclasses = resolveFieldSubclasses({
      scopeClassifications: input.scope.classifications,
      censusClassifications: censusClassifications?.classifications,
      familyCount: censusClassifications?.familyCount ?? baseCoverage.familiesInField,
    })
    if (!subclasses) {
      transferReport.skipReason = NO_SUBCLASS_SKIP
      await reporter.skip('transfer', 'this scope defines no classifications to be outside of')
    } else {
      if (subclasses.note) coverageNotes.push(subclasses.note)
      await reporter.step('transfer', 'Reading outside the field')
      const outcome = await runTransferEngine({
        studyId: input.studyId,
        fingerprint,
        components: components.slice(0, TRANSFER_COMPONENTS),
        nodeById,
        fieldSubclasses: subclasses.subclasses,
        cut: cut.cut,
        familiesInField: baseCoverage.familiesInField,
        readableFieldFamilies: fieldCounts.readable,
        llmContext: input.llmContext,
        reporter,
      })
      Object.assign(transferReport, { ran: true, inputs: outcome.inputs, skipReason: outcome.skipReason })
      drafts.push(...outcome.drafts)
      tokensIn += outcome.tokensUsed.input
      tokensOut += outcome.tokensUsed.output
      outOfFieldRead = outcome.publicationsRead
      if (outcome.modelCode) resolvedModels[MINER_EXTRACT_STAGE_CODE] = outcome.modelCode
      reporter.count('outOfFieldRead', outOfFieldRead)
    }
  }
  await reporter.heartbeat()

  // =========================================================================
  // Engine (iii) — dependent-claim frontier
  // =========================================================================
  await reporter.step('frontier', 'Reading the dependent-claim frontier')
  const frontierOutcome = await runFrontierEngine({
    studyId: input.studyId,
    fingerprint,
    claimScopes,
    componentByFamily,
    componentsByKey: new Map(components.map(component => [component.key, component])),
    cut: cut.cut,
    tierByPublication,
    familiesInField: baseCoverage.familiesInField,
    reporter,
  })
  Object.assign(engineOf('frontier'), {
    ran: frontierOutcome.skipReason === null,
    inputs: frontierOutcome.inputs,
    skipReason: frontierOutcome.skipReason,
  })
  if (frontierOutcome.skipReason) await reporter.skip('frontier', 'no dependent-claim frontier could be measured')
  drafts.push(...frontierOutcome.drafts)
  await reporter.heartbeat()

  // =========================================================================
  // Engine (iv) — expiry frontier
  // =========================================================================
  await reporter.step('expiry', 'Finding platforms nearing the end of protection')
  const expiryOutcome = runExpiryEngine({
    components,
    nodeById,
    familiesInField: baseCoverage.familiesInField,
    sampledFamilies: graphFamilies.size,
    referenceYear: new Date().getFullYear(),
  })
  Object.assign(engineOf('expiry'), {
    ran: expiryOutcome.skipReason === null,
    inputs: expiryOutcome.inputs,
    skipReason: expiryOutcome.skipReason,
  })
  if (expiryOutcome.skipReason) await reporter.skip('expiry', 'no platform in this field is near the end of its term')
  drafts.push(...expiryOutcome.drafts)

  // =========================================================================
  // Record
  // =========================================================================
  await reporter.step('record', 'Saving the leads')
  const selected = selectLeads(drafts, engines)
  const titled = await nameLeads(selected, input.llmContext, resolvedModels)
  tokensIn += titled.tokensUsed.input
  tokensOut += titled.tokensUsed.output

  const written = await writeLeads({
    studyId: input.studyId,
    runId: input.runId,
    fingerprint,
    leads: titled.leads,
  })
  reporter.count('leads', written.written)

  const leadsByOrigin: Record<string, number> = {}
  for (const lead of titled.leads) leadsByOrigin[lead.origin] = (leadsByOrigin[lead.origin] ?? 0) + 1

  coverageNotes.push(describeTierMix((result.byTierSampled ?? {}) as Record<TextTier, number>))
  coverageNotes.push(
    `Every count here is over the ${graphFamilies.size.toLocaleString()} families whose problem statements reached ` +
      `the graph, drawn from the ${extracted.toLocaleString()} families the harvest read, of ` +
      `${baseCoverage.familiesInField.toLocaleString()} in the field.`
  )
  coverageNotes.push(LEADS_ARE_CANDIDATES)

  reporter.done()
  return {
    scopeFingerprint: fingerprint,
    harvestRunId: harvest.runId,
    coverage: baseCoverage,
    graph: {
      k: GRAPH_K,
      statements: nodes.length,
      families: graphFamilies.size,
      statementCap: GRAPH_STATEMENT_CAP,
      truncated: graphTruncated,
      cut: cut.cut,
      p05: cut.p05,
      p50: cut.p50,
      componentSizes: components.map(component => component.members.length),
      bimodal,
    },
    engines,
    leadsWritten: written.written,
    leadsByOrigin,
    leadsMarkedStale: written.stale,
    outOfFieldRead,
    resolvedModels,
    tokensUsed: { input: tokensIn, output: tokensOut },
    coverageNotes,
    generatedAt: new Date().toISOString(),
  }
}

/** Printed on every lead. Not a disclaimer — the honest description of the row. */
export const LEADS_ARE_CANDIDATES =
  'Leads are candidates until screened: nothing here has been tested against the closest prior art, inventive ' +
  'step or the statutory exclusions.'

// ---------------------------------------------------------------------------
// Preconditions and loading
// ---------------------------------------------------------------------------

/**
 * The newest COMPLETED harvest whose RESULT carries this scope's fingerprint.
 *
 * Keyed on the fingerprint stored in the result, not on the run's scopeVersion:
 * saving a scope increments the version even when nothing changed, and the
 * fingerprint is the identity of the scope's MEANING (see scope-fingerprint.ts).
 * Everything this stage joins is partitioned on that same fingerprint, so a
 * mismatch here would mean joining against a field nobody staged.
 */
async function newestMatchingHarvest(
  studyId: string,
  fingerprint: string
): Promise<{ runId: string; result: MinerHarvestResult } | null> {
  const runs = await prisma.whitespaceRun.findMany({
    where: { studyId, stage: 'MINER_HARVEST', status: 'COMPLETED' },
    orderBy: { completedAt: 'desc' },
    take: 10,
    select: { id: true, results: true },
  })
  for (const run of runs) {
    const result = run.results as unknown as MinerHarvestResult | null
    if (result && result.scopeFingerprint === fingerprint) return { runId: run.id, result }
  }
  return null
}

/** Distinct families in the staged field, and how many carry readable text. */
async function countFieldFamilies(studyId: string, fingerprint: string): Promise<{ total: number; readable: number }> {
  const rows = await prisma.$queryRaw<Array<{ total: bigint; readable: bigint }>>(Prisma.sql`
    SELECT COUNT(DISTINCT "familyKey")::bigint AS total,
           COUNT(DISTINCT "familyKey") FILTER (WHERE "textTier" <> 'none')::bigint AS readable
    FROM "miner_field_publications"
    WHERE "studyId" = ${studyId} AND "scopeFingerprint" = ${fingerprint}`)
  return { total: Number(rows[0]?.total ?? 0), readable: Number(rows[0]?.readable ?? 0) }
}

/** publicationNumber → the tier it was READ at. 'none' rows are excluded. */
async function loadFieldTiers(studyId: string, fingerprint: string): Promise<Map<string, TextTier>> {
  const rows = await prisma.minerFieldPublication.findMany({
    where: { studyId, scopeFingerprint: fingerprint, sampled: true },
    select: { publicationNumber: true, textTier: true },
  })
  const tiers = new Map<string, TextTier>()
  for (const row of rows) {
    if (row.textTier === 'none') continue
    if (TIER_RANK[row.textTier as TextTier] === undefined) continue
    tiers.set(row.publicationNumber, row.textTier as TextTier)
  }
  return tiers
}

/**
 * The statements of one kind, INSIDE THE FIELD BY JOIN (rule 2).
 *
 * Ordered by `md5(familyKey)` so the cap, when it bites, takes a random draw
 * across families rather than a prefix of whichever family sorted first — the
 * same rule the harvest's own sampling uses, and for the same reason: every
 * number downstream is a ratio over this set.
 */
async function loadStatementNodes(
  studyId: string,
  fingerprint: string,
  statementKind: 'PROBLEM' | 'MECHANISM' | 'CLAIM_CORE',
  cap: number,
  tiers: ReadonlyMap<string, TextTier>
): Promise<StatementNode[]> {
  const rows = await prisma.$transaction([
    prisma.$executeRaw`SELECT set_config('statement_timeout', ${String(ENGINE_TIMEOUT_MS)}, true)`,
    prisma.$executeRaw(statementIndexSettingsSql()),
    prisma.$queryRaw<
      Array<{
        id: string
        familyKey: string
        publicationNumber: string
        text: string
        textHash: string
        filingYear: number | null
        applicantNorm: string | null
        cpcSubclasses: string[] | null
      }>
    >(Prisma.sql`
      SELECT s."id",
             s."familyKey",
             s."publicationNumber",
             s."text",
             s."textHash",
             s."filingYear",
             s."applicantNorm",
             s."cpcSubclasses"
      FROM "patent_problem_statements" s
      JOIN "miner_field_publications" f
        ON f."publicationNumber" = s."publicationNumber"
       AND f."studyId" = ${studyId}
       AND f."scopeFingerprint" = ${fingerprint}
       AND f."sampled" = true
      WHERE s."kind" = ${statementKind}
        AND ${statementColumnSql('s')} IS NOT NULL
      ORDER BY md5(s."familyKey"), s."id"
      LIMIT ${cap}`),
  ])
  return (rows[2] as Array<Record<string, unknown>>).map(row => ({
    id: String(row.id),
    familyKey: String(row.familyKey),
    publicationNumber: String(row.publicationNumber),
    text: String(row.text ?? ''),
    textHash: String(row.textHash ?? ''),
    filingYear: row.filingYear === null || row.filingYear === undefined ? null : Number(row.filingYear),
    applicantNorm: (row.applicantNorm as string | null) ?? null,
    cpcSubclasses: Array.isArray(row.cpcSubclasses) ? (row.cpcSubclasses as string[]) : [],
    tier: tiers.get(String(row.publicationNumber)) ?? null,
  }))
}

/**
 * The k-NN edge list, computed EXACTLY inside the node set.
 *
 * The node ids are materialised into a temp table first. The obvious form —
 * `WHERE b."id" = ANY($ids)` inside the lateral — re-scans a 4,000-element
 * array once per candidate row, which is a cubic amount of work and does not
 * finish. A temp table with the ids gives the planner a relation to join.
 *
 * ORDER BY uses `statementRawDistanceSql` and nothing else: it is the only form
 * pgvector's index can serve, and wrapping it in the [0,1] normalisation would
 * silently turn every neighbour lookup into a sequential scan the day
 * scripts/build-miner-statement-index.ts runs (see vector-sql.ts).
 */
async function knnEdges(ids: readonly string[], k: number): Promise<StatementEdge[]> {
  if (ids.length < 2) return []
  const rows = await prisma.$transaction(
    async tx => {
      await tx.$executeRaw(Prisma.sql`SELECT set_config('statement_timeout', ${String(GRAPH_TIMEOUT_MS)}, true)`)
      await tx.$executeRaw(statementIndexSettingsSql({ probes: 100, efSearch: 1_000 }))
      await tx.$executeRaw(Prisma.sql`
        CREATE TEMP TABLE ws_miner_nodes ON COMMIT DROP AS
        SELECT s."id" AS id, ${statementColumnSql('s')} AS embedding
        FROM "patent_problem_statements" s
        WHERE s."id" = ANY(${ids as string[]}::text[])`)
      await tx.$executeRaw(Prisma.sql`CREATE INDEX ON ws_miner_nodes (id)`)
      await tx.$executeRaw(Prisma.sql`ANALYZE ws_miner_nodes`)
      return tx.$queryRaw<Array<{ src: string; dst: string; dist: number }>>(Prisma.sql`
        SELECT a.id AS src, n.dst AS dst, n.dist AS dist
        FROM ws_miner_nodes a
        CROSS JOIN LATERAL (
          SELECT b.id AS dst, ${statementDistanceSql('b', Prisma.sql`a.embedding`)}::float8 AS dist
          FROM ws_miner_nodes b
          WHERE b.id <> a.id
          ORDER BY ${statementRawDistanceSql('b', Prisma.sql`a.embedding`)}
          LIMIT ${k}
        ) n`)
    },
    { timeout: GRAPH_TIMEOUT_MS + 60_000, maxWait: 20_000 }
  )

  // De-duplicated to one undirected edge per pair: the k-NN relation is not
  // symmetric, so a and b can each list the other and union-find would union
  // them twice for nothing.
  const seen = new Set<string>()
  const edges: StatementEdge[] = []
  for (const row of rows) {
    const [a, b] = row.src < row.dst ? [row.src, row.dst] : [row.dst, row.src]
    const key = `${a}\u0000${b}`
    if (seen.has(key)) continue
    seen.add(key)
    edges.push({ a, b, distance: Number(row.dist) })
  }
  return edges
}

interface ClaimScope {
  familyKey: string
  publicationNumber: string
  tier: TextTier | null
  independentElements: string[]
  dependentNarrowings: string[]
}

/**
 * `claimedScope` per sampled family, from the extraction cache.
 *
 * The richest non-superseded reading of each publication wins, so a family
 * whose EP claim set arrived after an abstract-only pass is read from the claim
 * set. Elements are normalised through `normalizeElement` — the SAME
 * normalisation the deep dive uses, because a co-occurrence count over two
 * different normalisations silently never matches.
 */
async function loadClaimScopes(
  studyId: string,
  fingerprint: string,
  reporter: RunReporter
): Promise<Map<string, ClaimScope>> {
  const field = await prisma.minerFieldPublication.findMany({
    where: { studyId, scopeFingerprint: fingerprint, sampled: true },
    select: { publicationNumber: true, familyKey: true, textTier: true },
  })
  const byPublication = new Map(field.map(row => [row.publicationNumber, row]))
  const scopes = new Map<string, ClaimScope>()

  const batches = chunk(field, DB_CHUNK)
  for (let index = 0; index < batches.length; index++) {
    if (index > 0) await reporter.heartbeat()
    const rows = await prisma.patentTextExtraction.findMany({
      where: {
        publicationNumber: { in: batches[index].map(row => row.publicationNumber) },
        supersededAt: null,
      },
      select: { publicationNumber: true, familyKey: true, textTier: true, claimedScope: true },
    })
    for (const row of rows) {
      const scope = row.claimedScope as { independentElements?: unknown; dependentNarrowings?: unknown } | null
      if (!scope) continue
      const staged = byPublication.get(row.publicationNumber)
      const familyKey = staged?.familyKey ?? row.familyKey
      const tier = TIER_RANK[row.textTier as TextTier] !== undefined ? (row.textTier as TextTier) : null
      const existing = scopes.get(familyKey)
      // Richest reading wins; a tie keeps the first, which is deterministic
      // because the batches are read in a stable order.
      if (existing && existing.tier && tier && TIER_RANK[existing.tier] >= TIER_RANK[tier]) continue
      const normalise = (value: unknown): string[] =>
        Array.isArray(value)
          ? Array.from(
              new Set(
                value
                  .map(entry => normalizeElement(String(entry ?? '')))
                  .filter(entry => entry.length >= 3)
              )
            ).sort()
          : []
      scopes.set(familyKey, {
        familyKey,
        publicationNumber: row.publicationNumber,
        tier,
        independentElements: normalise(scope.independentElements),
        dependentNarrowings: normalise(scope.dependentNarrowings),
      })
    }
  }
  return scopes
}

/**
 * The census's classifications facet, for the derived subclass set.
 *
 * Matched on the SCOPE FINGERPRINT of the run's own snapshot, not merely on the
 * newest completed census. The facet defines what "outside this field" means
 * for the transfer engine, and a facet taken from a census of a different scope
 * would define the wrong field — quietly, and in the direction that admits
 * transfer candidates which are not outside anything.
 */
async function censusClassificationFacet(
  studyId: string,
  fingerprint: string
): Promise<{ classifications: LabelledCount[]; familyCount: number } | null> {
  const runs = await prisma.whitespaceRun.findMany({
    where: { studyId, stage: 'FIELD_MAP', status: 'COMPLETED' },
    orderBy: { completedAt: 'desc' },
    take: 10,
    select: { results: true, scopeSnapshot: true },
  })
  for (const run of runs) {
    const snapshot = run.scopeSnapshot as unknown as WhitespaceScope | null
    if (!snapshot || scopeFingerprint(snapshot) !== fingerprint) continue
    const results = run.results as unknown as { classifications?: LabelledCount[]; familyCount?: number } | null
    if (!results?.classifications?.length) continue
    return { classifications: results.classifications, familyCount: Math.max(1, results.familyCount ?? 1) }
  }
  return null
}

// ---------------------------------------------------------------------------
// The bimodality guard
// ---------------------------------------------------------------------------

/**
 * Split or exclude every component whose two largest classification groups are
 * two technologies. See clustering.ts for why the raw cut lets them merge.
 */
async function applyBimodalityGuard(
  raw: readonly Component[],
  nodeById: ReadonlyMap<string, StatementNode>,
  edges: readonly StatementEdge[],
  cut: number,
  coverageNotes: string[],
  reporter: RunReporter
): Promise<{
  components: ProblemComponent[]
  bimodal: Array<{ groupA: string; groupB: string; sharedShare: number; action: 'split' | 'excluded' }>
}> {
  const components: ProblemComponent[] = []
  const bimodal: Array<{ groupA: string; groupB: string; sharedShare: number; action: 'split' | 'excluded' }> = []

  const build = (
    members: readonly string[],
    splitFrom: ProblemComponent['splitFrom']
  ): ProblemComponent | null => {
    if (members.length < MIN_COMPONENT_STATEMENTS) return null
    const families = Array.from(new Set(members.map(id => nodeById.get(id)?.familyKey).filter(Boolean) as string[]))
    if (families.length < MIN_COMPONENT_FAMILIES) return null
    const medoidId = componentMedoid(members, edges, cut)
    const medoid = medoidId ? nodeById.get(medoidId) : null
    if (!medoid) return null
    return {
      key: medoid.textHash,
      medoidId: medoid.id,
      medoidText: medoid.text,
      members: [...members],
      families: families.sort(),
      splitFrom,
    }
  }

  let processed = 0
  for (const component of raw) {
    processed += 1
    if (processed % HEARTBEAT_EVERY === 0) await reporter.heartbeat()

    const familySubclasses = new Map<string, string[]>()
    for (const id of component.members) {
      const node = nodeById.get(id)
      if (!node) continue
      const existing = familySubclasses.get(node.familyKey) ?? []
      familySubclasses.set(node.familyKey, Array.from(new Set([...existing, ...node.cpcSubclasses])))
    }

    const verdict = componentBimodality(familySubclasses)
    if (!verdict.bimodal) {
      const built = build(component.members, null)
      if (built) components.push(built)
      continue
    }

    const note = bimodalityNote(verdict.groupA, verdict.groupB)
    const inA = new Set(verdict.partA)
    const inB = new Set(verdict.partB)
    const membersA = component.members.filter(id => inA.has(nodeById.get(id)?.familyKey ?? ''))
    const membersB = component.members.filter(id => inB.has(nodeById.get(id)?.familyKey ?? ''))
    const splitFrom = { groupA: verdict.groupA, groupB: verdict.groupB, sharedShare: verdict.sharedShare }
    const builtA = build(membersA, splitFrom)
    const builtB = build(membersB, splitFrom)

    if (builtA || builtB) {
      if (builtA) components.push(builtA)
      if (builtB) components.push(builtB)
      bimodal.push({ ...splitFrom, action: 'split' })
      coverageNotes.push(
        `${note} One group of problem statements was split into its ${verdict.groupA} and ${verdict.groupB} halves ` +
          `before anything was counted over it; ${verdict.unassigned.length} families in neither group were dropped.`
      )
    } else {
      bimodal.push({ ...splitFrom, action: 'excluded' })
      coverageNotes.push(
        `${note} One group of problem statements mixed them and neither half was large enough to count over, so it ` +
          'was excluded entirely rather than reported as one problem.'
      )
    }
  }

  // Largest first — the engines take the top N, and "largest" has to mean
  // "admitted by the most families", not "happened to sort first".
  return {
    components: components.sort(
      (a, b) => b.families.length - a.families.length || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
    ),
    bimodal,
  }
}

// ---------------------------------------------------------------------------
// Whole-field term counts — shared by the unsolved and transfer engines
// ---------------------------------------------------------------------------

export interface TermCount {
  hits: number
  countedFamilies: number
  /** False when the query had no searchable words after stemming — not a zero. */
  measured: boolean
}

/**
 * One bounded exact count, over the field's READABLE text, of each entry's
 * terms.
 *
 * Two tsvectors per row, matching the two GIN indexes byte for byte: the
 * specification index from migration 20260805120000 (claims + description) and
 * the abstract-side document. Both are materialised ONCE per row in the CTE —
 * without `MATERIALIZED` the planner inlines the CTE into the cross join and
 * recomputes every tsvector once per query entry, which detoasts the whole
 * field N times.
 *
 * `numnode` is selected so a query that stems away to nothing is reported as
 * UNMEASURED rather than as zero hits. An empty tsquery matches no row, and a
 * zero read as "nobody in the field discusses this" is exactly the fail-open
 * this product cannot afford.
 */
async function countFieldTerms(
  studyId: string,
  fingerprint: string,
  entries: ReadonlyArray<{ key: string; query: string }>
): Promise<Map<string, TermCount>> {
  const counts = new Map<string, TermCount>()
  const usable = entries.filter(entry => entry.query.trim())
  if (!usable.length) return counts

  try {
    const rows = await prisma.$transaction([
      prisma.$executeRaw`SELECT set_config('statement_timeout', ${String(ENGINE_TIMEOUT_MS)}, true)`,
      prisma.$queryRaw<Array<{ key: string; hits: bigint; counted: bigint; nodes: number }>>(Prisma.sql`
        WITH
        -- The cap is applied BEFORE the join, on publication numbers alone.
        -- Selecting the text in the same node as the ORDER BY would detoast
        -- every description in the field to sort them and then throw all but
        -- the cap away.
        picked AS MATERIALIZED (
          SELECT f."publicationNumber" AS pub, f."familyKey" AS family_key
          FROM "miner_field_publications" f
          WHERE f."studyId" = ${studyId}
            AND f."scopeFingerprint" = ${fingerprint}
            AND f."textTier" <> 'none'
          ORDER BY md5(f."publicationNumber")
          LIMIT ${TERM_COUNT_SCAN_CAP}
        ),
        readable AS MATERIALIZED (
          SELECT p.family_key AS family_key,
                 to_tsvector('english'::regconfig,
                   coalesce(lp."claimsText", '') || ' ' || coalesce(lp."descriptionText", '')) AS spec_tsv,
                 to_tsvector('english'::regconfig,
                   coalesce(lp."ragText", '')   || ' ' ||
                   coalesce(lp."title", '')     || ' ' ||
                   coalesce(lp."abstract", '')  || ' ' ||
                   coalesce(lp."abstractOriginal", '')) AS abs_tsv
          FROM picked p
          JOIN "local_patents" lp ON lp."publicationNumber" = p.pub
        ),
        q AS (
          SELECT t.key AS key,
                 websearch_to_tsquery('english'::regconfig, t.query) AS tsq
          FROM unnest(${usable.map(entry => entry.key)}::text[], ${usable.map(
            entry => entry.query
          )}::text[]) AS t(key, query)
        )
        SELECT q.key AS key,
               COUNT(DISTINCT r.family_key) FILTER (WHERE r.spec_tsv @@ q.tsq OR r.abs_tsv @@ q.tsq)::bigint AS hits,
               COUNT(DISTINCT r.family_key)::bigint AS counted,
               MAX(numnode(q.tsq))::int AS nodes
        FROM q CROSS JOIN readable r
        GROUP BY q.key`),
    ])
    for (const row of rows[1] as Array<{ key: string; hits: bigint; counted: bigint; nodes: number }>) {
      counts.set(String(row.key), {
        hits: Number(row.hits ?? 0),
        countedFamilies: Number(row.counted ?? 0),
        measured: Number(row.nodes ?? 0) > 0,
      })
    }
  } catch (error) {
    // An unmeasured exclusion is recorded as unmeasured, never as a pass — the
    // callers read `measured: false` and say so on the lead.
    console.error('[Miner] Whole-field term count failed:', error instanceof Error ? error.message : error)
  }
  return counts
}

// ---------------------------------------------------------------------------
// Engine (i) — unsolved problems
// ---------------------------------------------------------------------------

interface UnsolvedInput {
  studyId: string
  fingerprint: string
  components: readonly ProblemComponent[]
  nodeById: ReadonlyMap<string, StatementNode>
  mechanisms: readonly StatementNode[]
  claimScopes: ReadonlyMap<string, ClaimScope>
  cut: number
  sampledFamilies: number
  familiesInField: number
  reporter: RunReporter
}

async function runUnsolvedEngine(
  input: UnsolvedInput
): Promise<{ drafts: LeadDraft[]; inputs: Record<string, unknown> }> {
  const considered = input.components.slice(0, UNSOLVED_COMPONENTS)
  if (!considered.length) {
    return { drafts: [], inputs: { componentsConsidered: 0, note: 'no problem component was large enough to count over' } }
  }

  // The whole-field term count for every considered component, in ONE query.
  const termCounts = await countFieldTerms(
    input.studyId,
    input.fingerprint,
    considered.map(component => ({
      key: component.key,
      query: keyTerms(component.medoidText, 3).map(term => `"${term}"`).join(' '),
    }))
  )
  await input.reporter.heartbeat()

  // The vector arm: each family's nearest MECHANISM to each component's medoid.
  const nearestByComponent = await nearestMechanismPerFamily(
    input.studyId,
    input.fingerprint,
    considered.map(component => ({ key: component.key, medoidId: component.medoidId }))
  )
  await input.reporter.heartbeat()

  const mechanismTextsByFamily = new Map<string, string[]>()
  for (const mechanism of input.mechanisms) {
    const list = mechanismTextsByFamily.get(mechanism.familyKey)
    if (list) list.push(mechanism.text)
    else mechanismTextsByFamily.set(mechanism.familyKey, [mechanism.text])
  }

  const drafts: LeadDraft[] = []
  const excluded: Array<{ medoid: string; reason: string; detail: string; admitting: number }> = []
  const currentYear = new Date().getFullYear()
  let familiesMeasured = 0

  for (const component of considered) {
    const headNoun = problemHeadNoun(component.medoidText)
    const termCount = termCounts.get(component.key)
    const exclusion = checkExclusions({
      medoidText: component.medoidText,
      admitting: component.families.length,
      sampledFamilies: input.sampledFamilies,
      widelyDiscussed: termCount?.measured
        ? { hits: termCount.hits, countedFamilies: termCount.countedFamilies }
        : null,
    })
    if (exclusion.excluded) {
      excluded.push({
        medoid: component.medoidText,
        reason: exclusion.reason as string,
        detail: exclusion.detail,
        admitting: component.families.length,
      })
      continue
    }

    const nearest = nearestByComponent.get(component.key) ?? new Map<string, number>()

    // Per tier, because "no mechanism is directed at this" means something
    // completely different read from a full description than from an abstract.
    const byTier: Record<string, { admitting: number; addressing: number; lexicalOnly: number; caughtOnlyByVector: number; unsolved: ReturnType<typeof wilsonInterval> }> = {}
    const candidatesByTier = new Map<TextTier, AddressingCandidate[]>()
    const familyTier = new Map<string, TextTier>()
    for (const id of component.members) {
      const node = input.nodeById.get(id)
      if (!node?.tier) continue
      const existing = familyTier.get(node.familyKey)
      if (!existing || TIER_RANK[node.tier] > TIER_RANK[existing]) familyTier.set(node.familyKey, node.tier)
    }

    for (const familyKey of component.families) {
      const tier = familyTier.get(familyKey)
      if (!tier) continue
      const scope = input.claimScopes.get(familyKey)
      const candidate: AddressingCandidate = {
        familyKey,
        mechanismTexts: mechanismTextsByFamily.get(familyKey) ?? [],
        claimElements: [...(scope?.independentElements ?? []), ...(scope?.dependentNarrowings ?? [])],
        nearestMechanismDistance: nearest.has(familyKey) ? (nearest.get(familyKey) as number) : null,
      }
      const bucket = candidatesByTier.get(tier)
      if (bucket) bucket.push(candidate)
      else candidatesByTier.set(tier, [candidate])
    }

    let totalCaughtOnlyByVector = 0
    for (const [tier, candidates] of Array.from(candidatesByTier.entries())) {
      const summary = summariseAddressing(candidates, headNoun, input.cut)
      totalCaughtOnlyByVector += summary.caughtOnlyByVector
      byTier[tier] = {
        admitting: summary.admitting,
        addressing: summary.addressing,
        lexicalOnly: summary.lexicalOnly,
        caughtOnlyByVector: summary.caughtOnlyByVector,
        unsolved: wilsonInterval(summary.admitting - summary.addressing, summary.admitting),
      }
    }

    const tier = primaryTier(byTier)
    if (!tier) continue
    const headline = byTier[tier]
    if (headline.admitting <= 0) continue

    // One pass over the members, not one per family: the naive nested form is
    // O(families x members) and a large component makes it millions of lookups
    // inside a stage that is otherwise arithmetic.
    const admittingFamilies = component.families
    const newestYearByFamily = new Map<string, number>()
    const applicants = new Set<string>()
    for (const id of component.members) {
      const node = input.nodeById.get(id)
      if (!node) continue
      if (node.applicantNorm) applicants.add(node.applicantNorm)
      if (node.filingYear === null) continue
      const current = newestYearByFamily.get(node.familyKey)
      if (current === undefined || node.filingYear > current) newestYearByFamily.set(node.familyKey, node.filingYear)
    }
    const recent = admittingFamilies.filter(familyKey => {
      const year = newestYearByFamily.get(familyKey)
      return year !== undefined && year >= currentYear - DEMAND_WINDOW_YEARS
    })
    const recentShare = admittingFamilies.length > 0 ? recent.length / admittingFamilies.length : 0
    const rank = rankUnsolved({
      admitting: headline.admitting,
      addressing: headline.addressing,
      recentShare,
      assigneeSpread: applicants.size,
    })

    const elements = normaliseElements(keyTerms(component.medoidText, 6))
    if (!elements) continue

    const object = headNoun ? `“${headNoun}”` : `“${component.medoidText.slice(0, 60)}”`
    const absence = absenceSentence({
      object,
      searchedFamilies: headline.admitting,
      ofFieldFamilies: input.familiesInField,
      tier,
    })

    const passages = component.members
      .slice(0, 5)
      .map(id => input.nodeById.get(id))
      .filter((node): node is StatementNode => Boolean(node))

    drafts.push({
      origin: 'UNSOLVED_PROBLEM',
      engine: 'unsolved',
      fingerprint: leadFingerprint(component.key, NO_MECHANISM),
      componentKey: component.key,
      fallbackTitle: component.medoidText.slice(0, MAX_LEAD_TITLE_CHARS),
      problemStatement: component.medoidText,
      // Null, deliberately: the engines found a problem and no mechanism in the
      // field to answer it. The gate records that as unassessed claimability
      // rather than inventing a mechanism to fill the gap.
      proposedMechanism: null,
      elements,
      rationale:
        `${absence} ${describeRate('Addressed', wilsonInterval(headline.addressing, headline.admitting))} ` +
        `${applicants.size} distinct applicants admit it, ${Math.round(recentShare * 100)}% of them filing in the ` +
        `last ${DEMAND_WINDOW_YEARS} years.`,
      signals: {
        engine: 'unsolved',
        tier,
        admitting: headline.admitting,
        addressing: headline.addressing,
        unsolvedRate: headline.unsolved,
        byTier,
        addressingUnion: {
          lexicalOnly: headline.lexicalOnly,
          caughtOnlyByVector: headline.caughtOnlyByVector,
          note:
            'A family counts as addressing the problem if EITHER its mechanism text names the problem object or ' +
            'its nearest mechanism vector falls within the component cut. The vector arm alone caught ' +
            `${totalCaughtOnlyByVector} famil${totalCaughtOnlyByVector === 1 ? 'y' : 'ies'} a text match would ` +
            'have missed, and each miss would have overstated how unsolved this is.',
        },
        recentShare: Math.round(recentShare * 1000) / 1000,
        assigneeSpread: applicants.size,
        rankScore: Math.round(rank.score * 10_000) / 10_000,
        widelyDiscussed: termCount ?? null,
        stale: false,
      },
      sourceRefs: {
        componentKey: component.key,
        medoidStatementId: component.medoidId,
        statements: component.members.slice(0, 20),
        publicationNumbers: passages.map(node => node.publicationNumber),
        families: admittingFamilies.slice(0, 40),
      },
      scores: {
        demand: Math.round(recentShare * 1000) / 1000,
        novelty: null,
        obviousnessRisk: null,
        exclusionRisk: null,
        claimability: null,
      },
      coverageLimitations: [
        absence,
        describeRate('Addressed', wilsonInterval(headline.addressing, headline.admitting)),
        termCount?.measured
          ? `Its key terms appear in ${termCount.hits.toLocaleString()} of ${termCount.countedFamilies.toLocaleString()} readable field families.`
          : 'The whole-field term count did not run for this problem, so the widely-discussed exclusion was not applied to it.',
        ...(component.splitFrom ? [bimodalityNote(component.splitFrom.groupA, component.splitFrom.groupB)] : []),
        LEADS_ARE_CANDIDATES,
      ],
      evidence: [
        {
          kind: 'STATISTIC',
          refId: null,
          passage: absence,
          stance: 'CONTEXT',
          data: {
            admitting: headline.admitting,
            addressing: headline.addressing,
            searchedFamilies: headline.admitting,
            ofFieldFamilies: input.familiesInField,
            tier,
            unsolvedRate: headline.unsolved,
          },
        },
        ...passages.map(node => ({
          kind: 'PATENT_PASSAGE' as const,
          refId: node.publicationNumber,
          passage: node.text,
          stance: 'CONTEXT' as const,
          data: { familyKey: node.familyKey, role: 'ADMITS_PROBLEM', tier: node.tier },
        })),
      ],
      rank: rank.score,
    })

    familiesMeasured += component.families.length
  }

  // ONE line, for the whole pass. A line per component would say how many
  // distinct problems this field has, which is a finding and belongs on the
  // result the user opens, not in the activity feed.
  input.reporter.event(
    'count',
    `${familiesMeasured.toLocaleString()} families checked for a mechanism directed at the problem they admit`
  )

  return {
    drafts: drafts.sort((a, b) => b.rank - a.rank),
    inputs: {
      componentsConsidered: considered.length,
      componentsRanked: drafts.length,
      excluded,
      exclusionRules: {
        genreConvention: 'a problem admitted by more than 40% of the families we read is what the genre recites',
        widelyDiscussed: 'key terms already present in more than 35% of the readable field families',
        noDomainNoun: 'a problem naming no technology outside the generic vocabulary every background uses',
      },
      addressingTest: 'union of a lexical head-noun match and a nearest-mechanism vector inside the component cut',
    },
  }
}

/**
 * Each family's nearest MECHANISM statement to each component's medoid.
 *
 * One query for every component: a VALUES list of medoid statement ids joined
 * back to the statement table for their vectors, cross-joined with the field's
 * mechanism statements. Bounded by (components × mechanisms), which the
 * component cap keeps at a few hundred thousand distance computations.
 */
async function nearestMechanismPerFamily(
  studyId: string,
  fingerprint: string,
  medoids: ReadonlyArray<{ key: string; medoidId: string }>
): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>()
  if (!medoids.length) return out

  try {
    const rows = await prisma.$transaction([
      prisma.$executeRaw`SELECT set_config('statement_timeout', ${String(ENGINE_TIMEOUT_MS)}, true)`,
      prisma.$executeRaw(statementIndexSettingsSql({ probes: 100, efSearch: 1_000 })),
      prisma.$queryRaw<Array<{ key: string; familyKey: string; dist: number }>>(Prisma.sql`
        WITH med AS (
          SELECT t.key AS key, ${statementColumnSql('s')} AS emb
          FROM unnest(${medoids.map(entry => entry.key)}::text[], ${medoids.map(
            entry => entry.medoidId
          )}::text[]) AS t(key, sid)
          JOIN "patent_problem_statements" s ON s."id" = t.sid
        ),
        mech AS MATERIALIZED (
          SELECT s."familyKey" AS family_key, ${statementColumnSql('s')} AS embedding
          FROM "patent_problem_statements" s
          JOIN "miner_field_publications" f
            ON f."publicationNumber" = s."publicationNumber"
           AND f."studyId" = ${studyId}
           AND f."scopeFingerprint" = ${fingerprint}
           AND f."sampled" = true
          WHERE s."kind" = 'MECHANISM'
            AND ${statementColumnSql('s')} IS NOT NULL
        )
        SELECT med.key AS key,
               mech.family_key AS "familyKey",
               MIN(${statementDistanceSql('mech', Prisma.sql`med.emb`)})::float8 AS dist
        FROM med CROSS JOIN mech
        GROUP BY med.key, mech.family_key`),
    ])
    for (const row of rows[2] as Array<{ key: string; familyKey: string; dist: number }>) {
      const bucket = out.get(String(row.key)) ?? new Map<string, number>()
      bucket.set(String(row.familyKey), Number(row.dist))
      out.set(String(row.key), bucket)
    }
  } catch (error) {
    // A missing vector arm makes the addressing test lexical-only, which
    // INFLATES the unsolved rate. The callers see an empty map and every
    // family's `nearestMechanismDistance` becomes null — recorded as
    // `withoutMechanismVector`, never as "beyond the cut".
    console.error('[Miner] Nearest-mechanism pass failed:', error instanceof Error ? error.message : error)
  }
  return out
}

// ---------------------------------------------------------------------------
// Engine (ii) — cross-domain transfer
// ---------------------------------------------------------------------------

interface TransferInput {
  studyId: string
  fingerprint: string
  components: readonly ProblemComponent[]
  nodeById: ReadonlyMap<string, StatementNode>
  fieldSubclasses: readonly string[]
  cut: number
  familiesInField: number
  readableFieldFamilies: number
  llmContext: WhitespaceLLMContext
  reporter: RunReporter
}

async function runTransferEngine(input: TransferInput): Promise<{
  drafts: LeadDraft[]
  inputs: Record<string, unknown>
  skipReason: string | null
  tokensUsed: { input: number; output: number }
  publicationsRead: number
  modelCode: string | null
}> {
  const empty = {
    drafts: [] as LeadDraft[],
    tokensUsed: { input: 0, output: 0 },
    publicationsRead: 0,
    modelCode: null as string | null,
  }
  if (!input.components.length) {
    return {
      ...empty,
      inputs: { componentsConsidered: 0 },
      skipReason: 'No problem component was large enough to search outside the field for.',
    }
  }

  // ------------------------------------------------------------------ retrieve
  const candidates = new Map<string, { componentKey: string; publicationNumber: string; distance: number }>()
  const retrieval: Array<Record<string, unknown>> = []
  for (const component of input.components) {
    const lane = await semanticNeighbors({
      queryText: component.medoidText,
      limit: NEIGHBOUR_LIMIT,
      timeoutMs: ENGINE_TIMEOUT_MS,
    })
    if (!lane.available) {
      retrieval.push({ componentKey: component.key, available: false, reason: lane.reason })
      continue
    }
    // Out of field BY CLASSIFICATION, not by distance — see transfer.ts.
    const classifications = await classificationsOf(lane.neighbors.map(neighbor => neighbor.publicationNumber))
    let kept = 0
    for (const neighbor of lane.neighbors) {
      if (sharesFieldSubclass(classifications.get(neighbor.publicationNumber) ?? [], input.fieldSubclasses)) continue
      if (candidates.has(neighbor.publicationNumber)) continue
      candidates.set(neighbor.publicationNumber, {
        componentKey: component.key,
        publicationNumber: neighbor.publicationNumber,
        distance: neighbor.distance,
      })
      kept += 1
    }
    retrieval.push({
      componentKey: component.key,
      available: true,
      returned: lane.neighbors.length,
      effectiveLimit: lane.effectiveLimit,
      outOfFieldKept: kept,
    })
    await input.reporter.heartbeat()
  }

  if (!candidates.size) {
    return {
      ...empty,
      inputs: { componentsConsidered: input.components.length, retrieval, outOfFieldCandidates: 0 },
      skipReason:
        'Every publication the abstract index returned for this field’s problems shares a classification with the ' +
        'field, so there was nothing outside it to read.',
    }
  }

  // -------------------------------------------------------------- mini-harvest
  const publicationNumbers = Array.from(candidates.keys()).slice(0, MINI_HARVEST_CAP)
  input.reporter.event('read', `Reading ${publicationNumbers.length} publications outside this field`)
  const harvested = await runMiniHarvest({
    publicationNumbers,
    reporter: input.reporter,
    llmContext: input.llmContext,
    cap: MINI_HARVEST_CAP,
  })

  // --------------------------------------------------------------- gate + rank
  const componentByKey = new Map(input.components.map(component => [component.key, component]))
  const proposals: Array<{
    component: ProblemComponent
    publicationNumber: string
    title: string
    mechanism: string
    mechanismElements: string[]
    sourceProblem: string
    subclasses: string[]
    distance: number
  }> = []

  for (const reading of harvested.readings) {
    const candidate = candidates.get(reading.publicationNumber)
    const component = candidate ? componentByKey.get(candidate.componentKey) : null
    if (!component || !reading.extraction) continue
    const sourceProblem = reading.extraction.problems[0]?.statement
    const mechanism = reading.extraction.mechanisms[0]
    if (!sourceProblem || !mechanism?.statement) continue
    proposals.push({
      component,
      publicationNumber: reading.publicationNumber,
      title: reading.title,
      mechanism: mechanism.statement,
      mechanismElements: mechanism.elements ?? [],
      sourceProblem,
      subclasses: reading.cpcSubclasses,
      distance: candidate?.distance ?? 1,
    })
  }

  // The two measured gates, batched: whole-field term counts for every proposed
  // mechanism, and the field's nearest mechanism vector to each of them.
  const termCounts = await countFieldTerms(
    input.studyId,
    input.fingerprint,
    proposals.map((proposal, index) => ({
      key: `t${index}`,
      query: keyTerms(proposal.mechanism, 3).map(term => `"${term}"`).join(' '),
    }))
  )
  const nearest = await nearestFieldMechanismToTexts(
    input.studyId,
    input.fingerprint,
    proposals.map((proposal, index) => ({ key: `t${index}`, statement: proposal.mechanism }))
  )
  await input.reporter.heartbeat()

  const drafts: LeadDraft[] = []
  const refusals: Record<string, number> = {}
  for (let index = 0; index < proposals.length; index++) {
    const proposal = proposals[index]
    const termCount = termCounts.get(`t${index}`)
    const gate = gateTransferCandidate({
      targetHeadNoun: problemHeadNoun(proposal.component.medoidText),
      sourceHeadNoun: problemHeadNoun(proposal.sourceProblem),
      nearestInFieldMechanismDistance: nearest.get(`t${index}`) ?? null,
      cut: input.cut,
      fieldTermHits: termCount?.measured
        ? { hits: termCount.hits, countedFamilies: termCount.countedFamilies }
        : null,
    })
    if (!gate.admitted) {
      refusals[gate.refusal as string] = (refusals[gate.refusal as string] ?? 0) + 1
      continue
    }

    const elements = normaliseElements(
      proposal.mechanismElements.length ? proposal.mechanismElements : keyTerms(proposal.mechanism, 6)
    )
    if (!elements) continue

    const condition = enablingCondition({
      mechanism: proposal.mechanism,
      sourceSubclasses: proposal.subclasses,
      targetSubclasses: input.fieldSubclasses,
    })
    const absence = absenceSentence({
      object: `“${proposal.mechanism.slice(0, 80)}”`,
      searchedFamilies: termCount?.countedFamilies ?? 0,
      ofFieldFamilies: input.familiesInField,
      tier: 'the tiers listed in this study’s coverage',
    })

    drafts.push({
      origin: 'CROSS_DOMAIN_TRANSFER',
      engine: 'transfer',
      fingerprint: leadFingerprint(proposal.component.key, statementTextHash(proposal.mechanism)),
      componentKey: proposal.component.key,
      fallbackTitle: proposal.mechanism.slice(0, MAX_LEAD_TITLE_CHARS),
      problemStatement: proposal.component.medoidText,
      proposedMechanism: proposal.mechanism,
      elements,
      rationale:
        `${proposal.publicationNumber} solves a comparable problem (“${proposal.sourceProblem.slice(0, 120)}”) with ` +
        `${proposal.mechanism}. It is classified outside this field (${proposal.subclasses.join(', ') || 'no shared subclass'}), ` +
        `and ${gate.detail} ${condition}`,
      signals: {
        engine: 'transfer',
        sourcePublication: proposal.publicationNumber,
        sourceSubclasses: proposal.subclasses,
        fieldSubclasses: input.fieldSubclasses,
        objectClass: { source: gate.sourceClass, target: gate.targetClass },
        nearestInFieldMechanismDistance: nearest.get(`t${index}`) ?? null,
        cut: input.cut,
        fieldTermHits: termCount ?? null,
        enablingCondition: condition,
        stale: false,
      },
      sourceRefs: {
        componentKey: proposal.component.key,
        publicationNumbers: [proposal.publicationNumber],
        outOfFieldPublication: proposal.publicationNumber,
      },
      scores: { demand: null, novelty: null, obviousnessRisk: null, exclusionRisk: null, claimability: null },
      coverageLimitations: [
        absence,
        `Read outside the field: ${harvested.read} publications retrieved by meaning from the abstract index and ` +
          `classified outside ${input.fieldSubclasses.join(', ')}. Their text was read at the same tiers as the field.`,
        condition,
        ...(proposal.component.splitFrom
          ? [bimodalityNote(proposal.component.splitFrom.groupA, proposal.component.splitFrom.groupB)]
          : []),
        LEADS_ARE_CANDIDATES,
      ],
      evidence: [
        {
          kind: 'STATISTIC',
          refId: null,
          passage: absence,
          stance: 'CONTEXT',
          data: {
            fieldTermHits: termCount?.hits ?? null,
            countedFamilies: termCount?.countedFamilies ?? null,
            ofFieldFamilies: input.familiesInField,
            nearestInFieldMechanismDistance: nearest.get(`t${index}`) ?? null,
            cut: input.cut,
          },
        },
        {
          kind: 'PATENT_PASSAGE',
          refId: proposal.publicationNumber,
          passage: `${proposal.sourceProblem} — ${proposal.mechanism}`,
          stance: 'CONTEXT',
          data: { role: 'SOURCE_MECHANISM', title: proposal.title, subclasses: proposal.subclasses },
        },
      ],
      // Nearer source problems first: the retrieval distance is the only
      // measured ordering available here, and it is recorded as such.
      rank: 1 - proposal.distance,
    })
  }

  return {
    drafts: drafts.sort((a, b) => b.rank - a.rank),
    inputs: {
      componentsConsidered: input.components.length,
      retrieval,
      outOfFieldCandidates: candidates.size,
      publicationsRead: harvested.read,
      extracted: harvested.extracted,
      cacheHits: harvested.cacheHits,
      failedBatches: harvested.failedBatches,
      proposals: proposals.length,
      refusals,
      fieldSubclasses: input.fieldSubclasses,
    },
    skipReason: null,
    tokensUsed: harvested.tokensUsed,
    publicationsRead: harvested.read,
    modelCode: harvested.modelCode,
  }
}

/** CPC/IPC subclass prefixes for a list of publications. */
async function classificationsOf(publicationNumbers: readonly string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  if (!publicationNumbers.length) return out
  for (const batch of chunk(publicationNumbers, DB_CHUNK)) {
    const rows = await prisma.localPatent.findMany({
      where: { publicationNumber: { in: [...batch] } },
      select: { publicationNumber: true, classifications: true },
    })
    for (const row of rows) out.set(row.publicationNumber, cpcSubclassPrefixes(row.classifications))
  }
  return out
}

/**
 * The distance from each supplied mechanism text to the field's NEAREST
 * mechanism statement.
 *
 * The texts are embedded DOCUMENT-side (embedStatementProbe), because both
 * sides of this comparison are statements — see embed.ts. Embedding them as
 * queries would offset every probe from the whole index by a constant larger
 * than the differences being measured, and every mechanism would read as new to
 * the field.
 */
async function nearestFieldMechanismToTexts(
  studyId: string,
  fingerprint: string,
  entries: ReadonlyArray<{ key: string; statement: string }>
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (!entries.length) return out
  const { embedStatements } = await import('./embed')
  const { statementVectorLiteralSql } = await import('./vector-sql')
  const literals = await embedStatements(entries.map(entry => entry.statement))

  const usable = entries
    .map((entry, index) => ({ ...entry, literal: literals[index] }))
    .filter((entry): entry is { key: string; statement: string; literal: string } => Boolean(entry.literal))
  if (!usable.length) return out

  for (const batch of chunk(usable, 50)) {
    try {
      const rows = await prisma.$transaction([
        prisma.$executeRaw`SELECT set_config('statement_timeout', ${String(ENGINE_TIMEOUT_MS)}, true)`,
        prisma.$executeRaw(statementIndexSettingsSql({ probes: 100, efSearch: 1_000 })),
        prisma.$queryRaw<Array<{ key: string; dist: number }>>(Prisma.sql`
          WITH probe(key, emb) AS (
            VALUES ${Prisma.join(
              // ::text, or Postgres cannot infer the VALUES column's type from an
              // untyped bind parameter and refuses to plan the statement.
              batch.map(entry => Prisma.sql`(${entry.key}::text, ${statementVectorLiteralSql(entry.literal)})`),
              ', '
            )}
          ),
          mech AS MATERIALIZED (
            SELECT ${statementColumnSql('s')} AS embedding
            FROM "patent_problem_statements" s
            JOIN "miner_field_publications" f
              ON f."publicationNumber" = s."publicationNumber"
             AND f."studyId" = ${studyId}
             AND f."scopeFingerprint" = ${fingerprint}
             AND f."sampled" = true
            WHERE s."kind" = 'MECHANISM'
              AND ${statementColumnSql('s')} IS NOT NULL
          )
          SELECT probe.key AS key,
                 MIN(${statementDistanceSql('mech', Prisma.sql`probe.emb`)})::float8 AS dist
          FROM probe CROSS JOIN mech
          GROUP BY probe.key`),
      ])
      for (const row of rows[2] as Array<{ key: string; dist: number }>) {
        out.set(String(row.key), Number(row.dist))
      }
    } catch (error) {
      // Left unmeasured, which the gate refuses on. See gateTransferCandidate.
      console.error('[Miner] Nearest in-field mechanism probe failed:', error instanceof Error ? error.message : error)
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Engine (iii) — dependent-claim frontier
// ---------------------------------------------------------------------------

interface FrontierInput {
  studyId: string
  fingerprint: string
  claimScopes: ReadonlyMap<string, ClaimScope>
  componentByFamily: ReadonlyMap<string, string[]>
  componentsByKey: ReadonlyMap<string, ProblemComponent>
  cut: number
  tierByPublication: ReadonlyMap<string, TextTier>
  familiesInField: number
  reporter: RunReporter
}

async function runFrontierEngine(
  input: FrontierInput
): Promise<{ drafts: LeadDraft[]; inputs: Record<string, unknown>; skipReason: string | null }> {
  const families: FrontierFamily[] = Array.from(input.claimScopes.values()).map(scope => ({
    familyKey: scope.familyKey,
    coreElements: scope.independentElements,
    narrowings: scope.dependentNarrowings,
  }))
  const eligible = eligibleFamilies(families)

  const inputs: Record<string, unknown> = {
    familiesWithClaimedScope: families.length,
    familiesWithEnoughNarrowings: eligible.length,
    minNarrowingsPerFamily: MIN_NARROWINGS_PER_FAMILY,
    minGroupFamilies: MIN_FRONTIER_GROUP_FAMILIES,
  }

  // The floor is on NARROWINGS, not on claims — see frontier.ts decision 2.
  if (eligible.length < MIN_FRONTIER_GROUP_FAMILIES) {
    return { drafts: [], inputs, skipReason: NO_NARROWINGS_SKIP }
  }

  // Groups come from the CLAIM_CORE vector at the SAME cut as the problem
  // graph; Jaccard is only a tie-break. See frontier.ts decision 1.
  const coreNodes = await loadStatementNodes(
    input.studyId,
    input.fingerprint,
    'CLAIM_CORE',
    GRAPH_STATEMENT_CAP,
    input.tierByPublication
  )
  const eligibleKeys = new Set(eligible.map(family => family.familyKey))
  const usableCores = coreNodes.filter(node => eligibleKeys.has(node.familyKey))
  inputs.claimCoreStatements = usableCores.length

  let groups: string[][] = []
  if (usableCores.length >= MIN_FRONTIER_GROUP_FAMILIES) {
    let coreEdges: StatementEdge[] = []
    try {
      coreEdges = await knnEdges(usableCores.map(node => node.id), GRAPH_K)
    } catch (error) {
      console.error('[Miner] Claim-core graph failed:', error instanceof Error ? error.message : error)
    }
    const byId = new Map(usableCores.map(node => [node.id, node]))
    groups = connectedComponents(usableCores.map(node => node.id), coreEdges, input.cut)
      .map(component =>
        Array.from(new Set(component.members.map(id => byId.get(id)?.familyKey).filter(Boolean) as string[]))
      )
      .filter(members => members.length >= MIN_FRONTIER_GROUP_FAMILIES)
  }
  await input.reporter.heartbeat()

  if (!groups.length) return { drafts: [], inputs, skipReason: NO_GROUP_SKIP }

  const byFamily = new Map(eligible.map(family => [family.familyKey, family]))
  const drafts: LeadDraft[] = []
  const inspected: Array<Record<string, unknown>> = []
  let withoutProblem = 0

  for (const group of groups.slice(0, FRONTIER_GROUPS)) {
    const members = group
      .map(familyKey => byFamily.get(familyKey))
      .filter((family): family is FrontierFamily => Boolean(family))
    const pairs = frontierPairs(members)
    inspected.push({ groupSize: members.length, unclaimedPairs: pairs.length })
    if (!pairs.length) continue

    // A frontier lead MUST join a problem component. Without one the gate's
    // inventive-step step has to invent an objective technical problem, which
    // is exactly the theatre the design forbids — so a group whose families
    // admit no problem we grouped produces no lead at all.
    const tally = new Map<string, number>()
    for (const family of members) {
      for (const componentKey of input.componentByFamily.get(family.familyKey) ?? []) {
        tally.set(componentKey, (tally.get(componentKey) ?? 0) + 1)
      }
    }
    const best = Array.from(tally.entries()).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]
    const component = best ? input.componentsByKey.get(best[0]) : null
    if (!component) {
      withoutProblem += 1
      continue
    }

    // Jaccard as the TIE-BREAK only: which of the group's families is most
    // representative of its core, for the passage evidence.
    const representative = [...members].sort((a, b) => {
      const scoreOf = (family: FrontierFamily) =>
        members.reduce((sum, other) => sum + (other === family ? 0 : jaccard(family.coreElements, other.coreElements)), 0)
      return scoreOf(b) - scoreOf(a) || (a.familyKey < b.familyKey ? -1 : 1)
    })[0]

    const pair = pairs[0]
    const elements = normaliseElements([
      ...(representative?.coreElements ?? []).slice(0, 4),
      pair.a,
      pair.b,
    ])
    if (!elements) continue

    const mechanism = `${pair.a}; ${pair.b}`
    const absence = absenceSentence({
      object: `the combination of “${pair.a}” and “${pair.b}”`,
      searchedFamilies: members.length,
      ofFieldFamilies: input.familiesInField,
      tier: 'the claim text we could read',
    })

    drafts.push({
      origin: 'CLAIM_FRONTIER',
      engine: 'frontier',
      fingerprint: leadFingerprint(component.key, statementTextHash(mechanism)),
      componentKey: component.key,
      fallbackTitle: `${pair.a} with ${pair.b}`.slice(0, MAX_LEAD_TITLE_CHARS),
      problemStatement: component.medoidText,
      proposedMechanism: mechanism,
      elements,
      rationale:
        `Within a group of ${members.length} families sharing a claim core, ${pair.supportA} claim “${pair.a}” and ` +
        `${pair.supportB} claim “${pair.b}”, and none claims both — ${Math.round(pair.expected * 10) / 10} would be ` +
        `expected under independence (${Math.round(pair.surprisal * 10) / 10} dB of surprise). ${FRONTIER_BADGE}`,
      signals: {
        engine: 'frontier',
        groupSize: members.length,
        pair: { a: pair.a, b: pair.b },
        supportA: pair.supportA,
        supportB: pair.supportB,
        observed: pair.observed,
        expected: pair.expected,
        // Ranked on surprisal, not rarity: rarity saturates at 1.0 for any
        // empty cell and cannot order these. See rarity.ts.
        surprisal: pair.surprisal,
        rarity: pair.rarity,
        badge: FRONTIER_BADGE,
        stale: false,
      },
      sourceRefs: {
        componentKey: component.key,
        families: group.slice(0, 40),
        publicationNumbers: group
          .map(familyKey => input.claimScopes.get(familyKey)?.publicationNumber)
          .filter((value): value is string => Boolean(value))
          .slice(0, 10),
      },
      scores: { demand: null, novelty: null, obviousnessRisk: null, exclusionRisk: null, claimability: null },
      coverageLimitations: [
        FRONTIER_BADGE,
        absence,
        `Measured over ${members.length} families that carry ${MIN_NARROWINGS_PER_FAMILY} or more dependent ` +
          `narrowings in the claim text we could read, of ${input.familiesInField.toLocaleString()} in the field.`,
        LEADS_ARE_CANDIDATES,
      ],
      evidence: [
        {
          kind: 'STATISTIC',
          refId: null,
          passage: absence,
          stance: 'CONTEXT',
          data: {
            groupSize: members.length,
            supportA: pair.supportA,
            supportB: pair.supportB,
            observed: 0,
            expected: pair.expected,
            surprisal: pair.surprisal,
            ofFieldFamilies: input.familiesInField,
          },
        },
        ...group
          .slice(0, 4)
          .map(familyKey => input.claimScopes.get(familyKey))
          .filter((scope): scope is ClaimScope => Boolean(scope))
          .map(scope => ({
            kind: 'PATENT_PASSAGE' as const,
            refId: scope.publicationNumber,
            passage: scope.independentElements.join('; '),
            stance: 'CONTEXT' as const,
            data: { familyKey: scope.familyKey, role: 'CLAIM_CORE', tier: scope.tier },
          })),
      ],
      rank: pair.surprisal,
    })
  }

  inputs.groups = inspected
  inputs.groupsWithoutAProblemComponent = withoutProblem
  return { drafts: drafts.sort((a, b) => b.rank - a.rank), inputs, skipReason: null }
}

// ---------------------------------------------------------------------------
// Engine (iv) — expiry frontier
// ---------------------------------------------------------------------------

function runExpiryEngine(input: {
  components: readonly ProblemComponent[]
  nodeById: ReadonlyMap<string, StatementNode>
  familiesInField: number
  sampledFamilies: number
  referenceYear: number
}): { drafts: LeadDraft[]; inputs: Record<string, unknown>; skipReason: string | null } {
  const families: ExpiryFamily[] = []
  const byComponent = new Map(input.components.map(component => [component.key, component]))
  for (const component of input.components) {
    const yearByFamily = new Map<string, number | null>()
    for (const id of component.members) {
      const node = input.nodeById.get(id)
      if (!node) continue
      const current = yearByFamily.get(node.familyKey)
      // Oldest filing year in the family: the term runs from the earliest
      // filing, and taking the newest would make every continuation look young.
      if (current === undefined || (node.filingYear !== null && (current === null || node.filingYear < current))) {
        yearByFamily.set(node.familyKey, node.filingYear)
      }
    }
    for (const [familyKey, filingYear] of Array.from(yearByFamily.entries())) {
      families.push({ familyKey, componentId: component.key, filingYear })
    }
  }

  const groups = groupByExpiry(families, input.referenceYear)
  const publishable = publishableExpiryGroups(groups)
  const inputs: Record<string, unknown> = {
    componentsConsidered: input.components.length,
    horizonYears: EXPIRY_HORIZON_YEARS,
    demandWindowYears: DEMAND_WINDOW_YEARS,
    referenceYear: input.referenceYear,
    groupsMeasured: groups.length,
    groupsPublishable: publishable.length,
    undatedFamilies: groups.reduce((sum, group) => sum + group.undated.length, 0),
  }
  if (!publishable.length) {
    return {
      drafts: [],
      inputs,
      skipReason:
        `No problem in this field is admitted by ${EXPIRY_HORIZON_YEARS}-year-old families AND still filed about in ` +
        `the last ${DEMAND_WINDOW_YEARS} years, so there is no platform nearing the end of protection to report. ` +
        'Note that we hold no filing date at all for EP publications added by the bulk import, and those families ' +
        'are on neither side of that line.',
    }
  }

  const drafts: LeadDraft[] = []
  for (const group of publishable.slice(0, EXPIRY_LEADS)) {
    const component = byComponent.get(group.componentId)
    if (!component) continue
    const elements = normaliseElements(keyTerms(component.medoidText, 6))
    if (!elements) continue

    const lines = expiryCoverageLines({
      expiring: group.expiring.length,
      demand: group.demand.length,
      undated: group.undated.length,
      referenceYear: input.referenceYear,
    })
    const absence = absenceSentence({
      object: `“${problemHeadNoun(component.medoidText) ?? component.medoidText.slice(0, 60)}”`,
      searchedFamilies: component.families.length,
      ofFieldFamilies: input.familiesInField,
      tier: 'the tiers listed in this study’s coverage',
    })
    const demandRate = wilsonInterval(group.demand.length, component.families.length)

    drafts.push({
      origin: 'EXPIRY_FRONTIER',
      engine: 'expiry',
      fingerprint: leadFingerprint(component.key, NO_MECHANISM),
      componentKey: component.key,
      fallbackTitle: component.medoidText.slice(0, MAX_LEAD_TITLE_CHARS),
      problemStatement: component.medoidText,
      proposedMechanism: null,
      elements,
      rationale:
        `${group.expiring.length} families admitting this problem were filed ${EXPIRY_HORIZON_YEARS}+ years ago and ` +
        `${group.demand.length} in the last ${DEMAND_WINDOW_YEARS} years. ${lines[0]} ${lines[1]}`,
      signals: {
        engine: 'expiry',
        expiringFamilies: group.expiring.length,
        demandFamilies: group.demand.length,
        undatedFamilies: group.undated.length,
        demandRate,
        horizonYears: EXPIRY_HORIZON_YEARS,
        demandWindowYears: DEMAND_WINDOW_YEARS,
        stale: false,
      },
      sourceRefs: {
        componentKey: component.key,
        families: group.expiring.slice(0, 40),
        publicationNumbers: component.members
          .map(id => input.nodeById.get(id)?.publicationNumber)
          .filter((value): value is string => Boolean(value))
          .slice(0, 10),
      },
      scores: {
        demand: component.families.length ? Math.round((group.demand.length / component.families.length) * 1000) / 1000 : null,
        novelty: null,
        obviousnessRisk: null,
        exclusionRisk: null,
        claimability: null,
      },
      coverageLimitations: [...lines, absence, LEADS_ARE_CANDIDATES],
      evidence: [
        {
          kind: 'STATISTIC',
          refId: null,
          passage:
            `${group.expiring.length} of ${component.families.length} families admitting this problem were filed in ` +
            `or before ${input.referenceYear - EXPIRY_HORIZON_YEARS}; ${group.demand.length} were filed in the last ` +
            `${DEMAND_WINDOW_YEARS} years.`,
          stance: 'CONTEXT',
          data: {
            expiring: group.expiring.length,
            demand: group.demand.length,
            undated: group.undated.length,
            searchedFamilies: component.families.length,
            ofFieldFamilies: input.familiesInField,
          },
        },
      ],
      rank: Math.min(group.expiring.length, group.demand.length),
    })
  }

  return { drafts: drafts.sort((a, b) => b.rank - a.rank), inputs, skipReason: null }
}

// ---------------------------------------------------------------------------
// Selection, naming, persistence
// ---------------------------------------------------------------------------

/**
 * Dedupe across engines by fingerprint, cap per engine and overall.
 *
 * The first engine to claim a fingerprint keeps it. A later engine's candidate
 * on the same problem is FOLDED IN rather than dropped: its coverage lines are
 * appended to the survivor and the engine is recorded in `signals.alsoFoundBy`.
 * That matters because the expiry engine's two mandatory sentences (no legal
 * status; an expired patent is still prior art) must not disappear because an
 * unsolved-problem lead on the same component happened to be written first.
 */
export function selectLeads(drafts: readonly LeadDraft[], engines: EngineReport[]): LeadDraft[] {
  const byFingerprint = new Map<string, LeadDraft>()
  const perEngine = new Map<string, number>()
  const report = (key: EngineReport['key']) => engines.find(engine => engine.key === key)

  // Engine order is the order the drafts arrive in, which is the order the
  // stage runs them: unsolved, transfer, frontier, expiry.
  for (const draft of drafts) {
    const existing = byFingerprint.get(draft.fingerprint)
    if (existing) {
      const seen = new Set(existing.coverageLimitations)
      for (const line of draft.coverageLimitations) if (!seen.has(line)) existing.coverageLimitations.push(line)
      const alsoFoundBy = (existing.signals.alsoFoundBy as string[] | undefined) ?? []
      if (!alsoFoundBy.includes(draft.origin)) alsoFoundBy.push(draft.origin)
      existing.signals.alsoFoundBy = alsoFoundBy
      const engine = report(draft.engine)
      if (engine) engine.deduped += 1
      continue
    }
    const used = perEngine.get(draft.engine) ?? 0
    if (used >= LEADS_PER_ENGINE) continue
    if (byFingerprint.size >= LEADS_TOTAL) continue
    perEngine.set(draft.engine, used + 1)
    byFingerprint.set(draft.fingerprint, draft)
  }

  const selected = Array.from(byFingerprint.values())
  for (const draft of selected) {
    const engine = report(draft.engine)
    if (engine) engine.leads += 1
  }
  return selected
}

/**
 * One cheap model call names up to 24 leads.
 *
 * Any failure falls back to the component medoid. A lead is a measurement; its
 * title is a convenience, and failing the whole stage — after four engines and
 * a mini-harvest — because a naming call timed out would throw away everything
 * that was actually measured.
 */
async function nameLeads(
  leads: readonly LeadDraft[],
  context: WhitespaceLLMContext,
  resolvedModels: Record<string, string>
): Promise<{ leads: Array<LeadDraft & { title: string }>; tokensUsed: { input: number; output: number } }> {
  const withFallback = leads.map(lead => ({ ...lead, title: lead.fallbackTitle }))
  if (!leads.length) return { leads: withFallback, tokensUsed: { input: 0, output: 0 } }

  try {
    const response = await runMinerLLM({
      taskCode: TaskCode.IM_EXTRACT,
      stageCode: MINER_LEAD_TITLES_STAGE_CODE,
      prompt: buildLeadTitlePrompt(
        leads.map((lead, index) => ({
          index,
          origin: lead.origin,
          problem: lead.problemStatement,
          mechanism: lead.proposedMechanism,
          elements: lead.elements,
        }))
      ),
      context,
    })
    resolvedModels[MINER_LEAD_TITLES_STAGE_CODE] = response.modelCode
    const parsed = parseModelJson<{ titles?: Array<{ index?: unknown; title?: unknown }> }>(
      response.output,
      'Miner lead titles'
    )
    for (const entry of parsed.titles ?? []) {
      const index = Number(entry.index)
      const title = String(entry.title ?? '').replace(/\s+/g, ' ').trim()
      if (!Number.isInteger(index) || index < 0 || index >= withFallback.length) continue
      if (!title) continue
      withFallback[index].title = title.slice(0, MAX_LEAD_TITLE_CHARS)
    }
    return {
      leads: withFallback,
      tokensUsed: { input: response.inputTokens, output: response.outputTokens },
    }
  } catch (error) {
    console.error('[Miner] Lead naming failed; using medoids:', error instanceof Error ? error.message : error)
    return { leads: withFallback, tokensUsed: { input: 0, output: 0 } }
  }
}

/**
 * Every lead, in ONE transaction, at the very end of the stage.
 *
 * Upserted on (studyId, fingerprint), and the update path touches NONE of
 * `humanReview`, `gate`, `brief` or `status`. Those are the attorney's work and
 * the previous screen's verdict; a re-run re-measures the numbers and must not
 * reset the review that was made against them. A lead that this run did not
 * produce is not deleted either — it is marked stale in `signals`, so a verdict
 * reached against a field that no longer holds it stops being presented as
 * current without the reasoning being thrown away.
 *
 * One transaction because a half-written lead set is worse than none: the
 * engines are ranked against each other, and a partial write would show a list
 * whose ordering nothing produced.
 *
 * Exported for the test that guards the preservation contract. That test is not
 * optional decoration: "the re-run kept the attorney's review" is invisible in
 * every other way until someone loses a week of review, and the field that
 * loses it is one word added to an update payload.
 */
export async function writeLeads(input: {
  studyId: string
  runId: string
  fingerprint: string
  leads: ReadonlyArray<LeadDraft & { title: string }>
}): Promise<{ written: number; stale: number }> {
  const fingerprints = input.leads.map(lead => lead.fingerprint)

  return prisma.$transaction(
    async tx => {
      let written = 0
      for (const lead of input.leads) {
        const measured = {
          runId: input.runId,
          scopeFingerprint: input.fingerprint,
          origin: lead.origin,
          title: lead.title,
          problemStatement: lead.problemStatement,
          proposedMechanism: lead.proposedMechanism,
          elements: lead.elements as unknown as Prisma.InputJsonValue,
          rationale: lead.rationale,
          signals: lead.signals as unknown as Prisma.InputJsonValue,
          sourceRefs: lead.sourceRefs as unknown as Prisma.InputJsonValue,
          scores: lead.scores as unknown as Prisma.InputJsonValue,
          coverageLimitations: lead.coverageLimitations as unknown as Prisma.InputJsonValue,
        }
        const row = await tx.inventionLead.upsert({
          where: { studyId_fingerprint: { studyId: input.studyId, fingerprint: lead.fingerprint } },
          // The update deliberately omits humanReview, gate, brief and status.
          update: measured,
          create: {
            studyId: input.studyId,
            fingerprint: lead.fingerprint,
            status: 'CANDIDATE',
            ...measured,
          },
          select: { id: true },
        })
        written += 1

        // Machine-produced evidence is replaced; USER evidence is never touched.
        await tx.whitespaceEvidence.deleteMany({
          where: { leadId: row.id, kind: { in: ['STATISTIC', 'PATENT_PASSAGE'] } },
        })
        if (lead.evidence.length) {
          await tx.whitespaceEvidence.createMany({
            data: lead.evidence.map(entry => ({
              studyId: input.studyId,
              leadId: row.id,
              kind: entry.kind,
              refId: entry.refId,
              passage: entry.passage,
              stance: entry.stance,
              data: (entry.data ?? {}) as unknown as Prisma.InputJsonValue,
            })),
          })
        }
      }

      // Leads this run did not produce: stale, not deleted.
      const absent = await tx.inventionLead.findMany({
        // The sentinel matters: Prisma's `notIn: []` matches NOTHING, so a run
        // that wrote no leads would silently leave every stale lead reading as
        // current. A NUL can never be one of these 32-hex-character handles.
        where: { studyId: input.studyId, fingerprint: { notIn: fingerprints.length ? fingerprints : ['\u0000'] } },
        select: { id: true, signals: true },
      })
      for (const lead of absent) {
        const signals = (lead.signals && typeof lead.signals === 'object' ? lead.signals : {}) as Record<string, unknown>
        if (signals.stale === true) continue
        await tx.inventionLead.update({
          where: { id: lead.id },
          data: {
            signals: {
              ...signals,
              stale: true,
              staleReason:
                'This lead was not produced by the most recent engines run for this scope. Its measurements are ' +
                'from an earlier reading of the field.',
              staleAt: new Date().toISOString(),
            } as unknown as Prisma.InputJsonValue,
          },
        })
      }

      return { written, stale: absent.length }
    },
    { timeout: 120_000, maxWait: 20_000 }
  )
}

/** Every lead of this study marked stale, for a run that produced none. */
async function markAllLeadsStale(studyId: string): Promise<number> {
  const leads = await prisma.inventionLead.findMany({ where: { studyId }, select: { id: true, signals: true } })
  let marked = 0
  for (const lead of leads) {
    const signals = (lead.signals && typeof lead.signals === 'object' ? lead.signals : {}) as Record<string, unknown>
    if (signals.stale === true) continue
    await prisma.inventionLead.update({
      where: { id: lead.id },
      data: {
        signals: {
          ...signals,
          stale: true,
          staleReason:
            'The most recent engines run for this scope produced no leads, so nothing here has been re-measured ' +
            'against the current field.',
          staleAt: new Date().toISOString(),
        } as unknown as Prisma.InputJsonValue,
      },
    })
    marked += 1
  }
  return marked
}
