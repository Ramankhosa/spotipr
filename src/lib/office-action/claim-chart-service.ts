import { prisma } from '../prisma'
import type { OfficeActionProfile } from './oa-profile-schema'
import { runOaStage, fenceUntrusted, type OaGateway } from './oa-llm-service'
import { parseClaimElements, type ClaimElement } from './document-intake'
import { verifyQuote } from './objection-classifier'
import { normalizeLegacyClaimChart, coerceCellVerdict, type CellVerdictV2 } from './oa-json-schema'
import {
  scanForFeature, determineCorpusCompleteness, assessExtractionQuality, type CitationCorpus
} from './absence-scan'

/**
 * Office Action Studio — claim chart (OA_CITATION_ANALYSIS)
 *
 * Builds the feature × citation grid that the whole inventive-step / novelty
 * argument rests on: for each claim element, does each cited document disclose
 * it? Every DISCLOSED cell must carry a passage that is an exact substring of
 * the cited document's text — a fabricated "disclosure" is downgraded to
 * AMBIGUOUS rather than trusted.
 */

/**
 * NOT_FOUND replaces the old NOT_DISCLOSED: one passage proves disclosure, but
 * no retrieved passage does NOT prove absence, and the old name invited the
 * reply to assert the stronger claim. UNKNOWN_DOCUMENT_INCOMPLETE is "we could
 * not look properly", which is a different thing from "we looked and did not
 * find" — and is what the 6,000-character prompt truncation actually produced.
 */
export type CellVerdict = CellVerdictV2

export interface ChartCell {
  citationLabel: string
  verdict: CellVerdict
  passage?: string        // verbatim from the cited document
  location?: string       // e.g. "Abstract", "col. 4 ln. 12"
  quoteVerified: boolean
  /**
   * Set when a model absence verdict was overturned by scanning the complete
   * stored document. Carries the term that matched and its surrounding text, so
   * the attorney reads the evidence rather than taking a downgrade on trust.
   */
  absenceOverturned?: { rule: string; term: string; passage: string }
}

export interface ChartRow {
  claimNumber: number
  /** Display ordering only — shifts when decomposition changes. */
  elementIndex: number
  /** Stable identity, derived from the claim text. The merge key. */
  elementId: string
  feature: string
  cells: ChartCell[]
}

export interface ClaimChart {
  claimNumbers: number[]
  citationLabels: string[]
  rows: ChartRow[]
  /** Features absent from every citation — the distinctions the reply argues. */
  distinctions: Array<{ claimNumber: number; feature: string }>
}

export interface CitationText {
  label: string
  kind?: 'PATENT' | 'NPL' | string
  title?: string
  abstract?: string
  claims?: string
  description?: string
  /** NPL only — the attorney uploaded the whole paper, not a scraped snippet. */
  suppliedAsCompleteDocument?: boolean
  expectedPageCount?: number
  extractedPageCount?: number
  extractionError?: string
}

/** Concatenate a citation's text for quote verification. */
function citationCorpus(c: CitationText): string {
  return [c.title, c.abstract, c.claims, c.description].filter(Boolean).join('\n\n')
}

/**
 * Claim numbers as numbers, whatever the model returned.
 *
 * `claimsAffected` comes straight off LLM output and is stored as JSON, so it
 * routinely arrives as ["1","3"] or ["claim 1"]. The element filter below is a
 * strict `includes`, so a string claim number matched nothing, `buildClaimChart`
 * returned "No claim elements parsed", and the pipeline dropped the chart —
 * leaving the novelty/inventive-step section drafted with no evidence at all and
 * nothing surfaced to say so.
 */
export function toClaimNumbers(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  const out: number[] = []
  for (const v of value) {
    const n = typeof v === 'number' ? v : Number(String(v ?? '').match(/\d+/)?.[0])
    if (Number.isFinite(n) && n > 0) out.push(n)
  }
  return Array.from(new Set(out))
}

