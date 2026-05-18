import { describe, expect, it, vi } from 'vitest'
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
    expect(getProviderFromModelCode('glm-4.5')).toBe('zai')
  })

  it('ZAIProvider exposes GLM-5 family limits and pricing', () => {
    const p = new ZAIProvider({ apiKey: 'x', baseURL: 'https://api.z.ai/api/paas/v4', model: 'glm-5.1' })
    expect(p.getTokenLimits('glm-5.1')).toEqual({ input: 200000, output: 128000 })
    expect(p.getCostPerToken('glm-5')).toEqual({ input: 0.000001, output: 0.0000032 })
  })

  it('ZAIProvider exposes GLM-4.5 family limits and pricing', () => {
    const p = new ZAIProvider({ apiKey: 'x', baseURL: 'https://api.z.ai/api/paas/v4', model: 'glm-4.5' })
    expect(p.getTokenLimits('glm-4.5')).toEqual({ input: 128000, output: 96000 })
    expect(p.getTokenLimits('glm-4.5v')).toEqual({ input: 128000, output: 16000 })
    expect(p.getCostPerToken('glm-4.5')).toEqual({ input: 0.0000002, output: 0.0000011 })
  })

  it('LLMGateway preflight limits do not clamp GLM and GPT-5.5 to safe defaults', async () => {
    vi.stubEnv('GOOGLE_AI_API_KEY', '')
    vi.stubEnv('GOOGLE_API_KEY', '')
    vi.stubEnv('OPENAI_API_KEY', '')
    vi.stubEnv('ZAI_API_KEY', '')
    vi.stubEnv('ZHIPU_API_KEY', '')
    vi.stubEnv('GLM_API_KEY', '')
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    vi.stubEnv('DEEPSEEK_API_KEY', '')
    vi.stubEnv('GROQ_API_KEY', '')

    const { LLMGateway } = await import('../../gateway')
    const gateway = new LLMGateway()
    expect(gateway.getModelContextLimits('glm-5.1')).toEqual({ maxInput: 200000, maxOutput: 128000 })
    expect(gateway.getModelContextLimits('glm-4.5')).toEqual({ maxInput: 128000, maxOutput: 96000 })
    expect(gateway.getModelContextLimits('gpt-5.5')).toEqual({ maxInput: 1050000, maxOutput: 128000 })
    expect(gateway.isModelVisionCapable('glm-5v-turbo')).toBe(true)

    vi.unstubAllEnvs()
  })
})


