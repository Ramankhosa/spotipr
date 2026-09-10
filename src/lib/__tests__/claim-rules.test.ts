import { describe, expect, test } from 'vitest'
import type { DraftClaim } from '@/lib/draft-claims-parser'
import { inferClaimCategory } from '@/lib/draft-claims-parser'
import {
  CLAIM_RULE_DEFAULTS,
  ClaimRuleProfileSchema,
  buildClaimFormReport,
  claimFormReportMatches,
  normaliseClaimSet,
  renderJurisdictionClaimRulesBlock,
  renumberClaimReferences,
  resolveClaimRuleProfile,
  runOfficeFormLint,
  summariseNormalisation,
} from '@/lib/claim-rules'
import { computeClaimsSignature } from '@/lib/claims-signature'

const OFFICES = ['US', 'EP', 'PCT', 'IN', 'CN', 'JP', 'KR', 'UK', 'DE', 'AU', 'CA', 'BR', 'ZA', 'RU'] as const

function claim(number: number, text: string, extra: Partial<DraftClaim> = {}): DraftClaim {
  const dependent = /\b(?:of|according to|as claimed in)\s+claims?\s+\d/i.test(text.slice(0, 120))
  return { number, type: dependent ? 'dependent' : 'independent', text, category: inferClaimCategory(text), ...extra }
}

function rulesFor(code: string) {
  return resolveClaimRuleProfile(code).rules
}

function codes(findings: ReturnType<typeof runOfficeFormLint>) {
  return findings.map(finding => finding.code)
}

describe('claim rule defaults and resolution', () => {
  test('every built-in profile validates against the schema', () => {
    for (const code of OFFICES) {
      const parsed = ClaimRuleProfileSchema.safeParse(CLAIM_RULE_DEFAULTS[code])
      expect(parsed.success, `${code}: ${parsed.success ? '' : JSON.stringify(parsed.error.issues)}`).toBe(true)
    }
  })

  test('unknown offices resolve to the neutral profile, aliases to their target', () => {
    expect(resolveClaimRuleProfile('ZQ').generic).toBe(true)
    expect(resolveClaimRuleProfile('ZQ').rules.jurisdiction).toBe('ZQ')
    expect(resolveClaimRuleProfile('gb').rules.dependentClaimPhrase).toBe(rulesFor('UK').dependentClaimPhrase)
    expect(resolveClaimRuleProfile('WO').rules.jurisdiction).toBe('PCT')
  })

  test('legacy profile booleans overlay the defaults without breaking them', () => {
    const { rules, drift } = resolveClaimRuleProfile('US', {
      twoPartFormPreferred: false,
      allowMultipleDependent: false,
      prohibitMultipleDependentOnMultipleDependent: true,
      preferredConnectors: ['comprising'],
      discouragedConnectors: ['consisting of'],
      forbiddenPhrases: ['as shown in the drawings'],
      maxIndependentClaimsBeforeExtraFee: 3,
      maxTotalClaimsRecommended: 20,
      allowReferenceNumeralsInClaims: false,
      requireSupportInDescription: true,
      unityStandard: 'US_restriction_practice',
      feeModel: { extraFeeBasedOnIndependents: true, note: 'Excess claims cost money.' },
      notes: ['Note one', 'Note two'],
    })
    expect(drift).toEqual([])
    expect(rules.multipleDependencyMode).toBe('none')
    expect(rules.referenceNumerals).toBe('not_allowed')
    expect(rules.forbiddenPhrases).toEqual(['as shown in the drawings'])
    expect(rules.freeIndependentClaims).toBe(3)
    expect(rules.feeNote).toBe('Excess claims cost money.')
    expect(rules.unityStandard).toBe('US restriction practice')
    expect(rules.notes).toEqual(['Note one', 'Note two'])
  })

  test('the zero sentinel is not read as a fee threshold', () => {
    // AU/CA/ZA use 0 for "no excess fee"; KR uses 0 for "every claim costs".
    expect(resolveClaimRuleProfile('AU', { maxIndependentClaimsBeforeExtraFee: 0 }).rules.freeIndependentClaims).toBeNull()
    expect(resolveClaimRuleProfile('KR', { maxIndependentClaimsBeforeExtraFee: 0, feeModel: { perClaimFeeFromFirstClaim: true } }).rules.freeTotalClaims).toBe(0)
    // EP's 1 encodes Rule 43(2), not a fee, and is ignored for fees.
    expect(resolveClaimRuleProfile('EP', { maxIndependentClaimsBeforeExtraFee: 1, feeModel: { extraFeeBasedOnIndependents: false } }).rules.freeIndependentClaims).toBeNull()
  })

  test('structured overrides win, invalid values are reported as drift and ignored', () => {
    const { rules, drift } = resolveClaimRuleProfile('IN', {
      medicalMethodClaims: 'composition_only',
      crmClaimForm: 'banana',
      defaultClaimBudget: 12,
      freeTotalClaims: null,
    })
    expect(rules.medicalMethodClaims).toBe('composition_only')
    expect(rules.crmClaimForm).toBe('not_recommended')
    expect(rules.defaultClaimBudget).toBe(12)
    expect(rules.freeTotalClaims).toBeNull()
    expect(drift).toEqual([{ field: 'crmClaimForm', value: 'banana', reason: expect.stringContaining('not one of') }])
  })
})

