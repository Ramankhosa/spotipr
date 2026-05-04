import { describe, expect, test } from 'vitest'
import {
  buildSourceFactLedgerPromptBlock,
  completeSourceFactLedger,
  extractPatentCriticalSourceFacts,
  sourceMentionsBestMethod,
} from '@/lib/source-fact-ledger'

describe('source fact ledger helpers', () => {
  test('extracts patent-critical values, conditions, alternatives, expiry, and fallback rules', () => {
    const rawIdea = [
      'A valve has spring preload 5-8 N with an optional ratchet lock.',
      'Confidence below 0.72 triggers manual review and cache expires after 24 hours.',
      'The reaction runs at 80 C for 2 hours using ethanol or methanol.',
      'Soil moisture below 18 percent activates drip irrigation unless rain is forecast.',
      'Battery cutoff at 3.2 V and thermal shutdown above 70 C are used for safety.',
    ].join(' ')

    const candidates = extractPatentCriticalSourceFacts(rawIdea)
    const values = candidates.map(candidate => candidate.value)

    expect(values).toContain('5-8 N')
    expect(values.some(value => value.includes('0.72'))).toBe(true)
    expect(values).toContain('24 hours')
    expect(values).toContain('80 C')
    expect(values).toContain('2 hours')
    expect(values).toContain('18 percent')
    expect(values).toContain('3.2 V')
    expect(values).toContain('70 C')
    expect(values.some(value => value.includes('optional ratchet lock'))).toBe(true)
    expect(values.some(value => value.includes('unless rain is forecast'))).toBe(true)
    expect(values.some(value => value.includes('thermal shutdown'))).toBe(true)
  })

  test('adds advisory warnings and backfills missing source candidates into the ledger', () => {
    const rawIdea = 'A pump operates at 12 L/min and uses fallback manual mode if sensor confidence below 0.72.'
    const review = completeSourceFactLedger(rawIdea, {
      problem: 'Pump controller',
      sourceFactLedger: {},
    })

    expect(review.normalizationReviewWarnings.some(warning => warning.includes('12 L/min'))).toBe(true)
    expect(review.normalizationReviewWarnings.some(warning => warning.includes('0.72'))).toBe(true)
    expect(review.sourceFactLedger.numericValuesAndUnits).toContain('12 L/min')
    expect(review.sourceFactLedger.safetyFallbackOrExpiryRules.some(item => item.includes('fallback manual mode'))).toBe(true)
  })

  test('does not warn when a candidate is already present in normalized output', () => {
    const review = completeSourceFactLedger('Battery cutoff at 3.2 V.', {
      logic: 'Battery cutoff at 3.2 V.',
      sourceFactLedger: {},
    })

    expect(review.normalizationReviewWarnings).toHaveLength(0)
  })

  test('detects explicitly stated best method language only', () => {
    expect(sourceMentionsBestMethod('The preferred implementation uses a ceramic filter.')).toBe(true)
    expect(sourceMentionsBestMethod('The device may include a ceramic filter.')).toBe(false)
  })

  test('formats a prompt block for downstream source support', () => {
    const block = buildSourceFactLedgerPromptBlock({
      numericValuesAndUnits: ['5-8 N'],
      alternativesAndEmbodiments: ['optional ratchet lock'],
    })

    expect(block).toContain('SOURCE FACT LEDGER')
    expect(block).toContain('SF-numericValuesAndUnits-1')
    expect(block).toContain('5-8 N')
    expect(block).toContain('optional ratchet lock')
    expect(block).toContain('do not convert optional facts into mandatory claim elements')
  })
})
