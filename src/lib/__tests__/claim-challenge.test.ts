import { describe, it, expect } from 'vitest'
import {
  buildAcceptedRemarksBlock,
  buildChallengeRefinePrompt,
  buildClaimChallengePrompt,
  canonicalPublicationKey,
  ChallengeOutputSchema,
  ChallengeRefineOutputSchema,
  expandChallengeRemarks,
  filterRemarkRefs,
  MAX_CHALLENGE_REMARKS,
  MAX_CHALLENGE_TEXT_CHARS,
  mergeChallengeRefinedClaims,
  nextUserRemarkId,
  type ChallengeRemark,
} from '@/lib/claim-challenge'
import type { DraftClaim } from '@/lib/draft-claims-parser'
import { CLAIM_CHALLENGE_CHECKLIST, type ChallengeLintFinding } from '@/lib/claim-challenge-lint'
import type { OfficeFormFinding } from '@/lib/claim-rules/types'
import { CLAIM_CHALLENGE_ENABLED } from '@/lib/claim-challenge-flag'

const claim = (number: number, text: string, extra: Partial<DraftClaim> = {}): DraftClaim => ({
  number,
  text,
  type: number === 1 ? 'independent' : 'dependent',
  ...(number === 1 ? {} : { dependsOn: 1 }),
  ...extra,
}) as DraftClaim

const remark = (partial: Partial<ChallengeRemark> = {}): ChallengeRemark => ({
  id: 'R1',
  source: 'llm',
  claims: [1],
  cat: 'DEFINITENESS',
  sev: 'H',
  objection: 'Indefinite modifier.',
  fix: 'Remove "substantially".',
  disposition: 'accepted',
  ...partial,
})

describe('ChallengeOutputSchema', () => {
  it('parses well-formed output', () => {
    const parsed = ChallengeOutputSchema.safeParse({
      remarks: [{ claims: [1], cat: 'DEFINITENESS', sev: 'H', obj: 'Indefinite.', fix: 'Fix it.' }],
    })
    expect(parsed.success).toBe(true)
  })

  it('falls back to OTHER for an unknown category', () => {
    const parsed = ChallengeOutputSchema.parse({
      remarks: [{ claims: [1], cat: 'SOMETHING_ELSE', sev: 'H', obj: 'x', fix: 'y' }],
    })
    expect(parsed.remarks[0].cat).toBe('OTHER')
  })

  it('defaults an unreadable severity to medium', () => {
    const parsed = ChallengeOutputSchema.parse({
      remarks: [{ claims: [1], cat: 'JARGON', sev: 'critical-ish', obj: 'x', fix: 'y' }],
    })
    expect(parsed.remarks[0].sev).toBe('M')
  })

  it('coerces string claim numbers and drops unusable ones', () => {
    const parsed = ChallengeOutputSchema.parse({
      remarks: [{ claims: ['2', 'nope', 3], cat: 'JARGON', sev: 'L', obj: 'x', fix: 'y' }],
    })
    expect(parsed.remarks[0].claims).toEqual([2, 3])
  })

  it('treats a missing remarks array as empty rather than failing', () => {
    const parsed = ChallengeOutputSchema.parse({})
    expect(parsed.remarks).toEqual([])
  })

  it('drops a remark with no usable claim number but keeps the rest', () => {
    const parsed = ChallengeOutputSchema.parse({
      remarks: [
        { claims: [], cat: 'JARGON', sev: 'H', obj: 'orphan', fix: 'y' },
        { claims: ['nope'], cat: 'JARGON', sev: 'H', obj: 'orphan too', fix: 'y' },
        { claims: [2], cat: 'JARGON', sev: 'L', obj: 'kept', fix: 'y' },
      ],
    })
    expect(parsed.remarks.map(remark => remark.obj)).toEqual(['kept'])
  })

  it('drops a remark with empty text but keeps the rest', () => {
    const parsed = ChallengeOutputSchema.parse({
      remarks: [
        { claims: [1], cat: 'JARGON', sev: 'H', obj: '   ', fix: 'y' },
        { claims: [1], cat: 'JARGON', sev: 'H', obj: 'x', fix: null },
        { claims: [1], cat: 'JARGON', sev: 'H', obj: 'kept', fix: 'y' },
      ],
    })
    expect(parsed.remarks.map(remark => remark.obj)).toEqual(['kept'])
  })

  it('truncates over-long text instead of failing the run', () => {
    const long = 'a'.repeat(MAX_CHALLENGE_TEXT_CHARS + 500)
    const parsed = ChallengeOutputSchema.safeParse({
      remarks: [{ claims: [1], cat: 'JARGON', sev: 'H', obj: long, fix: long }],
    })
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.remarks[0].obj).toHaveLength(MAX_CHALLENGE_TEXT_CHARS)
    expect(parsed.data.remarks[0].fix).toHaveLength(MAX_CHALLENGE_TEXT_CHARS)
  })

  it('caps the remark list by slicing rather than failing', () => {
    const many = Array.from({ length: 40 }, (_, index) => ({
      claims: [1], cat: 'OTHER', sev: 'L', obj: `o${index}`, fix: 'f',
    }))
    const parsed = ChallengeOutputSchema.safeParse({ remarks: many })
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.remarks).toHaveLength(25)
  })

  it('deduplicates repeated claim numbers within a remark', () => {
    const parsed = ChallengeOutputSchema.parse({
      remarks: [{ claims: [3, '3', 1, 3], cat: 'JARGON', sev: 'L', obj: 'x', fix: 'y' }],
    })
    expect(parsed.remarks[0].claims).toEqual([3, 1])
  })
})

