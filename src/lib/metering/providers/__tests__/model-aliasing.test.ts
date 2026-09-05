import { describe, expect, it, vi } from 'vitest'
import { OpenAIProvider } from '../openai-provider'
import { GeminiProvider } from '../gemini-provider'
import { ZAIProvider } from '../zai-provider'
import { AnthropicProvider } from '../anthropic-provider'
import { DeepSeekProvider } from '../deepseek-provider'
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

describe('Latest 2026 models (Claude 5 / GPT-5.6 / Gemini 3.x / DeepSeek V4)', () => {
  it('routes the new frontier model codes to their providers', () => {
    // Anthropic
    expect(getProviderFromModelCode('claude-fable-5')).toBe('anthropic')
    expect(getProviderFromModelCode('claude-opus-4-8')).toBe('anthropic')
    expect(getProviderFromModelCode('claude-sonnet-5')).toBe('anthropic')
    expect(getProviderFromModelCode('claude-haiku-4-5')).toBe('anthropic')
    // OpenAI GPT-5.6 family
    expect(getProviderFromModelCode('gpt-5.6')).toBe('openai')
    expect(getProviderFromModelCode('gpt-5.6-sol')).toBe('openai')
    expect(getProviderFromModelCode('gpt-5.6-terra')).toBe('openai')
    expect(getProviderFromModelCode('gpt-5.6-luna')).toBe('openai')
    // Gemini — flash-lite routes to the dedicated flash-lite provider
    expect(getProviderFromModelCode('gemini-3.5-flash')).toBe('gemini')
    expect(getProviderFromModelCode('gemini-3.1-pro-preview')).toBe('gemini')
    expect(getProviderFromModelCode('gemini-3.1-flash-lite')).toBe('gemini-flash-lite')
    // DeepSeek V4
    expect(getProviderFromModelCode('deepseek-v4-pro')).toBe('deepseek')
    expect(getProviderFromModelCode('deepseek-v4-flash')).toBe('deepseek')
    expect(getProviderFromModelCode('deepseek-v4-flash-vision-exp')).toBe('deepseek')
  })

  it('routes the newest Gemini / GLM codes to their providers', () => {
    expect(getProviderFromModelCode('gemini-3.8-flash')).toBe('gemini')
    expect(getProviderFromModelCode('gemini-3.7-flash')).toBe('gemini')
    expect(getProviderFromModelCode('gemini-3.6-flash')).toBe('gemini')
    expect(getProviderFromModelCode('gemini-3.5-flash-lite')).toBe('gemini-flash-lite')
    // Nano Banana image models
    expect(getProviderFromModelCode('gemini-3-pro-image')).toBe('gemini')
    expect(getProviderFromModelCode('gemini-3.1-flash-image')).toBe('gemini')
    expect(getProviderFromModelCode('gemini-3.1-flash-lite-image')).toBe('gemini')
    // Z.AI
    expect(getProviderFromModelCode('glm-5.3')).toBe('zai')
    expect(getProviderFromModelCode('glm-5.3-flash')).toBe('zai')
    expect(getProviderFromModelCode('glm-5.2')).toBe('zai')
  })

  it('routes Groq-hosted open-weight models to groq, not their upstream vendor', () => {
    // These carry an "openai/" prefix but are served by Groq. Without an exact-map
    // entry the prefix fallback would send them to the OpenAI provider.
    expect(getProviderFromModelCode('openai/gpt-oss-120b')).toBe('groq')
    expect(getProviderFromModelCode('openai/gpt-oss-20b')).toBe('groq')
  })

  it('OpenAIProvider exposes GPT-5.6 limits and pricing', () => {
    const p = new OpenAIProvider({ apiKey: 'x', baseURL: 'https://api.openai.com/v1', model: 'gpt-5.6-sol' })
    expect(p.getTokenLimits('gpt-5.6-sol')).toEqual({ input: 1050000, output: 128000 })
    expect(p.getCostPerToken('gpt-5.6-terra')).toEqual({ input: 0.000002, output: 0.000012 })
  })

  it('OpenAIProvider exposes GPT-6 Astra limits and pricing', () => {
    const p = new OpenAIProvider({ apiKey: 'x', baseURL: 'https://api.openai.com/v1', model: 'gpt-6-astra' })
    expect(getProviderFromModelCode('gpt-6-astra')).toBe('openai')
    expect(p.getTokenLimits('gpt-6-astra')).toEqual({ input: 1050000, output: 128000 })
    expect(p.getCostPerToken('gpt-6-astra')).toEqual({ input: 0.00001, output: 0.00005 })
    // the thinking alias normalizes to the base model
    expect(p.getCostPerToken('gpt-6-astra-thinking')).toEqual({ input: 0.00001, output: 0.00005 })
  })

  it('AnthropicProvider exposes Claude 5 family limits and pricing', () => {
    const p = new AnthropicProvider({ apiKey: 'x', baseURL: 'https://api.anthropic.com/v1', model: 'claude-opus-4-8' })
    expect(p.getTokenLimits('claude-opus-4-8')).toEqual({ input: 1000000, output: 128000 })
    expect(p.getTokenLimits('claude-haiku-4-5')).toEqual({ input: 200000, output: 64000 })
    expect(p.getCostPerToken('claude-sonnet-5')).toEqual({ input: 0.000002, output: 0.00001 })
  })

  it('AnthropicProvider exposes Opus 5 / Fable 5.1 / Sonnet 4.6 limits and pricing', () => {
    const p = new AnthropicProvider({ apiKey: 'x', baseURL: 'https://api.anthropic.com/v1', model: 'claude-opus-5' })
    expect(getProviderFromModelCode('claude-opus-5')).toBe('anthropic')
    expect(getProviderFromModelCode('claude-opus-5-thinking')).toBe('anthropic')
    expect(getProviderFromModelCode('claude-fable-5-1')).toBe('anthropic')
    expect(getProviderFromModelCode('claude-sonnet-4-6')).toBe('anthropic')
    expect(p.getTokenLimits('claude-opus-5')).toEqual({ input: 1000000, output: 128000 })
    expect(p.getCostPerToken('claude-opus-5')).toEqual({ input: 0.000005, output: 0.000025 })
    // the thinking alias normalizes to the base model
    expect(p.getCostPerToken('claude-opus-5-thinking')).toEqual({ input: 0.000005, output: 0.000025 })
    expect(p.getCostPerToken('claude-fable-5-1')).toEqual({ input: 0.00001, output: 0.00005 })
    expect(p.getCostPerToken('claude-sonnet-4-6')).toEqual({ input: 0.000003, output: 0.000015 })
  })

  it('DeepSeekProvider exposes V4 limits and pricing', () => {
    const p = new DeepSeekProvider({ apiKey: 'x', baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-v4-pro' })
    expect(p.getTokenLimits('deepseek-v4-pro')).toEqual({ input: 1000000, output: 65536 })
    expect(p.getCostPerToken('deepseek-v4-flash')).toEqual({ input: 0.00000009, output: 0.00000018 })
  })

  it('GeminiProvider exposes Gemini 3.x limits and pricing', () => {
    const p = new GeminiProvider({ apiKey: 'x', baseURL: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-3.5-flash' })
    expect(p.getTokenLimits('gemini-3.5-flash')).toEqual({ input: 1048576, output: 65536 })
    expect(p.getCostPerToken('gemini-3.1-pro-preview')).toEqual({ input: 0.000002, output: 0.000012 })
  })

  it('routes the claim-generation "thinking" aliases to their providers', () => {
    expect(getProviderFromModelCode('gpt-5.6-sol-thinking')).toBe('openai')
    expect(getProviderFromModelCode('gpt-5.6-terra-thinking')).toBe('openai')
    expect(getProviderFromModelCode('claude-opus-4-8-thinking')).toBe('anthropic')
  })

  it('providers normalize "thinking" aliases to base-model limits/costs', () => {
    const oa = new OpenAIProvider({ apiKey: 'x', baseURL: 'https://api.openai.com/v1', model: 'gpt-5.6-sol-thinking' })
    expect(oa.getTokenLimits('gpt-5.6-sol-thinking')).toEqual(oa.getTokenLimits('gpt-5.6-sol'))
    expect(oa.getCostPerToken('gpt-5.6-sol-thinking')).toEqual(oa.getCostPerToken('gpt-5.6-sol'))

    const an = new AnthropicProvider({ apiKey: 'x', baseURL: 'https://api.anthropic.com/v1', model: 'claude-opus-4-8-thinking' })
    expect(an.getTokenLimits('claude-opus-4-8-thinking')).toEqual(an.getTokenLimits('claude-opus-4-8'))
    expect(an.getCostPerToken('claude-opus-4-8-thinking')).toEqual(an.getCostPerToken('claude-opus-4-8'))
  })

  it('AnthropicProvider enables adaptive thinking (no temperature, floored max_tokens) for -thinking aliases', async () => {
    const p = new AnthropicProvider({ apiKey: 'x', baseURL: 'https://api.anthropic.com/v1', model: 'claude-opus-4-8-thinking' })
    const captured: any[] = []
    ;(p as any).client = {
      messages: {
        create: async (body: any) => {
          captured.push(body)
          return { content: [{ type: 'text', text: 'claims' }], usage: { input_tokens: 10, output_tokens: 5 }, stop_reason: 'end_turn' }
        },
      },
    }

    await p.execute(
      { prompt: 'Draft initial patent claims', modelClass: 'claude-opus-4-8-thinking' } as any,
      { maxTokensOut: 16000 } as any,
    )

    const body = captured[0]
    expect(body.model).toBe('claude-opus-4-8')            // -thinking stripped for the API call
    expect(body.thinking).toEqual({ type: 'adaptive' })   // adaptive thinking turned on
    expect(body.temperature).toBeUndefined()              // never sent with thinking / Opus 4.x
    expect(body.max_tokens).toBeGreaterThanOrEqual(24000) // floored above the 16K stage limit
  })

  it('AnthropicProvider does NOT enable thinking for the plain (non-thinking) model', async () => {
    const p = new AnthropicProvider({ apiKey: 'x', baseURL: 'https://api.anthropic.com/v1', model: 'claude-opus-4-8' })
    const captured: any[] = []
    ;(p as any).client = {
      messages: {
        create: async (body: any) => {
          captured.push(body)
          return { content: [{ type: 'text', text: 'x' }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' }
        },
      },
    }

    await p.execute(
      { prompt: 'Draft the field of invention', modelClass: 'claude-opus-4-8' } as any,
      { maxTokensOut: 4000 } as any,
    )

    expect(captured[0].thinking).toBeUndefined()
    expect(captured[0].max_tokens).toBe(4000)
  })

  it('LLMGateway recognizes the new models for preflight limits and vision', async () => {
    vi.stubEnv('GOOGLE_AI_API_KEY', '')
    vi.stubEnv('OPENAI_API_KEY', '')
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    vi.stubEnv('DEEPSEEK_API_KEY', '')

    const { LLMGateway } = await import('../../gateway')
    const gateway = new LLMGateway()
    expect(gateway.getModelContextLimits('gpt-5.6-sol')).toEqual({ maxInput: 1050000, maxOutput: 128000 })
    expect(gateway.getModelContextLimits('claude-opus-4-8')).toEqual({ maxInput: 1000000, maxOutput: 128000 })
    expect(gateway.getModelContextLimits('gemini-3.1-pro-preview')).toEqual({ maxInput: 2000000, maxOutput: 65536 })
    expect(gateway.getModelContextLimits('deepseek-v4-pro')).toEqual({ maxInput: 1000000, maxOutput: 65536 })
    expect(gateway.isModelVisionCapable('claude-sonnet-5')).toBe(true)
    expect(gateway.isModelVisionCapable('gpt-5.6-sol')).toBe(true)
    expect(gateway.isModelVisionCapable('gemini-3.5-flash')).toBe(true)

    vi.unstubAllEnvs()
  })
})


