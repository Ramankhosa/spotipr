/**
 * Anthropic Claude Provider Implementation
 * Supports Claude 4.x Opus and Claude 3.x models.
 */

import type { LLMRequest, LLMResponse, EnforcementDecision, MultimodalContent } from '../types'
import type { LLMProvider, ProviderConfig } from './llm-provider'
import { PROVIDER_TIMEOUTS } from './provider-timeouts'
import { emitStreamDelta } from './streaming'

// Adaptive thinking spends part of the output-token budget on internal reasoning.
// A budget sized only for the visible answer can get consumed by thinking, so floor
// the output budget when thinking is on (mirrors the OpenAI reasoning-model floor).
const ANTHROPIC_THINKING_MIN_OUTPUT_TOKENS = Number(process.env.ANTHROPIC_THINKING_MIN_OUTPUT_TOKENS) || 24000

export class AnthropicProvider implements LLMProvider {
  name = 'anthropic'
  supportedModels = [
    // Claude 5 family + Opus 4.8 + Haiku 4.5 (current generation, 2026)
    'claude-fable-5',
    'claude-opus-4-8',
    'claude-sonnet-5',
    'claude-haiku-4-5',
    // "Thinking" alias — enables adaptive extended thinking on the base model
    'claude-opus-4-8-thinking',
    // Claude 4.x models
    'claude-opus-4-7',
    'claude-opus-4-6',
    // Claude 3.5 models - use the stable aliases that Anthropic actually supports
    'claude-3-5-sonnet',
    'claude-3-5-haiku',
    // Claude 3 models
    'claude-3-opus',
    'claude-3-sonnet',
    'claude-3-haiku',
  ]

  private config: ProviderConfig
  private client: any

  constructor(config: ProviderConfig, name?: string) {
    this.config = config
    if (name) this.name = name

    if (typeof window === 'undefined') {
      console.log(`Initializing Anthropic provider with API key present: ${!!config.apiKey}`)
      
      if (!config.apiKey) {
        console.error('No API key provided for Anthropic provider!')
        return
      }

      try {
        const Anthropic = require('@anthropic-ai/sdk')
        // Bound each request so a hung connection can't pin a worker indefinitely.
        // Generous ceiling for extended-thinking Opus drafting (heaviest stage).
        this.client = new Anthropic({
          apiKey: config.apiKey,
          timeout: config.timeout ?? PROVIDER_TIMEOUTS.anthropic(),
        })
        console.log('Anthropic client initialized successfully')
      } catch (error) {
        console.warn('Anthropic SDK not available:', error)
      }
    }
  }

  // "thinking" is represented as a model-code variant in our system (e.g.
  // "claude-opus-4-8-thinking") and translated into Anthropic's adaptive
  // extended-thinking request field. The base model is used for the API call.
  private normalizeModelCode(modelCode: string): { apiModel: string; isThinkingVariant: boolean } {
    if (!modelCode) return { apiModel: modelCode, isThinkingVariant: false }
    if (modelCode.endsWith('-thinking')) {
      return { apiModel: modelCode.replace(/-thinking$/, ''), isThinkingVariant: true }
    }
    return { apiModel: modelCode, isThinkingVariant: false }
  }

