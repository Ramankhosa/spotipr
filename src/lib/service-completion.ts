/**
 * Service completion recorder.
 *
 * `checkServiceQuota` decides whether an operation is allowed by counting rows in
 * `ServiceCompletionUsage`. A service that checks its quota but never records a
 * completion therefore has a counter frozen at zero and can never be blocked - the
 * quota looks configured in the admin UI but does nothing.
 *
 * This is the one place services call to close that loop. It is deliberately
 * failure-tolerant: metering must never take down the operation the user just paid
 * for, so a recording failure is logged and swallowed.
 */

import { trackServiceUsage } from './service-usage-tracker'
import type { ServiceType } from '@prisma/client'

export interface RecordCompletionParams {
  tenantId: string
  userId: string
  serviceType: ServiceType
  /**
   * Stable identifier for the unit of work (patent id, case id, idea id, figure set id).
   * Recording the same operationId twice counts once - `trackServiceUsage` only flips
   * `isCompleted` on the first call - which makes retries and regenerations safe.
   */
  operationId: string
  operationType: string
  inputTokens?: number
  outputTokens?: number
  modelClass?: string
  metadata?: Record<string, unknown>
}

export async function recordServiceCompletion(params: RecordCompletionParams): Promise<void> {
  try {
    await trackServiceUsage({
      tenantId: params.tenantId,
      userId: params.userId,
      serviceType: params.serviceType,
      operationId: params.operationId,
      operationType: params.operationType,
      inputTokens: params.inputTokens ?? 0,
      outputTokens: params.outputTokens ?? 0,
      modelClass: params.modelClass,
      isCompleted: true,
      metadata: params.metadata as Record<string, any> | undefined,
    })
  } catch (error) {
    console.error(
      `[ServiceCompletion] Failed to record ${params.serviceType} completion for ${params.operationId}:`,
      error
    )
  }
}
