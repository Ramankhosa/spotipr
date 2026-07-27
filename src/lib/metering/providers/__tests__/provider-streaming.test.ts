import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenAIProvider } from '../openai-provider'
import { GeminiProvider } from '../gemini-provider'
import type { EnforcementDecision, LLMRequest } from '../../types'

// Provider-level streaming glue. The concern here is that opting into streaming must
// produce the SAME LLMResponse a buffered call would, and that NOT opting in leaves the
// existing (buffered) request untouched — these providers sit on every LLM call.

const LIMITS: EnforcementDecision = { allowed: true, maxTokensOut: 4096 }

const request = (onDelta?: (d: string, a: string) => void): LLMRequest => ({
  taskCode: 'LLM2_DRAFT' as any,
  prompt: 'draft claims',
  modelClass: 'gpt-4o',
  ...(onDelta ? { stream: { onDelta } } : {}),
})

function sseResponse(events: string[]) {
  const encoder = new TextEncoder()
  return {
    ok: true,
    status: 200,
    body: new ReadableStream({
      start(controller) {
        for (const e of events) controller.enqueue(encoder.encode(`data: ${e}\n\n`))
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      },
    }),
  } as unknown as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OpenAIProvider streaming', () => {
  const provider = new OpenAIProvider({ apiKey: 'k', baseURL: 'https://api.openai.com/v1', model: 'gpt-4o' })

  it('leaves the request body unchanged when streaming was not requested', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'buffered output' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const response = await provider.execute(request(), LIMITS)

    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(sentBody.stream).toBeUndefined()
    expect(sentBody.stream_options).toBeUndefined()
    expect(response.output).toBe('buffered output')
    expect(response.metadata?.streamed).toBeUndefined()
  })

  it('streams deltas and resolves the same response a buffered call would', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([
      JSON.stringify({ choices: [{ delta: { content: '1. A system' } }] }),
      JSON.stringify({ choices: [{ delta: { content: ' comprising a controller.' } }] }),
      JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
      JSON.stringify({ usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 } }),
    ]))
    vi.stubGlobal('fetch', fetchMock)

    const deltas: string[] = []
    const response = await provider.execute(request(d => deltas.push(d)), LIMITS)

    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(sentBody.stream).toBe(true)
    expect(sentBody.stream_options).toEqual({ include_usage: true })

    expect(deltas).toEqual(['1. A system', ' comprising a controller.'])
    expect(response.output).toBe('1. A system comprising a controller.')
    expect(response.outputTokens).toBe(8)
    expect(response.metadata?.inputTokens).toBe(12)
    expect(response.metadata?.finishReason).toBe('stop')
    expect(response.metadata?.streamed).toBe(true)
  })

  it('surfaces an error frame delivered mid-stream', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([
      JSON.stringify({ choices: [{ delta: { content: 'partial' } }] }),
      JSON.stringify({ error: { message: 'context length exceeded' } }),
    ])))

    await expect(provider.execute(request(() => {}), LIMITS))
      .rejects.toThrow(/context length exceeded/)
  })

  it('rejects an empty stream rather than returning empty output', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([
      JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
    ])))

    await expect(provider.execute(request(() => {}), LIMITS))
      .rejects.toThrow(/empty streamed response/)
  })
})

describe('GeminiProvider REST streaming', () => {
  const provider = new GeminiProvider(
    { apiKey: 'k', baseURL: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-3-flash-preview' },
    'gemini'
  )
  const geminiRequest = (onDelta?: (d: string, a: string) => void): LLMRequest => ({
    ...request(onDelta),
    modelClass: 'gemini-3-flash-preview',
  })

  it('calls the streaming endpoint and rebuilds the aggregated payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([
      JSON.stringify({ candidates: [{ content: { parts: [{ text: '1. A method' }] } }] }),
      JSON.stringify({ candidates: [{ content: { parts: [{ text: ' comprising steps.' }] }, finishReason: 'STOP' }] }),
      JSON.stringify({ usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 5, totalTokenCount: 12 } }),
    ]))
    vi.stubGlobal('fetch', fetchMock)

    const deltas: string[] = []
    const response = await provider.execute(geminiRequest(d => deltas.push(d)), LIMITS)

    expect(fetchMock.mock.calls[0][0]).toContain(':streamGenerateContent?alt=sse')
    expect(deltas).toEqual(['1. A method', ' comprising steps.'])
    expect(response.output).toBe('1. A method comprising steps.')
    expect(response.outputTokens).toBe(5)
    expect(response.metadata?.inputTokens).toBe(7)
    expect(response.metadata?.finishReason).toBe('STOP')
  })

  it('uses the buffered endpoint when streaming was not requested', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'buffered' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const response = await provider.execute(geminiRequest(), LIMITS)

    expect(fetchMock.mock.calls[0][0]).toContain(':generateContent')
    expect(fetchMock.mock.calls[0][0]).not.toContain('streamGenerateContent')
    expect(response.output).toBe('buffered')
  })
})