describe('jurisdiction rules block', () => {
  test('is deterministic and carries no session data', () => {
    for (const code of OFFICES) {
      const a = renderJurisdictionClaimRulesBlock(rulesFor(code))
      const b = renderJurisdictionClaimRulesBlock(rulesFor(code))
      expect(a).toBe(b)
      expect(a.startsWith(`JURISDICTION CLAIM RULES (${code}`)).toBe(true)
      expect(a).toContain('FORM:')
      expect(a).toContain('ELIGIBILITY AND CATEGORY CONVERSIONS:')
      expect(a).toContain('COUNT AND FEES:')
    }
  })

  test('says the office-specific things that decide claim form', () => {
    expect(renderJurisdictionClaimRulesBlock(rulesFor('US'))).toContain('non-transitory computer-readable medium')
    expect(renderJurisdictionClaimRulesBlock(rulesFor('US'))).toContain('Use claims ("Use of X for Y") are not a permitted claim category')
    expect(renderJurisdictionClaimRulesBlock(rulesFor('EP'))).toContain('X for use in the treatment of Y')
    expect(renderJurisdictionClaimRulesBlock(rulesFor('EP'))).toContain('Rule 43(2) EPC')
    expect(renderJurisdictionClaimRulesBlock(rulesFor('IN'))).toContain('s.3(k)')
    expect(renderJurisdictionClaimRulesBlock(rulesFor('IN'))).toContain('as claimed in claim N')
    expect(renderJurisdictionClaimRulesBlock(rulesFor('CN'))).toContain('Swiss-type')
    expect(renderJurisdictionClaimRulesBlock(rulesFor('ZA'))).toContain('Omnibus claims are valid and customary')
    expect(renderJurisdictionClaimRulesBlock(rulesFor('KR'))).toContain('Every claim carries a fee from the first claim')
    expect(renderJurisdictionClaimRulesBlock(rulesFor('BR'))).toContain('caracterizado por')
  })
})

