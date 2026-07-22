import type { OfficeActionProfile } from './oa-profile-schema'
import { runOaStage, type OaGateway } from './oa-llm-service'

/**
 * Office Action Studio — intake parser
 *
 * Two responsibilities, both jurisdiction-driven by the profile:
 *  1. Detect the instrument type from the document text using the profile's
 *     detectionHints (deterministic, no LLM).
 *  2. Extract structured metadata + verbatim objections + cited documents via
 *     the OA_INTAKE_PARSE LLM stage.
 */

/**
 * Normalize extracted FER/OA text before parsing and quote-verification.
 *
 * pdftotext injects page furniture that breaks sentences and defeats exact
 * quote matching: repeated running headers ("THE PATENT OFFICE"), footers
 * ("Page 2 of 6"), and — at every page boundary — a DUPLICATE of the last line
 * before the break repeated after it. Removing these reconnects the prose so
 * the model's verbatim quotes actually substring-match the source.
 */
export function cleanOfficeActionText(raw: string): string {
  const lines = (raw || '').split(/\r?\n/)
  const kept: string[] = []
  const isFurniture = (line: string): boolean => {
    const t = line.trim()
    if (!t) return false
    if (/^page\s+\d+\s+of\s+\d+$/i.test(t)) return true
    if (/^the\s+patent\s+office$/i.test(t)) return true
    if (/^\d+\s*\|\s*p\s*a\s*g\s*e$/i.test(t)) return true
    return false
  }
  for (const line of lines) {
    if (isFurniture(line)) continue
    // Drop an immediate duplicate of the previous non-empty kept line
    // (the page-break repeated-line artifact), ignoring surrounding whitespace.
    const norm = line.replace(/\s+/g, ' ').trim()
    if (norm) {
      const prevNorm = [...kept].reverse().find(l => l.replace(/\s+/g, ' ').trim().length > 0)?.replace(/\s+/g, ' ').trim()
      if (norm.length > 20 && norm === prevNorm) continue
    }
    kept.push(line)
  }
  return kept.join('\n')
}

export interface DetectedInstrument {
  instrumentId: string | null
  label: string | null
  confidence: number  // 0..1 — share of hints matched for the winning instrument
  scores: Record<string, number>
}

/**
 * Match the document text against each instrument's detectionHints.
 * Case-insensitive substring match; the instrument with the most hits wins.
 */
export function detectInstrument(profile: OfficeActionProfile, text: string): DetectedInstrument {
  const haystack = (text || '').toLowerCase()
  const scores: Record<string, number> = {}
  let best: { id: string; label: string; hits: number; total: number } | null = null

  for (const inst of profile.instruments) {
    const hints = inst.detectionHints || []
    if (hints.length === 0) {
      scores[inst.id] = 0
      continue
    }
    const hits = hints.filter(h => haystack.includes(h.toLowerCase())).length
    scores[inst.id] = hits
    if (!best || hits > best.hits) best = { id: inst.id, label: inst.label, hits, total: hints.length }
  }

  if (!best || best.hits === 0) {
    return { instrumentId: null, label: null, confidence: 0, scores }
  }
  return {
    instrumentId: best.id,
    label: best.label,
    confidence: best.total > 0 ? best.hits / best.total : 0,
    scores
  }
}

export interface ParsedCitation {
  label: string                       // "D1"
  docNumber?: string                  // full identifier as printed (patent no. or journal citation)
  kind?: 'PATENT' | 'NPL'
  publicationDate?: string            // ISO, from the citation table
  // The examiner's own claim-chart seed, straight from the PART-II §A table:
  relevantDescription?: string        // "Relevant description (page and paragraph no.) of cited document"
  relevantClaimsOfCited?: string      // "Relevant claims of cited document"
  claimsOfAllegedInvention?: number[] // "Claims of alleged invention" this citation is applied against
}

export interface ParsedObjection {
  number?: string        // office numbering, e.g. "1", "2.a"
  examinerText: string   // VERBATIM text of the objection
  legalBasisMentioned?: string[]  // statutes the examiner cited, if visible
  claimsAffected?: number[]
  citationLabels?: string[]
}

export interface ParsedFer {
  applicationNumber?: string
  dateOfReport?: string     // ISO yyyy-mm-dd — set equal to dateOfDispatch for Indian FERs
  dateOfDispatch?: string   // ISO — the "Date of Dispatch/Email" the deadline runs from
  dateOfFiling?: string
  dateOfPublication?: string
  applicantName?: string
  examinerName?: string
  controllerName?: string
  controllerEmail?: string
  hearingDate?: string
  statedDueDate?: string    // ISO — the office's own "Last date for filing response", for cross-check
  citedDocuments: ParsedCitation[]
  objections: ParsedObjection[]
}

