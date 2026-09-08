// Claim challenge: schemas, prompt builders, and merge rails.
//
// The challenge loop is deliberately two LLM calls with a human gate between
// them. A challenger produces examiner-style objections against the generated
// claim set; the attorney reviews, edits, accepts or dismisses each; only then
// does a refiner amend the claims to resolve what was accepted.
//
// Everything here is pure so the rails that decide whether a merge may be
// persisted are unit-testable, unlike the equivalent inline checks in the
// prior-art claim refinement handler.

import { z } from 'zod'
import type { DraftClaim } from '@/lib/draft-claims-parser'
import type { ChallengeLintFinding } from '@/lib/claim-challenge-lint'
import { CLAIM_CHALLENGE_CHECKLIST } from '@/lib/claim-challenge-lint'
import type { SourceFidelityMode } from '@/lib/source-fidelity'

/** Remarks kept after severity ordering. Caps prompt size for the refine call. */
export const MAX_CHALLENGE_REMARKS = 12

export const CHALLENGE_CATEGORIES = [
  'DEFINITENESS',
  'PICTURE_CLAIM',
  'JARGON',
  'CATEGORY_MIX',
  'SEQUENCE_CONFLATION',
  'ANTECEDENT_BASIS',
  'TERMINOLOGY_DRIFT',
  'UNSUPPORTED_MATTER',
  'CLAIM_FORM',
  'DEPENDENCY',
  'FUNCTIONAL_CLAIMING',
  'OPTIONAL_LANGUAGE',
  'RANGES',
  'CLAIM_SET_STRATEGY',
  'REDUNDANCY',
  'NEGATIVE_LIMITATION',
  // Raised only when art vocabulary references are in play: a reference that
  // appears to read on a claim. Never an amendment; routed to the prior-art
  // stage by the attorney.
  'PRIOR_ART_SIGNAL',
  'USER_FOCUS',
  'OTHER',
] as const

export type ChallengeCategory = (typeof CHALLENGE_CATEGORIES)[number]

/** Lint codes map onto the checklist categories the challenger uses. */
const LINT_CODE_TO_CATEGORY: Record<string, ChallengeCategory> = {
  INDEFINITE_MODIFIER: 'DEFINITENESS',
  SOURCE_JARGON: 'JARGON',
  PICTURE_CLAIM_1: 'PICTURE_CLAIM',
  SEQUENCE_CONFLATION: 'SEQUENCE_CONFLATION',
  FUNCTIONAL_RESULT_STATIC: 'CATEGORY_MIX',
  OPTIONAL_LANGUAGE: 'OPTIONAL_LANGUAGE',
  TRADEMARK: 'DEFINITENESS',
  OMNIBUS_REFERENCE: 'CLAIM_FORM',
  MULTI_SENTENCE: 'CLAIM_FORM',
  AND_OR: 'CLAIM_FORM',
  MEANS_PLUS_FUNCTION: 'FUNCTIONAL_CLAIMING',
  IMPROPER_DEPENDENCY: 'DEPENDENCY',
  MULTIPLE_DEPENDENT_CHAIN: 'DEPENDENCY',
  DUPLICATE_CLAIM: 'REDUNDANCY',
  NEGATIVE_LIMITATION: 'NEGATIVE_LIMITATION',
}

/**
 * Drafting discipline every amendment must keep. Shared wording for the refine
 * prompt so an amendment that cures one objection cannot introduce another the
 * challenger would have raised.
 */
export const CLAIM_AMENDMENT_STANDARDS = `CLAIM DRAFTING STANDARDS FOR EVERY AMENDMENT:
- One sentence per claim, ending in a period: preamble, transition, body.
- Keep each claim's transition; "comprising" stays open-ended and is never replaced with "consisting of" unless an accepted remark requires it.
- A dependent claim must further limit the claim it references and may refer only to an earlier claim; never make a multiple dependent claim depend on another multiple dependent claim.
- Introduce each element once with "a"/"an" and refer back with "the"; keep one canonical term per element across the whole set; keep singular and plural consistent.
- No optional or exemplary language ("optionally", "preferably", "such as", "for example", "may", "can"), no trademarks, no references to the description or drawings, and no "and/or" where "at least one of" is meant.
- Do not introduce "means for"/"step for" or a bare placeholder ("module", "unit") at the point of novelty; recite the structure that performs the function.
- Numeric limitations carry their units; ranges are closed unless the source supports the open end; no range nested inside another range in one claim.
- Negative limitations only where the source supports the exclusion.
- A static claim (apparatus, system, product, composition) recites structure; a result belongs in a method claim or in "configured to" form.`

