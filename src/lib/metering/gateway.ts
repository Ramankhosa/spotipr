// Central LLM Service Gateway
// Single point of control for all LLM operations with provider routing
//
// LLM MODEL ACCESS CONTROL:
// - Which plans can use which LLM models is controlled ONLY by Super Admin
// - Via PlanLLMAccess table (backward compatible) OR
// - Via PlanStageModelConfig/PlanTaskModelConfig (new flexible system)
// - Tenants have NO control over LLM model routing
//
// MODEL RESOLUTION:
// - Stage-coded calls: exact plan/stage config only (fail closed)
// - Legacy task-only calls: task config > PlanLLMAccess > system default
//
// ORGANIZATIONAL SERVICE ACCESS (teams/users):
// - Handled separately at API route level, NOT in LLM gateway
// - Team service toggles are for feature availability, not model access

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
import { createMeteringSystem } from './system'
import { extractTenantContextFromRequest } from './auth-bridge'
import { llmProviderRouter } from './providers/provider-router'
import { resolveModel, type ModelResolutionResult } from './model-resolver'

// === CENTRAL GATEWAY SERVICE ===

export class LLMGateway {
  private system = createMeteringSystem()

  /**
   * Execute LLM operation with automatic model resolution
   * 
   * @param request - Request with headers or tenant context
   * @param llmRequest - LLM request with taskCode and optional stageCode
   * @returns Response with success status and LLM output
   * 
   * Model Resolution:
   * - If stageCode is provided: require the exact PlanStageModelConfig
   * - If taskCode only: PlanTaskModelConfig > PlanLLMAccess > system default
   */
  async executeLLMOperation(
    request: { headers: Record<string, string> } | { tenantContext: TenantContext },
    llmRequest: LLMRequest & { stageCode?: string }
  ): Promise<{ success: boolean; response?: LLMResponse; error?: MeteringError }> {
    // Declare decision outside try block so we can release reservation in catch block
    let decision: any = null
    
    try {
      // 1. Extract tenant context from request (existing metering hierarchy)
      console.log('[Gateway] Step 1: Extracting tenant context...')
      const tenantContext = await extractTenantContextFromRequest(request)
      if (!tenantContext) {
        console.error('[Gateway] FAILED: Unable to resolve tenant context')
        return {
          success: false,
          error: new MeteringError('TENANT_UNRESOLVED', 'Unable to resolve tenant context')
        }
      }
      console.log('[Gateway] Tenant context resolved:', { tenantId: tenantContext.tenantId, userId: tenantContext.userId, planId: tenantContext.planId })

      llmRequest.metadata = {
        ...llmRequest.metadata,
        tenantId: tenantContext.tenantId,
        userId: tenantContext.userId ?? llmRequest.metadata?.userId
      }

      // 2. Ensure we have a reasonable input token estimate if caller did not supply one
      if (typeof llmRequest.inputTokens !== 'number' || llmRequest.inputTokens <= 0) {
        llmRequest.inputTokens = this.estimateInputTokens(llmRequest)
      }

      // 3. Create feature request for metering
      const featureRequest: FeatureRequest = {
        tenantId: tenantContext.tenantId,
        featureCode: this.getFeatureForTask(llmRequest.taskCode),
        taskCode: llmRequest.taskCode,
        userId: tenantContext.userId,
        metadata: {
          idempotencyKey: llmRequest.idempotencyKey || crypto.randomUUID()
        }
      }

      // 4. Enforce metering policies (Super Admin controlled via Plan Features)
      console.log('[Gateway] Step 4: Evaluating access policy...')
      try {
        decision = await this.system.policy.evaluateAccess(featureRequest)
        console.log('[Gateway] Policy evaluation result:', { allowed: decision.allowed, reservationId: decision.reservationId })
      } catch (policyError) {
        console.error('[Gateway] Policy evaluation FAILED:', policyError instanceof Error ? policyError.message : policyError)
        if (policyError instanceof MeteringError) {
          return {
            success: false,
            error: policyError
          }
        }
        // Re-throw unexpected errors
        throw policyError
      }

      if (!decision.allowed) {
        console.error('[Gateway] Policy DENIED access:', decision.reason)
        // This shouldn't happen anymore since policy now throws MeteringError
        return {
          success: false,
          error: new MeteringError('POLICY_VIOLATION', decision.reason || 'Access denied')
        }
      }

      // 5. Resolve the model to use based on plan, task, and optional stage
      let modelResolution: ModelResolutionResult | null = null
      const requestedModelCode = typeof llmRequest.modelClass === 'string' && llmRequest.modelClass.trim().length > 0
        ? llmRequest.modelClass.trim()
        : null
      // A caller-selected model must never override a stage row managed in
      // Super Admin. Explicit models remain supported only for legacy
      // task-only operations that have no stage configuration surface.
      const explicitModelCode = llmRequest.stageCode ? null : requestedModelCode
      console.log(`[Gateway] Resolving model for tenant=${tenantContext.tenantId}, planId=${tenantContext.planId || 'NONE'}, taskCode=${llmRequest.taskCode}, stageCode=${llmRequest.stageCode || 'none'}`)
      if (explicitModelCode) {
        llmRequest.modelClass = explicitModelCode
        console.log(`[Gateway] Explicit model requested: ${explicitModelCode}`)
      } else if (requestedModelCode && llmRequest.stageCode) {
        delete llmRequest.modelClass
        console.warn(`[Gateway] Ignoring caller model ${requestedModelCode}; stage ${llmRequest.stageCode} is controlled by Super Admin`)
      }

      if (!tenantContext.planId && llmRequest.stageCode) {
        const message = `No planId available for configured LLM stage ${llmRequest.stageCode}`
        console.error(`[Gateway] ${message}`)
        if (decision.reservationId) {
          try {
            await this.system.reservation.releaseReservation(decision.reservationId)
          } catch (releaseError) {
            console.warn('[Gateway] Failed to release reservation after missing planId:', releaseError)
          }
        }
        return {
          success: false,
          error: new MeteringError('CONFIGURATION_ERROR', message)
        }
      }
      
      if (tenantContext.planId) {
        try {
          modelResolution = await resolveModel(
            tenantContext.planId,
            llmRequest.taskCode,
            llmRequest.stageCode
          )
          
          // Apply stage/task-specific limits if configured. These limits come
          // from Super Admin LLM Config and are the only application-level
          // token ceilings enforced by the LLM gateway.
          if (modelResolution.maxTokensOut) {
            decision.maxTokensOut = modelResolution.maxTokensOut
          } else {
            delete decision.maxTokensOut
          }

          if (modelResolution.maxTokensIn) {
            decision.maxTokensIn = modelResolution.maxTokensIn
          } else {
            delete decision.maxTokensIn
          }

          console.log(`[Gateway] LLM config token limits: in=${decision.maxTokensIn ?? 'provider-only'}, out=${decision.maxTokensOut ?? 'provider-only'}`)

          console.log(`[Gateway] ✓ Model resolved: ${modelResolution.modelCode} (source: ${modelResolution.source}, provider: ${modelResolution.provider})`)
          if (modelResolution.source === 'system-default') {
            console.warn(`[Gateway] ⚠️ Using SYSTEM DEFAULT model - no specific config found for plan=${tenantContext.planId}, task=${llmRequest.taskCode}`)
          }
          if (modelResolution.fallbacks.length > 0) {
            console.log(`[Gateway]   Fallbacks: ${modelResolution.fallbacks.map(f => f.modelCode).join(' → ')}`)
          } else {
            console.log(`[Gateway]   No fallback models configured`)
          }
        } catch (resolveError) {
          const message = resolveError instanceof Error ? resolveError.message : String(resolveError)
          // Log error details for debugging. Stage-coded calls must be configured
          // in Super Admin and cannot fall back to legacy model-class defaults.
          console.error('[Gateway] ✗ Model resolution FAILED:', {
            error: message,
            planId: tenantContext.planId,
            taskCode: llmRequest.taskCode,
            stageCode: llmRequest.stageCode
          })
          if (llmRequest.stageCode) {
            if (decision.reservationId) {
              try {
                await this.system.reservation.releaseReservation(decision.reservationId)
                console.log(`[Gateway] Released reservation ${decision.reservationId} due to model resolution failure`)
              } catch (releaseError) {
                console.warn('[Gateway] Failed to release reservation on model resolution failure:', releaseError)
              }
            }
            return {
              success: false,
              error: new MeteringError('CONFIGURATION_ERROR', message)
            }
          }
          console.warn('[Gateway] ⚠️ Falling back to DEFAULT PROVIDER ROUTING (model resolution error)')
        }
      } else {
        console.warn('[Gateway] No planId in tenant context - using default routing for a task-only call')
      }

      if (!modelResolution) {
        delete decision.maxTokensIn
        delete decision.maxTokensOut
        console.warn('[Gateway] No LLM config token limits resolved; enforcing provider limits only')
      }

      // 6. Validate model capabilities (vision, streaming, etc.)
      const selectedModel = explicitModelCode || modelResolution?.modelCode || 'gemini-2.5-pro' // Default model
      const capabilityCheck = this.validateModelCapabilities(selectedModel, llmRequest)
      if (!capabilityCheck.valid) {
        console.error(`✗ Model capability validation failed: ${capabilityCheck.error}`)
        // Release reservation on early failure
        if (decision.reservationId) {
          try {
            await this.system.reservation.releaseReservation(decision.reservationId)
            console.log(`[Gateway] Released reservation ${decision.reservationId} due to capability validation failure`)
          } catch (releaseError) {
            console.warn('[Gateway] Failed to release reservation on capability failure:', releaseError)
          }
        }
        return {
          success: false,
          error: new MeteringError('INVALID_MODEL', capabilityCheck.error || 'Model does not support required capabilities')
        }
      }

      // 7. Preflight check: validate input size against provider limits
      const preflightResult = this.preflightCheck(
        selectedModel,
        llmRequest.inputTokens || 0,
        decision.maxTokensIn,
        decision.maxTokensOut
      )

      if (!preflightResult.valid) {
        console.error(`✗ Preflight check failed: ${preflightResult.error}`)
        // Release reservation on early failure
        if (decision.reservationId) {
          try {
            await this.system.reservation.releaseReservation(decision.reservationId)
            console.log(`[Gateway] Released reservation ${decision.reservationId} due to preflight failure`)
          } catch (releaseError) {
            console.warn('[Gateway] Failed to release reservation on preflight failure:', releaseError)
          }
        }
        return {
          success: false,
          error: new MeteringError('INPUT_TOO_LARGE', preflightResult.error || 'Input exceeds limits')
        }
      }
      
      // Apply clamped maxTokensOut if it exceeded provider limits
      if (preflightResult.clampedMaxTokensOut !== undefined) {
        decision.maxTokensOut = preflightResult.clampedMaxTokensOut
      }
      
      if (preflightResult.warnings.length > 0) {
        console.warn(`⚠ Preflight warnings: ${preflightResult.warnings.join('; ')}`)
      }

      // 8. Route to LLM provider with resolved model or default routing
      console.log('[Gateway] Step 8: Routing to LLM provider...')
      let response: LLMResponse
      
      if (explicitModelCode) {
        console.log('[Gateway] Using explicit model:', explicitModelCode)
        response = await llmProviderRouter.routeWithModel(
          llmRequest,
          decision,
          explicitModelCode
        )
      } else if (modelResolution) {
        // Use the resolved model with fallbacks
        console.log('[Gateway] Using resolved model:', modelResolution.modelCode)
        response = await llmProviderRouter.routeWithModel(
          llmRequest,
          decision,
          modelResolution.modelCode,
          modelResolution.fallbacks.map(f => f.modelCode)
        )
      } else {
        // Fall back to default priority-based routing
        console.log('[Gateway] Using default priority-based routing')
        response = await llmProviderRouter.routeAndExecute(llmRequest, decision)
      }
      console.log('[Gateway] LLM call completed, output length:', (response.output || '').length, 'chars')

      // 7. Record usage (metering for billing/quotas)
      if (decision.reservationId) {
        const responseInputTokens = response.metadata?.inputTokens
        const usageStats: UsageStats = {
          // Prefer provider-reported token usage; request.inputTokens is often just an estimate.
          inputTokens: responseInputTokens ?? llmRequest.inputTokens ?? 0,
          outputTokens: response.outputTokens ?? response.metadata?.outputTokens ?? 0,
          modelClass: response.modelClass as any,
          apiCalls: 1,
          metadata: {
            ...llmRequest.metadata,
            stageCode: llmRequest.stageCode,
            providerInputTokens: responseInputTokens ?? null,
            providerOutputTokens: response.outputTokens ?? response.metadata?.outputTokens ?? null,
            thoughtTokens: response.metadata?.thoughtTokens ?? response.metadata?.reasoningTokens ?? 0,
            thoughtTokensIncludedInOutput: response.metadata?.thoughtTokensIncludedInOutput === true,
            costBreakdown: response.metadata?.costBreakdown,
            modelSource: explicitModelCode ? 'explicit' : modelResolution?.source
          }
        }

        // The LLM call has already succeeded and incurred provider cost by this point.
        // A usage-recording failure must NOT discard the paid result or bubble up to the
        // outer catch (which would release the reservation and report failure, prompting the
        // caller to retry and pay for a second provider call). Record best-effort and always
        // return the successful response; surface recording failures as "unbilled completion".
        try {
          const recordResult = await this.system.metering.recordUsage(decision.reservationId, usageStats, tenantContext.userId)
          if (recordResult && recordResult.success === false) {
            console.error('[Gateway] Usage recording returned failure for a completed LLM call (UNBILLED COMPLETION):', {
              reservationId: decision.reservationId,
              error: recordResult.error?.message
            })
          }
        } catch (recordError) {
          console.error('[Gateway] Failed to record usage for a completed LLM call (UNBILLED COMPLETION); returning result anyway:', recordError instanceof Error ? recordError.message : recordError)
        }
      }

      return { success: true, response }

    } catch (error) {
      // Release reservation on any failure to prevent blocking subsequent operations
      if (decision?.reservationId) {
        try {
          await this.system.reservation.releaseReservation(decision.reservationId)
          console.log(`[Gateway] Released reservation ${decision.reservationId} due to LLM operation failure`)
        } catch (releaseError) {
          console.warn('[Gateway] Failed to release reservation on error:', releaseError)
        }
      }

      if (error instanceof MeteringError) {
        return { success: false, error }
      }

      console.error('LLM Gateway error:', error)
      const wrappedError = new MeteringError('SERVICE_UNAVAILABLE', 'LLM gateway error')
      return { success: false, error: wrappedError }
    }
  }

