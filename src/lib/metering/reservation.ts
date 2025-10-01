// Reservation service
// Manages usage reservations before execution

import type { MeteringConfig, ReservationService, MeteringContext } from './types'
import { MeteringErrorUtils, MeteringError } from './errors'
import { prisma } from '@/lib/prisma'

export function createReservationService(config: MeteringConfig): ReservationService {
  return {
    async createReservation(context: MeteringContext, units: number): Promise<string> {
      try {
        if (!config.enabled) {
          // Return a dummy reservation ID if metering is disabled
          return `disabled-${Date.now()}`
        }

        // Check for existing reservation with same idempotency key
        if (context.idempotencyKey) {
          const existing = await prisma.usageReservation.findUnique({
            where: { idempotencyKey: context.idempotencyKey }
          })

          if (existing) {
            if (existing.status === 'ACTIVE' && existing.expiresAt > new Date()) {
              return existing.id
            }
            // If expired or failed, clean it up and create new
            await this.releaseReservation(existing.id)
          }
        }

        // Check concurrency limits
        if (context.taskCode) {
          const activeCount = await this.getActiveReservations(context.tenantId, context.taskCode)
          const concurrencyLimit = await this.getConcurrencyLimit(context.tenantId, context.taskCode)

          if (activeCount >= concurrencyLimit) {
            throw new MeteringError('CONCURRENCY_LIMIT',
              `Too many concurrent ${context.taskCode} operations. Limit: ${concurrencyLimit}`)
          }
        }

        // Create reservation
        const reservation = await prisma.usageReservation.create({
          data: {
            tenantId: context.tenantId,
            featureId: context.featureCode,
            taskCode: context.taskCode,
            reservedUnits: units,
            status: 'ACTIVE',
            expiresAt: new Date(Date.now() + (config.reservationTimeoutMs || 300000)), // 5 minutes default
            idempotencyKey: context.idempotencyKey || `auto-${Date.now()}-${Math.random()}`
          }
        })

        return reservation.id

      } catch (error) {
        if (error instanceof MeteringError) {
          throw error
        }
        throw MeteringErrorUtils.wrap(error, 'DATABASE_ERROR')
      }
    },

    async releaseReservation(reservationId: string): Promise<void> {
      try {
        await prisma.usageReservation.update({
          where: { id: reservationId },
          data: { status: 'RELEASED' }
        })
      } catch (error) {
        throw MeteringErrorUtils.wrap(error, 'DATABASE_ERROR')
      }
    },

    async getActiveReservations(tenantId: string, taskCode?: string): Promise<number> {
      try {
        const count = await prisma.usageReservation.count({
          where: {
            tenantId,
            status: 'ACTIVE',
            expiresAt: { gt: new Date() },
            ...(taskCode && { taskCode: taskCode as any })
          }
        })
        return count
      } catch (error) {
        throw MeteringErrorUtils.wrap(error, 'DATABASE_ERROR')
      }
    },

    async getConcurrencyLimit(tenantId: string, taskCode?: string): Promise<number> {
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
          return 1 // Default low limit
        }

        // Get concurrency limit from policy rules
        const concurrencyRule = await prisma.policyRule.findFirst({
          where: {
            OR: [
              { scope: 'plan', scopeId: atiToken.planTier },
              { scope: 'tenant', scopeId: tenantId }
            ],
            key: 'concurrency_limit',
            ...(taskCode && { taskCode: taskCode as any })
          },
          orderBy: { scope: 'desc' } // tenant overrides plan
        })

        return concurrencyRule?.value || 2 // Default concurrency limit
      } catch (error) {
        console.warn('Failed to get concurrency limit, using default:', error)
        return 2
      }
    }
  }
}