const ChallengeCategorySchema = z.preprocess(
  value => {
    const text = String(value ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_')
    return (CHALLENGE_CATEGORIES as readonly string[]).includes(text) ? text : 'OTHER'
  },
  z.enum(CHALLENGE_CATEGORIES),
)

const SeveritySchema = z.preprocess(
  value => {
    const text = String(value ?? '').trim().toUpperCase()
    if (text.startsWith('H')) return 'H'
    if (text.startsWith('L')) return 'L'
    return 'M'
  },
  z.enum(['H', 'M', 'L']),
)

/**
 * Longest free-text field kept from the model. Text beyond this is truncated,
 * never rejected: the prompt states no length limit, so one verbose remark must
 * not void a whole run and cost the attorney another LLM call.
 */
export const MAX_CHALLENGE_TEXT_CHARS = 1500

const ClaimNumberListSchema = z.preprocess(
  value => {
    const list = Array.isArray(value) ? value : [value]
    const seen = new Set<number>()
    const numbers: number[] = []
    for (const entry of list) {
      const number = Number(entry)
      if (!Number.isFinite(number) || number <= 0 || !Number.isInteger(number) || seen.has(number)) continue
      seen.add(number)
      numbers.push(number)
    }
    return numbers.slice(0, 40)
  },
  z.array(z.number().int().positive()).min(1),
)

/** Required free text: trimmed and truncated; empty fails the item. */
const RequiredTextSchema = z.preprocess(
  value => String(value ?? '').trim().slice(0, MAX_CHALLENGE_TEXT_CHARS),
  z.string().min(1),
)

/** Optional free text: null, undefined and non-strings all become ''. */
const OptionalTextSchema = z.preprocess(
  value => (value === null || value === undefined ? '' : String(value).trim().slice(0, MAX_CHALLENGE_TEXT_CHARS)),
  z.string(),
)

const NullableTextSchema = z.preprocess(
  value => {
    if (value === null || value === undefined) return null
    const text = String(value).trim()
    return text ? text : null
  },
  z.string().nullable(),
)

const StringListSchema = z.preprocess(
  value => (Array.isArray(value) ? value.map(entry => String(entry).trim()).filter(Boolean).slice(0, 20) : []),
  z.array(z.string()),
)

/**
 * Parses each element on its own and keeps only the ones that validate.
 *
 * Model output is a list of independent items; one malformed item must not
 * take the rest down with it. The array itself is capped by slicing, not by
 * failing, for the same reason.
 */
function lenientArray<T extends z.ZodTypeAny>(item: T, max: number) {
  return z.preprocess(
    value => {
      if (!Array.isArray(value)) return []
      const kept: z.infer<T>[] = []
      for (const entry of value) {
        if (kept.length >= max) break
        const parsed = item.safeParse(entry)
        if (parsed.success) kept.push(parsed.data)
      }
      return kept
    },
    z.array(item),
  )
}

const ChallengeRemarkItemSchema = z.object({
  claims: ClaimNumberListSchema,
  cat: ChallengeCategorySchema,
  sev: SeveritySchema,
  obj: RequiredTextSchema,
  fix: RequiredTextSchema,
  /** Publication numbers of the art vocabulary references a term came from. */
  refs: StringListSchema,
})

export const ChallengeOutputSchema = z.object({
  remarks: lenientArray(ChallengeRemarkItemSchema, 25),
})

const RefinedClaimItemSchema = z.object({
  number: z.coerce.number().int().positive(),
  original_text: OptionalTextSchema,
  refined_text: NullableTextSchema,
  keep_as_is: z.preprocess(value => value === true || String(value).toLowerCase() === 'true', z.boolean()),
  change_reason: OptionalTextSchema,
  remark_refs: StringListSchema,
})

const AddedClaimItemSchema = z.object({
  number: z.coerce.number().int().positive(),
  text: z.preprocess(value => String(value ?? '').trim(), z.string().min(1)),
  type: z.literal('dependent').catch('dependent'),
  dependsOn: z.coerce.number().int().positive(),
  reason: OptionalTextSchema,
  remark_refs: StringListSchema,
})

const UnresolvedItemSchema = z.object({
  id: z.preprocess(value => String(value ?? '').trim(), z.string().min(1)),
  reason: OptionalTextSchema,
})

export const ChallengeRefineOutputSchema = z.object({
  refined_claims: lenientArray(RefinedClaimItemSchema, 200),
  added_claims: lenientArray(AddedClaimItemSchema, 10),
  unresolved: lenientArray(UnresolvedItemSchema, 25),
})

export type ChallengeRemarkSource = 'llm' | 'lint' | 'user'
export type ChallengeRemarkDisposition = 'pending' | 'accepted' | 'dismissed'

export type ChallengeRemark = {
  id: string
  source: ChallengeRemarkSource
  claims: number[]
  cat: ChallengeCategory
  sev: 'H' | 'M' | 'L'
  objection: string
  fix: string
  disposition: ChallengeRemarkDisposition
  editedFix?: string
  /** Art vocabulary references the remark cites, by publication number. */
  refs?: string[]
  /** Reference wording found reproduced in the fix; a warning for the attorney, set by the handler. */
  verbatimReuse?: Array<{ publicationNumber: string; snippet: string }>
}

const SEVERITY_RANK: Record<'H' | 'M' | 'L', number> = { H: 0, M: 1, L: 2 }

/**
 * Merges challenger output with deterministic lint findings into one remark list.
 *
 * The lint pass and the model frequently spot the same defect. Where they do,
 * the model's remark wins: it carries a drafted amendment instruction, whereas
 * the lint finding only names the problem.
 */
export function expandChallengeRemarks(
  parsed: z.infer<typeof ChallengeOutputSchema>,
  lintFindings: ChallengeLintFinding[] = [],
  validClaimNumbers?: number[] | null,
  /** Publication numbers of the references the prompt carried; citations are kept only for these. */
  referenceIds?: string[] | null,
): ChallengeRemark[] {
  const citable = Array.isArray(referenceIds) && referenceIds.length > 0 ? referenceIds : null
  // A remark against a claim number that is not in the set cannot be acted on
  // and would send the refiner after text that does not exist.
  const valid = Array.isArray(validClaimNumbers) && validClaimNumbers.length > 0
    ? new Set(validClaimNumbers.map(number => Number(number)))
    : null
  const usable = (parsed.remarks || [])
    .map(remark => ({
      ...remark,
      claims: valid ? remark.claims.filter(number => valid.has(Number(number))) : remark.claims,
    }))
    .filter(remark => remark.claims.length > 0)

  const llmRemarks: ChallengeRemark[] = [...usable]
    .sort((a, b) => SEVERITY_RANK[a.sev] - SEVERITY_RANK[b.sev])
    .slice(0, MAX_CHALLENGE_REMARKS)
    .map((remark, index) => ({
      id: `R${index + 1}`,
      source: 'llm' as const,
      claims: remark.claims,
      cat: remark.cat,
      sev: remark.sev,
      objection: remark.obj,
      fix: remark.fix,
      disposition: 'pending' as const,
      ...(citable ? { refs: filterRemarkRefs(remark.refs, citable) } : {}),
    }))

  const covered = new Set(
    llmRemarks.flatMap(remark => remark.claims.map(claimNumber => `${remark.cat}:${claimNumber}`)),
  )

  const lintRemarks: ChallengeRemark[] = []
  for (const finding of lintFindings) {
    const cat = LINT_CODE_TO_CATEGORY[finding.code] || 'OTHER'
    const key = `${cat}:${finding.claimNumber}`
    if (covered.has(key)) continue
    covered.add(key)
    lintRemarks.push({
      id: `L${lintRemarks.length + 1}`,
      source: 'lint',
      claims: [finding.claimNumber],
      cat,
      sev: 'M',
      objection: finding.message,
      fix: `Amend claim ${finding.claimNumber} to remove this defect, using only limitations supported by the source context. Excerpt: "${finding.excerpt}"`,
      disposition: 'pending',
    })
  }

  return [...llmRemarks, ...lintRemarks]
}

/**
 * Publication number reduced to what identifies the document: uppercase,
 * separators removed, and a trailing kind code dropped, so "EP 1234567 B1",
 * "EP1234567B1" and "EP1234567" all compare equal.
 */
export function canonicalPublicationKey(value: unknown): string {
  const compact = String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!compact) return ''
  return compact.replace(/(?<=\d)[A-Z]\d?$/, '')
}

