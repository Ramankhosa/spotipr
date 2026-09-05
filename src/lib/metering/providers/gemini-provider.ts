// Google Gemini Provider Implementation
// Supports Gemini 2.5 Pro model

import type { LLMRequest, LLMResponse, EnforcementDecision, MultimodalContent } from '../types'
import type { LLMProvider, ProviderConfig } from './llm-provider'
import { PROVIDER_TIMEOUTS } from './provider-timeouts'
import { emitStreamDelta, readServerSentEvents } from './streaming'

const SHOULD_LOG_PROVIDER_INIT = process.env.LLM_PROVIDER_INIT_LOGS === 'true'

/**
 * Caller-supplied response constraints, translated to Gemini's generationConfig.
 *
 * Gemini expresses structured output as `responseMimeType` plus an optional
 * `responseSchema`, where OpenAI uses `response_format`. Accepting either spelling
 * keeps call sites provider-agnostic: a stage can ask for JSON once and be honoured
 * whichever model the gateway routes it to.
 */
function responseConstraints(parameters?: Record<string, any>): Record<string, any> {
  if (!parameters) return {}
  const mimeType = parameters.responseMimeType
    || (parameters.response_format?.type === 'json_object' || parameters.response_format?.type === 'json_schema'
      ? 'application/json'
      : undefined)
  const schema = parameters.responseSchema
    || parameters.response_format?.json_schema?.schema
  if (!mimeType && !schema) return {}
  return {
    ...(mimeType ? { responseMimeType: mimeType } : { responseMimeType: 'application/json' }),
    ...(schema ? { responseSchema: schema } : {}),
  }
}

export class GeminiProvider implements LLMProvider {
  name = 'gemini'
  supportedModels = [
    // Gemini 2.x Series (Text + Image Output)
    'gemini-2.5-pro',
    'gemini-2.0-flash',
    'gemini-2.0-flash-001',
    'gemini-2.0-flash-exp',           // Experimental - best image output quality
    'gemini-2.0-flash-thinking-exp',  // Thinking model - higher quality but slower
    'gemini-2.0-flash-lite',
    'gemini-2.5-flash-lite',
    'gemini-exp-1206',                // Experimental model with good image capability
    // Gemini 1.5 Series
    'gemini-1.5-pro',
    'gemini-1.5-pro-002',
    'gemini-1.5-flash',
    'gemini-1.5-flash-002',
    // Latest Gemini families (2026)
    'gemini-3.8-flash',
    'gemini-3.7-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.1-pro-preview',
    'gemini-3.1-flash-lite',
    'gemini-3-flash-preview',
    // Image Generation Models (Nano Banana family)
    'gemini-3-pro-image',
    'gemini-3.1-flash-image',
    'gemini-3.1-flash-lite-image',
    // Legacy Image Generation Models (for backwards compatibility)
    'gemini-3.0-nano-banana',
    'gemini-3-pro-preview',
    'gemini-3-pro-preview-thinking',
    'gemini-3-pro-image-preview'
  ]

  // Map legacy model codes (as saved in plan config) to current Google model IDs
  // This keeps old config working after Google renames/versions.
  private modelAliasMap: Record<string, string> = {
    // Gemini 1.5 stable variants
    'gemini-1.5-pro': 'gemini-1.5-pro-002',
    'gemini-1.5-flash': 'gemini-1.5-flash-002',
    // Gemini 2.x variants (align to current GA/preview IDs)
    'gemini-2.0-flash': 'gemini-2.0-flash-001',
    'gemini-2.0-flash-lite': 'gemini-2.0-flash-lite-001',
    // Experimental models (pass through as-is)
    'gemini-2.0-flash-exp': 'gemini-2.0-flash-exp',
    'gemini-2.0-flash-thinking-exp': 'gemini-2.0-flash-thinking-exp',
    'gemini-exp-1206': 'gemini-exp-1206',
    // Legacy image models (pass through as-is)
    'gemini-3.0-nano-banana': 'gemini-3.0-nano-banana',
    'gemini-3-pro-preview': 'gemini-3-pro-preview',
    'gemini-3-pro-preview-thinking': 'gemini-3-pro-preview',
    'gemini-3-pro-image-preview': 'gemini-3-pro-image-preview'
  }

  private config: ProviderConfig
  private client: any // Google Generative AI client

