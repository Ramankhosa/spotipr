import { describe, expect, it } from 'vitest'
import { stableJson } from '../types'

/**
 * stableJson exists to compare in-memory values against their Postgres jsonb
 * round-trip, and jsonb reorders object keys. These tests pin the exact
 * properties that comparison depends on.
 */
describe('stableJson', () => {
  it('produces identical output whatever the object key order', () => {
    const a = { title: 'x', filters: { yearFrom: 2000, yearTo: 2026 }, concepts: [1, 2] }
    const b = { concepts: [1, 2], filters: { yearTo: 2026, yearFrom: 2000 }, title: 'x' }

    expect(stableJson(a)).toBe(stableJson(b))
  })

  it('sorts keys recursively, the way jsonb reorders at every depth', () => {
    const stored = { values: [{ synonyms: ['a'], label: 'v' }], label: 'd' }
    const inMemory = { label: 'd', values: [{ label: 'v', synonyms: ['a'] }] }

    expect(stableJson(stored)).toBe(stableJson(inMemory))
  })

  it('preserves array order — element order is meaning, not storage noise', () => {
    expect(stableJson([1, 2])).not.toBe(stableJson([2, 1]))
  })

  it('drops undefined-valued keys exactly as JSON.stringify would on the way into jsonb', () => {
    expect(stableJson({ a: 1, b: undefined })).toBe(stableJson({ a: 1 }))
  })

  it('handles primitives and null like JSON.stringify', () => {
    expect(stableJson(null)).toBe('null')
    expect(stableJson('x')).toBe('"x"')
    expect(stableJson(3)).toBe('3')
    expect(stableJson(true)).toBe('true')
  })

  it('distinguishes values that genuinely differ', () => {
    expect(stableJson({ a: 1 })).not.toBe(stableJson({ a: 2 }))
    expect(stableJson({ a: 1 })).not.toBe(stableJson({ a: 1, b: 1 }))
  })
})