  /**
   * Execute LLM operation with explicit stage code
   * Convenience method for stage-aware calls
   */
  async executeLLMOperationForStage(
    request: { headers: Record<string, string> } | { tenantContext: TenantContext },
    taskCode: TaskCode,
    stageCode: string,
    prompt: string,
    options?: {
      parameters?: Record<string, any>
      idempotencyKey?: string
      content?: any
    }
  ): Promise<{ success: boolean; response?: LLMResponse; error?: MeteringError }> {
    const llmRequest: LLMRequest & { stageCode: string } = {
      taskCode,
      stageCode,
      prompt,
      parameters: options?.parameters,
      idempotencyKey: options?.idempotencyKey || crypto.randomUUID(),
      content: options?.content
    }

    return this.executeLLMOperation(request, llmRequest)
  }

  /**
   * Improved token estimation that accounts for text, images, and JSON payloads.
   * More accurate for quota management and billing.
   */
  private estimateInputTokens(llmRequest: LLMRequest): number {
    let textTokens = 0
    let imageTokens = 0

    // Estimate text tokens
    if (llmRequest.prompt) {
      textTokens += this.estimateTextTokens(llmRequest.prompt)
    }

    if (llmRequest.content?.parts?.length) {
      for (const part of llmRequest.content.parts) {
        if (part.type === 'text') {
          textTokens += this.estimateTextTokens(part.text)
        } else if (part.type === 'image') {
          // Image token estimation based on provider conventions:
          // - OpenAI: ~85 tokens for low detail, 85 + 170*tiles for high detail
          // - Gemini: Similar approach
          // - We'll use a conservative estimate of ~1000 tokens per image for high detail
          const imageData = part.image?.data || ''
          const imageSizeKB = Math.ceil((imageData.length * 3) / 4 / 1024) // Base64 to bytes
          
          if (imageSizeKB > 512) {
            // Large image - high detail processing
            imageTokens += 1500
          } else if (imageSizeKB > 128) {
            // Medium image
            imageTokens += 800
          } else {
            // Small image - low detail
            imageTokens += 300
          }
        }
      }
    }

    return textTokens + imageTokens
  }

