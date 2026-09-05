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

// All supported provider types
export type ProviderType = 
  | 'gemini' 
  | 'gemini-flash-lite' 
  | 'openai' 
  | 'anthropic' 
  | 'deepseek' 
  | 'groq' 
  | 'grok'
  | 'zai'

// Provider factory function - supports all providers
export function createLLMProvider(type: ProviderType, config: ProviderConfig): LLMProvider {
  switch (type) {
    case 'gemini':
    case 'gemini-flash-lite':
      const { GeminiProvider } = require('./gemini-provider')
      return new GeminiProvider(config, type)
    case 'openai':
      const { OpenAIProvider } = require('./openai-provider')
      return new OpenAIProvider(config)
    case 'anthropic':
      const { AnthropicProvider } = require('./anthropic-provider')
      return new AnthropicProvider(config)
    case 'deepseek':
      const { DeepSeekProvider } = require('./deepseek-provider')
      return new DeepSeekProvider(config)
    case 'groq':
      const { GroqProvider } = require('./groq-provider')
      return new GroqProvider(config)
    case 'grok':
      const { GrokProvider } = require('./grok-provider')
      return new GrokProvider(config)
    case 'zai':
      const { ZAIProvider } = require('./zai-provider')
      return new ZAIProvider(config)
    default:
      throw new Error(`Unsupported provider type: ${type}`)
  }
}

/**
 * Get provider type from model code
 * Throws error for unknown models instead of silently defaulting (fail-fast)
 */
