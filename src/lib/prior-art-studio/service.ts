// Prior-Art Studio server service: Copilot drafting (new LLM stage), plan
// execution over the existing hybrid retrieval core, family collapse, gate
// counts, and the append-only evidence trail.

import { prisma } from '@/lib/prisma'
import { Prisma, TaskCode } from '@prisma/client'
import { patentSearchOrchestrator } from '@/lib/patent-search'
import type { NormalizedPatentResult } from '@/lib/patent-search/types'
import { hasSearchEmbeddingApiKey } from '@/lib/patent-corpus-service'
import { compileStudioPlan } from './compiler'
import { scoreElements } from './element-scoring'
import {
  activeTerms,
  emptyStudioPlan,
  type StudioGateConstraint,
  type StudioGateCounts,
  type StudioGateDetail,
  type StudioPlan,
  type StudioResultFamily,
  type StudioRunPayload,
  type StudioSaturation,
} from './types'

export const ADVANCED_MANUAL_SEARCH_STAGE_CODE = 'ADVANCED_MANUAL_SEARCH_QUERY_GENERATOR'

const RESULT_LIMIT = 120
const CANDIDATE_LIMIT = 1000
const STORED_FAMILY_LIMIT = 150

/**
 * The ONLY providers Prior-Art Studio may search: our own stored corpus.
 *
 * Studio reports counted gates and a coverage statement against this corpus, so
 * a document arriving from a live patent API (SerpAPI, EPO OPS, PatentsView,
 * BigQuery) would be evidence from outside the numbers we publish. The request
 * flags below prevent it; the guard after the search enforces it even if those
 * flags are ever dropped or the orchestrator's routing changes.
 */
const STUDIO_PROVIDER_IDS = ['indian-corpus', 'google-patents-corpus'] as const
const STUDIO_PROVIDER_SET: ReadonlySet<string> = new Set(STUDIO_PROVIDER_IDS)

function isLocalCorpusResult(result: NormalizedPatentResult): boolean {
  const sources = [result.sourceProvider, result.providerId, ...(result.sourceProviders || [])].filter(Boolean)
  if (!sources.length) return true // provider didn't tag it; the request only dispatched local providers
  return sources.every(id => STUDIO_PROVIDER_SET.has(String(id)))
}
/** How many top families get per-element evidence (keeps the extra scan cheap). */
const ELEMENT_GRID_LIMIT = 40

// ---------------------------------------------------------------------------
// Trail
// ---------------------------------------------------------------------------

export async function appendTrail(
  sessionId: string,
  kind: 'COPILOT' | 'EDIT' | 'RUN' | 'TAG' | 'NOTE' | 'SYSTEM',
  actor: string,
  summary: string,
  data?: Prisma.InputJsonValue
) {
  return prisma.priorArtStudioTrailEntry.create({
    data: { sessionId, kind, actor, summary, data },
  })
}

// ---------------------------------------------------------------------------
// Copilot draft — the "Advanced Manual Search Query Generator" stage
// ---------------------------------------------------------------------------

function extractBalancedJson(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index++) {
    const char = text[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, index + 1)
    }
  }
  return null
}

function asStrings(value: unknown, max = 12): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map(v => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean)
    .slice(0, max)
}

function buildDraftPrompt(disclosure: string, existingTitle?: string): string {
  return `You are a senior patent search professional preparing a manual prior-art search strategy.

Decompose the invention below into a search plan. Respond with ONLY a JSON object, no prose, in exactly this shape:
{
  "title": "short search title (max 10 words)",
  "conceptSummary": "one-paragraph plain-language summary of the invention (max 60 words)",
  "elements": ["claim element 1 (the essential technical features, 4-7 items, each max 15 words)"],
  "blocks": [
    {
      "label": "short concept name (2-4 words)",
      "modeSuggestion": "MATCH | EXPAND | BOTH",
      "terms": ["search terms and synonyms including patentese variants, 3-8 per block"]
    }
  ],
  "cpc": [{ "code": "A61B 17/88", "definition": "short plain-language meaning of this class" }],
  "notTerms": ["terms that attract irrelevant fields, 0-4 items"],
  "publicationDateFrom": "YYYY-MM-DD or null"
}

Rules:
- 3 to 6 blocks, one per independent concept of the invention; AND-ing the blocks should describe the invention.
- Include patentese variants attorneys would miss (e.g. "fastener" -> "fastening means", "elongate member").
- Suggest MATCH for precise terms of art, EXPAND for concepts phrased many ways, BOTH when unsure.
- CPC codes must be real; 2-4 suggestions with honest one-line definitions.
- Do not invent facts about the invention beyond the disclosure.

${existingTitle ? `Working title: ${existingTitle}\n` : ''}INVENTION DISCLOSURE:
${disclosure.slice(0, 12000)}`
}

