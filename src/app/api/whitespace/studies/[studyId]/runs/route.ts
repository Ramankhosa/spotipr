import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { enforceServiceAccess } from '@/lib/service-access-middleware'
import { appendTrail, getOwnedStudy, readScope, startWhitespaceRun } from '@/lib/whitespace/service'
import { scopeIsRunnable } from '@/lib/whitespace/scope-schema'
import { isMinerStage, studyKindOf, type WhitespaceRunStage } from '@/lib/whitespace/types'
import { minerRetrievalIdentity } from '@/lib/whitespace/miner/retrieval-identity'
import type { Prisma } from '@prisma/client'
import { whitespaceErrorResponse } from '@/app/api/whitespace/route-errors'
import { MinerError, requireMinerEnabled } from '@/lib/whitespace/miner/contracts'
import { minerApiError } from '@/lib/whitespace/miner/api'

export const runtime = 'nodejs'

const STAGES: WhitespaceRunStage[] = [
  'FIELD_MAP',
  'CLUSTER',
  'SIGNALS',
  'DEEP_DIVE',
  'VALIDATE',
  'DIMENSION_MAP',
  'MINER_PREFLIGHT',
  'MINER_HARVEST',
  'MINER_ENGINES',
  'MINER_PROPOSE',
  'MINER_GATE',
  'MINER_BRIEF',
]

/**
 * Observatory stages read the corpus with SQL and vector math and cost almost
 * nothing to serve, so they are unmetered — looking should feel free. Only the
 * Lab stages, which spend real model budget, consume quota. DIMENSION_MAP runs
 * up to three discovery model calls, so it meters; MINER_HARVEST runs up to
 * 1,500 extraction calls, so it very much does.
 *
 * MINER_ENGINES meters too, and for a reason that is easy to miss: three of its
 * four engines are pure SQL, but the cross-domain transfer engine runs a
 * bounded mini-harvest over up to 300 publications OUTSIDE the field — real
 * extraction calls on text no harvest paid for — plus one lead-naming call.
 */
const METERED_STAGES = new Set<WhitespaceRunStage>([
  'DEEP_DIVE',
  'VALIDATE',
  'DIMENSION_MAP',
  'MINER_HARVEST',
  'MINER_ENGINES',
  'MINER_PROPOSE',
  'MINER_GATE',
  'MINER_BRIEF',
])

/**
 * Which entitlement a metered stage spends.
 *
 * Branched rather than hardcoded to WHITESPACE_ANALYSIS: the miner is its own
 * product with its own plan feature (INVENTION_MINER), and charging a harvest to
 * the whitespace quota would let a tenant with no miner entitlement run the
 * single most expensive stage in the module on a landscape allowance.
 */
function entitlementFor(stage: WhitespaceRunStage) {
  return isMinerStage(stage) ? ('INVENTION_MINER' as const) : ('WHITESPACE_ANALYSIS' as const)
}

function headersToRecord(request: NextRequest) {
  const headers: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    headers[key] = value
  })
  return headers
}

/** Caps mirroring dimension-stage's own registry caps, applied before storage. */
const MAX_SUPPLIED_DIMENSIONS = 8
const MAX_SUPPLIED_VALUES = 8
const MAX_SUPPLIED_SYNONYMS = 10

/**
 * The params a stage may be started with, rebuilt field by field.
 *
 * `body.params` used to be handed to startWhitespaceRun verbatim, which meant
 * arbitrary client JSON was persisted on the run row, became part of the run
 * dedupe key, and — for DIMENSION_MAP — was read back as the viewpoint registry
 * that the census compiles into tsqueries and embeds. Nothing bounded its size
 * or shape. Rebuilding it here means a run carries only what its stage actually
 * reads, at a size the stage is budgeted for.
 */
