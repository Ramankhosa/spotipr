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
    'glm-5v-turbo'
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

    if (hasImageInput && actualModel !== 'glm-5v-turbo') {
      throw new Error(`${actualModel} does not support image inputs; use glm-5v-turbo for vision requests`)
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

      if (request.parameters?.thinking !== undefined) {
        requestBody.thinking = this.normalizeThinkingParameter(request.parameters.thinking)
      }

      const response = await this.client.chat.completions.create(requestBody)
      const outputText = response.choices?.[0]?.message?.content || ''
      const inputTokens = response.usage?.prompt_tokens || 0
      const outputTokens = response.usage?.completion_tokens || 0
      const thoughtTokens = response.usage?.completion_tokens_details?.reasoning_tokens || 0
      const latency = Date.now() - startTime

      return {
        output: outputText,
        outputTokens,
        modelClass: modelToUse,
        metadata: {
          provider: this.name,
          model: actualModel,
          inputTokens,
          thoughtTokens,
          reasoningContent: response.choices?.[0]?.message?.reasoning_content,
          latencyMs: latency,
          finishReason: response.choices?.[0]?.finish_reason
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
      'glm-5v-turbo': { input: 200000, output: 128000 }
    }
    return limits[this.normalizeModelCode(modelName)] || { input: 200000, output: 128000 }
  }

  getCostPerToken(modelName: string): { input: number; output: number } {
    const costs: Record<string, { input: number; output: number }> = {
      'glm-5.1': { input: 0.0000014, output: 0.0000044 },
      'glm-5': { input: 0.000001, output: 0.0000032 },
      'glm-5-turbo': { input: 0.0000012, output: 0.000004 },
      'glm-5v-turbo': { input: 0.0000012, output: 0.000004 }
    }
    return costs[this.normalizeModelCode(modelName)] || { input: 0.000001, output: 0.000004 }
  }

  async isHealthy(): Promise<boolean> {
    return !!this.client
  }

  private normalizeModelCode(modelName: string): string {
    return modelName.toLowerCase()
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