  async execute(request: LLMRequest, limits: EnforcementDecision): Promise<LLMResponse> {
    if (!this.client) {
      throw new Error('Anthropic client not initialized')
    }

    const startTime = Date.now()
    const requestedModel = request.modelClass || this.config.model || 'claude-3-5-sonnet'
    const { apiModel: modelToUse, isThinkingVariant } = this.normalizeModelCode(requestedModel)

    // Map friendly model names to Anthropic's canonical API model IDs.
    const modelMap: Record<string, string> = {
      // Claude 5 family + 4.x dateless IDs are pinned API model IDs (no date suffix)
      'claude-fable-5': 'claude-fable-5',
      'claude-opus-4-8': 'claude-opus-4-8',
      'claude-sonnet-5': 'claude-sonnet-5',
      'claude-haiku-4-5': 'claude-haiku-4-5',
      'claude-opus-4-7': 'claude-opus-4-7',
      'claude-opus-4-6': 'claude-opus-4-6',
      // Claude 3.5 Sonnet variations -> latest dated version
      'claude-3.5-sonnet': 'claude-3-5-sonnet-20241022',
      'claude-3-5-sonnet': 'claude-3-5-sonnet-20241022',
      'claude-3-5-sonnet-latest': 'claude-3-5-sonnet-20241022',
      'claude-sonnet-3.5': 'claude-3-5-sonnet-20241022',
      // Claude 3.5 Haiku variations
      'claude-3.5-haiku': 'claude-3-5-haiku-20241022',
      'claude-3-5-haiku': 'claude-3-5-haiku-20241022',
      'claude-3-5-haiku-latest': 'claude-3-5-haiku-20241022',
      // Claude 3 Opus variations
      'claude-3-opus': 'claude-3-opus-20240229',
      'claude-3-opus-latest': 'claude-3-opus-20240229',
      // Claude 3 Sonnet/Haiku
      'claude-3-sonnet': 'claude-3-sonnet-20240229',
      'claude-3-haiku': 'claude-3-haiku-20240307',
    }
    
    const actualModel = modelMap[modelToUse] || modelToUse
    console.log(`Anthropic: mapping model "${modelToUse}" -> "${actualModel}"`)

    try {
      // Build messages array
      const messages: any[] = []
      
      if (request.content && request.content.parts) {
        // Multimodal content
        const contentParts: any[] = []
        
        for (const part of request.content.parts) {
          if (part.type === 'text') {
            contentParts.push({ type: 'text', text: part.text })
          } else if (part.type === 'image') {
            // Claude expects base64 images
            contentParts.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: part.image.mimeType || 'image/jpeg',
                data: part.image.data
              }
            })
          }
        }
        
