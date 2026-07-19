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

const RESULT_LIMIT = 200
const CANDIDATE_LIMIT = 1000
const STORED_FAMILY_LIMIT = 200

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
- 3 to 6 blocks, one per independent concept of the invention; together the blocks should describe the invention.
- Include patentese variants attorneys would miss (e.g. "fastener" -> "fastening means", "elongate member").
- Mode meanings, and they matter a great deal:
    MATCH  = REQUIRED VOCABULARY. Documents missing these terms are flagged "misses MATCH" and the
             attorney typically filters to the meets-set. Only title+abstract (~150 words) is searched,
             so every extra MATCH block shrinks the meets-set sharply. Use MATCH for AT MOST ONE block —
             the single most certain-to-appear term of art. Prefer zero MATCH blocks over a risky one.
    EXPAND = meaning-based only. Widens the search. Safe.
    BOTH   = the terms widen the search AND boost ranking, but require nothing. Safe.
  Default to BOTH or EXPAND. Never use MATCH for invented or descriptive phrases (e.g. "goal state
  machine", "user-configurable goals") — those do not appear verbatim in real patent abstracts.
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
 * The literal requirement: one array of alternatives per **MATCH** block.
 *
 * ONLY `MATCH` gates. `BOTH` used to be included here, which made it a hard
 * AND-ed requirement while the canvas and the report both rendered it as
 * `((terms) OR CAST(concept))` — an OR. A user setting four of five blocks to
 * MATCH/BOTH therefore had to find a patent whose ~150-word abstract literally
 * contained a term from all four groups, and every retrieved document was
 * discarded. `BOTH` now widens (feeds both lanes) and requires nothing.
 */
function matchGroups(plan: StudioPlan): string[][] {
  return plan.blocks
    .filter(block => block.mode === 'MATCH')
    .map(block =>
      activeTerms(block.terms)
        .map(term => term.toLowerCase().replace(/\*/g, '').trim())
        .filter(term => term.length >= 3)
    )
    .filter(group => group.length > 0)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Word-boundary term test.
 *
 * Raw `text.includes(term)` matched substrings: the abbreviation "BLE" matched
 * inside "wearable", "portable", "cable", "flexible" — so in a wearables corpus
 * that group passed unconditionally and enforced nothing, while four-word
 * phrases in the same filter were near-impossible to satisfy. The filter was
 * simultaneously too loose and too strict because it had no token boundaries.
 */
function containsTerm(text: string, term: string): boolean {
  if (!term) return false
  // \b is unreliable next to non-word chars (hyphens, slashes) common in
  // patentese, so anchor on "not a word character" instead.
  const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(term)}([^a-z0-9]|$)`, 'i')
  return pattern.test(text)
}

function satisfiesMatch(text: string, groups: string[][]): boolean {
  return groups.every(group => group.some(term => containsTerm(text, term)))
}

/** Terms the attorney excluded, applied here rather than as a SQL ILIKE. */
function excludedTerms(plan: StudioPlan): string[] {
  return activeTerms(plan.notTerms)
    .map(t => t.toLowerCase().trim())
    .filter(t => t.length >= 3)
}

function isExcluded(text: string, terms: string[]): boolean {
  return terms.some(term => containsTerm(text, term))
}

/**
 * Lane attribution, computed from the document's own text rather than provider
 * ranks — the keyword lane can time out or be unindexed for a corpus, and the
 * overlap panel must stay truthful either way.
 *
 * `literalVocabulary` is every literal term on the canvas (MATCH and BOTH), not
 * just the gating ones: the question this answers is "would a keyword search
 * have found this?", which BOTH terms contribute to even though they no longer
 * gate.
 */
function laneFor(
  result: NormalizedPatentResult,
  text: string,
  literalVocabulary: string[]
): 'match' | 'cast' | 'both' | 'other' {
  const hasVector =
    typeof result.vectorRank === 'number' ||
    (result.scores?.semantic ?? 0) > 0 ||
    (result.scores?.conceptVector ?? 0) > 0 ||
    (result.scores?.bestFeatureVector ?? 0) > 0
  const hasText = literalVocabulary.length
    ? literalVocabulary.some(term => containsTerm(text, term))
    : typeof result.textRank === 'number' || (result.scores?.text ?? 0) > 0

  if (hasText && hasVector) return 'both'
  if (hasText) return 'match'
  if (hasVector) return 'cast'
  return 'other'
}

const HARVEST_STOPWORDS = new Set([
  // document-structure words that show up in every abstract and taught the
  // harvest bar to suggest junk like "abstract" / "inventors" / "includes"
  'abstract', 'title', 'inventor', 'inventors', 'applicant', 'applicants', 'classification', 'classifications',
  'includes', 'included', 'including', 'discloses', 'disclosed', 'disclosure', 'describes', 'described',
  'summary', 'background', 'field', 'figure', 'figures', 'embodiment', 'embodiments', 'preferred',
  'improved', 'improvement', 'various', 'thereby', 'therefor', 'therefore', 'herein', 'wherein',
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
  /** 'deep' (default): full probe budgets, 30-60s. 'fast': the quick iterate loop. */
  depth?: 'deep' | 'fast'
}): Promise<StudioRunPayload> {
  const depth: 'deep' | 'fast' = input.depth === 'fast' ? 'fast' : 'deep'
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
      // Attorneys accept 30-60s for a supervised deep search; the UI shows a
      // staged progress narrative while this runs. Fast scans keep the 8s
      // budgets for quick iteration while shaping the canvas.
      deepSearch: depth === 'deep',
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

  // Fetch family AND the searchable text in one pass, BEFORE any filtering.
  //
  // The result payload carries only title/abstract/snippet, but the keyword
  // index is built over title + abstract + abstractOriginal + ragText
  // (top_terms). Judging literal presence from the payload alone would discard
  // documents that legitimately contain a term in a field we simply hadn't
  // fetched — so we read the same fields the index does.
  const pubs = Array.from(
    new Set([...pool, ...rankedRaw].map(r => r.publicationNumber).filter(Boolean))
  )
  const corpusRows = pubs.length
    ? await prisma.localPatent.findMany({
        where: { publicationNumber: { in: pubs } },
        select: {
          publicationNumber: true,
          familyId: true,
          title: true,
          abstract: true,
          abstractOriginal: true,
          ragText: true,
        },
      })
    : []
  const familyByPub = new Map(corpusRows.map(r => [r.publicationNumber, r.familyId || null]))
  const familyKeyOf = (pub: string) => familyByPub.get(pub) || pub
  const textByPub = new Map(
    corpusRows.map(r => [
      r.publicationNumber,
      `${r.title || ''} ${r.abstract || ''} ${r.abstractOriginal || ''} ${r.ragText || ''}`.toLowerCase(),
    ])
  )
  /** Fall back to the payload for anything not in the local corpus. */
  const searchTextFor = (result: NormalizedPatentResult): string =>
    textByPub.get(result.publicationNumber) ||
    `${result.title || ''} ${result.abstract || ''} ${result.snippet || ''}`.toLowerCase()

  // MATCH as a counted filter, plus attorney exclusions.
  //
  // Only MATCH blocks gate. Exclusions are applied here rather than as a SQL
  // `excludeTerms` filter, which the provider compiles into an unindexable
  // ILIKE over fully-detoasted claims/description text on every lane.
  const groups = matchGroups(input.plan)
  const notTerms = excludedTerms(input.plan)
  const literalVocabulary = input.plan.blocks
    .filter(b => b.mode !== 'EXPAND')
    .flatMap(b => activeTerms(b.terms))
    .map(t => t.toLowerCase().replace(/\*/g, '').trim())
    .filter(t => t.length >= 3)

  // NOTHING retrieved is ever deleted. Every document is CLASSIFIED — does it
  // satisfy the MATCH blocks? does it hit a NOT term? — and the attorney
  // filters by those classifications in the UI. A document that misses your
  // exact words may still be the closest art; hiding it was a design failure
  // (a production run once showed 1 of 120 retrieved documents because of it).
  const matchFlags = new Map<string, { meetsMatch: boolean; hitsNotTerm: boolean }>()
  let matchSatisfied = 0
  let notHits = 0
  const ranked = rankedRaw
  for (const result of ranked) {
    const text = searchTextFor(result)
    const meetsMatch = groups.length ? satisfiesMatch(text, groups) : true
    const hitsNotTerm = notTerms.length ? isExcluded(text, notTerms) : false
    if (meetsMatch) matchSatisfied += 1
    if (hitsNotTerm) notHits += 1
    matchFlags.set(result.publicationNumber, { meetsMatch, hitsNotTerm })
  }
  const matchRemoved = ranked.length - matchSatisfied
  const matchWarnings: string[] = []
  if (groups.length && matchSatisfied === 0 && ranked.length > 0) {
    matchWarnings.push(
      `None of the ${ranked.length} retrieved documents literally contains a term from every MATCH block — all are still shown below, flagged. Your MATCH wording may not be how these patents speak; consider switching a block to BOTH.`
    )
  } else if (groups.length && matchSatisfied < ranked.length * 0.15 && ranked.length > 0) {
    matchWarnings.push(
      `Only ${matchSatisfied} of ${ranked.length} retrieved documents meet every MATCH block. All are shown — use the MATCH filter above the results to focus on either group.`
    )
  }
  if (notHits > 0) {
    matchWarnings.push(
      `${notHits} document(s) contain one of your NOT terms. They are hidden by default but never deleted — a filter above the results shows them.`
    )
  }

  // Lane overlap across the recall pool (the recall-anxiety instrument).
  const lanes = { matchOnly: 0, castOnly: 0, both: 0 }
  for (const result of pool) {
    const lane = laneFor(result, searchTextFor(result), literalVocabulary)
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
  const castOnly = pool.filter(result => laneFor(result, searchTextFor(result), literalVocabulary) === 'cast')
  let noSharedTerm = 0
  const harvest = new Map<string, number>()
  for (const result of castOnly) {
    const text = searchTextFor(result)
    if (!planTerms.some(term => containsTerm(text, term))) {
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
      lane: laneFor(result, searchTextFor(result), literalVocabulary),
      meetsMatch: matchFlags.get(result.publicationNumber)?.meetsMatch ?? true,
      hitsNotTerm: matchFlags.get(result.publicationNumber)?.hitsNotTerm ?? false,
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
  const elementWarnings: string[] = []
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
      const scoredCount = graded.filter(f => f.elementCells).length
      if (scoredCount === 0) {
        elementWarnings.push(
          'Element evidence could not be computed for any document — the Element Grid is empty for this run, not "no teaching found".'
        )
      }
    } catch (error) {
      console.warn('[PriorArtStudio] Element scoring failed:', error)
      elementWarnings.push(
        `Element evidence was not computed (${error instanceof Error ? error.message : 'scoring failed'}). The Element Grid is unavailable for this run — treat blank cells as "not assessed", not as "no teaching".`
      )
    }
  } else if (input.plan.elements.length && !families.length) {
    // Silent skip previously: the grid rendered empty and the report printed
    // "No references were shortlisted" as if it were a review outcome.
    elementWarnings.push(
      'Element evidence was not computed because no documents survived to be scored.'
    )
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
    matchSatisfied,
    notHits,
    matchMode: groups.length ? 'filter' : 'none',
    // Families of the reviewable (ranked) set, so the funnel tells one story:
    // Retrieved -> Families -> For review. The full recall pool's family count
    // belongs to diagnostics, not the headline funnel.
    families: familyOrder.length,
    shown: families.length,
    lanes,
    vocabularyGap,
    semanticLaneRan,
    depth,
    steered: Boolean(input.plan.steer?.enabled && input.plan.steer.publicationNumbers.length),
  }

  const durationMs = Date.now() - started

  // ------------------------------------------------------------- telemetry
  // One structured line per run, so `pm2 logs` carries the complete internal
  // picture of every search — parseable by scripts/studio-log-health.ts.
  // Alerts are the invariants whose silent violation caused real production
  // incidents; they log at error level so they stand out in any log viewer.
  const alertEvents: string[] = []
  if (rankedRaw.length > 0 && families.length === 0) alertEvents.push('zero_results_after_filtering') // now only reachable via a collapse bug — MATCH no longer deletes
  if (!semanticLaneRan) alertEvents.push('semantic_lane_skipped')
  if (semanticLaneRan && pool.length > 0 && lanes.castOnly === 0 && lanes.both === 0) {
    alertEvents.push('vector_lane_contributed_nothing')
  }
  if (foreignCount > 0) alertEvents.push('foreign_provider_results_dropped')
  if (elementWarnings.length > 0) alertEvents.push('element_scoring_degraded')
  for (const event of alertEvents) {
    console.error(
      '[StudioAlert]',
      JSON.stringify({ event, sessionId: input.sessionId, planHash: compiled.planHash, planVersion: input.planVersion })
    )
  }
  console.log(
    '[StudioTelemetry]',
    JSON.stringify({
      event: 'studio_run_completed',
      depth,
      sessionId: input.sessionId,
      planVersion: input.planVersion,
      planHash: compiled.planHash,
      durationMs,
      retrieved: rankedRaw.length,
      shown: families.length,
      matchSatisfied,
      matchRemoved,
      notHits,
      families: poolFamilyKeys.size,
      newFamilyCount,
      lanes,
      vocabularyGap,
      semanticLaneRan,
      steered: gateCounts.steered,
      matchMode: gateCounts.matchMode,
      elementsScored: families.filter(f => f.elementCells).length,
      warningsCount:
        compiled.warnings.length + laneWarnings.length + guardWarnings.length + matchWarnings.length + elementWarnings.length,
      alerts: alertEvents,
      providerStats: (searchResponse.providerStats || []).map(s => ({
        providerId: s.providerId,
        resultCount: s.resultCount,
        error: s.error ? String(s.error).slice(0, 120) : undefined,
      })),
    })
  )

  const storedFamilies = families.slice(0, STORED_FAMILY_LIMIT)
  const run = await prisma.priorArtStudioRun.create({
    data: {
      sessionId: input.sessionId,
      planVersion: input.planVersion,
      planSnapshot: input.plan as unknown as Prisma.InputJsonValue,
      planHash: compiled.planHash,
      gateCounts: gateCounts as unknown as Prisma.InputJsonValue,
      providerStats: searchResponse.providerStats as unknown as Prisma.InputJsonValue,
      warnings: [...compiled.warnings, ...laneWarnings, ...guardWarnings, ...matchWarnings, ...elementWarnings, ...(searchResponse.warnings || [])] as unknown as Prisma.InputJsonValue,
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
    `${depth === 'deep' ? 'Deep search' : 'Fast scan'} v${input.planVersion} (${compiled.planHash}): ${gateCounts.recall.toLocaleString()} recall → ${gateCounts.families.toLocaleString()} families → ${families.length} shown${newFamilyCount ? ` (+${newFamilyCount} new)` : ''}`,
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
    warnings: [...compiled.warnings, ...laneWarnings, ...guardWarnings, ...matchWarnings, ...elementWarnings, ...(searchResponse.warnings || [])],
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