export interface DraftPlanResult {
  plan: StudioPlan
  modelCode?: string
  usedFallbackTask: boolean
}

export async function draftStudioPlan(input: {
  disclosure: string
  existingTitle?: string
  requestHeaders: Record<string, string>
}): Promise<DraftPlanResult> {
  const { llmGateway } = await import('@/lib/metering/gateway')
  const prompt = buildDraftPrompt(input.disclosure, input.existingTitle)

  let output: string | undefined
  let modelCode: string | undefined
  let usedFallbackTask = false

  const stageAttempt = await llmGateway.executeLLMOperation(
    { headers: input.requestHeaders },
    { taskCode: TaskCode.LLM7_ADVANCED_MANUAL_SEARCH, stageCode: ADVANCED_MANUAL_SEARCH_STAGE_CODE, prompt }
  )
  if (stageAttempt.success && stageAttempt.response?.output) {
    output = stageAttempt.response.output
    modelCode = stageAttempt.response.metadata?.model || stageAttempt.response.modelClass
  } else {
    // Stage-coded resolution is fail-closed until a Super Admin (or the setup
    // script) maps a model to this plan+stage. Fall back to task-only routing
    // on the established novelty task so the feature works out of the box.
    usedFallbackTask = true
    const taskAttempt = await llmGateway.executeLLMOperation(
      { headers: input.requestHeaders },
      { taskCode: TaskCode.LLM5_NOVELTY_ASSESS, prompt }
    )
    if (!taskAttempt.success || !taskAttempt.response?.output) {
      throw new Error(
        taskAttempt.error?.message || stageAttempt.error?.message || 'Query generator failed. Try again.'
      )
    }
    output = taskAttempt.response.output
    modelCode = taskAttempt.response.metadata?.model || taskAttempt.response.modelClass
  }

  const jsonText = extractBalancedJson(output)
  if (!jsonText) throw new Error('Query generator returned no JSON plan.')
  const parsed = JSON.parse(jsonText) as Record<string, unknown>

  const plan = emptyStudioPlan()
  plan.title = typeof parsed.title === 'string' ? parsed.title.trim().slice(0, 120) : input.existingTitle || ''
  plan.conceptSummary = typeof parsed.conceptSummary === 'string' ? parsed.conceptSummary.trim().slice(0, 600) : ''
  plan.elements = asStrings(parsed.elements, 8).map((text, i) => ({ id: `e${i + 1}`, text, origin: 'copilot' as const }))

  const rawBlocks = Array.isArray(parsed.blocks) ? parsed.blocks.slice(0, 6) : []
  plan.blocks = rawBlocks
    .map((raw, i) => {
      const block = raw as Record<string, unknown>
      const label = typeof block.label === 'string' ? block.label.trim().slice(0, 60) : `Concept ${i + 1}`
      const mode: StudioPlan['blocks'][number]['mode'] =
        block.modeSuggestion === 'EXPAND' || block.modeSuggestion === 'BOTH' ? block.modeSuggestion : 'MATCH'
      const terms = asStrings(block.terms, 10).map(text => ({ text, origin: 'copilot' as const, accepted: false }))
      return { id: `b${i + 1}`, label, mode, terms }
    })
    .filter(b => b.terms.length)

  const rawCpc = Array.isArray(parsed.cpc) ? parsed.cpc.slice(0, 6) : []
  plan.cpc = rawCpc
    .map(raw => {
      const entry = raw as Record<string, unknown>
      const code = typeof entry.code === 'string' ? entry.code.trim().toUpperCase().slice(0, 24) : ''
      const definition = typeof entry.definition === 'string' ? entry.definition.trim().slice(0, 160) : undefined
      return { code, definition, origin: 'copilot' as const, accepted: false }
    })
    .filter(c => c.code)

  plan.notTerms = asStrings(parsed.notTerms, 6).map(text => ({ text, origin: 'copilot' as const, accepted: false }))
  if (typeof parsed.publicationDateFrom === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.publicationDateFrom)) {
    plan.filters.publicationDateFrom = parsed.publicationDateFrom
  }

  if (!plan.blocks.length) throw new Error('Query generator produced no usable concept blocks.')
  return { plan, modelCode, usedFallbackTask }
}

