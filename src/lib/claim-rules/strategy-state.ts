// Stored state of the claim strategy job and the fingerprint that ties a plan
// to the inputs it was made from. Pure (no Prisma, no gateway) so the claims
// stage, the job and the tests share one definition.

import { createHash } from 'crypto'
import { coerceScopeRecommendations, getEffectiveScopeUse } from '@/lib/scope-recommendations'
import { parseClaimStrategy, type ClaimStrategy, CLAIM_STRATEGY_VERSION } from './strategy'
import { CLAIM_RULES_VERSION } from './types'

export const CLAIM_STRATEGY_STAGE_CODE = 'DRAFT_CLAIM_STRATEGY'
/** A `running` record older than this is treated as dead (process restart) and recomputed. */
export const CLAIM_STRATEGY_STALE_MS = 3 * 60_000

export type ClaimStrategyState = {
  status: 'running' | 'ready' | 'failed'
  inputFingerprint: string
  jurisdiction: string
  reason: string
  startedAt: string
  completedAt?: string
  strategy?: ClaimStrategy
  error?: string
  model?: string
}

function canonicalScope(value: unknown): unknown {
  const scope = coerceScopeRecommendations(value)
  if (!scope || !Array.isArray((scope as any).elements)) return null
  return (scope as any).elements.map((element: any) => ({
    id: element?.id,
    label: element?.label,
    claim: getEffectiveScopeUse(element)?.claim,
  }))
}

function canonicalSupport(value: unknown): unknown {
  if (!Array.isArray(value)) return null
  return value.map((item: any) => ({ id: item?.id, value: item?.value, claimUse: item?.claimUse, status: item?.status }))
}

/**
 * Hash of everything the strategy depends on. Any change re-runs the job; an
 * unchanged fingerprint lets the claims stage reuse the stored plan.
 */
export function computeClaimStrategyFingerprint(
  normalized: Record<string, any> | null | undefined,
  session: any,
  jurisdiction?: string | null
): string {
  const nd = normalized || {}
  const idea = session?.ideaRecord || {}
  const components = Array.isArray(nd.components) ? nd.components : Array.isArray(idea.components) ? idea.components : []
  const canonical = {
    v: `${CLAIM_STRATEGY_VERSION}.${CLAIM_RULES_VERSION}`,
    title: idea.title || nd.title || '',
    rawIdea: String(idea.rawInput || '').slice(0, 20_000),
    problem: nd.problem || idea.problem || '',
    objectives: nd.objectives || idea.objectives || '',
    logic: nd.logic || idea.logic || '',
    bestMethod: nd.bestMethod || '',
    abstract: nd.abstract || '',
    coreInventiveConcept: nd.coreInventiveConcept || '',
    components: components.map((component: any) => ({
      name: component?.name, description: component?.description, inputs: component?.inputs, outputs: component?.outputs,
    })),
    claimableFeatures: nd.claimableFeatures || null,
    fallbackLimitations: nd.fallbackLimitations || null,
    doNotClaim: nd.doNotClaim || null,
    sourceFactLedger: nd.sourceFactLedger || null,
    supportDataSources: canonicalSupport(nd.supportDataSources),
    scope: canonicalScope(nd.scopeRecommendations),
    sourceHandlingMode: nd.sourceHandlingMode || 'STRUCTURE_ONLY',
    patentTypePrimary: session?.patentTypePrimary || nd.patentTypePrimary || '',
    inventionType: nd.inventionType || null,
    jurisdiction: String(jurisdiction || session?.activeJurisdiction || (Array.isArray(session?.draftingJurisdictions) ? session.draftingJurisdictions[0] : '') || 'US').toUpperCase(),
    noveltySearchId: session?.noveltyHandoff?.searchId || null,
  }
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 20)
}

export function readClaimStrategyState(normalized: Record<string, any> | null | undefined): ClaimStrategyState | null {
  const state = normalized?.claimStrategy
  if (!state || typeof state !== 'object' || typeof state.status !== 'string') return null
  return state as ClaimStrategyState
}

/** The stored strategy when it is ready and describes the current inputs. */
export function readyClaimStrategy(normalized: Record<string, any> | null | undefined, fingerprint: string): ClaimStrategy | null {
  const state = readClaimStrategyState(normalized)
  if (!state || state.status !== 'ready' || state.inputFingerprint !== fingerprint) return null
  return parseClaimStrategy(state.strategy)
}

/** True while a run for these inputs is plausibly still going. */
export function claimStrategyInFlight(
  normalized: Record<string, any> | null | undefined,
  fingerprint: string,
  now = Date.now()
): boolean {
  const state = readClaimStrategyState(normalized)
  if (!state || state.status !== 'running' || state.inputFingerprint !== fingerprint) return false
  const started = Date.parse(state.startedAt || '')
  return Number.isFinite(started) && now - started < CLAIM_STRATEGY_STALE_MS
}
