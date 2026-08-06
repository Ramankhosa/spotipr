import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { enforceServiceAccess } from '@/lib/service-access-middleware'
import { appendTrail, getOwnedStudy, readScope, startWhitespaceRun } from '@/lib/whitespace/service'
import { scopeIsRunnable } from '@/lib/whitespace/scope-schema'
import type { WhitespaceRunStage } from '@/lib/whitespace/types'
import type { Prisma } from '@prisma/client'

export const runtime = 'nodejs'

const STAGES: WhitespaceRunStage[] = ['FIELD_MAP', 'CLUSTER', 'SIGNALS', 'DEEP_DIVE', 'VALIDATE', 'DIMENSION_MAP']

/**
 * Observatory stages read the corpus with SQL and vector math and cost almost
 * nothing to serve, so they are unmetered — looking should feel free. Only the
 * Lab stages, which spend real model budget, consume quota. DIMENSION_MAP runs
 * up to three discovery model calls, so it meters.
 */
const METERED_STAGES = new Set<WhitespaceRunStage>(['DEEP_DIVE', 'VALIDATE', 'DIMENSION_MAP'])

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
      const check = await enforceServiceAccess(auth.user.id, auth.user.tenantId, 'WHITESPACE_ANALYSIS')
      if (!check.allowed) return check.response
    }

    const scope = readScope(study.scope)
    const runnable = scopeIsRunnable(scope)
    if (!runnable.runnable) {
      return NextResponse.json({ error: runnable.reason, code: 'SCOPE_NOT_RUNNABLE' }, { status: 400 })
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

    const { runId, existing } = await startWhitespaceRun({
      studyId: study.id,
      stage,
      scope,
      scopeVersion: study.scopeVersion,
      requestHeaders: headersToRecord(request),
      params: sanitiseParams(stage, body?.params) as Prisma.InputJsonValue | undefined,
    })

    if (!existing) {
      await appendTrail(study.id, 'RUN', `user:${auth.user.id}`, `${stage} started (scope v${study.scopeVersion})`)
    }

    return NextResponse.json(
      existing
        ? { runId, stage, status: 'PROCESSING', error: 'This stage is already running for the study.' }
        : { runId, stage, status: 'PROCESSING' },
      { status: existing ? 409 : 202 }
    )
  } catch (error) {
    console.error('[Whitespace] Run start failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not start the run.' },
      { status: 400 }
    )
  }
}