  /**
   * Estimate tokens for text content using improved heuristics
   */
  private estimateTextTokens(text: string): number {
    if (!text) return 0
    
    // More accurate tokenization heuristic:
    // - English text: ~4 chars/token
    // - Code: ~3 chars/token (more symbols)
    // - JSON: ~2.5 chars/token (lots of structure)
    
    const hasJson = text.includes('{') && text.includes('}')
    const hasCode = text.includes('function') || text.includes('const ') || text.includes('import ')
    
    let charsPerToken = 4
    if (hasJson) charsPerToken = 2.5
    else if (hasCode) charsPerToken = 3
    
    return Math.ceil(text.length / charsPerToken)
  }

  /**
   * Check if the request requires vision capabilities
   */
  private requiresVision(llmRequest: LLMRequest): boolean {
    return !!(llmRequest.content?.parts?.some(part => part.type === 'image'))
  }

  /**
   * Models that support vision/multimodal input
   */
  private readonly VISION_CAPABLE_MODELS = new Set([
    // OpenAI
    'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-5', 'gpt-5.1', 'gpt-5.2', 'gpt-5-mini', 'gpt-5-nano',
    'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.4-pro', 'gpt-5.5', 'gpt-5.5-pro',
    'gpt-5.6', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna',
    'gpt-5.1-thinking', 'gpt-5.2-thinking', 'gpt-5.6-sol-thinking', 'gpt-5.6-terra-thinking',
    // Anthropic
    'claude-fable-5', 'claude-opus-4-8', 'claude-opus-4-8-thinking', 'claude-sonnet-5', 'claude-haiku-4-5',
    'claude-opus-4-7', 'claude-opus-4-6',
    'claude-3.5-sonnet', 'claude-3.5-haiku', 'claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku',
    'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229',
    // Z.AI GLM
    'glm-5v-turbo', 'glm-4.5v',
    // Google Gemini
    'gemini-3.5-flash', 'gemini-3.1-pro-preview', 'gemini-3.1-flash-lite', 'gemini-3-flash-preview',
    'gemini-2.5-pro',
    'gemini-2.0-flash', 'gemini-2.0-flash-001',
    'gemini-2.0-flash-lite', 'gemini-2.0-flash-lite-001',
    'gemini-1.5-pro', 'gemini-1.5-pro-002',
    'gemini-1.5-flash', 'gemini-1.5-flash-002',
    'gemini-3.0-nano-banana', 'gemini-3-pro-preview', 'gemini-3-pro-preview-thinking', 'gemini-3-pro-image-preview'
  ])

