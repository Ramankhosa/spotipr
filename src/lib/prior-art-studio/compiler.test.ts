import { describe, expect, it } from 'vitest'
import { compileStudioPlan } from './compiler'
import { emptyStudioPlan } from './types'

describe('compileStudioPlan MATCH groups', () => {
  it('keeps broad recall terms while carrying MATCH blocks as structured AND groups', () => {
    const plan = emptyStudioPlan()
    plan.title = 'Optical controller'
    plan.blocks = [
      {
        id: 'sensor',
        label: 'Sensor',
        mode: 'MATCH',
        terms: [
          { text: 'optical sensor', origin: 'user', accepted: true },
          { text: 'photodetector', origin: 'user', accepted: true },
        ],
      },
      {
        id: 'control',
        label: 'Control',
        mode: 'MATCH',
        terms: [{ text: 'feedback controller', origin: 'user', accepted: true }],
      },
      {
        id: 'expansion',
        label: 'Meaning',
        mode: 'EXPAND',
        terms: [{ text: 'adaptive calibration', origin: 'user', accepted: true }],
      },
    ]

    const compiled = compileStudioPlan(plan)
    expect(compiled.queryPlan.searchQuery).toContain('"optical sensor" OR photodetector')
    expect(compiled.queryPlan.literalMatchGroups).toEqual([
      { id: 'sensor', label: 'Sensor', terms: ['optical sensor', 'photodetector'] },
      { id: 'control', label: 'Control', terms: ['feedback controller'] },
    ])
    expect(compiled.queryPlan.retrievalQueries?.some(query => query.text.includes('adaptive calibration'))).toBe(true)
  })
})