// ---------------------------------------------------------------------------
// Gate estimates (instant, planner-based — exact pipeline counts come from the run)
// ---------------------------------------------------------------------------

async function estimateCorpusCount(): Promise<number | null> {
  try {
    const rows = await prisma.$queryRaw<Array<{ estimate: number }>>`
      SELECT reltuples::bigint::float8 AS estimate FROM pg_class WHERE relname = 'local_patents'`
    const estimate = rows[0]?.estimate
    return Number.isFinite(estimate) && estimate > 0 ? Math.round(estimate) : null
  } catch {
    return null
  }
}

/** One EXPLAIN-based row estimate for an arbitrary predicate set. */
async function estimateWhere(conditions: Prisma.Sql[]): Promise<number | null> {
  try {
    if (!conditions.length) return estimateCorpusCount()
    const where = Prisma.join(conditions, ' AND ')
    const rows = await prisma.$queryRaw<Array<{ 'QUERY PLAN': unknown }>>(
      Prisma.sql`EXPLAIN (FORMAT JSON) SELECT 1 FROM "local_patents" WHERE ${where}`
    )
    const planJson = rows[0]?.['QUERY PLAN'] as Array<{ Plan?: { 'Plan Rows'?: number } }> | undefined
    const estimate = planJson?.[0]?.Plan?.['Plan Rows']
    return typeof estimate === 'number' && estimate >= 0 ? Math.round(estimate) : null
  } catch {
    return null
  }
}

/** Named predicates for the Filters gate, so each can be counted independently. */
function filterConditions(plan: StudioPlan): Array<{ label: string; sql: Prisma.Sql }> {
  const out: Array<{ label: string; sql: Prisma.Sql }> = []
  if (plan.filters.publicationDateFrom) {
    out.push({
      label: `Published on or after ${plan.filters.publicationDateFrom}`,
      sql: Prisma.sql`"publicationDate" >= ${new Date(plan.filters.publicationDateFrom)}`,
    })
  }
  if (plan.filters.publicationDateTo) {
    out.push({
      label: `Published on or before ${plan.filters.publicationDateTo}`,
      sql: Prisma.sql`"publicationDate" <= ${new Date(plan.filters.publicationDateTo)}`,
    })
  }
  const jurisdictions = plan.filters.jurisdictions?.filter(j => j && j !== '*') || []
  if (jurisdictions.length) {
    out.push({
      label: `Jurisdiction in ${jurisdictions.join(', ')}`,
      sql: Prisma.sql`"country" IN (${Prisma.join(jurisdictions)})`,
    })
  }
  const cpc = plan.cpc.filter(c => c.accepted).map(c => c.code.replace(/\s+/g, ''))
  if (cpc.length) {
    const likeClauses = cpc.map(code => Prisma.sql`c LIKE ${code + '%'}`)
    out.push({
      label: `Classification in ${cpc.join(', ')}`,
      sql: Prisma.sql`EXISTS (SELECT 1 FROM unnest("classifications") AS c WHERE ${Prisma.join(likeClauses, ' OR ')})`,
    })
  }
  return out
}

/**
 * The Gate inspector: how much each constraint removed, cumulatively, plus a
 * sensitivity read ("what one change would do"). Answers the question every
 * searcher actually has — what did I just exclude?
 */
async function buildGateDetail(plan: StudioPlan, corpusEstimate: number | null): Promise<StudioGateDetail> {
  const named = filterConditions(plan)
  const constraints: StudioGateConstraint[] = []
  const applied: Prisma.Sql[] = []
  let previous = corpusEstimate

  for (const condition of named) {
    applied.push(condition.sql)
    const remaining = await estimateWhere([...applied])
    constraints.push({
      label: condition.label,
      remaining,
      removed: previous !== null && remaining !== null ? Math.max(0, previous - remaining) : null,
      isEstimate: true,
    })
    previous = remaining
  }

  const sensitivity: Array<{ label: string; value: string }> = []
  for (let i = 0; i < named.length; i++) {
    const without = named.filter((_, j) => j !== i).map(c => c.sql)
    const remaining = await estimateWhere(without)
    if (remaining !== null && previous !== null) {
      sensitivity.push({
        label: `Drop “${named[i].label}”`,
        value: `${previous.toLocaleString()} → ${remaining.toLocaleString()}`,
      })
    }
  }

  return {
    constraints,
    sensitivity,
    disclosures: [
      'Coverage is worldwide patent publications from 2000 onward (Google Patents public dataset). Art published before 2000 is NOT in this corpus.',
      'Patent documents only — no non-patent literature (journals, standards, datasheets, product manuals) is searched.',
      'No legal-status data: nothing is filtered by whether a patent is granted, lapsed or in force. Do not treat this as a clearance search.',
      'Only titles and abstracts are semantically indexed. Claims and descriptions are stored for US documents only, and are not searched — element evidence from other jurisdictions is abstract-tier.',
      'The dataset refreshes quarterly, so publications from the last 0–3 months may be missing.',
    ],
  }
}

