// Central LLM Service Gateway
// Single point of control for all LLM operations with provider routing

import type {
  TenantContext,
  FeatureRequest,
  EnforcementDecision,
  UsageStats,
  TaskCode,
  FeatureCode,
  LLMRequest,
  LLMResponse
} from './types'
import { MeteringError } from './errors'
import { createMeteringSystem } from './index'
import { extractTenantContextFromRequest } from './auth-bridge'
import { llmProviderRouter } from './providers/provider-router'

// === CENTRAL GATEWAY SERVICE ===

export class LLMGateway {
  private system = createMeteringSystem()

  async executeLLMOperation(
    request: { headers: Record<string, string> },
    llmRequest: LLMRequest
  ): Promise<{ success: boolean; response?: LLMResponse; error?: MeteringError }> {
    try {
      // 1. Extract tenant context from request (existing metering hierarchy)
      const tenantContext = await extractTenantContextFromRequest(request)
      if (!tenantContext) {
        return {
          success: false,
          error: new MeteringError('TENANT_UNRESOLVED', 'Unable to resolve tenant context')
        }
      }

      // 2. Create feature request for metering
      const featureRequest: FeatureRequest = {
        tenantId: tenantContext.tenantId,
        featureCode: this.getFeatureForTask(llmRequest.taskCode),
        taskCode: llmRequest.taskCode,
        userId: tenantContext.userId,
        metadata: {
          idempotencyKey: llmRequest.idempotencyKey || crypto.randomUUID()
        }
      }

      // 3. Enforce metering policies (existing Module 5)
      const decision = await this.system.policy.evaluateAccess(featureRequest)

      if (!decision.allowed) {
        return {
          success: false,
          error: new MeteringError('POLICY_VIOLATION', decision.reason || 'Access denied')
        }
      }

      // 4. Route to LLM provider with enforcement limits
      const response = await llmProviderRouter.routeAndExecute(llmRequest, decision)

      // 5. Record usage (existing Module 7)
      if (decision.reservationId) {
        const usageStats: UsageStats = {
          inputTokens: llmRequest.inputTokens || 0,
          outputTokens: response.outputTokens,
          modelClass: response.modelClass as any,
          apiCalls: 1
        }

        await this.system.metering.recordUsage(decision.reservationId, usageStats, tenantContext.userId)
      }

      return { success: true, response }

    } catch (error) {
      if (error instanceof MeteringError) {
        return { success: false, error }
      }

      const wrappedError = new MeteringError('SERVICE_UNAVAILABLE', 'LLM gateway error')
      return { success: false, error: wrappedError }
    }
  }

  private getFeatureForTask(taskCode: TaskCode): FeatureCode {
    const taskToFeatureMap: Record<TaskCode, FeatureCode> = {
      LLM1_PRIOR_ART: 'PRIOR_ART_SEARCH',
      LLM2_DRAFT: 'PATENT_DRAFTING',
      LLM3_DIAGRAM: 'DIAGRAM_GENERATION',
      LLM4_NOVELTY_SCREEN: 'PRIOR_ART_SEARCH',
      LLM5_NOVELTY_ASSESS: 'PRIOR_ART_SEARCH'
    }
    return taskToFeatureMap[taskCode]
  }

  // Provider management methods
  getAvailableProviders(): string[] {
    return llmProviderRouter.getAvailableProviders()
  }

  getProviderHealth(): Record<string, boolean> {
    return llmProviderRouter.getProviderHealth()
  }

  async refreshProviders(): Promise<void> {
    await llmProviderRouter.refreshProviders()
  }

  // Admin methods for monitoring and control
  async getTenantUsage(tenantId: string, period: 'daily' | 'monthly' = 'monthly') {
    return await this.system.metering.getUsage(tenantId, undefined, period)
  }

  async checkTenantQuota(tenantId: string, featureCode: FeatureCode) {
    return await this.system.metering.checkQuota({
      tenantId,
      featureCode
    })
  }
}

// === SINGLETON GATEWAY INSTANCE ===

export const llmGateway = new LLMGateway()

// === HELPER FUNCTIONS FOR INTEGRATION ===

export async function executePriorArtSearch(
  request: { headers: Record<string, string> },
  query: string,
  options?: { maxResults?: number; sources?: string[] }
): Promise<{ success: boolean; results?: any[]; error?: MeteringError }> {
  const llmRequest: LLMRequest = {
    taskCode: 'LLM1_PRIOR_ART',
    prompt: `Search for prior art related to: ${query}`,
    parameters: options,
    idempotencyKey: crypto.randomUUID()
  }

  const result = await llmGateway.executeLLMOperation(request, llmRequest)

  if (!result.success || !result.response) {
    return { success: false, error: result.error }
  }

  try {
    const results = JSON.parse(result.response.output)
    return { success: true, results }
  } catch {
    return { success: false, error: new MeteringError('SERVICE_UNAVAILABLE', 'Invalid response format') }
  }
}

export async function executePatentDrafting(
  request: { headers: Record<string, string> },
  specification: string,
  options?: { jurisdiction?: string; type?: string }
): Promise<{ success: boolean; draft?: string; error?: MeteringError }> {
  const llmRequest: LLMRequest = {
    taskCode: 'LLM2_DRAFT',
    prompt: `Draft patent specification for: ${specification}`,
    parameters: options,
    idempotencyKey: crypto.randomUUID()
  }

  const result = await llmGateway.executeLLMOperation(request, llmRequest)

  if (!result.success || !result.response) {
    return { success: false, error: result.error }
  }

  return { success: true, draft: result.response.output }
}

export async function executeDiagramGeneration(
  request: { headers: Record<string, string> },
  description: string,
  format: 'plantuml' | 'mermaid' = 'plantuml'
): Promise<{ success: boolean; diagram?: string; error?: MeteringError }> {
  const llmRequest: LLMRequest = {
    taskCode: 'LLM3_DIAGRAM',
    prompt: `Generate ${format} diagram for: ${description}`,
    parameters: { format },
    idempotencyKey: crypto.randomUUID()
  }

  const result = await llmGateway.executeLLMOperation(request, llmRequest)

  if (!result.success || !result.response) {
    return { success: false, error: result.error }
  }

  return { success: true, diagram: result.response.output }
}

// Re-export types for convenience
export type { LLMRequest, LLMResponse } from './types'
