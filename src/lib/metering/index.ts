// Main entry point for the metering system
// Export all types, errors, and service interfaces

export * from './types'
export * from './errors'

// Core service exports (implemented)
export { createIdentityService } from './identity'
export { createCatalogService } from './catalog'
export { createPolicyService } from './policy'
export { createReservationService } from './reservation'
export { createMeteringService } from './metering'

// High-level orchestration functions
export { enforceMetering, withMetering } from './enforcement'
export { MeteringError, MeteringErrorUtils } from './errors'
export { createMeteringMiddleware } from './middleware'
export { extractTenantContextFromRequest, createFeatureRequest, recordApiUsage } from './auth-bridge'

// LLM Gateway and Provider exports
export { llmGateway, executePriorArtSearch, executePatentDrafting, executeDiagramGeneration } from './gateway'
export { llmProviderRouter } from './providers/provider-router'
export { createLLMProvider } from './providers/llm-provider'

// Configuration and utilities
export { defaultConfig, createMeteringConfig } from './config'
export * from './utils'

// === FACTORY FUNCTIONS ===

import type { MeteringConfig } from './types'
import { createIdentityService } from './identity'
import { createCatalogService } from './catalog'
import { createPolicyService } from './policy'
import { createReservationService } from './reservation'
import { createMeteringService } from './metering'
import { defaultConfig } from './config'

/**
 * Create a complete metering system with all services
 */
export function createMeteringSystem(config: Partial<MeteringConfig> = {}) {
  const finalConfig = { ...defaultConfig, ...config }

  return {
    config: finalConfig,
    identity: createIdentityService(finalConfig),
    catalog: createCatalogService(finalConfig),
    policy: createPolicyService(finalConfig),
    reservation: createReservationService(finalConfig),
    metering: createMeteringService(finalConfig),
  }
}

/**
 * Quick setup for development/testing
 */
export function createDevMeteringSystem() {
  return createMeteringSystem({
    enabled: true,
    allowBypassForAdmins: true,
    reservationTimeoutMs: 30000, // 30 seconds
    maxConcurrentReservations: 10,
  })
}

// === LEGACY COMPATIBILITY ===
// All services are now implemented - no placeholders needed
