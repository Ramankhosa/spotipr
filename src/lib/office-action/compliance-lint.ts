import type { AssembledReply, DraftedObjectionReply, AmendedClaim } from './reply-assembly'
import {
  extractCitedParagraphNumbers, formatParagraphRefsForFiling, resolveBasisRefs,
  UNVERIFIED_REF_PLACEHOLDER,
  type Paragraph, type MarkerAnalysis
} from './document-intake'
import type { BasisSourceIdentity, CitationOverride } from './oa-json-schema'
import { isComplianceConfirmed } from './oa-json-schema'
import { complianceRuleFor } from './procedural-reply'
import { findContradictions, type ChartFact } from './contradiction-lint'
import {
  checkQuotations, checkAuthorities, checkQuantitativeClaims, checkStatutoryCitations,
  type EvidenceSource, type ProseFinding
} from './prose-evidence'
import { allProfileAuthorities, profileProvisionKeys } from './objection-doctrine'
import type { OfficeActionProfile } from './oa-profile-schema'

/**
 * Office Action Studio — compliance lint (deterministic, advisory)
 *
 * The last read-through before a reply is filed: coverage, quote fidelity,
 * amendment basis, citation integrity, case identity, prior-art consistency and
 * the forms checklist.
 *
 * It INFORMS; it does not decide. Several findings are things only the attorney
 * can settle — an applicant name that differs for a reason we cannot see, a
 * citation they know is right — and some are settled outside this system
 * entirely, like a Form 3 filed on the office portal. Refusing to produce the
 * document would not resolve any of them; it would leave an attorney holding a
 * deadline and no draft.
 *
 * So export is gated on ACKNOWLEDGEMENT rather than on absence of findings, and
 * `signature` binds that acknowledgement to the exact set they read — accepting
 * once cannot silently carry over to a different set of problems later.
 *
 * `status` still means what it says. A 'fail' is a real defect, not a
 * suggestion; the difference is who decides what to do about it.
 */

export interface LintCheck {
  id: string
  label: string
  status: 'pass' | 'fail' | 'warn'
  detail?: string
}

export interface LintResult {
  /** No blocking findings. NOT a permission to export — see `signature`. */
  pass: boolean
  blocking: number
  warnings: number
  checks: LintCheck[]
  /**
   * Fingerprint of the current findings.
   *
   * The export records the attorney's acknowledgement against this, so an
   * acknowledgement cannot silently carry over to a DIFFERENT set of problems.
   * Accept once, and it covers what you actually read — nothing more.
   */
  signature: string
}

/**
 * Fingerprint the findings that matter — id, status and detail, since the same
 * check can fire for a different reason and must be re-read when it does.
 */
export function lintSignature(checks: LintCheck[]): string {
  const material = checks
    .filter(c => c.status !== 'pass')
    .map(c => `${c.id}:${c.status}:${c.detail || ''}`)
    .sort()
    .join('|')
  if (!material) return 'clean'
  let h = 0x811c9dc5
  for (let i = 0; i < material.length; i++) h = Math.imul(h ^ material.charCodeAt(i), 0x01000193) >>> 0
  return h.toString(16).padStart(8, '0')
}

export interface FormsStatus {
  form3Filed?: boolean        // s.8 / Form 3 resolved
  poaFiled?: boolean          // power of attorney on record
  form4Needed?: boolean       // extension being taken
  form4Filed?: boolean
}

export interface LintInput {
  assembled: AssembledReply
  objectionReplies: DraftedObjectionReply[]
  amendedClaims: AmendedClaim[]
  formsStatus?: FormsStatus
  /** Objection ids the intake marked as confirmed/active (must all be answered). */
  confirmedObjectionIds: string[]
  /** Canonical codes of the confirmed objections — drives conditional forms checks (s.8 → Form 3). */
  confirmedObjectionCodes?: string[]

