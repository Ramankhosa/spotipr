import { describe, expect, it } from 'vitest'
import { explainFigurePlannerError } from '../figure-planner-error-guidance'

describe('figure planner error guidance', () => {
  it('explains invalid structured diagram output and its recovery', () => {
    const result = explainFigurePlannerError('Diagram LLM returned invalid structured data', 'diagram')

    expect(result.title).toContain('AI reply')
    expect(result.whatHappened).toContain('structured format')
    expect(result.autoRecovery).toContain('retries')
    expect(result.actions.join(' ')).toContain('Component Plan')
  })

  it('tells users that PlantUML repair was already attempted', () => {
    const result = explainFigurePlannerError('Figure 2 processing failed: PlantUML syntax error', 'render')

    expect(result.title).toContain('rendered')
    expect(result.autoRecovery).toContain('repair')
    expect(result.actions.join(' ')).toContain('Retry Render')
  })

  it('provides suggestion-specific recovery without losing saved work', () => {
    const result = explainFigurePlannerError('Failed to generate sketch suggestions', 'suggestion')

    expect(result.actions.join(' ')).toContain('Suggest views')
    expect(result.actions.join(' ')).toContain('Saved suggestions')
  })

  it('recognizes client-side input validation', () => {
    const result = explainFigurePlannerError('Please upload a sketch to refine', 'sketch')

    expect(result.title).toBe('More input is needed')
    expect(result.actions).toHaveLength(1)
  })
})