export async function buildClaimChart(
  profile: OfficeActionProfile,
  input: {
    claimsText: string
    claimNumbers: number[]        // claims the objection affects
    citations: CitationText[]
  },
  opts: { tenantId?: string; userId?: string; requestHeaders?: Record<string, string> } = {},
  gateway?: OaGateway
): Promise<{ success: boolean; chart?: ClaimChart; error?: string }> {
  const allElements = parseClaimElements(input.claimsText)
  const wanted = toClaimNumbers(input.claimNumbers)
  const elements = allElements.filter(e => wanted.length === 0 || wanted.includes(e.claimNumber))
  if (!elements.length) return { success: false, error: 'No claim elements parsed' }
  if (!input.citations.length) return { success: true, chart: emptyChart(elements) }

  const promptInput = [
    'Claim elements (rows):',
    JSON.stringify(elements.map((e, i) => ({ row: i, claim: e.claimNumber, feature: e.text }))),
    '',
    'Cited documents (columns) — quote ONLY from these texts:',
    // Fenced: these are fetched from a public page or uploaded by the attorney,
    // and this is the stage whose verdicts the whole novelty argument rests on.
    input.citations.map(c => fenceUntrusted(`cited document ${c.label}`, truncate(citationCorpus(c), 6000))).join('\n\n'),
    '',
    'For every row × document, decide DISCLOSED / NOT_FOUND / AMBIGUOUS. For DISCLOSED you MUST include `passage` copied verbatim from that document plus a short `location`. If you cannot find a verbatim passage, use NOT_FOUND or AMBIGUOUS — never invent one. NOT_FOUND means you did not find it in the text supplied, not that the document does not contain it.',
    'Return JSON: { cells: [{ row, citationLabel, verdict, passage?, location? }] }.'
  ].join('\n')

  const res = await runOaStage<{ cells: any[] }>(
    { stageCode: 'OA_CITATION_ANALYSIS', profile, input: promptInput,
      tenantId: opts.tenantId, userId: opts.userId, requestHeaders: opts.requestHeaders, purpose: 'office_action:claim_chart' },
    gateway
  )
  if (!res.success || !res.data?.cells) return { success: false, error: res.error || 'Claim chart failed' }

  const corpusByLabel = new Map(input.citations.map(c => [c.label, citationCorpus(c)]))
  const chart = assembleChart(elements, input.citations.map(c => c.label), res.data.cells, corpusByLabel)
  // The model saw 6,000 characters. Verify every absence against the whole thing.
  verifyAbsences(chart, input.citations)
  return { success: true, chart }
}

/** Deterministic assembly + quote verification of the model's cells. */
export function assembleChart(
  elements: ClaimElement[],
  labels: string[],
  cells: any[],
  corpusByLabel: Map<string, string>
): ClaimChart {
  const rows: ChartRow[] = elements.map(e => ({
    claimNumber: e.claimNumber, elementIndex: e.elementIndex, elementId: e.elementId, feature: e.text,
    cells: labels.map(l => ({ citationLabel: l, verdict: 'AMBIGUOUS' as CellVerdict, quoteVerified: false }))
  }))

  for (const raw of cells) {
    const rowIdx = Number(raw?.row)
    const row = rows[rowIdx]
    if (!row) continue
    const cell = row.cells.find(c => c.citationLabel === raw?.citationLabel)
    if (!cell) continue
    const verdict: CellVerdict = coerceCellVerdict(raw?.verdict)   // accepts the legacy NOT_DISCLOSED token
    const passage = typeof raw?.passage === 'string' ? raw.passage : undefined
    const source = corpusByLabel.get(cell.citationLabel) || ''
    const verified = passage ? verifyQuote(passage, source) : false

    // A DISCLOSED verdict without a verifiable passage is NOT trusted.
    cell.verdict = verdict === 'DISCLOSED' && !verified ? 'AMBIGUOUS' : verdict
    cell.passage = verified ? passage : undefined
    cell.location = verified ? (typeof raw?.location === 'string' ? raw.location : undefined) : undefined
    cell.quoteVerified = verified
  }

  // Only a searched, found-nothing result may become a distinction the reply
  // argues. AMBIGUOUS and UNKNOWN_DOCUMENT_INCOMPLETE must not: asserting
  // absence from a document we could not read properly is how a reply comes to
  // state something false about the prior art.
  const distinctions = rows
    .filter(r => r.cells.length > 0 && r.cells.every(c => c.verdict === 'NOT_FOUND'))
    .map(r => ({ claimNumber: r.claimNumber, feature: r.feature }))

  return {
    claimNumbers: Array.from(new Set(elements.map(e => e.claimNumber))).sort((a, b) => a - b),
    citationLabels: labels, rows, distinctions
  }
}