/**
 * Keeps only the citations that name a reference the prompt actually carried,
 * spelled the way the reference list spells them. A model that cites a
 * publication it was never shown gets no chip, not a fabricated provenance.
 */
export function filterRemarkRefs(refs: unknown, referenceIds: readonly string[]): string[] {
  const byKey = new Map<string, string>()
  for (const id of referenceIds) {
    const key = canonicalPublicationKey(id)
    if (key && !byKey.has(key)) byKey.set(key, id)
  }
  const kept: string[] = []
  for (const raw of Array.isArray(refs) ? refs : []) {
    const match = byKey.get(canonicalPublicationKey(raw))
    if (match && !kept.includes(match)) kept.push(match)
  }
  return kept
}

/** Next free user-remark id, so ids stay unique across repeated additions. */
export function nextUserRemarkId(remarks: ChallengeRemark[]): string {
  let max = 0
  for (const remark of remarks) {
    const match = /^U(\d+)$/.exec(remark.id || '')
    if (match) max = Math.max(max, Number(match[1]))
  }
  return `U${max + 1}`
}

function formatClaimLines(claims: DraftClaim[]): string {
  return claims
    .map(claim => `${claim.number}. ${claim.text} [${claim.type || (claim as any).category || 'claim'}]`)
    .join('\n')
}

