/**
 * Whitespace Studio — report model.
 *
 * The one place that decides WHAT a whitespace report says. Pure: it takes rows
 * that have already been loaded and returns a fully-resolved document model, so
 * every editorial judgment in the deliverable — what counts as the latest run,
 * which findings are stale, how gaps rank, which caveats travel with which
 * number — is unit-testable without a database or a Word parser. The renderer
 * downstream only decides how it looks.
 *
 * This split follows the novelty attorney report (buildNoveltyAttorneyReportModel),
 * where it has already paid for itself once: two renderers, one set of facts.
 *
 * Two rules are load-bearing here and are enforced in code rather than left to
 * the renderer's discretion:
 *
 *  1. A section with no measurement is ABSENT, never zero-filled. A report that
 *     prints "0 areas" where a stage never ran is claiming a finding it does not
 *     have.
 *  2. Every extrapolated or proxied number carries its qualifier as data, so a
 *     renderer cannot print the figure and drop the caveat.
 */

import { formatFirmAddressLines, type FirmBranding } from '@/lib/novelty-attorney-report'
import {
  GATE_LABEL,
  GATE_OUTCOME_LABEL,
  OUTCOME_LABEL,
  REVIEW_LABEL,
  REVIEW_MEANING,
  STAGE_LABEL,
  STATUS_LABEL,
  STRATEGY_LABEL,
  TYPE_LABEL,
} from './labels'
import {
  scopeMatching,
  type AttackRecord,
  type DimensionGap,
  type DimensionMapResult,
  type FieldMapResult,
  type FieldRule,
  type GateOutcome,
  type HumanReview,
  type HypothesisScores,
  type RarePair,
  type SignalsStageResult,
  type TermDivergence,
  type ValidationRecord,
  type WhitespaceScope,
} from './types'
import { fieldRuleNote, rungPhrase } from './field-rule'

// ---------------------------------------------------------------------------
// Input — the already-loaded rows
// ---------------------------------------------------------------------------

export interface ReportStudyRow {
  id: string
  title: string
  kind: string
  scopeVersion: number
  createdAt: Date | string
  inventionJson: unknown
}

export interface ReportRunRow {
  id: string
  stage: string
  status: string
  scopeVersion: number
  durationMs: number | null
  lastError: string | null
  createdAt: Date | string
  completedAt: Date | string | null
}

export interface ReportClusterRow {
  id: string
  label: string
  description: string | null
  keywords: string[]
  memberCount: number
  fieldEstimate: number
  cohesion: number | null
  separation: number | null
  silhouette: number | null
  metrics: unknown
}

export interface ReportAreaRow {
  clusterId: string
  status: string
  textCoverage: unknown
  results: unknown
}

export interface ReportHypothesisRow {
  id: string
  clusterId: string | null
  type: string
  statement: string
  rationale: string
  status: string
  elementCombination: unknown
  scores: unknown
  validation: unknown
  coverageLimitations: unknown
  humanReview: unknown
  createdAt: Date | string
  evidence: Array<{
    kind: string
    stance: string
    refId: string | null
    passage: string | null
    queryText: string | null
  }>
}

export interface ReportConceptRow {
  id: string
  hypothesisId: string | null
  title: string
  summary: string
  status: string
  features: unknown
}

export interface ReportTrailRow {
  kind: string
  actor: string
  summary: string
  createdAt: Date | string
}

export interface WhitespaceReportInput {
  study: ReportStudyRow
  scope: WhitespaceScope
  preparedBy: string
  firm: FirmBranding | null
  runs: ReportRunRow[]
  /** Results of the latest COMPLETED run of each stage the report renders. */
  stageResults: {
    fieldMap?: { results: unknown; scopeVersion: number } | null
    signals?: { results: unknown; scopeVersion: number } | null
    dimensionMap?: { results: unknown; scopeVersion: number } | null
  }
  clusters: ReportClusterRow[]
  areas: ReportAreaRow[]
  hypotheses: ReportHypothesisRow[]
  concepts: ReportConceptRow[]
  trail: ReportTrailRow[]
  generatedAt: Date
  /** True when the run list was capped, so the report can say so. */
  runsTruncated?: boolean
  /** True when the trail was capped. */
  trailTruncated?: boolean
}

// ---------------------------------------------------------------------------
// Output — the document model
// ---------------------------------------------------------------------------

