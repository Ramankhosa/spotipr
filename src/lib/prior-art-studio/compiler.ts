// Compiles a StudioPlan into the PatentSearchQueryPlan shape the existing
// retrieval core executes. Deterministic and replayable: the same plan always
// compiles to the same query (hash recorded on every run for the trail).

import { createHash } from 'crypto'
import type { PatentRetrievalQuery, PatentSearchFilters, PatentSearchQueryPlan } from '@/lib/patent-search/types'
import { activeCpcCodes, activeTerms, type StudioPlan } from './types'

export interface CompiledStudioPlan {
  queryPlan: Partial<PatentSearchQueryPlan>
  jurisdictions: string[]
  booleanPreview: string
  planHash: string
  warnings: string[]
}

function quoteTerm(term: string): string {
  const trimmed = term.trim()
  if (!trimmed) return ''
  return /\s/.test(trimmed) ? `"${trimmed.replace(/"/g, '')}"` : trimmed
}

/** Blocks that act as a hard literal requirement. ONLY `MATCH` gates. */
export function requiredBlocks(plan: StudioPlan) {
  return plan.blocks.filter(block => block.mode === 'MATCH')
}

/** Blocks whose literal terms should widen keyword recall without gating. */
function literalRecallBlocks(plan: StudioPlan) {
  return plan.blocks.filter(block => block.mode !== 'EXPAND')
}

/**
 * The keyword lane's query — a RECALL query, deliberately not a gate.
 *
 * `websearch_to_tsquery` supports only: whitespace = AND, the `OR` keyword,
 * "quoted phrases", and leading `-` for NOT. It silently DISCARDS parentheses
 * and never raises a syntax error, and `&` binds tighter than `|`. An attempt
 * to express "AND of OR-groups" as `(a OR b) (c OR d)` therefore collapses into
 * `a OR (b AND c) OR d` — the opposite of the intent, catastrophically broad,
 * and with any trailing `-negation` binding to the final alternative only.
 *
 * So we stop trying to express conjunction here. This emits a flat disjunction
 * that maximises what the indexed keyword lane retrieves; the hard AND-of-groups
 * requirement is enforced afterwards in `service.ts`, over text we fetch
 * ourselves, where the semantics are exact and testable.
 *
 * Exclusions are NOT emitted here either: as `-term` tokens they bind to one
 * alternative (inert), and routing them through the provider's `excludeTerms`
 * filter compiles to an unindexable ILIKE over fully-detoasted claims and
 * description text on every lane. They are applied post-retrieval instead.
 */
function buildSearchQuery(plan: StudioPlan): { query: string; warnings: string[] } {
  const warnings: string[] = []
  const terms: string[] = []
  for (const block of literalRecallBlocks(plan)) {
    for (const term of activeTerms(block.terms)) {
      const rendered = quoteTerm(term)
      if (rendered && !terms.includes(rendered)) terms.push(rendered)
    }
  }
  const query = terms.join(' OR ').trim()
  if (!terms.length) {
    const hasExpand = plan.blocks.some(b => b.mode !== 'MATCH' && activeTerms(b.terms).length)
    if (!hasExpand) warnings.push('No active terms on the canvas — accept or add at least one term before running.')
  }
  return { query, warnings }
}

/**
 * EXPAND/BOTH blocks and claim elements become vector probes; the whole plan
 * becomes the concept probe. Order matters: the retrieval core caps how many
 * vector queries it runs (PATENT_SEARCH_MAX_VECTOR_QUERIES), so the concept
 * probe and element probes lead — they carry the most signal per query.
 */