  /**
   * Validate that the model supports required capabilities
   */
  private validateModelCapabilities(modelCode: string, llmRequest: LLMRequest): { valid: boolean; error?: string } {
    // Check vision requirement
    if (this.requiresVision(llmRequest)) {
      if (!this.VISION_CAPABLE_MODELS.has(modelCode)) {
        return {
          valid: false,
          error: `Model ${modelCode} does not support vision/image inputs. Vision-capable models: GPT-4o, Claude 3.x, Gemini`
        }
      }
    }
    
    return { valid: true }
  }

  /**
   * Get provider context limits for preflight checks
   * Includes both friendly names and canonical API model IDs
   */
  private getProviderContextLimits(modelCode: string): { maxInput: number; maxOutput: number } {
    // Context limits by model - includes both friendly names and canonical API IDs
    const limits: Record<string, { maxInput: number; maxOutput: number }> = {
      // OpenAI - GPT-4 Series
      'gpt-4o': { maxInput: 128000, maxOutput: 16384 },
      'gpt-4o-mini': { maxInput: 128000, maxOutput: 16384 },
      'gpt-4-turbo': { maxInput: 128000, maxOutput: 4096 },
      'gpt-4': { maxInput: 8192, maxOutput: 4096 },
      // OpenAI - GPT-5 Series
      'gpt-5': { maxInput: 400000, maxOutput: 128000 },
      'gpt-5.1': { maxInput: 400000, maxOutput: 128000 },
      'gpt-5.2': { maxInput: 400000, maxOutput: 128000 },
      'gpt-5.4': { maxInput: 1050000, maxOutput: 128000 },
      'gpt-5.4-mini': { maxInput: 400000, maxOutput: 128000 },
      'gpt-5.4-nano': { maxInput: 400000, maxOutput: 128000 },
      'gpt-5.4-pro': { maxInput: 1050000, maxOutput: 128000 },
      'gpt-5.5': { maxInput: 1050000, maxOutput: 128000 },
      'gpt-5.5-pro': { maxInput: 1050000, maxOutput: 128000 },
      // OpenAI - GPT-5.6 Series (Sol / Terra / Luna)
      'gpt-5.6': { maxInput: 1050000, maxOutput: 128000 },
      'gpt-5.6-sol': { maxInput: 1050000, maxOutput: 128000 },
      'gpt-5.6-terra': { maxInput: 1050000, maxOutput: 128000 },
      'gpt-5.6-luna': { maxInput: 1050000, maxOutput: 128000 },
      'gpt-5.6-sol-thinking': { maxInput: 1050000, maxOutput: 128000 },
      'gpt-5.6-terra-thinking': { maxInput: 1050000, maxOutput: 128000 },
      'gpt-5-mini': { maxInput: 200000, maxOutput: 64000 },
      'gpt-5-nano': { maxInput: 128000, maxOutput: 32000 },
      // OpenAI - GPT-5 Thinking Variants (alias to base)
      'gpt-5.1-thinking': { maxInput: 400000, maxOutput: 128000 },
      'gpt-5.2-thinking': { maxInput: 400000, maxOutput: 128000 },
      // OpenAI - GPT-3.5 Series
      'gpt-3.5-turbo': { maxInput: 16385, maxOutput: 4096 },
      // OpenAI - o1 Reasoning Models
      'o1': { maxInput: 200000, maxOutput: 100000 },
      'o1-mini': { maxInput: 128000, maxOutput: 65536 },
      'o1-preview': { maxInput: 128000, maxOutput: 32768 },
      // OpenAI - o3 / o4 Reasoning Models
      'o3': { maxInput: 200000, maxOutput: 100000 },
      'o3-mini': { maxInput: 200000, maxOutput: 100000 },
      'o4-mini': { maxInput: 200000, maxOutput: 100000 },

      // Anthropic - Claude 5 family + Opus 4.8 + Haiku 4.5 (2026)
      'claude-fable-5': { maxInput: 1000000, maxOutput: 128000 },
      'claude-opus-4-8': { maxInput: 1000000, maxOutput: 128000 },
      'claude-opus-4-8-thinking': { maxInput: 1000000, maxOutput: 128000 },
      'claude-sonnet-5': { maxInput: 1000000, maxOutput: 128000 },
      'claude-haiku-4-5': { maxInput: 200000, maxOutput: 64000 },
      'claude-opus-4-7': { maxInput: 1000000, maxOutput: 128000 },
      'claude-opus-4-6': { maxInput: 1000000, maxOutput: 128000 },
      // Anthropic - Friendly names
      'claude-3.5-sonnet': { maxInput: 200000, maxOutput: 8192 },
      'claude-3.5-haiku': { maxInput: 200000, maxOutput: 8192 },
      'claude-3-opus': { maxInput: 200000, maxOutput: 4096 },
      'claude-3-sonnet': { maxInput: 200000, maxOutput: 4096 },
      'claude-3-haiku': { maxInput: 200000, maxOutput: 4096 },
      // Anthropic - Canonical API model IDs (with dates)
      'claude-3-5-sonnet-20241022': { maxInput: 200000, maxOutput: 8192 },
      'claude-3-5-haiku-20241022': { maxInput: 200000, maxOutput: 8192 },
      'claude-3-opus-20240229': { maxInput: 200000, maxOutput: 4096 },
      'claude-3-sonnet-20240229': { maxInput: 200000, maxOutput: 4096 },
      'claude-3-haiku-20240307': { maxInput: 200000, maxOutput: 4096 },
      
      // Gemini - Latest families (2026)
      'gemini-3.5-flash': { maxInput: 1000000, maxOutput: 65536 },
      'gemini-3.1-pro-preview': { maxInput: 2000000, maxOutput: 65536 },
      'gemini-3.1-flash-lite': { maxInput: 1000000, maxOutput: 65536 },
      'gemini-3-flash-preview': { maxInput: 1000000, maxOutput: 65536 },
      // Gemini
      'gemini-2.5-pro': { maxInput: 1000000, maxOutput: 8192 },
      'gemini-2.0-flash': { maxInput: 1000000, maxOutput: 8192 },
      'gemini-2.0-flash-001': { maxInput: 1000000, maxOutput: 8192 },
      'gemini-2.0-flash-lite': { maxInput: 1000000, maxOutput: 8192 },
      'gemini-2.0-flash-lite-001': { maxInput: 1000000, maxOutput: 8192 },
      'gemini-1.5-pro': { maxInput: 2000000, maxOutput: 8192 },
      'gemini-1.5-pro-002': { maxInput: 2000000, maxOutput: 8192 },
      'gemini-1.5-flash': { maxInput: 1000000, maxOutput: 8192 },
      'gemini-1.5-flash-002': { maxInput: 1000000, maxOutput: 8192 },
      'gemini-3.0-nano-banana': { maxInput: 1000000, maxOutput: 8192 },
      'gemini-3-pro-preview': { maxInput: 2000000, maxOutput: 16384 },
      'gemini-3-pro-preview-thinking': { maxInput: 2000000, maxOutput: 16384 },
      'gemini-3-pro-image-preview': { maxInput: 1000000, maxOutput: 8192 },
      
      // DeepSeek
      'deepseek-v4-pro': { maxInput: 1000000, maxOutput: 65536 },
      'deepseek-v4-flash': { maxInput: 1000000, maxOutput: 65536 },
      'deepseek-chat': { maxInput: 128000, maxOutput: 8192 },
      'deepseek-reasoner': { maxInput: 128000, maxOutput: 8192 },

      // Z.AI GLM
      'glm-5.1': { maxInput: 200000, maxOutput: 128000 },
      'glm-5': { maxInput: 200000, maxOutput: 128000 },
      'glm-5-turbo': { maxInput: 200000, maxOutput: 128000 },
      'glm-5v-turbo': { maxInput: 200000, maxOutput: 128000 },
      'glm-4.7': { maxInput: 128000, maxOutput: 128000 },
      'glm-4.7-flash': { maxInput: 128000, maxOutput: 128000 },
      'glm-4.7-flashx': { maxInput: 128000, maxOutput: 128000 },
      'glm-4.6': { maxInput: 128000, maxOutput: 128000 },
      'glm-4.5': { maxInput: 128000, maxOutput: 96000 },
      'glm-4.5-air': { maxInput: 128000, maxOutput: 96000 },
      'glm-4.5-x': { maxInput: 128000, maxOutput: 96000 },
      'glm-4.5-airx': { maxInput: 128000, maxOutput: 96000 },
      'glm-4.5-flash': { maxInput: 128000, maxOutput: 96000 },
      'glm-4.5v': { maxInput: 128000, maxOutput: 16000 },
      'glm-4-32b-0414-128k': { maxInput: 128000, maxOutput: 16000 },
      
      // Groq - Friendly names (prefixed)
      'groq-llama-3.3-70b': { maxInput: 128000, maxOutput: 8192 },
      'groq-llama-3.1-70b': { maxInput: 128000, maxOutput: 8192 },
      'groq-llama-3.1-8b': { maxInput: 128000, maxOutput: 8192 },
      'groq-mixtral-8x7b': { maxInput: 32768, maxOutput: 8192 },
      'groq-gemma2-9b': { maxInput: 8192, maxOutput: 8192 },
      // Groq - Canonical API model IDs
      'llama-3.3-70b-versatile': { maxInput: 128000, maxOutput: 8192 },
      'llama-3.1-70b-versatile': { maxInput: 128000, maxOutput: 8192 },
      'llama-3.1-8b-instant': { maxInput: 128000, maxOutput: 8192 },
      'mixtral-8x7b-32768': { maxInput: 32768, maxOutput: 8192 },
      'gemma2-9b-it': { maxInput: 8192, maxOutput: 8192 }
    }
    
    // First try exact match
    if (limits[modelCode]) {
      return limits[modelCode]
    }
    
    // Fallback: try to match by prefix for unknown model variants
    const lowerCode = modelCode.toLowerCase()
    if (lowerCode.startsWith('gpt-4')) return { maxInput: 128000, maxOutput: 16384 }
    if (lowerCode.startsWith('gpt-5.4') || lowerCode.startsWith('gpt-5.5') || lowerCode.startsWith('gpt-5.6')) return { maxInput: 1050000, maxOutput: 128000 }
    if (lowerCode.startsWith('gpt-5')) return { maxInput: 400000, maxOutput: 128000 }
    if (lowerCode.startsWith('gpt-3')) return { maxInput: 16385, maxOutput: 4096 }
    if (lowerCode.startsWith('o1')) return { maxInput: 128000, maxOutput: 65536 }
    // Other o-series reasoning models (o3, o3-mini, o4-mini, ...)
    if (/^o\d/.test(lowerCode)) return { maxInput: 200000, maxOutput: 100000 }
    if (lowerCode.startsWith('claude')) return { maxInput: 200000, maxOutput: 8192 }
    if (lowerCode.startsWith('gemini')) return { maxInput: 1000000, maxOutput: 8192 }
    if (lowerCode.startsWith('llama') || lowerCode.startsWith('groq-llama')) return { maxInput: 128000, maxOutput: 8192 }
    if (lowerCode.startsWith('mixtral') || lowerCode.startsWith('groq-mixtral')) return { maxInput: 32768, maxOutput: 8192 }
    if (lowerCode.startsWith('deepseek')) return { maxInput: 128000, maxOutput: 8192 }
    if (lowerCode.startsWith('glm-5')) return { maxInput: 200000, maxOutput: 128000 }
    if (lowerCode.startsWith('glm-4.7') || lowerCode.startsWith('glm-4.6')) return { maxInput: 128000, maxOutput: 128000 }
    if (lowerCode.startsWith('glm-4.5v')) return { maxInput: 128000, maxOutput: 16000 }
    if (lowerCode.startsWith('glm-4.5')) return { maxInput: 128000, maxOutput: 96000 }
    if (lowerCode.startsWith('glm') || lowerCode.startsWith('zai') || lowerCode.startsWith('z.ai')) return { maxInput: 128000, maxOutput: 96000 }
    
    // Safe defaults for truly unknown models
    console.warn(`[getProviderContextLimits] Unknown model: ${modelCode}, using safe defaults`)
    return { maxInput: 32768, maxOutput: 4096 }
  }