export interface ReportMeta {
  studyId: string
  title: string
  kindLabel: string
  scopeVersion: number
  generatedOn: string
  preparedBy: string
  confidentiality: string
}

export interface ReportFirmBlock {
  name: string
  tagline: string | null
  logoDataUri: string | null
  accentColor: string | null
  addressLines: string[]
  contactLine: string | null
  showPoweredBy: boolean
}

export interface ReportScopeBlock {
  summary: string
  concepts: Array<{ label: string; synonyms: string[]; required: boolean; authored: boolean }>
  classifications: Array<{ code: string; definition: string | null; caution: string | null }>
  exclusions: Array<{ term: string; reason: string | null }>
  interpretationAssumptions: string[]
  corpusAssumptions: string[]
  filterLine: string
  /** Concepts marked required intersect; stated when more than one is. */
  intersectionWarning: string | null
  /**
   * How the concept list was turned into the field: the rule the newest census
   * ran with (with every rung it measured), or, before any census, the rule the
   * scope asks for. Null when the scope has no concepts.
   */
  matchRule: string | null
}

export interface ReportRunDiagnostic {
  stage: string
  status: string
  when: string
  duration: string
  scopeVersion: number
  stale: boolean
  error: string | null
}

export interface ReportFieldMapBlock {
  stale: boolean
  familyCount: number
  publicationCount: number
  filingsByYear: Array<{ year: number; families: number; withinLag: boolean }>
  lagNote: string
  jurisdictions: Array<{ label: string; families: number }>
  assignees: Array<{ label: string; families: number }>
  classifications: Array<{ label: string; families: number; definition: string | null }>
  statusProxy: { granted: number; pending: number; unknown: number; qualifier: string }
  textCoverage: {
    familiesTotal: number
    withClaims: number
    withDescription: number
    claimsReadablePct: number | null
    byJurisdiction: Array<{ country: string; families: number; withClaims: number }>
  }
  /** Only the funnel steps that were actually measured. */
  funnel: Array<{ label: string; count: number }>
  coverageNotes: string[]
}

export interface ReportAreaBlock {
  label: string
  description: string | null
  keywords: string[]
  memberCount: number
  fieldEstimate: number
  estimateQualifier: string
  geometry: string | null
  metricLines: string[]
  topAssignees: Array<{ label: string; families: number }>
  deepDive: {
    familiesConsidered: number
    familiesWithClaims: number
    familiesExtracted: number
    elementSupport: Array<{ element: string; families: number }>
    /** Ranked by surprisal — never by the saturating `rarity`. */
    rarePairs: RarePair[]
    problemSolution: Array<{ problem: string; solutions: string[]; families: number }>
    coverageNotes: string[]
  } | null
}

export interface ReportDimensionBlock {
  stale: boolean
  familyCount: number
  publicationCount: number
  sampleFamilies: number
  sampleQualifier: string
  settled: boolean
  settledReason: string
  registry: Array<{
    label: string
    description: string
    assignedFamilies: number
    residualShare: number
    multiAssignmentRatio: number
    values: Array<{ label: string; families: number; share: number; provenance: string; round: number }>
  }>
  rounds: Array<{
    round: number
    sliceLine: string
    accepted: string[]
    rejected: Array<{ label: string; reason: string; detail: string }>
    residualShareAfter: number
  }>
  matrixSummary: Array<{ pair: string; harvested: boolean; redundancy: number | null; skipReason: string | null }>
  /** Ranked by the stored deterministic rank. */
  gaps: Array<{
    title: string
    observed: number
    expected: number
    marginA: number
    marginB: number
    surprisal: number
    rank: number
    nearMissLine: string | null
    unassignedLine: string | null
    suspectReason: string | null
    armClaimsLine: string | null
  }>
  unclassifiedFamilies: number
  unclassifiedShare: number
  thresholdLine: string
  coverageNotes: string[]
}

export interface ReportHypothesisBlock {
  statement: string
  rationale: string
  typeLabel: string
  statusLabel: string
  clusterLabel: string | null
  elements: string[]
  /** Six pillars, always presented side by side and never averaged. */
  scoreLine: Array<{ label: string; value: string }>
  attacks: Array<{
    label: string
    query: string
    hits: number
    outcome: string
    reason: string | null
    /** Structural, so the renderer never has to string-match a display label. */
    notRun: boolean
  }>
  attacksRun: number
  attacksPlanned: number
  gates: Array<{ label: string; outcome: string; basis: string }>
  redTeamNotes: string | null
  coverageLimitations: string[]
  review: {
    verdictLabel: string
    meaning: string
    note: string | null
    reviewedOn: string
  } | null
  evidence: Array<{ kind: string; stance: string; refId: string | null; passage: string | null }>
}