function fidelityNote(mode: SourceFidelityMode): string {
  if (mode === 'PRESERVE') {
    return `SOURCE FIDELITY NOTE (PRESERVE MODE)
The inventor asked to keep their idea exactly as provided, so their terminology is currently canonical in these claims. Do flag internal labels and coined names, but frame every such fix as: translate to the art-recognised term in the independent claim AND retain the inventor's exact term in a dependent claim. Never propose adding, dropping, or altering a technical fact.`
  }
  return `SOURCE FIDELITY NOTE (STRUCTURE_ONLY MODE)
Claim wording may be restructured freely, but no technical fact may be added, dropped, or altered. Every proposed amendment must be supported by the source context above.`
}

export type BuildChallengePromptParams = {
  ideaBasics: { title?: string; problem?: string; objectives?: string; abstract?: string }
  componentList: string
  sourceFactLedgerBlock: string
  claims: DraftClaim[]
  lintFindings: ChallengeLintFinding[]
  focusText?: string
  sourceFidelityMode: SourceFidelityMode
  /** Office whose claim practice governs, e.g. "US", "EP", "IN". */
  jurisdiction?: string
  /**
   * Rendered ART VOCABULARY REFERENCE block (see claim-challenge-references).
   * Empty or absent leaves the prompt byte-identical to a run without it.
   */
  artVocabularyBlock?: string
}

function jurisdictionBlock(jurisdiction?: string): string {
  const code = String(jurisdiction || '').trim().toUpperCase()
  if (!code) return ''
  return `JURISDICTION: ${code}
Apply this office's claim practice. Where practice differs between offices (multiple dependent claims depending on multiple dependent claims, omnibus claims, means-plus-function treatment, two-part form, reference numerals in parentheses, unity of invention), apply the rule of this jurisdiction and name it in the objection.`
}

