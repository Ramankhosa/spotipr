import type { AssembledReply, DraftedObjectionReply, AmendedClaim } from './reply-assembly'

/**
 * Office Action Studio — compliance lint (deterministic, blocking)
 *
 * The final gate before export. Every check here is a hard rule that would make
 * a filed reply defective; a FAIL blocks the DOCX export. This is the structural
 * enforcement of the plan's trust guarantees — coverage, quote fidelity,
 * amendment basis, marked/clean consistency, and the forms checklist.
 */

export interface LintCheck {
  id: string
  label: string
  status: 'pass' | 'fail' | 'warn'
  detail?: string
}

export interface LintResult {
  pass: boolean               // false if any 'fail'
  blocking: number
  warnings: number
  checks: LintCheck[]
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
}

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
  // (An LLM failure leaves bodyText empty; that must never export as a
  // finished section under a heading.)
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

  // 4. Marked/clean consistency — same claim numbers in both copies.
  const markedNums = new Set(amendedClaims.filter(c => c.markedText?.trim()).map(c => c.claimNumber))
  const cleanNums = new Set(amendedClaims.filter(c => c.cleanText?.trim()).map(c => c.claimNumber))
  const consistent = markedNums.size === cleanNums.size && Array.from(markedNums).every(n => cleanNums.has(n))
  checks.push(consistent
    ? { id: 'copies', label: 'Marked and clean claim copies consistent', status: 'pass' }
    : { id: 'copies', label: 'Marked and clean claim copies consistent', status: 'fail', detail: 'Claim numbers differ between marked and clean copies' })

  // 5. FER order preserved.
  const orders = objectionReplies.map(r => r.sortOrder)
  const ordered = orders.every((v, i) => i === 0 || orders[i - 1] <= v) ||
    objectionReplies.every((r, i, arr) => i === 0 || arr[i - 1].sortOrder <= r.sortOrder)
  checks.push(ordered
    ? { id: 'order', label: 'FER numbering order preserved', status: 'pass' }
    : { id: 'order', label: 'FER numbering order preserved', status: 'warn', detail: 'Objection replies not in FER order — assembly re-sorts, verify' })

  // 6. Forms checklist. When the report actually raises a s.8/Form 3 objection,
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
  return { pass: blocking === 0, blocking, warnings, checks }
}