export function getProviderFromModelCode(modelCode: string): ProviderType {
  const providerMap: Record<string, ProviderType> = {
    // Google - Gemini 2.x Models (Text + Image Output)
    'gemini-2.5-pro': 'gemini',
    'gemini-2.0-flash': 'gemini',
    'gemini-2.0-flash-001': 'gemini',
    'gemini-2.0-flash-exp': 'gemini',              // Experimental - best image output
    'gemini-2.0-flash-thinking-exp': 'gemini',     // Thinking model
    'gemini-2.0-flash-lite': 'gemini-flash-lite',
    'gemini-2.0-flash-lite-001': 'gemini-flash-lite',
    'gemini-2.5-flash-lite': 'gemini-flash-lite',
    'gemini-exp-1206': 'gemini',                   // Experimental model
    // Google - Gemini 1.5 Models
    'gemini-1.5-pro': 'gemini',
    'gemini-1.5-pro-002': 'gemini',
    'gemini-1.5-flash': 'gemini',
    'gemini-1.5-flash-002': 'gemini',
    // Google - Latest Gemini families (2026)
    'gemini-3.8-flash': 'gemini',
    'gemini-3.7-flash': 'gemini',
    'gemini-3.6-flash': 'gemini',
    'gemini-3.5-flash': 'gemini',
    'gemini-3.5-flash-lite': 'gemini-flash-lite',
    'gemini-3.1-pro-preview': 'gemini',
    'gemini-3.1-flash-lite': 'gemini-flash-lite',
    'gemini-3-flash-preview': 'gemini',
    // Google - Legacy Image Generation Models (backwards compatibility)
    'gemini-3.0-nano-banana': 'gemini',
    'gemini-3-pro-preview': 'gemini',
    'gemini-3-pro-preview-thinking': 'gemini',
    'gemini-3-pro-image-preview': 'gemini',
    // Google - Image Generation Models (Nano Banana family)
    'gemini-3-pro-image': 'gemini',
    'gemini-3.1-flash-image': 'gemini',
    'gemini-3.1-flash-lite-image': 'gemini',
    
    // OpenAI - GPT-4 Series
    'gpt-4o': 'openai',
    'gpt-4o-mini': 'openai',
    'gpt-4-turbo': 'openai',
    'gpt-4': 'openai',
    // OpenAI - GPT-6 Series
    'gpt-6-astra': 'openai',
    'gpt-6-astra-thinking': 'openai',
    // OpenAI - GPT-5.6 Series (Sol / Terra / Luna)
    'gpt-5.6': 'openai',
    'gpt-5.6-sol': 'openai',
    'gpt-5.6-terra': 'openai',
    'gpt-5.6-luna': 'openai',
    // OpenAI - GPT-5 Series
    'gpt-5': 'openai',
    'gpt-5.1': 'openai',
    'gpt-5.2': 'openai',
    'gpt-5.4': 'openai',
    'gpt-5.4-mini': 'openai',
    'gpt-5.4-nano': 'openai',
    'gpt-5.4-pro': 'openai',
    'gpt-5.5': 'openai',
    'gpt-5.5-pro': 'openai',
    'gpt-5-mini': 'openai',
    'gpt-5-nano': 'openai',
    // OpenAI - GPT-5 Thinking Variants
    'gpt-5.1-thinking': 'openai',
    'gpt-5.2-thinking': 'openai',
    'gpt-5.6-sol-thinking': 'openai',
    'gpt-5.6-terra-thinking': 'openai',
    // OpenAI - GPT-3.5 Series
    'gpt-3.5-turbo': 'openai',
    // OpenAI - o1 Reasoning Models
    'o1': 'openai',
    'o1-mini': 'openai',
    'o1-preview': 'openai',
    
    // Anthropic - Claude 5 family + Opus 4.8 + Haiku 4.5 (2026)
    'claude-fable-5-1': 'anthropic',
    'claude-opus-5': 'anthropic',
    'claude-opus-5-thinking': 'anthropic',
    'claude-sonnet-4-6': 'anthropic',
    'claude-fable-5': 'anthropic',
    'claude-opus-4-8': 'anthropic',
    'claude-opus-4-8-thinking': 'anthropic',
    'claude-sonnet-5': 'anthropic',
    'claude-haiku-4-5': 'anthropic',
    // Anthropic - Friendly names
    'claude-3.5-sonnet': 'anthropic',
    'claude-3.5-haiku': 'anthropic',
    'claude-opus-4-7': 'anthropic',
    'claude-opus-4-6': 'anthropic',
    'claude-3-opus': 'anthropic',
    'claude-3-sonnet': 'anthropic',
    'claude-3-haiku': 'anthropic',
    // Anthropic - Canonical API model IDs (with dates)
    'claude-3-5-sonnet-20241022': 'anthropic',
    'claude-3-5-haiku-20241022': 'anthropic',
    'claude-3-opus-20240229': 'anthropic',
    'claude-3-sonnet-20240229': 'anthropic',
    'claude-3-haiku-20240307': 'anthropic',
    
    // DeepSeek
    'deepseek-v4-pro': 'deepseek',
    'deepseek-v4-flash': 'deepseek',
    'deepseek-v4-flash-vision-exp': 'deepseek',
    'deepseek-chat': 'deepseek',
    'deepseek-reasoner': 'deepseek',

    // Z.AI GLM
    'glm-5.3': 'zai',
    'glm-5.3-flash': 'zai',
    'glm-5.2': 'zai',
    'glm-5.1': 'zai',
    'glm-5': 'zai',
    'glm-5-turbo': 'zai',
    'glm-5v-turbo': 'zai',
    'glm-4.7': 'zai',
    'glm-4.7-flash': 'zai',
    'glm-4.7-flashx': 'zai',
    'glm-4.6': 'zai',
    'glm-4.5': 'zai',
    'glm-4.5-air': 'zai',
    'glm-4.5-x': 'zai',
    'glm-4.5-airx': 'zai',
    'glm-4.5-flash': 'zai',
    'glm-4.5v': 'zai',
    'glm-4-32b-0414-128k': 'zai',
    
    // Groq - Friendly names (prefixed)
    'groq-llama-3.3-70b': 'groq',
    'groq-llama-3.1-70b': 'groq',
    'groq-llama-3.1-8b': 'groq',
    'groq-mixtral-8x7b': 'groq',
    'groq-gemma2-9b': 'groq',
    // Groq - OpenAI open-weight models served by Groq. These MUST stay in the exact
    // map: the prefix fallback below would route "openai/..." to the OpenAI provider.
    'openai/gpt-oss-120b': 'groq',
    'openai/gpt-oss-20b': 'groq',
    // Groq - Canonical API model IDs
    'llama-3.3-70b-versatile': 'groq',
    'llama-3.1-70b-versatile': 'groq',
    'llama-3.1-8b-instant': 'groq',
    'mixtral-8x7b-32768': 'groq',
    'gemma2-9b-it': 'groq',
    
    // Grok (xAI)
    'grok-beta': 'grok',
    'grok-2': 'grok'
  }
  
  // First try exact match
  if (providerMap[modelCode]) {
    return providerMap[modelCode]
  }
  
  // Then try prefix-based detection for model variants
  const lowerCode = modelCode.toLowerCase()
  if (lowerCode.startsWith('gemini') || lowerCode.startsWith('google')) {
    return 'gemini'
  }
  // OpenAI: GPT-* and the whole o-series (o1, o3, o4, ...) reasoning family.
  if (lowerCode.startsWith('gpt') || /^o\d/.test(lowerCode) || lowerCode.startsWith('openai')) {
    return 'openai'
  }
  if (lowerCode.startsWith('claude') || lowerCode.startsWith('anthropic')) {
    return 'anthropic'
  }
  if (lowerCode.startsWith('deepseek')) {
    return 'deepseek'
  }
  if (lowerCode.startsWith('glm') || lowerCode.startsWith('zai') || lowerCode.startsWith('z.ai')) {
    return 'zai'
  }
  if (lowerCode.startsWith('llama') || lowerCode.startsWith('mixtral') || lowerCode.startsWith('gemma') || lowerCode.startsWith('groq')) {
    return 'groq'
  }
  if (lowerCode.startsWith('grok')) {
    return 'grok'
  }
  
  // FAIL-FAST: Throw error for truly unknown models instead of silently defaulting
  // This catches typos and misconfigured models in admin panel immediately
  const knownPrefixes = ['gemini', 'gpt', 'o1', 'o3', 'o4', 'claude', 'deepseek', 'glm', 'zai', 'llama', 'mixtral', 'gemma', 'groq', 'grok']
  throw new Error(
    `Unknown model code: "${modelCode}". ` +
    `Model must start with one of: ${knownPrefixes.join(', ')}. ` +
    `Check for typos in super admin model configuration.`
  )
}
