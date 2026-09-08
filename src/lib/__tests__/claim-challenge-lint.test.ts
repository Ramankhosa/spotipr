import { describe, it, expect } from 'vitest'
import {
  CLAIM_CHALLENGE_CHECKLIST,
  computeClaimsFingerprint,
  findAndOr,
  findDuplicateClaims,
  findFunctionalResultStatic,
  findImproperDependencies,
  findIndefiniteModifiers,
  findMeansPlusFunction,
  findMultiSentenceClaims,
  findNegativeLimitations,
  findOmnibusReferences,
  findOptionalLanguage,
  findPictureClaim1,
  findSequenceConflation,
  findSourceJargon,
  findTrademarks,
  referencedClaimNumbers,
  runClaimChallengeLint,
} from '@/lib/claim-challenge-lint'
import type { DraftClaim } from '@/lib/draft-claims-parser'

const claim = (partial: Partial<DraftClaim> & { number: number; text: string }): DraftClaim => ({
  type: partial.number === 1 ? 'independent' : 'dependent',
  ...partial,
}) as DraftClaim

describe('findIndefiniteModifiers', () => {
  it('flags a subjective modifier with no numeric anchor', () => {
    const findings = findIndefiniteModifiers([
      claim({ number: 1, text: 'An apparatus comprising a substantially planar support plate.' }),
    ])
    expect(findings).toHaveLength(1)
    expect(findings[0].code).toBe('INDEFINITE_MODIFIER')
    expect(findings[0].message).toContain('substantially')
  })

  it('suppresses the modifier when the same clause states a number', () => {
    const findings = findIndefiniteModifiers([
      claim({ number: 1, text: 'An apparatus comprising a plate planar to approximately 0.2 mm.' }),
    ])
    expect(findings).toHaveLength(0)
  })

  it('does not let a number elsewhere in the claim excuse a different clause', () => {
    const findings = findIndefiniteModifiers([
      claim({
        number: 1,
        text: 'An apparatus comprising a substantially planar plate; and a shaft of 5 mm diameter.',
      }),
    ])
    expect(findings.map(f => f.message).join(' ')).toContain('substantially')
  })
})

describe('findSourceJargon', () => {
  it('flags an alphanumeric code name', () => {
    const findings = findSourceJargon([
      claim({ number: 1, text: 'A composition comprising a targeting peptide Pep-B2 bound to a carrier.' }),
    ])
    expect(findings.some(f => f.message.includes('Pep-B2'))).toBe(true)
  })

  it('flags a component name the inventor coined', () => {
    const findings = findSourceJargon(
      [claim({ number: 1, text: 'A system comprising a DeliveryVehicle coupled to a pump.' })],
      { components: [{ name: 'DeliveryVehicle' }] },
    )
    expect(findings.some(f => f.message.includes('DeliveryVehicle'))).toBe(true)
  })

  it('does not mistake the dependency reference for a code name', () => {
    const findings = findSourceJargon([
      claim({ number: 2, text: 'The composition of claim 1, wherein the carrier is a phospholipid.' }),
    ])
    expect(findings).toHaveLength(0)
  })

  it('does not treat a word followed by a quantity as a code name', () => {
    const findings = findSourceJargon([
      claim({ number: 1, text: 'A device comprising a plate having a thickness of 5 mm.' }),
    ])
    expect(findings).toHaveLength(0)
  })

  it('leaves ordinary technical vocabulary alone', () => {
    const findings = findSourceJargon(
      [claim({ number: 1, text: 'A system comprising a lipid nanoparticle and a targeting peptide.' })],
      { components: [{ name: 'lipid nanoparticle' }] },
    )
    expect(findings).toHaveLength(0)
  })
})

describe('findPictureClaim1', () => {
  it('flags a term in claim 1 that a dependent narrows again', () => {
    const findings = findPictureClaim1([
      claim({ number: 1, text: 'A composition comprising a structural lipid and a nucleic acid.' }),
      claim({ number: 2, text: 'The composition of claim 1, wherein the lipid is DSPC.' }),
    ])
    expect(findings.some(f => f.code === 'PICTURE_CLAIM_1')).toBe(true)
  })

  it('flags claim 1 holding the set\'s only numeric range', () => {
    const findings = findPictureClaim1([
      claim({ number: 1, text: 'A device comprising a plate having a thickness of 5 mm.' }),
      claim({ number: 2, text: 'The device of claim 1, further comprising a housing.' }),
    ])
    expect(findings.some(f => f.message.includes('only numeric limitation'))).toBe(true)
  })

  it('stays quiet when dependents carry their own numbers', () => {
    const findings = findPictureClaim1([
      claim({ number: 1, text: 'A device comprising a plate and a housing.' }),
      claim({ number: 2, text: 'The device of claim 1, wherein the plate is 5 mm thick.' }),
    ])
    expect(findings.filter(f => f.message.includes('only numeric limitation'))).toHaveLength(0)
  })
})