async function estimateFilterCount(plan: StudioPlan): Promise<number | null> {
  const conditions: Prisma.Sql[] = []
  if (plan.filters.publicationDateFrom) {
    conditions.push(Prisma.sql`"publicationDate" >= ${new Date(plan.filters.publicationDateFrom)}`)
  }
  if (plan.filters.publicationDateTo) {
    conditions.push(Prisma.sql`"publicationDate" <= ${new Date(plan.filters.publicationDateTo)}`)
  }
  const jurisdictions = plan.filters.jurisdictions?.filter(j => j && j !== '*') || []
  if (jurisdictions.length) {
    conditions.push(Prisma.sql`"country" IN (${Prisma.join(jurisdictions)})`)
  }
  const cpc = plan.cpc.filter(c => c.accepted).map(c => c.code.replace(/\s+/g, ''))
  if (cpc.length) {
    // Prefix match against stored classification strings (normalized without spaces).
    const likeClauses = cpc.map(code => Prisma.sql`c LIKE ${code + '%'}`)
    conditions.push(
      Prisma.sql`EXISTS (SELECT 1 FROM unnest("classifications") AS c WHERE ${Prisma.join(likeClauses, ' OR ')})`
    )
  }
  if (!conditions.length) return estimateCorpusCount()
  try {
    const where = Prisma.join(conditions, ' AND ')
    const rows = await prisma.$queryRaw<Array<{ 'QUERY PLAN': unknown }>>(
      Prisma.sql`EXPLAIN (FORMAT JSON) SELECT 1 FROM "local_patents" WHERE ${where}`
    )
    const planJson = rows[0]?.['QUERY PLAN'] as Array<{ Plan?: { 'Plan Rows'?: number } }> | undefined
    const estimate = planJson?.[0]?.Plan?.['Plan Rows']
    return typeof estimate === 'number' && estimate >= 0 ? Math.round(estimate) : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

/**
 * MATCH groups: one array of alternatives per MATCH/BOTH block. A document
 * satisfies the literal requirement when it contains at least one alternative
 * from EVERY group (AND of ORs) — the same semantics the canvas shows.
 */
function matchGroups(plan: StudioPlan): string[][] {
  return plan.blocks
    .filter(block => block.mode !== 'EXPAND')
    .map(block =>
      activeTerms(block.terms)
        .map(term => term.toLowerCase().replace(/\*/g, '').trim())
        .filter(term => term.length >= 3)
    )
    .filter(group => group.length > 0)
}

function documentText(result: NormalizedPatentResult): string {
  return `${result.title || ''} ${result.abstract || ''} ${result.snippet || ''}`.toLowerCase()
}

function satisfiesMatch(text: string, groups: string[][]): boolean {
  return groups.every(group => group.some(term => text.includes(term)))
}

/**
 * Did Postgres' own full-text lane match this document?
 *
 * Once the partial GIN index lands for the Google corpus, that lane indexes
 * FOUR fields — ragText (top_terms), title, abstract, abstractOriginal — while
 * the result payload we get back only carries title/abstract/snippet. So a
 * document legitimately matched on its top_terms would fail a naive re-check
 * here and be thrown away. If the database already matched it, that verdict
 * stands; we only apply our own literal test to documents the text lane never
 * judged (i.e. vector-lane hits).
 */
function cameFromTextLane(result: NormalizedPatentResult): boolean {
  return typeof result.textRank === 'number' || (result.scores?.text ?? 0) > 0
}

function passesMatchRequirement(result: NormalizedPatentResult, groups: string[][]): boolean {
  if (!groups.length) return true
  if (cameFromTextLane(result)) return true
  return satisfiesMatch(documentText(result), groups)
}

/**
 * Lane attribution, computed here rather than taken from provider ranks.
 *
 * The provider's text lane is only index-backed for the Indian/PQAI corpora —
 * the full-text GIN indexes are PARTIAL (`WHERE corpusSources @> {indian-corpus}`),
 * so against the 45M-row Google corpus it degrades to a sequential scan and is
 * abandoned at the statement timeout. Deriving "did the words literally appear"
 * from the document text keeps the overlap panel truthful for every corpus.
 */
function laneFor(result: NormalizedPatentResult, groups: string[][]): 'match' | 'cast' | 'both' | 'other' {
  const hasVector =
    typeof result.vectorRank === 'number' ||
    (result.scores?.semantic ?? 0) > 0 ||
    (result.scores?.conceptVector ?? 0) > 0 ||
    (result.scores?.bestFeatureVector ?? 0) > 0
  const hasText = cameFromTextLane(result) || (groups.length > 0 && satisfiesMatch(documentText(result), groups))

  if (hasText && hasVector) return 'both'
  if (hasText) return 'match'
  if (hasVector) return 'cast'
  return 'other'
}

const HARVEST_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'said', 'which', 'wherein', 'having', 'have',
  'are', 'was', 'were', 'being', 'been', 'configured', 'adapted', 'least', 'one', 'comprising', 'including',
  'plurality', 'first', 'second', 'third', 'each', 'such', 'when', 'while', 'thereof', 'therein', 'whereby',
  'about', 'between', 'within', 'through', 'other', 'present', 'invention', 'relates', 'provided', 'according',
  'device', 'system', 'method', 'apparatus', 'means', 'unit', 'portion', 'member', 'element',
])

