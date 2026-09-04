import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TaskCode } from '@prisma/client'
import { WhitespacePermanentError } from '../../run-lease'
import { assertMinerStagesConfigured, MINER_EXTRACT_STAGE_CODE, runMinerLLM } from '../llm'

const executeLLMOperation = vi.fn()
const resolveModel = vi.fn()
const extractTenantContextFromRequest = vi.fn()

vi.mock('@/lib/metering/gateway', () => ({ llmGateway: { executeLLMOperation: (...args: unknown[]) => executeLLMOperation(...args) } }))
vi.mock('@/lib/metering/model-resolver', () => ({ resolveModel: (...args: unknown[]) => resolveModel(...args) }))
vi.mock('@/lib/metering/auth-bridge', () => ({
  extractTenantContextFromRequest: (...args: unknown[]) => extractTenantContextFromRequest(...args),
}))

const context = { tenantContext: { tenantId: 't1', planId: 'plan-pro', userId: 'u1' } }

beforeEach(() => {
  executeLLMOperation.mockReset()
  resolveModel.mockReset()
  extractTenantContextFromRequest.mockReset()
  extractTenantContextFromRequest.mockResolvedValue(context.tenantContext)
})

describe('assertMinerStagesConfigured', () => {
  it('returns the resolved model for every stage the run will use', async () => {
    resolveModel.mockResolvedValue({ modelCode: 'gemini-2.5-flash' })
    await expect(
      assertMinerStagesConfigured(context, [{ stageCode: MINER_EXTRACT_STAGE_CODE, taskCode: TaskCode.IM_EXTRACT }])
    ).resolves.toEqual({ MINER_EXTRACT: 'gemini-2.5-flash' })
  })

  it('refuses PERMANENTLY, naming the missing stages and the fix, before anything is spent', async () => {
    resolveModel.mockRejectedValue(new Error('No active LLM stage model config found'))
    const error = await assertMinerStagesConfigured(context, [
      { stageCode: MINER_EXTRACT_STAGE_CODE, taskCode: TaskCode.IM_EXTRACT },
    ]).catch(e => e)
    expect(error).toBeInstanceOf(WhitespacePermanentError)
    expect(error.message).toContain('missing stage models: MINER_EXTRACT')
    expect(error.message).toContain('scripts/add-invention-miner-stages.js')
    expect(error.message).toContain('plan-pro')
  })

  it('refuses when the tenant has no plan at all rather than resolving a default model', async () => {
    extractTenantContextFromRequest.mockResolvedValue({ tenantId: 't1', planId: '' })
    await expect(
      assertMinerStagesConfigured(context, [{ stageCode: MINER_EXTRACT_STAGE_CODE, taskCode: TaskCode.IM_EXTRACT }])
    ).rejects.toBeInstanceOf(WhitespacePermanentError)
    expect(resolveModel).not.toHaveBeenCalled()
  })
})

describe('runMinerLLM', () => {
  const call = {
    taskCode: TaskCode.IM_EXTRACT,
    stageCode: MINER_EXTRACT_STAGE_CODE,
    prompt: 'read this',
    context,
  }

  it('returns the output, the model that produced it, and the provider token counts', async () => {
    executeLLMOperation.mockResolvedValue({
      success: true,
      response: {
        output: '{"documents":[]}',
        outputTokens: 120,
        modelClass: 'cheap',
        metadata: { model: 'gemini-2.5-flash', inputTokens: 9_800 },
      },
    })
    await expect(runMinerLLM(call)).resolves.toEqual({
      output: '{"documents":[]}',
      modelCode: 'gemini-2.5-flash',
      inputTokens: 9_800,
      outputTokens: 120,
    })
    expect(executeLLMOperation).toHaveBeenCalledTimes(1)
  })

  it('NEVER retries task-only on CONFIGURATION_ERROR — that is what deletes the token ceiling', async () => {
    executeLLMOperation.mockResolvedValue({
      success: false,
      error: { code: 'CONFIGURATION_ERROR', message: 'no stage config' },
    })
    const error = await runMinerLLM(call).catch(e => e)
    expect(error).toBeInstanceOf(WhitespacePermanentError)
    expect(error.message).toContain('MINER_EXTRACT')
    expect(error.message).toContain('scripts/add-invention-miner-stages.js')
    // One call. A second, stage-less one would run 1,500 batches on the plan's
    // default model with no maxTokensIn at all.
    expect(executeLLMOperation).toHaveBeenCalledTimes(1)
  })

  it('treats a provider failure as TRANSIENT, so the run’s retry budget applies', async () => {
    executeLLMOperation.mockResolvedValue({
      success: false,
      error: { code: 'PROVIDER_ERROR', message: 'upstream 503' },
    })
    const error = await runMinerLLM(call).catch(e => e)
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(WhitespacePermanentError)
    expect(error.message).toContain('upstream 503')
  })

  it('treats an empty output as a failure rather than an empty extraction', async () => {
    executeLLMOperation.mockResolvedValue({ success: true, response: { output: '', outputTokens: 0, modelClass: 'cheap' } })
    await expect(runMinerLLM(call)).rejects.toThrow(/did not complete the request/)
  })
})
