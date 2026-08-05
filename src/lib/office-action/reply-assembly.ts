import type { OfficeActionProfile } from './oa-profile-schema'
import type { ParagraphNumbering, Paragraph, SectionSpan } from './document-intake'
import { resolveBasisRefs, sectionKeyForParagraph } from './document-intake'
import type { ProceduralComplianceState } from './oa-json-schema'

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
  /**
   * How the as-filed specification is numbered. Both renderers read this to
   * decide whether a paragraph anchor may be rendered as a filing citation.
   */
  numbering: ParagraphNumbering
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
   * act is the attorney's, not an argument. The section has no body until they
   * confirm the act — so the filing can never contain a statement of compliance
   * nobody performed, whatever the attorney decides at the export gate.
   */
  attorneyAction?: boolean
  /** What the attorney must do. Shown to them; never filed as prose. */
  actionItems?: string[]
  /** The filed sentence asserts a document accompanies the reply. */
  requiresSupportingDocument?: boolean
  /**
   * Whether the attorney has confirmed the act. Until CONFIRMED there is no
   * bodyText at all — see procedural-reply.
   */
  compliance?: ProceduralComplianceState
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
  /**
   * What the textual-support check established. Carried through rather than
   * used to discard: an amendment the model proposed and the attorney never
   * saw is worse than one they saw and rejected.
   */
  basisVerdict?: 'pass' | 'risk' | 'fail'
  basisNote?: string
}

/** A block in the assembled reply, in skeleton order. */
export type ReplyBlock =
  | { type: 'addressBlock'; lines: string[] }
  | { type: 'subjectLine'; text: string }
  | { type: 'salutation'; text: string }
  | { type: 'namedSection'; key: string; title: string; body: string }
  /**
   * `objections` is what is FILED: approved sections that carry text. Nothing
   * else may reach the letter — an unapproved or failed section is model output
   * the attorney has not read, and the lint scopes every one of its checks to
   * approved text, so filing the rest would put unchecked prose in front of the
   * Controller under their signature.
   *
   * `omitted` is what was left out and why. The preview shows it (clearly marked
   * as not filed) so the gap is visible rather than silent; the DOCX renderer
   * never sees it.
   */
  | {
      type: 'objections'
      title: string
      objections: DraftedObjectionReply[]
      omitted: Array<{ reply: DraftedObjectionReply; reason: 'unapproved' | 'empty' }>
    }
  /**
   * The amended claims, in the body of the letter — marked-up and clean.
   *
   * Deliberately inline rather than annexed: the Controller reads the argument
   * on a claim and sees that claim's amendment immediately, without opening a
   * separate document.
   *
   * `basisSentence` is built deterministically and is the ONLY thing the
   * renderers print for basis. They used to join `basisRefs` straight into the
   * letter, which put a raw internal anchor — "find support … at ¶0004" — into
   * the filed document.
   */
  | { type: 'amendments'; title: string; marked: AmendedClaim[]; clean: AmendedClaim[]; basisRefs: string[]; basisSentence: string }
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
  /** As-filed paragraphs — resolves basis refs so the sentence can name real locations. */
  specParagraphs?: Paragraph[]
  specSections?: SectionSpan[]
}

const SECTION_LABELS: Record<string, string> = {
  field: 'the Field of the Invention',
  background: 'the Background',
  objects: 'the Objects of the Invention',
  summary: 'the Summary of the Invention',
  detailedDescription: 'the Detailed Description',
  briefDescriptionOfDrawings: 'the Brief Description of the Drawings',
  preamble: 'the specification as filed'
}

/**
 * The sentence that states where an amendment finds support.
 *
 * Authored numbering cites the document's own paragraph numbers. Derived
 * numbering has none to cite, so it names sections (and pages, where the source
 * had them) instead — an honest location the attorney can verify, rather than a
 * number that would look right and be wrong.
 */
export function buildBasisSentence(
  amendedClaims: AmendedClaim[],
  numbering: ParagraphNumbering,
  paragraphs?: Paragraph[],
  sections?: SectionSpan[]
): string {
  const refs = uniq(amendedClaims.flatMap(c => c.basisRefs || []))
  if (!refs.length) return ''

  const tail = ', and fall wholly within the scope of the claims as originally filed (Section 59).'

  if (numbering === 'AUTHORED') {
    // Refs arrive as ranges too — retrieval labels a chunk "[¶0038-¶0041]" and
    // the prompt asks the model to cite those tags. Taking only the first digit
    // run understated the support in the filed letter ("at [0038]" for an
    // amendment supported across [0038]–[0041]).
    const cited = refs
      .flatMap(r => {
        const digits = (String(r).match(/\d{1,6}/g) || []).map(d => d.padStart(4, '0'))
        if (!digits.length) return []
        return digits.length === 1 ? [`[${digits[0]}]`] : [`[${digits[0]}]–[${digits[digits.length - 1]}]`]
      })
    if (!cited.length) return ''
    return `The foregoing amendments find support in the specification as filed at ${uniq(cited).join(', ')}${tail}`
  }

  // Derived: name locations, never numbers.
  const where: string[] = []
  if (paragraphs?.length && sections?.length) {
    const { resolved } = resolveBasisRefs(refs, paragraphs)
    const keys = uniq(resolved.map(p => sectionKeyForParagraph(p, paragraphs, sections) || '').filter(Boolean))
    for (const k of keys) where.push(SECTION_LABELS[k] || `the ${k} section`)
    const pages = uniq(resolved.map(p => (p.pageNumber ? String(p.pageNumber) : '')).filter(Boolean))
    if (pages.length) where.push(pages.length === 1 ? `page ${pages[0]}` : `pages ${pages.join(', ')}`)
  }

  const location = where.length ? ` (see ${where.join(' and ')})` : ''
  return `The foregoing amendments find support in the specification as filed${location}${tail}`
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

  // Only approved sections with text are filed. Everything else is recorded as
  // omitted so the preview can show the gap instead of the letter carrying
  // unreviewed prose (or a bare numbered heading with nothing under it).
  const filedObjections: DraftedObjectionReply[] = []
  const omitted: Array<{ reply: DraftedObjectionReply; reason: 'unapproved' | 'empty' }> = []
  for (const r of ordered) {
    if (!(r.bodyText || '').trim()) omitted.push({ reply: r, reason: 'empty' })
    else if (!r.approved) omitted.push({ reply: r, reason: 'unapproved' })
    else filedObjections.push(r)
  }

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
        blocks.push({
          type: 'objections',
          title: titleFor(profile, key, 'Response to the Objections'),
          objections: filedObjections,
          omitted
        })
        break
      case 'amendedClaimsMarked':
        // Both claim slots collapse into one block on first encounter: the
        // marked copy and the clean copy belong under a single heading, in the
        // body of the letter.
        if (!blocks.some(b => b.type === 'amendments') && (marked.length || clean.length)) {
          blocks.push({
            type: 'amendments',
            title: titleFor(profile, 'amendments', 'Amendments to the Claims'),
            marked, clean,
            basisRefs: uniq(input.amendedClaims.flatMap(c => c.basisRefs || [])),
            basisSentence: buildBasisSentence(input.amendedClaims, meta.numbering, input.specParagraphs, input.specSections)
          })
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
