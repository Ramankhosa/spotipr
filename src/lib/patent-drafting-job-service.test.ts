import { describe, expect, it } from 'vitest'
import {
  buildAutomationIdeaText,
  buildEnabledJurisdictionToggles,
  evaluateDraftQualityGate,
  selectReviewedPriorArtDecisions,
  validateAutomationPayloadForPipeline,
} from './patent-drafting-job-service'

describe('buildAutomationIdeaText', () => {
  it('combines structured idea details with novelty text', () => {
    const text = buildAutomationIdeaText({
      title: 'Adaptive thermal control assembly',
      ideaDetails: {
        problem: 'Thermal drift during load transitions.',
        solution: 'Predictive control loop with sensor fusion.',
        components: ['controller', 'thermal sensor', 'actuator'],
      },
      novelty: 'The loop predicts thermal drift before the load change occurs.',
    })

    expect(text).toContain('Title: Adaptive thermal control assembly')
    expect(text).toContain('problem: Thermal drift during load transitions.')
    expect(text).toContain('components: controller, thermal sensor, actuator')
    expect(text).toContain('Novelty / inventive contribution:')
    expect(text).toContain('predicts thermal drift')
  })

  it('preserves raw idea text when provided', () => {
    const text = buildAutomationIdeaText({
      title: 'Smart valve',
      rawIdea: 'A valve assembly that changes restriction based on sensed vibration.',
    })

    expect(text).toContain('Title: Smart valve')
    expect(text).toContain('changes restriction based on sensed vibration')
  })
})

describe('selectReviewedPriorArtDecisions', () => {
  it('sorts adjacent drafting prior art and excludes remote, high-risk, unknown, and low relevance decisions', () => {
    const selected = selectReviewedPriorArtDecisions([
      { pn: 'ADJ', relevance: 0.6, novelty_threat: 'adjacent', analysis_status: 'analyzed' },
      { pn: 'ADJ2', relevance: 0.7, novelty_threat: 'adjacent', analysis_status: 'analyzed' },
      { pn: 'ANT', relevance: 0.95, novelty_threat: 'anticipates', analysis_status: 'analyzed' },
      { pn: 'OBV', relevance: 0.8, novelty_threat: 'obvious', analysis_status: 'analyzed' },
      { pn: 'REM', relevance: 0.99, novelty_threat: 'remote', analysis_status: 'analyzed' },
      { pn: 'UNK', relevance: null, novelty_threat: 'unknown', analysis_status: 'unknown' },
      { pn: 'LOW', relevance: 0.2, novelty_threat: 'adjacent', analysis_status: 'analyzed' },
    ])
    expect(selected.map(decision => decision.pn)).toEqual(['ADJ2', 'ADJ'])
  })

  it('defaults to the top 10 adjacent patents', () => {
    const decisions = Array.from({ length: 12 }, (_, index) => ({
      pn: `ADJ${index + 1}`,
      relevance: 1 - index / 100,
      novelty_threat: 'adjacent',
      analysis_status: 'analyzed',
    }))

    const selected = selectReviewedPriorArtDecisions(decisions)

    expect(selected).toHaveLength(10)
    expect(selected.map(decision => decision.pn)).toEqual([
      'ADJ1',
      'ADJ2',
      'ADJ3',
      'ADJ4',
      'ADJ5',
      'ADJ6',
      'ADJ7',
      'ADJ8',
      'ADJ9',
      'ADJ10',
    ])
  })
})

describe('buildEnabledJurisdictionToggles', () => {
  it('enables each normalized jurisdiction', () => {
    expect(buildEnabledJurisdictionToggles(['in', ' US ', '', null])).toEqual({
      IN: true,
      US: true,
    })
  })
})

describe('validateAutomationPayloadForPipeline', () => {
  it('blocks multi-jurisdiction generated claims to avoid reusing one jurisdiction claim set', () => {
    expect(() => validateAutomationPayloadForPipeline({
      title: 'Smart valve',
      rawIdea: 'A valve assembly.',
      jurisdictions: ['IN', 'US'],
      claimsHandling: 'draft from brief',
    })).toThrow(/Multi-jurisdiction automated drafting requires caller-supplied claims/)
  })

  it('allows multi-jurisdiction jobs when claims are explicitly supplied as-is', () => {
    const result = validateAutomationPayloadForPipeline({
      title: 'Smart valve',
      rawIdea: 'A valve assembly.',
      jurisdictions: ['IN', 'US'],
      claimsHandling: 'use as is',
      claimsText: '1. A valve assembly comprising a monitored restriction member.',
    })

    expect(result.jurisdictions).toEqual(['IN', 'US'])
    expect(result.claimsHandling).toBe('use as is')
  })
})

describe('evaluateDraftQualityGate', () => {
  const completeDraft = {
    title: 'Smart valve',
    fieldOfInvention: 'The invention relates to valves.',
    background: 'Known valves require manual tuning.',
    summary: 'The valve includes a monitored restriction member.',
    detailedDescription: 'The monitored restriction member is described.',
    claims: '1. A valve assembly comprising a monitored restriction member.',
    abstract: 'Smart valve includes a monitored restriction member.',
  }

  it('passes a complete reviewed draft with clean validation', () => {
    const gate = evaluateDraftQualityGate({
      jurisdiction: 'IN',
      sections: Object.keys(completeDraft),
      draft: completeDraft,
      validationReport: { invalidReferences: [] },
      extendedReport: { hasIssues: true, hardFail: false },
      generationWarnings: [],
      reviewAttempted: true,
    })

    expect(gate.ok).toBe(true)
  })

  it('blocks missing sections, generation warnings, invalid references, and skipped review', () => {
    const gate = evaluateDraftQualityGate({
      jurisdiction: 'IN',
      sections: [...Object.keys(completeDraft), 'industrialApplicability'],
      draft: completeDraft,
      validationReport: { invalidReferences: ['Figure 9'] },
      generationWarnings: ['detailedDescription used fallback content'],
      reviewAttempted: false,
    })

    expect(gate.ok).toBe(false)
    expect(gate.message).toContain('industrialApplicability')
    expect(gate.message).toContain('Figure 9')
    expect(gate.message).toContain('fallback content')
    expect(gate.message).toContain('AI review was not run')
  })
})