  // --- citation integrity (required, not optional: an absent optional fails open) ---
  /** As-filed paragraphs — the citation resolution table. */
  specParagraphs: Paragraph[]
  numbering: MarkerAnalysis
  specificationText: string
  citationOverrides?: CitationOverride[]
  basisSource?: BasisSourceIdentity

  // --- case identity ---
  /** parsedJson of the communication being answered. */
  parsed?: { applicationNumber?: string; applicantName?: string; statedDueDate?: string; dateOfReport?: string; title?: string } | null
  caseApplicationNumber?: string
  caseApplicantName?: string
  computedDeadlines?: Array<{ id?: string; dueDate?: string; what?: string }>
  identityOverride?: { field: string; confirmedBy: string; confirmedAt: string; note?: string }

  /** Needed to know which procedural sentences assert an accompanying document. */
  profile?: OfficeActionProfile

  /**
   * Unresolved chart disagreements that an approved objection relies on.
   * Collected by the export route, which knows which citations are cited by
   * which approved objection.
   */
  chartConflicts?: Array<{
    citationLabel: string; claimNumber: number; feature: string
    previousVerdict: string; incomingVerdict: string
  }>

  /** Every charted cell on the case — what the drafted prose is checked against. */
  chartFacts?: ChartFact[]

  /**
   * Documents whose text is on file, so a quotation or a figure in the reply can
   * be checked against them: the cited references (D1, D2…), the specification
   * as filed, the claims, the communication being answered, and any
   * attorney-supplied evidence.
   *
   * Absent, the quotation and quantity checks are skipped rather than guessed —
   * an absent optional must not fail open into a green tick.
   */
  evidenceSources?: EvidenceSource[]
}

// ---------------------------------------------------------------------------
// identity normalisation
// ---------------------------------------------------------------------------