describe('expandChallengeRemarks', () => {
  it('caps LLM remarks and orders them by severity', () => {
    const many = Array.from({ length: 20 }, (_, index) => ({
      claims: [1],
      cat: 'DEFINITENESS' as const,
      sev: (index === 19 ? 'H' : 'L') as 'H' | 'L',
      obj: `objection ${index}`,
      fix: `fix ${index}`,
    }))
    const remarks = expandChallengeRemarks({ remarks: many } as any, [])
    expect(remarks).toHaveLength(MAX_CHALLENGE_REMARKS)
    expect(remarks[0].objection).toBe('objection 19')
    expect(remarks[0].id).toBe('R1')
  })

  it('keeps a lint finding the model did not cover', () => {
    const lint: ChallengeLintFinding[] = [
      { code: 'SEQUENCE_CONFLATION', claimNumber: 3, excerpt: 'KLVFF-PEG2000', message: 'conflated' },
    ]
    const remarks = expandChallengeRemarks({ remarks: [] } as any, lint)
    expect(remarks).toHaveLength(1)
    expect(remarks[0].source).toBe('lint')
    expect(remarks[0].cat).toBe('SEQUENCE_CONFLATION')
    expect(remarks[0].id).toBe('L1')
  })

  it('keeps the deterministic finding and drops the model duplicate for the same claim', () => {
    // A finding carrying a statutory basis outranks an opinion: previously the
    // model's remark won, so a blocking office defect could be silenced by a
    // same-category comment.
    const parsed = { remarks: [{ claims: [1], cat: 'DEFINITENESS' as const, sev: 'H' as const, obj: 'x', fix: 'y' }] }
    const lint: ChallengeLintFinding[] = [
      { code: 'INDEFINITE_MODIFIER', claimNumber: 1, excerpt: 'substantially', message: 'dupe' },
    ]
    const remarks = expandChallengeRemarks(parsed as any, lint)
    expect(remarks).toHaveLength(1)
    expect(remarks[0].source).toBe('lint')
  })

  it('grades a seeded finding by the office severity and caps the seeded set', () => {
    const many: OfficeFormFinding[] = Array.from({ length: 12 }, (_, index) => ({
      id: `F${index + 1}`, code: 'USE_CLAIM', severity: 'block', fix: 'llm',
      claimNumber: index + 1, excerpt: 'Use of', message: 'not statutory',
      basis: '35 USC 101', jurisdiction: 'US',
    }))
    const remarks = expandChallengeRemarks({ remarks: [] } as any, many)
    expect(remarks).toHaveLength(8)
    expect(remarks.every(entry => entry.sev === 'H')).toBe(true)
    expect(remarks[0].cat).toBe('CLAIM_FORM')
    expect(remarks[0].objection).toContain('35 USC 101')
  })

  it('leaves a set-level finding out of the remarks', () => {
    const setLevel: OfficeFormFinding[] = [{
      id: 'F1', code: 'UNITY_BREAK', severity: 'warn', fix: 'manual',
      claimNumber: null, excerpt: '', message: 'no shared feature',
      basis: 'Article 82 EPC', jurisdiction: 'EP',
    }]
    expect(expandChallengeRemarks({ remarks: [] } as any, setLevel)).toHaveLength(0)
  })

  it('maps every office code that can block onto a real category, never OTHER', () => {
    const codes = ['ANTECEDENT_BASIS', 'USE_CLAIM', 'METHOD_OF_TREATMENT', 'PROGRAM_PER_SE',
      'EXPERIMENTAL_PARAMETER', 'TAUTOLOGY', 'INDEPENDENT_PER_CATEGORY_EXCEEDED', 'UNITY_BREAK']
    for (const code of codes) {
      const remarks = expandChallengeRemarks({ remarks: [] } as any, [{
        id: 'F1', code, severity: 'block', fix: 'llm', claimNumber: 1,
        excerpt: 'x', message: 'm', basis: 'b', jurisdiction: 'US',
      }] as OfficeFormFinding[])
      expect(remarks[0]?.cat, code).not.toBe('OTHER')
    }
  })

  it('marks every remark pending so nothing is accepted by default', () => {
    const remarks = expandChallengeRemarks(
      { remarks: [{ claims: [1], cat: 'JARGON' as const, sev: 'M' as const, obj: 'x', fix: 'y' }] } as any,
      [],
    )
    expect(remarks.every(entry => entry.disposition === 'pending')).toBe(true)
  })

  it('strips claim numbers that are not in the set and drops remarks left with none', () => {
    const parsed = {
      remarks: [
        { claims: [1, 15], cat: 'JARGON' as const, sev: 'H' as const, obj: 'partly real', fix: 'y' },
        { claims: [15], cat: 'JARGON' as const, sev: 'H' as const, obj: 'phantom', fix: 'y' },
      ],
    }
    const remarks = expandChallengeRemarks(parsed as any, [], [1, 2, 3])
    expect(remarks).toHaveLength(1)
    expect(remarks[0].objection).toBe('partly real')
    expect(remarks[0].claims).toEqual([1])
    expect(remarks[0].id).toBe('R1')
  })

  it('leaves claim numbers alone when no set is supplied', () => {
    const parsed = { remarks: [{ claims: [15], cat: 'JARGON' as const, sev: 'H' as const, obj: 'x', fix: 'y' }] }
    expect(expandChallengeRemarks(parsed as any, [])).toHaveLength(1)
    expect(expandChallengeRemarks(parsed as any, [], [])).toHaveLength(1)
  })
})