function buildRetrievalQueries(plan: StudioPlan): PatentRetrievalQuery[] {
  const queries: PatentRetrievalQuery[] = []
  const conceptText = [
    plan.conceptSummary || plan.title,
    ...plan.blocks.map(b => `${b.label}: ${activeTerms(b.terms).join(', ')}`).filter(s => !s.endsWith(': ')),
  ]
    .filter(Boolean)
    .join('. ')
  if (conceptText.trim()) {
    queries.push({ id: 'concept', type: 'concept', text: conceptText.slice(0, 600), weight: 1.25, label: 'Core concept' })
  }

  // Steering: documents the attorney marked relevant, folded in as an explicit
  // probe. It lives on the plan and is rendered on the canvas, so ranking is
  // never influenced by anything the attorney cannot see and remove.
  if (plan.steer?.enabled && plan.steer.publicationNumbers.length) {
    queries.push({
      id: 'steer',
      type: 'semantic',
      text: `${plan.conceptSummary || plan.title}. Similar to: ${plan.steer.publicationNumbers.join(', ')}`.slice(0, 400),
      weight: Math.max(0.1, Math.min(1, plan.steer.weight || 0.3)),
      label: 'Steered by your marks',
    })
  }

  plan.elements.forEach((element, index) => {
    const text = element.text.trim()
    if (!text) return
    queries.push({
      id: `element:${element.id}`,
      type: 'feature',
      text: text.slice(0, 400),
      weight: 1,
      featureIndex: index,
      label: `Element ${index + 1}`,
    })
  })

  for (const block of plan.blocks) {
    if (block.mode === 'MATCH') continue
    const terms = activeTerms(block.terms)
    if (!terms.length) continue
    queries.push({
      id: `block:${block.id}`,
      type: 'feature',
      text: `${block.label}: ${terms.join(', ')}`.slice(0, 400),
      weight: 1,
      label: block.label,
    })
  }
  return queries
}

/** Jurisdiction codes that actually restrict the search. `*` means worldwide. */
export function selectedJurisdictions(plan: StudioPlan): string[] {
  return (plan.filters.jurisdictions || []).filter(code => code && code !== '*')
}

function buildFilters(plan: StudioPlan): PatentSearchFilters {
  const cpc = activeCpcCodes(plan)
  const filters: PatentSearchFilters = {}
  if (cpc.length) filters.classifications = cpc
  // The jurisdiction selection has to become `filters.countries` to have any
  // effect on the SQL. Passing it as `jurisdictions` on the search request only
  // routes providers — and Studio pins its provider list explicitly, so that
  // path is a no-op here. The Filters gate meanwhile counted `country IN (…)`,
  // so the attorney was shown a jurisdiction narrowing that never happened.
  const jurisdictions = selectedJurisdictions(plan)
  if (jurisdictions.length) filters.countries = jurisdictions
  if (plan.filters.publicationDateFrom) filters.publicationDateFrom = plan.filters.publicationDateFrom
  if (plan.filters.publicationDateTo) filters.publicationDateTo = plan.filters.publicationDateTo
  if (plan.filters.applicants?.length) filters.applicants = plan.filters.applicants
  if (plan.filters.inventors?.length) filters.inventors = plan.filters.inventors
  // NOTE: excludeTerms is deliberately NOT forwarded. The provider compiles it
  // to `NOT (<title||abstract||claimsText||descriptionText||rawText||…> ILIKE
  // '%term%')` on EVERY lane — unindexable, and it detoasts megabytes of claims
  // and description text per candidate row. That is what was timing the lanes
  // out. Exclusions are applied post-retrieval in service.ts instead.
  return filters
}

/**
 * Human-readable query line shown under the canvas and recorded in the report.
 *
 * This must describe what ACTUALLY executes, because it is presented to
 * attorneys as "the query as run":
 *   MATCH  — hard requirement, enforced after retrieval
 *   BOTH   — feeds both lanes, requires nothing
 *   EXPAND — meaning only
 */