describe('office-form lint', () => {
  const useClaim = claim(1, 'Use of a berberine composition for treating gastric ulcers in a subject.')
  const treatment = claim(1, 'A method of treating gastric ulcers in a patient, the method comprising administering to the patient a bilayer tablet comprising berberine.')
  const swiss = claim(1, 'Use of berberine in the manufacture of a medicament for treating gastric ulcers.')
  const crm = claim(3, 'A computer-readable medium storing instructions that, when executed by a processor, cause the processor to perform the method of claim 1.')
  const program = claim(3, 'A computer program for performing the method of claim 1.')
  const method = claim(1, 'A method comprising: receiving sensor data from a soil moisture sensor; determining, by a controller, that the soil moisture is below 18 percent; and opening an irrigation valve.')
  const system = claim(2, 'A system comprising a soil moisture sensor, an irrigation valve and a controller configured to open the irrigation valve when the soil moisture sensor reports soil moisture below 18 percent.')

  test('use claims are blocked in the US and India, examined as methods in China, fine at the EPO', () => {
    expect(codes(runOfficeFormLint([useClaim], { rules: rulesFor('US') }))).toContain('USE_CLAIM')
    expect(runOfficeFormLint([useClaim], { rules: rulesFor('IN') }).find(f => f.code === 'USE_CLAIM')?.severity).toBe('block')
    expect(runOfficeFormLint([useClaim], { rules: rulesFor('CN') }).find(f => f.code === 'USE_CLAIM')?.severity).toBe('warn')
    expect(codes(runOfficeFormLint([useClaim], { rules: rulesFor('EP') }))).not.toContain('USE_CLAIM')
  })

  test('methods of treatment are blocked where excluded, mirrored for PCT, allowed in the US', () => {
    for (const code of ['EP', 'IN', 'JP', 'KR', 'CN', 'CA'] as const) {
      const finding = runOfficeFormLint([treatment], { rules: rulesFor(code) }).find(f => f.code === 'METHOD_OF_TREATMENT')
      expect(finding?.severity, code).toBe('block')
      expect(finding?.basis, code).toBeTruthy()
    }
    expect(runOfficeFormLint([treatment], { rules: rulesFor('PCT') }).find(f => f.code === 'METHOD_OF_TREATMENT')?.severity).toBe('warn')
    expect(codes(runOfficeFormLint([treatment], { rules: rulesFor('US') }))).not.toContain('METHOD_OF_TREATMENT')
  })

  test('Swiss-type wording is blocked at the EPO and in India but accepted in China', () => {
    expect(runOfficeFormLint([swiss], { rules: rulesFor('EP') }).find(f => f.code === 'SWISS_TYPE_FORM')?.severity).toBe('block')
    expect(codes(runOfficeFormLint([swiss], { rules: rulesFor('IN') }))).toContain('SWISS_TYPE_FORM')
    expect(codes(runOfficeFormLint([swiss], { rules: rulesFor('CN') }))).not.toContain('SWISS_TYPE_FORM')
    expect(codes(runOfficeFormLint([swiss], { rules: rulesFor('CN') }))).not.toContain('METHOD_OF_TREATMENT')
  })

  test('computer-readable medium and program forms follow the office', () => {
    const set = [method, system, crm]
    expect(runOfficeFormLint(set, { rules: rulesFor('US') }).find(f => f.code === 'CRM_NOT_NON_TRANSITORY')?.fix).toBe('auto')
    expect(codes(runOfficeFormLint(set, { rules: rulesFor('EP') }))).not.toContain('CRM_NOT_NON_TRANSITORY')
    expect(runOfficeFormLint(set, { rules: rulesFor('IN') }).find(f => f.code === 'CRM_FORM_NOT_RECOMMENDED')?.severity).toBe('warn')

    const withProgram = [method, system, program]
    expect(runOfficeFormLint(withProgram, { rules: rulesFor('EP') }).find(f => f.code === 'PROGRAM_PER_SE')?.severity).toBe('block')
    expect(runOfficeFormLint(withProgram, { rules: rulesFor('KR') }).find(f => f.code === 'PROGRAM_PER_SE')?.severity).toBe('block')
    expect(codes(runOfficeFormLint(withProgram, { rules: rulesFor('CN') }))).not.toContain('PROGRAM_PER_SE')
    const epProgram = claim(3, 'A computer program comprising instructions which, when the program is executed by a computer, cause the computer to carry out the method of claim 1.')
    expect(codes(runOfficeFormLint([method, system, epProgram], { rules: rulesFor('EP') }))).not.toContain('PROGRAM_PER_SE')
  })

  test('the same multiple dependency is a defect in the US and fine at the EPO', () => {
    const set = [
      claim(1, 'A dryer comprising a chamber and a flap.'),
      claim(2, 'The dryer of claim 1, wherein the flap is hinged.'),
      claim(3, 'The dryer of claim 1 or 2, wherein the chamber is insulated.'),
      claim(4, 'The dryer of claim 2 or 3, wherein the chamber has a drip ledge.'),
    ]
    const us = runOfficeFormLint(set, { rules: rulesFor('US') })
    expect(us.find(f => f.code === 'MULTIPLE_DEPENDENT_CHAIN')?.severity).toBe('block')
    const ep = runOfficeFormLint(set, { rules: rulesFor('EP') })
    expect(ep.find(f => f.code === 'MULTIPLE_DEPENDENT_CHAIN')?.severity).toBe('info')
    const conjunctive = [set[0], set[1], claim(3, 'The dryer of claims 1 and 2, wherein the chamber is insulated.')]
    expect(runOfficeFormLint(conjunctive, { rules: rulesFor('US') }).find(f => f.code === 'MULTIPLE_DEPENDENCY_FORM')?.fix).toBe('auto')
  })

  test('numbering gaps, missing antecedents and mismatched preambles are caught', () => {
    const set = [
      claim(1, 'A solar dryer comprising a drying chamber, a mesh sled and a humidity-swing flap.'),
      claim(3, 'The device of claim 1, wherein the chimney throat is narrowed.'),
    ]
    const findings = runOfficeFormLint(set, { rules: rulesFor('IN') })
    expect(codes(findings)).toContain('NUMBERING_GAP')
    expect(codes(findings)).toContain('PREAMBLE_NOUN_MISMATCH')
    expect(findings.find(f => f.code === 'ANTECEDENT_BASIS')?.message).toContain('the chimney throat')
    // Introduced elements are not flagged.
    const clean = [set[0], claim(2, 'The solar dryer as claimed in claim 1, wherein the mesh sled is removable.')]
    expect(codes(runOfficeFormLint(clean, { rules: rulesFor('IN') }))).not.toContain('ANTECEDENT_BASIS')
    expect(codes(runOfficeFormLint(clean, { rules: rulesFor('IN') }))).not.toContain('PREAMBLE_NOUN_MISMATCH')
  })

  test('EPO one-independent-per-category and unity checks', () => {
    const set = [
      claim(1, 'A pump controller comprising a thermal model unit coupled to a speed command generator.'),
      claim(2, 'A pump controller comprising a housing and a display.'),
      claim(3, 'A bicycle saddle comprising a rail and a cushion.'),
    ]
    const ep = runOfficeFormLint(set, { rules: rulesFor('EP') })
    expect(ep.find(f => f.code === 'INDEPENDENT_PER_CATEGORY_EXCEEDED' && f.claimNumber === 2)?.severity).toBe('block')
    expect(codes(ep)).toContain('UNITY_BREAK')
    expect(codes(runOfficeFormLint(set, { rules: rulesFor('US') }))).not.toContain('INDEPENDENT_PER_CATEGORY_EXCEEDED')
  })

  test('fee thresholds and India pharmaceutical hooks are informational', () => {
    const many = Array.from({ length: 12 }, (_, index) => index === 0
      ? claim(1, 'A composition comprising berberine and sodium bicarbonate.')
      : claim(index + 1, `The composition as claimed in claim 1, wherein the sodium bicarbonate has property ${index}.`))
    const inFindings = runOfficeFormLint(many, { rules: rulesFor('IN') })
    expect(inFindings.find(f => f.code === 'CLAIM_COUNT_OVER_FREE')?.message).toContain('12 claims')
    expect(codes(inFindings)).toContain('INDIAN_3E_ADMIXTURE')
    const salt = claim(1, 'A crystalline salt of berberine having a melting point of 120 degrees.')
    expect(codes(runOfficeFormLint([salt], { rules: rulesFor('IN') }))).toContain('INDIAN_3D_FORM')
    expect(codes(runOfficeFormLint([salt], { rules: rulesFor('US') }))).not.toContain('INDIAN_3D_FORM')
  })

  test('software claims without hardware are flagged only for software inventions', () => {
    const abstract = claim(1, 'A method comprising: receiving a request; ranking candidate offers by expected margin; and selecting the highest-ranked offer.')
    expect(codes(runOfficeFormLint([abstract], { rules: rulesFor('IN'), context: { inventionType: ['SOFTWARE'] } }))).toContain('ELIGIBILITY_TECHNICAL_ANCHOR')
    expect(codes(runOfficeFormLint([abstract], { rules: rulesFor('IN'), context: { inventionType: ['MECHANICAL'] } }))).not.toContain('ELIGIBILITY_TECHNICAL_ANCHOR')
    expect(codes(runOfficeFormLint([method], { rules: rulesFor('US'), context: { inventionType: ['SOFTWARE'] } }))).not.toContain('ELIGIBILITY_TECHNICAL_ANCHOR')
  })

  test('unsupported numbers need the source text, omnibus depends on the office', () => {
    const numeric = claim(1, 'A dryer comprising eight warm-keeper blocks, each of 350 g, tilted at 26 degrees and a 99 mm weep hole.')
    const source = 'The dryer uses 8 blocks of 350 g at a 26 deg tilt and a 3 mm weep hole.'
    const findings = runOfficeFormLint([numeric], { rules: rulesFor('IN'), context: { sourceText: source } })
    const flagged = findings.filter(f => f.code === 'UNSUPPORTED_NUMBER').map(f => f.message).join(' ')
    expect(flagged).toContain('"99"')
    expect(flagged).not.toContain('"350"')
    expect(flagged).not.toContain('"26"')

    const omnibus = claim(2, 'A dryer substantially as herein described with reference to the accompanying drawings.')
    expect(runOfficeFormLint([claim(1, 'A dryer comprising a chamber.'), omnibus], { rules: rulesFor('UK') }).find(f => f.code === 'OMNIBUS_REFERENCE')?.severity).toBe('block')
    expect(codes(runOfficeFormLint([claim(1, 'A dryer comprising a chamber.'), omnibus], { rules: rulesFor('ZA') }))).not.toContain('OMNIBUS_REFERENCE')
    expect(codes(runOfficeFormLint([claim(1, 'A dryer comprising a chamber.')], { rules: rulesFor('ZA') }))).toContain('OMNIBUS_CLAIM_EXPECTED')
  })

  test('findings are ordered by severity and carry stable ids', () => {
    const set = [
      claim(1, 'a dryer comprising a chamber and preferably a flap'),
      claim(2, 'The dryer of claim 1, wherein the flap is substantially planar.'),
    ]
    const findings = runOfficeFormLint(set, { rules: rulesFor('US') })
    expect(findings[0].id).toBe('F1')
    expect(findings.map(f => f.severity)).toEqual([...findings.map(f => f.severity)].sort((a, b) => ['block', 'warn', 'info'].indexOf(a) - ['block', 'warn', 'info'].indexOf(b)))
    expect(findings.every(f => f.basis && f.jurisdiction === 'US')).toBe(true)
  })

  test('every finding carries a legal basis, never its own code', () => {
    const set = [
      claim(1, 'A dryer comprising a chamber and a flap made of Teflon.'),
      claim(2, 'The dryer of claim 1, wherein the flap is hinged and/or sprung.'),
      claim(3, 'The dryer of claim 1 or 2, wherein the chamber is insulated. It is also vented.'),
      claim(4, 'The dryer of claim 2 or 3, wherein the chamber is free of metal, as shown in the drawings.'),
      claim(5, 'A dryer comprising a chamber and a flap made of Teflon.'),
    ]
    for (const code of ['US', 'EP', 'IN', 'JP']) {
      for (const finding of runOfficeFormLint(set, { rules: rulesFor(code) })) {
        expect(finding.basis, `${code} ${finding.code}`).toBeTruthy()
        expect(finding.basis, `${code} ${finding.code}`).not.toBe(finding.code)
      }
    }
  })
})