/**
 * The challenger prompt.
 *
 * No persona or writing-sample block is injected: the challenger is an
 * adversary, not the drafter's voice, and house style has no bearing on whether
 * an objection is well founded.
 */
export function buildClaimChallengePrompt(params: BuildChallengePromptParams): string {
  const { ideaBasics, componentList, sourceFactLedgerBlock, claims, lintFindings, focusText, sourceFidelityMode, jurisdiction } = params
  const artVocabularyBlock = String(params.artVocabularyBlock || '').trim()

  const lintBlock = lintFindings.length
    ? `AUTOMATED SCREENING RESULTS (verify each against the claim text; confirm, sharpen, or discard it — do not merely repeat it):
${lintFindings.map(finding => `- [${finding.code}] Claim ${finding.claimNumber}: ${finding.message}`).join('\n')}`
    : ''

  const focusBlock = String(focusText || '').trim()
    ? `USER FOCUS (the attorney asked you to concentrate here; raise remarks for it even if it falls outside the checklist, using category USER_FOCUS):
${String(focusText).trim()}`
    : ''

  return `You are a seasoned patent examiner and opposing counsel conducting a hostile pre-filing review of the claim set below. Your job is to find every defect an examiner or a petitioner could raise against these claims. Be specific, cite claim numbers, and write each objection so that a drafter could act on it without asking you a follow-up question.

INVENTION BASICS:
${ideaBasics.title ? `- Title: ${ideaBasics.title}` : ''}
${ideaBasics.problem ? `- Problem: ${ideaBasics.problem}` : ''}
${ideaBasics.objectives ? `- Objectives: ${ideaBasics.objectives}` : ''}
${ideaBasics.abstract ? `- Abstract: ${ideaBasics.abstract}` : ''}
${componentList ? `- Key components:\n${componentList}` : ''}
${sourceFactLedgerBlock ? `\n${sourceFactLedgerBlock}` : ''}

CLAIMS UNDER CHALLENGE:
${formatClaimLines(claims)}

${fidelityNote(sourceFidelityMode)}

${jurisdictionBlock(jurisdiction)}

${CLAIM_CHALLENGE_CHECKLIST}
${artVocabularyBlock ? `\n${artVocabularyBlock}\n` : ''}
${lintBlock}

${focusBlock}

Rules for your output:
- Raise at most ${MAX_CHALLENGE_REMARKS} remarks. Order them with the most serious first.
- Every remark must name the claim numbers it applies to.
- "obj" states the objection in examiner voice and explains the legal consequence.
- "fix" is a self-contained amendment instruction naming the exact text to change and what to change it to. It must be actionable without re-reading your objection.
- Never propose an amendment that would introduce matter absent from the source context above.
- Do not raise a remark you cannot substantiate from the claim text itself.${artVocabularyBlock ? '\n- "refs": the publication numbers from the ART VOCABULARY REFERENCE that a proposed term or claim-structure observation came from; [] otherwise.' : ''}

Return ONLY valid JSON:
{"remarks":[{"claims":[1],"cat":"DEFINITENESS","sev":"H","obj":"...","fix":"..."${artVocabularyBlock ? ',"refs":[]' : ''}}]}`
}

/** Renders the accepted remarks the refiner must resolve. */
export function buildAcceptedRemarksBlock(remarks: ChallengeRemark[]): string {
  if (!remarks.length) return ''
  const lines = remarks.map(remark => {
    const instruction = String(remark.editedFix || '').trim() || remark.fix
    // The citation travels; the reference text does not. The refiner sees the
    // required term in the amendment above and nothing of the cited claims.
    const termSource = remark.refs?.length
      ? `\nTERM SOURCE: ${remark.refs.join(', ')} (vocabulary references cited by the challenger; the required term is stated above and no reference text is provided).`
      : ''
    return `[${remark.id}] severity=${remark.sev} category=${remark.cat} claims=${remark.claims.join(',')}
OBJECTION: ${remark.objection}
REQUIRED AMENDMENT: ${instruction}${termSource}`
  })
  return `EXAMINER REMARKS TO RESOLVE (accepted by the attorney; resolve each one, or report it under "unresolved" with a reason):
${lines.join('\n\n')}`
}

