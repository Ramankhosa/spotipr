import { describe, expect, test } from 'vitest'
import { getAuthoritativeClaims } from '@/lib/claims-context'
import { partitionDetailedDescriptionConstraints } from '@/lib/section-injection-config'
import { filterComponentsByInventionScope } from '@/lib/section-injection-config'
import { coerceScopeRecommendations, getEffectiveScopeUse } from '@/lib/scope-recommendations'
import { DraftingService } from '@/lib/drafting-service'

/**
 * Regression cover for the defaults and fallback paths that used to degrade a
 * draft silently. Each case below is a behaviour someone previously shipped
 * believing it was safe.
 */

describe('scope recommendation defaults', () => {
  test('a malformed recommendation does not blacklist the element from the claims', () => {
    // A scope element the model returned with a real label but no usable
    // `recommended` object used to default to claim:'none' / do_not_number /
    // do_not_show — which put a genuine inventor-stated feature on the prompt's
    // "DO NOT PROMOTE INTO CLAIMS" list and dropped it from the Component Planner.
    const scope = coerceScopeRecommendations({
      elements: [{ label: 'moisture sensor', sourceType: 'component' }],
    })

    expect(scope).toBeDefined()
    const effective = getEffectiveScopeUse(scope!.elements[0])
    expect(effective.claim).not.toBe('none')
    expect(effective.numbering).toBe('number')
    expect(effective.description).not.toBe('exclude')
  })

  test('a misspelled enum value falls to the permissive reading, not to exclusion', () => {
    // "claim1" is not a valid ScopeClaimUse. Treating an unrecognised value as
    // 'none' is the same silent blacklist as a missing value.
    const scope = coerceScopeRecommendations({
      elements: [{
        label: 'drain valve',
        sourceType: 'component',
        recommended: { claim: 'claim1', numbering: 'yes', figures: 'show' },
      }],
    })

    const effective = getEffectiveScopeUse(scope!.elements[0])
    expect(effective.claim).not.toBe('none')
    expect(effective.numbering).toBe('number')
    expect(effective.figures).not.toBe('do_not_show')
  })

  test('an explicit exclusion from the model is still honoured', () => {
    const scope = coerceScopeRecommendations({
      elements: [{
        label: 'garden use case',
        sourceType: 'other',
        recommended: { claim: 'none', numbering: 'do_not_number', figures: 'do_not_show', description: 'exclude' },
      }],
    })

    const effective = getEffectiveScopeUse(scope!.elements[0])
    expect(effective.claim).toBe('none')
    expect(effective.description).toBe('exclude')
  })
})

describe('invention-scope component filter', () => {
  const normalizedData = {
    coreInventiveConcept: 'A dryer that regulates airflow using a temperature sensor.',
    problem: 'Crops over-dry when airflow is not regulated.',
  }

  test('a plural component name still matches a singular claim term', () => {
    // "Temperature Sensors" against "a temperature sensor" scored one token out
    // of two and was dropped, taking its reference numeral with it.
    const kept = filterComponentsByInventionScope(
      [{ name: 'Temperature Sensors', referenceLabel: '110' }],
      normalizedData,
      {}
    )
    expect(kept.map((c: any) => c.name)).toEqual(['Temperature Sensors'])
  })

  test('a name with three distinctive tokens needs two matching tokens, not one', () => {
    // "unit" is a scope stopword, so "Auxiliary Power Supply" is used here to get
    // three tokens that all count. Only "power" appears in the scope text.
    const scopeText = { coreInventiveConcept: 'The controller regulates power to the heater.' }
    const dropped = filterComponentsByInventionScope(
      [{ name: 'Auxiliary Power Supply', referenceLabel: '400' }, { name: 'Heater', referenceLabel: '300' }],
      scopeText,
      {}
    )
    expect(dropped.map((c: any) => c.name)).toEqual(['Heater'])

    const kept = filterComponentsByInventionScope(
      [{ name: 'Auxiliary Power Supply', referenceLabel: '400' }, { name: 'Heater', referenceLabel: '300' }],
      { coreInventiveConcept: 'An auxiliary power supply feeds the heater.' },
      {}
    )
    expect(kept.map((c: any) => c.name)).toEqual(['Auxiliary Power Supply', 'Heater'])
  })

  test('never returns an empty list when components were supplied', () => {
    // An empty allowed list makes every reference label in the section illegal,
    // and the repair pass then strips them all out of the text.
    const kept = filterComponentsByInventionScope(
      [{ name: 'Grommet', referenceLabel: '900' }],
      { coreInventiveConcept: 'Entirely unrelated subject matter.' },
      {}
    )
    expect(kept.length).toBe(1)
  })

  test('with no scope text at all, components are kept rather than all dropped', () => {
    const kept = filterComponentsByInventionScope(
      [{ name: 'Manifold', referenceLabel: '200' }],
      {},
      {}
    )
    expect(kept.length).toBe(1)
  })
})