  /**
   * Preflight check: validate input size against provider limits
   * Returns clamped maxTokensOut if it exceeds provider limits
   */
  private preflightCheck(
    modelCode: string,
    estimatedInputTokens: number,
    maxTokensIn?: number,
    maxTokensOut?: number
  ): { valid: boolean; error?: string; warnings: string[]; clampedMaxTokensOut?: number } {
    const warnings: string[] = []
    const providerLimits = this.getProviderContextLimits(modelCode)
    
    // Check against provider context limits
    if (estimatedInputTokens > providerLimits.maxInput) {
      return {
        valid: false,
        error: `Input too large: estimated ${estimatedInputTokens} tokens exceeds ${modelCode} limit of ${providerLimits.maxInput}`,
        warnings
      }
    }
    
    // Check against admin-configured maxTokensIn
    if (maxTokensIn && estimatedInputTokens > maxTokensIn) {
      return {
        valid: false,
        error: `Input exceeds stage limit: ${estimatedInputTokens} tokens > configured limit of ${maxTokensIn}`,
        warnings
      }
    }
    
    // Clamp output tokens to provider limits (FIX: actually clamp, not just warn)
    let clampedMaxTokensOut: number | undefined
    if (maxTokensOut && maxTokensOut > providerLimits.maxOutput) {
      clampedMaxTokensOut = providerLimits.maxOutput
      warnings.push(`Clamped output tokens from ${maxTokensOut} to provider limit of ${providerLimits.maxOutput}`)
    }
    
    // Warn if approaching limits
    if (estimatedInputTokens > providerLimits.maxInput * 0.8) {
      warnings.push(`Input is ${Math.round(estimatedInputTokens / providerLimits.maxInput * 100)}% of ${modelCode} context limit`)
    }
    
    return { valid: true, warnings, clampedMaxTokensOut }
  }

