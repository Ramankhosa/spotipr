import { describe, expect, it } from 'vitest'
import { OpenAIProvider } from '../openai-provider'
import { GeminiProvider } from '../gemini-provider'
import { ZAIProvider } from '../zai-provider'
import { getProviderFromModelCode } from '../llm-provider'

describe('Provider model aliasing', () => {
  it('OpenAIProvider normalizes *-thinking to base model', () => {
    const p = new OpenAIProvider({ apiKey: 'x', baseURL: 'https://api.openai.com/v1', model: 'gpt-5.2-thinking' })
    // Accessing private via bracket is not allowed; validate via token/cost tables normalization behavior instead.
    expect(p.getTokenLimits('gpt-5.2-thinking')).toEqual(p.getTokenLimits('gpt-5.2'))
    expect(p.getCostPerToken('gpt-5.2-thinking')).toEqual(p.getCostPerToken('gpt-5.2'))
  })

  it('GeminiProvider maps gemini-3-pro-preview-thinking to gemini-3-pro-preview for limits/costs', () => {
    // We don’t execute network calls here; only verify mapping in helper methods.
    const p = new GeminiProvider({ apiKey: 'x', baseURL: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-3-pro-preview-thinking' })
    expect(p.getTokenLimits('gemini-3-pro-preview-thinking')).toEqual(p.getTokenLimits('gemini-3-pro-preview'))
    expect(p.getCostPerToken('gemini-3-pro-preview-thinking')).toEqual(p.getCostPerToken('gemini-3-pro-preview'))
  })

  it('routes current frontier model codes to their providers', () => {
    expect(getProviderFromModelCode('gpt-5.5')).toBe('openai')
    expect(getProviderFromModelCode('gpt-5.4-pro')).toBe('openai')
    expect(getProviderFromModelCode('claude-opus-4-6')).toBe('anthropic')
    expect(getProviderFromModelCode('glm-5.1')).toBe('zai')
  })

  it('ZAIProvider exposes GLM-5 family limits and pricing', () => {
    const p = new ZAIProvider({ apiKey: 'x', baseURL: 'https://api.z.ai/api/paas/v4', model: 'glm-5.1' })
    expect(p.getTokenLimits('glm-5.1')).toEqual({ input: 200000, output: 128000 })
    expect(p.getCostPerToken('glm-5')).toEqual({ input: 0.000001, output: 0.0000032 })
  })
})


