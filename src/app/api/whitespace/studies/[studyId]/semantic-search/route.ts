import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { appendTrail, getOwnedStudy, readScope } from '@/lib/whitespace/service'
import { scopeIsRunnable } from '@/lib/whitespace/scope-schema'
import { resolveFieldDefinition } from '@/lib/whitespace/field-definition'
import { dedupeNeighborsByFamily, semanticNeighbors } from '@/lib/whitespace/embedding'
import { WhitespaceHttpError, whitespaceErrorResponse } from '@/app/api/whitespace/route-errors'

export const runtime = 'nodejs'

/**
 * Ad-hoc semantic search inside a study's field.
 *
 * The user's words are embedded once and compared against the corpus slice the
 * study's field rule selects, so the results are the nearest documents BY
 * MEANING inside the same footprint every stage measured. This is a ranking,
 * not a set definition — no distance ceiling is applied (that distinction is
 * the maxDistance docstring's, in embedding.ts), and nothing here feeds the
 * census numbers.
 *
 * Serves two surfaces: the "Search the field by meaning" panel, and the
 * co-occupancy grid's per-cell "Find the closest art" probe.
 */

const MAX_QUERY_CHARS = 600
const MAX_LIMIT = 25
const DEFAULT_LIMIT = 10
/** Embed calls cost real money; this bounds a stuck retry loop, not usage. */
const SEARCHES_PER_MINUTE = 10
/**
 * How long a search waits for the field definition. A cold study (no memoised
 * definition, or a rule that needs refitting) can spend minutes measuring the
 * field — acceptable inside a background stage, unacceptable behind a search
 * box. Past this budget the request answers "still preparing" while the
 * resolve keeps running and warms the module memo, so the retry is instant.
 */
const FIELD_RESOLVE_BUDGET_MS = 20_000

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
    const query = typeof body?.query === 'string' ? body.query.trim().slice(0, MAX_QUERY_CHARS) : ''
    if (!query) throw new WhitespaceHttpError(400, 'Type what to look for first.')
    const rawLimit = Number(body?.limit)
    const limit = Number.isFinite(rawLimit)
      ? Math.max(1, Math.min(MAX_LIMIT, Math.floor(rawLimit)))
      : DEFAULT_LIMIT

    const scope = readScope(study.scope)
    const runnable = scopeIsRunnable(scope)
    if (!runnable.runnable) {
      return NextResponse.json({ error: runnable.reason, code: 'SCOPE_NOT_RUNNABLE' }, { status: 400 })
    }

    // Same cheap guard shape as the runs route. The trail doubles as the
    // counter, so attempts are recorded on the study's own audit trail.
    const recentSearches = await prisma.whitespaceTrailEntry.count({
      where: {
        kind: 'SEARCH',
        createdAt: { gte: new Date(Date.now() - 60_000) },
        study: { userId: auth.user.id },
      },
    })
    if (recentSearches >= SEARCHES_PER_MINUTE) {
      return NextResponse.json(
        { error: 'Too many searches. Wait a minute and try again.', code: 'WS_RATE_LIMITED' },
        { status: 429, headers: { 'Retry-After': '60' } }
      )
    }

    // Recorded BEFORE the embed spend, so a failing provider cannot be
    // hammered by a retry loop the limiter never sees.
    await appendTrail(study.id, 'SEARCH', `user:${auth.user.id}`, `Semantic search: "${query.slice(0, 80)}"`)

    // Consumer mode: reuse the persisted census rule so the search looks at
    // exactly the field the study measured, not a fresh refit.
    const fieldPromise = resolveFieldDefinition(scope, { studyId: study.id, reuse: true })
    const field = await Promise.race([
      fieldPromise,
      new Promise<null>(resolve => setTimeout(() => resolve(null), FIELD_RESOLVE_BUDGET_MS)),
    ])
    if (!field) {
      // Not abandoned: the resolve continues and memoises, and its eventual
      // failure (if any) must not become an unhandled rejection.
      fieldPromise.catch(() => {})
      return NextResponse.json({
        available: false,
        reason: 'The field is still being prepared for its first search — try again in a minute.',
      })
    }
    const result = await semanticNeighbors({
      queryText: query,
      // Over-fetch so the family dedupe below still fills the page.
      limit: Math.min(60, limit * 3),
      scopeFilter: field.where,
      timeoutMs: 15_000,
    })

    if (!result.available) {
      return NextResponse.json({ available: false, reason: result.reason })
    }

    const neighbors = dedupeNeighborsByFamily(result.neighbors, limit).map(neighbor => ({
      // The internal autoincrement id stays server-side.
      publicationNumber: neighbor.publicationNumber,
      familyKey: neighbor.familyKey,
      title: neighbor.title,
      abstract: neighbor.abstract ? neighbor.abstract.slice(0, 600) : null,
      distance: neighbor.distance,
    }))

    return NextResponse.json({
      available: true,
      query,
      effectiveLimit: result.effectiveLimit,
      neighbors,
    })
  } catch (error) {
    return whitespaceErrorResponse(error, 'Semantic search')
  }
}