/** Candidate vocabulary from a document the keyword lane could not reach. */
function harvestTerms(text: string): string[] {
  return Array.from(
    new Set(
      text
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/\s+/)
        .map(w => w.trim())
        .filter(w => w.length >= 5 && w.length <= 24 && !HARVEST_STOPWORDS.has(w))
    )
  )
}

function toDateString(value: string | Date | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
}

export async function runStudioPlan(input: {
  sessionId: string
  userId: string
  plan: StudioPlan
  planVersion: number
  requestHeaders: Record<string, string>
}): Promise<StudioRunPayload> {
  const started = Date.now()
  const compiled = compileStudioPlan(input.plan)
  if (compiled.warnings.length && !compiled.queryPlan.searchQuery && !compiled.queryPlan.retrievalQueries) {
    throw new Error(compiled.warnings[0])
  }

  const [corpusEstimate, filterEstimate, searchResponse] = await Promise.all([
    estimateCorpusCount(),
    estimateFilterCount(input.plan),
    patentSearchOrchestrator.search({
      searchMode: 'intelligent',
      query: compiled.queryPlan.searchQuery || compiled.queryPlan.semanticQuery || '',
      queryPlan: compiled.queryPlan,
      providerIds: [...STUDIO_PROVIDER_IDS],
      jurisdictions: compiled.jurisdictions,
      llmExpansion: false,
      // Studio searches OUR corpus and reports counted gates against it. The
      // orchestrator's live-API fallback (SerpAPI/EPO when the corpus returns
      // nothing) would inject documents from outside those counts, breaking the
      // funnel's arithmetic and the report's coverage statement. An empty result
      // is a real, reportable finding here — not something to paper over.
      disableProviderFallback: true,
      disableLinkedProviderExpansion: true,
      // The trigram GIN indexes are partial (indian-corpus/pqai only), so this
      // lane is a full scan of 45M rows on the Google corpus — it fires only
      // when the pool is under-filled, which is exactly when a search is
      // already slow. We do literal matching ourselves instead.
      skipTrigramSearch: true,
      limit: RESULT_LIMIT,
      candidateLimit: CANDIDATE_LIMIT,
      requestHeaders: input.requestHeaders,
    }),
  ])

  const rawPool = searchResponse.candidateResults?.length ? searchResponse.candidateResults : searchResponse.results
  const rawRanked = searchResponse.results

  // Hard guard: nothing from a live patent API may enter a Studio run.
  const pool = rawPool.filter(isLocalCorpusResult)
  const rankedRaw = rawRanked.filter(isLocalCorpusResult)
  const foreignCount = rawPool.length - pool.length
  const guardWarnings: string[] = []
  if (foreignCount > 0) {
    const offenders = Array.from(
      new Set(rawPool.filter(r => !isLocalCorpusResult(r)).map(r => String(r.sourceProvider || r.providerId)))
    )
    console.error(
      `[PriorArtStudio] Dropped ${foreignCount} result(s) from non-corpus provider(s): ${offenders.join(', ')}. ` +
        'Studio must search the stored corpus only.'
    )
    guardWarnings.push(
      `${foreignCount} result(s) from outside the stored corpus (${offenders.join(', ')}) were discarded — Studio reports only what our own corpus contains.`
    )
  }

  // MATCH as a counted filter.
  //
  // On the worldwide corpus the keyword lane cannot act as an independent
  // recall gate (no full-text index covers those 45M rows), so recall comes
  // from the vector lane and MATCH terms are enforced here, over what came
  // back. The count is surfaced in the funnel so the narrowing is never
  // invisible — and the semantics the canvas promises (every MATCH block must
  // be satisfied) still hold for every document the attorney sees.
  const groups = matchGroups(input.plan)
  const ranked = groups.length ? rankedRaw.filter(result => passesMatchRequirement(result, groups)) : rankedRaw
  const matchRemoved = rankedRaw.length - ranked.length
  // If Postgres' text lane contributed at all, the keyword index is serving
  // this corpus and MATCH is a true recall lane — not merely a post-filter.
  const textLaneServed = rankedRaw.some(cameFromTextLane)
  const matchWarnings: string[] = []
  if (groups.length && ranked.length === 0 && rankedRaw.length > 0) {
    matchWarnings.push(
      `Every one of the ${rankedRaw.length} retrieved documents was removed because it did not contain your MATCH terms literally. Switch a block to EXPAND, or loosen its wording.`
    )
  } else if (groups.length && matchRemoved > 0 && ranked.length < rankedRaw.length * 0.15) {
    matchWarnings.push(
      `MATCH terms removed ${matchRemoved} of ${rankedRaw.length} retrieved documents. If that feels too aggressive, switch a block to EXPAND.`
    )
  }

  // Family lookup: results don't carry familyId; batch-fetch it once.
  const pubs = Array.from(new Set(pool.map(r => r.publicationNumber).filter(Boolean)))
  const familyRows = pubs.length
    ? await prisma.localPatent.findMany({
        where: { publicationNumber: { in: pubs } },
        select: { publicationNumber: true, familyId: true },
      })
    : []
  const familyByPub = new Map(familyRows.map(r => [r.publicationNumber, r.familyId || null]))
  const familyKeyOf = (pub: string) => familyByPub.get(pub) || pub

  // Lane overlap across the recall pool (the recall-anxiety instrument).
  const lanes = { matchOnly: 0, castOnly: 0, both: 0 }
  for (const result of pool) {
    const lane = laneFor(result, groups)
    if (lane === 'match') lanes.matchOnly += 1
    else if (lane === 'cast') lanes.castOnly += 1
    else if (lane === 'both') lanes.both += 1
  }

  // Vocabulary gap: of the documents found ONLY by meaning, how many share no
  // query term at all? Those are documents a keyword-only search could never
  // have returned — and their wording is the vocabulary the canvas is missing.
  const planTerms = input.plan.blocks
    .flatMap(block => activeTerms(block.terms))
    .map(t => t.toLowerCase().replace(/\*/g, '').trim())
    .filter(t => t.length >= 3)
  const castOnly = pool.filter(result => laneFor(result, groups) === 'cast')
  let noSharedTerm = 0
  const harvest = new Map<string, number>()
  for (const result of castOnly) {
    const text = `${result.title || ''} ${result.abstract || result.snippet || ''}`.toLowerCase()
    if (!planTerms.some(term => text.includes(term))) {
      noSharedTerm += 1
      for (const word of harvestTerms(text)) {
        if (planTerms.some(term => word.includes(term) || term.includes(word))) continue
        harvest.set(word, (harvest.get(word) || 0) + 1)
      }
    }
  }
  const vocabularyGap = castOnly.length ? Number((noSharedTerm / castOnly.length).toFixed(2)) : 0
  const suggestedTerms = Array.from(harvest.entries())
    .filter(([, count]) => count >= Math.max(2, Math.ceil(castOnly.length * 0.06)))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([term]) => term)

  // Collapse ranked results into families (first hit per family wins = highest ranked).
  const familyOrder: string[] = []
  const familyMap = new Map<string, StudioResultFamily>()
  for (const result of ranked) {
    const key = familyKeyOf(result.publicationNumber)
    const existing = familyMap.get(key)
    if (existing) {
      if (existing.members.length < 12 && !existing.members.some(m => m.publicationNumber === result.publicationNumber)) {
        existing.members.push({
          publicationNumber: result.publicationNumber,
          title: result.title,
          publicationDate: toDateString(result.publicationDate),
          jurisdiction: result.jurisdiction,
        })
      }
      continue
    }
    familyOrder.push(key)
    familyMap.set(key, {
      familyKey: key,
      publicationNumber: result.publicationNumber,
      title: result.title,
      abstract: result.abstract || null,
      snippet: result.snippet || null,
      applicants: Array.isArray(result.applicants)
        ? (result.applicants as unknown[]).map(a => String(a)).slice(0, 3).join('; ')
        : typeof result.applicants === 'string'
          ? result.applicants
          : undefined,
      publicationDate: toDateString(result.publicationDate),
      jurisdiction: result.jurisdiction,
      classifications: (result.classifications || result.cpcCodes || []).slice(0, 6),
      link: result.link || result.sourceUrl || null,
      members: [
        {
          publicationNumber: result.publicationNumber,
          title: result.title,
          publicationDate: toDateString(result.publicationDate),
          jurisdiction: result.jurisdiction,
        },
      ],
      lane: laneFor(result, groups),
      rerankScore: result.rerankScore ?? result.scores?.rerank,
      hybridScore: result.hybridScore ?? result.scores?.hybrid,
      matchedFields: result.matchedFields?.slice(0, 8),
      matchReasons: result.matchReasons?.slice(0, 4),
    })
  }

  // Count distinct families across the whole recall pool for the funnel.
  const poolFamilyKeys = new Set(pool.map(r => familyKeyOf(r.publicationNumber)))

  // Diff vs previous run (what did this plan change buy us?).
  const previousRun = await prisma.priorArtStudioRun.findFirst({
    where: { sessionId: input.sessionId },
    orderBy: { createdAt: 'desc' },
    select: { results: true },
  })
  const previousKeys = new Set<string>(
    Array.isArray(previousRun?.results)
      ? (previousRun?.results as Array<{ familyKey?: string }>).map(f => f.familyKey || '').filter(Boolean)
      : []
  )
  let newFamilyCount = 0
  const families = familyOrder.map(key => {
    const family = familyMap.get(key)!
    family.isNew = previousKeys.size > 0 && !previousKeys.has(key)
    if (family.isNew) newFamilyCount += 1
    return family
  })

  // Per-element evidence for the Element Grid, computed over the shown set only
  // (a direct scan of ~100 rows — precise, and it never touches the ANN index).
  if (input.plan.elements.length && families.length) {
    try {
      const graded = families.slice(0, ELEMENT_GRID_LIMIT)
      const cells = await scoreElements({
        elements: input.plan.elements,
        publicationNumbers: graded.map(f => f.publicationNumber),
      })
      for (const family of graded) {
        const perDoc = cells[family.publicationNumber]
        if (perDoc) family.elementCells = perDoc
      }
    } catch (error) {
      console.warn('[PriorArtStudio] Element scoring failed (results still valid):', error)
    }
  }

  // Without an embedding key the retrieval core skips the vector lane SILENTLY
  // and falls back to text/trigram. Studio would then show "meaning-only: 0" as
  // though it were a finding about the art, when in fact the lane never ran.
  // Say so loudly instead — a wrong zero is worse than an error here.
  const semanticLaneRan = hasSearchEmbeddingApiKey()
  const laneWarnings: string[] = []
  if (!semanticLaneRan) {
    laneWarnings.push(
      'The meaning-based lane did NOT run (no embedding API key configured), so these results come from keyword matching alone. The lane counts and vocabulary-gap figure below are not meaningful for this run, and recall across the worldwide corpus is severely reduced.'
    )
  }

  const gateDetail = await buildGateDetail(input.plan, corpusEstimate)

  const gateCounts: StudioGateCounts = {
    corpus: corpusEstimate,
    corpusIsEstimate: true,
    filters: filterEstimate,
    filtersIsEstimate: true,
    recall: searchResponse.diagnostics?.providerCandidateCount ?? pool.length,
    matchRemoved,
    matchMode: groups.length ? (textLaneServed ? 'lane' : 'filter') : 'none',
    families: poolFamilyKeys.size,
    shown: families.length,
    lanes,
    vocabularyGap,
    semanticLaneRan,
    steered: Boolean(input.plan.steer?.enabled && input.plan.steer.publicationNumbers.length),
  }

  const durationMs = Date.now() - started
  const storedFamilies = families.slice(0, STORED_FAMILY_LIMIT)
  const run = await prisma.priorArtStudioRun.create({
    data: {
      sessionId: input.sessionId,
      planVersion: input.planVersion,
      planSnapshot: input.plan as unknown as Prisma.InputJsonValue,
      planHash: compiled.planHash,
      gateCounts: gateCounts as unknown as Prisma.InputJsonValue,
      providerStats: searchResponse.providerStats as unknown as Prisma.InputJsonValue,
      warnings: [...compiled.warnings, ...laneWarnings, ...guardWarnings, ...matchWarnings, ...(searchResponse.warnings || [])] as unknown as Prisma.InputJsonValue,
      results: storedFamilies as unknown as Prisma.InputJsonValue,
      resultCount: ranked.length,
      familyCount: poolFamilyKeys.size,
      newFamilyCount,
      durationMs,
    },
  })

  await appendTrail(
    input.sessionId,
    'RUN',
    `user:${input.userId}`,
    `Run v${input.planVersion} (${compiled.planHash}): ${gateCounts.recall.toLocaleString()} recall → ${gateCounts.families.toLocaleString()} families → ${families.length} shown${newFamilyCount ? ` (+${newFamilyCount} new)` : ''}`,
    { planHash: compiled.planHash, gateCounts, booleanPreview: compiled.booleanPreview } as unknown as Prisma.InputJsonValue
  )

  return {
    runId: run.id,
    planVersion: input.planVersion,
    planHash: compiled.planHash,
    createdAt: run.createdAt.toISOString(),
    gateCounts,
    gateDetail,
    families,
    warnings: [...compiled.warnings, ...laneWarnings, ...guardWarnings, ...matchWarnings, ...(searchResponse.warnings || [])],
    newFamilyCount,
    durationMs,
    booleanPreview: compiled.booleanPreview,
    suggestedTerms,
  }
}