describe('findSequenceConflation', () => {
  it('flags a chemical moiety welded into a sequence string', () => {
    const findings = findSequenceConflation([
      claim({ number: 1, text: 'A conjugate comprising the peptide KLVFFRGD-PEG2000 linked to a carrier.' }),
    ])
    expect(findings).toHaveLength(1)
    expect(findings[0].code).toBe('SEQUENCE_CONFLATION')
  })

  it('accepts a sequence recited without chemistry fused to it', () => {
    const findings = findSequenceConflation([
      claim({ number: 1, text: 'A conjugate comprising the peptide KLVFFRGD conjugated via a terminal PEG moiety.' }),
    ])
    expect(findings).toHaveLength(0)
  })
})

describe('findFunctionalResultStatic', () => {
  it('flags a result verb in a composition claim', () => {
    const findings = findFunctionalResultStatic([
      claim({ number: 1, text: 'A composition comprising an active agent, wherein the composition treats inflammation.', category: 'composition' } as any),
    ])
    expect(findings.some(f => f.code === 'FUNCTIONAL_RESULT_STATIC')).toBe(true)
  })

  it('accepts a result expressed as a structural capability', () => {
    const findings = findFunctionalResultStatic([
      claim({ number: 1, text: 'A composition comprising a peptide configured to bind transferrin receptor 1.', category: 'composition' } as any),
    ])
    expect(findings).toHaveLength(0)
  })

  it('leaves method claims alone', () => {
    const findings = findFunctionalResultStatic([
      claim({ number: 1, text: 'A method comprising administering an agent that reduces inflammation.', category: 'method' } as any),
    ])
    expect(findings).toHaveLength(0)
  })
})

describe('runClaimChallengeLint', () => {
  it('returns nothing for an empty claim set', () => {
    expect(runClaimChallengeLint([])).toEqual([])
    expect(runClaimChallengeLint(null)).toEqual([])
  })

  it('collects findings across checks', () => {
    const findings = runClaimChallengeLint([
      claim({ number: 1, text: 'A composition comprising a substantially pure Pep-B2 peptide.' }),
    ])
    const codes = new Set(findings.map(f => f.code))
    expect(codes.has('INDEFINITE_MODIFIER')).toBe(true)
    expect(codes.has('SOURCE_JARGON')).toBe(true)
  })
})

describe('findOptionalLanguage', () => {
  it('flags exemplary and optional wording', () => {
    const findings = findOptionalLanguage([
      claim({ number: 1, text: 'A device comprising a plate, optionally coated, such as with nickel.' }),
    ])
    expect(findings.map(f => f.message).join(' ')).toContain('optionally')
    expect(findings.map(f => f.message).join(' ')).toContain('such as')
    expect(findings.every(f => f.code === 'OPTIONAL_LANGUAGE')).toBe(true)
  })

  it('is quiet on definite wording', () => {
    expect(findOptionalLanguage([claim({ number: 1, text: 'A device comprising a nickel-coated plate.' })])).toHaveLength(0)
  })
})

describe('findTrademarks', () => {
  it('flags a mark symbol and a well-known mark name', () => {
    const findings = findTrademarks([
      claim({ number: 1, text: 'A liner comprising a Teflon layer bonded to a Zytel® base.' }),
    ])
    expect(findings.map(f => f.message).join(' ')).toContain('Teflon')
    expect(findings.map(f => f.message).join(' ')).toContain('Zytel')
    expect(findings).toHaveLength(2)
  })
})

describe('findOmnibusReferences', () => {
  it('flags a reference to the description or drawings', () => {
    const findings = findOmnibusReferences([
      claim({ number: 1, text: 'A device substantially as described herein.' }),
      claim({ number: 2, text: 'The device of claim 1, arranged as shown in Fig. 3.' }),
    ])
    expect(findings.map(f => f.claimNumber)).toEqual([1, 2])
  })

  it('does not mistake "as defined in claim 1" for an omnibus reference', () => {
    expect(findOmnibusReferences([claim({ number: 2, text: 'A method of operating the device as described in claim 1.' })])).toHaveLength(0)
  })
})

