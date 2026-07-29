import type { OfficeActionProfile } from './oa-profile-schema'

/**
 * Office Action Studio — procedural objections
 *
 * Some objections are not argued, they are DONE: file an updated Form 3, attach
 * the annexure, furnish the declaration, obtain the NBA approval. A model can
 * only assert that the act happened, and an asserted compliance that never took
 * place is a misrepresentation to the office over the attorney's signature.
 *
 * So these never reach the LLM. The reply carries a fixed undertaking drawn
 * from the jurisdiction profile's own compliance actions, and the section is
 * flagged for the attorney — highlighted in the workspace, the preview and the
 * exported DOCX — so it is confirmed and completed before the reply is filed.
 */

export interface ProceduralReply {
  bodyText: string
  /** What the attorney must actually do, shown highlighted. Never filed as prose. */
  actionItems: string[]
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
 * The fixed reply for a procedural objection.
 *
 * `response.phrases.proceduralCompliance` in the country profile is the filed
 * sentence; {actions} interpolates the profile's own compliance list so the
 * text names what is being furnished rather than promising in the abstract.
 */
export function buildProceduralReply(
  profile: OfficeActionProfile,
  objection: { canonicalCode: string; subTypeId?: string; examinerText?: string }
): ProceduralReply {
  const entry = (profile.objections || []).find(o => o.canonical === objection.canonicalCode)
  const subType = objection.subTypeId
    ? (entry?.subTypes || []).find(s => s.id === objection.subTypeId)
    : undefined

  // Prefer the sub-clause's own actions where the profile scopes them; fall
  // back to the objection type's list.
  const actions = (entry?.actions || []).filter(a => a && a.trim())

  /**
   * The filed sentence is a fixed statement of compliance, most specific first.
   * The profile's `actions` are an internal checklist — full of conditionals and
   * practice notes — and must NEVER be poured into the letter: a reply to the
   * Controller that recites "Note: post-2024 Rules, Form 3 is due once at RQ…"
   * is not a submission, it is a leaked worksheet.
   */
  const bodyText = (
    subType?.replySentence
    || (entry as any)?.replySentence
    || (profile.response as any)?.phrases?.proceduralCompliance
    || DEFAULT_SENTENCE
  ).replace(/\{actions\}/g, '').replace(/\s{2,}/g, ' ').trim()

  // The checklist the attorney works from — the profile's actions, plus the
  // sub-clause guidance when it names something specific (NBA approval, the
  // source and geographical origin, the Form 3 status table).
  const actionItems = [
    ...actions,
    ...(subType?.guidance ? [subType.guidance] : [])
  ]

  return { bodyText, actionItems }
}