function emptyChart(elements: ClaimElement[]): ClaimChart {
  return {
    claimNumbers: Array.from(new Set(elements.map(e => e.claimNumber))).sort((a, b) => a - b),
    citationLabels: [],
    rows: elements.map(e => ({ claimNumber: e.claimNumber, elementIndex: e.elementIndex, elementId: e.elementId, feature: e.text, cells: [] })),
    distinctions: []
  }
}

function truncate(s: string, n: number): string { return s.length > n ? s.slice(0, n) + '…' : s }

/**
 * No absence verdict leaves this module unverified against the FULL document.
 *
 * The model is shown a 6,000-character slice of a document that may run to
 * 200,000. Its "not disclosed" therefore means "not in the part I was given",
 * which is not what the reply goes on to assert. Two outcomes here:
 *
 *  - the document is not completely on file, or did not extract properly →
 *    UNKNOWN_DOCUMENT_INCOMPLETE. We could not look properly, which is a
 *    different thing from having looked and found nothing.
 *  - the feature IS somewhere in the full text → AMBIGUOUS, with the passage
 *    attached. Not DISCLOSED: a term appearing is not the same as the feature
 *    being taught, and that judgement is the attorney's.
 *
 * Only a verdict that survives both stays NOT_FOUND, and only NOT_FOUND may
 * become a distinction the reply argues.
 */
export function verifyAbsences(chart: ClaimChart, citations: CitationText[]): void {
  const byLabel = new Map(citations.map(c => [c.label, c]))

  for (const row of chart.rows) {
    for (const cell of row.cells) {
      if (cell.verdict !== 'NOT_FOUND') continue
      const citation = byLabel.get(cell.citationLabel)
      if (!citation) continue

      const corpus: CitationCorpus = citation
      if (!determineCorpusCompleteness(corpus) || assessExtractionQuality(corpus) !== 'GOOD') {
        cell.verdict = 'UNKNOWN_DOCUMENT_INCOMPLETE'
        continue
      }

      const hit = scanForFeature(row.feature, citationCorpus(citation))
      if (hit.found) {
        cell.verdict = 'AMBIGUOUS'
        cell.absenceOverturned = { rule: hit.rule!, term: hit.term!, passage: hit.passage || '' }
      }
    }
  }

  // Distinctions are derived AFTER verification, or they would still be built
  // from the unverified verdicts.
  chart.distinctions = chart.rows
    .filter(r => r.cells.length > 0 && r.cells.every(c => c.verdict === 'NOT_FOUND'))
    .map(r => ({ claimNumber: r.claimNumber, feature: r.feature }))
}

/** A chart write lost every race it entered. Surfaced, never silently dropped. */
export class ClaimChartConcurrencyError extends Error {
  constructor(citationId: string) {
    super(`Could not merge the claim chart for citation ${citationId} — it kept changing underneath the write.`)
    this.name = 'ClaimChartConcurrencyError'
  }
}

