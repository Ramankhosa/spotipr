import { describe, expect, it } from 'vitest'

import { isTruncatedLlmResponse, parseLlmJsonObject } from '@/lib/llm-json-parser'

describe('parseLlmJsonObject', () => {
  it('parses a plain JSON object', () => {
    const result = parseLlmJsonObject({ output: '{"a": 1, "b": "two"}' })
    expect(result).toEqual({ ok: true, data: { a: 1, b: 'two' } })
  })

  it('strips a fenced code block with a json language tag', () => {
    const result = parseLlmJsonObject({ output: 'Here you go:\n```json\n{"a": 1}\n```\nDone.' })
    expect(result).toEqual({ ok: true, data: { a: 1 } })
  })

  it('strips an unterminated fence', () => {
    const result = parseLlmJsonObject({ output: '```json\n{"a": 1}' })
    expect(result).toEqual({ ok: true, data: { a: 1 } })
  })

  it('trims prose around the outermost braces', () => {
    const result = parseLlmJsonObject({ output: 'Sure! {"a": {"nested": true}} hope that helps' })
    expect(result).toEqual({ ok: true, data: { a: { nested: true } } })
  })

  it('removes trailing commas', () => {
    const result = parseLlmJsonObject({ output: '{"a": [1, 2,], "b": 3,}' })
    expect(result).toEqual({ ok: true, data: { a: [1, 2], b: 3 } })
  })

  it('quotes unquoted keys as a fallback', () => {
    const result = parseLlmJsonObject({ output: '{a: 1, b_two: "x"}' })
    expect(result).toEqual({ ok: true, data: { a: 1, b_two: 'x' } })
  })

  it('converts single-quoted values in the last-resort fallback', () => {
    const result = parseLlmJsonObject({ output: "{a: 'one', b: 'two'}" })
    expect(result).toEqual({ ok: true, data: { a: 'one', b: 'two' } })
  })

  it('fails closed on non-JSON output', () => {
    const result = parseLlmJsonObject({ output: 'not json at all' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.truncated).toBe(false)
      expect(result.error).toBeTruthy()
    }
  })

  it('rejects a top-level array', () => {
    const result = parseLlmJsonObject({ output: '[1, 2, 3]' })
    expect(result.ok).toBe(false)
  })

  it('flags truncation from provider metadata on failure', () => {
    const gemini = parseLlmJsonObject({ output: '{"a": "unterminated', metadata: { finishReason: 'MAX_TOKENS' } })
    expect(gemini.ok).toBe(false)
    if (!gemini.ok) expect(gemini.truncated).toBe(true)

    const anthropic = parseLlmJsonObject({ output: '{"a": "unterminated', metadata: { stopReason: 'max_tokens' } })
    expect(anthropic.ok).toBe(false)
    if (!anthropic.ok) expect(anthropic.truncated).toBe(true)
  })

  it('handles empty output', () => {
    const result = parseLlmJsonObject({ output: '' })
    expect(result.ok).toBe(false)
  })
})

describe('isTruncatedLlmResponse', () => {
  it('detects each provider convention', () => {
    expect(isTruncatedLlmResponse({ finishReason: 'MAX_TOKENS' })).toBe(true)
    expect(isTruncatedLlmResponse({ finishReason: 'length' })).toBe(true)
    expect(isTruncatedLlmResponse({ stopReason: 'max_tokens' })).toBe(true)
    expect(isTruncatedLlmResponse({ finishReason: 'stop' })).toBe(false)
    expect(isTruncatedLlmResponse(undefined)).toBe(false)
  })
})