describe('nextUserRemarkId', () => {
  it('continues past existing user remarks', () => {
    expect(nextUserRemarkId([remark({ id: 'R1' }), remark({ id: 'U2' })])).toBe('U3')
  })

  it('starts at U1 when there are none', () => {
    expect(nextUserRemarkId([remark({ id: 'R1' })])).toBe('U1')
  })
})

describe('buildAcceptedRemarksBlock', () => {
  it('prefers the attorney-edited amendment instruction', () => {
    const block = buildAcceptedRemarksBlock([
      remark({ fix: 'model wording', editedFix: 'attorney wording' }),
    ])
    expect(block).toContain('attorney wording')
    expect(block).not.toContain('model wording')
  })

  it('falls back to the model instruction when the edit is blank', () => {
    const block = buildAcceptedRemarksBlock([remark({ fix: 'model wording', editedFix: '   ' })])
    expect(block).toContain('model wording')
  })

  it('is empty when nothing was accepted', () => {
    expect(buildAcceptedRemarksBlock([])).toBe('')
  })
})

/** An office-form finding, the shape the challenger is now seeded from. */
function finding(partial: Partial<OfficeFormFinding> & { code: string }): OfficeFormFinding {
  return {
    id: 'F1',
    severity: 'warn',
    fix: 'llm',
    claimNumber: 1,
    excerpt: 'x',
    message: 'flagged thing',
    basis: '35 USC 112(b)',
    jurisdiction: 'US',
    ...partial,
  }
}

describe('feature flag', () => {
  it('is off unless the environment turns it on', () => {
    // The challenger is complete and kept, but out of the application flow:
    // the API actions refuse and the button does not render while this is false.
    expect(CLAIM_CHALLENGE_ENABLED).toBe(false)
  })
})

