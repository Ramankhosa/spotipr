import { describe, expect, test } from 'vitest'
import { buildIdeaNormalizationPrompt } from '@/lib/idea-normalization-prompt'

describe('idea normalization prompt', () => {
  test('uses source-faithful ledger rules in preserve mode', () => {
    const prompt = buildIdeaNormalizationPrompt({
      rawIdea: 'A pump has spring preload 5-8 N and an optional lock.',
      title: 'Pump Lock',
      allowRefine: false,
    })

    expect(prompt).toContain('PRESERVE')
    expect(prompt).toContain('minimal paraphrase')
    expect(prompt).toContain('Do NOT invent')
    expect(prompt).toContain('Do NOT over-summarize')
    expect(prompt).toContain('Do NOT merge')
    expect(prompt).toContain('Do NOT convert optional')
    expect(prompt).toContain('Populate "bestMethod" ONLY')
    expect(prompt).toContain('"patentTypePrimary"')
    expect(prompt).toContain('Do NOT classify a device as SYSTEM merely because it has multiple internal parts')
    expect(prompt).toContain('"sourceFactLedger"')
    expect(prompt).toContain('"normalizationReviewWarnings"')
    expect(prompt).toContain('"coreInventiveConcept"')
    expect(prompt).toContain('"claimableFeatures"')
    expect(prompt).toContain('"fallbackLimitations"')
    expect(prompt).toContain('"doNotClaim"')
  })

  test('allows structure mode to polish without adding technical facts', () => {
    const prompt = buildIdeaNormalizationPrompt({
      rawIdea: 'A cache expires after 24 hours.',
      title: 'Cache System',
      allowRefine: true,
    })

    expect(prompt).toContain('STRUCTURE_ONLY')
    expect(prompt).toContain('Structure and polish the wording')
    expect(prompt).toContain('Do NOT add unsupported technical facts')
    expect(prompt).toContain('Do NOT choose a preferred architecture')
    expect(prompt).toContain('Do NOT convert optional')
    expect(prompt).toContain('PRODUCT, SYSTEM, PROCESS, COMPOSITION')
  })
})