export type BuildChallengeRefinePromptParams = {
  ideaBasics: { title?: string; problem?: string; objectives?: string; abstract?: string }
  componentList: string
  sourceFactLedgerBlock: string
  claims: DraftClaim[]
  acceptedRemarks: ChallengeRemark[]
  fidelityBlock: string
  terminologyTranslationBlock: string
  nextClaimNumber: number
}

/**
 * The refine prompt: per-claim surgical amendment, not regeneration.
 *
 * Regenerating the set through the claim-generation builder would renumber and
 * restructure it, which destroys the diff alignment the review UI depends on and
 * defeats the rail that refuses a merge dropping claims.
 */
export function buildChallengeRefinePrompt(params: BuildChallengeRefinePromptParams): string {
  const {
    ideaBasics,
    componentList,
    sourceFactLedgerBlock,
    claims,
    acceptedRemarks,
    fidelityBlock,
    terminologyTranslationBlock,
    nextClaimNumber,
  } = params

  return `You are an expert patent attorney amending claims to resolve examiner-style objections while preserving the broadest defensible scope. Amend ONLY what a remark requires.

INVENTION BASICS:
${ideaBasics.title ? `- Title: ${ideaBasics.title}` : ''}
${ideaBasics.problem ? `- Problem: ${ideaBasics.problem}` : ''}
${ideaBasics.objectives ? `- Objectives: ${ideaBasics.objectives}` : ''}
${ideaBasics.abstract ? `- Abstract: ${ideaBasics.abstract}` : ''}
${componentList ? `- Key components:\n${componentList}` : ''}
${sourceFactLedgerBlock ? `\n${sourceFactLedgerBlock}` : ''}

CURRENT CLAIMS:
${formatClaimLines(claims)}
${fidelityBlock ? `\n${fidelityBlock}\n` : ''}${terminologyTranslationBlock ? `\n${terminologyTranslationBlock}\n` : ''}
${buildAcceptedRemarksBlock(acceptedRemarks)}

Guidelines:
- For each existing claim: keep_as_is unless an accepted remark touches it. When it does, make the smallest edit that resolves the remark.
- Never add, drop, or alter a technical fact. Any narrowing must use limitations already present in the source context above.
- Resolving a PICTURE_CLAIM or JARGON remark may require a NEW dependent claim, because species detail moved out of Claim 1 and the inventor's own term must be retained somewhere. Emit those under "added_claims", numbered sequentially from ${nextClaimNumber}, type "dependent", each with a dependsOn referring to an existing claim.
- Maintain the existing numbering of current claims. Never renumber or delete a claim.
- Maintain antecedent basis after every edit: any element you introduce must be introduced with "a"/"an" before it is later referenced with "the".
- Keep one canonical term per element across the whole set after your edits.
- Cite the remark ids you resolved in remark_refs for each claim you touch.
- If a remark cannot be resolved without unsupported matter, leave the claim unchanged and report the remark under "unresolved" with a reason.

${CLAIM_AMENDMENT_STANDARDS}

Return ONLY valid JSON:
{
  "refined_claims": [
    {"number": 1, "original_text": "...", "refined_text": "revised text or null if unchanged", "keep_as_is": false, "change_reason": "...", "remark_refs": ["R1"]}
  ],
  "added_claims": [
    {"number": ${nextClaimNumber}, "text": "...", "type": "dependent", "dependsOn": 1, "reason": "...", "remark_refs": ["R2"]}
  ],
  "unresolved": [
    {"id": "R3", "reason": "..."}
  ]
}`
}

export type ChallengeRefinedClaim = z.infer<typeof ChallengeRefineOutputSchema>['refined_claims'][number]
export type ChallengeAddedClaim = z.infer<typeof ChallengeRefineOutputSchema>['added_claims'][number]

/**
 * Strips a leading claim-number prefix from amended claim text.
 *
 * The claim set is stored as {number, text} and the number is re-applied when
 * the set is rendered, so a model that echoes "2. The composition of..." back
 * produces "2. 2. The composition of..." on screen. Only a prefix matching the
 * claim's own number is removed, so a claim that legitimately opens by citing a
 * different claim is left alone.
 */
