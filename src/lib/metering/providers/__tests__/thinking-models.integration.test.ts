import { describe, expect, it, vi, afterEach } from 'vitest'
import { getProviderFromModelCode } from '../llm-provider'
import { OpenAIProvider } from '../openai-provider'
import { AnthropicProvider } from '../anthropic-provider'

/**
 * End-to-end (transport-mocked) proof that the claim-generation "thinking" models
 * actually get through the provider stack.
 *
 * Root cause of the earlier "not getting through": a `-thinking` model code was sent
 * to the provider VERBATIM. OpenAI already normalized `-thinking` → base model, but the
 * Anthropic provider had no normalization, so `claude-opus-4-8-thinking` was passed as a
 * model ID and rejected (404 model_not_found). These tests lock in the fix: the outgoing
 * request always uses the BASE model id, thinking is enabled correctly, and output flows back.
 */

// Replace the Anthropic SDK client with a stub that records the request body.
function stubAnthropicClient(p: AnthropicProvider, response: any): any[] {
  const captured: any[] = []
  ;(p as any).client = {
    messages: {
      create: async (body: any) => {
        captured.push(body)
        return response
      },
    },
  }
  return captured
}

describe('Thinking models get through the provider stack', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('resolves the claim-generation thinking aliases to the correct provider', () => {
    expect(getProviderFromModelCode('claude-opus-4-8-thinking')).toBe('anthropic')
    expect(getProviderFromModelCode('gpt-5.6-sol-thinking')).toBe('openai')
    expect(getProviderFromModelCode('gpt-5.6-terra-thinking')).toBe('openai')
  })

  it('Anthropic Opus 4.8 thinking: base model id, adaptive thinking on, text extracted (thinking block ignored)', async () => {
    const p = new AnthropicProvider({ apiKey: 'test', baseURL: 'https://api.anthropic.com/v1', model: 'claude-opus-4-8-thinking' })
    const captured = stubAnthropicClient(p, {
      content: [
        { type: 'thinking', thinking: 'Weigh independent vs dependent claim scope...' },
        { type: 'text', text: '1. A method comprising: receiving data; and processing the data.' },
      ],
      usage: { input_tokens: 320, output_tokens: 140 },
      stop_reason: 'end_turn',
    })

    const res = await p.execute(
      { prompt: 'Generate initial patent claims for the invention', modelClass: 'claude-opus-4-8-thinking' } as any,
      { maxTokensOut: 16000 } as any,
    )

    // The request that WOULD hit the API is valid (this is what previously 404'd):
    expect(captured[0].model).toBe('claude-opus-4-8') // NOT 'claude-opus-4-8-thinking'
    expect(captured[0].thinking).toEqual({ type: 'adaptive' })
    expect(captured[0].temperature).toBeUndefined()
    expect(captured[0].max_tokens).toBeGreaterThanOrEqual(24000)
    // Output flows back; the thinking block is excluded from the answer:
    expect(res.output).toBe('1. A method comprising: receiving data; and processing the data.')
    expect(res.output).not.toContain('Weigh independent vs dependent')
    expect(res.modelClass).toBe('claude-opus-4-8-thinking') // preserved for cost logging
  })

  it('OpenAI GPT-5.6 Sol thinking: base model id, max_completion_tokens + reasoning_effort=high, no temperature, output flows back', async () => {
    const fetchMock = vi.fn(async (_url: unknown, _init: unknown) => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '1. A system comprising a processor configured to receive and classify data.' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 300, completion_tokens: 180, total_tokens: 480, completion_tokens_details: { reasoning_tokens: 60 } },
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const p = new OpenAIProvider({ apiKey: 'test', baseURL: 'https://api.openai.com/v1', model: 'gpt-5.6-sol-thinking' })
    const res = await p.execute(
      { prompt: 'Generate initial patent claims', modelClass: 'gpt-5.6-sol-thinking' } as any,
      { maxTokensOut: 16000 } as any,
    )

    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body)
    expect(body.model).toBe('gpt-5.6-sol') // -thinking stripped
    expect(body.max_completion_tokens).toBeGreaterThanOrEqual(25000) // reasoning floor prevents empty output
    expect(body.max_tokens).toBeUndefined() // reasoning models must NOT use max_tokens
    expect(body.temperature).toBeUndefined() // reasoning models reject temperature (400 otherwise)
    expect(body.reasoning_effort).toBe('high') // thinking alias → high effort
    expect(res.output).toContain('A system comprising a processor')
  })

  it('OpenAI reasoning model surfaces the empty-output failure instead of returning blank (the "not getting through" symptom)', async () => {
    // Reasoning consumed the whole budget → empty content with finish_reason 'length'.
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '' }, finish_reason: 'length' }],
        usage: { prompt_tokens: 300, completion_tokens: 25000, total_tokens: 25300, completion_tokens_details: { reasoning_tokens: 25000 } },
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const p = new OpenAIProvider({ apiKey: 'test', baseURL: 'https://api.openai.com/v1', model: 'gpt-5.6-sol-thinking' })
    await expect(
      p.execute({ prompt: 'Generate claims', modelClass: 'gpt-5.6-sol-thinking' } as any, { maxTokensOut: 16000 } as any),
    ).rejects.toThrow(/no visible output|reasoning/i)
  })
})
