// Claim strategy: the plan a drafter makes before writing a claim set.
//
// Produced by a separate LLM call (DRAFT_CLAIM_STRATEGY) that runs in the
// background once Stage 0 completes, so the claims stage starts with the
// inventive concept, the essential-features partition, the category plan for
// the office and the terminology decisions already made. Pure module: prompt,
// schema, and the two renderings (the full block for the claims prompt, the
// digest for refinement, challenge and repair).

import { z } from 'zod'
import type { DraftClaim } from '@/lib/draft-claims-parser'
import type { ClaimRuleProfile } from './types'

export const CLAIM_STRATEGY_VERSION = 1

export type ClaimStrategyCategory = NonNullable<DraftClaim['category']>

export type ClaimStrategy = {
  version: 1
  jurisdiction: string
  inventiveConcept: string
  problemSolved: string
  closestArt: Array<{ ref: string; teaches: string[]; lacks: string[] }>
  essentialFeatures: string[]
  optionalFeatures: string[]
  categoryPlan: Array<{ category: string; form: string; role: 'primary' | 'mirror'; justification: string }>
  eligibility: { risk: 'none' | 'low' | 'medium' | 'high'; doctrine: string; mitigation: string }
  terminology: Array<{ element: string; claimTerm: string; inventorTerm?: string; retainInDependent: boolean }>
  singleActor: { actor: string; avoidedDividedSteps: string[] }
  numericLadder: Array<{ parameter: string; broad?: string; preferred?: string; example?: string; sourceRef: string }>
  claimForm: 'one_part_pre_search' | 'two_part'
}

const text = z.preprocess(value => (value == null ? '' : String(value).trim()), z.string())
const optionalText = z.preprocess(value => (value == null || String(value).trim() === '' ? undefined : String(value).trim()), z.string().optional())

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

const nonEmptyText = text.pipe(z.string().min(1))

export const ClaimStrategySchema = z.object({
  version: z.literal(1).catch(1),
  jurisdiction: text.catch(''),
  inventiveConcept: text,
  problemSolved: text.catch(''),
  closestArt: lenientArray(z.object({ ref: nonEmptyText, teaches: lenientArray(nonEmptyText, 8), lacks: lenientArray(nonEmptyText, 8) }), 6),
  essentialFeatures: lenientArray(nonEmptyText, 12),
  optionalFeatures: lenientArray(nonEmptyText, 24),
  categoryPlan: lenientArray(z.object({
    category: nonEmptyText,
    form: text.catch(''),
    role: z.enum(['primary', 'mirror']).catch('mirror'),
    justification: text.catch(''),
  }), 6),
  eligibility: z.object({
    risk: z.enum(['none', 'low', 'medium', 'high']).catch('low'),
    doctrine: text.catch(''),
    mitigation: text.catch(''),
  }).catch({ risk: 'low', doctrine: '', mitigation: '' }),
  terminology: lenientArray(z.object({
    element: nonEmptyText,
    claimTerm: nonEmptyText,
    inventorTerm: optionalText,
    retainInDependent: z.boolean().catch(false),
  }), 24),
  singleActor: z.object({ actor: text.catch(''), avoidedDividedSteps: lenientArray(nonEmptyText, 8) }).catch({ actor: '', avoidedDividedSteps: [] }),
  numericLadder: lenientArray(z.object({
    parameter: nonEmptyText,
    broad: optionalText,
    preferred: optionalText,
    example: optionalText,
    sourceRef: text.catch(''),
  }), 12),
  claimForm: z.enum(['one_part_pre_search', 'two_part']).catch('one_part_pre_search'),
})

/** Parses model output; null when the plan is missing its load-bearing parts. */
export function parseClaimStrategy(data: unknown): ClaimStrategy | null {
  const parsed = ClaimStrategySchema.safeParse(data)
  if (!parsed.success) return null
  const strategy = parsed.data as ClaimStrategy
  if (!strategy.inventiveConcept || strategy.essentialFeatures.length === 0) return null
  return strategy
}

export type BuildClaimStrategyPromptParams = {
  rules: ClaimRuleProfile
  rulesBlock: string
  patentTypePrimary: string
  inventionType?: string
  technicalField?: string
  /** The invention context blocks shared with the claims prompt. */
  normalizedContextBlock: string
  originalSourceExcerptBlock: string
  supportDataBlock: string
  sourceFactLedgerBlock: string
  claimScopeBlock: string
  noveltyGuidanceBlock: string
  noveltyFindingsBlock: string
  sourceFidelityBlock: string
  inventorTerminologyBlock: string
  userClaimRemarks?: string
}

