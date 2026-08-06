/**
 * Whitespace Studio — shared LLM plumbing.
 *
 * One rule enforced at this level: every whitespace model call goes through the
 * metering gateway with a stage code, falling back to task-only routing when the
 * stage is unconfigured (fresh installs), exactly as compileScope established.
 * Stages never call the gateway directly, so the fallback-and-warn behaviour
 * cannot drift between stages.
 */

import { TaskCode } from '@prisma/client'

/**
 * Who a model call is billed to.
 *
 * Two shapes because there are two kinds of caller. An interactive route has the
 * user's request and passes `headers`, from which the gateway resolves the
 * tenant. A queued run has no request at all — it may be executed minutes later
 * by a worker in another process — so it passes the resolved `tenantContext`
 * directly. Carrying headers was the reason whitespace work could not leave the
 * request that started it.
 */
export type WhitespaceLLMContext =
  | { headers: Record<string, string> }
  | { tenantContext: { tenantId: string; planId: string; userId?: string } }

export interface WhitespaceLLMCall {
  taskCode: TaskCode
  stageCode: string
  prompt: string
  context: WhitespaceLLMContext
}

export interface WhitespaceLLMResult {
  output: string
  modelCode?: string
}

export async function runWhitespaceLLM(call: WhitespaceLLMCall): Promise<WhitespaceLLMResult> {
  const { llmGateway } = await import('@/lib/metering/gateway')

  const stageAttempt = await llmGateway.executeLLMOperation(
    call.context,
    { taskCode: call.taskCode, stageCode: call.stageCode, prompt: call.prompt }
  )
  if (stageAttempt.success && stageAttempt.response?.output) {
    return {
      output: stageAttempt.response.output,
      modelCode: stageAttempt.response.metadata?.model || stageAttempt.response.modelClass,
    }
  }

  // Retry WITHOUT the stage code ONLY when the stage is genuinely unconfigured.
  //
  // This fallback exists so the module works on a fresh install, before
  // scripts/add-whitespace-stages.js has run. It must not catch anything else:
  // task-only routing resolves through PlanLLMAccess to MODEL_CLASS_DEFAULTS,
  // a hardcoded table in model-resolver.ts. So retrying after a REAL failure
  // (a 404 from a retired model, a rate limit, a timeout) silently abandons the
  // model the operator configured and runs a hardcoded one instead — and the
  // logs then blame that second model, hiding the original fault entirely.
  // A configured stage that fails must fail loudly.
  const unconfigured = stageAttempt.error?.code === 'CONFIGURATION_ERROR'
  if (!unconfigured) {
    throw new Error(
      stageAttempt.error?.message ||
        `Stage ${call.stageCode} failed. The model configured for this stage did not complete the request.`
    )
  }

  const taskAttempt = await llmGateway.executeLLMOperation(
    call.context,
    { taskCode: call.taskCode, prompt: call.prompt }
  )
  if (!taskAttempt.success || !taskAttempt.response?.output) {
    // Surface the task-level error: it reflects plan entitlement rather than
    // missing stage configuration, which is the actionable one.
    throw new Error(
      taskAttempt.error?.message || stageAttempt.error?.message || 'The model gateway is unavailable. Try again.'
    )
  }
  console.warn(
    `[Whitespace] Stage ${call.stageCode} is not configured for this plan — used task-only routing. Run scripts/add-whitespace-stages.js to enable per-stage model control.`
  )
  return {
    output: taskAttempt.response.output,
    modelCode: taskAttempt.response.metadata?.model || taskAttempt.response.modelClass,
  }
}

/** Brace-balanced JSON extraction; models wrap output in prose more often than not. */
export function extractBalancedJson(text: string): string | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const char = text[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '"') inString = !inString
    if (inString) continue
    if (char === '{') depth++
    if (char === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

/** Parses the model's JSON or throws a caller-frameable error. */
export function parseModelJson<T>(output: string, what: string): T {
  const jsonText = extractBalancedJson(output)
  if (!jsonText) throw new Error(`${what} returned no JSON.`)
  try {
    return JSON.parse(jsonText) as T
  } catch {
    throw new Error(`${what} returned malformed JSON.`)
  }
}