/**
 * The stopping rule. Reviewing 1,000 references has no natural end; this shows
 * whether new *relevant* documents are still appearing, so the attorney can
 * stop on evidence rather than exhaustion — and defend the depth in the report.
 */
export function computeSaturation(
  marks: Array<{ tag: string | null; updatedAt: Date }>,
  bucketSize = 25
): StudioSaturation {
  const ordered = [...marks].sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
  const buckets: Array<{ reviewed: number; newRelevant: number }> = []
  for (let start = 0; start < ordered.length; start += bucketSize) {
    const slice = ordered.slice(start, start + bucketSize)
    buckets.push({
      reviewed: start + slice.length,
      newRelevant: slice.filter(m => m.tag === 'RELEVANT').length,
    })
  }
  const recent = buckets.slice(-2)
  const recentRelevant = recent.reduce((sum, b) => sum + b.newRelevant, 0)

  let suggestion: string
  if (ordered.length < bucketSize) {
    suggestion = 'Too early to judge — keep reviewing.'
  } else if (recentRelevant === 0) {
    suggestion = 'No new relevant art in the last two batches. This search looks saturated — a defensible place to stop.'
  } else if (recentRelevant <= 1) {
    suggestion = 'Relevant hits are thinning out. Consider finishing this batch, then stopping.'
  } else {
    suggestion = 'Still finding relevant art — keep going, and consider widening a MATCH block to EXPAND.'
  }

  return { reviewed: ordered.length, buckets, recentRelevant, suggestion }
}

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

export async function getOwnedSession(sessionId: string, userId: string) {
  const session = await prisma.priorArtStudioSession.findUnique({ where: { id: sessionId } })
  if (!session || session.userId !== userId) return null
  return session
}

export function summarizePlanEdit(before: StudioPlan, after: StudioPlan): string {
  const parts: string[] = []
  const beforeTerms = before.blocks.flatMap(b => activeTerms(b.terms)).length
  const afterTerms = after.blocks.flatMap(b => activeTerms(b.terms)).length
  if (after.blocks.length !== before.blocks.length) parts.push(`${after.blocks.length} blocks`)
  if (afterTerms !== beforeTerms) parts.push(`${afterTerms} active terms`)
  const beforeCpc = before.cpc.filter(c => c.accepted).length
  const afterCpc = after.cpc.filter(c => c.accepted).length
  if (afterCpc !== beforeCpc) parts.push(`${afterCpc} CPC codes`)
  if (after.title !== before.title) parts.push('title changed')
  return parts.length ? `Plan edited: ${parts.join(', ')}` : 'Plan edited'
}