function stripClaimNumberPrefix(text: string, claimNumber: number): string {
  const trimmed = String(text || '').trim()
  // The prefix may also be the whole string ("2."), which must strip to nothing
  // so the caller treats it as no change instead of storing "2." as the claim.
  const match = /^(\d+)\s*[.)](?:\s+|$)/.exec(trimmed)
  if (!match || Number(match[1]) !== Number(claimNumber)) return trimmed
  return trimmed.slice(match[0].length).trim()
}

export type MergeChallengeParams = {
  baseStructured: DraftClaim[]
  refinedClaims: ChallengeRefinedClaim[]
  addedClaims?: ChallengeAddedClaim[]
  acceptedClaimNumbers?: number[] | null
  acceptAll?: boolean
  acceptedAddedClaimNumbers?: number[] | null
}

export type MergeChallengeResult =
  | { ok: true; merged: DraftClaim[]; changedClaimNumbers: number[]; addedClaimNumbers: number[] }
  | { ok: false; code: string; error: string }

/**
 * Applies accepted amendments to the claim set.
 *
 * The rails mirror the prior-art refinement apply path: a merge that empties the
 * set, blanks a claim, drops one, or changes nothing is refused outright rather
 * than persisted, because each of those means the model output was unusable
 * rather than that the attorney asked for fewer claims. The base map preserves
 * length by construction, so the dropped-claims check is a guard against future
 * edits to this function rather than a reachable branch today.
 */