describe('claim-set normaliser', () => {
  test('renumbers, reorders and rewrites references after a gap', () => {
    const set = [
      claim(1, 'A dryer comprising a chamber.'),
      claim(5, 'The dryer of claim 1, wherein the chamber is insulated.'),
      claim(7, 'The dryer of claim 5, wherein the insulation is coir.'),
    ]
    const { claims, changes } = normaliseClaimSet(set, rulesFor('US'))
    expect(claims.map(c => c.number)).toEqual([1, 2, 3])
    expect(claims[2].text).toBe('The dryer of claim 2, wherein the insulation is coir.')
    expect(claims[2].dependsOn).toBe(2)
    expect(changes.some(change => change.code === 'NUMBERING_GAP')).toBe(true)
    expect(summariseNormalisation(changes)).toContain('renumbered')
  })

  test('moves a dependent that precedes its parent and rewrites in-text references', () => {
    const set = [
      claim(1, 'The dryer of claim 2, wherein the flap is hinged.'),
      claim(2, 'A dryer comprising a chamber and a flap.'),
    ]
    const { claims } = normaliseClaimSet(set, rulesFor('EP'))
    expect(claims[0].text).toBe('A dryer comprising a chamber and a flap.')
    expect(claims[1].text).toBe('The dryer according to claim 1, wherein the flap is hinged.')
    expect(renumberClaimReferences('as in claims 2 to 4 or 6', new Map([[2, 1], [4, 3], [6, 5]]))).toBe('as in claims 1 to 3 or 5')
  })

  test('applies the office phrasing, the parent noun, closed Markush and non-transitory', () => {
    const set = [
      claim(1, 'A solar dryer comprising a chamber and a flap selected from the group comprising steel and wood.'),
      claim(2, 'The device according to claim 1, wherein the flap is hinged'),
      claim(3, 'A computer-readable medium storing instructions for controlling the solar dryer of claim 1.'),
    ]
    const us = normaliseClaimSet(set, rulesFor('US')).claims
    expect(us[0].text).toContain('group consisting of')
    expect(us[1].text).toBe('The solar dryer of claim 1, wherein the flap is hinged.')
    expect(us[2].text.startsWith('A non-transitory computer-readable medium')).toBe(true)
    expect(us[2].category).toBe('medium')

    const india = normaliseClaimSet(set, rulesFor('IN')).claims
    expect(india[1].text).toBe('The solar dryer as claimed in claim 1, wherein the flap is hinged.')
    expect(india[2].text.startsWith('A computer-readable medium')).toBe(true)

    const ep = normaliseClaimSet([claim(1, 'A dryer characterized in that it has a flap.'), claim(2, 'The dryer of claims 1 and 3, wherein the flap is hinged.'), claim(3, 'The dryer of claim 1, wherein the flap is wooden.')], rulesFor('EP')).claims
    expect(ep[0].text).toBe('A dryer characterised in that it has a flap.')
    expect(ep[1].text).toBe('The dryer according to claim 1, wherein the flap is wooden.')
  })

  test('puts a conjunctive multiple dependency in the alternative where the office requires it', () => {
    const set = [
      claim(1, 'A dryer comprising a chamber.'),
      claim(2, 'The dryer of claim 1, wherein the chamber is insulated.'),
      claim(3, 'The dryer of claims 1 and 2, wherein the chamber has a lid.'),
    ]
    expect(normaliseClaimSet(set, rulesFor('US')).claims[2].text).toBe('The dryer of claims 1 or 2, wherein the chamber has a lid.')
    expect(normaliseClaimSet(set, rulesFor('EP')).claims[2].text).toBe('The dryer according to claims 1 and 2, wherein the chamber has a lid.')
  })

  test('is idempotent and leaves non-English sets alone apart from structure', () => {
    const set = [
      claim(1, 'A dryer comprising a chamber.'),
      claim(2, 'The dryer of claim 1, wherein the chamber is insulated.'),
    ]
    const once = normaliseClaimSet(set, rulesFor('US'))
    const twice = normaliseClaimSet(once.claims, rulesFor('US'))
    expect(twice.changes).toEqual([])
    expect(twice.claims).toEqual(once.claims)

    const portuguese = [claim(1, 'Secador caracterizado por compreender uma câmara'), claim(2, 'Secador de acordo com a reivindicação 1, caracterizado por a câmara ser isolada')]
    const br = normaliseClaimSet(portuguese, rulesFor('BR'))
    expect(br.claims[0].text).toBe('Secador caracterizado por compreender uma câmara.')
    expect(br.claims[1].text).toBe('Secador de acordo com a reivindicação 1, caracterizado por a câmara ser isolada.')
  })

  test('drops exact duplicates and repoints their dependents', () => {
    const set = [
      claim(1, 'A dryer comprising a chamber.'),
      claim(2, 'A dryer comprising a chamber.'),
      claim(3, 'The dryer of claim 2, wherein the chamber is insulated.'),
    ]
    const { claims } = normaliseClaimSet(set, rulesFor('US'))
    expect(claims).toHaveLength(2)
    expect(claims[1].text).toBe('The dryer of claim 1, wherein the chamber is insulated.')
  })
})