describe('detailed description constraint filtering', () => {
  test('reports what it removed instead of dropping it silently', () => {
    // Admins author these in Super Admin and used to get no signal at all that
    // one had been withheld from the model.
    const { kept, removed } = partitionDetailedDescriptionConstraints('detailedDescription', [
      'Write in impersonal third person.',
      'Describe the best mode contemplated by the inventor.',
    ])

    expect(kept).toEqual(['Write in impersonal third person.'])
    expect(removed).toEqual(['Describe the best mode contemplated by the inventor.'])
  })

  test('leaves non-DD sections untouched', () => {
    const { kept, removed } = partitionDetailedDescriptionConstraints('background', [
      'Describe the best mode contemplated by the inventor.',
    ])
    expect(kept).toHaveLength(1)
    expect(removed).toHaveLength(0)
  })
})

describe('authoritative claims snapshot', () => {
  test('structured claims and HTML come from the same generation', () => {
    // A frozen session with claimsStructuredFinal but no claimsFinal used to take
    // the structured claims from the frozen set and the HTML from the working
    // `claims`, so a section could anchor on one revision and render another.
    const snapshot = getAuthoritativeClaims({
      claimsApprovedAt: '2026-01-01T00:00:00.000Z',
      claimsStructuredFinal: [{ number: 1, type: 'independent', text: 'A frozen widget.' }],
      claims: '<p><strong>1.</strong> A stale working widget.</p>',
    })

    expect(snapshot.source).toBe('final')
    expect(snapshot.html).toContain('A frozen widget.')
    expect(snapshot.html).not.toContain('stale working widget')
  })
})

describe('draft consistency validation', () => {
  const session = (components: any[], figurePlans: any[] = []) => ({
    referenceMap: { components },
    figurePlans,
  })

  test('sees STEP_LABEL numbering used by PROCESS drafts', () => {
    // The old check read component.numeral and matched /\((\d+)\)/ only, so for
    // PROCESS and COMPOSITION drafts it found no labels at all: it reported every
    // declared component as missing and never caught a genuine bad reference.
    const result = DraftingService.validateDraftConsistencyPublic(
      { fullText: 'Heating (S100) precedes drying (S200).' },
      session([
        { name: 'Heating step', referenceLabel: 'S100' },
        { name: 'Drying step', referenceLabel: 'S200' },
      ])
    )

    expect(result.report.missingNumerals).toHaveLength(0)
    expect(result.report.unusedNumerals).toHaveLength(0)
  })

  test('sees CONSTITUENT_LABEL numbering used by COMPOSITION drafts', () => {
    const result = DraftingService.validateDraftConsistencyPublic(
      { fullText: 'The binder (a) is combined with the solvent (b).' },
      session([
        { name: 'Binder', referenceLabel: '(a)' },
        { name: 'Solvent', referenceLabel: '(b)' },
      ])
    )

    expect(result.report.missingNumerals).toHaveLength(0)
    expect(result.report.unusedNumerals).toHaveLength(0)
  })

  test('still flags a label that was never declared', () => {
    const result = DraftingService.validateDraftConsistencyPublic(
      { fullText: 'The housing (100) holds the rotor (300).' },
      session([{ name: 'Housing', referenceLabel: '100' }])
    )

    expect(result.report.unusedNumerals).toContain('300')
  })

  test('counts FIGURE spellings, not just "Fig."', () => {
    const result = DraftingService.validateDraftConsistencyPublic(
      { fullText: 'FIGURE 4 shows the assembly.' },
      session([], [{ figureNo: 1 }])
    )

    expect(result.report.invalidReferences).toContain('Figure 4')
  })
})