export function mergeChallengeRefinedClaims(params: MergeChallengeParams): MergeChallengeResult {
  const {
    baseStructured,
    refinedClaims,
    addedClaims = [],
    acceptedClaimNumbers,
    acceptAll: requestedAcceptAll,
    acceptedAddedClaimNumbers,
  } = params

  const base = Array.isArray(baseStructured) ? baseStructured : []
  if (!Array.isArray(refinedClaims) || refinedClaims.length === 0) {
    return {
      ok: false,
      code: 'EMPTY_CHALLENGE_REFINEMENT_PREVIEW',
      error: 'The stored amendment preview is empty. Run the challenge again before applying.',
    }
  }

  const acceptAll = requestedAcceptAll === true || !Array.isArray(acceptedClaimNumbers)
  const acceptedSet = new Set(
    Array.isArray(acceptedClaimNumbers) ? acceptedClaimNumbers.map(value => Number(value)) : [],
  )

  const changedClaimNumbers: number[] = []
  const merged: DraftClaim[] = base.map(claim => {
    const match = refinedClaims.find(entry => Number(entry.number) === Number(claim.number))
    const accepted = acceptAll || acceptedSet.has(Number(claim.number))
    if (match && accepted && match.refined_text) {
      const text = stripClaimNumberPrefix(match.refined_text, Number(claim.number))
      // A prefix-only "amendment" leaves nothing behind; treat it as no change
      // rather than blanking the claim.
      if (text) {
        changedClaimNumbers.push(Number(claim.number))
        return { ...claim, text }
      }
    }
    return { ...claim }
  })

  if (merged.length === 0) {
    return {
      ok: false,
      code: 'CHALLENGE_WOULD_EMPTY_CLAIMS',
      error: 'Applying these amendments would leave no claims. Nothing was changed.',
    }
  }

  const blank = merged.filter(claim => !String(claim?.text || '').trim())
  if (blank.length > 0) {
    return {
      ok: false,
      code: 'CHALLENGE_EMPTY_CLAIM_TEXT',
      error: `The amendments produced ${blank.length} claim(s) with no text (claim ${blank.map(claim => claim.number).join(', ')}). Nothing was changed.`,
    }
  }

  if (base.length > 0 && merged.length < base.length) {
    return {
      ok: false,
      code: 'CHALLENGE_DROPPED_CLAIMS',
      error: 'Applying these amendments would drop claims from the set. Nothing was changed.',
    }
  }

  // Added claims: only those the attorney ticked, validated before they can join
  // the set. An added claim is the mechanism that keeps the inventor's own term
  // in the claim set after a translation, so a malformed one must not slip in.
  const acceptedAddedSet = new Set(
    Array.isArray(acceptedAddedClaimNumbers) ? acceptedAddedClaimNumbers.map(value => Number(value)) : [],
  )
  const wantedAdditions = (Array.isArray(addedClaims) ? addedClaims : []).filter(claim =>
    Array.isArray(acceptedAddedClaimNumbers) ? acceptedAddedSet.has(Number(claim.number)) : true,
  )

  const addedClaimNumbers: number[] = []
  if (wantedAdditions.length > 0) {
    const existingNumbers = new Set(merged.map(claim => Number(claim.number)))
    let expected = merged.reduce((max, claim) => Math.max(max, Number(claim.number) || 0), 0) + 1

    const sorted = [...wantedAdditions].sort((a, b) => Number(a.number) - Number(b.number))
    for (const addition of sorted) {
      const number = Number(addition.number)
      const dependsOn = Number(addition.dependsOn)
      const addedText = stripClaimNumberPrefix(String(addition.text || ''), number)
      if (!addedText) {
        return {
          ok: false,
          code: 'CHALLENGE_ADDED_CLAIM_INVALID',
          error: `Proposed new claim ${number} has no text. Nothing was changed.`,
        }
      }
      if (existingNumbers.has(number)) {
        return {
          ok: false,
          code: 'CHALLENGE_ADDED_CLAIM_INVALID',
          error: `Proposed new claim ${number} collides with an existing claim number. Nothing was changed.`,
        }
      }
      if (number !== expected) {
        return {
          ok: false,
          code: 'CHALLENGE_ADDED_CLAIM_INVALID',
          error: `Proposed new claim ${number} does not continue the claim numbering (expected ${expected}). Nothing was changed.`,
        }
      }
      if (!Number.isFinite(dependsOn) || dependsOn <= 0 || dependsOn >= number || !existingNumbers.has(dependsOn)) {
        return {
          ok: false,
          code: 'CHALLENGE_ADDED_CLAIM_INVALID',
          error: `Proposed new claim ${number} depends on claim ${addition.dependsOn}, which is not an earlier claim in the set. Nothing was changed.`,
        }
      }

      merged.push({
        number,
        type: 'dependent',
        dependsOn,
        text: addedText,
      })
      existingNumbers.add(number)
      addedClaimNumbers.push(number)
      expected += 1
    }
  }

  // An apply that changes nothing must not be recorded as a resolved challenge:
  // it would mark the review APPLIED, discard the preview, and bump the save
  // timestamp while leaving every objection exactly where it was.
  if (changedClaimNumbers.length === 0 && addedClaimNumbers.length === 0) {
    return {
      ok: false,
      code: 'CHALLENGE_NOTHING_ACCEPTED',
      error: 'No amendment was accepted, so there is nothing to apply. Accept at least one change, or go back to the objections.',
    }
  }

  return { ok: true, merged, changedClaimNumbers, addedClaimNumbers }
}

/** Human-readable provenance for what the challenge changed. */
export function buildChallengeChangeNotes(
  refinedClaims: ChallengeRefinedClaim[],
  changedClaimNumbers: number[],
  addedClaims: ChallengeAddedClaim[] = [],
  addedClaimNumbers: number[] = [],
): string {
  const lines: string[] = []
  for (const number of changedClaimNumbers) {
    const entry = refinedClaims.find(claim => Number(claim.number) === Number(number))
    if (!entry) continue
    const refs = entry.remark_refs?.length ? ` [remarks: ${entry.remark_refs.join(', ')}]` : ''
    lines.push(`Claim ${number}: ${entry.change_reason || 'amended'}${refs}`)
  }
  for (const number of addedClaimNumbers) {
    const entry = addedClaims.find(claim => Number(claim.number) === Number(number))
    if (!entry) continue
    const refs = entry.remark_refs?.length ? ` [remarks: ${entry.remark_refs.join(', ')}]` : ''
    lines.push(`Claim ${number} (new): ${entry.reason || 'added dependent claim'}${refs}`)
  }
  return lines.join('\n')
}