describe('buildClaimChallengePrompt', () => {
  const base = {
    ideaBasics: { title: 'A dryer' },
    componentList: '- tray',
    sourceFactLedgerBlock: '',
    claims: [claim(1, 'A dryer comprising a tray.')],
    lintFindings: [] as OfficeFormFinding[],
    sourceFidelityMode: 'STRUCTURE_ONLY' as const,
  }

  it('always includes the checklist', () => {
    const prompt = buildClaimChallengePrompt(base)
    expect(prompt).toContain('MANDATORY CHECKLIST')
    expect(prompt).toContain('SEQUENCE_CONFLATION')
  })

  it('carries the PRESERVE deviation instruction in preserve mode', () => {
    const prompt = buildClaimChallengePrompt({ ...base, sourceFidelityMode: 'PRESERVE' })
    expect(prompt).toContain('PRESERVE MODE')
    expect(prompt).toContain('retain the inventor')
  })

  it('seeds the automated findings with their severity and basis, and the user focus', () => {
    const prompt = buildClaimChallengePrompt({
      ...base,
      lintFindings: [
        finding({ code: 'USE_CLAIM', severity: 'block', message: 'not a statutory category', basis: '35 USC 101' }),
        finding({ id: 'F2', code: 'INDEFINITE_MODIFIER' }),
      ],
      focusText: 'attack claim 1 breadth',
    })
    expect(prompt).toContain('AUTOMATED FINDINGS')
    expect(prompt).toContain('Settled defects that must be amended')
    expect(prompt).toContain('[BLOCK] USE_CLAIM claim 1 (35 USC 101)')
    expect(prompt).toContain('Observations:')
    expect(prompt).toContain('flagged thing')
    expect(prompt).toContain('attack claim 1 breadth')
  })

  it('renders a set-level finding as "claim set", never "Claim null"', () => {
    const prompt = buildClaimChallengePrompt({
      ...base,
      lintFindings: [finding({ code: 'UNITY_BREAK', claimNumber: null, message: 'no shared feature' })],
    })
    expect(prompt).toContain('UNITY_BREAK claim set')
    expect(prompt).not.toContain('Claim null')
  })

  it('invites the model to report a false positive rather than a new objection', () => {
    const prompt = buildClaimChallengePrompt({ ...base, lintFindings: [finding({ code: 'SOURCE_JARGON' })] })
    expect(prompt).toContain('FALSE POSITIVE')
    expect(prompt).toContain('standard in this art')
  })

  it('omits the focus block when no focus was given', () => {
    expect(buildClaimChallengePrompt(base)).not.toContain('USER FOCUS')
  })

  it('carries the office rules block and the strategy digest when supplied', () => {
    // The old block named the office and asked the model to recall its practice;
    // this one states the rules.
    const withRules = buildClaimChallengePrompt({
      ...base,
      rulesBlock: 'JURISDICTION CLAIM RULES (EP — European Patent Office)\nFORM:\n- multiple dependency permitted',
      strategyDigest: 'Inventive concept: a dryer that vents on humidity',
    })
    expect(withRules).toContain('JURISDICTION CLAIM RULES (EP')
    expect(withRules).toContain('multiple dependency permitted')
    expect(withRules).toContain('CLAIM STRATEGY (the approved plan')
    expect(withRules).toContain('Inventive concept: a dryer')
    expect(buildClaimChallengePrompt(base)).not.toContain('JURISDICTION CLAIM RULES')
    expect(buildClaimChallengePrompt(base)).not.toContain('CLAIM STRATEGY (the approved plan')
  })

  it('carries the full drafting best-practice checklist', () => {
    const prompt = buildClaimChallengePrompt(base)
    for (const item of ['CLAIM_FORM', 'DEPENDENCY', 'FUNCTIONAL_CLAIMING', 'OPTIONAL_LANGUAGE', 'RANGES', 'CLAIM_SET_STRATEGY', 'REDUNDANCY', 'NEGATIVE_LIMITATION']) {
      expect(prompt).toContain(item)
    }
  })

  it('keeps the checklist short enough to leave room for prior-art references', () => {
    // The checklist and the rules block trade directly against the reference
    // budget in fitArtVocabularyBlock, so its size is asserted, not eyeballed.
    expect(CLAIM_CHALLENGE_CHECKLIST.length).toBeLessThan(5000)
    expect(CLAIM_CHALLENGE_CHECKLIST.split('\n').filter(line => /^\d+\./.test(line))).toHaveLength(12)
  })
})

