import type { OfficeActionProfile } from './oa-profile-schema'

/**
 * Office Action Studio — procedural objections
 *
 * Some objections are not argued, they are DONE: file an updated Form 3, attach
 * the annexure, furnish the declaration, obtain the NBA approval. A model can
 * only assert that the act happened, and an asserted compliance that never took
 * place is a misrepresentation to the office over the attorney's signature.
 *
 * So these never reach the LLM. But not reaching the LLM is not enough on its
 * own: the profile's sentences are themselves assertions of a completed act —
 * "An updated Form 3 … is filed along with this reply" — and storing that text
 * before the attorney has done anything means the only thing standing between
 * it and the Controller is a gate. Gates get bypassed.
 *
 * So the sentence DOES NOT EXIST until the act is confirmed. Until then the
 * section carries no body at all; the workspace renders "Compliance
 * confirmation pending" from state. On confirmation the sentence is generated
 * deterministically from the compliance type. An unconfirmed assertion cannot
 * be in a filing artefact because it was never written down.
 */

export interface ComplianceRule {
  /** The exact sentence filed, once the act is confirmed. Never stored before then. */
  filingSentence: string
  /**
   * The sentence claims a document accompanies the reply, so confirming it
   * without attaching one would state something untrue.
   */
  requiresSupportingDocument: boolean
  /** What the attorney must actually do. Workspace only — never filed as prose. */
  actionItems: string[]
}

export interface ProceduralReply {
  /**
   * ALWAYS empty. The filed sentence is generated on confirmation, not drafted
   * ahead of it — see the module note above.
   */
  bodyText: string
  actionItems: string[]
  requiresSupportingDocument: boolean
}

/** Objections the office resolves by a filing rather than by argument. */
export function isProceduralObjection(profile: OfficeActionProfile, canonicalCode: string): boolean {
  const entry = (profile.objections || []).find(o => o.canonical === canonicalCode)
  if (!entry) return false
  return entry.responseType === 'PROCEDURAL' || entry.track === 'FORMAL'
}

const DEFAULT_SENTENCE =
  'The Applicant notes this requirement and confirms compliance. The document(s) required in this regard are filed with this reply.'

/**
 * Does this sentence assert that something accompanies the reply?
 *
 * Derived from the sentence the profile actually uses rather than a new profile
 * field, so it stays correct for every jurisdiction without a profile re-sync —
 * and it cannot drift out of step with the wording it governs.
 *
 * "An updated Form 3 … is filed along with this reply"  → a document is claimed.
 * "…are disclosed in the complete specification"        → a location, not a document.
 * "The Applicant undertakes to obtain NBA approval"     → forward-looking, nothing yet.
 */
export function assertsAccompanyingDocument(sentence: string): boolean {
  const s = (sentence || '').toLowerCase()
  if (/\bundertakes?\b|\bwill be\b|\bbefore the grant\b/.test(s)) return false
  return /\bfiled (along |together )?(with|herewith)\b|\bfiled herewith\b|\baccompan(y|ies|ying)\b|\benclosed\b|\bannexed\b|\bfiled with this reply\b/.test(s)
}

/**
 * The compliance rule for one procedural objection: the sentence that will be
 * filed once confirmed, whether it obliges an attachment, and the attorney's
 * checklist.
 *
 * The profile's `actions` are an INTERNAL checklist — full of conditionals and
 * practice notes ("Note: post-2024 Rules, Form 3 is due once at RQ…"). They
 * must never be poured into the letter: a reply to the Controller reciting a
 * practice note is not a submission, it is a leaked worksheet. They are
 * returned separately, for the workspace, and the filing renderer has no access
 * to them at all.
 */
export function complianceRuleFor(
  profile: OfficeActionProfile,
  canonicalCode: string,
  subTypeId?: string | null
): ComplianceRule {
  const entry = (profile.objections || []).find(o => o.canonical === canonicalCode)
  const subType = subTypeId ? (entry?.subTypes || []).find(s => s.id === subTypeId) : undefined

  // Most specific wording first.
  const filingSentence = (
    subType?.replySentence
    || (entry as any)?.replySentence
    || (profile.response as any)?.phrases?.proceduralCompliance
    || DEFAULT_SENTENCE
  ).replace(/\{actions\}/g, '').replace(/\s{2,}/g, ' ').trim()

  const actionItems = [
    ...((entry?.actions || []).filter(a => a && a.trim())),
    ...(subType?.guidance ? [subType.guidance] : [])
  ]

  return {
    filingSentence,
    requiresSupportingDocument: assertsAccompanyingDocument(filingSentence),
    actionItems
  }
}

/**
 * The reply shell for a procedural objection.
 *
 * Deliberately returns NO body. The section is a placeholder until the attorney
 * confirms the act, at which point `complianceRuleFor().filingSentence` becomes
 * its text.
 */
export function buildProceduralReply(
  profile: OfficeActionProfile,
  objection: { canonicalCode: string; subTypeId?: string; examinerText?: string }
): ProceduralReply {
  const rule = complianceRuleFor(profile, objection.canonicalCode, objection.subTypeId)
  return {
    bodyText: '',
    actionItems: rule.actionItems,
    requiresSupportingDocument: rule.requiresSupportingDocument
  }
}
