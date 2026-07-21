import { describe, expect, it } from 'vitest'
import { emptyStudioPlan } from './types'
import { STUDIO_PLAN_MAX_BYTES, validateStudioPlan } from './plan-schema'

describe('validateStudioPlan', () => {
  it('accepts existing valid Studio plans', () => {
    const plan = emptyStudioPlan()
    plan.title = 'Adaptive optical sensor'
    plan.blocks.push({
      id: 'block-1',
      label: 'Sensor',
      mode: 'BOTH',
      terms: [{ text: 'optical sensor', origin: 'user', accepted: true }],
    })

    const result = validateStudioPlan(plan)
    expect(result.success).toBe(true)
    if (result.success) expect(result.plan).toEqual(plan)
  })

  it('returns field-level errors for malformed and over-bounded plans', () => {
    const plan = emptyStudioPlan()
    plan.blocks = Array.from({ length: 21 }, (_, index) => ({
      id: `block-${index}`,
      label: `Block ${index}`,
      mode: 'MATCH' as const,
      terms: [],
    }))

    const result = validateStudioPlan(plan)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.fields).toContainEqual(expect.objectContaining({ path: 'blocks' }))
  })

  it('rejects JSON larger than 256 KB before schema parsing', () => {
    const value = { ...emptyStudioPlan(), padding: 'x'.repeat(STUDIO_PLAN_MAX_BYTES) }
    const result = validateStudioPlan(value)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toContain('256 KB')
      expect(result.fields).toEqual([])
    }
  })

  it('rejects invalid date ranges', () => {
    const plan = emptyStudioPlan()
    plan.filters.publicationDateFrom = '2026-05-10'
    plan.filters.publicationDateTo = '2026-05-01'
    const result = validateStudioPlan(plan)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.fields).toContainEqual(expect.objectContaining({ path: 'filters.publicationDateTo' }))
    }
  })
})
