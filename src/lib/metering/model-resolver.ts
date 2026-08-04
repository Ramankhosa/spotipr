/**
 * LLM Model Resolver Service
 * 
 * Resolves the appropriate LLM model for a given context based on:
 * 1. Exact plan + stage configuration for stage-coded calls
 * 2. Task-specific configuration for legacy task-only calls
 * 3. Plan defaults (via PlanLLMAccess - backward compatible, task-only calls)
 * 4. System default model (task-only calls)
 * 
 * Super Admin can configure ANY model for ANY stage/task via the admin panel.
 */

import { prisma } from '@/lib/prisma'
import type { TaskCode } from './types'

export interface ModelResolutionResult {
  modelCode: string
  modelId: string
  provider: string
  displayName: string
  maxTokensIn?: number
  maxTokensOut?: number
  temperature?: number
  supportsVision: boolean
  supportsStreaming: boolean
  contextWindow: number
  fallbacks: Array<{ modelCode: string; modelId: string; provider: string }>
  source: 'stage' | 'task' | 'plan-default' | 'system-default'
  costPer1M: { input: number; output: number }
}

export interface ModelInfo {
  code: string
  displayName: string
  provider: string
  contextWindow: number
  supportsVision: boolean
  supportsStreaming: boolean
  inputCostPer1M: number
  outputCostPer1M: number
  isActive: boolean
  isDefault: boolean
}

// Cache for model resolutions (cleared on config updates)
const resolutionCache = new Map<string, { result: ModelResolutionResult; timestamp: number }>()
const CACHE_TTL = 60000 // 1 minute

// Maximum fallback depth to prevent infinite loops
const MAX_FALLBACK_DEPTH = 3

// Model class to default model mapping (for backward compatibility)
const MODEL_CLASS_DEFAULTS: Record<string, string> = {
  'BASE_S': 'gemini-2.0-flash-lite',
  'BASE_M': 'gemini-2.0-flash',
  'PRO_M': 'gpt-4o-mini',
  'PRO_L': 'gpt-4o',
  'ADVANCED': 'claude-3.5-sonnet'
}

/**
 * Resolve the best model for a given context
 * Priority:
 * - Stage-coded calls: exact Stage Config only
 * - Task-only calls: Task Config > Plan Default (PlanLLMAccess) > System Default
 *
 * A stage-coded call is intentionally fail-closed. Falling through to a task,
 * equivalent plan, or system default would allow a model that is not shown for
 * that plan/stage in Super Admin to execute the operation.
 */
export async function resolveModel(
  planId: string,
  taskCode: TaskCode,
  stageCode?: string
): Promise<ModelResolutionResult> {
  const cacheKey = `${planId}:${taskCode}:${stageCode || 'none'}`
  
  // Stage configs are deliberately not cached. Novelty and drafting workers
  // are separate long-running processes, so an in-memory cache cannot be
  // invalidated by the admin web process and may continue using an old model.
  if (!stageCode) {
    const cached = resolutionCache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      console.log(`[ModelResolver] Cache hit for ${cacheKey}: ${cached.result.modelCode} (source: ${cached.result.source})`)
      return cached.result
    }
  }

  console.log(`[ModelResolver] Resolving model for planId=${planId}, taskCode=${taskCode}, stageCode=${stageCode || 'none'}`)

  let result: ModelResolutionResult | null = null

  // Stage-coded calls must use the exact plan/stage row shown in Super Admin.
  if (stageCode) {
    result = await getStageConfig(planId, stageCode)
    if (result) {
      console.log(`[ModelResolver] Found stage config: ${result.modelCode}`)
    } else {
      console.log(`[ModelResolver] No stage config found for planId=${planId}, stageCode=${stageCode}`)
      throw new Error(
        `No active LLM stage model config found for planId=${planId}, stageCode=${stageCode}. Configure this exact plan and stage in Super Admin LLM Config.`
      )
    }

    return result
  }

  // Legacy task-only resolution path.
  if (!result) {
    result = await getTaskConfig(planId, taskCode)
    if (result) {
      console.log(`[ModelResolver] Found task config: ${result.modelCode}`)
    } else {
      console.log(`[ModelResolver] No task config found for planId=${planId}, taskCode=${taskCode}`)
      result = await getEquivalentPlanTaskConfig(planId, taskCode)
      if (result) {
        console.log(`[ModelResolver] Found equivalent-plan task config: ${result.modelCode}`)
      }
    }
  }

  // 3. Try plan's default model for legacy task-only calls.
  if (!result) {
    result = await getPlanDefault(planId, taskCode)
    if (result) {
      console.log(`[ModelResolver] Found plan default (PlanLLMAccess): ${result.modelCode}`)
    } else {
      console.log(`[ModelResolver] No PlanLLMAccess found for planId=${planId}, taskCode=${taskCode}`)
    }
  }

  // 4. Fall back to system default
  if (!result) {
    result = await getSystemDefault()
    console.log(`[ModelResolver] Using system default: ${result.modelCode}`)
  }

  // Cache the result
  resolutionCache.set(cacheKey, { result, timestamp: Date.now() })

  return result
}

