import { describe, expect, test } from 'vitest'
import type { DraftClaim } from '@/lib/draft-claims-parser'
import { resolveClaimRuleProfile, renderJurisdictionClaimRulesBlock, runOfficeFormLint } from '@/lib/claim-rules'
import type { OfficeFormFinding } from '@/lib/claim-rules/types'
import { buildClaimFormRepairPrompt, guardRepairMerge, selectRepairFindings, MAX_REPAIR_FINDINGS } from '@/lib/claim-rules/repair'

function finding(partial: Partial<OfficeFormFinding> & { code: string }): OfficeFormFinding {
  return {
    id: 'F0', severity: 'block', fix: 'llm', claimNumber: 1, excerpt: '', message: 'm', basis: 'b', jurisdiction: 'IN',
    ...partial,
  }
}

const claims: DraftClaim[] = [
  { number: 1, type: 'independent', category: 'use', text: 'Use of a berberine composition for treating gastric ulcers in a subject.' },
  { number: 2, type: 'dependent', dependsOn: 1, category: 'use', text: 'The use as claimed in claim 1, wherein the composition is a bilayer tablet comprising melt-lock granules and a gas-nest layer.' },
]

describe('repair finding selection', () => {
  test('keeps blocking findings the model can cure, one per code and claim, capped', () => {
    const findings = [
      finding({ id: 'F1', code: 'USE_CLAIM' }),
      finding({ id: 'F2', code: 'USE_CLAIM' }),
      finding({ id: 'F3', code: 'CRM_NOT_NON_TRANSITORY', fix: 'auto' }),
      finding({ id: 'F4', code: 'INDEFINITE_MODIFIER', severity: 'warn' }),
      finding({ id: 'F5', code: 'CLAIM_COUNT_OVER_FREE', severity: 'info', fix: 'manual', claimNumber: null }),
      ...Array.from({ length: 20 }, (_, index) => finding({ id: `F${10 + index}`, code: 'ANTECEDENT_BASIS', claimNumber: index + 2 })),
    ]
    const selected = selectRepairFindings(findings)
    expect(selected.map(f => f.id)).toContain('F1')
    expect(selected.map(f => f.id)).not.toContain('F2')
    expect(selected.map(f => f.id)).not.toContain('F3')
    expect(selected.map(f => f.id)).not.toContain('F4')
    expect(selected.map(f => f.id)).not.toContain('F5')
    expect(selected.length).toBe(MAX_REPAIR_FINDINGS)
  })
})

describe('repair merge guards', () => {
  const useFinding = [finding({ id: 'F1', code: 'USE_CLAIM' })]

  test('allows a category conversion the findings justify', () => {
    const after: DraftClaim[] = [
      { number: 1, type: 'independent', category: 'method', text: 'A method of treating gastric ulcers in a subject, comprising administering a berberine composition to the subject.' },
      claims[1],
    ]
    expect(guardRepairMerge({ before: claims, after, findings: useFinding, changedClaimNumbers: [1], fidelityMode: 'STRUCTURE_ONLY' })).toBeNull()
  })

  test('refuses when independent claims appear without a finding to justify them', () => {
    const after: DraftClaim[] = [
      claims[0],
      { number: 2, type: 'independent', category: 'composition', text: 'A composition comprising berberine and a gas-generating layer of sodium bicarbonate.' },
    ]
    expect(guardRepairMerge({ before: claims, after, findings: [finding({ id: 'F1', code: 'ANTECEDENT_BASIS', claimNumber: 2 })], changedClaimNumbers: [2], fidelityMode: 'STRUCTURE_ONLY' })).toContain('independent-claim count')
  })

  test('refuses when a claim loses most of its substance', () => {
    const after: DraftClaim[] = [
      claims[0],
      { number: 2, type: 'dependent', dependsOn: 1, category: 'use', text: 'The use as claimed in claim 1, wherein the composition is a tablet.' },
    ]
    expect(guardRepairMerge({ before: claims, after, findings: useFinding, changedClaimNumbers: [2], fidelityMode: 'STRUCTURE_ONLY' })).toContain('claim 2 lost')
  })

  test('refuses when a PRESERVE canonical term vanishes', () => {
    const after: DraftClaim[] = [
      { number: 1, type: 'independent', category: 'method', text: 'A method of treating gastric ulcers in a subject, comprising administering a berberine composition to the subject.' },
      { number: 2, type: 'dependent', dependsOn: 1, category: 'method', text: 'The method of claim 1, wherein the composition is a bilayer tablet comprising solid-dispersion granules and an effervescent layer.' },
    ]
    const components = [{ name: 'melt-lock granules' }, { name: 'gas-nest layer' }]
    expect(guardRepairMerge({ before: claims, after, findings: useFinding, changedClaimNumbers: [1, 2], fidelityMode: 'PRESERVE', components })).toContain('melt-lock granules')
    expect(guardRepairMerge({ before: claims, after, findings: useFinding, changedClaimNumbers: [1, 2], fidelityMode: 'STRUCTURE_ONLY', components })).toBeNull()
  })
})

describe('repair prompt', () => {
  test('lists the office rules, the defects with recipes, and the amendment contract', () => {
    const rules = resolveClaimRuleProfile('IN').rules
    const findings = selectRepairFindings(runOfficeFormLint(claims, { rules }))
    expect(findings.some(f => f.code === 'USE_CLAIM')).toBe(true)
    const prompt = buildClaimFormRepairPrompt({
      claims,
      findings,
      rules,
      rulesBlock: renderJurisdictionClaimRulesBlock(rules),
      context: { title: 'Stomach-raft tablet', components: [{ name: 'melt-lock granules' }], rawIdea: 'A raft tablet.' },
      fidelityMode: 'PRESERVE',
      strategyDigest: 'Inventive concept: a raft tablet',
    })
    expect(prompt).toContain('JURISDICTION CLAIM RULES (IN')
    expect(prompt).toContain('OFFICE-FORM DEFECTS TO CURE')
    expect(prompt).toContain('[F1] severity=block code=USE_CLAIM')
    expect(prompt).toContain('REQUIRED AMENDMENT: Recast the use claim as a method claim')
    expect(prompt).toContain('Only the listed office-form defects may be cured')
    expect(prompt).toContain('INVENTOR TERMINOLOGY TRANSLATION TABLE')
    expect(prompt).toContain('CLAIM STRATEGY')
    expect(prompt).toContain('"refined_claims"')
    expect(prompt).toContain('<original_source_excerpt>')
  })
})