  constructor(config: ProviderConfig, name?: string) {
    this.config = config
    if (name) this.name = name

    // Initialize Google Generative AI client
    if (typeof window === 'undefined') {
      // Only initialize on server side
      if (SHOULD_LOG_PROVIDER_INIT) {
        console.log(`Initializing Gemini provider (${name || 'gemini'}) with API key present: ${!!config.apiKey}`)
      }
      if (!config.apiKey) {
        console.error('No API key provided for Gemini provider!')
      }

      try {
        // Dynamic import to avoid client-side issues
        const { GoogleGenerativeAI } = require('@google/generative-ai')
        this.client = new GoogleGenerativeAI(config.apiKey)
        if (SHOULD_LOG_PROVIDER_INIT) {
          console.log(`Gemini provider initialized (${name || 'gemini'})`)
        }
      } catch (error) {
        console.warn('Google Generative AI not available:', error)
      }
    }
  }

  async execute(request: LLMRequest, limits: EnforcementDecision): Promise<LLMResponse> {
    if (!this.client) {
      throw new Error('Gemini client not initialized')
    }

    // Use modelClass from request, or fallback to configured model, or first supported model
    const requestedModel = request.modelClass || this.config.model || this.supportedModels[0]
    const modelClass = this.modelAliasMap[requestedModel] || requestedModel

    // Thinking level support for Gemini 3 (documented as thinking_level; default is high).
    // We support two ways to request it:
    // 1) Model alias variant: gemini-3-pro-preview-thinking (defaults to "high")
    // 2) Explicit parameter: request.parameters.thinking_level
    const isGemini3 = modelClass.startsWith('gemini-3')
    const isThinkingVariant = requestedModel.endsWith('-thinking')
    const thinkingLevel = request.parameters?.thinking_level ?? (isThinkingVariant ? 'high' : undefined)

    // Note: Model validation is now handled by the model resolver
    // We allow any model code to be passed through since new models can be added via admin UI
    if (modelClass !== requestedModel) {
      console.log(`[GeminiProvider] Using model alias: requested=${requestedModel} -> api=${modelClass}`)
    } else {
      console.log(`[GeminiProvider] Using model: ${modelClass}`)
    }

    // Use enforcement limits, with provider limits as fallback
    const providerLimits = this.getTokenLimits(modelClass)
    const requested = limits.maxTokensOut || providerLimits.output
    const maxTokens = Math.min(requested, providerLimits.output)
    const temperature = request.parameters?.temperature ?? 0.7 // Default temperature 0.7 if not specified
    const topP = request.parameters?.topP ?? 0.95 // Default topP 0.95

    try {
      // Gemini 3 "thinking_level" is expressed in the REST request schema.
      // The @google/generative-ai SDK may not expose it directly for all versions, so for
      // gemini-3 models we call REST directly to ensure thinking_level is honored.
      if (isGemini3) {
        return await this.executeGemini3ViaRest({
          requestedModel,
          modelClass,
          request,
          maxTokens,
          temperature,
          topP,
          thinkingLevel
        })
      }

      const model = this.client.getGenerativeModel({
        model: modelClass,
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature: temperature,
          topP: topP,
          ...responseConstraints(request.parameters)
        }
      }, {
        // Bound the SDK request so a hung call can't block the worker. The SDK's
        // default timeout is short relative to heavy Gemini generations; use the
        // generous provider-specific ceiling instead.
        timeout: this.config.timeout ?? PROVIDER_TIMEOUTS.gemini()
      })

      // Handle multimodal content (text + images)
      let contentToGenerate: any;
      if (request.content) {
        // Build multimodal content for Gemini
        const parts = []
        for (const part of request.content.parts) {
          if (part.type === 'text') {
            parts.push({ text: part.text })
          } else if (part.type === 'image') {
            parts.push({
              inlineData: {
                mimeType: part.image.mimeType,
                data: part.image.data
              }
            })
          }
        }
        contentToGenerate = parts
      } else {
        // Fallback to text-only prompt
        contentToGenerate = request.prompt || ''
      }

      // Add retry logic for network issues
      const maxRetries = 3
      let lastError: Error | null = null

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          console.log(`Attempting Gemini API call (attempt ${attempt}/${maxRetries})`)

          // Streaming and buffered calls resolve the same aggregated response; only
          // streaming also notifies the caller of each chunk as it lands.
          const response = request.stream
            ? await this.collectSdkStream(model, contentToGenerate, request)
            : (await model.generateContent(contentToGenerate)).response

          // If we get here, the call was successful
          console.log(`Gemini API call successful on attempt ${attempt}`)

          const output = response.text()
          const usage = response.usageMetadata

          // Log response details for debugging
          console.log('🔍 Gemini API response details:', {
            hasCandidates: !!response.candidates,
            candidatesCount: response.candidates?.length || 0,
            finishReason: response.candidates?.[0]?.finishReason,
            outputLength: output?.length || 0,
            usage: usage
          });

          // Check if response is empty
          if (!output || output.trim().length === 0) {
            const finishReason = response.candidates?.[0]?.finishReason;
            console.error(`❌ Gemini API returned empty response - finishReason: ${finishReason}`);
            if (finishReason === 'MAX_TOKENS') {
              console.warn('💡 MAX_TOKENS reached - consider increasing token limit or reducing prompt size');
            }
            throw new Error(`Gemini API returned empty response (finishReason: ${finishReason})`);
          }

          return {
            output,
            outputTokens: usage?.candidatesTokenCount || 0,
            modelClass: requestedModel,
            metadata: {
              provider: 'gemini',
              inputTokens: usage?.promptTokenCount || 0,
              thoughtTokens: usage?.thoughtsTokenCount || 0,
              thoughtTokensIncludedInOutput: false,
              totalTokens: usage?.totalTokenCount || 0,
              // Prompt-cache hit size. Gemini caches implicitly on 2.5+ models, so this
              // is the only way to tell whether a stable prefix actually earned a discount.
              cachedInputTokens: usage?.cachedContentTokenCount || 0,
              finishReason: response.candidates?.[0]?.finishReason
            }
          }
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error))
          console.error(`Attempt ${attempt} failed:`, lastError.message)

          // If this is not the last attempt, wait before retrying
          if (attempt < maxRetries) {
            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000) // Exponential backoff, max 5s
            console.log(`Waiting ${delay}ms before retry...`)
            await new Promise(resolve => setTimeout(resolve, delay))
          }
        }
      }

      // All retries failed
      throw new Error(`Gemini API call failed after ${maxRetries} attempts. Last error: ${lastError?.message}`)
    } catch (error) {
      console.error('Gemini API error:', error)

      // Provide more detailed error information
      if (error instanceof Error) {
        if (error.message.includes('fetch failed')) {
          console.error('Network connectivity issue detected. Check internet connection and API endpoint availability.')
        } else if (error.message.includes('API_KEY')) {
          console.error('API key issue detected. Verify GOOGLE_AI_API_KEY is properly configured.')
        }
      }

      throw new Error(`Gemini API call failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Consume the REST `streamGenerateContent?alt=sse` body and rebuild the aggregated
   * `generateContent` payload (candidates + usageMetadata) the caller expects.
   */
  private async collectRestStream(response: Response, request: LLMRequest): Promise<any> {
    if (!response.body) {
      throw new Error('Gemini streaming response had no body')
    }

    let accumulated = ''
    let finishReason: string | undefined
    let usageMetadata: any

    for await (const data of readServerSentEvents(response.body)) {
      let chunk: any
      try {
        chunk = JSON.parse(data)
      } catch {
        continue
      }

      if (chunk?.error) {
        throw new Error(`Gemini API stream error: ${chunk.error.message || JSON.stringify(chunk.error)}`)
      }
      if (chunk?.usageMetadata) usageMetadata = chunk.usageMetadata

      const candidate = chunk?.candidates?.[0]
      if (!candidate) continue
      if (candidate.finishReason) finishReason = candidate.finishReason

      const text = (candidate.content?.parts || [])
        .map((part: any) => part?.text)
        .filter(Boolean)
        .join('')
      if (!text) continue

      accumulated += text
      emitStreamDelta(request, text, accumulated)
    }

    return {
      candidates: [{
        content: { parts: [{ text: accumulated }] },
        finishReason
      }],
      usageMetadata
    }
  }

  /**
   * Drive the SDK's streaming call, emitting each chunk, and resolve the aggregated
   * response object (same shape `generateContent()` returns, including usageMetadata).
   */
  private async collectSdkStream(model: any, contentToGenerate: any, request: LLMRequest): Promise<any> {
    const result = await model.generateContentStream(contentToGenerate)
    let accumulated = ''

    for await (const chunk of result.stream) {
      let text = ''
      try {
        text = typeof chunk?.text === 'function' ? chunk.text() : ''
      } catch {
        continue // safety-blocked or non-text chunk
      }
      if (!text) continue
      accumulated += text
      emitStreamDelta(request, text, accumulated)
    }

    return await result.response
  }

  getTokenLimits(modelName: string): { input: number, output: number } {
    const normalized = this.modelAliasMap[modelName] || modelName
    const limits: Record<string, { input: number, output: number }> = {
      // Flash Lite models
      'gemini-2.0-flash-lite': { input: 1048576, output: 8192 },
      'gemini-2.0-flash-lite-001': { input: 1048576, output: 8192 },
      'gemini-2.5-flash-lite': { input: 1048576, output: 8192 },
      // Flash models (including experimental with image output)
      'gemini-2.0-flash': { input: 1048576, output: 8192 },
      'gemini-2.0-flash-001': { input: 1048576, output: 8192 },
      'gemini-2.0-flash-exp': { input: 1048576, output: 8192 },            // Experimental - best image output
      'gemini-2.0-flash-thinking-exp': { input: 1048576, output: 16384 },  // Thinking model - higher output
      'gemini-exp-1206': { input: 2097152, output: 8192 },                 // Experimental model
      // Pro models
      'gemini-2.5-pro': { input: 2097152, output: 16384 },
      'gemini-1.5-pro': { input: 2097152, output: 16384 }, // legacy config
      'gemini-1.5-pro-002': { input: 2097152, output: 16384 },
      'gemini-1.5-flash': { input: 1048576, output: 8192 }, // legacy config
      'gemini-1.5-flash-002': { input: 1048576, output: 8192 },
      // Latest Gemini families (2026)
      'gemini-3.8-flash': { input: 1048576, output: 65536 },
      'gemini-3.7-flash': { input: 1048576, output: 65536 },
      'gemini-3.6-flash': { input: 1048576, output: 65536 },
      'gemini-3.5-flash': { input: 1048576, output: 65536 },
      'gemini-3.5-flash-lite': { input: 1048576, output: 65536 },
      'gemini-3.1-pro-preview': { input: 2097152, output: 65536 },
      'gemini-3.1-flash-lite': { input: 1048576, output: 65536 },
      'gemini-3-flash-preview': { input: 1048576, output: 65536 },
      // Legacy image generation models (backwards compatibility)
      'gemini-3.0-nano-banana': { input: 128000, output: 8192 },
      'gemini-3-pro-preview': { input: 2097152, output: 16384 },
      'gemini-3-pro-image-preview': { input: 128000, output: 8192 },
      // Image generation models (Nano Banana family)
      'gemini-3-pro-image': { input: 128000, output: 8192 },
      'gemini-3.1-flash-image': { input: 128000, output: 8192 },
      'gemini-3.1-flash-lite-image': { input: 128000, output: 8192 }
    }

    return limits[normalized] || { input: 2097152, output: 16384 }
  }

  getCostPerToken(modelName: string): { input: number, output: number } {
    const normalized = this.modelAliasMap[modelName] || modelName
    // Pricing per token (converted from per-million pricing)
    const costs: Record<string, { input: number, output: number }> = {
      // Flash Lite models
      'gemini-2.0-flash-lite': { input: 0.00000008, output: 0.0000003 },    // $0.08/$0.30 per M
      'gemini-2.0-flash-lite-001': { input: 0.00000008, output: 0.0000003 },
      'gemini-2.5-flash-lite': { input: 0.00000035, output: 0.0000007 },    // $0.35/$0.70 per M
      // Flash models (including experimental with image output)
      'gemini-2.0-flash': { input: 0.0000001, output: 0.0000004 },          // $0.10/$0.40 per M
      'gemini-2.0-flash-001': { input: 0.0000001, output: 0.0000004 },
      'gemini-2.0-flash-exp': { input: 0.0000001, output: 0.0000004 },      // Experimental - same pricing
      'gemini-2.0-flash-thinking-exp': { input: 0.0000003, output: 0.0000012 }, // Thinking model - higher cost
      'gemini-exp-1206': { input: 0.0000001, output: 0.0000004 },           // Experimental model
      // Pro models
      'gemini-2.5-pro': { input: 0.00000125, output: 0.000005 },            // $1.25/$5.00 per M
      'gemini-1.5-pro': { input: 0.00000125, output: 0.000005 },            // $1.25/$5.00 per M (legacy)
      'gemini-1.5-pro-002': { input: 0.00000125, output: 0.000005 },
      'gemini-1.5-flash': { input: 0.0000001, output: 0.0000004 },          // $0.10/$0.40 per M (legacy)
      'gemini-1.5-flash-002': { input: 0.0000001, output: 0.0000004 },
      // Latest Gemini families (2026)
      'gemini-3.8-flash': { input: 0.00000075, output: 0.00000375 },        // $0.75/$3.75 per M (promo through 2026-12-31)
      'gemini-3.7-flash': { input: 0.00000075, output: 0.00000375 },        // $0.75/$3.75 per M (promo through 2026-12-31)
      'gemini-3.6-flash': { input: 0.00000075, output: 0.00000375 },        // $0.75/$3.75 per M (promo through 2026-12-31)
      'gemini-3.5-flash': { input: 0.0000015, output: 0.000009 },           // $1.50/$9.00 per M
      'gemini-3.5-flash-lite': { input: 0.0000003, output: 0.0000025 },     // $0.30/$2.50 per M
      'gemini-3.1-pro-preview': { input: 0.000002, output: 0.000012 },      // $2.00/$12.00 per M
      'gemini-3.1-flash-lite': { input: 0.00000025, output: 0.0000015 },    // $0.25/$1.50 per M
      'gemini-3-flash-preview': { input: 0.0000005, output: 0.000003 },     // $0.50/$3.00 per M
      // Legacy image generation models (backwards compatibility)
      'gemini-3.0-nano-banana': { input: 0.000001, output: 0.000004 },      // $1.00/$4.00 per M
      'gemini-3-pro-preview': { input: 0.00000125, output: 0.000005 },      // Placeholder - update if pricing differs
      'gemini-3-pro-image-preview': { input: 0.000001, output: 0.000004 },  // $1.00/$4.00 per M
      // Image generation models (Nano Banana family) - output is image tokens
      'gemini-3-pro-image': { input: 0.000002, output: 0.00012 },           // $2.00/$120.00 per M
      'gemini-3.1-flash-image': { input: 0.0000005, output: 0.00006 },      // $0.50/$60.00 per M
      'gemini-3.1-flash-lite-image': { input: 0.00000025, output: 0.00003 } // $0.25/$30.00 per M
    }
    
    return costs[normalized] || { input: 0.00000125, output: 0.000005 }
  }

  private async executeGemini3ViaRest(args: {
    requestedModel: string
    modelClass: string
    request: LLMRequest
    maxTokens: number
    temperature: number
    topP: number
    thinkingLevel?: string
  }): Promise<LLMResponse> {
    const { requestedModel, modelClass, request, maxTokens, temperature, topP, thinkingLevel } = args

    // Build multimodal content payload for Gemini REST API
    let parts: any[] = []
    if (request.content) {
      for (const part of request.content.parts) {
        if (part.type === 'text') {
          parts.push({ text: part.text })
        } else if (part.type === 'image') {
          parts.push({
            inlineData: {
              mimeType: part.image.mimeType,
              data: part.image.data
            }
          })
        }
      }
    } else {
      parts = [{ text: request.prompt || '' }]
    }

    const body: any = {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature,
        topP,
        ...responseConstraints(request.parameters)
      }
    }

    if (thinkingLevel) {
      body.thinking_level = thinkingLevel
    }

    // Use the configured baseURL (defaults to https://generativelanguage.googleapis.com/v1beta)
    const streaming = Boolean(request.stream)
    const method = streaming ? 'streamGenerateContent?alt=sse' : 'generateContent'
    const url = `${this.config.baseURL}/models/${encodeURIComponent(modelClass)}:${method}`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.config.apiKey
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeout ?? PROVIDER_TIMEOUTS.gemini()),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Gemini API error: ${response.status} ${errorText}`)
    }

    const data = streaming
      ? await this.collectRestStream(response, request)
      : await response.json()
    const candidate = data?.candidates?.[0]
    const candidateParts = candidate?.content?.parts || []
    const output = candidateParts.map((p: any) => p?.text).filter(Boolean).join('\n')

    if (!output || output.trim().length === 0) {
      throw new Error(`Gemini API returned empty response (finishReason: ${candidate?.finishReason || 'unknown'})`)
    }

    const usage = data?.usageMetadata
    return {
      output,
      outputTokens: usage?.candidatesTokenCount || 0,
      modelClass: requestedModel,
      metadata: {
        provider: 'gemini',
        inputTokens: usage?.promptTokenCount || 0,
        thoughtTokens: usage?.thoughtsTokenCount || 0,
        thoughtTokensIncludedInOutput: false,
        totalTokens: usage?.totalTokenCount || 0,
        cachedInputTokens: usage?.cachedContentTokenCount || 0,
        finishReason: candidate?.finishReason,
        modelUsed: modelClass,
        thinkingLevel: thinkingLevel || undefined
      }
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      if (!this.client) return false

      // Simple health check - try to list models
      const model = this.client.getGenerativeModel({ model: this.config.model })
      // If we can create a model instance, consider it healthy
      return true
    } catch (error) {
      console.error('Gemini health check failed:', error)
      return false
    }
  }
}