export function buildClaimStrategyPrompt(params: BuildClaimStrategyPromptParams): string {
  const {
    rules, rulesBlock, patentTypePrimary, inventionType, technicalField,
    normalizedContextBlock, originalSourceExcerptBlock, supportDataBlock, sourceFactLedgerBlock,
    claimScopeBlock, noveltyGuidanceBlock, noveltyFindingsBlock, sourceFidelityBlock, inventorTerminologyBlock,
    userClaimRemarks,
  } = params

  return `You are a senior patent attorney preparing the CLAIM STRATEGY for a preliminary claim set before any claim is drafted, for the ${rules.office}. You do not draft claims here; you decide what the claim set must be. Return only the JSON object described at the end.

${rulesBlock}

DOMAIN CONTEXT
- Detected patent type (Claim 1 category): ${patentTypePrimary}
- Invention archetype: ${inventionType || 'GENERAL'}
- Technical field: ${technicalField || 'N/A'}

${originalSourceExcerptBlock}

${normalizedContextBlock}
${supportDataBlock ? `\n${supportDataBlock}` : ''}${sourceFactLedgerBlock ? `\n${sourceFactLedgerBlock}` : ''}
${claimScopeBlock ? `\n${claimScopeBlock}` : ''}
${noveltyGuidanceBlock ? `\n${noveltyGuidanceBlock}` : ''}
${noveltyFindingsBlock ? `\n${noveltyFindingsBlock}` : ''}
${sourceFidelityBlock ? `\n${sourceFidelityBlock}` : ''}${inventorTerminologyBlock ? `\n${inventorTerminologyBlock}` : ''}
${userClaimRemarks ? `\nUSER CLAIM REMARKS (scope and emphasis only; never new facts):\n${userClaimRemarks}` : ''}

DECIDE, USING ONLY THE SOURCE CONTEXT ABOVE:
1. inventiveConcept — one sentence: the minimum combination of features that solves the stated technical problem, in technical (not marketing) terms. problemSolved — the technical problem in one sentence.
2. closestArt — when CLOSEST ART is present, for each reference (max 6): what it teaches of this invention and what it lacks. Empty when no assessment exists.
3. essentialFeatures — the elements Claim 1 must recite: apply the essential-features test (remove the element; is the problem still solved by what remains? if yes it is NOT essential). Use the USER-APPROVED CLAIM SCOPE: everything under CLAIM 1 SCOPE is essential unless the source proves otherwise; nothing under DO NOT PROMOTE INTO CLAIMS may appear anywhere. Write each feature in claim-ready operative language at the broadest level the source supports.
4. optionalFeatures — the ladder for dependent claims: disclosed classes, preferred features, values, conditions, embodiment details (from Claimable Features, Fallback Limitations, support data), each as a one-line claim-ready limitation, broadest first.
5. categoryPlan — the independent claims to draft, in order: role "primary" for the detected patent type, then "mirror" claims in other statutory categories that the JURISDICTION CLAIM RULES permit and the source supports (apparatus/system, method/process, composition, medium or program in the office's formulation, kit, use where allowed), so that maker, user and seller are each caught by a single-actor claim. For each: category (one of method, system, apparatus, composition, product, medium, program, kit, compound, use), the opening words of the claim ("A ... comprising"), and a one-line justification. Never two claims in one category unless the rules block allows it; never a category the rules block excludes.
6. eligibility — risk (none/low/medium/high) that an examiner objects to the subject-matter as such under the doctrine named in the rules block; doctrine (the statute or guideline); mitigation (what Claim 1 must recite — technical means, technical effect, converted claim form — to survive it).
7. terminology — one entry per claimed element: the art-recognised claim term to use; the inventor's own term where it differs; retainInDependent true when the SOURCE FIDELITY MODE block requires the inventor's term to survive in a dependent claim (in PRESERVE mode the claimTerm is the inventor's term itself).
8. singleActor — who performs the method claim (manufacturer, operator, server, user) and which steps were moved or rephrased so that no method claim needs two actors.
9. numericLadder — every claim-relevant disclosed value: the parameter, the broad disclosed range (if any), the preferred range (if any), the example value, and the source reference (a SF-/SDS- id or the field name). Never invent a range from a single value.
10. claimForm — "two_part" only when the rules block requires two-part form now or CLOSEST ART is present and the split is clean; otherwise "one_part_pre_search".

Rules: cite nothing the source does not state; do not add features because they are typical for the field; do not include source-fact ids inside inventiveConcept, essentialFeatures or optionalFeatures (put them in sourceRef only).

Return ONLY this JSON object:
{
  "version": 1,
  "jurisdiction": "${rules.jurisdiction}",
  "inventiveConcept": "...",
  "problemSolved": "...",
  "closestArt": [{"ref": "...", "teaches": ["..."], "lacks": ["..."]}],
  "essentialFeatures": ["..."],
  "optionalFeatures": ["..."],
  "categoryPlan": [{"category": "${patentTypePrimary === 'PROCESS' ? 'method' : patentTypePrimary === 'COMPOSITION' ? 'composition' : patentTypePrimary === 'SYSTEM' ? 'system' : 'apparatus'}", "form": "A ... comprising", "role": "primary", "justification": "..."}],
  "eligibility": {"risk": "low", "doctrine": "...", "mitigation": "..."},
  "terminology": [{"element": "...", "claimTerm": "...", "inventorTerm": "...", "retainInDependent": false}],
  "singleActor": {"actor": "...", "avoidedDividedSteps": ["..."]},
  "numericLadder": [{"parameter": "...", "broad": "...", "preferred": "...", "example": "...", "sourceRef": "..."}],
  "claimForm": "one_part_pre_search"
}`
}