export interface ReportConceptBlock {
  title: string
  summary: string
  requiredElements: string[]
  openQuestions: string[]
  differentiation: string[]
}

export interface WhitespaceReportModel {
  meta: ReportMeta
  firm: ReportFirmBlock | null
  invention: { problem: string | null; approach: string | null; constraints: string | null } | null
  scope: ReportScopeBlock
  runDiagnostics: ReportRunDiagnostic[]
  runsTruncated: boolean
  fieldMap: ReportFieldMapBlock | null
  areas: ReportAreaBlock[]
  divergence: TermDivergence[]
  dimensionMap: ReportDimensionBlock | null
  hypotheses: ReportHypothesisBlock[]
  reviewedCount: number
  concepts: ReportConceptBlock[]
  limitations: string[]
  trail: Array<{ when: string; kind: string; actor: string; summary: string }>
  trailTruncated: boolean
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}

function isoDay(value: Date | string): string {
  const date = asDate(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
}

function isoMinute(value: Date | string): string {
  const date = asDate(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().replace('T', ' ').slice(0, 16)
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function pct(value: number | null | undefined, digits = 0): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : '—'
}

function num(value: number | null | undefined, digits = 2): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—'
}

/** Whole-number formatting that survives a legacy row missing the field. */
function count(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value).toLocaleString() : '—'
}

/**
 * Trail actors are anonymised exactly as the trail API does: a report is often
 * the first thing to leave the firm, and user ids are not for the reader.
 */
function anonymiseActor(actor: string): string {
  if (actor.startsWith('user:')) return 'you'
  if (actor.startsWith('model:')) return actor.slice(6)
  return 'system'
}

/**
 * The match rule for the premise page. Prefers a rule a census actually ran
 * with (it carries the measured ladder); before any census, states what the
 * scope asks for so the reader knows the field will be fitted or pinned.
 */
function describeMatchRule(scope: WhitespaceScope, candidates: unknown[]): string | null {
  const optional = scope.concepts.filter(concept => !concept.required && concept.label.trim()).length
  const required = scope.concepts.filter(concept => concept.required && concept.label.trim()).length
  if (!optional && !required) return null
  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object' && typeof (candidate as FieldRule).minimumOptional === 'number') {
      return fieldRuleNote(candidate as FieldRule)
    }
  }
  const matching = scopeMatching(scope)
  if (!optional) return null
  const counts = { requiredCount: required, optionalCount: optional }
  return matching.minimumOptionalConcepts === 'auto'
    ? `Match rule: a document counts when it matches ${required ? 'every must-appear concept and ' : ''}as many of the ${
        required ? 'other ' : ''
      }concepts as the study fits automatically — every rung from all ${optional} down is measured and the tightest one that still yields a workable field is used. The rung actually used is stated with the census.`
    : `Match rule: a document counts when it matches ${required ? 'every must-appear concept and ' : ''}${rungPhrase(
        counts,
        matching.minimumOptionalConcepts
      )} (pinned in the scope).`
}

/** Case-insensitive dedup that keeps first-seen wording. */
function dedupe(lines: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
  }
  return out
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

