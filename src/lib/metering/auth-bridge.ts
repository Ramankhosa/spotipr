// Bridge between existing JWT auth and metering system
// Safely extracts tenant context without breaking existing auth

import type { TenantContext } from './types'
import { createIdentityService } from './identity'
import { verifyJWT, JWTPayload } from '@/lib/auth'

/**
 * Extract tenant context from existing JWT token
 * This bridges the gap between current auth and metering
 */
export async function extractTenantContextFromRequest(
  request: { headers: Record<string, string> }
): Promise<TenantContext | null> {
  try {
    // Extract JWT from Authorization header
    const authHeader = request.headers['authorization']
    if (!authHeader?.startsWith('Bearer ')) {
      return null
    }

    const token = authHeader.substring(7)
    const payload = verifyJWT(token) as JWTPayload

    if (!payload) {
      return null
    }

    // If JWT already has tenant_id, try to resolve the plan
    if (payload.tenant_id && payload.ati_id) {
      const { createIdentityService, defaultConfig } = await import('./index')
      const identityService = createIdentityService(defaultConfig)

      // Try to resolve tenant context from ATI token
      const tenantContext = await identityService.resolveTenantContext(payload.ati_id)

      if (tenantContext) {
        return {
          ...tenantContext,
          userId: payload.sub // Add user ID from JWT
        }
      }
    }

    return null
  } catch (error) {
    // Log error but don't break - metering should fail gracefully
    console.error('Failed to extract tenant context:', error)
    return null
  }
}

/**
 * Create a feature request from tenant context
 * Used for quick metering integration
 */
export function createFeatureRequest(
  tenantContext: TenantContext,
  featureCode: string,
  taskCode?: string
) {
  return {
    tenantId: tenantContext.tenantId,
    featureCode: featureCode as any,
    taskCode: taskCode as any,
    userId: tenantContext.userId
  }
}

/**
 * Usage recording helper for API operations
 * Records API calls as usage
 */
export async function recordApiUsage(
  reservationId: string,
  featureCode: string,
  operation: string = 'api_call'
) {
  const { createMeteringService, defaultConfig } = await import('./index')
  const meteringService = createMeteringService(defaultConfig)

  try {
    await meteringService.recordUsage(reservationId, {
      apiCalls: 1,
      apiCode: `${featureCode}_${operation}`.toUpperCase()
    }, undefined)
  } catch (error) {
    console.error('Failed to record API usage:', error)
    // Don't throw - usage recording failures shouldn't break operations
  }
}