export function renderBooleanPreview(plan: StudioPlan): string {
  const required: string[] = []
  const widening: string[] = []
  for (const block of plan.blocks) {
    const terms = activeTerms(block.terms)
    if (!terms.length) continue
    const group = terms.map(quoteTerm).join(' OR ')
    if (block.mode === 'EXPAND') widening.push(`CAST(${block.label}: ${terms.join('; ')})`)
    else if (block.mode === 'BOTH') widening.push(`((${group}) OR CAST(${block.label}))`)
    else required.push(`(${group})`)
  }
  const cpc = activeCpcCodes(plan)
  if (cpc.length) required.push(`CPC:(${cpc.join(' OR ')})`)

  const parts: string[] = []
  if (required.length) parts.push(`REQUIRE ${required.join(' AND ')}`)
  if (widening.length) parts.push(`WIDEN ${widening.join(' OR ')}`)
  const rendered = parts.join('  ·  ')
  const negations = activeTerms(plan.notTerms)
  const negRendered = negations.length ? ` NOT (${negations.map(quoteTerm).join(' OR ')})` : ''
  const dates =
    plan.filters.publicationDateFrom || plan.filters.publicationDateTo
      ? ` @[${plan.filters.publicationDateFrom || '…'} → ${plan.filters.publicationDateTo || 'now'}]`
      : ''
  const steer =
    plan.steer?.enabled && plan.steer.publicationNumbers.length
      ? ` STEER(${plan.steer.publicationNumbers.length} docs, w=${plan.steer.weight})`
      : ''
  return `${rendered}${negRendered}${dates}${steer}`.trim() || '(empty plan)'
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value)
}

export function hashStudioPlan(plan: StudioPlan): string {
  return createHash('sha1').update(stableStringify(plan)).digest('hex').slice(0, 12)
}

export function compileStudioPlan(plan: StudioPlan): CompiledStudioPlan {
  const { query: searchQuery, warnings } = buildSearchQuery(plan)
  const retrievalQueries = buildRetrievalQueries(plan)
  const filters = buildFilters(plan)
  const elements = plan.elements.map(e => e.text.trim()).filter(Boolean)
  const semanticQuery = [plan.conceptSummary || plan.title, ...elements].filter(Boolean).join('. ')
  const literalMatchGroups = requiredBlocks(plan)
    .map(block => ({ id: block.id, label: block.label, terms: activeTerms(block.terms) }))
    .filter(group => group.terms.length)

  const queryPlan: Partial<PatentSearchQueryPlan> = {
    originalQuery: plan.title || plan.conceptSummary || searchQuery,
    searchQuery: searchQuery || semanticQuery,
    semanticQuery: semanticQuery || searchQuery,
    inventionFeatures: elements,
    technicalKeywords: plan.blocks.flatMap(b => activeTerms(b.terms)).slice(0, 24),
    synonyms: [],
    mustHaveTerms: [],
    // NOT emitted, for the same reason `excludeTerms` is left out of
    // `fieldFilters` above — and this line is why leaving it out of the filters
    // alone was not enough. The provider re-merges the two
    // (`withExcludedTerms(queryPlan.fieldFilters, queryPlan.excludedTerms)`), so
    // any attorney NOT-term put the unindexable full-detoast ILIKE back on every
    // lane. The fix was made in one place and undone in the other. Exclusions
    // are applied post-retrieval in service.ts, over text we fetch ourselves.
    excludedTerms: [],
    cpcCodes: activeCpcCodes(plan),
    retrievalQueries: retrievalQueries.length ? retrievalQueries : undefined,
    literalMatchGroups: literalMatchGroups.length ? literalMatchGroups : undefined,
    fieldFilters: filters,
    llmExpanded: false,
    warnings: [],
  }

  const jurisdictions =
    plan.filters.jurisdictions?.length && !plan.filters.jurisdictions.includes('*')
      ? plan.filters.jurisdictions
      : ['*']

  return {
    queryPlan,
    jurisdictions,
    booleanPreview: renderBooleanPreview(plan),
    planHash: hashStudioPlan(plan),
    warnings,
  }
}