describe('patent type text fallback', () => {
  test('a passing chemical mention does not reclassify a mechanical system', () => {
    // COMPOSITION used to win on a single keyword hit anywhere in the disclosure,
    // which flipped the numbering style to (a)/(b) and renumbered every component.
    const result = DraftingService.patentTypeFallbackFromText(
      'A latch assembly for a shipping container. The housing is moulded from a polymer and the whole apparatus is mounted on a bracket within the assembly.',
      'Self-tightening latch assembly'
    )
    expect(result.primary).toBe('SYSTEM')
  })

  test('a genuine composition is still detected', () => {
    const result = DraftingService.patentTypeFallbackFromText(
      'A pharmaceutical formulation comprising an active ingredient and an excipient in a stable dosage form.',
      'Stable oral formulation'
    )
    expect(result.primary).toBe('COMPOSITION')
  })

  test('one composition word in a body with no structural words is not a composition', () => {
    // No title keyword, no system/process words, a single "mixture": this used
    // to win as COMPOSITION because 1 >= 0 and 1 >= 0.
    const result = DraftingService.patentTypeFallbackFromText(
      'The dryer holds a mixture of grain in a chamber under a polymer sheet with a fan below.',
      'Solar dryer'
    )
    expect(result.primary).toBe('SYSTEM')
  })

  test('the title wins over body vocabulary', () => {
    const result = DraftingService.patentTypeFallbackFromText(
      'The apparatus includes a system of pipes and an assembly of valves.',
      'Method of drying grain'
    )
    expect(result.primary).toBe('PROCESS')
  })
})

describe('claims guardrail', () => {
  const check = (text: string, claimsRules?: any) =>
    (DraftingService as any).guardrailCheck('claims', text, { components: [] }, undefined, { claimsRules })

  test('a second independent claim is not reported as a malformed dependent claim', () => {
    // Every claim after the first used to be REQUIRED to read "The
    // system/device/method of claim N", so any multi-independent claim set
    // failed here and was then rewritten into a single dependency chain.
    const result = check(`1. A system comprising a sensor.
2. The system of claim 1, wherein the sensor is a thermistor.
3. A method of operating a sensor, comprising sampling the sensor.
4. The method of claim 3, wherein sampling is periodic.`)
    expect(result.ok).toBe(true)
  })

  test('EP-style dependent claims pass', () => {
    const result = check(`1. A method of drying grain.
2. A method according to claim 1, wherein the grain is stirred.
3. Apparatus as claimed in claim 1, comprising a fan.`)
    expect(result.ok).toBe(true)
  })

  test('a forward reference is still caught', () => {
    const result = check(`1. A system comprising a sensor.
2. The system of claim 5, wherein the sensor is a thermistor.`)
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/earlier claim/)
  })

  test('a claim that is neither form is still caught', () => {
    const result = check(`1. A system comprising a sensor.
2. The system wherein the sensor is a thermistor.`)
    expect(result.ok).toBe(false)
  })

  test('multiple dependency is still refused where the jurisdiction forbids it', () => {
    const result = check(`1. A system comprising a sensor.
2. The system of claim 1, comprising a housing.
3. The system of claim 1 or claim 2, wherein the housing is sealed.`, { allowMultipleDependent: false })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/Multiple dependency/)
  })
})

describe('brief description of drawings repair', () => {
  const fix = (text: string) =>
    (DraftingService as any).minimalFix('briefDescriptionOfDrawings', text, {
      reason: 'BDOD contains claims/advantages language',
      figures: [{ figureNo: 1 }, { figureNo: 2 }],
    })

  test('drops a non-figure intro paragraph and leaves the figure lines untouched', () => {
    const repaired = fix(`The drawings show the advantages of the invention.

FIG. 1 is a perspective view of the dryer.

FIGURE 2 is a section through the chamber.`)
    expect(repaired).toBe('FIG. 1 is a perspective view of the dryer.\n\nFIGURE 2 is a section through the chamber.')
  })

  test('never deletes words in place when the flagged word is inside a figure line', () => {
    // The old repair produced "FIG. 1 shows the of the assembly."
    const repaired = fix(`FIG. 1 shows the advantage of the assembly.

FIG. 2 is a section through the chamber.`)
    expect(repaired).toBeNull()
  })

  test('never substitutes placeholder prose when nothing matches', () => {
    const repaired = fix('Some prose with no figure references at all.')
    expect(repaired).toBeNull()
  })
})
