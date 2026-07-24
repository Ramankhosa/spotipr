import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { appendTrail, compileScope, getOwnedStudy, readScope } from '@/lib/whitespace/service'
import { normalizeScope } from '@/lib/whitespace/scope-schema'
import type { Prisma } from '@prisma/client'

export const runtime = 'nodejs'
export const maxDuration = 60

function headersToRecord(request: NextRequest) {
  const headers: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    headers[key] = value
  })
  return headers
}

/**
 * Turns the user's plain-language brief into a reviewable scope.
 *
 * Runs inline rather than as a background run: this is a single cheap-tier call
 * and the user is waiting on the result to decide whether to continue. It does
 * not persist over an existing scope the user has already edited unless they
 * ask for a recompile.
 */
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
    const brief =
      typeof body?.brief === 'string' && body.brief.trim() ? body.brief.trim() : study.seedText || ''

    if (brief.trim().length < 20) {
      return NextResponse.json(
        {
          error:
            'Describe the field in a sentence or two first — a few words is not enough to build a search scope from.',
          code: 'BRIEF_TOO_SHORT',
        },
        { status: 400 }
      )
    }

    const existing = readScope(study.scope)
    const hasUserEdits =
      existing.concepts.some(c => c.origin === 'user') ||
      existing.classifications.some(c => c.origin === 'user')
    if (hasUserEdits && body?.force !== true) {
      return NextResponse.json(
        {
          error: 'This scope has your own edits. Recompiling will replace them.',
          code: 'SCOPE_HAS_USER_EDITS',
        },
        { status: 409 }
      )
    }

    const { scope, modelCode } = await compileScope({
      brief,
      existingTitle: study.title === 'Untitled study' ? undefined : study.title,
      requestHeaders: headersToRecord(request),
    })

    const normalized = normalizeScope(scope)
    const updated = await prisma.whitespaceStudy.update({
      where: { id: study.id },
      data: {
        scope: normalized as unknown as Prisma.InputJsonValue,
        scopeVersion: { increment: 1 },
        seedText: brief.slice(0, 60000),
        title: normalized.title || study.title,
      },
    })

    await appendTrail(
      study.id,
      'SCOPE',
      modelCode ? `model:${modelCode}` : 'system',
      `Scope compiled — ${normalized.concepts.length} concepts, ${normalized.classifications.length} classifications, ${normalized.assumptions.length} assumptions`
    )

    return NextResponse.json({
      scope: normalized,
      scopeVersion: updated.scopeVersion,
      modelCode,
    })
  } catch (error) {
    console.error('[Whitespace] Scope compile failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Scope compile failed.' },
      { status: 400 }
    )
  }
}