async function getStageConfig(planId: string, stageCode: string): Promise<ModelResolutionResult | null> {
  const config = await prisma.planStageModelConfig.findFirst({
    where: {
      planId,
      stage: { code: stageCode },
      isActive: true
    },
    include: {
      model: true,
      stage: true
    },
    orderBy: { priority: 'desc' }
  })

  if (!config || !config.model.isActive) return null

  // Get fallback models
  const fallbacks = await getFallbackModels(config.fallbackModelIds)

  return {
    modelCode: config.model.code,
    modelId: config.model.id,
    provider: config.model.provider,
    displayName: config.model.displayName,
    maxTokensIn: config.maxTokensIn ?? undefined,
    maxTokensOut: config.maxTokensOut ?? undefined,
    temperature: config.temperature ?? undefined,
    supportsVision: config.model.supportsVision,
    supportsStreaming: config.model.supportsStreaming,
    contextWindow: config.model.contextWindow,
    fallbacks,
    source: 'stage',
    costPer1M: {
      input: config.model.inputCostPer1M,
      output: config.model.outputCostPer1M
    }
  }
}

async function getEquivalentPlanIds(planId: string): Promise<string[]> {
  const plan = await prisma.plan.findUnique({
    where: { id: planId },
    select: { code: true }
  })
  if (!plan) return []

  const equivalentCodes: Record<string, string[]> = {
    BASIC_PLAN: ['FREE_PLAN'],
    FREE_PLAN: ['BASIC_PLAN']
  }
  const codes = equivalentCodes[plan.code] || []
  if (codes.length === 0) return []

  const plans = await prisma.plan.findMany({
    where: {
      code: { in: codes },
      status: 'ACTIVE'
    },
    select: { id: true, code: true },
    orderBy: { code: 'asc' }
  })

  return plans.map(p => p.id)
}

async function getEquivalentPlanTaskConfig(planId: string, taskCode: TaskCode): Promise<ModelResolutionResult | null> {
  const equivalentPlanIds = await getEquivalentPlanIds(planId)
  for (const equivalentPlanId of equivalentPlanIds) {
    const result = await getTaskConfig(equivalentPlanId, taskCode)
    if (result) return result
  }
  return null
}

async function getTaskConfig(planId: string, taskCode: TaskCode): Promise<ModelResolutionResult | null> {
  const config = await prisma.planTaskModelConfig.findFirst({
    where: {
      planId,
      taskCode,
      isActive: true
    },
    include: {
      model: true
    }
  })

  if (!config || !config.model.isActive) return null

  const fallbacks = await getFallbackModels(config.fallbackModelIds)

  return {
    modelCode: config.model.code,
    modelId: config.model.id,
    provider: config.model.provider,
    displayName: config.model.displayName,
    maxTokensIn: config.maxTokensIn ?? undefined,
    maxTokensOut: config.maxTokensOut ?? undefined,
    temperature: config.temperature ?? undefined,
    supportsVision: config.model.supportsVision,
    supportsStreaming: config.model.supportsStreaming,
    contextWindow: config.model.contextWindow,
    fallbacks,
    source: 'task',
    costPer1M: {
      input: config.model.inputCostPer1M,
      output: config.model.outputCostPer1M
    }
  }
}