function sanitiseParams(stage: WhitespaceRunStage, raw: unknown): Record<string, unknown> | undefined {
  const source = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>
  const text = (value: unknown, max: number): string =>
    typeof value === 'string' ? value.trim().slice(0, max) : ''

  if (stage === 'DEEP_DIVE') {
    const clusterId = text(source.clusterId, 64)
    return clusterId ? { clusterId } : undefined
  }
  if (stage === 'VALIDATE') {
    const hypothesisId = text(source.hypothesisId, 64)
    return hypothesisId ? { hypothesisId } : undefined
  }
  if (stage === 'DIMENSION_MAP') {
    const registry = source.registry as { dimensions?: unknown } | undefined
    if (!registry || typeof registry !== 'object' || !Array.isArray(registry.dimensions)) return undefined
    const dimensions = registry.dimensions
      .slice(0, MAX_SUPPLIED_DIMENSIONS)
      .map(entry => {
        const dimension = (entry ?? {}) as Record<string, unknown>
        const values = (Array.isArray(dimension.values) ? dimension.values : [])
          .slice(0, MAX_SUPPLIED_VALUES)
          .map(rawValue => {
            const value = (rawValue ?? {}) as Record<string, unknown>
            return {
              label: text(value.label, 80),
              synonyms: (Array.isArray(value.synonyms) ? value.synonyms : [])
                .map(synonym => text(synonym, 80))
                .filter(Boolean)
                .slice(0, MAX_SUPPLIED_SYNONYMS),
            }
          })
          .filter(value => value.label)
        return { label: text(dimension.label, 80), description: text(dimension.description, 300), values }
      })
      .filter(dimension => dimension.label && dimension.values.length >= 2)
    return dimensions.length ? { registry: { dimensions } } : undefined
  }
  if (stage === 'MINER_HARVEST' || stage === 'MINER_ENGINES') {
    const snapshotId = text(source.snapshotId, 64)
    return snapshotId ? { snapshotId } : undefined
  }
  if (stage === 'MINER_PROPOSE') {
    const leadId = text(source.leadId, 64)
    const snapshotId = text(source.snapshotId, 64)
    return leadId && snapshotId ? { leadId, snapshotId } : undefined
  }
  if (stage === 'MINER_GATE') {
    const leadId = text(source.leadId, 64)
    const snapshotId = text(source.snapshotId, 64)
    const proposalRevisionId = text(source.proposalRevisionId, 64)
    const office = text(source.office, 2).toUpperCase()
    const researchCutoff = text(source.researchCutoff, 10)
    return leadId && snapshotId && proposalRevisionId && ['IN', 'US', 'EP'].includes(office)
      ? { leadId, snapshotId, proposalRevisionId, office, ...(researchCutoff ? { researchCutoff } : {}) }
      : undefined
  }
  if (stage === 'MINER_BRIEF') {
    const leadId = text(source.leadId, 64)
    const snapshotId = text(source.snapshotId, 64)
    const proposalRevisionId = text(source.proposalRevisionId, 64)
    const assessmentRunId = text(source.assessmentRunId, 64)
    const office = text(source.office, 2).toUpperCase()
    return leadId && snapshotId && proposalRevisionId && assessmentRunId && ['IN', 'US', 'EP'].includes(office)
      ? { leadId, snapshotId, proposalRevisionId, assessmentRunId, office }
      : undefined
  }
  return undefined
}