describe('buildChallengeRefinePrompt', () => {
  it('states the next claim number for additions and lists the accepted remarks', () => {
    const prompt = buildChallengeRefinePrompt({
      ideaBasics: { title: 'A dryer' },
      componentList: '- tray',
      sourceFactLedgerBlock: '',
      claims: [claim(1, 'A dryer comprising a tray.')],
      acceptedRemarks: [remark({ id: 'R7' })],
      fidelityBlock: '',
      terminologyTranslationBlock: '',
      nextClaimNumber: 4,
    })
    expect(prompt).toContain('numbered sequentially from 4')
    expect(prompt).toContain('[R7]')
    expect(prompt).toContain('added_claims')
  })

  it('binds every amendment to the drafting standards', () => {
    const prompt = buildChallengeRefinePrompt({
      ideaBasics: { title: 'A dryer' },
      componentList: '',
      sourceFactLedgerBlock: '',
      claims: [claim(1, 'A dryer comprising a tray.')],
      acceptedRemarks: [remark()],
      fidelityBlock: '',
      terminologyTranslationBlock: '',
      nextClaimNumber: 2,
    })
    expect(prompt).toContain('CLAIM DRAFTING STANDARDS FOR EVERY AMENDMENT')
    expect(prompt).toContain('One sentence per claim')
    expect(prompt).toContain('never make a multiple dependent claim depend on another multiple dependent claim')
  })
})

describe('ChallengeOutputSchema categories', () => {
  it('accepts the drafting best-practice categories without falling back to OTHER', () => {
    const parsed = ChallengeOutputSchema.parse({
      remarks: ['CLAIM_FORM', 'DEPENDENCY', 'FUNCTIONAL_CLAIMING', 'OPTIONAL_LANGUAGE', 'RANGES', 'CLAIM_SET_STRATEGY', 'REDUNDANCY', 'NEGATIVE_LIMITATION']
        .map(cat => ({ claims: [1], cat, sev: 'M', obj: 'x', fix: 'y' })),
    })
    expect(parsed.remarks.map(remark => remark.cat)).toEqual([
      'CLAIM_FORM', 'DEPENDENCY', 'FUNCTIONAL_CLAIMING', 'OPTIONAL_LANGUAGE', 'RANGES', 'CLAIM_SET_STRATEGY', 'REDUNDANCY', 'NEGATIVE_LIMITATION',
    ])
  })

  it('routes a form lint finding to the matching category', () => {
    const remarks = expandChallengeRemarks({ remarks: [] } as any, [
      { code: 'AND_OR' as any, claimNumber: 1, excerpt: 'and/or', message: 'and/or' },
      { code: 'IMPROPER_DEPENDENCY' as any, claimNumber: 2, excerpt: 'claim 5', message: 'forward' },
    ])
    expect(remarks.map(remark => remark.cat)).toEqual(['CLAIM_FORM', 'DEPENDENCY'])
  })
})