async function getPlanDefault(planId: string, taskCode: TaskCode): Promise<ModelResolutionResult | null> {
  // Use existing PlanLLMAccess for backward compatibility
  const access = await prisma.planLLMAccess.findFirst({
    where: { planId, taskCode },
    include: { defaultClass: true }
  })

  if (!access) return null

  // Map ModelClass to a default model code. LLMModel carries no tier column, so
  // this mapping cannot be data-driven; the constants go stale as the registry
  // moves on, and a stale entry names a model nobody assigned.
  const modelCode = MODEL_CLASS_DEFAULTS[access.defaultClass.code]

  // Get the model from registry
  const model = modelCode
    ? await prisma.lLMModel.findFirst({ where: { code: modelCode, isActive: true } })
    : null

  if (!model) {
    // Degrade to the CONFIGURED system default, never to an arbitrary row.
    //
    // This previously did findFirst({ isActive: true }) with no ordering, so
    // Postgres returned whichever active model it felt like — which is how a
    // model that is not assigned anywhere and is not marked default ends up
    // being called, with nothing in the admin UI able to influence it. An
    // unresolvable tier is a configuration gap, and the honest answer to a
    // configuration gap is the model the operator actually chose.
    console.warn(
      `[ModelResolver] ModelClass "${access.defaultClass.code}" maps to ${
        modelCode ? `"${modelCode}", which is not an active model` : 'nothing'
      } — using the system default instead. Update MODEL_CLASS_DEFAULTS in model-resolver.ts.`
    )
    const fallback = await getSystemDefault()
    return { ...fallback, source: 'plan-default' }
  }

  return {
    modelCode: model.code,
    modelId: model.id,
    provider: model.provider,
    displayName: model.displayName,
    supportsVision: model.supportsVision,
    supportsStreaming: model.supportsStreaming,
    contextWindow: model.contextWindow,
    fallbacks: [],
    source: 'plan-default',
    costPer1M: {
      input: model.inputCostPer1M,
      output: model.outputCostPer1M
    }
  }
}

async function getSystemDefault(): Promise<ModelResolutionResult> {
  // Get the system default model (marked as isDefault)
  const defaultModel = await prisma.lLMModel.findFirst({
    where: { isDefault: true, isActive: true }
  })

  if (defaultModel) {
    return {
      modelCode: defaultModel.code,
      modelId: defaultModel.id,
      provider: defaultModel.provider,
      displayName: defaultModel.displayName,
      supportsVision: defaultModel.supportsVision,
      supportsStreaming: defaultModel.supportsStreaming,
      contextWindow: defaultModel.contextWindow,
      fallbacks: [],
      source: 'system-default',
      costPer1M: {
        input: defaultModel.inputCostPer1M,
        output: defaultModel.outputCostPer1M
      }
    }
  }

  // Ultimate fallback - return first active model or hardcoded default.
  //
  // Nobody chose this model: it is simply the oldest row in the registry, which
  // in practice is whatever was seeded first and is often long retired. Reaching
  // here means no model carries isDefault + isActive, and every unconfigured
  // call in the platform is running on that accident. Say so loudly — silence
  // here is what makes "why is it calling a model I never assigned?" so hard to
  // answer from the logs.
  const anyModel = await prisma.lLMModel.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' }
  })
  console.warn(
    `[ModelResolver] NO MODEL IS FLAGGED isDefault+isActive. Falling back to the oldest active model ` +
      `("${anyModel?.code ?? 'gemini-2.0-flash'}"), which nobody selected. Set a system default in ` +
      `Super Admin > LLM Config > Overview.`
  )

  return {
    modelCode: anyModel?.code || 'gemini-2.0-flash',
    modelId: anyModel?.id || '',
    provider: anyModel?.provider || 'google',
    displayName: anyModel?.displayName || 'Gemini 2.0 Flash',
    supportsVision: anyModel?.supportsVision ?? true,
    supportsStreaming: anyModel?.supportsStreaming ?? true,
    contextWindow: anyModel?.contextWindow ?? 1000000,
    fallbacks: [],
    source: 'system-default',
    costPer1M: {
      input: anyModel?.inputCostPer1M ?? 10,
      output: anyModel?.outputCostPer1M ?? 40
    }
  }
}

