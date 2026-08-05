import { describe, it, expect } from 'vitest'
import { checkQuotations, checkAuthorities, checkQuantitativeClaims, type EvidenceSource } from '../prose-evidence'
import { findContradictions } from '../contradiction-lint'
import { allProfileAuthorities, authoritiesFor } from '../objection-doctrine'

/**
 * Evidence checks over the filed prose.
 *
 * These are calibrated for PRECISION: a check that fires on a correct reply gets
 * switched off, and then catches nothing. So every checker here is tested twice
 * — once that it catches the real failure, once that it stays silent on
 * legitimate drafting.
 */

const D1_TEXT = `A plant expression vector is provided. The CaMV 35S promoter drives constitutive
expression throughout the plant body, including in leaf and root tissue. The construct further
comprises a selectable marker conferring resistance to kanamycin.`

const SPEC_TEXT = `[0038] In a preferred embodiment the phaseolin promoter is operably linked to the
gene, restricting expression to developing seed. Seed-specific expression avoids the metabolic
burden associated with constitutive systems. Expression was elevated approximately three-fold
relative to the constitutive control.`

const SOURCES: EvidenceSource[] = [
  { label: 'D1', text: D1_TEXT },
  { label: 'the specification as filed', text: SPEC_TEXT }
]

const section = (text: string) => [{ where: 'objection 3', text }]

describe('quotations must exist in a document on file', () => {
  it('a fabricated quote attributed to a cited document blocks', () => {
    const findings = checkQuotations(
      section('D1 states that "the phaseolin promoter restricts expression to developing seed tissue".'),
      SOURCES
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].status).toBe('fail')
    expect(findings[0].detail).toContain('D1')
  })

  it('a genuine quote of that document passes', () => {
    const findings = checkQuotations(
      section('D1 states that "the CaMV 35S promoter drives constitutive expression throughout the plant body".'),
      SOURCES
    )
    expect(findings).toHaveLength(0)
  })

  it('a quote of the specification passes without being attributed to a D-label', () => {
    const findings = checkQuotations(
      section('The specification provides that "the phaseolin promoter is operably linked to the gene".'),
      SOURCES
    )
    expect(findings).toHaveLength(0)
  })

  it('an unlocatable quote with no attribution warns rather than blocks', () => {
    // A quotation from case law cannot be checked against anything on file.
    const findings = checkQuotations(
      section('It was observed that "an invention must not be obvious to a person skilled in the art".'),
      SOURCES
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].status).toBe('warn')
  })

  it('quoted claim terms are not treated as quotations of a document', () => {
    // Replies put terms of art in quotes constantly; flagging them is noise.
    const findings = checkQuotations(
      section('The term "operably linked" appears in claim 1, and "comprising" is open-ended.'),
      SOURCES
    )
    expect(findings).toHaveLength(0)
  })

  it('the check is skipped, not passed, when nothing is on file', () => {
    expect(checkQuotations(section('D1 states "anything at all whatsoever here".'), [])).toHaveLength(0)
  })
})

describe('authorities must be whitelisted by the jurisdiction', () => {
  const allowed = [
    { name: 'Biswanath Prasad Radhey Shyam v. Hindustan Metal Industries', citation: 'AIR 1982 SC 1444' }
  ]

  it('a US authority in an Indian reply blocks', () => {
    // The failure this exists for: models reach for US case law regardless of
    // what the prompt says, because that is what they are trained on.
    const findings = checkAuthorities(
      section('As held in KSR v. Teleflex, a combination absent motivation cannot render a claim obvious.'),
      allowed
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].status).toBe('fail')
    expect(findings[0].detail).toContain('KSR')
  })

  it('the whitelisted authority passes', () => {
    expect(checkAuthorities(
      section('As held in Biswanath Prasad Radhey Shyam v. Hindustan Metal Industries, the test is…'),
      allowed
    )).toHaveLength(0)
  })

  it('a short-form citation of the same case still passes', () => {
    expect(checkAuthorities(
      section('Following Biswanath Prasad v. Hindustan Metal, the claimed advance is not obvious.'),
      allowed
    )).toHaveLength(0)
  })

  it('ordinary prose is not mistaken for a case name', () => {
    expect(checkAuthorities(
      section('The Applicant submits that the objection may kindly be waived. The invention differs from D1.'),
      allowed
    )).toHaveLength(0)
  })

  it('citing any authority blocks when the jurisdiction whitelists none', () => {
    const findings = checkAuthorities(section('As held in KSR v. Teleflex, the claim is obvious.'), [])
    expect(findings[0].status).toBe('fail')
    expect(findings[0].detail).toContain('no case law is whitelisted')
  })
})

