import { describe, expect, test } from 'vitest'
import {
  DD_USER_DATA_DISPLAY_WRAPPER,
  DD_USER_DATA_LLM_WRAPPER,
  DD_USER_DATA_TABLE_LLM_WRAPPER,
  getDdUserDataLlmWrapper,
} from '@/lib/dd-user-data-wrapper'

describe('DD user-data wrappers', () => {
  test('keeps display and LLM wrappers explicit and shared', () => {
    expect(DD_USER_DATA_DISPLAY_WRAPPER).toContain('LEGAL NOTICE')
    expect(DD_USER_DATA_LLM_WRAPPER).toContain('ANTI-HALLUCINATION DIRECTIVE')
    expect(DD_USER_DATA_LLM_WRAPPER).toContain('ILLUSTRATIVE DATA')
  })

  test('prose mode flattens tabular data to a descriptive listing', () => {
    expect(DD_USER_DATA_LLM_WRAPPER).toContain('descriptive listing only')
    expect(DD_USER_DATA_LLM_WRAPPER).not.toContain('Markdown table')
  })

  test('table mode reproduces tabular data verbatim as Markdown tables', () => {
    expect(DD_USER_DATA_TABLE_LLM_WRAPPER).toContain('Markdown table')
    expect(DD_USER_DATA_TABLE_LLM_WRAPPER).toContain('VERBATIM')
    expect(DD_USER_DATA_TABLE_LLM_WRAPPER).toContain('Table N')
    expect(DD_USER_DATA_TABLE_LLM_WRAPPER).not.toContain('descriptive listing only')
  })

  test('both modes keep the safety directives intact', () => {
    for (const wrapper of [DD_USER_DATA_LLM_WRAPPER, DD_USER_DATA_TABLE_LLM_WRAPPER]) {
      expect(wrapper).toContain('ANTI-HALLUCINATION DIRECTIVE')
      expect(wrapper).toContain('NON-GENERALIZATION RULE')
      expect(wrapper).toContain('SECTION SCOPE LIMITATION')
      expect(wrapper).toContain('does not limit the invention')
    }
  })

  test('getDdUserDataLlmWrapper selects by mode', () => {
    expect(getDdUserDataLlmWrapper(false)).toBe(DD_USER_DATA_LLM_WRAPPER)
    expect(getDdUserDataLlmWrapper(true)).toBe(DD_USER_DATA_TABLE_LLM_WRAPPER)
  })
})
