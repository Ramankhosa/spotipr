import { describe, expect, test } from 'vitest'
import {
  buildClaimStrategyBlock,
  buildClaimStrategyDigest,
  buildClaimStrategyPrompt,
  parseClaimStrategy,
  type ClaimStrategy,
} from '@/lib/claim-rules/strategy'
import {
  claimStrategyInFlight,
  computeClaimStrategyFingerprint,
  readyClaimStrategy,
} from '@/lib/claim-rules/strategy-state'
import { renderJurisdictionClaimRulesBlock, resolveClaimRuleProfile } from '@/lib/claim-rules'
import { buildPreliminaryClaimsPrompt } from '@/lib/preliminary-claim-generation'

const strategy: ClaimStrategy = {
  version: 1,
  jurisdiction: 'IN',
  inventiveConcept: 'A twin-chamber dryer whose humidity-swing flap vents the drying chamber only while warm-keeper blocks hold the air above ambient.',
  problemSolved: 'Chillies re-absorb moisture overnight in a single-chamber solar dryer.',
  closestArt: [{ ref: 'IN202600001', teaches: ['solar collector', 'drying chamber'], lacks: ['humidity-swing flap', 'warm-keeper blocks'] }],
  essentialFeatures: ['a drying chamber', 'a plurality of warm-keeper blocks', 'a humidity-swing flap coupled to the chamber'],
  optionalFeatures: ['eight warm-keeper blocks', 'paraffin with a melting range of 48 to 52 C', 'a mesh sled'],
  categoryPlan: [
    { category: 'apparatus', form: 'A solar dryer comprising', role: 'primary', justification: 'detected patent type' },
    { category: 'method', form: 'A method of drying produce comprising', role: 'mirror', justification: 'catches the operator' },
  ],
  eligibility: { risk: 'none', doctrine: 'Section 3', mitigation: 'recite the structural cooperation' },
  terminology: [{ element: 'flap', claimTerm: 'humidity-swing flap', inventorTerm: 'humidity-swing flap', retainInDependent: false }],
  singleActor: { actor: 'the dryer operator', avoidedDividedSteps: [] },
  numericLadder: [{ parameter: 'paraffin melting range', broad: '48 to 52 C', sourceRef: 'SF-numericValuesAndUnits-1' }],
  claimForm: 'one_part_pre_search',
}

const session = {
  activeJurisdiction: 'IN',
  draftingJurisdictions: ['IN'],
  patentTypePrimary: 'PRODUCT',
  ideaRecord: { title: 'Twin-chamber solar dryer', rawInput: 'A dryer with warm-keeper blocks.', components: [] },
}

const normalized = {
  problem: 'Moisture re-absorption',
  components: [{ name: 'warm-keeper block', description: 'paraffin block' }],
  claimableFeatures: ['humidity-swing flap'],
  sourceHandlingMode: 'PRESERVE',
}

