// Metering service (Module 7)
// Records and tracks usage

import type { MeteringConfig, MeteringService, FeatureRequest, QuotaCheckResult, UsageStats, MeteringResult } from './types'
import { MeteringErrorUtils, MeteringError } from './errors'
import { prisma } from '@/lib/prisma'
import { calculateCost, CONTINGENCY_MULTIPLIER } from './cost-calculator'

function getCurrentPeriod(type: 'DAILY' | 'MONTHLY'): { key: string, start: Date, end: Date } {
  const now = new Date()
  let key: string
  let start: Date
  let end: Date

  if (type === 'DAILY') {
    key = now.toISOString().split('T')[0] // YYYY-MM-DD
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  } else {
    key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}` // YYYY-MM
    start = new Date(now.getFullYear(), now.getMonth(), 1)
    end = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  }

  return { key, start, end }
}

export function createMeteringService(config: MeteringConfig): MeteringService {
  return {
    async recordUsage(reservationId: string, stats: UsageStats, userId?: string): Promise<MeteringResult> {
      try {
        // Verify reservation exists and is active
        const reservation = await prisma.usageReservation.findUnique({
          where: { id: reservationId },
          include: { tenant: true }
        })

        if (!reservation) {
          throw new MeteringError('RESERVATION_NOT_FOUND', 'Reservation not found')
        }

        if (reservation.status !== 'ACTIVE') {
          throw new MeteringError('RESERVATION_FAILED', `Reservation status: ${reservation.status}`)
        }

        // Update usage meters
        await this.updateUsageMeters(reservation, stats)

        // Calculate cost using the model class
        // Use ?? (nullish coalescing) instead of || to handle 0 as a valid token count
        let costData: { actualCost: number; contingencyCost: number; inputCost: number; outputCost: number } | null = null
        if (stats.modelClass) {
          const costBreakdown = calculateCost(
            stats.modelClass,
            stats.inputTokens ?? 0,
            stats.outputTokens ?? 0,
            stats.metadata?.thoughtTokens
          )
          costData = {
            actualCost: costBreakdown.actualCost,
            contingencyCost: costBreakdown.contingencyCost,
            inputCost: costBreakdown.inputCost,
            outputCost: costBreakdown.outputCost
          }
        }

        // Create usage log with cost data in metadata
        try {
          await prisma.usageLog.create({
            data: {
              tenantId: reservation.tenantId,
              userId: userId,
              featureId: reservation.featureId,
              taskCode: reservation.taskCode,
              modelClass: stats.modelClass,
              apiCode: stats.apiCode,
              inputTokens: stats.inputTokens,
              outputTokens: stats.outputTokens,
              apiCalls: stats.apiCalls || 1,
              startedAt: reservation.createdAt,
              completedAt: new Date(),
              status: 'COMPLETED',
              idempotencyKey: reservation.idempotencyKey,
              reservationId: reservation.id,
              meta: {
                ...(stats.metadata ? JSON.parse(JSON.stringify(stats.metadata)) : {}),
                // Store cost data in metadata
                cost: costData
              }
            }
          })
        } catch (logError: any) {
          // Handle foreign key constraint violations gracefully (e.g., when migrations haven't been run)
          if (logError.code === 'P2003') {
            console.warn(`Skipping usage log creation due to missing task code: ${reservation.taskCode}`)
          } else {
            console.error('Failed to create usage log:', logError)
          }
        }

        // Mark reservation as completed
        await prisma.usageReservation.update({
          where: { id: reservationId },
          data: { status: 'COMPLETED' }
        })

        // Check for quota alerts
        await this.checkQuotaAlerts(reservation.tenantId, reservation.featureId || undefined, reservation.taskCode || undefined)

        return {
          success: true,
          reservationId,
          usageCommitted: true
        }

      } catch (error) {
        // Mark reservation as failed
        try {
          await prisma.usageReservation.update({
            where: { id: reservationId },
            data: { status: 'FAILED' }
          })
        } catch (updateError) {
          console.error('Failed to update reservation status:', updateError)
        }

        // Create failed usage log
        try {
          const reservation = await prisma.usageReservation.findUnique({
            where: { id: reservationId }
          })

          if (reservation) {
            try {
              await prisma.usageLog.create({
                data: {
                  tenantId: reservation.tenantId,
                  userId: undefined, // User ID not stored in reservation
                  featureId: reservation.featureId,
                  taskCode: reservation.taskCode,
                  startedAt: reservation.createdAt,
                  completedAt: new Date(),
                  status: 'FAILED',
                  error: error instanceof Error ? error.message : String(error),
                  idempotencyKey: reservation.idempotencyKey,
                  reservationId: reservation.id
                }
              })
            } catch (logError: any) {
              // Handle foreign key constraint violations gracefully (e.g., when migrations haven't been run)
              if (logError.code === 'P2003') {
                console.warn(`Skipping failed usage log creation due to missing task code: ${reservation.taskCode}`)
              } else {
                console.error('Failed to create error log:', logError)
              }
            }
          }
        } catch (logError) {
          console.error('Failed to create error log:', logError)
        }

        if (error instanceof MeteringError) {
          return {
            success: false,
            error
          }
        }

        throw MeteringErrorUtils.wrap(error, 'DATABASE_ERROR')
      }
    },

    async checkQuota(request: FeatureRequest): Promise<QuotaCheckResult> {
      try {
        // SPECIAL CASE: PATENT_DRAFTING completion quotas are handled separately by PatentDraftingTracker
        // The PatentDraftingTracker counts COMPLETE PATENTS (when both description + claims are saved)
        // The metering system here counts LLM API CALLS, which is a different metric.
        // For PATENT_DRAFTING, we bypass the LLM completion quota check to avoid confusion.
        // The patent count limit is enforced in patent-drafting-tracker.ts via canDraftPatent()
        if (request.featureCode === 'PATENT_DRAFTING') {
          console.log('[Metering] PATENT_DRAFTING: Bypassing LLM completion quota (patent count handled by PatentDraftingTracker)')
          return {
            allowed: true,
            remaining: { monthly: undefined, daily: undefined }  // undefined = unlimited for LLM calls
          }
        }

        // SPECIAL CASE: DIAGRAM_GENERATION is part of the patent drafting workflow
        // Diagrams are generated as part of each patent draft, so counting individual LLM calls
        // for diagram generation separately doesn't make sense.
        // The patent count limit already controls how many patents (with diagrams) can be drafted.
        if (request.featureCode === 'DIAGRAM_GENERATION') {
          console.log('[Metering] DIAGRAM_GENERATION: Bypassing LLM completion quota (part of patent drafting workflow)')
          return {
            allowed: true,
            remaining: { monthly: undefined, daily: undefined }  // undefined = unlimited for LLM calls
          }
        }

        // First check if tenant is in PENDING_PAYMENT status (self-service signup not yet paid)
        const tenant = await prisma.tenant.findUnique({
          where: { id: request.tenantId },
          select: { status: true }
        })
        
        if (tenant?.status === 'PENDING_PAYMENT') {
          return { allowed: false, remaining: { monthly: 0, daily: 0 } }
        }

        // Get tenant's current active plan (also check expiry)
        const now = new Date()
        const tenantPlan = await prisma.tenantPlan.findFirst({
          where: {
            tenantId: request.tenantId,
            status: 'ACTIVE',
            // Check that plan hasn't expired
            OR: [
              { expiresAt: null },           // No expiry set
              { expiresAt: { gt: now } }     // Not expired yet
            ]
          },
          include: {
            plan: true
          },
          orderBy: {
            effectiveFrom: 'desc'
          }
        })

        if (!tenantPlan?.plan) {
          return { allowed: false, remaining: { monthly: 0, daily: 0 } }
        }

        // Get the feature record to get featureId
        const feature = await prisma.feature.findUnique({
          where: { code: request.featureCode }
        })

        if (!feature) {
          return { allowed: false, remaining: { monthly: 0, daily: 0 } }
        }

        // Check for tenant-specific override FIRST (Enterprise customers with negotiated limits)
        // This allows Enterprise tenants to access features not in their base plan
        const tenantOverride = await prisma.tenantFeatureOverride.findUnique({
          where: {
            tenantId_featureId: {
              tenantId: request.tenantId,
              featureId: feature.id
            }
          }
        })

        // Check if override has expired
        const overrideValid = tenantOverride && (!tenantOverride.expiresAt || tenantOverride.expiresAt > new Date())

        // Get plan feature limits (may not exist if feature is not in plan)
        const planFeature = await prisma.planFeature.findFirst({
          where: {
            planId: tenantPlan.plan.id,
            featureId: feature.id
          }
        })

        // If no plan feature AND no valid override, deny access
        if (!planFeature && !overrideValid) {
          return { allowed: false, remaining: { monthly: 0, daily: 0 } }
        }

        // Use override values if valid, otherwise use plan defaults (or null if no plan feature)
        // null means unlimited quota for that period
        const monthlyQuota = (overrideValid && tenantOverride.monthlyQuota !== null) 
          ? tenantOverride.monthlyQuota 
          : (planFeature?.monthlyQuota ?? null)
        const dailyQuota = (overrideValid && tenantOverride.dailyQuota !== null)
          ? tenantOverride.dailyQuota
          : (planFeature?.dailyQuota ?? null)

        // Get current usage
        const monthlyUsage = await this.getCurrentUsage(
          request.tenantId,
          request.featureCode,
          'MONTHLY'
        )

        const dailyUsage = await this.getCurrentUsage(
          request.tenantId,
          request.featureCode,
          'DAILY'
        )

        // Calculate remaining (null quota means unlimited, so remaining is also null)
        const monthlyRemaining = monthlyQuota === null ? null : Math.max(0, monthlyQuota - monthlyUsage)
        const dailyRemaining = dailyQuota === null ? null : Math.max(0, dailyQuota - dailyUsage)

        // Check if quota exceeded
        // null remaining means unlimited, so it's always allowed
        const monthlyAllowed = monthlyRemaining === null || monthlyRemaining > 0
        const dailyAllowed = dailyRemaining === null || dailyRemaining > 0
        const allowed = monthlyAllowed && dailyAllowed

        // Calculate reset time (monthly by default)
        const resetTime = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1)

        return {
          allowed,
          remaining: {
            monthly: monthlyRemaining,
            daily: dailyRemaining
          },
          resetTime
        }

      } catch (error) {
        console.error('Quota check failed:', error)
        // SECURITY: Fail closed in production - deny access on error
        // This prevents access bypass during database outages or errors
        const isProduction = process.env.NODE_ENV === 'production'
        if (isProduction) {
          console.error('[SECURITY] Quota check failed - denying access in production')
          return { allowed: false, remaining: { monthly: 0, daily: 0 } }
        }
        // Allow in dev mode for easier debugging
        console.warn('[DEV] Quota check failed - allowing access in dev mode')
        return {
          allowed: true,
          remaining: { monthly: 999999, daily: 999999 }
        }
      }
    },

    async getUsage(tenantId: string, featureCode?: any, period?: any) {
      const periodType = (period === 'daily' ? 'DAILY' : 'MONTHLY') as 'DAILY' | 'MONTHLY'

      const usage = await this.getCurrentUsage(tenantId, featureCode, periodType)

      const { start, end } = getCurrentPeriod(periodType)

      // Get plan limits
      let limit: number | undefined
      if (featureCode) {
        const tenantPlan = await prisma.tenantPlan.findFirst({
          where: {
            tenantId,
            status: 'ACTIVE'
          },
          include: {
            plan: true
          },
          orderBy: {
            effectiveFrom: 'desc'
          }
        })

        if (tenantPlan?.plan) {
          const planFeature = await prisma.planFeature.findFirst({
            where: {
              planId: tenantPlan.plan.id,
              feature: { code: featureCode }
            }
          })

          limit = periodType === 'DAILY'
            ? planFeature?.dailyQuota || undefined
            : planFeature?.monthlyQuota || undefined
        }
      }

      return {
        current: usage,
        limit,
        resetTime: end
      }
    },

    async updateUsageMeters(reservation: any, stats: UsageStats): Promise<void> {
      const updates = []

      // Update monthly meter
      const monthlyPeriod = getCurrentPeriod('MONTHLY')
      updates.push(
        prisma.usageMeter.upsert({
          where: {
            tenantId_featureId_taskCode_periodType_periodKey: {
              tenantId: reservation.tenantId,
              featureId: reservation.featureId,
              taskCode: reservation.taskCode,
              periodType: 'MONTHLY',
              periodKey: monthlyPeriod.key
            }
          },
          update: {
            currentUsage: {
              increment: stats.outputTokens || stats.apiCalls || 1
            },
            lastUpdated: new Date()
          },
          create: {
            tenantId: reservation.tenantId,
            featureId: reservation.featureId,
            taskCode: reservation.taskCode,
            periodType: 'MONTHLY',
            periodKey: monthlyPeriod.key,
            currentUsage: stats.outputTokens || stats.apiCalls || 1
          }
        })
      )

      // Update daily meter
      const dailyPeriod = getCurrentPeriod('DAILY')
      updates.push(
        prisma.usageMeter.upsert({
          where: {
            tenantId_featureId_taskCode_periodType_periodKey: {
              tenantId: reservation.tenantId,
              featureId: reservation.featureId,
              taskCode: reservation.taskCode,
              periodType: 'DAILY',
              periodKey: dailyPeriod.key
            }
          },
          update: {
            currentUsage: {
              increment: stats.outputTokens || stats.apiCalls || 1
            },
            lastUpdated: new Date()
          },
          create: {
            tenantId: reservation.tenantId,
            featureId: reservation.featureId,
            taskCode: reservation.taskCode,
            periodType: 'DAILY',
            periodKey: dailyPeriod.key,
            currentUsage: stats.outputTokens || stats.apiCalls || 1
          }
        })
      )

      await Promise.all(updates)
    },

    async getCurrentUsage(tenantId: string, featureCodeOrId?: string, periodType: 'DAILY' | 'MONTHLY' = 'MONTHLY'): Promise<number> {
      const { key } = getCurrentPeriod(periodType)

      // Determine if we have a feature ID or feature code
      let featureId: string | undefined = undefined
      
      if (featureCodeOrId) {
        // Check if it looks like an ID (UUID or CUID) or a feature code string
        // UUIDs have dashes, CUIDs start with 'c' and are ~25 chars of lowercase alphanumeric
        // Feature codes are uppercase like 'PATENT_DRAFTING'
        const isUUID = featureCodeOrId.includes('-') && featureCodeOrId.length > 20
        const isCUID = /^c[a-z0-9]{20,}$/i.test(featureCodeOrId)
        const isFeatureId = isUUID || isCUID
        
        if (isFeatureId) {
          // It's a feature ID, use it directly
          featureId = featureCodeOrId
        } else {
          // It's a feature code, look up the ID
          const feature = await prisma.feature.findUnique({
            where: { code: featureCodeOrId as any },
            select: { id: true }
          })
          featureId = feature?.id
        }
      }

      // If no featureId found, return 0 (no usage)
      if (!featureId) {
        return 0
      }

      const meter = await prisma.usageMeter.findFirst({
        where: {
          tenantId,
          featureId: featureId,
          periodType,
          periodKey: key
        }
      })

      return meter?.currentUsage || 0
    },

    async checkQuotaAlerts(tenantId: string, featureId?: string, taskCode?: any): Promise<void> {
      try {
        // Get current usage
        const monthlyUsage = await this.getCurrentUsage(tenantId, featureId, 'MONTHLY')

        // Get tenant's current active plan
        const tenantPlan = await prisma.tenantPlan.findFirst({
          where: {
            tenantId,
            status: 'ACTIVE'
          },
          include: {
            plan: true
          },
          orderBy: {
            effectiveFrom: 'desc'
          }
        })

        if (!tenantPlan?.plan) return

        // Look up feature code from feature ID
        const feature = await prisma.feature.findUnique({
          where: { id: featureId },
          select: { code: true }
        })

        if (!feature) return

        const planFeature = await prisma.planFeature.findFirst({
          where: {
            planId: tenantPlan.plan.id,
            feature: { code: feature.code }
          }
        })

        if (!planFeature?.monthlyQuota) return

        const usagePercentage = (monthlyUsage / planFeature.monthlyQuota) * 100

        // Check alert thresholds
        if (usagePercentage >= 80) {
          const alertType = usagePercentage >= 100 ? 'QUOTA_EXCEEDED' : 'QUOTA_WARNING'

          const existingAlert = await prisma.quotaAlert.findFirst({
            where: {
              tenantId,
              featureId,
              taskCode,
              alertType: alertType as any
            }
          })

          if (existingAlert) {
            await prisma.quotaAlert.update({
              where: { id: existingAlert.id },
              data: {
                threshold: Math.floor(usagePercentage),
                notifiedAt: new Date()
              }
            })
          } else {
            await prisma.quotaAlert.create({
              data: {
                tenantId,
                featureId,
                taskCode,
                alertType: alertType as any,
                threshold: Math.floor(usagePercentage)
              }
            })
          }
        }
      } catch (error) {
        console.warn('Quota alert check failed:', error)
      }
    }
  }
}