  private getFeatureForTask(taskCode: TaskCode): FeatureCode {
    const taskToFeatureMap: Record<TaskCode, FeatureCode> = {
      LLM1_PRIOR_ART: 'PRIOR_ART_SEARCH',
      LLM2_DRAFT: 'PATENT_DRAFTING',
      LLM3_DIAGRAM: 'DIAGRAM_GENERATION',
      LLM4_NOVELTY_SCREEN: 'NOVELTY_SEARCH', // Standalone novelty search (separate quota)
      LLM5_NOVELTY_ASSESS: 'NOVELTY_SEARCH', // Standalone novelty search (separate quota)
      LLM6_REPORT_GENERATION: 'NOVELTY_SEARCH', // Standalone novelty search (separate quota)
      LLM1_CLAIM_REFINEMENT: 'PATENT_DRAFTING',
      IDEA_BANK_ACCESS: 'IDEA_BANK',
      IDEA_BANK_RESERVE: 'IDEA_BANK',
      IDEA_BANK_EDIT: 'IDEA_BANK',
      PERSONA_SYNC_LEARN: 'PERSONA_SYNC',
      IDEATION_NORMALIZE: 'IDEATION',
      IDEATION_CLASSIFY: 'IDEATION',
      IDEATION_CONTRADICTION_MAPPING: 'IDEATION',
      IDEATION_EXPAND: 'IDEATION',
      IDEATION_OBVIOUSNESS_FILTER: 'IDEATION',
      IDEATION_GENERATE: 'IDEATION',
      IDEATION_NOVELTY: 'IDEATION',
      LLM7_ADVANCED_MANUAL_SEARCH: 'NOVELTY_SEARCH', // Prior-Art Studio query generator (novelty quota)
      LLM8_OA_RESPONSE: 'OFFICE_ACTION_RESPONSE', // Office Action Studio pipeline stages
      // Whitespace Studio. All six stages meter against one feature so a plan
      // grants "N analyses" rather than a per-stage budget nobody can reason about.
      WS_SCOPE: 'WHITESPACE_ANALYSIS',
      WS_CLUSTER_LABEL: 'WHITESPACE_ANALYSIS',
      WS_CLAIM_ELEMENTS: 'WHITESPACE_ANALYSIS',
      WS_HYPOTHESIZE: 'WHITESPACE_ANALYSIS',
      WS_VALIDATE: 'WHITESPACE_ANALYSIS',
      WS_REDTEAM: 'WHITESPACE_ANALYSIS',
      WS_DIMENSIONS: 'WHITESPACE_ANALYSIS'
    }
    return taskToFeatureMap[taskCode]
  }

