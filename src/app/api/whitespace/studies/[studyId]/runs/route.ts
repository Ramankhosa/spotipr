import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { enforceServiceAccess } from '@/lib/service-access-middleware'
import { appendTrail, getOwnedStudy, readScope, startWhitespaceRun } from '@/lib/whitespace/service'
import { scopeIsRunnable } from '@/lib/whitespace/scope-schema'
import type { WhitespaceRunStage } from '@/lib/whitespace/types'

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

export async function POST(request: NextRequest, { params }: { params: { studyId: string } }) {
  try {
    const auth = await authenticateUser(request)
    if (!auth.user) {
      return NextResponse.json(
        { error: auth.error?.message || 'Unauthorized' },
        { status: auth.error?.status || 401 }
      )
    }

    const study = await getOwnedStudy(params.studyId, auth.user.id)
    if (!study) return NextResponse.json({ error: 'Study not found' }, { status: 404 })

    const body = await request.json().catch(() => ({}))
    const stage = body?.stage as WhitespaceRunStage
    if (!STAGES.includes(stage)) {
      return NextResponse.json(
        { error: `Unknown stage. Expected one of: ${STAGES.join(', ')}.` },
        { status: 400 }
      )
    }

    if (METERED_STAGES.has(stage) && auth.user.tenantId) {
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
      params: body?.params ?? undefined,
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