/** Application numbers differ cosmetically across offices and typists. */
function normalizeAppNumber(v: string | undefined | null): string {
  return String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

const ORG_NOISE = /\b(private|pvt|limited|ltd|llp|inc|incorporated|corp|corporation|company|co|gmbh|sa|nv|bv|plc|university|institute|college|trust|society|foundation)\b/g
const ADDRESS_NOISE = /\b(through|its|authoris?ed|agent|attorney|representative|india|punjab|delhi|mumbai|bangalore|chennai|kolkata|hyderabad)\b/g

function normalizeOrgName(v: string | undefined | null): string {
  return String(v || '')
    .toLowerCase().normalize('NFKC')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(ADDRESS_NOISE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function significantTokens(v: string): string[] {
  return normalizeOrgName(v).replace(ORG_NOISE, ' ').split(/\s+/).filter(t => t.length > 2)
}

/**
 * Acronyms are built from the name as written, INCLUDING the organisation-type
 * word — "Lovely Professional University" is LPU, not LP. Dropping "university"
 * as noise before taking initials is what made the abbreviation check miss.
 */
function acronymCandidates(v: string): string[] {
  const all = normalizeOrgName(v).split(/\s+/).filter(Boolean)
  const trimmed = significantTokens(v)
  return Array.from(new Set([
    all.map(t => t[0]).join(''),
    trimmed.map(t => t[0]).join('')
  ].filter(a => a.length >= 2)))
}

/**
 * Applicant-name comparison, tiered.
 *
 * "Lovely Professional University" / "LPU" / "…, Punjab" / "…through its
 * authorised agent" are the same applicant. A strict equality test would block
 * correct cases, so only a genuine conflict — two multi-token organisation
 * names with little overlap and no abbreviation relationship — fails.
 */
export function compareApplicantNames(a: string | undefined, b: string | undefined): 'pass' | 'warn' | 'fail' {
  if (!a || !b) return 'pass'                       // nothing to contradict
  const na = normalizeOrgName(a), nb = normalizeOrgName(b)
  if (!na || !nb) return 'pass'
  if (na === nb) return 'pass'

  const ta = significantTokens(a), tb = significantTokens(b)
  if (!ta.length || !tb.length) return 'pass'
  if (ta.join(' ') === tb.join(' ')) return 'pass'

  // Containment — one is the other plus qualifiers.
  if (na.includes(nb) || nb.includes(na)) return 'warn'

  // Acronym relationship, either direction.
  const shortSide = ta.length === 1 ? { token: ta[0], other: b } : tb.length === 1 ? { token: tb[0], other: a } : null
  if (shortSide && acronymCandidates(shortSide.other).includes(shortSide.token.replace(/\s/g, ''))) return 'warn'

  const setB = new Set(tb)
  const overlap = ta.filter(t => setB.has(t)).length / Math.max(ta.length, tb.length)
  if (overlap >= 0.6) return 'warn'
  return 'fail'
}

// ---------------------------------------------------------------------------

export function lintReply(input: LintInput): LintResult {
  const checks: LintCheck[] = []
  const { objectionReplies, amendedClaims, formsStatus = {} } = input

  // 1. Coverage — every confirmed objection has an approved reply section.
  const repliedIds = new Set(objectionReplies.filter(r => r.approved).map(r => r.objectionId))
  const missing = input.confirmedObjectionIds.filter(id => !repliedIds.has(id))
  checks.push(missing.length === 0
    ? { id: 'coverage', label: 'Every objection answered', status: 'pass', detail: `${repliedIds.size} approved` }
    : { id: 'coverage', label: 'Every objection answered', status: 'fail', detail: `Unanswered/unapproved: ${missing.length} objection(s)` })

  // 1b. Substance — an approved section must actually contain an argument.
  const empty = objectionReplies.filter(r => r.approved && !(r.bodyText || '').trim())
  checks.push(empty.length === 0
    ? { id: 'content', label: 'No empty reply sections', status: 'pass' }
    : { id: 'content', label: 'No empty reply sections', status: 'fail', detail: `${empty.length} approved section(s) have no text — draft or edit them first` })

  // 2. Quote fidelity — every objection reply built on a verified examiner quote.
  const unverified = objectionReplies.filter(r => r.approved && !r.quoteVerified)
  checks.push(unverified.length === 0
    ? { id: 'quotes', label: 'Examiner quotes verified', status: 'pass' }
    : { id: 'quotes', label: 'Examiner quotes verified', status: 'fail', detail: `${unverified.length} reply(ies) cite an unverified quote` })

  // 3. Amendment basis — every amended claim cites spec basis (s.59).
  const noBasis = amendedClaims.filter(c => (c.markedText?.trim()) && (!c.basisRefs || c.basisRefs.length === 0))
  checks.push(noBasis.length === 0
    ? { id: 'basis', label: 'Amendments cite specification basis (s.59)', status: 'pass', detail: amendedClaims.length ? `${amendedClaims.length} amended` : 'no amendments' }
    : { id: 'basis', label: 'Amendments cite specification basis (s.59)', status: 'fail', detail: `${noBasis.length} amendment(s) lack basis` })

  // 3b. Amendments whose basis we located but cannot fully vouch for. These now
  // reach the draft rather than being discarded — an amendment the attorney
  // never saw is worse than one they saw and rejected — so the check is here to
  // make sure they are looked at rather than carried along unnoticed.
  const needsReview = amendedClaims.filter(c => c.basisVerdict === 'risk' || c.basisVerdict === 'fail')
  if (needsReview.length) {
    const detail = needsReview.slice(0, 3)
      .map(c => `claim ${c.claimNumber}: ${c.basisNote || 'basis not established'}`).join(' ')
    checks.push({
      id: 'amendmentBasisReview',
      label: 'Proposed amendments have verified basis',
      status: needsReview.some(c => c.basisVerdict === 'fail') ? 'fail' : 'warn',
      detail: `${needsReview.length} amendment(s) need your judgement before filing. ${detail}`
    })
  }

  // 3c. More than one amendment was proposed for the same claim. Only one can be
  // filed, so the pipeline files the best-supported and keeps the rest — this is
  // what tells the attorney there was a choice, and that it was made for them.
  const contested = amendedClaims.filter(c => (c.alternatives || []).length)
  if (contested.length) {
    checks.push({
      id: 'amendmentAlternatives',
      label: 'Only one amendment per claim goes into the filing',
      status: 'warn',
      detail: `${contested.length} claim(s) had more than one amendment proposed (${contested.map(c => `claim ${c.claimNumber}`).slice(0, 4).join(', ')}). The best-supported version is in this reply; review the alternatives before filing.`
    })
  }

  // 4. Marked/clean consistency — same claim numbers in both copies.
  const markedNums = new Set(amendedClaims.filter(c => c.markedText?.trim()).map(c => c.claimNumber))
  const cleanNums = new Set(amendedClaims.filter(c => c.cleanText?.trim()).map(c => c.claimNumber))
  const consistent = markedNums.size === cleanNums.size && Array.from(markedNums).every(n => cleanNums.has(n))
  checks.push(consistent
    ? { id: 'copies', label: 'Marked and clean claim copies consistent', status: 'pass' }
    : { id: 'copies', label: 'Marked and clean claim copies consistent', status: 'fail', detail: 'Claim numbers differ between marked and clean copies' })

  // 5. FER order preserved.
  const orders = objectionReplies.map(r => r.sortOrder)
  const ordered = orders.every((v, i) => i === 0 || orders[i - 1] <= v)
  checks.push(ordered
    ? { id: 'order', label: 'FER numbering order preserved', status: 'pass' }
    : { id: 'order', label: 'FER numbering order preserved', status: 'warn', detail: 'Objection replies not in FER order — assembly re-sorts, verify' })

  checks.push(...paragraphCitationChecks(input))
  checks.push(...chartConflictChecks(input))
  checks.push(...contradictionChecks(input))
  checks.push(...proseEvidenceChecks(input))
  checks.push(...proceduralChecks(input))
  checks.push(...identityChecks(input))

  // Forms checklist. When the report actually raises a s.8/Form 3 objection,
  // silence is NOT compliance — the attorney must positively confirm it.
  const hasS8Objection = (input.confirmedObjectionCodes || []).includes('PROCEDURAL_DISCLOSURE')
  if (formsStatus.form3Filed === false) {
    checks.push({ id: 'form3', label: 'Form 3 (s.8) resolved', status: 'fail', detail: 'Form 3 objection unresolved — file updated Form 3' })
  } else if (hasS8Objection && formsStatus.form3Filed !== true) {
    checks.push({ id: 'form3', label: 'Form 3 (s.8) resolved', status: 'fail', detail: 'The report raises a Section 8 objection — confirm the updated Form 3 is filed (or being filed with this reply)' })
  } else {
    checks.push({ id: 'form3', label: 'Form 3 (s.8) resolved', status: 'pass' })
  }

  if (formsStatus.poaFiled === false) checks.push({ id: 'poa', label: 'Power of Attorney on record', status: 'warn', detail: 'POA not on record' })
  if (formsStatus.form4Needed && !formsStatus.form4Filed) checks.push({ id: 'form4', label: 'Form 4 extension filed', status: 'warn', detail: 'Extension chosen but Form 4 not yet filed' })

  const blocking = checks.filter(c => c.status === 'fail').length
  const warnings = checks.filter(c => c.status === 'warn').length
  return { pass: blocking === 0, blocking, warnings, checks, signature: lintSignature(checks) }
}

// ---------------------------------------------------------------------------
// Citation integrity
// ---------------------------------------------------------------------------

/** Everything that will actually be exported, as (label, text) pairs. */
function filedTexts(input: LintInput): Array<{ where: string; text: string }> {
  const out: Array<{ where: string; text: string }> = []
  for (const r of input.objectionReplies) {
    if (r.approved && (r.bodyText || '').trim()) out.push({ where: `objection ${r.officeNumber || r.sortOrder + 1}`, text: r.bodyText })
  }
  for (const block of input.assembled.blocks) {
    if (block.type === 'namedSection' && block.body?.trim()) out.push({ where: block.title, text: block.body })
    if (block.type === 'amendments' && block.basisSentence) out.push({ where: 'amendments', text: block.basisSentence })
  }
  return out
}

function paragraphCitationChecks(input: LintInput): LintCheck[] {
  const checks: LintCheck[] = []
  const sources = filedTexts(input)
  const derived = input.numbering.mode === 'DERIVED'
  const citable = new Set(input.specParagraphs.filter(p => p.citable).map(p => p.id.slice(1)))
  // Full anchor ids ("¶0007"), the form the filing renderer checks against.
  const citableSet = new Set(input.specParagraphs.filter(p => p.citable).map(p => p.id))

  const overrides = new Map(
    (input.citationOverrides || [])
      .filter(o => !input.basisSource || o.contentHash === input.basisSource.contentHash)
      .map(o => [o.citationLiteral.replace(/\D/g, '').padStart(4, '0'), o])
  )

  const offenders: string[] = []
  const overridden: string[] = []
  const softened: string[] = []

  for (const src of sources) {
    for (const num of extractCitedParagraphNumbers(src.text)) {
      if (overrides.has(num)) { overridden.push(`[${num}]`); continue }

      if (derived) {
        // Finding the same digits somewhere in the specification is NOT grounds
        // to pass: they could be a sequence identifier, a figure number, a
        // reference-list entry, or text our marker heuristic mis-read. But an
        // attorney who hand-added a citation to a document we under-read must
        // not be permanently unable to file, so that case softens to a warning.
        if (new RegExp(`\\[\\s*${num}\\s*\\]`).test(input.specificationText)) softened.push(`[${num}] (${src.where})`)
        else offenders.push(`[${num}] (${src.where})`)
        continue
      }

      if (!citable.has(num)) offenders.push(`[${num}] (${src.where})`)
    }
  }

  if (offenders.length) {
    checks.push({
      id: 'paragraphCitations',
      label: 'Cited specification paragraphs exist',
      status: 'fail',
      detail: derived
        ? `The specification on file carries no paragraph numbering, so ${offenders.length} citation(s) cannot be verified: ${offenders.slice(0, 5).join(', ')}. Remove them, or point to the section and quote the wording.`
        : `${offenders.length} citation(s) do not resolve in the specification as filed: ${offenders.slice(0, 5).join(', ')}. Valid range ${input.numbering.firstMarker || '—'}–${input.numbering.lastMarker || '—'}.`
    })
  } else if (softened.length) {
    checks.push({
      id: 'paragraphCitations',
      label: 'Cited specification paragraphs exist',
      status: 'warn',
      detail: `The specification carries markers we could not read as a consistent sequence — verify ${softened.slice(0, 5).join(', ')} by hand before filing.`
    })
  } else {
    checks.push({
      id: 'paragraphCitations',
      label: 'Cited specification paragraphs exist',
      status: 'pass',
      detail: overridden.length ? `${overridden.length} citation(s) confirmed by you` : undefined
    })
  }

  /**
   * Anchors the filing renderer will not stand behind.
   *
   * This used to test for `[¶§]\d` AFTER running the preview formatter, which by
   * construction removes every such anchor — so the check could only ever pass
   * and verified nothing. Run the FILING renderer instead and look for the
   * placeholder it substitutes: that is the actual thing the attorney would find
   * mid-sentence in the exported document, and it is falsifiable.
   */
  const unverifiable = sources.filter(s =>
    formatParagraphRefsForFiling(s.text, { numbering: input.numbering.mode, citableIds: citableSet })
      .includes(UNVERIFIED_REF_PLACEHOLDER))
  checks.push(unverifiable.length === 0
    ? { id: 'anchorResidue', label: 'Every paragraph reference resolves in the filed text', status: 'pass' }
    : {
        id: 'anchorResidue', label: 'Every paragraph reference resolves in the filed text', status: 'fail',
        detail: `The exported document will read "${UNVERIFIED_REF_PLACEHOLDER}" in place of ${unverifiable.length} reference(s) we cannot vouch for, in: ${unverifiable.map(r => r.where).slice(0, 5).join(', ')}. Fix or remove them before filing.`
      })

  // Amendment basis must resolve, and must come from the designated as-filed source.
  const allRefs = input.amendedClaims.flatMap(c => c.basisRefs || [])
  if (allRefs.length) {
    const { unresolved } = resolveBasisRefs(allRefs, input.specParagraphs)
    checks.push(unresolved.length === 0
      ? { id: 'basisResolves', label: 'Amendment basis resolves in the as-filed specification', status: 'pass' }
      : { id: 'basisResolves', label: 'Amendment basis resolves in the as-filed specification', status: 'fail', detail: `Unresolved: ${unresolved.slice(0, 5).join(', ')}` })

    checks.push(input.basisSource?.designatedAsFiled
      ? { id: 'basisSource', label: 'Amendment basis drawn from the designated as-filed specification', status: 'pass' }
      : { id: 'basisSource', label: 'Amendment basis drawn from the designated as-filed specification', status: 'fail', detail: 'No specification on this case has been designated as the as-filed document. Designate it before filing amendments — an amended or corrected copy cannot support amendments under Section 59.' })
  }

  return checks
}

/**
 * A reply that argues from a chart the system itself cannot agree with.
 *
 * When two objections chart the same cited document and reach opposite
 * conclusions about the same limitation, one of them is wrong — and the reply
 * is about to assert one of them to the Controller as fact. That is not a
 * warning when the reply depends on it.
 */
function chartConflictChecks(input: LintInput): LintCheck[] {
  const conflicts = input.chartConflicts || []
  if (!conflicts.length) {
    return [{ id: 'chartConflicts', label: 'Prior-art findings are consistent', status: 'pass' }]
  }
  const shown = conflicts.slice(0, 3)
    .map(c => `${c.citationLabel} / claim ${c.claimNumber} "${c.feature}": ${c.previousVerdict} vs ${c.incomingVerdict}`)
  return [{
    id: 'chartConflicts',
    label: 'Prior-art findings are consistent',
    status: 'fail',
    detail: `${conflicts.length} claim feature(s) were charted two different ways against the same document, and this reply argues from them: ${shown.join('; ')}. Resolve which reading is right before filing.`
  }]
}

/**
 * Statements the reply makes about the prior art that its own evidence
 * contradicts.
 *
 * Only a HIGH-confidence mapping blocks — one document, one limitation, matched
 * on a specific technical term. A deterministic matcher cannot reliably resolve
 * a sentence carrying several limitations or several documents, and blocking a
 * correct reply on a guess is its own kind of defect.
 */
function contradictionChecks(input: LintInput): LintCheck[] {
  if (!input.chartFacts?.length) return []
  const found = findContradictions({ sections: filedTexts(input), facts: input.chartFacts })
  if (!found.length) {
    return [{ id: 'contradictions', label: 'Prior-art statements match the evidence', status: 'pass' }]
  }

  const blocking = found.filter(f => f.blocking)
  const advisory = found.filter(f => !f.blocking)
  const checks: LintCheck[] = []

  if (blocking.length) {
    checks.push({
      id: 'contradictions', label: 'Prior-art statements match the evidence', status: 'fail',
      detail: blocking.slice(0, 3).map(f => `${f.where}: ${f.message}`).join(' ')
    })
  } else {
    checks.push({
      id: 'contradictions', label: 'Prior-art statements match the evidence', status: 'warn',
      detail: `${advisory.length} statement(s) could not be matched to the evidence with confidence — read them before filing: ${advisory.slice(0, 2).map(f => f.where).join(', ')}`
    })
  }
  return checks
}

// ---------------------------------------------------------------------------
// Evidence behind the drafted prose
// ---------------------------------------------------------------------------

/** Collapse per-section findings into one check; a single 'fail' makes it fail. */
function rollUp(id: string, label: string, findings: ProseFinding[], passDetail?: string): LintCheck {
  if (!findings.length) return { id, label, status: 'pass', detail: passDetail }
  const failures = findings.filter(f => f.status === 'fail')
  const shown = (failures.length ? failures : findings).slice(0, 3)
  return {
    id, label,
    status: failures.length ? 'fail' : 'warn',
    detail: shown.map(f => `${f.where}: ${f.detail}`).join(' ')
  }
}

/**
 * What the filed prose asserts, against what the case can actually support.
 *
 * Everything else in this lint checks structured artefacts — chart cells,
 * amendment basis, paragraph anchors. These three check the sentences, which is
 * what the Controller reads. Each is a deterministic function over the finished
 * text: none of them can be satisfied by the drafting model asserting that it
 * complied, which is the whole reason they exist. The prompt already says "do
 * not fabricate quotes or authorities"; that is an instruction, not a control.
 */
function proseEvidenceChecks(input: LintInput): LintCheck[] {
  const checks: LintCheck[] = []
  const sources = input.evidenceSources || []
  const sections = filedTexts(input)
  if (!sections.length) return checks

  // Quotations and figures can only be checked against text we hold. With no
  // sources the checks are SKIPPED, not passed — an absent optional must never
  // render as a green tick that verified nothing.
  if (sources.length) {
    checks.push(rollUp(
      'quotations', 'Quoted passages appear in the documents on file',
      checkQuotations(sections, sources),
      'every quotation located'
    ))
    checks.push(rollUp(
      'quantitativeClaims', 'Figures cited in the reply are supported by the record',
      checkQuantitativeClaims(sections, sources)
    ))
  }

  // Authorities and provisions are both checked against the jurisdiction
  // profile, which is always present on the export path.
  if (input.profile) {
    checks.push(rollUp(
      'authorities', 'Authorities cited are those this jurisdiction allows',
      checkAuthorities(sections, allProfileAuthorities(input.profile))
    ))
    checks.push(rollUp(
      'provisions', 'Statutes, rules and forms cited belong to this jurisdiction',
      checkStatutoryCitations(sections, profileProvisionKeys(input.profile))
    ))
  }

  return checks
}

// ---------------------------------------------------------------------------
// Procedural compliance
// ---------------------------------------------------------------------------

function proceduralChecks(input: LintInput): LintCheck[] {
  // Keyed on attorneyAction, deliberately NOT on canonical code. The forms
  // check below keys on PROCEDURAL_DISCLOSURE, but attorneyAction is set for
  // anything the profile marks PROCEDURAL or FORMAL — so a FORMALITIES section
  // asserting compliance would otherwise export unchecked.
  const procedural = input.objectionReplies.filter(r => r.attorneyAction)
  if (!procedural.length) return []

  // Only one question is asked here: has the attorney SETTLED the act?
  //
  // We deliberately do NOT also require a copy of the document. The filing
  // happens at the office, outside this system, so an attachment would prove
  // nothing — and a warning that fires on every procedural confirmation, which
  // nobody can act on, only teaches people to ignore the lint panel.
  //
  // NOT_APPLICABLE is settled too. That section contributes no text at all (the
  // draft route clears its body), so there is no unconfirmed assertion to catch
  // — treating it as one produced a blocking finding with no state that could
  // ever clear it, which the attorney had to acknowledge on every single export.
  const unconfirmed = procedural.filter(r => {
    const status = (r as any)?.compliance?.status
    if (status === 'NOT_APPLICABLE') return false
    return !isComplianceConfirmed(r as any)
  })
  const notApplicable = procedural.filter(r => (r as any)?.compliance?.status === 'NOT_APPLICABLE')

  const settled = procedural.length - unconfirmed.length
  const checks: LintCheck[] = []
  checks.push(unconfirmed.length === 0
    ? {
        id: 'procedural', label: 'Procedural requirements confirmed', status: 'pass',
        detail: notApplicable.length
          ? `${settled} settled (${notApplicable.length} marked not applicable)`
          : `${settled} confirmed`
      }
    : {
        id: 'procedural', label: 'Procedural requirements confirmed', status: 'fail',
        detail: `${unconfirmed.length} section(s) state compliance you have not confirmed. These are acts you perform, not arguments — confirm each one before this reply is filed.`
      })

  return checks
}

// ---------------------------------------------------------------------------
// Case identity
// ---------------------------------------------------------------------------

function identityChecks(input: LintInput): LintCheck[] {
  const checks: LintCheck[] = []
  const parsed = input.parsed
  if (!parsed) return checks

  // Application number — what establishes which matter this reply belongs to.
  // Absolute: no override, because a reply addressed to the wrong application
  // is not a defect the attorney can knowingly accept.
  const fromReport = parsed.applicationNumber
  const onCase = input.caseApplicationNumber
  if (fromReport && onCase) {
    const same = normalizeAppNumber(fromReport) === normalizeAppNumber(onCase)
    checks.push(same
      ? { id: 'appNumber', label: 'Application number matches the report', status: 'pass' }
      : {
          id: 'appNumber', label: 'Application number matches the report', status: 'fail',
          detail: `The report is for "${fromReport}" but this case is recorded as "${onCase}". One of them is wrong — the reply names the case number, so it would be filed against the wrong matter.`
        })
  }

  // Applicant name — tiered, because abbreviations and address qualifiers are
  // normal and a strict test would block correct cases.
  const nameVerdict = compareApplicantNames(parsed.applicantName, input.caseApplicantName)
  if (parsed.applicantName && input.caseApplicantName && nameVerdict !== 'pass') {
    const overridden = input.identityOverride?.field === 'applicantName'
    checks.push({
      id: 'applicantName',
      label: 'Applicant name matches the report',
      status: overridden ? 'pass' : nameVerdict,
      detail: overridden
        ? `Difference confirmed by ${input.identityOverride?.confirmedBy}`
        : `The report names "${parsed.applicantName}"; this case is recorded as "${input.caseApplicantName}".`
    })
  }

  /**
   * The office's own stated deadline against the one the rules compute.
   *
   * Blocking, not advisory. Every deadline on the case is computed from
   * `dateOfReport`, which arrives as unvalidated JSON from the parse stage —
   * it is the only high-consequence value in this module with no deterministic
   * check behind it. The report's own "last date for filing response" is the
   * one independent signal available, and when the two disagree one of them is
   * wrong about a period that ends in deemed abandonment.
   *
   * Blocking here does not prevent the export: it forces the attorney to read
   * the divergence and acknowledge it, which is the only thing that could
   * actually catch a misread date. It was a warn, alongside the advice to "work
   * to the earlier date unless you have confirmed otherwise" — advice nobody
   * has to see.
   */
  const stated = parsed.statedDueDate
  const computedDeadlines = (input.computedDeadlines || []).filter(d => d.dueDate)
  const computed = computedDeadlines[0]?.dueDate
  if (stated && computed && stated.slice(0, 10) !== computed.slice(0, 10)) {
    checks.push({
      id: 'statedDueDate', label: 'Stated and computed response deadlines agree', status: 'fail',
      detail: `The report states ${stated.slice(0, 10)} as the last date for filing; the rules compute ${computed.slice(0, 10)} from the report date on file. One of the two dates is wrong. Confirm the date the report was issued, and work to the earlier deadline.`
    })
  } else if (stated || computed) {
    checks.push({ id: 'statedDueDate', label: 'Stated and computed response deadlines agree', status: 'pass' })
  }

  /**
   * A reply being exported against a communication with no deadline at all.
   *
   * The ingest warns about this, but that warning is a toast at upload time on a
   * matter the attorney may not come back to for months. This is the last
   * moment before filing, and the absence of a tracked statutory period is worth
   * one line here.
   */
  if (!computedDeadlines.length) {
    checks.push({
      id: 'deadlineTracked', label: 'A statutory deadline is tracked for this communication', status: 'warn',
      detail: 'No response deadline was computed for the communication this reply answers, so nothing in this system is tracking the statutory period. Confirm the date it was issued and diarise the deadline yourself.'
    })
  }

  return checks
}
