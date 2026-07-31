import { describe, expect, it, vi, afterEach } from 'vitest'
import { OpenAIProvider } from '../openai-provider'
import { getProviderFromModelCode } from '../llm-provider'

// Exercises the OpenAI reasoning-model request path (o-series + GPT-5) by mocking
// global.fetch and asserting the outgoing request shape and failure handling, without
// making a real API call.

const BASE = 'https://api.openai.com/v1'

function makeProvider(model: string) {
  return new OpenAIProvider({ apiKey: 'test-key', baseURL: BASE, model })
}

function mockFetch(responseBody: any, opts: { ok?: boolean; status?: number } = {}) {
  const fn = vi.fn(async () => ({
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    json: async () => responseBody,
    text: async () => JSON.stringify(responseBody),
  }))
  ;(global as any).fetch = fn
  return fn
}

const chatOk = {
  choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }],
  usage: { completion_tokens: 5, prompt_tokens: 10, total_tokens: 15, completion_tokens_details: { reasoning_tokens: 3 } },
}

function bodyOf(fn: ReturnType<typeof mockFetch>) {
  const call = fn.mock.calls[0] as any[]
  return JSON.parse(call[1].body)
}
function urlOf(fn: ReturnType<typeof mockFetch>) {
  const call = fn.mock.calls[0] as any[]
  return call[0] as string
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('OpenAIProvider reasoning-model request shape', () => {
  it('o1 uses max_completion_tokens and omits temperature/max_tokens', async () => {
    const fn = mockFetch(chatOk)
    await makeProvider('o1').execute({ prompt: 'hi', modelClass: 'o1' } as any, { maxTokensOut: 40000 } as any)
    const body = bodyOf(fn)
    expect(urlOf(fn)).toBe(`${BASE}/chat/completions`)
    expect(body.max_completion_tokens).toBeDefined()
    expect(body.max_tokens).toBeUndefined()
    expect(body.temperature).toBeUndefined()
  })

  it('o3-mini (broadened o-series detection) uses max_completion_tokens and no temperature', async () => {
    const fn = mockFetch(chatOk)
    await makeProvider('o3-mini').execute({ prompt: 'hi', modelClass: 'o3-mini' } as any, { maxTokensOut: 40000 } as any)
    const body = bodyOf(fn)
    // Regression guard: before the fix, o3-mini fell through to the legacy branch and sent
    // max_tokens + temperature, which OpenAI rejects with a 400 for reasoning models.
    expect(body.max_completion_tokens).toBeDefined()
    expect(body.max_tokens).toBeUndefined()
    expect(body.temperature).toBeUndefined()
  })

  it('gpt-5 sends reasoning_effort + max_completion_tokens and no temperature', async () => {
    const fn = mockFetch(chatOk)
    await makeProvider('gpt-5').execute({ prompt: 'hi', modelClass: 'gpt-5' } as any, { maxTokensOut: 40000 } as any)
    const body = bodyOf(fn)
    expect(body.reasoning_effort).toBe('low') // default for non-thinking gpt-5
    expect(body.max_completion_tokens).toBeDefined()
    expect(body.temperature).toBeUndefined()
  })

  it('non-reasoning gpt-4o still uses max_tokens + temperature', async () => {
    const fn = mockFetch(chatOk)
    await makeProvider('gpt-4o').execute({ prompt: 'hi', modelClass: 'gpt-4o' } as any, { maxTokensOut: 4000 } as any)
    const body = bodyOf(fn)
    expect(body.max_tokens).toBe(4000)
    expect(body.max_completion_tokens).toBeUndefined()
    expect(body.temperature).toBeDefined()
    expect(body.reasoning_effort).toBeUndefined()
  })

  it('floors the reasoning output budget so reasoning tokens do not starve the answer', async () => {
    const fn = mockFetch(chatOk)
    // A small stage limit (2000) must be raised to the reasoning floor (25000), capped at
    // o1's provider output limit (100000).
    await makeProvider('o1').execute({ prompt: 'hi', modelClass: 'o1' } as any, { maxTokensOut: 2000 } as any)
    expect(bodyOf(fn).max_completion_tokens).toBe(25000)
  })

  it('routes gpt-5.4-pro to the Responses API with max_output_tokens + reasoning.effort', async () => {
    const fn = mockFetch({ output_text: 'done', status: 'completed', usage: { output_tokens: 5, input_tokens: 10, total_tokens: 15 } })
    await makeProvider('gpt-5.4-pro').execute({ prompt: 'hi', modelClass: 'gpt-5.4-pro' } as any, { maxTokensOut: 40000 } as any)
    const body = bodyOf(fn)
    expect(urlOf(fn)).toBe(`${BASE}/responses`)
    expect(body.max_output_tokens).toBeDefined()
    expect(body.reasoning?.effort).toBe('high')
  })
})

describe('o-series routing and token limits', () => {
  it('routes the whole o-series (o1/o3/o4) to the openai provider', () => {
    expect(getProviderFromModelCode('o1')).toBe('openai')
    expect(getProviderFromModelCode('o3-mini')).toBe('openai')
    // Regression guard: before the fix, o4-mini was not recognized and threw "unknown model".
    expect(getProviderFromModelCode('o4-mini')).toBe('openai')
  })

  it('exposes o3/o4 token limits so the reasoning budget is not clamped to the default', () => {
    const p = makeProvider('o4-mini')
    expect(p.getTokenLimits('o3')).toEqual({ input: 200000, output: 100000 })
    expect(p.getTokenLimits('o4-mini')).toEqual({ input: 200000, output: 100000 })
  })
})

describe('OpenAIProvider reasoning-model failure handling', () => {
  it('throws a clear error when reasoning exhausts the budget (empty content, finish_reason=length)', async () => {
    mockFetch({
      choices: [{ message: { content: '' }, finish_reason: 'length' }],
      usage: { completion_tokens: 40000, prompt_tokens: 10, total_tokens: 40010, completion_tokens_details: { reasoning_tokens: 40000 } },
    })
    await expect(
      makeProvider('o1').execute({ prompt: 'hi', modelClass: 'o1' } as any, { maxTokensOut: 40000 } as any)
    ).rejects.toThrow(/no visible output|reasoning/i)
  })

  it('throws when the model emits reasoning only and stops normally (empty content, finish_reason=stop)', async () => {
    // Regression guard: the check used to require finish_reason==='length', so a
    // reasoning-only completion that stopped normally returned '' as a success and
    // silently broke every downstream JSON parse.
    mockFetch({
      choices: [{ message: { content: '' }, finish_reason: 'stop' }],
      usage: { completion_tokens: 291, prompt_tokens: 4447, total_tokens: 4738, completion_tokens_details: { reasoning_tokens: 281 } },
    })
    await expect(
      makeProvider('gpt-5.2').execute({ prompt: 'hi', modelClass: 'gpt-5.2' } as any, { maxTokensOut: 25000 } as any)
    ).rejects.toThrow(/no visible output/i)
  })

  it('passes a terse but meaningful answer through untouched', async () => {
    // "[]" is a real answer ("no figure suggestions apply") and must not be treated
    // as an empty completion.
    mockFetch({
      choices: [{ message: { content: '[]' }, finish_reason: 'stop' }],
      usage: { completion_tokens: 291, prompt_tokens: 4447, total_tokens: 4738, completion_tokens_details: { reasoning_tokens: 281 } },
    })
    const res = await makeProvider('gpt-5.2').execute({ prompt: 'hi', modelClass: 'gpt-5.2' } as any, { maxTokensOut: 25000 } as any)
    expect(res.output).toBe('[]')
  })

  it('throws when the Responses API returns status=incomplete with no text', async () => {
    mockFetch({
      output: [],
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      usage: { output_tokens: 40000, input_tokens: 10, total_tokens: 40010, output_tokens_details: { reasoning_tokens: 40000 } },
    })
    await expect(
      makeProvider('gpt-5.4-pro').execute({ prompt: 'hi', modelClass: 'gpt-5.4-pro' } as any, { maxTokensOut: 40000 } as any)
    ).rejects.toThrow(/incomplete|max_output_tokens/i)
  })
})