export async function POST(request: NextRequest, { params }: { params: { studyId: string } }) {
  try {
    const auth = await authenticateUser(request)
    if (!auth.user) {
      return NextResponse.json(
        { error: auth.error?.message || 'Unauthorized' },
        { status: auth.error?.status || 401 }
      )
    }

    const study = await getOwnedStudy(params.studyId, auth.user.id, auth.user.tenantId)
    if (!study) return NextResponse.json({ error: 'Study not found' }, { status: 404 })

    const body = await request.json().catch(() => ({}))
    const stage = body?.stage as WhitespaceRunStage
    if (!STAGES.includes(stage)) {
      return NextResponse.json(
        { error: `Unknown stage. Expected one of: ${STAGES.join(', ')}.` },
        { status: 400 }
      )
    }

    // A targeted stage with no usable target used to enqueue anyway and fail
    // minutes later inside the executor. Refuse now, with the executor's words.
    const runParams = sanitiseParams(stage, body?.params)
    if (stage === 'DEEP_DIVE' && !runParams) {
      return NextResponse.json({ error: 'A deep dive needs the area to read (clusterId).' }, { status: 400 })
    }
    if (stage === 'VALIDATE' && !runParams) {
      return NextResponse.json(
        { error: 'Validation needs the hypothesis to attack (hypothesisId).' },
        { status: 400 }
      )
    }
    if (isMinerStage(stage)) requireMinerEnabled()
    if (['MINER_HARVEST', 'MINER_ENGINES', 'MINER_PROPOSE', 'MINER_GATE', 'MINER_BRIEF'].includes(stage) && !runParams) {
      return NextResponse.json({ error: 'This Miner action is missing its approved field, lead, proposal, office, or assessment input.', code: 'MINER_INPUT_REQUIRED' }, { status: 422 })
    }
    // A refresh is deliberately a new paid logical operation. Generate its
    // identity server-side so a client cannot accidentally collide with (or
    // choose) another user's refresh. Normal retries omit this marker and keep
    // returning the already paid result.
    if (body?.refresh === true && isMinerStage(stage) && METERED_STAGES.has(stage) && runParams) {
      runParams.refreshId = crypto.randomUUID()
    }

    // Same rule, for the study kind: a miner stage on a landscape study used to
    // enqueue, wait for a worker, stage a whole field and only then refuse. The
    // executor's own words, now, before the queue.
    if (isMinerStage(stage) && studyKindOf(study.kind) !== 'MINER') {
      return NextResponse.json(
        {
          error:
            'The Invention Miner runs on a miner study. Create a study of the Invention Miner kind for this scope, or run the whitespace stages on this one.',
          code: 'WS_WRONG_STUDY_KIND',
        },
        { status: 400 }
      )
    }

    const scope = readScope(study.scope)
    const runnable = scopeIsRunnable(scope)
    if (!runnable.runnable) {
      return NextResponse.json({ error: runnable.reason, code: 'SCOPE_NOT_RUNNABLE' }, { status: 400 })
    }

    const operationKey = isMinerStage(stage) && METERED_STAGES.has(stage)
      ? `${stage}:${minerRetrievalIdentity(scope)}:${JSON.stringify(runParams ?? {})}`
      : null
    const priorOperation = operationKey && auth.user.tenantId
      ? await prisma.minerOperation.findUnique({ where: { tenantId_operationKey: { tenantId: auth.user.tenantId, operationKey } } })
      : null
    let quotaCheck: { checkedAt: Date; result: { remainingQuota?: { daily: number | null; monthly: number | null }; quotaSource?: string } } | undefined

    // Entitlement is checked for every metered stage, tenant or not. Guarding
    // the check on `auth.user.tenantId` meant an account with no tenant — a
    // solo signup, an invited user before assignment — ran deep dives,
    // validation and dimension maps with no quota check at all, which is the
    // one path in this module that spends real model budget.
    if (METERED_STAGES.has(stage)) {
      if (!auth.user.tenantId) {
        return NextResponse.json(
          {
            error:
              'This stage runs on your organisation’s analysis quota, and your account is not attached to an organisation yet. Ask an admin to add you, or contact support.',
            code: 'NO_TENANT',
          },
          { status: 403 }
        )
      }
      const quotaCheckedAt = new Date()
      const check = await enforceServiceAccess(auth.user.id, auth.user.tenantId, entitlementFor(stage), { paidRetry: !!priorOperation && priorOperation.state !== 'RELEASED' })
      if (!check.allowed) return check.response
      quotaCheck = { checkedAt: quotaCheckedAt, result: check.result }
    }

    // Cheap guard against a client retry loop hammering the corpus. Studio uses
    // the same shape; deep census queries are the expensive thing to protect.
    const recentStarts = await prisma.whitespaceRun.count({
      where: {
        createdAt: { gte: new Date(Date.now() - 60_000) },
        study: { userId: auth.user.id },
      },
    })
    if (recentStarts >= 5) {
      return NextResponse.json(
        { error: 'Too many runs started. Wait a minute before starting another.', code: 'WS_RATE_LIMITED' },
        { status: 429, headers: { 'Retry-After': '60' } }
      )
    }

    const minerOperation = isMinerStage(stage) && METERED_STAGES.has(stage) && auth.user.tenantId && operationKey
      ? { tenantId: auth.user.tenantId, userId: auth.user.id,
          operationKey,
          inputs: (runParams ?? {}) as Prisma.InputJsonValue,
          ...(!priorOperation && quotaCheck ? { quotaReservation: {
            checkedAt: quotaCheck.checkedAt,
            remainingDaily: quotaCheck.result.remainingQuota?.daily ?? null,
            remainingMonthly: quotaCheck.result.remainingQuota?.monthly ?? null,
            userScoped: quotaCheck.result.quotaSource === 'user',
          } } : {}) }
      : undefined
    const { runId, existing } = await startWhitespaceRun({
      studyId: study.id,
      stage,
      scope,
      scopeVersion: study.scopeVersion,
      requestHeaders: headersToRecord(request),
      params: runParams as Prisma.InputJsonValue | undefined,
      operation: minerOperation,
    })

    if (!existing) {
      await appendTrail(study.id, 'RUN', `user:${auth.user.id}`, `${stage} started (scope v${study.scopeVersion})`)
    }

    // INVENTION_MINER's quota is counted by trackServiceUsage, not by LLM
    // completions (metering.ts bypasses those for this feature), so a harvest
    // that never records one can never be blocked — the quota would read as
    // configured in the admin UI and do nothing.
    //
    // The operationId is keyed on the Miner retrieval identity and exact stage
    // inputs, not the run id or display-only scope metadata: recording the same id twice counts once, so re-running the
    // harvest for a field that has already been charged — after a provider
    // outage, or after a Save that changed nothing — is free, while a genuinely
    // different scope is a genuinely different unit of work.
    //
    // MINER_ENGINES and the downstream proposal/office stages use the same rule
    // with their own exact input keys, so re-running
    // the engines over an already-charged field — after a scope Save that
    // changed nothing, or a retry — is free, while a genuinely different scope
    // is a genuinely different unit of work.
    return NextResponse.json(
      existing
        ? { runId, stage, status: 'PROCESSING', error: 'This stage is already running for the study.' }
        : { runId, stage, status: 'PROCESSING' },
      { status: existing ? 409 : 202 }
    )
  } catch (error) {
    if (error instanceof MinerError) return minerApiError(error)
    return whitespaceErrorResponse(error, 'Run start')
  }
}