describe('findMultiSentenceClaims', () => {
  it('flags a claim with two sentences', () => {
    const findings = findMultiSentenceClaims([
      claim({ number: 1, text: 'A device comprising a plate. The plate is steel.' }),
    ])
    expect(findings).toHaveLength(1)
    expect(findings[0].code).toBe('MULTI_SENTENCE')
  })

  it('ignores abbreviations and decimals', () => {
    expect(findMultiSentenceClaims([
      claim({ number: 1, text: 'A device comprising a plate of 0.2 mm thickness, e.g. Steel, and a housing.' }),
    ])).toHaveLength(0)
  })
})

describe('findAndOr', () => {
  it('flags and/or', () => {
    expect(findAndOr([claim({ number: 1, text: 'A device comprising a plate and/or a rod.' })])).toHaveLength(1)
    expect(findAndOr([claim({ number: 1, text: 'A device comprising at least one of a plate and a rod.' })])).toHaveLength(0)
  })
})

describe('findMeansPlusFunction', () => {
  it('flags explicit means-for wording and a nonce placeholder', () => {
    const findings = findMeansPlusFunction([
      claim({ number: 1, text: 'A device comprising means for clamping a plate.' }),
      claim({ number: 2, text: 'The device of claim 1, further comprising a module for heating the plate.' }),
      claim({ number: 3, text: 'The device of claim 1, further comprising a resistive heater coupled to the plate.' }),
    ])
    expect(findings.map(f => f.claimNumber)).toEqual([1, 2])
  })
})

describe('referencedClaimNumbers', () => {
  it('parses single, range, list and preceding-claim forms', () => {
    expect(referencedClaimNumbers('The device of claim 1, wherein', 3, [1, 2, 3])).toEqual({ refs: [1], multiple: false })
    expect(referencedClaimNumbers('The device of any one of claims 1 to 3.', 4, [1, 2, 3, 4])).toEqual({ refs: [1, 2, 3], multiple: true })
    expect(referencedClaimNumbers('The device of claim 1 or 2.', 4, [1, 2, 3, 4])).toEqual({ refs: [1, 2], multiple: true })
    expect(referencedClaimNumbers('The device of claims 1, 2, or 3.', 4, [1, 2, 3, 4])).toEqual({ refs: [1, 2, 3], multiple: true })
    expect(referencedClaimNumbers('A device according to any of the preceding claims.', 4, [1, 2, 3, 4])).toEqual({ refs: [1, 2, 3], multiple: true })
    expect(referencedClaimNumbers('A device comprising a plate.', 1, [1])).toEqual({ refs: [], multiple: false })
  })
})

describe('findImproperDependencies', () => {
  it('flags a forward reference, a missing claim and a recorded mismatch', () => {
    const findings = findImproperDependencies([
      claim({ number: 1, text: 'A device comprising a plate.' }),
      claim({ number: 2, text: 'The device of claim 5, wherein the plate is steel.', dependsOn: 5 }),
      claim({ number: 3, text: 'The device of claim 9, wherein the plate is brass.', dependsOn: 9 }),
      claim({ number: 4, text: 'The device of claim 1, wherein the plate is copper.', dependsOn: 3 }),
    ])
    const byClaim = Object.fromEntries(findings.map(f => [f.claimNumber, f.message]))
    expect(byClaim[2]).toContain('not an earlier claim')
    expect(byClaim[3]).toContain('not an earlier claim')
    expect(byClaim[4]).toContain('recorded as depending on claim 3')
    expect(findings.every(f => f.code === 'IMPROPER_DEPENDENCY')).toBe(true)
  })

  it('flags a missing earlier claim', () => {
    const findings = findImproperDependencies([
      claim({ number: 1, text: 'A device comprising a plate.' }),
      claim({ number: 3, text: 'The device of claim 2, wherein the plate is steel.', dependsOn: 2 }),
    ])
    expect(findings).toHaveLength(1)
    expect(findings[0].message).toContain('does not exist')
  })

  it('flags a multiple dependent claim depending on another multiple dependent claim', () => {
    const findings = findImproperDependencies([
      claim({ number: 1, text: 'A device comprising a plate.' }),
      claim({ number: 2, text: 'The device of claim 1, further comprising a seal.' }),
      claim({ number: 3, text: 'The device of claim 1 or 2, wherein the plate is steel.' }),
      claim({ number: 4, text: 'The device of any one of claims 1 to 3, further comprising a housing.' }),
    ])
    const chain = findings.filter(f => f.code === 'MULTIPLE_DEPENDENT_CHAIN')
    expect(chain).toHaveLength(1)
    expect(chain[0].claimNumber).toBe(4)
    expect(chain[0].message).toContain('claim 3')
  })

  it('is quiet on a well-formed ladder', () => {
    expect(findImproperDependencies([
      claim({ number: 1, text: 'A device comprising a plate.' }),
      claim({ number: 2, text: 'The device of claim 1, wherein the plate is steel.', dependsOn: 1 }),
      claim({ number: 3, text: 'The device of claim 2, wherein the steel is stainless.', dependsOn: 2 }),
    ])).toHaveLength(0)
  })
})