describe('terminology map and jargon handling', () => {
  const jargon = [
    claim(1, 'A composition comprising: (i) a Pep-B2; (ii) a delivery vehicle comprising DSPC; and (iii) a payload encapsulated in the delivery vehicle, wherein the delivery vehicle encapsulates the payload to form the composition.'),
    claim(2, 'The composition of claim 1, wherein the Pep-B2 has the sequence KLVFF-RGD-PEG2000 and is high-fidelity.'),
  ]
  const terminology = [
    { element: 'peptide', claimTerm: 'a cell-penetrating peptide', inventorTerm: 'Pep-B2', retainInDependent: false },
    { element: 'carrier', claimTerm: 'lipid nanoparticle', inventorTerm: 'delivery vehicle', retainInDependent: false },
    { element: 'cargo', claimTerm: 'therapeutic agent', inventorTerm: 'payload', retainInDependent: false },
  ]

  test('substitutes inventor terms in independent claims only, fixing the article', () => {
    const { claims, changes } = normaliseClaimSet(jargon, rulesFor('US'), { terminology, fidelityMode: 'STRUCTURE_ONLY' })
    expect(claims[0].text).toContain('(i) a cell-penetrating peptide;')
    expect(claims[0].text).toContain('a lipid nanoparticle comprising DSPC')
    expect(claims[0].text).toContain('a therapeutic agent encapsulated in the lipid nanoparticle')
    expect(claims[0].text).not.toMatch(/Pep-B2|delivery vehicle|payload/)
    expect(claims[1].text).toContain('the Pep-B2')
    expect(changes.filter(c => c.code === 'TERMINOLOGY_MAP')).toHaveLength(3)
    expect(claims).toHaveLength(2)
  })

  test('PRESERVE mode keeps the inventor term alive in a dependent claim', () => {
    const only = [claim(1, 'A composition comprising a Pep-B2 and a carrier.')]
    const { claims, changes } = normaliseClaimSet(only, rulesFor('IN'), { terminology, fidelityMode: 'PRESERVE' })
    expect(claims[0].text).toBe('A composition comprising a cell-penetrating peptide and a carrier.')
    expect(claims).toHaveLength(2)
    expect(claims[1].text).toBe('The composition as claimed in claim 1, wherein the cell-penetrating peptide is Pep-B2.')
    expect(claims[1].dependsOn).toBe(1)
    expect(changes.some(c => c.code === 'TERMINOLOGY_RETAINED')).toBe(true)
  })

  test('confirmed jargon blocks in an independent claim, warns in a dependent; sequence conflation and indefinite modifiers block', () => {
    // The strategy confirms which terms are the inventor's own; without that
    // list the shape test alone never blocks (see the nomenclature suite).
    const context = { confirmedJargon: ['Pep-B2'] }
    const findings = runOfficeFormLint(jargon, { rules: rulesFor('US'), context })
    expect(findings.find(f => f.code === 'SOURCE_JARGON' && f.claimNumber === 1)?.severity).toBe('block')
    expect(findings.find(f => f.code === 'SOURCE_JARGON' && f.claimNumber === 2)?.severity).toBe('warn')
    expect(findings.find(f => f.code === 'SEQUENCE_CONFLATION')?.severity).toBe('block')
    expect(findings.find(f => f.code === 'INDEFINITE_MODIFIER')?.severity).toBe('block')
  })

  test('a closing clause that restates the preamble is a tautology', () => {
    const findings = runOfficeFormLint(jargon, { rules: rulesFor('US') })
    const tautology = findings.find(f => f.code === 'TAUTOLOGY')
    expect(tautology?.claimNumber).toBe(1)
    expect(tautology?.message).toContain('to form the composition')
    const clean = [claim(1, 'A composition comprising a peptide and a carrier, wherein the peptide is bonded to the carrier.')]
    expect(codes(runOfficeFormLint(clean, { rules: rulesFor('US') }))).not.toContain('TAUTOLOGY')
  })
})

