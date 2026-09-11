// Review probes: these assertions document current behavior, not desired behavior.
// All examples are synthetic. No database or model calls are made.
import { describe, expect, test, vi } from 'vitest'
vi.mock('@/lib/metering/gateway', () => ({ llmGateway: { executeLLMOperation: vi.fn() } }))
import { llmGateway } from '@/lib/metering/gateway'
import { guardRepairMerge, repairClaimFormIfNeeded } from '@/lib/claim-rules/repair'
import { normaliseClaimSet, resolveClaimRuleProfile, runOfficeFormLint, renderJurisdictionClaimRulesBlock } from '@/lib/claim-rules'
import { mergeChallengeRefinedClaims } from '@/lib/claim-challenge'
import { computeClaimStrategyFingerprint } from '@/lib/claim-rules/strategy-state'
import { entryMatchesClaim } from '@/lib/preliminary-claim-generation'
import type { DraftClaim } from '@/lib/draft-claims-parser'
import type { OfficeFormFinding } from '@/lib/claim-rules/types'

const rules = resolveClaimRuleProfile('US').rules
const c = (text: string, number = 1): DraftClaim => ({ number, type: 'independent', category: 'apparatus', text })
const f: OfficeFormFinding = { id: 'F1', code: 'ANTECEDENT_BASIS', claimNumber: 1, severity: 'block', fix: 'llm', excerpt: '', message: 'Review antecedent basis', basis: 'Clarity', jurisdiction: 'US' }
const base = c('An apparatus comprising a controller configured to open a valve at 5 bar and not transmit a signal during calibration.')
const guard = (before: DraftClaim[], after: DraftClaim[], changedClaimNumbers: number[]) => guardRepairMerge({ before, after, changedClaimNumbers, findings: [f], fidelityMode: 'PRESERVE' })

describe('claim drafting review: reproduced gaps', () => {
  test('numeric substitution and removal of not pass the token guard', () => {
    expect(guard([base], [c(base.text.replace('5 bar', '50 bar').replace('not transmit', 'transmit'))], [1])).toBeNull()
  })
  test('a change to a claim with no selected finding passes the guard', () => {
    const second = c('A sensor comprising a housing and a detector.', 2)
    expect(guard([base, second], [base, c(second.text.replace('housing', 'titanium housing'), 2)], [2])).toBeNull()
  })
  test('invented dependent limitation is unchecked by the repair guard', () => {
    const added: DraftClaim = { number: 2, type: 'dependent', dependsOn: 1, text: 'The apparatus of claim 1, wherein a housing comprises titanium.' }
    expect(guard([base], [base, added], [])).toBeNull()
  })
  test('merge preserves stale independent type until after guard runs', () => {
    const claims = [base, c('An apparatus comprising a controller and a sensor.', 2)]
    const merged = mergeChallengeRefinedClaims({ baseStructured: claims, refinedClaims: [{ number: 2, original_text: claims[1].text, refined_text: 'The apparatus of claim 1, comprising a controller and a sensor.', keep_as_is: false, change_reason: 'changed dependency', remark_refs: ['F1'] }], acceptAll: true })
    expect(merged.ok).toBe(true)
    if (!merged.ok) return
    expect(guard(claims, merged.merged, merged.changedClaimNumbers)).toBeNull()
    expect(merged.merged[1].type).toBe('independent')
    expect(normaliseClaimSet(merged.merged, rules).claims[1].type).toBe('dependent')
  })
  test('source number substring accepts 5 bar when only 50 bar was disclosed', () => {
    const findings = runOfficeFormLint([c('An apparatus comprising a valve rated at 5 bar.')], { rules, context: { sourceText: 'A valve rated at 50 bar.' } })
    expect(findings.filter(x => x.code === 'UNSUPPORTED_NUMBER')).toEqual([])
  })
  test('two shared source words count as a support match despite different relationship', () => {
    expect(entryMatchesClaim('A controller opens a valve during overheating.', 'A controller closes a valve during overheating.')).toBe(true)
  })
  test('property measurement method is treated as a blocking experimental parameter', () => {
    const claim = { ...c('A polymer composition having a molecular weight of 50000 as measured by GPC.'), category: 'composition' as const }
    const findings = runOfficeFormLint([claim], { rules: resolveClaimRuleProfile('EP').rules, context: { sourceText: claim.text } })
    expect(findings.some(x => x.code === 'EXPERIMENTAL_PARAMETER' && x.severity === 'block')).toBe(true)
  })
  test('description-defined relative term remains a blocking modifier finding', () => {
    const findings = runOfficeFormLint([c('An apparatus comprising a substantially planar substrate.')], { rules, context: { sourceText: 'Substantially planar means less than 0.1 mm surface deviation over 100 mm.' } })
    expect(findings.some(x => x.code === 'INDEFINITE_MODIFIER' && x.severity === 'block')).toBe(true)
  })
  test('normalization changes conjunction to alternative dependency', () => {
    const claims: DraftClaim[] = [base, { number: 2, type: 'dependent', dependsOn: 1, text: 'The apparatus of claim 1, comprising a sensor.' }, { number: 3, type: 'dependent', dependsOn: 1, text: 'The apparatus of claims 1 and 2, comprising a housing.' }]
    expect(normaliseClaimSet(claims, rules).claims[2].text).toContain('claims 1 or 2')
  })
  test('terminology retention appends a claim after the generation cap stage', () => {
    const claims = [c('An apparatus comprising a FluxGate processor.')]
    const result = normaliseClaimSet(claims, rules, { terminology: [{ inventorTerm: 'FluxGate processor', claimTerm: 'control processor', retainInDependent: true }], fidelityMode: 'PRESERVE' })
    expect(result.claims).toHaveLength(2)
    expect(result.claims[1].text).toContain('is FluxGate processor')
  })
  test('office and revised art digest do not change strategy fingerprint', () => {
    const session = { activeJurisdiction: 'US', noveltyHandoff: { searchId: 'search-1', findingsDigest: 'No reference discloses feature X' } }
    const changed = { activeJurisdiction: 'IN', noveltyHandoff: { searchId: 'search-1', findingsDigest: 'Reference A discloses feature X' } }
    expect(computeClaimStrategyFingerprint({}, session)).toBe(computeClaimStrategyFingerprint({}, changed))
  })
  test('unchanged amendment can be recorded as a resolved repair', async () => {
    const claims = [c('An apparatus comprising a substantially planar substrate.')]
    const findings = runOfficeFormLint(claims, { rules })
    const modifier = findings.find(x => x.code === 'INDEFINITE_MODIFIER')!
    vi.mocked(llmGateway.executeLLMOperation).mockResolvedValueOnce({ success: true, response: { output: JSON.stringify({ refined_claims: [{ number: 1, original_text: claims[0].text, refined_text: claims[0].text, keep_as_is: false, change_reason: 'fixed', remark_refs: [modifier.id] }], added_claims: [], unresolved: [] }) } } as any)
    const result = await repairClaimFormIfNeeded({ claims, findings: [modifier], rules, rulesBlock: renderJurisdictionClaimRulesBlock(rules), context: { rawIdea: claims[0].text }, normalized: {}, requestHeaders: {}, sessionId: 'synthetic-review', jurisdiction: 'US' })
    expect(result.record?.resolvedFindingIds).toContain(modifier.id)
    expect(runOfficeFormLint(result.claims, { rules }).some(x => x.code === 'INDEFINITE_MODIFIER')).toBe(true)
  })
})