describe('art vocabulary references', () => {
  const base = {
    ideaBasics: { title: 'A dryer' },
    componentList: '- tray',
    sourceFactLedgerBlock: '',
    claims: [claim(1, 'A dryer comprising a tray.')],
    lintFindings: [{ id: 'F1', code: 'INDEFINITE_MODIFIER', severity: 'warn', fix: 'llm', claimNumber: 1, excerpt: 'x', message: 'flagged thing', basis: '35 USC 112(b)', jurisdiction: 'US' }] as OfficeFormFinding[],
    sourceFidelityMode: 'STRUCTURE_ONLY' as const,
  }
  const block = 'ART VOCABULARY REFERENCE (read-only; 1 claim set)\nHARD RULES:\n1. Never import.'

  it('parses refs to an empty list when missing and keeps strings when present', () => {
    const parsed = ChallengeOutputSchema.parse({
      remarks: [
        { claims: [1], cat: 'JARGON', sev: 'M', obj: 'x', fix: 'y' },
        { claims: [1], cat: 'JARGON', sev: 'M', obj: 'x', fix: 'y', refs: ['EP1234567B1', 7, ''] },
      ],
    })
    expect(parsed.remarks[0].refs).toEqual([])
    expect(parsed.remarks[1].refs).toEqual(['EP1234567B1', '7'])
  })

  it('keeps PRIOR_ART_SIGNAL as its own category', () => {
    const parsed = ChallengeOutputSchema.parse({
      remarks: [{ claims: [1], cat: 'PRIOR_ART_SIGNAL', sev: 'H', obj: 'reads on claim 1', fix: 'Take it to prior art.' }],
    })
    expect(parsed.remarks[0].cat).toBe('PRIOR_ART_SIGNAL')
  })

  it('attaches citations only for references the prompt carried, spelled as the reference list spells them', () => {
    const parsed = {
      remarks: [
        { claims: [1], cat: 'JARGON' as const, sev: 'M' as const, obj: 'x', fix: 'y', refs: ['ep 1234567 b1', 'US9999999B2', 'EP1234567'] },
        { claims: [1], cat: 'DEFINITENESS' as const, sev: 'M' as const, obj: 'x', fix: 'y', refs: [] },
      ],
    }
    const withRefs = expandChallengeRemarks(parsed as any, [], [1], ['EP1234567B1', 'US20200001234A1'])
    expect(withRefs[0].refs).toEqual(['EP1234567B1'])
    expect(withRefs[1].refs).toEqual([])

    const withoutRefs = expandChallengeRemarks(parsed as any, [], [1])
    expect(withoutRefs[0]).not.toHaveProperty('refs')

    const lintOnly = expandChallengeRemarks({ remarks: [] } as any, [
      { code: 'AND_OR', claimNumber: 1, excerpt: 'and/or', message: 'and/or' },
    ], [1], ['EP1234567B1'])
    expect(lintOnly[0]).not.toHaveProperty('refs')
  })

  it('compares publication numbers without separators or kind codes', () => {
    expect(canonicalPublicationKey('EP 1234567 B1')).toBe('EP1234567')
    expect(canonicalPublicationKey('ep1234567b1')).toBe('EP1234567')
    expect(canonicalPublicationKey('US20200001234A1')).toBe('US20200001234')
    expect(canonicalPublicationKey('IN202011012345')).toBe('IN202011012345')
    expect(canonicalPublicationKey('US9999999')).toBe('US9999999')
    expect(filterRemarkRefs(['us-9999999-b2', 'US9999999B2', 'WO2020000001A1'], ['US9999999B2'])).toEqual(['US9999999B2'])
  })

  it('inserts the reference block after the checklist and before the screening results, only when given', () => {
    const prompt = buildClaimChallengePrompt({ ...base, artVocabularyBlock: block })
    const checklistAt = prompt.indexOf('MANDATORY CHECKLIST')
    const blockAt = prompt.indexOf('ART VOCABULARY REFERENCE')
    const lintAt = prompt.indexOf('AUTOMATED FINDINGS (deterministic screen')
    expect(checklistAt).toBeGreaterThan(-1)
    expect(blockAt).toBeGreaterThan(checklistAt)
    expect(lintAt).toBeGreaterThan(blockAt)
    expect(prompt).toContain('"refs": the publication numbers')
    expect(prompt).toContain('"refs":[]')

    const plain = buildClaimChallengePrompt(base)
    expect(plain).not.toContain('ART VOCABULARY REFERENCE')
    expect(plain).not.toContain('"refs"')
    expect(buildClaimChallengePrompt({ ...base, artVocabularyBlock: '   ' })).toBe(plain)
  })

  it('carries the citation into the refine prompt but never the reference text', () => {
    const cited = buildAcceptedRemarksBlock([remark({ refs: ['EP1234567B1', 'US9999999B2'], fix: 'Recite "support member".' })])
    expect(cited).toContain('TERM SOURCE: EP1234567B1, US9999999B2')
    expect(cited).toContain('no reference text is provided')
    expect(cited).not.toContain('ART VOCABULARY REFERENCE')
    expect(buildAcceptedRemarksBlock([remark({ refs: [] })])).not.toContain('TERM SOURCE')
    expect(buildAcceptedRemarksBlock([remark()])).not.toContain('TERM SOURCE')
  })
})