describe('experimental parameters and nomenclature', () => {
  const apoe = [
    claim(1, 'A targeted lipid nanoparticle composition comprising: (i) a lipid nanoparticle having a PEG-lipid conjugated to a synthetic transferrin receptor 1-binding peptide; and (ii) mRNA encoding an adenine base editor ABE8e.'),
    claim(2, 'The targeted lipid nanoparticle composition as claimed in claim 1, wherein the peptide selectively binds transferrin receptor 1 on brain endothelial cells.'),
    claim(3, 'The targeted lipid nanoparticle composition as claimed in claim 1, wherein, upon intravenous injection at 1.5 mg/kg in a group of eight transgenic APOE4 mice, the composition has, at 14 days after injection, a biodistribution of 14.8% of an injected dose in brain tissue.'),
    claim(4, 'The targeted lipid nanoparticle composition as claimed in claim 3, wherein the composition provides less than 0.1% off-target editing at five sites identified by Cas-OFFinder as top off-target sites.'),
  ]

  test('experimental protocol in a composition claim blocks, naming what it found', () => {
    const findings = runOfficeFormLint(apoe, { rules: rulesFor('IN') })
    const three = findings.find(f => f.code === 'EXPERIMENTAL_PARAMETER' && f.claimNumber === 3)
    expect(three?.severity).toBe('block')
    expect(three?.message).toContain('a test cohort')
    expect(three?.message).toContain('a measurement timepoint')
    expect(three?.message).toContain('an administration protocol')
    expect(findings.find(f => f.code === 'EXPERIMENTAL_PARAMETER' && f.claimNumber === 4)?.message).toContain('a named measurement tool')
    // Claims that state only structure are untouched.
    expect(findings.filter(f => f.code === 'EXPERIMENTAL_PARAMETER').map(f => f.claimNumber)).toEqual([3, 4])
  })

  test('a method claim may recite its own protocol', () => {
    const method = [claim(1, 'A method of assaying a composition, comprising injecting the composition at 1.5 mg/kg into a group of eight transgenic mice and measuring biodistribution at 14 days after injection.')]
    expect(codes(runOfficeFormLint(method, { rules: rulesFor('US') }))).not.toContain('EXPERIMENTAL_PARAMETER')
  })

  test('scientific nomenclature is not treated as inventor jargon', () => {
    // Without a confirmed list, shape-based hits never block.
    const open = runOfficeFormLint(apoe, { rules: rulesFor('IN') })
    expect(open.filter(f => f.code === 'SOURCE_JARGON' && f.severity === 'block')).toHaveLength(0)
    // With one, only the inventor's own coinage is reported at all.
    const confirmed = runOfficeFormLint(apoe, { rules: rulesFor('IN'), context: { confirmedJargon: ['Pep-B2'] } })
    expect(codes(confirmed)).not.toContain('SOURCE_JARGON')
    const coined = [claim(1, 'A composition comprising a Pep-B2 peptide and a carrier.')]
    const hit = runOfficeFormLint(coined, { rules: rulesFor('IN'), context: { confirmedJargon: ['Pep-B2'] } }).find(f => f.code === 'SOURCE_JARGON')
    expect(hit?.severity).toBe('block')
  })

  test('a properly introduced element is not reported as missing antecedent basis', () => {
    const findings = runOfficeFormLint(apoe, { rules: rulesFor('IN') })
    expect(findings.filter(f => f.code === 'ANTECEDENT_BASIS' && f.claimNumber === 2)).toHaveLength(0)
    // A genuinely undefined element still is.
    const missing = [claim(1, 'A dryer comprising a chamber.'), claim(2, 'The dryer as claimed in claim 1, wherein the chimney throat is narrowed.')]
    expect(codes(runOfficeFormLint(missing, { rules: rulesFor('IN') }))).toContain('ANTECEDENT_BASIS')
  })
})

