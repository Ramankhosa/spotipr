// Claim strategy job.
//
// The strategy (src/lib/claim-rules/strategy.ts) is planned by its own LLM call
// so the claims stage does not pay for it. It runs in the background as soon as
// Stage 0 completes (and again when the inputs it depends on change), and is
// stored on the idea record with a fingerprint of those inputs. The claims
// stage uses it when the fingerprint still matches; otherwise it runs the same
// function inline and shows a "Preparing claim strategy" step.
//
// Background execution is the same fire-and-forget pattern as the office-
// action inline drain: gated to the web runtime, one run in flight per
// session, debounced so a burst of Stage-0 saves produces one run.

import { prisma } from '@/lib/prisma'
import { llmGateway } from '@/lib/metering/gateway'
import { parseLlmJsonObject } from '@/lib/llm-json-parser'
import { withFreshAuth } from '@/lib/job-auth'
import { DRAFTING_CLAIMS_TEMPERATURE } from '@/lib/drafting-constants'
import { getCountryProfile, getSectionRules } from '@/lib/country-profile-service'
import { buildNoveltyFindingsBlock, buildNoveltyGuidanceBlock } from '@/lib/novelty-drafting-handoff'
import { buildInventorTerminologyBlock, buildSourceFidelityPromptBlock, resolveSourceFidelityMode } from '@/lib/source-fidelity'
import { renderJurisdictionClaimRulesBlock, resolveClaimRuleProfile, type ClaimRuleProfile } from '@/lib/claim-rules'
import { buildClaimStrategyPrompt, parseClaimStrategy } from '@/lib/claim-rules/strategy'
import {
  CLAIM_STRATEGY_STAGE_CODE,
  computeClaimStrategyFingerprint,
  type ClaimStrategyState,
} from '@/lib/claim-rules/strategy-state'
import { buildClaimContextBlocks, type PreliminaryClaimContext } from '@/lib/preliminary-claim-generation'

export {
  CLAIM_STRATEGY_STAGE_CODE,
  CLAIM_STRATEGY_STALE_MS,
  claimStrategyInFlight,
  computeClaimStrategyFingerprint,
  readClaimStrategyState,
  readyClaimStrategy,
  type ClaimStrategyState,
} from '@/lib/claim-rules/strategy-state'

export const CLAIM_STRATEGY_DEBOUNCE_MS = 3_000

/** Same fallback chain as claim generation: the requested office, else another session office with a profile, else US. */
export async function resolveStrategyJurisdiction(session: any, requested?: string | null): Promise<string> {
  const candidates = [
    requested,
    session?.activeJurisdiction,
    ...(Array.isArray(session?.draftingJurisdictions) ? session.draftingJurisdictions : []),
  ].map(value => String(value || '').toUpperCase()).filter(Boolean)
  for (const candidate of candidates) {
    if (await getCountryProfile(candidate)) return candidate
  }
  return 'US'
}

function firstMeaningful(...values: unknown[]): any {
  for (const value of values) {
    if (value === undefined || value === null) continue
    if (typeof value === 'string' && !value.trim()) continue
    if (Array.isArray(value) && value.length === 0) continue
    return value
  }
  return undefined
}

/** The invention context the claims stage also assembles, from the stored record alone. */
export function buildClaimStrategyContext(session: any, normalized: Record<string, any>): PreliminaryClaimContext {
  const idea = session?.ideaRecord || {}
  return {
    title: firstMeaningful(idea.title, normalized.title),
    rawIdea: firstMeaningful(idea.rawInput, normalized.rawIdea),
    problem: firstMeaningful(normalized.problem, idea.problem),
    objectives: firstMeaningful(normalized.objectives, idea.objectives),
    logic: firstMeaningful(normalized.logic, idea.logic),
    components: firstMeaningful(normalized.components, idea.components),
    bestMethod: firstMeaningful(normalized.bestMethod, idea.bestMethod),
    abstract: firstMeaningful(normalized.abstract, idea.abstract),
    coreInventiveConcept: normalized.coreInventiveConcept,
    claimableFeatures: normalized.claimableFeatures,
    fallbackLimitations: normalized.fallbackLimitations,
    doNotClaim: normalized.doNotClaim,
    sourceFactLedger: normalized.sourceFactLedger,
    scopeRecommendations: normalized.scopeRecommendations,
    supportDataSources: normalized.supportDataSources,
    normalizationReviewWarnings: normalized.normalizationReviewWarnings,
    inventionType: normalized.inventionType,
    patentTypePrimary: session?.patentTypePrimary || normalized.patentTypePrimary,
    fieldOfRelevance: normalized.fieldOfRelevance,
    field: normalized.field,
    subfield: normalized.subfield,
  }
}

