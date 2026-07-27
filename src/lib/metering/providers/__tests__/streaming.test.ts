import { describe, expect, it, vi } from 'vitest'
import type { LLMRequest } from '../../types'
import {
  consumeOpenAICompatibleStream,
  createOpenAICompatibleCompletion,
  emitStreamDelta,
  readServerSentEvents,
} from '../streaming'

const baseRequest = (onDelta?: (delta: string, accumulated: string) => void): LLMRequest => ({
  taskCode: 'LLM2_DRAFT' as any,
  prompt: 'draft claims',
  ...(onDelta ? { stream: { onDelta } } : {}),
})

/** Build a ReadableStream that emits the given strings as separate network chunks. */
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const item of iterable) out.push(item)
  return out
}

describe('readServerSentEvents', () => {
  it('yields each data payload and drops the [DONE] sentinel', async () => {
    const body = streamOf([
      'data: {"a":1}\n\n',
      'data: {"b":2}\n\n',
      'data: [DONE]\n\n',
    ])
    expect(await collect(readServerSentEvents(body))).toEqual(['{"a":1}', '{"b":2}'])
  })

  it('reassembles an event split across network chunk boundaries', async () => {
    // The classic SSE bug: a single event arriving in pieces, including a split
    // right inside the JSON payload and another between \n and \n.
    const body = streamOf(['data: {"tex', 't":"hel', 'lo"}\n', '\ndata: {"x":1}\n\n'])
    expect(await collect(readServerSentEvents(body))).toEqual(['{"text":"hello"}', '{"x":1}'])
  })

  it('handles a final event with no trailing blank line', async () => {
    const body = streamOf(['data: {"last":true}'])
    expect(await collect(readServerSentEvents(body))).toEqual(['{"last":true}'])
  })

  it('ignores comment/keep-alive lines and empty data', async () => {
    const body = streamOf([': keep-alive\n\n', 'event: ping\n\n', 'data: {"real":1}\n\n'])
    expect(await collect(readServerSentEvents(body))).toEqual(['{"real":1}'])
  })

  it('joins multi-line data fields into one payload', async () => {
    const body = streamOf(['data: {"a":1,\ndata: "b":2}\n\n'])
    expect(await collect(readServerSentEvents(body))).toEqual(['{"a":1,"b":2}'])
  })
})

describe('consumeOpenAICompatibleStream', () => {
  const chunks = [
    { choices: [{ delta: { content: 'Hello' } }] },
    { choices: [{ delta: { content: ' world' } }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }] },
    { usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 } },
  ]

  it('accumulates content, finish reason and usage', async () => {
    const result = await consumeOpenAICompatibleStream(chunks as any, baseRequest())
    expect(result.output).toBe('Hello world')
    expect(result.finishReason).toBe('stop')
    expect(result.usage).toEqual({ prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 })
  })

  it('emits each delta with a monotonically growing accumulation', async () => {
    const seen: Array<[string, string]> = []
    await consumeOpenAICompatibleStream(chunks as any, baseRequest((d, a) => seen.push([d, a])))
    expect(seen).toEqual([
      ['Hello', 'Hello'],
      [' world', 'Hello world'],
    ])
  })

  it('separates reasoning content from visible output', async () => {
    const withReasoning = [
      { choices: [{ delta: { reasoning_content: 'thinking...' } }] },
      { choices: [{ delta: { content: 'Answer' } }] },
    ]
    const seen: string[] = []
    const result = await consumeOpenAICompatibleStream(withReasoning as any, baseRequest(d => seen.push(d)))
    expect(result.output).toBe('Answer')
    expect(result.reasoning).toBe('thinking...')
    // Reasoning must never reach the caller as visible claim text.
    expect(seen).toEqual(['Answer'])
  })
})

describe('createOpenAICompatibleCompletion', () => {
  it('passes the body through untouched when no stream was requested', async () => {
    const buffered = { choices: [{ message: { content: 'done' }, finish_reason: 'stop' }], usage: { completion_tokens: 2 } }
    const create = vi.fn().mockResolvedValue(buffered)
    const client = { chat: { completions: { create } } }
    const body = { model: 'glm-5.1', messages: [{ role: 'user', content: 'hi' }], max_tokens: 100 }

    const result = await createOpenAICompatibleCompletion(client, body, baseRequest())

    // Non-streaming callers must see the exact pre-existing behaviour: same body,
    // no stream flags added, provider response returned verbatim.
    expect(create).toHaveBeenCalledWith(body)
    expect(create.mock.calls[0][0]).not.toHaveProperty('stream')
    expect(result).toBe(buffered)
  })

  it('requests usage-bearing stream chunks and rebuilds the buffered response shape', async () => {
    const create = vi.fn().mockResolvedValue([
      { choices: [{ delta: { content: 'A claim' } }] },
      { choices: [{ delta: { content: ' set' }, finish_reason: 'stop' }] },
      { usage: { prompt_tokens: 5, completion_tokens: 3 } },
    ])
    const client = { chat: { completions: { create } } }
    const body = { model: 'glm-5.1', messages: [], max_tokens: 100 }

    const streamed = await createOpenAICompatibleCompletion(client, body, baseRequest(() => {}))
    expect(create).toHaveBeenCalledWith({
      ...body,
      stream: true,
      stream_options: { include_usage: true },
    })
    expect(streamed.choices[0].message.content).toBe('A claim set')
    expect(streamed.choices[0].finish_reason).toBe('stop')
    expect(streamed.usage).toEqual({ prompt_tokens: 5, completion_tokens: 3 })
  })
})

describe('emitStreamDelta', () => {
  it('does not let a throwing consumer abort an in-flight generation', () => {
    const request = baseRequest(() => { throw new Error('consumer blew up') })
    expect(() => emitStreamDelta(request, 'text', 'text')).not.toThrow()
  })

  it('is a no-op for empty deltas or when no consumer is attached', () => {
    const onDelta = vi.fn()
    emitStreamDelta(baseRequest(onDelta), '', '')
    expect(onDelta).not.toHaveBeenCalled()
    expect(() => emitStreamDelta(baseRequest(), 'text', 'text')).not.toThrow()
  })
})