async function getFallbackModels(fallbackModelIds: string | null): Promise<Array<{ modelCode: string; modelId: string; provider: string }>> {
  if (!fallbackModelIds) return []

  try {
    const ids = JSON.parse(fallbackModelIds) as string[]
    if (!Array.isArray(ids) || ids.length === 0) return []

    // Limit fallback depth to prevent excessive chaining
    const limitedIds = ids.slice(0, MAX_FALLBACK_DEPTH)
    if (ids.length > MAX_FALLBACK_DEPTH) {
      console.warn(`Fallback list truncated from ${ids.length} to ${MAX_FALLBACK_DEPTH} models`)
    }

    const models = await prisma.lLMModel.findMany({
      where: {
        id: { in: limitedIds },
        isActive: true
      },
      select: {
        id: true,
        code: true,
        provider: true
      }
    })

    // Maintain order from the fallback list, filter out inactive
    const result = limitedIds
      .map(id => models.find(m => m.id === id))
      .filter(Boolean)
      .map(m => ({
        modelCode: m!.code,
        modelId: m!.id,
        provider: m!.provider
      }))

    // Log if some fallbacks were inactive/missing
    if (result.length < limitedIds.length) {
      console.warn(`${limitedIds.length - result.length} fallback model(s) were inactive or missing`)
    }

    return result
  } catch (e) {
    console.error('Failed to parse fallback models:', e)
    return []
  }
}

/**
 * Clear the resolution cache (call after admin updates configs)
 */
export function clearModelCache(): void {
  resolutionCache.clear()
}

/**
 * Clear cache for a specific plan
 */
export function clearPlanCache(planId: string): void {
  for (const key of Array.from(resolutionCache.keys())) {
    if (key.startsWith(`${planId}:`)) {
      resolutionCache.delete(key)
    }
  }
}

/**
 * Get all available models (for admin UI)
 */
export async function getAllModels(): Promise<ModelInfo[]> {
  const models = await prisma.lLMModel.findMany({
    orderBy: [
      { provider: 'asc' },
      { displayName: 'asc' }
    ]
  })

  return models.map(m => ({
    code: m.code,
    displayName: m.displayName,
    provider: m.provider,
    contextWindow: m.contextWindow,
    supportsVision: m.supportsVision,
    supportsStreaming: m.supportsStreaming,
    inputCostPer1M: m.inputCostPer1M,
    outputCostPer1M: m.outputCostPer1M,
    isActive: m.isActive,
    isDefault: m.isDefault
  }))
}

/**
 * Get all workflow stages (for admin UI)
 */
export async function getAllStages(): Promise<Array<{
  code: string
  displayName: string
  featureCode: string
  description: string | null
  sortOrder: number
  isActive: boolean
}>> {
  const stages = await prisma.workflowStage.findMany({
    orderBy: [
      { featureCode: 'asc' },
      { sortOrder: 'asc' }
    ]
  })

  return stages.map(s => ({
    code: s.code,
    displayName: s.displayName,
    featureCode: s.featureCode,
    description: s.description,
    sortOrder: s.sortOrder,
    isActive: s.isActive
  }))
}

/**
 * Get model configuration for a plan (for admin UI)
 */
export async function getPlanModelConfig(planId: string): Promise<{
  stageConfigs: Array<{
    stageCode: string
    stageName: string
    modelCode: string
    modelName: string
    fallbacks: string[]
    maxTokensIn?: number
    maxTokensOut?: number
    temperature?: number
  }>
  taskConfigs: Array<{
    taskCode: string
    modelCode: string
    modelName: string
    fallbacks: string[]
    maxTokensIn?: number
    maxTokensOut?: number
    temperature?: number
  }>
}> {
  const [stageConfigs, taskConfigs] = await Promise.all([
    prisma.planStageModelConfig.findMany({
      where: { planId, isActive: true },
      include: {
        stage: true,
        model: true
      }
    }),
    prisma.planTaskModelConfig.findMany({
      where: { planId, isActive: true },
      include: {
        model: true
      }
    })
  ])

  return {
    stageConfigs: stageConfigs.map(c => ({
      stageCode: c.stage.code,
      stageName: c.stage.displayName,
      modelCode: c.model.code,
      modelName: c.model.displayName,
      fallbacks: c.fallbackModelIds ? JSON.parse(c.fallbackModelIds) : [],
      maxTokensIn: c.maxTokensIn ?? undefined,
      maxTokensOut: c.maxTokensOut ?? undefined,
      temperature: c.temperature ?? undefined
    })),
    taskConfigs: taskConfigs.map(c => ({
      taskCode: c.taskCode,
      modelCode: c.model.code,
      modelName: c.model.displayName,
      fallbacks: c.fallbackModelIds ? JSON.parse(c.fallbackModelIds) : [],
      maxTokensIn: c.maxTokensIn ?? undefined,
      maxTokensOut: c.maxTokensOut ?? undefined,
      temperature: c.temperature ?? undefined
    }))
  }
}

