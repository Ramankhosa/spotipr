/**
 * Z.AI GLM Provider Implementation
 * Supports GLM-5 family models through Z.AI's OpenAI-compatible API.
 */

import type { LLMRequest, LLMResponse, EnforcementDecision } from '../types'
import type { LLMProvider, ProviderConfig } from './llm-provider'

export class ZAIProvider implements LLMProvider {
  name = 'zai'
  supportedModels = [
    'glm-5.1',
    'glm-5',
    'glm-5-turbo',
    'glm-5v-turbo',
    'glm-4.7',
    'glm-4.7-flash',
    'glm-4.7-flashx',
    'glm-4.6',
    'glm-4.5',
    'glm-4.5-air',
    'glm-4.5-x',
    'glm-4.5-airx',
    'glm-4.5-flash',
    'glm-4.5v',
    'glm-4-32b-0414-128k'
  ]

  private config: ProviderConfig
  private client: any

  constructor(config: ProviderConfig, name?: string) {
    this.config = config
    if (name) this.name = name

    if (typeof window === 'undefined') {
      if (!config.apiKey) {
        console.error('No API key provided for Z.AI provider!')
        return
      }

      try {
        const OpenAI = require('openai')
        this.client = new OpenAI({
          apiKey: config.apiKey,
          baseURL: config.baseURL || 'https://api.z.ai/api/paas/v4'
        })
      } catch (error) {
        console.warn('Z.AI client initialization failed:', error)
      }
    }
  }

  async execute(request: LLMRequest, limits: EnforcementDecision): Promise<LLMResponse> {
    if (!this.client) {
      throw new Error('Z.AI client not initialized')
    }

    const startTime = Date.now()
    const modelToUse = request.modelClass || this.config.model || 'glm-5.1'
    const actualModel = this.normalizeModelCode(modelToUse)
    const hasImageInput = !!request.content?.parts.some(part => part.type === 'image')

    if (hasImageInput && !this.supportsVision(actualModel)) {
      throw new Error(`${actualModel} does not support image inputs; use a GLM vision model for vision requests`)
    }

    try {
      const messages = this.buildMessages(request)
      if (messages.length === 0) {
        throw new Error('No valid content provided for Z.AI request')
      }

      const modelLimits = this.getTokenLimits(actualModel)
      const requestBody: any = {
        model: actualModel,
        messages,
        max_tokens: Math.min(limits.maxTokensOut || 4096, modelLimits.output),
        temperature: request.parameters?.temperature ?? 0.7
      }

      const thinking = this.resolveThinkingParameter(request, modelToUse, actualModel)
      if (thinking) {
        requestBody.thinking = thinking
      }

      const response = await this.client.chat.completions.create(requestBody)
      const outputText = response.choices?.[0]?.message?.content || ''
      const inputTokens = response.usage?.prompt_tokens || 0
      const outputTokens = response.usage?.completion_tokens || 0
      const thoughtTokens = response.usage?.completion_tokens_details?.reasoning_tokens || 0
      const latency = Date.now() - startTime
      const finishReason = response.choices?.[0]?.finish_reason

      if (!outputText.trim()) {
        throw new Error(
          `Z.AI API returned empty response (finishReason: ${finishReason || 'unknown'}, ` +
          `completionTokens: ${outputTokens}, thoughtTokens: ${thoughtTokens}). ` +
          `Increase maxTokensOut or disable thinking for short outputs.`
        )
      }

      return {
        output: outputText,
        outputTokens,
        modelClass: modelToUse,
        metadata: {
          provider: this.name,
          model: actualModel,
          inputTokens,
          thoughtTokens,
          thoughtTokensIncludedInOutput: false,
          totalTokens: response.usage?.total_tokens || 0,
          reasoningContent: response.choices?.[0]?.message?.reasoning_content,
          latencyMs: latency,
          finishReason
        }
      }
    } catch (error: any) {
      console.error('Z.AI API error:', error)
      throw new Error(`Z.AI API error: ${error.message || 'Unknown error'}`)
    }
  }

