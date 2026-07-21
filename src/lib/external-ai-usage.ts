import { prisma } from '@/lib/prisma'

export interface ExternalAiUsageContext {
  tenantId: string
  userId: string
  operationId: string
  sessionId?: string
}

export interface ExternalAiUsageEvent {
  provider: 'voyage'
  operation: 'embedding' | 'rerank'
  model: string
  status: 'COMPLETED' | 'FAILED'
  inputCount: number
  totalTokens?: number
  latencyMs: number
  attempt: number
  error?: string
}

/** Best-effort provider telemetry; recording failures never break retrieval. */
export async function recordExternalAiUsage(
  context: ExternalAiUsageContext | undefined,
  event: ExternalAiUsageEvent
) {
  if (!context) return
  try {
    const feature = await prisma.feature.findUnique({ where: { code: 'NOVELTY_SEARCH' }, select: { id: true } })
    await prisma.usageLog.create({
      data: {
        tenantId: context.tenantId,
        userId: context.userId,
        featureId: feature?.id,
        modelClass: event.model,
        apiCode: event.operation === 'embedding' ? 'VOYAGE_EMBEDDING' : 'VOYAGE_RERANK',
        inputTokens: event.totalTokens,
        outputTokens: 0,
        apiCalls: 1,
        completedAt: new Date(),
        status: event.status,
        error: event.error?.slice(0, 500),
        idempotencyKey: `${context.operationId}:${event.operation}:${event.attempt}:${Date.now()}`,
        meta: {
          provider: event.provider,
          operation: event.operation,
          model: event.model,
          inputCount: event.inputCount,
          totalTokens: event.totalTokens,
          latencyMs: event.latencyMs,
          attempt: event.attempt,
          operationId: context.operationId,
          sessionId: context.sessionId,
        },
      },
    })
  } catch (error) {
    console.error('[ExternalAiUsage] Could not record provider usage:', error)
  }
}