async function persistStrategyState(sessionId: string, state: ClaimStrategyState): Promise<void> {
  // Re-read at write time: Stage 0 edits and claim saves write the whole
  // normalizedData object, and a stale spread here would roll them back.
  const record = await prisma.ideaRecord.findUnique({ where: { sessionId }, select: { normalizedData: true } })
  const fresh = (record?.normalizedData as any) || {}
  await prisma.ideaRecord.update({
    where: { sessionId },
    data: { normalizedData: { ...fresh, claimStrategy: state } },
  })
}

export type RunClaimStrategyParams = {
  sessionId: string
  requestHeaders: Record<string, string>
  reason: string
  /** Office to plan for; defaults to the session's active office with the profile fallback. */
  jurisdiction?: string | null
  /** Already-resolved rules and block (the claims stage has them); resolved here otherwise. */
  rules?: ClaimRuleProfile
  rulesBlock?: string
  session?: any
  normalized?: Record<string, any>
  patentId?: string
}

/** Plans the claim set for a session and stores the result. Never throws. */
export async function runClaimStrategy(params: RunClaimStrategyParams): Promise<ClaimStrategyState> {
  const startedAt = new Date().toISOString()
  let session = params.session
  if (!session) {
    session = await prisma.draftingSession.findUnique({ where: { id: params.sessionId }, include: { ideaRecord: true } })
  }
  const normalized: Record<string, any> = params.normalized || (session?.ideaRecord?.normalizedData as any) || {}
  const jurisdiction = params.jurisdiction
    ? String(params.jurisdiction).toUpperCase()
    : await resolveStrategyJurisdiction(session)
  const fingerprint = computeClaimStrategyFingerprint(normalized, session, jurisdiction)

  const failed = async (error: string): Promise<ClaimStrategyState> => {
    const state: ClaimStrategyState = { status: 'failed', inputFingerprint: fingerprint, jurisdiction, reason: params.reason, startedAt, completedAt: new Date().toISOString(), error }
    await persistStrategyState(params.sessionId, state).catch(err => console.warn('[claim_strategy] could not persist failure:', err instanceof Error ? err.message : err))
    return state
  }

  if (!session) return failed('session not found')

  try {
    await persistStrategyState(params.sessionId, { status: 'running', inputFingerprint: fingerprint, jurisdiction, reason: params.reason, startedAt })

    let rules = params.rules
    let rulesBlock = params.rulesBlock
    if (!rules || !rulesBlock) {
      const [profile, rawRules] = await Promise.all([getCountryProfile(jurisdiction), getSectionRules(jurisdiction, 'claims')])
      rules = resolveClaimRuleProfile(jurisdiction, rawRules, profile?.profileData?.meta).rules
      rulesBlock = renderJurisdictionClaimRulesBlock(rules)
    }

    const context = buildClaimStrategyContext(session, normalized)
    const fidelityMode = resolveSourceFidelityMode(normalized)
    const blocks = buildClaimContextBlocks(context)
    const prompt = buildClaimStrategyPrompt({
      rules,
      rulesBlock,
      patentTypePrimary: String(context.patentTypePrimary || 'SYSTEM'),
      inventionType: Array.isArray(context.inventionType) ? context.inventionType.join(' + ') : typeof context.inventionType === 'string' ? context.inventionType : undefined,
      technicalField: typeof context.fieldOfRelevance === 'string' ? context.fieldOfRelevance : typeof context.field === 'string' ? context.field : undefined,
      normalizedContextBlock: blocks.normalizedContextBlock,
      originalSourceExcerptBlock: blocks.originalSourceExcerptBlock,
      supportDataBlock: blocks.supportDataBlock,
      sourceFactLedgerBlock: blocks.sourceFactLedgerBlock,
      claimScopeBlock: blocks.claimScopeBlock,
      noveltyGuidanceBlock: buildNoveltyGuidanceBlock(session?.noveltyHandoff?.claimGuidance),
      noveltyFindingsBlock: buildNoveltyFindingsBlock(session?.noveltyHandoff?.findingsDigest, session?.noveltyHandoff?.claimGuidance?.reviewBeforeDrafting),
      sourceFidelityBlock: buildSourceFidelityPromptBlock(fidelityMode, 'claims'),
      inventorTerminologyBlock: buildInventorTerminologyBlock(fidelityMode, context.components),
    })

    const llmResult = await llmGateway.executeLLMOperation({ headers: params.requestHeaders || {} }, {
      taskCode: 'LLM2_DRAFT',
      stageCode: CLAIM_STRATEGY_STAGE_CODE,
      prompt,
      idempotencyKey: `claim-strategy:${params.sessionId}:${fingerprint}:${Date.now()}`,
      inputTokens: Math.ceil(prompt.length / 4),
      parameters: {
        temperature: DRAFTING_CLAIMS_TEMPERATURE,
        prompt_cache_key: `claim-strategy:${jurisdiction}`,
        response_format: { type: 'json_object' },
      },
      metadata: {
        purpose: 'claim_strategy',
        sessionId: params.sessionId,
        patentId: params.patentId || session?.patentId,
        jurisdiction,
        reason: params.reason,
      },
    } as any)

    if (!llmResult.success || !llmResult.response) {
      return failed(llmResult.error?.message || 'LLM operation failed')
    }
    const parsedJson = parseLlmJsonObject(llmResult.response)
    const strategy = parsedJson.ok ? parseClaimStrategy(parsedJson.data) : null
    if (!strategy) return failed('strategy output unreadable')
    strategy.jurisdiction = jurisdiction

    const state: ClaimStrategyState = {
      status: 'ready',
      inputFingerprint: fingerprint,
      jurisdiction,
      reason: params.reason,
      startedAt,
      completedAt: new Date().toISOString(),
      strategy,
      model: (llmResult.response as any)?.modelCode || (llmResult.response as any)?.model,
    }
    await persistStrategyState(params.sessionId, state)
    return state
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error))
  }
}