  getTokenLimits(modelName: string): { input: number; output: number } {
    const limits: Record<string, { input: number; output: number }> = {
      'glm-5.1': { input: 200000, output: 128000 },
      'glm-5': { input: 200000, output: 128000 },
      'glm-5-turbo': { input: 200000, output: 128000 },
      'glm-5v-turbo': { input: 200000, output: 128000 },
      'glm-4.7': { input: 128000, output: 128000 },
      'glm-4.7-flash': { input: 128000, output: 128000 },
      'glm-4.7-flashx': { input: 128000, output: 128000 },
      'glm-4.6': { input: 128000, output: 128000 },
      'glm-4.5': { input: 128000, output: 96000 },
      'glm-4.5-air': { input: 128000, output: 96000 },
      'glm-4.5-x': { input: 128000, output: 96000 },
      'glm-4.5-airx': { input: 128000, output: 96000 },
      'glm-4.5-flash': { input: 128000, output: 96000 },
      'glm-4.5v': { input: 128000, output: 16000 },
      'glm-4-32b-0414-128k': { input: 128000, output: 16000 }
    }
    const normalized = this.normalizeModelCode(modelName)
    if (limits[normalized]) return limits[normalized]
    if (normalized.startsWith('glm-5')) return { input: 200000, output: 128000 }
    if (normalized.startsWith('glm-4.7') || normalized.startsWith('glm-4.6')) return { input: 128000, output: 128000 }
    if (normalized.startsWith('glm-4.5v')) return { input: 128000, output: 16000 }
    if (normalized.startsWith('glm-4.5')) return { input: 128000, output: 96000 }
    return { input: 128000, output: 96000 }
  }

  getCostPerToken(modelName: string): { input: number; output: number } {
    const costs: Record<string, { input: number; output: number }> = {
      'glm-5.1': { input: 0.0000014, output: 0.0000044 },
      'glm-5': { input: 0.000001, output: 0.0000032 },
      'glm-5-turbo': { input: 0.0000012, output: 0.000004 },
      'glm-5v-turbo': { input: 0.0000012, output: 0.000004 },
      'glm-4.7': { input: 0.000001, output: 0.0000032 },
      'glm-4.7-flash': { input: 0.0000002, output: 0.0000011 },
      'glm-4.7-flashx': { input: 0.0000002, output: 0.0000011 },
      'glm-4.6': { input: 0.000001, output: 0.0000032 },
      'glm-4.5': { input: 0.0000002, output: 0.0000011 },
      'glm-4.5-air': { input: 0.0000002, output: 0.0000011 },
      'glm-4.5-x': { input: 0.0000002, output: 0.0000011 },
      'glm-4.5-airx': { input: 0.0000002, output: 0.0000011 },
      'glm-4.5-flash': { input: 0.0000002, output: 0.0000011 },
      'glm-4.5v': { input: 0.0000006, output: 0.0000018 },
      'glm-4-32b-0414-128k': { input: 0.0000002, output: 0.0000011 }
    }
    return costs[this.normalizeModelCode(modelName)] || { input: 0.0000002, output: 0.0000011 }
  }

  async isHealthy(): Promise<boolean> {
    return !!this.client
  }

  private normalizeModelCode(modelName: string): string {
    return modelName.toLowerCase().replace(/-thinking$/, '')
  }

  private supportsVision(modelName: string): boolean {
    return modelName === 'glm-5v-turbo' || modelName === 'glm-4.5v'
  }

  private supportsThinkingParameter(modelName: string): boolean {
    return (
      modelName.startsWith('glm-5') ||
      modelName.startsWith('glm-4.7') ||
      modelName.startsWith('glm-4.6') ||
      modelName.startsWith('glm-4.5')
    )
  }

  private resolveThinkingParameter(request: LLMRequest, requestedModel: string, actualModel: string): any | undefined {
    if (!this.supportsThinkingParameter(actualModel)) return undefined

    if (request.parameters?.thinking !== undefined) {
      return this.normalizeThinkingParameter(request.parameters.thinking)
    }

    if (requestedModel.toLowerCase().endsWith('-thinking')) {
      return { type: 'enabled' }
    }

    // Z.AI defaults GLM-5/4.5+ to thinking mode. For product workflows with
    // explicit output caps, default to visible output unless the caller opts in.
    return { type: 'disabled' }
  }

  private normalizeThinkingParameter(value: any): any {
    if (typeof value === 'boolean') {
      return { type: value ? 'enabled' : 'disabled' }
    }
    if (typeof value === 'string') {
      return { type: value }
    }
    return value
  }

  private buildMessages(request: LLMRequest): any[] {
    if (request.prompt) {
      return [{ role: 'user', content: request.prompt }]
    }

    if (!request.content?.parts.length) {
      return []
    }

    const contentParts = request.content.parts.map(part => {
      if (part.type === 'text') {
        return { type: 'text', text: part.text }
      }

      return {
        type: 'image_url',
        image_url: {
          url: `data:${part.image.mimeType};base64,${part.image.data}`
        }
      }
    })

    return [{ role: 'user', content: contentParts }]
  }
}
