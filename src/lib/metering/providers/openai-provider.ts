// OpenAI Provider Implementation
// Supports GPT-4o model

import type { LLMRequest, LLMResponse, EnforcementDecision } from '../types'
import type { LLMProvider, ProviderConfig } from './llm-provider'

export class OpenAIProvider implements LLMProvider {
  name = 'openai'
  supportedModels = ['gpt-4o']

  private config: ProviderConfig

  constructor(config: ProviderConfig) {
    this.config = config
  }

  async execute(request: LLMRequest, limits: EnforcementDecision): Promise<LLMResponse> {
    // Apply enforcement limits
    const maxTokens = limits.maxTokensOut || 4096

    try {
      const response = await fetch(`${this.config.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            {
              role: 'user',
              content: request.prompt || ''
            }
          ],
          max_tokens: maxTokens,
          temperature: 0.7,
        }),
      })

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`OpenAI API error: ${response.status} ${error}`)
      }

      const data = await response.json()

      const choice = data.choices[0]
      const usage = data.usage

      return {
        output: choice.message.content,
        outputTokens: usage?.completion_tokens || 0,
        modelClass: this.config.model,
        metadata: {
          provider: 'openai',
          inputTokens: usage?.prompt_tokens || 0,
          totalTokens: usage?.total_tokens || 0,
          finishReason: choice.finish_reason
        }
      }
    } catch (error) {
      console.error('OpenAI API error:', error)
      throw new Error(`OpenAI API call failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  getTokenLimits(modelName: string): { input: number, output: number } {
    // GPT-4o limits
    return {
      input: 128000,  // 128K tokens
      output: 16384   // 16K tokens
    }
  }

  getCostPerToken(modelName: string): { input: number, output: number } {
    // GPT-4o pricing (per million tokens)
    return {
      input: 0.000005,   // $5.00 per million input tokens
      output: 0.000015   // $15.00 per million output tokens
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseURL}/models`, {
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
      })
      return response.ok
    } catch (error) {
      console.error('OpenAI health check failed:', error)
      return false
    }
  }
}
