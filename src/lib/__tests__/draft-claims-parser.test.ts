import { describe, expect, test } from 'vitest'
import {
  DraftClaimsParseError,
  formatDraftClaimsAsHtml,
  parseGeneratedClaimsFromLLMOutput,
  parseGeneratedClaimsPayloadFromLLMOutput,
  stripTrailingClaimDependencyLabelsFromHtml,
} from '@/lib/draft-claims-parser'

describe('draft claims parser', () => {
  test('parses normal claims JSON objects', () => {
    const claims = parseGeneratedClaimsFromLLMOutput(JSON.stringify({
      claims: [
        { number: 1, type: 'independent', category: 'system', text: 'A system comprising a controller.' },
        { number: 2, type: 'dependent', dependsOn: 1, category: 'system', text: 'The system of claim 1, wherein the controller filters signals.' },
      ],
    }))

    expect(claims).toHaveLength(2)
    expect(claims[0]).toMatchObject({ number: 1, type: 'independent', category: 'system' })
    expect(claims[1]).toMatchObject({ number: 2, type: 'dependent', dependsOn: 1 })
  })

  test('preserves explicit dependent type without dependsOn', () => {
    const claims = parseGeneratedClaimsFromLLMOutput(JSON.stringify({
      claims: [
        { number: 1, type: 'independent claim', text: 'A system comprising a controller.' },
        { number: 2, type: 'dependent claim', text: 'The system of any preceding claim, wherein the controller filters signals.' },
      ],
    }))

    expect(claims[1]).toMatchObject({ number: 2, type: 'dependent' })
    expect(claims[1]).not.toHaveProperty('dependsOn')
  })

  test('preserves explicit independent type even when text contains dependency-like wording', () => {
    const claims = parseGeneratedClaimsFromLLMOutput(JSON.stringify({
      claims: [
        { number: 1, type: 'independent', text: 'A claim processing system configured to analyze preceding claim data.' },
        { number: 2, type: 'ind', text: 'A method for analyzing claim 1 metadata in a data repository.' },
      ],
    }))

    expect(claims[0]).toMatchObject({ number: 1, type: 'independent' })
    expect(claims[1]).toMatchObject({ number: 2, type: 'independent' })
  })

  test('normalizes compact LLM claim type aliases', () => {
    const claims = parseGeneratedClaimsFromLLMOutput(JSON.stringify({
      claims: [
        { number: 1, type: 'I', text: 'A system comprising a controller.' },
        { number: 2, type: 'D', text: 'The system of claim 1, wherein the controller filters signals.' },
        { number: 3, type: 'dep', text: 'The system of claim 1, wherein the controller stores signals.' },
      ],
    }))

    expect(claims.map(claim => claim.type)).toEqual(['independent', 'dependent', 'dependent'])
  })

  test('extracts JSON from markdown and surrounding text', () => {
    const claims = parseGeneratedClaimsFromLLMOutput(`
Here is the claim set:

\`\`\`json
{
  claims: [
    {
      number: 1,
      type: "independent",
      category: "method",
      text: "A method for controlling irrigation comprising measuring soil moisture."
    },
  ]
}
\`\`\`
`)

    expect(claims).toHaveLength(1)
    expect(claims[0].text).toContain('controlling irrigation')
  })

  test('parses numbered claim text when JSON parsing is not possible', () => {
    const claims = parseGeneratedClaimsFromLLMOutput(`
1. A device comprising a sensor and a processor configured to classify a signal.

2. The device of claim 1, wherein the processor generates an alert.
`)

    expect(claims).toHaveLength(2)
    expect(claims[0]).toMatchObject({ number: 1, type: 'independent', category: 'apparatus' })
    expect(claims[1]).toMatchObject({ number: 2, type: 'dependent', dependsOn: 1 })
  })

  test('keeps text-only recovery conservative for later claims', () => {
    const claims = parseGeneratedClaimsFromLLMOutput(`
1. A device comprising a sensor.

2. A method comprising receiving a sensor signal.
`)

    expect(claims[0]).toMatchObject({ number: 1, type: 'independent' })
    expect(claims[1]).toMatchObject({ number: 2, type: 'dependent' })
  })

  test('escapes newlines inside JSON strings', () => {
    const claims = parseGeneratedClaimsFromLLMOutput(`{
  "claims": [
    {
      "number": 1,
      "type": "independent",
      "text": "A method comprising:
      receiving sensor data;
      producing an output."
    }
  ]
}`)

    expect(claims).toHaveLength(1)
    expect(claims[0].text).toContain('receiving sensor data')
  })

  test('throws when no claim content can be recovered', () => {
    expect(() => parseGeneratedClaimsFromLLMOutput('No claims can be generated.')).toThrow(DraftClaimsParseError)
  })

  test('formats parsed claims as editor HTML', () => {
    const html = formatDraftClaimsAsHtml([
      { number: 1, type: 'independent', text: 'A system comprising a controller.' },
    ])

    expect(html).toBe('<p><strong>1.</strong> A system comprising a controller.</p>')
  })

  test('removes generated trailing claim dependency labels only', () => {
    const html = stripTrailingClaimDependencyLabelsFromHtml(
      '<p><strong>2.</strong> The system of claim 1, wherein the controller filters signals. (Claim 1)</p>'
    )

    expect(html).toBe('<p><strong>2.</strong> The system of claim 1, wherein the controller filters signals.</p>')
  })

  test('parses support matrix and quality warnings from claims JSON', () => {
    const payload = parseGeneratedClaimsPayloadFromLLMOutput(JSON.stringify({
      claims: [
        { number: 1, type: 'independent', category: 'system', text: 'A system comprising a moisture sensor and a valve.' },
      ],
      supportMatrix: [
        {
          claimNumber: 1,
          supportRefs: ['SF-componentsAndSubcomponents-1'],
          supportSummary: 'Supported by source components.',
          sourceFields: ['components'],
        },
      ],
      qualityWarnings: ['Review breadth of Claim 1.'],
    }))

    expect(payload.claims).toHaveLength(1)
    expect(payload.supportMatrix[0]).toMatchObject({
      claimNumber: 1,
      supportRefs: ['SF-componentsAndSubcomponents-1'],
      sourceFields: ['components'],
    })
    expect(payload.qualityWarnings).toContain('Review breadth of Claim 1.')
  })
})