export interface ParseResult {
  instrument: DetectedInstrument
  parsed?: ParsedFer
  triggerDates: Record<string, string>  // extracted trigger fields for the deadline engine
  error?: string
}

/**
 * Full intake: detect instrument, then LLM-extract structured content.
 * The gateway is injectable for testing.
 */
export async function parseOfficeActionDocument(
  profile: OfficeActionProfile,
  text: string,
  opts: { tenantId?: string; userId?: string; requestHeaders?: Record<string, string> } = {},
  gateway?: OaGateway
): Promise<ParseResult> {
  const instrument = detectInstrument(profile, text)

  const extractFields = instrument.instrumentId
    ? profile.instruments.find(i => i.id === instrument.instrumentId)?.extractFields || []
    : []

  const input = [
    `Detected instrument: ${instrument.label || 'UNKNOWN'} (${instrument.instrumentId || 'none'}).`,
    extractFields.length ? `Fields to extract if present: ${extractFields.join(', ')}.` : '',
    'Return JSON of shape { applicationNumber?, dateOfDispatch? (ISO yyyy-mm-dd), dateOfReport? (ISO — same as dateOfDispatch), dateOfFiling? (ISO), dateOfPublication? (ISO), applicantName? (from the PART-metadata block, NOT the "To" agent address), examinerName?, controllerName?, controllerEmail?, hearingDate? (ISO), statedDueDate? (ISO, from "Last date for filing response"), citedDocuments: [{label, docNumber, kind (PATENT|NPL), publicationDate? (ISO), relevantDescription? (the examiner\'s pinpoint), relevantClaimsOfCited?, claimsOfAllegedInvention?: number[]}], objections: [{number?, examinerText (VERBATIM from PART-II section B / PART-III), legalBasisMentioned?: string[], claimsAffected?: number[], citationLabels?: string[]}] }. Take objections from the PART-II section B "Detailed observations" and PART-III "Formal requirements" ONLY — do NOT infer objections from the PART-I summary Yes/No grid (its Yes/No meaning differs per row and is unreliable).',
    '',
    'Document text:',
    '"""',
    text,
    '"""'
  ].filter(Boolean).join('\n')

  const result = await runOaStage<ParsedFer>(
    { stageCode: 'OA_INTAKE_PARSE', profile, input, tenantId: opts.tenantId, userId: opts.userId, requestHeaders: opts.requestHeaders, purpose: 'office_action:parse' },
    gateway
  )

  if (!result.success || !result.data) {
    return { instrument, triggerDates: {}, error: result.error || 'Parse failed' }
  }

  const parsed = normalizeParsed(result.data)
  return { instrument, parsed, triggerDates: buildTriggerDates(parsed) }
}

function normalizeParsed(raw: ParsedFer): ParsedFer {
  return {
    ...raw,
    citedDocuments: Array.isArray(raw.citedDocuments) ? raw.citedDocuments : [],
    objections: Array.isArray(raw.objections) ? raw.objections : []
  }
}

/**
 * Map extracted dates to the trigger field names the profile's deadline rules
 * reference (dateOfReport, hearingDate).
 */
export function buildTriggerDates(parsed: ParsedFer): Record<string, string> {
  const t: Record<string, string> = {}
  // Indian FERs run the clock from the Date of Dispatch; the parser also copies
  // it into dateOfReport, but fall back to dateOfDispatch if only that is set.
  const reportDate = parsed.dateOfReport || parsed.dateOfDispatch
  if (reportDate && isIso(reportDate)) t.dateOfReport = reportDate.slice(0, 10)
  if (parsed.hearingDate && isIso(parsed.hearingDate)) t.hearingDate = parsed.hearingDate.slice(0, 10)
  return t
}

/**
 * Strict ISO yyyy-mm-dd check. `Date.parse` alone is too lax — it accepts
 * "10/13/2025", whose slice(0,10) then crashes the deadline engine's
 * parseIsoDate and fails the whole ingest.
 */
function isIso(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}/.test(v) && !isNaN(Date.parse(v.slice(0, 10)))
}

/** Exported guard for callers persisting parser dates (e.g. issueDate). */
export function safeIsoDate(v: string | undefined | null): string | null {
  if (!v || !isIso(v)) return null
  return v.slice(0, 10)
}
