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

/**
 * Postgres websearch_to_tsquery syntax: space = AND, `OR` keyword, quoted
 * phrases, `-term` negation. MATCH/BOTH blocks become AND-ed OR-groups.
 */
function buildSearchQuery(plan: StudioPlan): { query: string; warnings: string[] } {
  const warnings: string[] = []
  const groups: string[] = []
  for (const block of plan.blocks) {
    if (block.mode === 'EXPAND') continue
    const terms = activeTerms(block.terms)
    if (!terms.length) continue
    const rendered = terms.map(quoteTerm).filter(Boolean)
    groups.push(rendered.length > 1 ? `(${rendered.join(' OR ')})` : rendered[0])
  }
  const negations = activeTerms(plan.notTerms).map(t => `-${quoteTerm(t)}`)
  const query = [...groups, ...negations].join(' ').trim()
  if (!groups.length) {
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

function buildFilters(plan: StudioPlan): PatentSearchFilters {
  const cpc = activeCpcCodes(plan)
  const filters: PatentSearchFilters = {}
  if (cpc.length) filters.classifications = cpc
  if (plan.filters.publicationDateFrom) filters.publicationDateFrom = plan.filters.publicationDateFrom
  if (plan.filters.publicationDateTo) filters.publicationDateTo = plan.filters.publicationDateTo
  if (plan.filters.applicants?.length) filters.applicants = plan.filters.applicants
  if (plan.filters.inventors?.length) filters.inventors = plan.filters.inventors
  const excluded = activeTerms(plan.notTerms)
  if (excluded.length) filters.excludeTerms = excluded
  return filters
}

/** Human-readable query line shown under the canvas and recorded in the trail/report. */
export function renderBooleanPreview(plan: StudioPlan): string {
  const parts: string[] = []
  for (const block of plan.blocks) {
    const terms = activeTerms(block.terms)
    if (!terms.length) continue
    const group = terms.map(quoteTerm).join(' OR ')
    if (block.mode === 'EXPAND') parts.push(`CAST(${block.label}: ${terms.join('; ')})`)
    else if (block.mode === 'BOTH') parts.push(`((${group}) OR CAST(${block.label}))`)
    else parts.push(`(${group})`)
  }
  const cpc = activeCpcCodes(plan)
  if (cpc.length) parts.push(`CPC:(${cpc.join(' OR ')})`)
  const rendered = parts.join(' AND ')
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

  const queryPlan: Partial<PatentSearchQueryPlan> = {
    originalQuery: plan.title || plan.conceptSummary || searchQuery,
    searchQuery: searchQuery || semanticQuery,
    semanticQuery: semanticQuery || searchQuery,
    inventionFeatures: elements,
    technicalKeywords: plan.blocks.flatMap(b => activeTerms(b.terms)).slice(0, 24),
    synonyms: [],
    mustHaveTerms: [],
    excludedTerms: activeTerms(plan.notTerms),
    cpcCodes: activeCpcCodes(plan),
    retrievalQueries: retrievalQueries.length ? retrievalQueries : undefined,
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