export function buildWhitespaceReportModel(input: WhitespaceReportInput): WhitespaceReportModel {
  const { study, scope, firm, generatedAt } = input
  const isInvention = study.kind === 'INVENTION'
  const isMiner = study.kind === 'MINER'

  // ---- meta + branding ----------------------------------------------------
  const meta: ReportMeta = {
    studyId: study.id,
    title: study.title || 'Untitled study',
    kindLabel: isMiner
      ? 'Invention mining study'
      : isInvention
        ? 'Invention whitespace study'
        : 'Field whitespace study',
    scopeVersion: study.scopeVersion,
    generatedOn: isoDay(generatedAt),
    preparedBy: input.preparedBy,
    confidentiality: 'Confidential — attorney work product',
  }

  const firmBlock: ReportFirmBlock | null = firm
    ? {
        name: firm.firmName,
        tagline: firm.tagline || null,
        logoDataUri: firm.logoDataUri || null,
        accentColor: firm.accentColor || null,
        addressLines: formatFirmAddressLines(firm),
        contactLine: [firm.phone, firm.email, firm.website].filter(Boolean).join('  ·  ') || null,
        showPoweredBy: firm.showPoweredBy !== false,
      }
    : null

  // ---- invention brief ----------------------------------------------------
  const inventionRecord = record(study.inventionJson)
  const invention =
    isInvention && inventionRecord
      ? {
          problem: typeof inventionRecord.problem === 'string' ? inventionRecord.problem : null,
          approach: typeof inventionRecord.approach === 'string' ? inventionRecord.approach : null,
          constraints: typeof inventionRecord.constraints === 'string' ? inventionRecord.constraints : null,
        }
      : null

  // ---- scope --------------------------------------------------------------
  const requiredConcepts = scope.concepts.filter(concept => concept.required)
  const filters = scope.filters
  const filterBits = [
    `${filters.yearFrom}–${filters.yearTo}`,
    filters.jurisdictions.length ? filters.jurisdictions.join(', ') : 'all jurisdictions',
    filters.assignees.length ? `assignees: ${filters.assignees.join(', ')}` : 'all assignees',
  ]

  const scopeBlock: ReportScopeBlock = {
    summary: scope.summary,
    concepts: scope.concepts.map(concept => ({
      label: concept.label,
      synonyms: concept.synonyms,
      required: concept.required,
      authored: concept.origin === 'user',
    })),
    classifications: scope.classifications
      .filter(classification => classification.accepted)
      .map(classification => ({
        code: classification.code,
        definition: classification.definition || null,
        caution: classification.caution || null,
      })),
    exclusions: scope.exclusions.map(exclusion => ({ term: exclusion.term, reason: exclusion.reason || null })),
    interpretationAssumptions: scope.assumptions.filter(a => a.kind === 'interpretation').map(a => a.text),
    corpusAssumptions: scope.assumptions.filter(a => a.kind === 'corpus').map(a => a.text),
    filterLine: filterBits.join('  ·  '),
    intersectionWarning:
      requiredConcepts.length > 1
        ? `${requiredConcepts.length} concepts are marked as required (${requiredConcepts
            .map(concept => concept.label)
            .join(', ')}), so only documents matching ALL of them were counted. Intersecting required concepts is the most common cause of an under-sized field.`
        : null,
    matchRule: describeMatchRule(scope, [
      (input.stageResults.fieldMap?.results as { fieldRule?: unknown } | undefined)?.fieldRule,
      (input.stageResults.dimensionMap?.results as { fieldRule?: unknown } | undefined)?.fieldRule,
    ]),
  }

  // ---- run diagnostics ----------------------------------------------------
  const runDiagnostics: ReportRunDiagnostic[] = input.runs.map(run => ({
    stage: STAGE_LABEL[run.stage] || run.stage,
    status: run.status,
    when: isoMinute(run.createdAt),
    duration: typeof run.durationMs === 'number' ? `${(run.durationMs / 1000).toFixed(1)}s` : '—',
    scopeVersion: run.scopeVersion,
    stale: run.status === 'COMPLETED' && run.scopeVersion !== study.scopeVersion,
    error: run.lastError || null,
  }))

  const staleOf = (entry: { scopeVersion: number } | null | undefined) =>
    Boolean(entry && entry.scopeVersion !== study.scopeVersion)

  // ---- field map ----------------------------------------------------------
  const fieldMapResult = input.stageResults.fieldMap?.results as FieldMapResult | undefined
  let fieldMap: ReportFieldMapBlock | null = null
  if (fieldMapResult && typeof fieldMapResult.familyCount === 'number') {
    const lagMonths = fieldMapResult.publicationLagMonths ?? 18
    const lagBoundaryYear = new Date(generatedAt.getTime()).getUTCFullYear() - Math.ceil(lagMonths / 12)
    const coverage = fieldMapResult.textCoverage
    const funnel: Array<{ label: string; count: number }> = []
    const gates = fieldMapResult.gateCounts
    if (gates) {
      if (typeof gates.corpus === 'number') funnel.push({ label: 'Corpus', count: gates.corpus })
      if (typeof gates.afterFilters === 'number') funnel.push({ label: 'After filters', count: gates.afterFilters })
      if (typeof gates.afterConcepts === 'number')
        funnel.push({ label: 'Matching the concepts', count: gates.afterConcepts })
      if (typeof gates.families === 'number') funnel.push({ label: 'Distinct families', count: gates.families })
    }

    fieldMap = {
      stale: staleOf(input.stageResults.fieldMap),
      familyCount: fieldMapResult.familyCount,
      publicationCount: fieldMapResult.publicationCount,
      filingsByYear: (fieldMapResult.filingsByYear || []).map(entry => ({
        year: entry.year,
        families: entry.families,
        withinLag: entry.year >= lagBoundaryYear,
      })),
      lagNote: `Filings from ${lagBoundaryYear} onward are structurally undercounted: publication trails filing by roughly ${lagMonths} months, so the recent decline in this series is an artefact of the data edge, not of the field.`,
      jurisdictions: (fieldMapResult.jurisdictions || []).map(entry => ({
        label: entry.label,
        families: entry.families,
      })),
      assignees: (fieldMapResult.assignees || []).map(entry => ({ label: entry.label, families: entry.families })),
      classifications: (fieldMapResult.classifications || []).map(entry => ({
        label: entry.label,
        families: entry.families,
        definition: entry.definition || null,
      })),
      statusProxy: {
        granted: fieldMapResult.statusProxy?.granted ?? 0,
        pending: fieldMapResult.statusProxy?.pending ?? 0,
        unknown: fieldMapResult.statusProxy?.unknown ?? 0,
        qualifier:
          'Derived from kind codes and document age. This is a proxy, not legal status — no register was consulted, and nothing here supports a freedom-to-operate conclusion.',
      },
      textCoverage: {
        familiesTotal: coverage?.familiesTotal ?? 0,
        withClaims: coverage?.withClaims ?? 0,
        withDescription: coverage?.withDescription ?? 0,
        claimsReadablePct:
          coverage && coverage.familiesTotal > 0 ? coverage.withClaims / coverage.familiesTotal : null,
        byJurisdiction: coverage?.byJurisdiction || [],
      },
      funnel,
      coverageNotes: fieldMapResult.coverageNotes || [],
    }
  }

  // ---- areas (clusters + their deep dives) --------------------------------
  const areaByCluster = new Map(input.areas.map(area => [area.clusterId, area]))
  const areas: ReportAreaBlock[] = input.clusters.map(cluster => {
    const metrics = record(cluster.metrics)
    const metricLines: string[] = []
    if (metrics) {
      if (typeof metrics.density === 'number') metricLines.push(`Density ${num(metrics.density)}`)
      if (typeof metrics.velocityPct === 'number')
        metricLines.push(`5-year filing CAGR ${metrics.velocityPct.toFixed(1)}%`)
      if (typeof metrics.crowdedness === 'number') metricLines.push(`Crowding ${num(metrics.crowdedness)}`)
      if (typeof metrics.hhi === 'number') metricLines.push(`Assignee concentration (HHI) ${num(metrics.hhi)}`)
      if (typeof metrics.recencyShare === 'number')
        metricLines.push(`${pct(metrics.recencyShare)} filed in the last five complete years`)
    }

    const deepDiveRaw = record(areaByCluster.get(cluster.id)?.results)
    const deepDive = deepDiveRaw
      ? {
          familiesConsidered: Number(deepDiveRaw.familiesConsidered ?? 0),
          familiesWithClaims: Number(deepDiveRaw.familiesWithClaims ?? 0),
          familiesExtracted: Number(deepDiveRaw.familiesExtracted ?? 0),
          elementSupport: (Array.isArray(deepDiveRaw.elementSupport) ? deepDiveRaw.elementSupport : []) as Array<{
            element: string
            families: number
          }>,
          // Ranked by surprisal. `rarity` saturates at 1.0, so ranking on it
          // would sort a cell expecting 500 families level with one expecting 6.
          rarePairs: [...((Array.isArray(deepDiveRaw.rarePairs) ? deepDiveRaw.rarePairs : []) as RarePair[])].sort(
            (a, b) => (b.surprisal ?? 0) - (a.surprisal ?? 0)
          ),
          problemSolution: (Array.isArray(deepDiveRaw.problemSolution) ? deepDiveRaw.problemSolution : []) as Array<{
            problem: string
            solutions: string[]
            families: number
          }>,
          coverageNotes: stringArray(deepDiveRaw.coverageNotes),
        }
      : null

    const geometryBits: string[] = []
    if (typeof cluster.silhouette === 'number') geometryBits.push(`silhouette ${num(cluster.silhouette)}`)
    if (typeof cluster.cohesion === 'number') geometryBits.push(`cohesion ${num(cluster.cohesion)}`)
    if (typeof cluster.separation === 'number') geometryBits.push(`separation ${num(cluster.separation)}`)

    return {
      label: cluster.label,
      description: cluster.description,
      keywords: cluster.keywords || [],
      memberCount: cluster.memberCount,
      fieldEstimate: cluster.fieldEstimate,
      estimateQualifier: 'Extrapolated from a weighted sample — an estimate, not a count.',
      geometry: geometryBits.length ? geometryBits.join(' · ') : null,
      metricLines,
      topAssignees: Array.isArray(metrics?.topAssignees)
        ? (metrics!.topAssignees as Array<{ label: string; families: number }>)
        : [],
      deepDive,
    }
  })

  const signalsResult = input.stageResults.signals?.results as SignalsStageResult | undefined
  const divergence = (signalsResult?.divergence || []).filter(entry => entry.divergent)

  // ---- dimension map (invention) ------------------------------------------
  const dimensionResult = input.stageResults.dimensionMap?.results as DimensionMapResult | undefined
  let dimensionMap: ReportDimensionBlock | null = null
  if (dimensionResult && Array.isArray(dimensionResult.registry)) {
    const labelOfDimension = new Map(dimensionResult.registry.map(d => [d.id, d.label]))

    const rankedGaps = [...(dimensionResult.gaps || [])].sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0))

    dimensionMap = {
      stale: staleOf(input.stageResults.dimensionMap),
      familyCount: dimensionResult.familyCount,
      publicationCount: dimensionResult.publicationCount,
      sampleFamilies: dimensionResult.sample?.families ?? 0,
      sampleQualifier:
        'Viewpoints were discovered from a deterministic sample; every count published below was then measured against the whole field in SQL, not scaled up from the sample.',
      settled: dimensionResult.settled,
      settledReason: SETTLED_REASON[dimensionResult.settledReason] || dimensionResult.settledReason,
      registry: dimensionResult.registry.map(dimension => ({
        label: dimension.label,
        description: dimension.description,
        assignedFamilies: dimension.assignedFamilies,
        residualShare: dimension.residualShare,
        multiAssignmentRatio: dimension.multiAssignmentRatio,
        values: dimension.values.map(value => ({
          label: value.label,
          families: value.families,
          share: value.share,
          provenance: value.provenance,
          round: value.round,
        })),
      })),
      rounds: (dimensionResult.rounds || []).map(round => ({
        round: round.round,
        sliceLine: `${count(round.slice?.families)} families (${round.slice?.basis === 'residual' ? 'documents no axis yet placed' : 'sample'})`,
        accepted: [
          ...round.acceptedDimensions.map(label => `axis: ${label}`),
          ...round.acceptedValues.map(entry => `${entry.dimension} → ${entry.value}`),
        ],
        rejected: round.rejected.map(entry => ({
          label: `${entry.kind === 'dimension' ? 'axis' : 'value'}: ${entry.label}`,
          reason: REJECTION_REASON[entry.reason] || entry.reason,
          detail: entry.detail,
        })),
        residualShareAfter: round.residualShareAfter,
      })),
      matrixSummary: (dimensionResult.matrices || []).map(matrix => ({
        pair: `${labelOfDimension.get(matrix.aDimensionId) || matrix.aDimensionId} × ${
          labelOfDimension.get(matrix.bDimensionId) || matrix.bDimensionId
        }`,
        harvested: matrix.harvested,
        redundancy: matrix.redundancy,
        skipReason: matrix.skipReason,
      })),
      gaps: rankedGaps.map(gap => ({
        title: `${gap.aValueLabel} (${gap.aDimensionLabel}) × ${gap.bValueLabel} (${gap.bDimensionLabel})`,
        observed: gap.observed,
        expected: gap.expected,
        marginA: gap.marginA,
        marginB: gap.marginB,
        surprisal: gap.surprisal,
        rank: gap.rank,
        nearMissLine: nearMissLine(gap),
        unassignedLine:
          gap.unassignedOnA > 0 || gap.unassignedOnB > 0
            ? `${gap.unassignedOnB.toLocaleString()} families on the ${gap.aValueLabel} arm take no value at all on ${gap.bDimensionLabel}; ${gap.unassignedOnA.toLocaleString()} on the ${gap.bValueLabel} arm take none on ${gap.aDimensionLabel}. Large numbers here point at vocabulary the axes do not cover rather than at technology nobody built.`
            : null,
        suspectReason: gap.coverageSuspect ? gap.suspectReason : null,
        armClaimsLine:
          typeof gap.armClaimsReadable === 'number' && typeof gap.armFamilies === 'number' && gap.armFamilies > 0
            ? `Claims readable for ${gap.armClaimsReadable.toLocaleString()} of ${gap.armFamilies.toLocaleString()} families on this arm (${pct(
                gap.armClaimsReadable / gap.armFamilies
              )}).`
            : null,
      })),
      unclassifiedFamilies: dimensionResult.unclassifiedFamilies,
      unclassifiedShare: dimensionResult.unclassifiedShare,
      thresholdLine: dimensionResult.thresholds
        ? `A cell was reported only when both margins held at least ${dimensionResult.thresholds.marginFloor} families and at least ${dimensionResult.thresholds.expectedFloor} were expected by chance. Axis pairs overlapping by more than ${pct(
            dimensionResult.thresholds.redundancyCeiling
          )} were skipped as restatements of each other.`
        : '',
      coverageNotes: dimensionResult.coverageNotes || [],
    }
  }

  // ---- hypotheses ---------------------------------------------------------
  const clusterLabelById = new Map(input.clusters.map(cluster => [cluster.id, cluster.label]))
  const hypotheses: ReportHypothesisBlock[] = input.hypotheses.map(row => {
    const scores = record(row.scores) as unknown as HypothesisScores | null
    const validation = record(row.validation) as unknown as ValidationRecord | null
    const combination = record(row.elementCombination)
    const review = parseReview(row.humanReview)

    return {
      statement: row.statement,
      rationale: row.rationale,
      typeLabel: TYPE_LABEL[row.type] || row.type,
      statusLabel: STATUS_LABEL[row.status] || row.status,
      clusterLabel: row.clusterId ? clusterLabelById.get(row.clusterId) || null : null,
      elements: stringArray(combination?.elements),
      scoreLine: [
        { label: 'Density', value: num(scores?.density) },
        { label: 'Rarity', value: num(scores?.rarity) },
        { label: 'Novelty', value: num(scores?.semanticNovelty) },
        { label: 'Evidence', value: num(scores?.evidenceQuality) },
        { label: 'Confidence', value: num(scores?.confidence) },
        { label: 'Crowding', value: num(scores?.crowdedness) },
      ],
      attacks: (validation?.attacks || []).map((attack: AttackRecord) => ({
        label: STRATEGY_LABEL[attack.strategy] || attack.strategy,
        query: attack.query,
        hits: attack.hits,
        outcome: OUTCOME_LABEL[attack.outcome] || attack.outcome,
        reason: attack.reason || null,
        notRun: attack.outcome === 'NOT_RUN',
      })),
      attacksRun: validation?.attacksRun ?? 0,
      attacksPlanned: validation?.attacksPlanned ?? 0,
      gates: (validation?.gates || []).map((gate: GateOutcome) => ({
        label: GATE_LABEL[gate.gate] || gate.gate,
        outcome: GATE_OUTCOME_LABEL[gate.outcome] || gate.outcome,
        basis: gate.basis,
      })),
      redTeamNotes: validation?.redTeamNotes || null,
      coverageLimitations: stringArray(row.coverageLimitations),
      review: review
        ? {
            verdictLabel: REVIEW_LABEL[review.verdict],
            meaning: REVIEW_MEANING[review.verdict],
            note: review.note,
            reviewedOn: isoDay(review.reviewedAt),
          }
        : null,
      evidence: (row.evidence || [])
        .filter(entry => entry.passage || entry.refId)
        .map(entry => ({
          kind: entry.kind,
          stance: entry.stance,
          refId: entry.refId,
          passage: entry.passage ? entry.passage.slice(0, 500) : null,
        })),
    }
  })

  // ---- concepts -----------------------------------------------------------
  const concepts: ReportConceptBlock[] = input.concepts.map(row => {
    const features = record(row.features)
    const differentiation = Array.isArray(features?.differentiation)
      ? (features!.differentiation as unknown[])
          .map(entry => {
            const item = record(entry)
            if (!item) return null
            const against = typeof item.against === 'string' ? item.against : null
            const how = typeof item.how === 'string' ? item.how : null
            return against && how ? `${against}: ${how}` : how || against
          })
          .filter((line): line is string => Boolean(line))
      : []
    return {
      title: row.title,
      summary: row.summary,
      requiredElements: stringArray(features?.inventionFeatures).length
        ? stringArray(features?.inventionFeatures)
        : stringArray(features?.requiredElements),
      openQuestions: stringArray(features?.openQuestions),
      differentiation,
    }
  })

  // ---- limitations --------------------------------------------------------
  const limitations = dedupe([
    ...(dimensionResult?.limitations || []),
    ...(fieldMap?.coverageNotes || []),
    ...(signalsResult?.coverageNotes || []),
    ...(dimensionMap?.coverageNotes || []),
    ...areas.flatMap(area => area.deepDive?.coverageNotes || []),
    ...input.hypotheses.flatMap(row => stringArray(row.coverageLimitations)),
  ])

  return {
    meta,
    firm: firmBlock,
    invention,
    scope: scopeBlock,
    runDiagnostics,
    runsTruncated: Boolean(input.runsTruncated),
    fieldMap,
    areas,
    divergence,
    dimensionMap,
    hypotheses,
    reviewedCount: hypotheses.filter(hypothesis => hypothesis.review).length,
    concepts,
    limitations,
    trail: input.trail.map(entry => ({
      when: isoMinute(entry.createdAt),
      kind: entry.kind,
      actor: anonymiseActor(entry.actor),
      summary: entry.summary,
    })),
    trailTruncated: Boolean(input.trailTruncated),
  }
}

