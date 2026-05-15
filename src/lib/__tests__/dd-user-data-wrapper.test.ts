import { describe, expect, test } from 'vitest'
import {
  DD_USER_DATA_DISPLAY_WRAPPER,
  DD_USER_DATA_LLM_WRAPPER,
} from '@/lib/dd-user-data-wrapper'

describe('DD user-data wrappers', () => {
  test('keeps display and LLM wrappers explicit and shared', () => {
    expect(DD_USER_DATA_DISPLAY_WRAPPER).toContain('LEGAL NOTICE')
    expect(DD_USER_DATA_LLM_WRAPPER).toContain('ANTI-HALLUCINATION DIRECTIVE')
    expect(DD_USER_DATA_LLM_WRAPPER).toContain('ILLUSTRATIVE DATA')
  })
})