function bullets(items: string[], limit: number): string {
  return items.filter(Boolean).slice(0, limit).map(item => `- ${item}`).join('\n')
}

/** Full plan for the claims prompt. Empty string when there is no strategy. */
export function buildClaimStrategyBlock(strategy: ClaimStrategy | null | undefined): string {
  if (!strategy || !strategy.inventiveConcept) return ''
  const sections: string[] = [
    'CLAIM STRATEGY (the approved plan for this claim set; source support still gates every element)',
    `Inventive concept: ${strategy.inventiveConcept}`,
  ]
  if (strategy.problemSolved) sections.push(`Problem solved: ${strategy.problemSolved}`)
  if (strategy.closestArt.length) {
    sections.push('Closest art to clear:')
    sections.push(strategy.closestArt.map(item => `- ${item.ref}: lacks ${item.lacks.join('; ') || 'nothing identified'}${item.teaches.length ? ` (teaches ${item.teaches.join('; ')})` : ''}`).join('\n'))
  }
  sections.push(`Claim 1 must recite (essential features):\n${bullets(strategy.essentialFeatures, 12)}`)
  if (strategy.optionalFeatures.length) sections.push(`Dependent-claim ladder (broadest first):\n${bullets(strategy.optionalFeatures, 24)}`)
  if (strategy.categoryPlan.length) {
    sections.push('Independent claims to draft:')
    sections.push(strategy.categoryPlan.map(item => `- ${item.role}: ${item.category}${item.form ? ` — "${item.form}"` : ''}${item.justification ? ` (${item.justification})` : ''}`).join('\n'))
  }
  if (strategy.eligibility && (strategy.eligibility.doctrine || strategy.eligibility.mitigation)) {
    sections.push(`Eligibility: risk ${strategy.eligibility.risk}${strategy.eligibility.doctrine ? ` under ${strategy.eligibility.doctrine}` : ''}${strategy.eligibility.mitigation ? ` — Claim 1 must ${strategy.eligibility.mitigation}` : ''}`)
  }
  if (strategy.terminology.length) {
    sections.push('Terminology (use the claim term; retain the inventor\'s term in a dependent claim where marked):')
    sections.push(strategy.terminology.map(item => `- ${item.element}: "${item.claimTerm}"${item.inventorTerm && item.inventorTerm !== item.claimTerm ? ` (inventor: "${item.inventorTerm}"${item.retainInDependent ? '; retain verbatim in a dependent claim' : ''})` : ''}`).join('\n'))
  }
  if (strategy.singleActor.actor) {
    sections.push(`Single actor for method claims: ${strategy.singleActor.actor}${strategy.singleActor.avoidedDividedSteps.length ? ` (steps kept to one actor: ${strategy.singleActor.avoidedDividedSteps.join('; ')})` : ''}`)
  }
  if (strategy.numericLadder.length) {
    sections.push('Numeric ladder (broad → preferred → example; use only as disclosed):')
    sections.push(strategy.numericLadder.map(item => `- ${item.parameter}: ${[item.broad && `broad ${item.broad}`, item.preferred && `preferred ${item.preferred}`, item.example && `example ${item.example}`].filter(Boolean).join('; ') || 'as disclosed'}`).join('\n'))
  }
  sections.push(`Claim form: ${strategy.claimForm === 'two_part' ? 'two-part (preamble of known context + characterising portion)' : 'one-part "comprising" (pre-search; two-part conversion at refinement)'}`)
  return sections.join('\n')
}

/** Six-line digest for the refinement, challenge and repair prompts. */
export function buildClaimStrategyDigest(strategy: ClaimStrategy | null | undefined): string {
  if (!strategy || !strategy.inventiveConcept) return ''
  const lines = [
    `Inventive concept: ${strategy.inventiveConcept}`,
    `Essential features: ${strategy.essentialFeatures.slice(0, 8).join('; ')}`,
  ]
  if (strategy.categoryPlan.length) lines.push(`Independent claims: ${strategy.categoryPlan.map(item => `${item.role} ${item.category}`).join(', ')}`)
  if (strategy.eligibility?.mitigation) lines.push(`Eligibility: ${strategy.eligibility.risk} — ${strategy.eligibility.mitigation}`)
  const retained = strategy.terminology.filter(item => item.inventorTerm && item.inventorTerm !== item.claimTerm)
  if (retained.length) lines.push(`Terminology: ${retained.slice(0, 6).map(item => `"${item.inventorTerm}" → "${item.claimTerm}"`).join(', ')}`)
  if (strategy.singleActor.actor) lines.push(`Single actor: ${strategy.singleActor.actor}`)
  return lines.join('\n')
}