  // Provider management methods
  getAvailableProviders(): string[] {
    return llmProviderRouter.getAvailableProviders()
  }

  getProviderHealth(): Record<string, { healthy: boolean; failureCount: number; lastError?: string }> {
    return llmProviderRouter.getProviderHealth()
  }

  async refreshProviders(): Promise<void> {
    await llmProviderRouter.refreshProviders()
  }

  /**
   * Check if a model supports vision (exposed for router fallback validation)
   */
  isModelVisionCapable(modelCode: string): boolean {
    return this.VISION_CAPABLE_MODELS.has(modelCode)
  }

  /**
   * Get context limits for a model (exposed for router fallback validation)
   */
  getModelContextLimits(modelCode: string): { maxInput: number; maxOutput: number } {
    return this.getProviderContextLimits(modelCode)
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
// Note: These helper functions support optional stageCode for admin-configured model/limits

export async function executePriorArtSearch(
  request: { headers: Record<string, string> },
  query: string,
  options?: { maxResults?: number; sources?: string[]; stageCode?: string }
): Promise<{ success: boolean; results?: any[]; error?: MeteringError }> {
  const llmRequest: LLMRequest & { stageCode?: string } = {
    taskCode: 'LLM1_PRIOR_ART',
    stageCode: options?.stageCode || 'NOVELTY_QUERY_GENERATION', // Default stage for prior art search
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
  options?: { jurisdiction?: string; type?: string; stageCode?: string }
): Promise<{ success: boolean; draft?: string; error?: MeteringError }> {
  const llmRequest: LLMRequest & { stageCode?: string } = {
    taskCode: 'LLM2_DRAFT',
    stageCode: options?.stageCode || 'DRAFT_ANNEXURE_DESCRIPTION', // Default stage for patent drafting
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
  format: 'plantuml' | 'mermaid' = 'plantuml',
  options?: { stageCode?: string }
): Promise<{ success: boolean; diagram?: string; error?: MeteringError }> {
  const llmRequest: LLMRequest & { stageCode?: string } = {
    taskCode: 'LLM3_DIAGRAM',
    stageCode: options?.stageCode || 'DRAFT_DIAGRAM_GENERATION', // Default stage for diagram generation
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
