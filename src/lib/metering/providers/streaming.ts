// Shared streaming helpers for LLM providers.
//
// Providers opt into streaming by checking `request.stream` and, when present, using the
// helpers here instead of their buffered call. The contract is identical either way: the
// provider still resolves a complete LLMResponse. Streaming only adds incremental
// `onDelta` notifications along the way, so callers that do not pass `stream` — and
// providers that have no streaming path — are unaffected.

import type { LLMRequest } from '../types'

/**
 * Push a delta to the caller. A throwing consumer must never abort an in-flight
 * (already paid for) provider call, so failures are logged and swallowed.
 */
export function emitStreamDelta(request: LLMRequest, delta: string, accumulated: string): void {
  if (!delta || !request.stream?.onDelta) return
  try {
    request.stream.onDelta(delta, accumulated)
  } catch (error) {
    console.warn('[LLM stream] onDelta consumer threw; continuing generation:', error)
  }
}

/**
 * Iterate an OpenAI-compatible streaming completion (the `openai` SDK's async iterable,
 * used by OpenAI, Z.AI, DeepSeek and Groq) and accumulate the visible text.
 */
export async function consumeOpenAICompatibleStream(
  stream: AsyncIterable<any>,
  request: LLMRequest
): Promise<{
  output: string
  reasoning: string
  finishReason?: string
  usage?: any
}> {
  let output = ''
  let reasoning = ''
  let finishReason: string | undefined
  let usage: any

  for await (const chunk of stream) {
    // Usage arrives on a final usage-only chunk when stream_options.include_usage is set.
    if (chunk?.usage) usage = chunk.usage

    const choice = chunk?.choices?.[0]
    if (!choice) continue
    if (choice.finish_reason) finishReason = choice.finish_reason

    const reasoningDelta = choice.delta?.reasoning_content
    if (typeof reasoningDelta === 'string' && reasoningDelta) {
      reasoning += reasoningDelta
    }

    const delta = choice.delta?.content
    if (typeof delta === 'string' && delta) {
      output += delta
      emitStreamDelta(request, delta, output)
    }
  }

  return { output, reasoning, finishReason, usage }
}

/**
 * Create a chat completion through an OpenAI-compatible SDK client, streaming when the
 * caller asked for it. Either way the resolved value has the buffered response shape
 * (`choices[0].message.content`, `usage`, `finish_reason`) so provider code that reads
 * the result needs no branching.
 */
export async function createOpenAICompatibleCompletion(
  client: any,
  body: Record<string, any>,
  request: LLMRequest
): Promise<any> {
  if (!request.stream) {
    return await client.chat.completions.create(body)
  }

  const stream = await client.chat.completions.create({
    ...body,
    stream: true,
    stream_options: { include_usage: true }
  })

  const { output, reasoning, finishReason, usage } = await consumeOpenAICompatibleStream(stream, request)

  return {
    choices: [{
      message: {
        content: output,
        ...(reasoning ? { reasoning_content: reasoning } : {})
      },
      finish_reason: finishReason
    }],
    usage
  }
}

/**
 * Read a `text/event-stream` HTTP body and yield each `data:` payload as a string.
 * Terminal `[DONE]` sentinels are filtered out.
 */
export async function* readServerSentEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const parseBlock = (block: string): string | null => {
    const data = block
      .split('\n')
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trim())
      .join('')
    if (!data || data === '[DONE]') return null
    return data
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // SSE events are separated by a blank line.
      let separator = buffer.indexOf('\n\n')
      while (separator !== -1) {
        const block = buffer.slice(0, separator)
        buffer = buffer.slice(separator + 2)
        const data = parseBlock(block)
        if (data) yield data
        separator = buffer.indexOf('\n\n')
      }
    }

    buffer += decoder.decode()
    if (buffer.trim()) {
      const data = parseBlock(buffer)
      if (data) yield data
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      /* reader already released */
    }
  }
}