// ---------------------------------------------------------------------------

const SETTLED_REASON: Record<string, string> = {
  RESIDUAL_UNDER_FLOOR: 'the axes placed enough of the field that further rounds had little left to explain',
  NO_ACCEPTED_ADDITIONS: 'a further round proposed nothing that measured up',
  REGISTRY_FULL: 'the registry reached its size limit',
  MAX_ROUNDS: 'the round limit was reached — the registry may still be incomplete',
  REGISTRY_SUPPLIED: 'you supplied the registry, so no discovery was run',
}

const REJECTION_REASON: Record<string, string> = {
  BELOW_SAMPLE_FLOOR: 'too few documents matched it',
  DUPLICATE_OF_EXISTING: 'it restated a value already in the registry',
  DIMENSION_RESTATES_EXISTING: 'it sorted documents the same way an existing axis already did',
  EXPLAINS_TOO_LITTLE_RESIDUAL: 'it explained too little of what was still unplaced',
  QUERY_STEMS_TO_NOTHING: 'its wording reduced to nothing searchable',
  REGISTRY_FULL: 'the registry was already full',
}

/**
 * Labels come from the gap record itself, not from a registry lookup: the
 * near-miss carries the wording that was true when the cell was measured, and
 * an edited registry must not silently relabel a published measurement.
 */
function nearMissLine(gap: DimensionGap): string | null {
  const bits: string[] = []
  if (gap.nearMissB) {
    bits.push(`${gap.aValueLabel} appears ${count(gap.nearMissB.families)} times with ${gap.nearMissB.valueLabel}`)
  }
  if (gap.nearMissA) {
    bits.push(`${gap.bValueLabel} appears ${count(gap.nearMissA.families)} times with ${gap.nearMissA.valueLabel}`)
  }
  return bits.length ? `${bits.join('; ')} — so the cell was reachable and was not taken.` : null
}

/** Tolerant of anything the column might hold; anything malformed reads as unreviewed. */
function parseReview(value: unknown): HumanReview | null {
  const parsed = record(value)
  if (!parsed) return null
  const verdict = parsed.verdict
  if (verdict !== 'ENDORSED' && verdict !== 'REJECTED' && verdict !== 'NEEDS_INVESTIGATION') return null
  return {
    verdict,
    note: typeof parsed.note === 'string' && parsed.note.trim() ? parsed.note.trim() : null,
    reviewedById: typeof parsed.reviewedById === 'string' ? parsed.reviewedById : '',
    reviewedAt: typeof parsed.reviewedAt === 'string' ? parsed.reviewedAt : '',
  }
}
