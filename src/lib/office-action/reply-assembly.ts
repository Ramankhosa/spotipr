import type { OfficeActionProfile } from './oa-profile-schema'

/**
 * Office Action Studio — reply assembly (deterministic)
 *
 * Assembles the approved, drafted pieces into a STRUCTURED reply model in the
 * jurisdiction profile's skeleton order. No LLM here — the per-objection
 * arguments and preliminary/prayer text come from the Draft stage; this module
 * orders them, restates each examiner concern, and produces a presentation
 * model that both renderers (DOCX for filing, HTML for preview) consume.
 */

export interface CaseMeta {
  jurisdictionOffice: string
  officeBranch?: string       // e.g. "Kolkata"
  applicationNumber: string
  applicantName?: string
  reportDate?: string         // ISO
  agentName?: string
  agentRegNo?: string
}

export interface DraftedObjectionReply {
  objectionId: string
  sortOrder: number           // extraction order (stable sort key)
  /** The office's own numbering from the report ("1", "2.a") — the letter answers under it. */
  officeNumber?: string
  code: string                // canonical code
  title: string               // e.g. "Lack of inventive step"
  statuteBasis?: string       // e.g. "Section 2(1)(ja)"
  examinerConcern: string     // 1–2 sentence restatement of what the examiner objected
  bodyText: string            // the approved argument (may contain paragraphs)
  /** Set when the drafting LLM call failed — the section needs attorney text. */
  draftError?: string
  /**
   * A procedural requirement (Form 3, annexure, declaration, NBA approval): the
   * body is a fixed undertaking, and the act itself is the attorney's. Rendered
   * highlighted everywhere so it is completed before the reply is filed.
   */
  attorneyAction?: boolean
  /** What the attorney must do. Shown to them; never filed as prose. */
  actionItems?: string[]
  approved: boolean
  quoteVerified: boolean
}

/** The label a reply section answers under — the office's numbering when known. */
export function objectionLabel(r: Pick<DraftedObjectionReply, 'officeNumber' | 'sortOrder'>): string {
  return (r.officeNumber || '').trim() || String(r.sortOrder + 1)
}

/** ISO yyyy-mm-dd → dd/mm/yyyy for the letter (Indian practice). */
export function displayDate(iso?: string): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso || ''
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

export interface AmendedClaim {
  claimNumber: number
  markedText: string          // with <ins>/<del> markup
  cleanText: string
  basisRefs: string[]         // ¶ ids supporting each inserted feature (s.59)
}

/** A block in the assembled reply, in skeleton order. */
export type ReplyBlock =
  | { type: 'addressBlock'; lines: string[] }
  | { type: 'subjectLine'; text: string }
  | { type: 'salutation'; text: string }
  | { type: 'namedSection'; key: string; title: string; body: string }
  | { type: 'objections'; title: string; objections: DraftedObjectionReply[] }
  | { type: 'amendments'; title: string; marked: AmendedClaim[]; clean: AmendedClaim[]; basisRefs: string[] }
  | { type: 'signatureBlock'; lines: string[] }

export interface AssembledReply {
  meta: CaseMeta
  blocks: ReplyBlock[]
  objectionReplies: DraftedObjectionReply[]   // convenience for lint/analytics
  markedClaims: AmendedClaim[]
  cleanClaims: AmendedClaim[]
  hasAmendments: boolean
}

export interface AssembleInput {
  profile: OfficeActionProfile
  meta: CaseMeta
  objectionReplies: DraftedObjectionReply[]
  /** Drafted non-objection sections keyed by skeleton id (preliminarySubmissions, conclusionAndPrayer…). */
  namedSections: Record<string, string>
  amendedClaims: AmendedClaim[]
}

function fill(tpl: string | undefined, vars: Record<string, string>): string {
  if (!tpl) return ''
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '')
}

function titleFor(profile: OfficeActionProfile, key: string, fallback: string): string {
  return profile.response.export?.formatting?.sectionTitles?.[key] || fallback
}

export function assembleReply(input: AssembleInput): AssembledReply {
  const { profile, meta } = input
  const phrases = profile.response.phrases || {}
  const vars = {
    date: displayDate(meta.reportDate), dateOfReport: displayDate(meta.reportDate),
    applicationNumber: meta.applicationNumber || '', applicantName: meta.applicantName || ''
  }

  const ordered = [...input.objectionReplies].sort((a, b) => a.sortOrder - b.sortOrder)
  const marked = input.amendedClaims.filter(c => c.markedText?.trim())
  const clean = input.amendedClaims.filter(c => c.cleanText?.trim())
  const salutation = profile.response.export?.formatting?.salutation

  const blocks: ReplyBlock[] = []
  for (const key of profile.response.skeleton) {
    switch (key) {
      case 'addressBlock':
        blocks.push({ type: 'addressBlock', lines: addressLines(meta) })
        if (salutation) blocks.push({ type: 'salutation', text: salutation })
        break
      case 'subjectLine':
        blocks.push({ type: 'subjectLine', text: `Reply to the First Examination Report${meta.reportDate ? ` dated ${displayDate(meta.reportDate)}` : ''} — Application No. ${meta.applicationNumber}` })
        break
      case 'preliminarySubmissions':
        blocks.push({ type: 'namedSection', key, title: titleFor(profile, key, 'Preliminary Submissions'),
          body: input.namedSections.preliminarySubmissions || fill(phrases.opening, vars) })
        break
      case 'objectionWiseReply':
        blocks.push({ type: 'objections', title: titleFor(profile, key, 'Response to the Objections'), objections: ordered })
        break
      case 'amendedClaimsMarked':
        // Collapse both claim slots into one "Amendments" block on first encounter.
        if (!blocks.some(b => b.type === 'amendments') && (marked.length || clean.length)) {
          blocks.push({ type: 'amendments', title: titleFor(profile, 'amendments', 'Amendments to the Claims'),
            marked, clean, basisRefs: uniq(input.amendedClaims.flatMap(c => c.basisRefs || [])) })
        }
        break
      case 'amendedClaimsClean':
        break // handled with amendedClaimsMarked
      case 'conclusionAndPrayer':
        blocks.push({ type: 'namedSection', key, title: titleFor(profile, key, 'Conclusion and Prayer'),
          body: input.namedSections.conclusionAndPrayer || [fill(phrases.prayer, vars), fill(phrases.hearingRequest, vars)].filter(Boolean).join('\n\n') })
        break
      case 'signatureBlock':
        blocks.push({ type: 'signatureBlock', lines: signatureLines(meta) })
        break
      default:
        if (input.namedSections[key]) blocks.push({ type: 'namedSection', key, title: key, body: input.namedSections[key] })
    }
  }

  return { meta, blocks, objectionReplies: ordered, markedClaims: marked, cleanClaims: clean, hasAmendments: marked.length > 0 }
}

function addressLines(meta: CaseMeta): string[] {
  return [
    'To,',
    'The Controller of Patents,',
    meta.officeBranch ? `${meta.jurisdictionOffice}, ${meta.officeBranch}` : meta.jurisdictionOffice,
    '',
    `Re: Application No. ${meta.applicationNumber}${meta.applicantName ? `, in the name of ${meta.applicantName}` : ''}`
  ]
}

function signatureLines(meta: CaseMeta): string[] {
  return [
    'Respectfully submitted,',
    '',
    meta.agentName || '(Agent for the Applicant)',
    meta.agentRegNo ? `Patent Agent (Reg. No. ${meta.agentRegNo})` : 'Patent Agent',
    'For and on behalf of the Applicant'
  ]
}

function uniq(a: string[]): string[] { return Array.from(new Set(a.filter(Boolean))) }
