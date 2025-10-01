// Policy service (Modules 3-4)
// Evaluates access and enforces policy rules

import type { MeteringConfig, PolicyService, FeatureRequest, EnforcementDecision, PolicyLimits } from './types'
import { MeteringErrorUtils, MeteringError } from './errors'
import { prisma } from '@/lib/prisma'

export function createPolicyService(config: MeteringConfig): PolicyService {
  return {
    async evaluateAccess(request: FeatureRequest): Promise<EnforcementDecision> {
      try {
        // 1. Get tenant context (already resolved by identity service)
        const tenant = await prisma.tenant.findUnique({
          where: { id: request.tenantId },
          select: { status: true }
        })

        if (!tenant || tenant.status !== 'ACTIVE') {
          return {
            allowed: false,
            reason: 'Tenant not found or inactive'
          }
        }

        // 2. Get tenant's plan (via ATI token inheritance)
        const atiToken = await prisma.aTIToken.findFirst({
          where: {
            tenantId: request.tenantId,
            status: 'ISSUED'
          },
          select: { planTier: true }
        })

        if (!atiToken?.planTier) {
          return {
            allowed: false,
            reason: 'No plan found for tenant'
          }
        }

        // 3. Get plan details
        const plan = await prisma.plan.findFirst({
          where: {
            code: atiToken.planTier,
            status: 'ACTIVE'
          },
          include: {
            planFeatures: {
              include: { feature: true }
            },
            planLLMAccess: {
              include: { defaultClass: true }
            },
            policyRules: true
          }
        })

        if (!plan) {
          return {
            allowed: false,
            reason: `Plan '${atiToken.planTier}' not found`
          }
        }

        // 4. Check feature availability
        const planFeature = plan.planFeatures.find(
          pf => pf.feature.code === request.featureCode
        )

        if (!planFeature) {
          return {
            allowed: false,
            reason: `Feature '${request.featureCode}' not available in plan '${plan.code}'`
          }
        }

        // 5. Check quota limits
        const quotaCheck = await this.checkQuota(request)
        if (!quotaCheck.allowed) {
          return {
            allowed: false,
            reason: quotaCheck.resetTime
              ? `Quota exceeded. Resets at ${quotaCheck.resetTime.toISOString()}`
              : 'Quota exceeded',
            remainingQuota: quotaCheck.remaining
          }
        }

        // 6. Get LLM access for tasks
        let modelClass = null
        let allowedClasses = []
        if (request.taskCode) {
          const llmAccess = plan.planLLMAccess.find(
            access => access.taskCode === request.taskCode
          )

          if (llmAccess) {
            modelClass = llmAccess.defaultClass.code
            allowedClasses = JSON.parse(llmAccess.allowedClasses || '[]')
          }
        }

        // 7. Get policy limits
        const policyLimits = await this.getPolicyLimits(request.tenantId, request.taskCode)

        // 8. Create reservation for enforcement
        const reservationId = await this.createReservation(request, policyLimits)

        return {
          allowed: true,
          modelClass: modelClass as any,
          maxTokensIn: policyLimits.maxTokensIn,
          maxTokensOut: policyLimits.maxTokensOut,
          maxSteps: policyLimits.agentMaxSteps,
          topK: policyLimits.retrievalTopK,
          maxFiles: policyLimits.diagramFilesPerReq,
          concurrencyLimit: policyLimits.concurrencyLimit,
          reservationId,
          remainingQuota: quotaCheck.remaining
        }

      } catch (error) {
        console.error('Policy evaluation error:', error)
        return {
          allowed: false,
          reason: 'Policy evaluation failed'
        }
      }
    },

    async getPolicyLimits(tenantId: string, taskCode?: any): Promise<PolicyLimits> {
      try {
        // Get tenant's plan
        const atiToken = await prisma.aTIToken.findFirst({
          where: {
            tenantId,
            status: 'ISSUED'
          },
          select: { planTier: true }
        })

        if (!atiToken?.planTier) {
          return config.defaultLimits
        }

        // Get plan policy rules
        const policyRules = await prisma.policyRule.findMany({
          where: {
            OR: [
              { scope: 'plan', scopeId: atiToken.planTier },
              { scope: 'tenant', scopeId: tenantId }
            ],
            ...(taskCode && { taskCode })
          }
        })

        // Convert rules to limits object
        const limits: PolicyLimits = { ...config.defaultLimits }

        policyRules.forEach(rule => {
          switch (rule.key) {
            case 'max_tokens_in':
              limits.maxTokensIn = rule.value
              break
            case 'max_tokens_out':
              limits.maxTokensOut = rule.value
              break
            case 'agent_max_steps':
              limits.agentMaxSteps = rule.value
              break
            case 'retrieval_top_k':
              limits.retrievalTopK = rule.value
              break
            case 'diagram_files_per_req':
              limits.diagramFilesPerReq = rule.value
              break
            case 'concurrency_limit':
              limits.concurrencyLimit = rule.value
              break
          }
        })

        return limits

      } catch (error) {
        console.warn('Failed to get policy limits, using defaults:', error)
        return config.defaultLimits
      }
    },

    async checkQuota(request: FeatureRequest): Promise<{ allowed: boolean, remaining: any, resetTime?: Date }> {
      // Import and use the metering service
      const { createMeteringService, defaultConfig } = await import('./index')
      const meteringService = createMeteringService(defaultConfig)

      return await meteringService.checkQuota(request)
    },

    async createReservation(request: FeatureRequest, limits: PolicyLimits): Promise<string> {
      // Import the reservation service
      const { createReservationService, defaultConfig } = await import('./index')
      const reservationService = createReservationService(defaultConfig)

      // Estimate units based on limits
      const estimatedUnits = limits.maxTokensOut || 1000

      return await reservationService.createReservation({
        tenantId: request.tenantId,
        featureCode: request.featureCode,
        taskCode: request.taskCode,
        userId: request.userId,
        idempotencyKey: `policy-${Date.now()}-${Math.random()}`
      }, estimatedUnits)
    }
  }
}