        messages.push({ role: 'user', content: contentParts })
      } else if (request.prompt) {
        messages.push({ role: 'user', content: request.prompt })
      }

      // Adaptive extended thinking is supported on Opus 4.6/4.7/4.8, Sonnet 5, and Fable 5.
      const supportsAdaptiveThinking =
        actualModel.startsWith('claude-opus-4-') ||
        actualModel === 'claude-sonnet-5' ||
        actualModel === 'claude-fable-5'
      const enableThinking = isThinkingVariant && supportsAdaptiveThinking

      const modelLimits = this.getTokenLimits(modelToUse)
      // Thinking tokens count against max_tokens, so give the visible answer headroom
      // when thinking is on so it isn't starved by the reasoning phase.
      const baseMaxTokens = Math.min(limits.maxTokensOut || 4096, modelLimits.output)
      const maxTokens = enableThinking
        ? Math.min(modelLimits.output, Math.max(baseMaxTokens, ANTHROPIC_THINKING_MIN_OUTPUT_TOKENS))
        : baseMaxTokens

      const requestBody: any = {
        model: actualModel,
        max_tokens: maxTokens,
        messages
      }

      if (enableThinking) {
        // Let Claude decide how much to think per request (recommended over budget_tokens).
        requestBody.thinking = { type: 'adaptive' }
        console.log(`Anthropic: adaptive thinking enabled for ${actualModel} (max_tokens=${maxTokens})`)
      }

      // Claude Opus 4.x, Sonnet 5, and Fable 5 reject the `temperature` parameter (HTTP 400);
      // it is also incompatible with thinking. Haiku 4.5 and Claude 3.x still accept it.
      const rejectsSampling =
        actualModel.startsWith('claude-opus-4-') ||
        actualModel === 'claude-sonnet-5' ||
        actualModel === 'claude-fable-5'
      if (!rejectsSampling && !enableThinking) {
        requestBody.temperature = request.parameters?.temperature ?? 0.7
      }

      // Streaming and buffered calls resolve the same final Message; streaming just
      // surfaces text_delta events to the caller as they arrive.
      const response = request.stream
        ? await this.collectStream(requestBody, request)
        : await this.client.messages.create(requestBody)

      const outputText = response.content
        .filter((block: any) => block.type === 'text')
        .map((block: any) => block.text)
        .join('')

      const inputTokens = response.usage?.input_tokens || 0
      const outputTokens = response.usage?.output_tokens || 0
      const latency = Date.now() - startTime

      return {
        output: outputText,
        outputTokens,
        modelClass: requestedModel, // Preserve the configured code (may be a thinking alias)
        metadata: {
          provider: this.name,
          model: actualModel,
          inputTokens,
          // Anthropic reports cache reads and writes separately: reads are billed at a
          // fraction of input, writes at a premium, so both are needed to judge whether
          // caching is paying for itself.
          cachedInputTokens: response.usage?.cache_read_input_tokens || 0,
          cacheWriteInputTokens: response.usage?.cache_creation_input_tokens || 0,
          latencyMs: latency,
          stopReason: response.stop_reason,
          thinkingEnabled: enableThinking
        }
      }
    } catch (error: any) {
      console.error('Anthropic API error:', error)
      // IMPORTANT: Throw error instead of swallowing it, so fallback routing can work
      throw new Error(`Anthropic API error: ${error.message || 'Unknown error'}`)
    }
  }

  /**
   * Run the request through the SDK's streaming helper, emitting visible text deltas,
   * and resolve the final accumulated Message (content blocks + usage).
   */
  private async collectStream(requestBody: any, request: LLMRequest): Promise<any> {
    const stream = this.client.messages.stream(requestBody)
    let accumulated = ''

    stream.on('text', (delta: string) => {
      if (!delta) return
      accumulated += delta
      emitStreamDelta(request, delta, accumulated)
    })

    return await stream.finalMessage()
  }

  getTokenLimits(modelName: string): { input: number; output: number } {
    const normalized = this.normalizeModelCode(modelName).apiModel
    // Claude 3.5 models have 200K context
    const limits: Record<string, { input: number; output: number }> = {
      'claude-fable-5': { input: 1000000, output: 128000 },
      'claude-opus-4-8': { input: 1000000, output: 128000 },
      'claude-sonnet-5': { input: 1000000, output: 128000 },
      'claude-haiku-4-5': { input: 200000, output: 64000 },
      'claude-opus-4-7': { input: 1000000, output: 128000 },
      'claude-opus-4-6': { input: 1000000, output: 128000 },
      'claude-3-5-sonnet': { input: 200000, output: 8192 },
      'claude-3-5-haiku': { input: 200000, output: 8192 },
      'claude-3-opus': { input: 200000, output: 4096 },
      'claude-3-sonnet': { input: 200000, output: 4096 },
      'claude-3-haiku': { input: 200000, output: 4096 }
    }
    return limits[normalized] || { input: 200000, output: 4096 }
  }

  getCostPerToken(modelName: string): { input: number; output: number } {
    const normalized = this.normalizeModelCode(modelName).apiModel
    // Cost per token in USD (approximate as of Dec 2024)
    const costs: Record<string, { input: number; output: number }> = {
      'claude-fable-5': { input: 0.00001, output: 0.00005 },      // $10/$50 per M
      'claude-opus-4-8': { input: 0.000005, output: 0.000025 },   // $5/$25 per M
      'claude-sonnet-5': { input: 0.000003, output: 0.000015 },   // $3/$15 per M
      'claude-haiku-4-5': { input: 0.000001, output: 0.000005 },  // $1/$5 per M
      'claude-opus-4-7': { input: 0.000005, output: 0.000025 },
      'claude-opus-4-6': { input: 0.000005, output: 0.000025 },
      'claude-3-5-sonnet': { input: 0.000003, output: 0.000015 },
      'claude-3-5-haiku': { input: 0.0000008, output: 0.000004 },
      'claude-3-opus': { input: 0.000015, output: 0.000075 },
      'claude-3-sonnet': { input: 0.000003, output: 0.000015 },
      'claude-3-haiku': { input: 0.00000025, output: 0.00000125 }
    }
    return costs[normalized] || { input: 0.000003, output: 0.000015 }
  }

  async isHealthy(): Promise<boolean> {
    return !!this.client
  }
}