describe('findDuplicateClaims', () => {
  it('flags a word-for-word duplicate', () => {
    const findings = findDuplicateClaims([
      claim({ number: 1, text: 'A device comprising a plate.' }),
      claim({ number: 2, text: 'The device of claim 1, wherein the plate is steel.' }),
      claim({ number: 3, text: 'The device of claim 1,  wherein the plate is steel.' }),
    ])
    expect(findings).toHaveLength(1)
    expect(findings[0].claimNumber).toBe(3)
    expect(findings[0].message).toContain('claim 2')
  })
})

describe('findNegativeLimitations', () => {
  it('flags an exclusion for support checking', () => {
    const findings = findNegativeLimitations([
      claim({ number: 1, text: 'A composition free of surfactant.' }),
      claim({ number: 2, text: 'The composition of claim 1, wherein the carrier is water.' }),
    ])
    expect(findings).toHaveLength(1)
    expect(findings[0].claimNumber).toBe(1)
    expect(findings[0].code).toBe('NEGATIVE_LIMITATION')
  })
})

describe('CLAIM_CHALLENGE_CHECKLIST', () => {
  it('covers the drafting best-practice families', () => {
    for (const item of [
      'CLAIM_FORM', 'DEPENDENCY', 'FUNCTIONAL_CLAIMING', 'OPTIONAL_LANGUAGE',
      'RANGES', 'CLAIM_SET_STRATEGY', 'REDUNDANCY', 'NEGATIVE_LIMITATION',
    ]) {
      expect(CLAIM_CHALLENGE_CHECKLIST).toContain(item)
    }
  })
})

describe('runClaimChallengeLint (claim form family)', () => {
  it('collects form findings alongside source-adherence findings', () => {
    const findings = runClaimChallengeLint([
      claim({ number: 1, text: 'A device comprising a substantially planar plate and/or a rod, optionally coated.' }),
      claim({ number: 2, text: 'The device of claim 4, wherein the plate is steel.', dependsOn: 4 }),
    ])
    const codes = new Set(findings.map(f => f.code))
    expect(codes.has('INDEFINITE_MODIFIER')).toBe(true)
    expect(codes.has('AND_OR')).toBe(true)
    expect(codes.has('OPTIONAL_LANGUAGE')).toBe(true)
    expect(codes.has('IMPROPER_DEPENDENCY')).toBe(true)
  })
})

describe('computeClaimsFingerprint', () => {
  it('is stable across whitespace changes', () => {
    const a = computeClaimsFingerprint([claim({ number: 1, text: 'A device comprising a plate.' })])
    const b = computeClaimsFingerprint([claim({ number: 1, text: '  A   device comprising a plate.  ' })])
    expect(a).toBe(b)
  })

  it('changes when claim text changes', () => {
    const a = computeClaimsFingerprint([claim({ number: 1, text: 'A device comprising a plate.' })])
    const b = computeClaimsFingerprint([claim({ number: 1, text: 'A device comprising a rod.' })])
    expect(a).not.toBe(b)
  })

  it('ignores claim ordering', () => {
    const a = computeClaimsFingerprint([
      claim({ number: 1, text: 'One.' }),
      claim({ number: 2, text: 'Two.' }),
    ])
    const b = computeClaimsFingerprint([
      claim({ number: 2, text: 'Two.' }),
      claim({ number: 1, text: 'One.' }),
    ])
    expect(a).toBe(b)
  })
})