describe('the shared persistence pipeline', () => {
  // Guards the composition that prepareClaimSet runs for every claim write.
  // Before it existed, an amendment applied from either refinement stage kept
  // whatever the model produced and left the stored report describing the
  // previous claims, so the office-form panel silently disappeared.
  test('an amendment with a numbering gap and a forbidden dependency is repaired, and the report matches the result', () => {
    const amended = [
      claim(1, 'A dryer comprising a chamber and a flap.'),
      claim(3, 'The dryer of claim 1, wherein the flap is hinged.'),
      claim(5, 'The dryer of claims 1 and 3, wherein the chamber is insulated.'),
    ]
    const rules = rulesFor('US')
    const { claims: normalised, changes } = normaliseClaimSet(amended, rules)
    const findings = runOfficeFormLint(normalised, { rules })
    const report = buildClaimFormReport({ claims: normalised, rules, findings, normalisation: changes })

    expect(normalised.map(c => c.number)).toEqual([1, 2, 3])
    expect(normalised[2].text).toBe('The dryer of claims 1 or 2, wherein the chamber is insulated.')
    expect(summariseNormalisation(changes)).toContain('renumbered')
    // The stored report must describe the claims that were actually written,
    // or the panel hides itself.
    expect(claimFormReportMatches(report, normalised)).toBe(true)
    expect(claimFormReportMatches(report, amended)).toBe(false)
    expect(report.normalisation.length).toBeGreaterThan(0)
  })

  test('a report-only refresh leaves approved text untouched', () => {
    // The freeze path passes normalise:false for exactly this reason.
    const approved = [
      claim(1, 'A dryer comprising a chamber and a flap.'),
      claim(3, 'The device of claim 1, wherein the flap is hinged.'),
    ]
    const rules = rulesFor('US')
    const findings = runOfficeFormLint(approved, { rules })
    const report = buildClaimFormReport({ claims: approved, rules, findings, normalisation: [] })
    expect(claimFormReportMatches(report, approved)).toBe(true)
    expect(codes(findings)).toContain('NUMBERING_GAP')
    expect(codes(findings)).toContain('PREAMBLE_NOUN_MISMATCH')
  })
})

