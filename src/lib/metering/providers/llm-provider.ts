// Base LLM Provider Interface
// Abstract interface for all LLM providers

import type { LLMRequest, LLMResponse, EnforcementDecision } from '../types'

export interface LLMProvider {
  name: string
  supportedModels: string[]
  execute(request: LLMRequest, limits: EnforcementDecision): Promise<LLMResponse>
  getTokenLimits(modelName: string): { input: number, output: number }
  getCostPerToken(modelName: string): { input: number, output: number }
  isHealthy(): Promise<boolean>
}

export interface ProviderConfig {
  apiKey: string
  model: string
  baseURL: string
  timeout?: number
  maxRetries?: number
}

// Provider factory function
export function createLLMProvider(type: 'gemini' | 'openai' | 'grok', config: ProviderConfig): LLMProvider {
  switch (type) {
    case 'gemini':
      const { GeminiProvider } = require('./gemini-provider')
      return new GeminiProvider(config)
    case 'openai':
      const { OpenAIProvider } = require('./openai-provider')
      return new OpenAIProvider(config)
    case 'grok':
      const { GrokProvider } = require('./grok-provider')
      return new GrokProvider(config)
    default:
      throw new Error(`Unsupported provider type: ${type}`)
  }
}
