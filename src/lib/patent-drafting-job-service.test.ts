import { describe, expect, it } from 'vitest'
import { buildAutomationIdeaText } from './patent-drafting-job-service'

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
