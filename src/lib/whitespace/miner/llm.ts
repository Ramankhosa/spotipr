/**
 * Invention Miner — the miner's own gateway call.
 *
 * WHY THIS EXISTS INSTEAD OF ../llm's runWhitespaceLLM.
 *
 * runWhitespaceLLM retries WITHOUT the stage code when the gateway answers
 * CONFIGURATION_ERROR, so that a fresh install works before the seed script has
 * run. For the whitespace stages that is a handful of calls per run. For the
 * miner it is catastrophic, and the failure is silent:
 *
 *   1. No PlanStageModelConfig row for MINER_EXTRACT on this plan.
 *   2. Stage resolution throws; the gateway returns CONFIGURATION_ERROR.
 *   3. runWhitespaceLLM retries task-only.
 *   4. A task-only resolution carries no maxTokensIn, and the gateway then
 *      DELETES the token ceiling from the enforcement decision
 *      (gateway.ts: `if (!modelResolution) { delete decision.maxTokensIn ... }`).
 *   5. Every one of a harvest's ~1,500 extraction batches then runs on the
 *      plan's default model with no input ceiling at all — a cost event with no
 *      upper bound, produced by a run that reports success.
 *
 * So the miner never retries. An unconfigured stage is an OPERATOR fault with a
 * one-line fix, and it is raised as a permanent refusal naming the plan, the
 * stage and the script. The harvest additionally resolves every stage it will
 * use BEFORE it spends anything (assertMinerStagesConfigured), so this refusal
 * normally arrives before the first token rather than after a hundred batches.
 *
 * This module deliberately calls the gateway directly rather than wrapping
 * runWhitespaceLLM: the fallback lives INSIDE that function and by the time it
 * returns, the uncapped second call has already been paid for — it cannot be
 * disabled from the outside. Calling the gateway once, here, is also what lets
 * the caller see the provider's own token counts, which is what the run's read
 * budget (R9) is measured in.
 */

import type { TaskCode } from '@prisma/client'
import { WhitespacePermanentError } from '../run-lease'
import type { WhitespaceLLMContext } from '../llm'

/** Stage codes seeded by scripts/add-invention-miner-stages.js. */
export const MINER_EXTRACT_STAGE_CODE = 'MINER_EXTRACT'
export const MINER_LEAD_TITLES_STAGE_CODE = 'MINER_LEAD_TITLES'
export const MINER_INVENTIVE_STEP_STAGE_CODE = 'MINER_INVENTIVE_STEP'
export const MINER_EXCLUSION_SCREEN_STAGE_CODE = 'MINER_EXCLUSION_SCREEN'
export const MINER_BRIEF_STAGE_CODE = 'MINER_BRIEF'

export interface MinerLLMCall {
  taskCode: TaskCode
  stageCode: string
  prompt: string
  context: WhitespaceLLMContext
}

export interface MinerLLMResult {
  output: string
  /** The model the gateway actually ran, recorded on every extraction row. */
  modelCode: string
  /** Provider-reported where available, the gateway's estimate otherwise. */
  inputTokens: number
  outputTokens: number
}

/** One stage the run intends to use, for the preflight. */
export interface MinerStageRequirement {
  stageCode: string
  taskCode: TaskCode
}

/** Resolved stage → model map, recorded on the run result as `resolvedModels`. */
export type MinerStageModels = Record<string, string>

function unconfiguredMessage(planId: string | null, stageCodes: string[]): string {
  const list = stageCodes.join(', ')
  return (
    `The Invention Miner is not configured for your plan (missing stage models: ${list}). ` +
    `Ask an operator to run scripts/add-invention-miner-stages.js${
      planId ? ` and check plan ${planId} in Super Admin > LLM Config` : ''
    }, then start the harvest again.`
  )
}

/**
 * Resolve every stage the run will use BEFORE it spends anything.
 *
 * The alternative — discovering an unconfigured stage on the first model call —
 * costs nothing here but costs the whole staging pass and the run's queue slot
 * there, and (worse) puts the refusal after the point where a partial result
 * exists to be mistaken for a thin one.
 *
 * Returns the resolved model per stage so the stage can record which model
 * produced its output. Throws WhitespacePermanentError naming the missing
 * stages; never falls back.
 */