describe('figures asserted in the reply must appear on the record', () => {
  it('an invented technical effect blocks', () => {
    const findings = checkQuantitativeClaims(
      section('The claimed construct achieves a 40% improvement in seed yield.'),
      SOURCES
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].status).toBe('fail')
  })

  it('a figure that IS in the specification passes', () => {
    expect(checkQuantitativeClaims(
      section('Expression was elevated approximately three-fold relative to the control.'),
      SOURCES
    )).toHaveLength(0)
  })

  it('claim and paragraph numbers are not read as technical figures', () => {
    // Legal prose is full of bare numbers; flagging them would bury the finding.
    expect(checkQuantitativeClaims(
      section('Claims 1 to 8 are amended. Support appears at paragraph [0038] and in Section 2(1)(ja).'),
      SOURCES
    )).toHaveLength(0)
  })

  it('the check is skipped, not passed, when nothing is on file', () => {
    expect(checkQuantitativeClaims(section('a 40% improvement'), [])).toHaveLength(0)
  })
})

describe('absence asserted against a document not fully on file', () => {
  const facts = [
    { citationLabel: 'D1', claimNumber: 1, feature: 'a phaseolin promoter operably linked to the gene', verdict: 'NOT_FOUND' },
    { citationLabel: 'D2', claimNumber: 1, feature: 'a phaseolin promoter operably linked to the gene', verdict: 'UNKNOWN_DOCUMENT_INCOMPLETE' }
  ]

  it('blocks even when the sentence names two documents', () => {
    // Was: naming two documents dropped confidence to MEDIUM, so the single most
    // common shape of this error ("neither D1 nor D2 discloses X", where D2 is
    // only an abstract on file) went out as an advisory warning.
    const found = findContradictions({
      sections: [{ where: 'objection 3', text: 'Neither D1 nor D2 discloses a phaseolin promoter operably linked to the gene.' }],
      facts
    })
    const unknown = found.filter(f => f.verdict === 'UNKNOWN_DOCUMENT_INCOMPLETE')
    expect(unknown.length).toBeGreaterThan(0)
    expect(unknown.every(f => f.blocking)).toBe(true)
  })

  it('an absence claim about the document we DID read is not itself blocked by this rule', () => {
    const found = findContradictions({
      sections: [{ where: 'objection 3', text: 'D1 does not disclose a phaseolin promoter operably linked to the gene.' }],
      facts
    })
    // NOT_FOUND survived the full-document scan — this assertion is grounded.
    expect(found.filter(f => f.citationLabels.includes('D1') && f.verdict === 'NOT_FOUND')).toHaveLength(0)
  })
})

describe('the authority list feeding the prompt is the list feeding the check', () => {
  const profile: any = {
    objections: [
      { canonical: 'INVENTIVE_STEP', doctrine: 'obviousness', caseLawWhitelist: [{ name: 'Biswanath Prasad v. Hindustan Metal' }] },
      { canonical: 'ELIGIBILITY', caseLawWhitelist: [{ name: 'Ferid Allani v. Union of India' }] }
    ],
    doctrines: { obviousness: { steps: ['x'], leadingCases: [{ name: 'Windsurfing International v. Tabur Marine' }] } }
  }

  it('per-objection scoping includes the doctrine cases', () => {
    const names = authoritiesFor(profile, { canonicalCode: 'INVENTIVE_STEP' }).map(a => a.name)
    expect(names).toContain('Biswanath Prasad v. Hindustan Metal')
    expect(names).toContain('Windsurfing International v. Tabur Marine')
  })

  it('the profile-wide list is used for the check, so a neighbouring objection’s case is not a false positive', () => {
    const all = allProfileAuthorities(profile).map(a => a.name)
    expect(all).toContain('Ferid Allani v. Union of India')
    expect(checkAuthorities(
      section('Following Ferid Allani v. Union of India, the subject matter is patentable.'),
      allProfileAuthorities(profile)
    )).toHaveLength(0)
  })
})