describe('claim strategy schema', () => {
  test('parses lenient model output and rejects a plan without essentials', () => {
    const parsed = parseClaimStrategy({
      inventiveConcept: ' a concept ',
      essentialFeatures: ['a chamber', '', 42],
      categoryPlan: [{ category: 'apparatus', role: 'nonsense' }, { category: '' }],
      eligibility: { risk: 'severe' },
      terminology: [{ element: 'flap', claimTerm: 'flap', retainInDependent: 'yes' }],
      numericLadder: [{ parameter: 'range', broad: '1 to 2' }],
    })
    expect(parsed?.inventiveConcept).toBe('a concept')
    expect(parsed?.essentialFeatures).toEqual(['a chamber', '42'])
    expect(parsed?.categoryPlan).toEqual([{ category: 'apparatus', form: '', role: 'mirror', justification: '' }])
    expect(parsed?.eligibility.risk).toBe('low')
    expect(parsed?.claimForm).toBe('one_part_pre_search')
    expect(parseClaimStrategy({ inventiveConcept: 'x', essentialFeatures: [] })).toBeNull()
    expect(parseClaimStrategy(null)).toBeNull()
  })

  test('renders the block and the digest', () => {
    const block = buildClaimStrategyBlock(strategy)
    expect(block).toContain('CLAIM STRATEGY')
    expect(block).toContain('Claim 1 must recite')
    expect(block).toContain('- a humidity-swing flap coupled to the chamber')
    expect(block).toContain('mirror: method')
    expect(block).toContain('IN202600001: lacks humidity-swing flap; warm-keeper blocks')
    expect(block).toContain('one-part "comprising"')
    const digest = buildClaimStrategyDigest(strategy)
    expect(digest.split('\n').length).toBeLessThanOrEqual(6)
    expect(digest).toContain('Independent claims: primary apparatus, mirror method')
    expect(buildClaimStrategyBlock(null)).toBe('')
  })

  test('the strategy prompt carries the rules block, the scope and the JSON contract', () => {
    const rules = resolveClaimRuleProfile('IN').rules
    const prompt = buildClaimStrategyPrompt({
      rules,
      rulesBlock: renderJurisdictionClaimRulesBlock(rules),
      patentTypePrimary: 'PRODUCT',
      normalizedContextBlock: 'NORMALIZED INVENTION CONTEXT:\nTitle: Dryer',
      originalSourceExcerptBlock: 'ORIGINAL SOURCE EXCERPT: x',
      supportDataBlock: '',
      sourceFactLedgerBlock: 'SOURCE FACT LEDGER FOR CLAIM SUPPORT\n- [SF-numericValuesAndUnits-1] 48 to 52 C',
      claimScopeBlock: 'USER-APPROVED CLAIM SCOPE (AUTHORITATIVE)',
      noveltyGuidanceBlock: '',
      noveltyFindingsBlock: '',
      sourceFidelityBlock: 'SOURCE FIDELITY MODE: PRESERVE',
      inventorTerminologyBlock: '',
    })
    expect(prompt).toContain('JURISDICTION CLAIM RULES (IN')
    expect(prompt).toContain('USER-APPROVED CLAIM SCOPE')
    expect(prompt).toContain('"essentialFeatures"')
    expect(prompt).toContain('"category": "apparatus"')
    expect(prompt).toContain('essential-features test')
  })

  test('the claims prompt carries the strategy block after the static prefix', () => {
    const prompt = buildPreliminaryClaimsPrompt({
      jurisdiction: 'IN',
      countryName: 'India',
      officeName: 'Indian Patent Office',
      tone: 't', voice: 'v', avoid: 'a',
      baseInstruction: 'CLAIMS-BASE-V2 base',
      rulesBlock: 'JURISDICTION CLAIM RULES (IN — Indian Patent Office)',
      context: { title: 'Dryer', rawIdea: 'A dryer.' },
      patentTypePrimary: 'PRODUCT',
      claimStrategyBlock: buildClaimStrategyBlock(strategy),
    })
    expect(prompt.indexOf('JURISDICTION CLAIM RULES')).toBeLessThan(prompt.indexOf('CLAIM STRATEGY'))
    expect(prompt).toContain('- a plurality of warm-keeper blocks')
  })
})

describe('claim strategy state', () => {
  test('the fingerprint is stable and changes with the inputs the plan depends on', () => {
    const a = computeClaimStrategyFingerprint(normalized, session)
    expect(computeClaimStrategyFingerprint({ ...normalized }, { ...session })).toBe(a)
    expect(computeClaimStrategyFingerprint({ ...normalized, components: [{ name: 'night lid' }] }, session)).not.toBe(a)
    expect(computeClaimStrategyFingerprint(normalized, { ...session, patentTypePrimary: 'PROCESS' })).not.toBe(a)
    // The office is not part of the plan's identity: a plan made for one
    // jurisdiction is reused for another, and the rules block handles the rest.
    expect(computeClaimStrategyFingerprint(normalized, { ...session, activeJurisdiction: 'US', draftingJurisdictions: ['US'] })).toBe(a)
    expect(computeClaimStrategyFingerprint(normalized, { ...session, noveltyHandoff: { searchId: 's1' } })).not.toBe(a)
    // Keys the plan does not depend on leave it alone.
    expect(computeClaimStrategyFingerprint({ ...normalized, claims: '<p>1. x</p>', claimFormReport: {} }, session)).toBe(a)
  })

  test('a ready plan is used only for matching inputs; a dead run is not in flight', () => {
    const fingerprint = computeClaimStrategyFingerprint(normalized, session)
    const ready = { ...normalized, claimStrategy: { status: 'ready', inputFingerprint: fingerprint, jurisdiction: 'IN', reason: 'test', startedAt: new Date().toISOString(), strategy } }
    expect(readyClaimStrategy(ready, fingerprint)?.inventiveConcept).toBe(strategy.inventiveConcept)
    expect(readyClaimStrategy(ready, 'other')).toBeNull()
    expect(readyClaimStrategy({ ...ready, claimStrategy: { ...ready.claimStrategy, status: 'failed' } }, fingerprint)).toBeNull()

    const now = Date.now()
    const running = { claimStrategy: { status: 'running', inputFingerprint: fingerprint, startedAt: new Date(now - 30_000).toISOString() } }
    expect(claimStrategyInFlight(running, fingerprint, now)).toBe(true)
    const dead = { claimStrategy: { status: 'running', inputFingerprint: fingerprint, startedAt: new Date(now - 10 * 60_000).toISOString() } }
    expect(claimStrategyInFlight(dead, fingerprint, now)).toBe(false)
  })
})