/**
 * Merge an incoming chart slice into whatever is already stored for a citation.
 *
 * Rows are identified by `elementId`, which is derived from the claim text
 * itself. A positional index is not usable here: it shifts whenever claim
 * decomposition changes or a claim is amended, so a merge keyed on it silently
 * replaces one limitation of a claim with a different one.
 *
 * A cell whose stored verdict disagrees with the incoming one is recorded as a
 * CONFLICT rather than overwritten. Two objections disagreeing about what D1
 * discloses is exactly the signal worth showing the attorney, and the lint
 * blocks export when a chart carrying an unresolved conflict is relied on.
 */
export function mergeClaimChartSlices(existing: any, incoming: ChartSlice): ChartSlice {
  const prev: ChartSlice = existing && Array.isArray(existing.rows)
    ? existing as ChartSlice
    : { schemaVersion: 2, claimNumbers: [], rows: [] }

  const byId = new Map<string, ChartSliceRow>()
  for (const row of prev.rows) if (row?.elementId) byId.set(row.elementId, row)
  // Rows from before elementId existed cannot be matched to anything; keep them
  // for display rather than dropping evidence we merely cannot re-key.
  const unkeyed = prev.rows.filter(r => !r?.elementId)

  for (const row of incoming.rows) {
    if (!row.elementId) continue
    const before = byId.get(row.elementId)
    if (before?.cell && row.cell && before.cell.verdict !== row.cell.verdict) {
      byId.set(row.elementId, {
        ...row,
        cell: {
          ...row.cell,
          conflict: {
            status: 'CONFLICT',
            previousVerdict: before.cell.verdict,
            incomingVerdict: row.cell.verdict
          }
        }
      })
      continue
    }
    byId.set(row.elementId, row)
  }

  const rows = [...unkeyed, ...Array.from(byId.values())]
    .sort((a, b) => (a.claimNumber - b.claimNumber) || String(a.elementId).localeCompare(String(b.elementId)))

  return {
    schemaVersion: 2,
    claimNumbers: Array.from(new Set([...(prev.claimNumbers || []), ...incoming.claimNumbers])).sort((a, b) => a - b),
    rows
  }
}

interface ChartSliceRow {
  claimNumber: number
  elementId?: string
  feature: string
  cell?: any
}

interface ChartSlice {
  schemaVersion: 2
  claimNumbers: number[]
  rows: ChartSliceRow[]
}

/**
 * Persist the chart onto the citations it covers, MERGING rather than replacing.
 *
 * The pipeline calls this once per objection, each time with only that
 * objection's claims. A wholesale write meant objection 2's chart (claims 5–7)
 * erased objection 1's (claims 1–3) for the same cited document — evidence the
 * attorney had paid for, gone from their view with no trace.
 *
 * The write is guarded on `updatedAt` and retried, rather than assuming the
 * pipeline is the only writer: a redraft running alongside a prepare, or a lease
 * handover between workers, both break that assumption.
 */
export async function persistClaimChart(documentId: string, chart: ClaimChart): Promise<void> {
  for (const label of chart.citationLabels) {
    const incoming: ChartSlice = {
      schemaVersion: 2,
      claimNumbers: chart.claimNumbers,
      rows: chart.rows.map(r => ({
        claimNumber: r.claimNumber,
        elementId: r.elementId,
        feature: r.feature,
        cell: r.cells.find(c => c.citationLabel === label)
      }))
    }

    const targets = await prisma.oaCitation.findMany({ where: { documentId, label }, select: { id: true } })
    for (const { id } of targets) {
      let written = false
      for (let attempt = 0; attempt < 3 && !written; attempt++) {
        const current = await prisma.oaCitation.findUnique({
          where: { id }, select: { claimChartJson: true, updatedAt: true }
        })
        if (!current) { written = true; break }
        const merged = mergeClaimChartSlices(normalizeLegacyClaimChart(current.claimChartJson), incoming)
        const result = await prisma.oaCitation.updateMany({
          where: { id, updatedAt: current.updatedAt },
          data: { claimChartJson: merged as any }
        })
        written = result.count === 1
      }
      if (!written) throw new ClaimChartConcurrencyError(id)
    }
  }
}