describe('mergeChallengeRefinedClaims', () => {
  const base = [claim(1, 'A device comprising a plate.'), claim(2, 'The device of claim 1, wherein the plate is steel.')]

  it('applies only accepted amendments', () => {
    const result = mergeChallengeRefinedClaims({
      baseStructured: base,
      refinedClaims: [
        { number: 1, original_text: '', refined_text: 'A device comprising a support member.', keep_as_is: false, change_reason: 'broadened', remark_refs: ['R1'] },
        { number: 2, original_text: '', refined_text: 'The device of claim 1, wherein the support member is steel.', keep_as_is: false, change_reason: 'aligned', remark_refs: [] },
      ] as any,
      acceptedClaimNumbers: [1],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.merged[0].text).toContain('support member')
    expect(result.merged[1].text).toContain('the plate is steel')
    expect(result.changedClaimNumbers).toEqual([1])
  })

  it('strips a claim-number prefix the model echoed back', () => {
    const result = mergeChallengeRefinedClaims({
      baseStructured: base,
      refinedClaims: [{ number: 2, original_text: '', refined_text: '2. The device of claim 1, wherein the plate is aluminium.', keep_as_is: false, change_reason: '', remark_refs: [] }] as any,
      addedClaims: [{ number: 3, text: '3. The device of claim 1, further comprising a seal.', type: 'dependent', dependsOn: 1, reason: '', remark_refs: [] }] as any,
      acceptAll: true,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.merged[1].text).toBe('The device of claim 1, wherein the plate is aluminium.')
    expect(result.merged[2].text).toBe('The device of claim 1, further comprising a seal.')
  })

  it('keeps a leading reference to a different claim number intact', () => {
    const result = mergeChallengeRefinedClaims({
      baseStructured: base,
      refinedClaims: [{ number: 2, original_text: '', refined_text: '1. and 2. taken together define the assembly.', keep_as_is: false, change_reason: '', remark_refs: [] }] as any,
      acceptAll: true,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.merged[1].text).toBe('1. and 2. taken together define the assembly.')
  })

  it('refuses an empty preview', () => {
    const result = mergeChallengeRefinedClaims({ baseStructured: base, refinedClaims: [] })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('EMPTY_CHALLENGE_REFINEMENT_PREVIEW')
  })

  it('treats a prefix-only amendment as no change rather than blanking the claim', () => {
    const result = mergeChallengeRefinedClaims({
      baseStructured: base,
      refinedClaims: [
        { number: 1, original_text: '', refined_text: '1. ', keep_as_is: false, change_reason: '', remark_refs: [] },
        { number: 2, original_text: '', refined_text: 'The device of claim 1, wherein the plate is brass.', keep_as_is: false, change_reason: '', remark_refs: [] },
      ] as any,
      acceptAll: true,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.merged[0].text).toBe('A device comprising a plate.')
    expect(result.changedClaimNumbers).toEqual([2])
  })

  it('refuses a merge that would change nothing', () => {
    const nothingAccepted = mergeChallengeRefinedClaims({
      baseStructured: base,
      refinedClaims: [{ number: 1, original_text: '', refined_text: 'A device comprising a support.', keep_as_is: false, change_reason: '', remark_refs: [] }] as any,
      acceptedClaimNumbers: [],
      acceptedAddedClaimNumbers: [],
    })
    expect(nothingAccepted.ok).toBe(false)
    if (nothingAccepted.ok) return
    expect(nothingAccepted.code).toBe('CHALLENGE_NOTHING_ACCEPTED')

    const nothingProposed = mergeChallengeRefinedClaims({
      baseStructured: base,
      refinedClaims: [{ number: 1, original_text: '', refined_text: null, keep_as_is: true, change_reason: '', remark_refs: [] }] as any,
      acceptAll: true,
    })
    expect(nothingProposed.ok).toBe(false)
    if (nothingProposed.ok) return
    expect(nothingProposed.code).toBe('CHALLENGE_NOTHING_ACCEPTED')
  })

  it('accepts an added claim alone as a real change', () => {
    const result = mergeChallengeRefinedClaims({
      baseStructured: base,
      refinedClaims: [{ number: 1, original_text: '', refined_text: 'A device comprising a support.', keep_as_is: false, change_reason: '', remark_refs: [] }] as any,
      addedClaims: [{ number: 3, text: 'The device of claim 1, wherein the support is a plate.', type: 'dependent', dependsOn: 1, reason: '', remark_refs: [] }] as any,
      acceptedClaimNumbers: [],
      acceptedAddedClaimNumbers: [3],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.changedClaimNumbers).toEqual([])
    expect(result.addedClaimNumbers).toEqual([3])
  })

  it('refuses a merge that would leave a claim with no text', () => {
    const result = mergeChallengeRefinedClaims({
      baseStructured: [claim(1, 'A device comprising a plate.'), claim(2, '   ')],
      refinedClaims: [{ number: 1, original_text: '', refined_text: 'A device comprising a support.', keep_as_is: false, change_reason: '', remark_refs: [] }] as any,
      acceptAll: true,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('CHALLENGE_EMPTY_CLAIM_TEXT')
  })

  it('refuses a merge that would empty the set', () => {
    const result = mergeChallengeRefinedClaims({
      baseStructured: [],
      refinedClaims: [{ number: 1, original_text: '', refined_text: 'x', keep_as_is: false, change_reason: '', remark_refs: [] }] as any,
      acceptAll: true,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('CHALLENGE_WOULD_EMPTY_CLAIMS')
  })

  it('accepts a well-formed added dependent claim', () => {
    const result = mergeChallengeRefinedClaims({
      baseStructured: base,
      refinedClaims: [{ number: 1, original_text: '', refined_text: 'A device comprising a support member.', keep_as_is: false, change_reason: '', remark_refs: [] }] as any,
      addedClaims: [{ number: 3, text: 'The device of claim 1, wherein the support member is a plate.', type: 'dependent', dependsOn: 1, reason: 'retention', remark_refs: ['R1'] }] as any,
      acceptAll: true,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.merged).toHaveLength(3)
    expect(result.addedClaimNumbers).toEqual([3])
    expect(result.merged[2].dependsOn).toBe(1)
  })

  it('rejects an added claim that does not continue the numbering', () => {
    const result = mergeChallengeRefinedClaims({
      baseStructured: base,
      refinedClaims: [{ number: 1, original_text: '', refined_text: 'x', keep_as_is: false, change_reason: '', remark_refs: [] }] as any,
      addedClaims: [{ number: 9, text: 'The device of claim 1.', type: 'dependent', dependsOn: 1, reason: '', remark_refs: [] }] as any,
      acceptAll: true,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('CHALLENGE_ADDED_CLAIM_INVALID')
  })

  it('rejects an added claim depending on a later claim', () => {
    const result = mergeChallengeRefinedClaims({
      baseStructured: base,
      refinedClaims: [{ number: 1, original_text: '', refined_text: 'x', keep_as_is: false, change_reason: '', remark_refs: [] }] as any,
      addedClaims: [{ number: 3, text: 'The device of claim 5.', type: 'dependent', dependsOn: 5, reason: '', remark_refs: [] }] as any,
      acceptAll: true,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('CHALLENGE_ADDED_CLAIM_INVALID')
  })

  it('leaves out an added claim the attorney rejected', () => {
    const result = mergeChallengeRefinedClaims({
      baseStructured: base,
      refinedClaims: [{ number: 1, original_text: '', refined_text: 'x', keep_as_is: false, change_reason: '', remark_refs: [] }] as any,
      addedClaims: [{ number: 3, text: 'The device of claim 1.', type: 'dependent', dependsOn: 1, reason: '', remark_refs: [] }] as any,
      acceptedClaimNumbers: [1],
      acceptedAddedClaimNumbers: [],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.merged).toHaveLength(2)
    expect(result.addedClaimNumbers).toEqual([])
  })
})

describe('ChallengeRefineOutputSchema', () => {
  it('normalises a null refined_text and coerces numbers', () => {
    const parsed = ChallengeRefineOutputSchema.parse({
      refined_claims: [{ number: '2', refined_text: '', keep_as_is: 'true' }],
    })
    expect(parsed.refined_claims[0].number).toBe(2)
    expect(parsed.refined_claims[0].refined_text).toBeNull()
    expect(parsed.refined_claims[0].keep_as_is).toBe(true)
    expect(parsed.added_claims).toEqual([])
  })

  it('accepts a null original_text and change_reason', () => {
    const parsed = ChallengeRefineOutputSchema.safeParse({
      refined_claims: [{ number: 1, original_text: null, refined_text: 'x', keep_as_is: false, change_reason: null }],
    })
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.refined_claims[0].original_text).toBe('')
    expect(parsed.data.refined_claims[0].change_reason).toBe('')
  })

  it('drops an entry with an unusable claim number but keeps the rest', () => {
    const parsed = ChallengeRefineOutputSchema.parse({
      refined_claims: [
        { number: '1a', refined_text: 'x', keep_as_is: false },
        { number: 2, refined_text: 'y', keep_as_is: false },
      ],
      added_claims: [
        { number: 3, text: '', dependsOn: 1 },
        { number: 4, text: 'The device of claim 1.', dependsOn: 'one' },
        { number: 5, text: 'The device of claim 1.', dependsOn: 1 },
      ],
      unresolved: [{ id: '', reason: 'blank id' }, { id: 'R2', reason: null }],
    })
    expect(parsed.refined_claims.map(claim => claim.number)).toEqual([2])
    expect(parsed.added_claims.map(claim => claim.number)).toEqual([5])
    expect(parsed.unresolved).toEqual([{ id: 'R2', reason: '' }])
  })
})
