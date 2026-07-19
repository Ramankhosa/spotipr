import { prisma } from '../prisma'
import type { OfficeActionProfile } from './oa-profile-schema'
import { runOaStage, type OaGateway } from './oa-llm-service'
import { parseClaimElements, type ClaimElement } from './document-intake'
import { verifyQuote } from './objection-classifier'

/**
 * Office Action Studio — claim chart (OA_CITATION_ANALYSIS)
 *
 * Builds the feature × citation grid that the whole inventive-step / novelty
 * argument rests on: for each claim element, does each cited document disclose
 * it? Every DISCLOSED cell must carry a passage that is an exact substring of
 * the cited document's text — a fabricated "disclosure" is downgraded to
 * AMBIGUOUS rather than trusted.
 */

export type CellVerdict = 'DISCLOSED' | 'NOT_DISCLOSED' | 'AMBIGUOUS'

export interface ChartCell {
  citationLabel: string
  verdict: CellVerdict
  passage?: string        // verbatim from the cited document
  location?: string       // e.g. "Abstract", "col. 4 ln. 12"
  quoteVerified: boolean
}

export interface ChartRow {
  claimNumber: number
  elementIndex: number
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
  title?: string
  abstract?: string
  claims?: string
  description?: string
}

/** Concatenate a citation's text for quote verification. */
function citationCorpus(c: CitationText): string {
  return [c.title, c.abstract, c.claims, c.description].filter(Boolean).join('\n\n')
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
  const elements = allElements.filter(e => input.claimNumbers.length === 0 || input.claimNumbers.includes(e.claimNumber))
  if (!elements.length) return { success: false, error: 'No claim elements parsed' }
  if (!input.citations.length) return { success: true, chart: emptyChart(elements) }

  const promptInput = [
    'Claim elements (rows):',
    JSON.stringify(elements.map((e, i) => ({ row: i, claim: e.claimNumber, feature: e.text }))),
    '',
    'Cited documents (columns) — quote ONLY from these texts:',
    input.citations.map(c => `### ${c.label}\n${truncate(citationCorpus(c), 6000)}`).join('\n\n'),
    '',
    'For every row × document, decide DISCLOSED / NOT_DISCLOSED / AMBIGUOUS. For DISCLOSED you MUST include `passage` copied verbatim from that document plus a short `location`. If you cannot find a verbatim passage, use NOT_DISCLOSED or AMBIGUOUS — never invent one.',
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
  return { success: true, chart }
}

/** Deterministic assembly + quote verification of the model's cells. */
export function assembleChart(
  elements: ClaimElement[],
  labels: string[],
  cells: any[],
  corpusByLabel: Map<string, string>
): ClaimChart {
  const rows: ChartRow[] = elements.map((e, i) => ({
    claimNumber: e.claimNumber, elementIndex: e.elementIndex, feature: e.text,
    cells: labels.map(l => ({ citationLabel: l, verdict: 'AMBIGUOUS' as CellVerdict, quoteVerified: false }))
  }))

  for (const raw of cells) {
    const rowIdx = Number(raw?.row)
    const row = rows[rowIdx]
    if (!row) continue
    const cell = row.cells.find(c => c.citationLabel === raw?.citationLabel)
    if (!cell) continue
    const verdict: CellVerdict = ['DISCLOSED', 'NOT_DISCLOSED', 'AMBIGUOUS'].includes(raw?.verdict) ? raw.verdict : 'AMBIGUOUS'
    const passage = typeof raw?.passage === 'string' ? raw.passage : undefined
    const source = corpusByLabel.get(cell.citationLabel) || ''
    const verified = passage ? verifyQuote(passage, source) : false

    // A DISCLOSED verdict without a verifiable passage is NOT trusted.
    cell.verdict = verdict === 'DISCLOSED' && !verified ? 'AMBIGUOUS' : verdict
    cell.passage = verified ? passage : undefined
    cell.location = verified ? (typeof raw?.location === 'string' ? raw.location : undefined) : undefined
    cell.quoteVerified = verified
  }

  const distinctions = rows
    .filter(r => r.cells.length > 0 && r.cells.every(c => c.verdict === 'NOT_DISCLOSED'))
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
    rows: elements.map(e => ({ claimNumber: e.claimNumber, elementIndex: e.elementIndex, feature: e.text, cells: [] })),
    distinctions: []
  }
}

function truncate(s: string, n: number): string { return s.length > n ? s.slice(0, n) + '…' : s }

/** Persist the chart onto the citations it covers. */
export async function persistClaimChart(documentId: string, chart: ClaimChart): Promise<void> {
  for (const label of chart.citationLabels) {
    const slice = {
      claimNumbers: chart.claimNumbers,
      rows: chart.rows.map(r => ({
        claimNumber: r.claimNumber, feature: r.feature,
        cell: r.cells.find(c => c.citationLabel === label)
      }))
    }
    await prisma.oaCitation.updateMany({
      where: { documentId, label },
      data: { claimChartJson: slice as any }
    })
  }
}