// ── Background trigger ──────────────────────────────────────────────────────

function backgroundEnabled(): boolean {
  if (process.env.CLAIM_STRATEGY_BACKGROUND === 'false' || process.env.CLAIM_STRATEGY_BACKGROUND === '0') return false
  if (process.env.CLAIM_STRATEGY_BACKGROUND === 'true') return true
  return Boolean(process.env.NEXT_RUNTIME) // set by Next.js in server bundles; absent in tests and scripts
}

const debounceTimers = new Map<string, NodeJS.Timeout>()
const inFlight = new Map<string, { rerun: boolean; userId: string; reason: string }>()

async function runInBackground(sessionId: string, userId: string, reason: string): Promise<void> {
  inFlight.set(sessionId, { rerun: false, userId, reason })
  try {
    await withFreshAuth(userId, headers => runClaimStrategy({ sessionId, requestHeaders: headers, reason }), 'claim_strategy')
  } catch (error) {
    console.warn('[claim_strategy] background run failed:', error instanceof Error ? error.message : error)
  } finally {
    const pending = inFlight.get(sessionId)
    inFlight.delete(sessionId)
    if (pending?.rerun) void runInBackground(sessionId, pending.userId, pending.reason)
  }
}

/**
 * Schedules a strategy run for the session. Debounced per session; a run that
 * is requested while another is in flight is queued once behind it, so the
 * stored plan always reflects the last inputs. Never throws, never blocks the
 * request that triggered it.
 */
export function enqueueClaimStrategy(params: { sessionId: string; userId: string; reason: string; force?: boolean }): void {
  if (!params.force && !backgroundEnabled()) return
  const { sessionId, userId, reason } = params
  const existing = debounceTimers.get(sessionId)
  if (existing) clearTimeout(existing)
  debounceTimers.set(sessionId, setTimeout(() => {
    debounceTimers.delete(sessionId)
    const running = inFlight.get(sessionId)
    if (running) {
      running.rerun = true
      running.userId = userId
      running.reason = reason
      return
    }
    void runInBackground(sessionId, userId, reason)
  }, CLAIM_STRATEGY_DEBOUNCE_MS))
}