describe('claim form report', () => {
  test('carries a client-computable signature that detects edits', () => {
    const set = [claim(1, 'A dryer comprising a chamber.')]
    const rules = rulesFor('US')
    const report = buildClaimFormReport({ claims: set, rules, findings: runOfficeFormLint(set, { rules }) })
    expect(report.claimsSignature).toBe(computeClaimsSignature(set))
    expect(claimFormReportMatches(report, set)).toBe(true)
    expect(claimFormReportMatches(report, [claim(1, 'A dryer comprising a chamber and a lid.')])).toBe(false)
    expect(report.counts).toEqual({ total: 1, independent: 1, freeTotal: 20, freeIndependent: 3 })
  })
})

describe('claim category inference', () => {
  test('recognises the new statutory forms from the preamble', () => {
    expect(inferClaimCategory('Use of a compound for treating gout.')).toBe('use')
    expect(inferClaimCategory('A non-transitory computer-readable medium storing instructions.')).toBe('medium')
    expect(inferClaimCategory('A computer program product comprising instructions.')).toBe('program')
    expect(inferClaimCategory('A kit comprising a syringe and a vial.')).toBe('kit')
    expect(inferClaimCategory('A compound of formula I.')).toBe('compound')
    expect(inferClaimCategory('A pharmaceutical composition comprising a compound of formula I.')).toBe('composition')
    expect(inferClaimCategory('A method of using a compound.')).toBe('method')
    expect(inferClaimCategory('The system of claim 1, wherein the memory storing the data is volatile.')).toBe('system')
  })
})
