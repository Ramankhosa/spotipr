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

export interface WhitespaceLLMCall {
  taskCode: TaskCode
  stageCode: string
  prompt: string
  requestHeaders: Record<string, string>
}

export interface WhitespaceLLMResult {
  output: string
  modelCode?: string
}

export async function runWhitespaceLLM(call: WhitespaceLLMCall): Promise<WhitespaceLLMResult> {
  const { llmGateway } = await import('@/lib/metering/gateway')

  const stageAttempt = await llmGateway.executeLLMOperation(
    { headers: call.requestHeaders },
    { taskCode: call.taskCode, stageCode: call.stageCode, prompt: call.prompt }
  )
  if (stageAttempt.success && stageAttempt.response?.output) {
    return {
      output: stageAttempt.response.output,
      modelCode: stageAttempt.response.metadata?.model || stageAttempt.response.modelClass,
    }
  }

  // Stage-coded resolution is fail-closed; task-only routing keeps the module
  // working before scripts/add-whitespace-stages.js has been run.
  const taskAttempt = await llmGateway.executeLLMOperation(
    { headers: call.requestHeaders },
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