export async function assertMinerStagesConfigured(
  context: WhitespaceLLMContext,
  requirements: readonly MinerStageRequirement[]
): Promise<MinerStageModels> {
  const { extractTenantContextFromRequest } = await import('@/lib/metering/auth-bridge')
  const tenantContext = await extractTenantContextFromRequest(context)
  if (!tenantContext) {
    throw new WhitespacePermanentError(
      'This run could not be attributed to an organisation, so no plan could be read for it. Sign in again and start the harvest from the study.'
    )
  }
  if (!tenantContext.planId) {
    throw new WhitespacePermanentError(
      'Your organisation has no active plan, so the Invention Miner has no model configuration to run against. Check the subscription and try again.'
    )
  }

  const { resolveModel } = await import('@/lib/metering/model-resolver')
  const models: MinerStageModels = {}
  const missing: string[] = []
  for (const requirement of requirements) {
    try {
      const resolution = await resolveModel(tenantContext.planId, requirement.taskCode, requirement.stageCode)
      models[requirement.stageCode] = resolution.modelCode
    } catch {
      // resolveModel throws for a stage-coded call with no PlanStageModelConfig
      // row. That is the exact fault this preflight exists to name, and it is
      // the ONLY reason a stage-coded resolution throws (model-resolver.ts).
      missing.push(requirement.stageCode)
    }
  }
  if (missing.length) throw new WhitespacePermanentError(unconfiguredMessage(tenantContext.planId, missing))
  return models
}

/**
 * One stage-coded gateway call. No fallback, no retry.
 *
 * A CONFIGURATION_ERROR is permanent (the operator must seed the stage);
 * everything else is thrown as an ordinary Error, which the run's retry budget
 * treats as transient — a provider blip should be retried, an unconfigured plan
 * should not.
 */
/**
 * The most extraction calls this tenant may have in flight at once.
 *
 * The gateway reserves a slot per call and throws CONCURRENCY_LIMIT past the
 * tenant's cap, and that throw is indistinguishable from a provider failure at
 * the batch level — so a harvest that fans out wider than the cap burns its
 * circuit breaker on its own reservations and aborts a healthy run. Ask first,
 * fan out to what is allowed.
 *
 * Null means the gateway could not resolve the tenant; the caller keeps its own
 * conservative default rather than assuming an unlimited budget.
 */
export async function minerConcurrencyLimit(
  context: WhitespaceLLMContext,
  taskCode: TaskCode
): Promise<number | null> {
  const { llmGateway } = await import('@/lib/metering/gateway')
  return llmGateway.getTaskConcurrencyLimit(context, taskCode)
}

export async function runMinerLLM(call: MinerLLMCall): Promise<MinerLLMResult> {
  const { llmGateway } = await import('@/lib/metering/gateway')
  const attempt = await llmGateway.executeLLMOperation(call.context, {
    taskCode: call.taskCode,
    stageCode: call.stageCode,
    prompt: call.prompt,
  })

  if (!attempt.success || !attempt.response?.output) {
    if (attempt.error?.code === 'CONFIGURATION_ERROR') {
      throw new WhitespacePermanentError(unconfiguredMessage(null, [call.stageCode]))
    }
    throw new Error(
      attempt.error?.message ||
        `Stage ${call.stageCode} failed. The model configured for this stage did not complete the request.`
    )
  }

  const response = attempt.response
  const inputTokens = Number(response.metadata?.inputTokens ?? response.metadata?.providerInputTokens ?? 0)
  const outputTokens = Number(response.outputTokens ?? response.metadata?.outputTokens ?? 0)
  return {
    output: response.output,
    modelCode: String(response.metadata?.model || response.modelClass || 'unknown'),
    inputTokens: Number.isFinite(inputTokens) ? Math.max(0, inputTokens) : 0,
    outputTokens: Number.isFinite(outputTokens) ? Math.max(0, outputTokens) : 0,
  }
}
