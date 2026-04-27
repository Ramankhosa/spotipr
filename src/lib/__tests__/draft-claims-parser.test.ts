import { describe, expect, test } from 'vitest'
import {
  DraftClaimsParseError,
  formatDraftClaimsAsHtml,
  parseGeneratedClaimsFromLLMOutput,
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
})
