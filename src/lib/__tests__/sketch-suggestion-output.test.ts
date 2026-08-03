import { describe, expect, it } from 'vitest'
import {
  buildSketchSuggestionCorrectionPrompt,
  parseSketchSuggestionOutput,
} from '../sketch-suggestion-output'

describe('sketch suggestion structured output', () => {
  it('extracts and trims a JSON array wrapped in model commentary', () => {
    const result = parseSketchSuggestionOutput(`Here are the views:\n[{
      "title": " Front view ",
      "description": " Show housing 100 "
    }]`)

    expect(result).toEqual({
      suggestions: [{ title: 'Front view', description: 'Show housing 100' }],
      parsedCleanly: true,
      droppedForMissingFields: 0,
    })
  })

  it('distinguishes a valid empty decision from unreadable output', () => {
    expect(parseSketchSuggestionOutput('[]')).toMatchObject({ parsedCleanly: true, suggestions: [] })
    expect(parseSketchSuggestionOutput('I cannot format this')).toMatchObject({ parsedCleanly: false, suggestions: [] })
  })

  it('reports incomplete items so the caller can initiate correction', () => {
    const result = parseSketchSuggestionOutput('[{"title":"Front"},{"title":"Rear","description":"Rear view"}]')

    expect(result.suggestions).toEqual([{ title: 'Rear', description: 'Rear view' }])
    expect(result.droppedForMissingFields).toBe(1)
  })

  it('creates a strict correction request and bounds echoed model output', () => {
    const prompt = buildSketchSuggestionCorrectionPrompt('ORIGINAL', 'x'.repeat(13000))

    expect(prompt).toContain('Return ONLY a valid JSON array')
    expect(prompt.length).toBeLessThan(12500)
  })
})
