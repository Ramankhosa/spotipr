/**
 * Shared JSON extraction for LLM responses.
 *
 * The repair chain here is the exact behavior previously inlined in
 * DraftingService.normalizeIdea: strip code fences (even unterminated ones),
 * trim to the outermost object braces, clean common syntax issues, then try
 * progressively more aggressive repairs. It never fabricates values — if the
 * text cannot be parsed as a JSON object the result fails closed.
 */

export type LlmJsonParseResult =
  | { ok: true; data: Record<string, any> }
  | { ok: false; error: string; truncated: boolean }

/**
 * Providers report truncation differently: Gemini finishReason 'MAX_TOKENS',
 * OpenAI/Groq/DeepSeek finishReason 'length', Anthropic stopReason 'max_tokens'.
 */
export function isTruncatedLlmResponse(metadata: Record<string, any> | null | undefined): boolean {
  const meta = metadata as any
  return (
    meta?.finishReason === 'MAX_TOKENS' ||
    meta?.finishReason === 'length' ||
    meta?.stopReason === 'max_tokens'
  )
}

export function parseLlmJsonObject(response: {
  output?: string | null
  metadata?: Record<string, any> | null
}): LlmJsonParseResult {
  try {
    const output = (response.output || '').trim()

    let jsonText = output

    // If fenced with backticks, strip the outer fence even if closing fence is missing
    const fenceStart = jsonText.indexOf('```')
    if (fenceStart !== -1) {
      jsonText = jsonText.slice(fenceStart + 3) // drop opening ```
      // drop optional language tag like 'json'
      jsonText = jsonText.replace(/^json\s*/i, '')
      const fenceEnd = jsonText.indexOf('```')
      if (fenceEnd !== -1) {
        jsonText = jsonText.slice(0, fenceEnd)
      }
    }

    // Trim to the JSON object boundaries
    const startBrace = jsonText.indexOf('{')
    const lastBrace = jsonText.lastIndexOf('}')
    if (startBrace !== -1) {
      jsonText = lastBrace !== -1 && lastBrace > startBrace
        ? jsonText.slice(startBrace, lastBrace + 1)
        : jsonText.slice(startBrace)
    }

    // Cleanup common JSON issues
    jsonText = jsonText
      .replace(/`+/g, '') // remove stray backticks
      .replace(/,(\s*[}\]])/g, '$1') // remove trailing commas
      .replace(/([\x00-\x08\x0B\x0C\x0E-\x1F])/g, '') // remove control chars

    let parsed: any

    // First parse attempt
    try {
      parsed = JSON.parse(jsonText)
    } catch (firstErr) {
      try {
        // Fallback: attempt to quote unquoted keys
        const quotedKeys = jsonText.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":')
        parsed = JSON.parse(quotedKeys)
      } catch (secondErr) {
        // Try one more fallback with syntax-only cleanup. Do not fabricate values.
        const cleanJson = jsonText
          .replace(/[\x00-\x1F\x7F-\x9F]/g, '') // Remove all control characters
          .replace(/,(\s*[}\]])/g, '$1') // Remove trailing commas
          .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":') // Quote keys
          .replace(/:\s*'([^']*)'/g, ':"$1"') // Convert single quotes to double quotes for values
        parsed = JSON.parse(cleanJson)
      }
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('LLM did not return a valid object')
    }

    return { ok: true, data: parsed }
  } catch (parseError) {
    return {
      ok: false,
      error: parseError instanceof Error ? parseError.message : String(parseError),
      truncated: isTruncatedLlmResponse(response.metadata),
    }
  }
}
