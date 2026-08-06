import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { appendTrail, getOwnedStudy, readScope } from '@/lib/whitespace/service'
import { normalizeScope, validateWhitespaceScope } from '@/lib/whitespace/scope-schema'
import type { Prisma } from '@prisma/client'

export const runtime = 'nodejs'

export async function GET(request: NextRequest, { params }: { params: { studyId: string } }) {
  const auth = await authenticateUser(request)
  if (!auth.user) {
    return NextResponse.json(
      { error: auth.error?.message || 'Unauthorized' },
      { status: auth.error?.status || 401 }
    )
  }

  const study = await getOwnedStudy(params.studyId, auth.user.id, auth.user.tenantId)
  if (!study) return NextResponse.json({ error: 'Study not found' }, { status: 404 })

  const runs = await prisma.whitespaceRun.findMany({
    where: { studyId: study.id },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      stage: true,
      status: true,
      scopeVersion: true,
      durationMs: true,
      lastError: true,
      createdAt: true,
      completedAt: true,
    },
  })

  return NextResponse.json({ study: { ...study, scope: readScope(study.scope) }, runs })
}

/**
 * Scope edits bump scopeVersion rather than mutating in place. Downstream runs
 * carry the version they were computed against, so the UI can tell the user
 * plainly that a result predates their edit instead of silently showing stale
 * numbers against a changed premise.
 */
export async function PATCH(request: NextRequest, { params }: { params: { studyId: string } }) {
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
  const data: Prisma.WhitespaceStudyUpdateInput = {}
  let scopeChanged = false

  if (typeof body?.title === 'string' && body.title.trim()) {
    data.title = body.title.trim().slice(0, 200)
  }
  if (typeof body?.role === 'string') {
    data.role = body.role.slice(0, 40)
  }
  if (body?.status === 'ARCHIVED' || body?.status === 'ACTIVE') {
    data.status = body.status
  }

  if (body?.scope !== undefined) {
    const validation = validateWhitespaceScope(body.scope)
    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error, code: 'INVALID_SCOPE', fields: validation.fields },
        { status: 400 }
      )
    }
    data.scope = normalizeScope(validation.scope) as unknown as Prisma.InputJsonValue
    data.scopeVersion = { increment: 1 }
    scopeChanged = true
  }

  if (!Object.keys(data).length) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
  }

  const updated = await prisma.whitespaceStudy.update({ where: { id: study.id }, data })

  if (scopeChanged) {
    await appendTrail(
      study.id,
      'SCOPE',
      `user:${auth.user.id}`,
      `Scope edited (now v${updated.scopeVersion}) — earlier results were computed against v${study.scopeVersion}`
    )
  }

  return NextResponse.json({ study: { ...updated, scope: readScope(updated.scope) } })
}

export async function DELETE(request: NextRequest, { params }: { params: { studyId: string } }) {
  const auth = await authenticateUser(request)
  if (!auth.user) {
    return NextResponse.json(
      { error: auth.error?.message || 'Unauthorized' },
      { status: auth.error?.status || 401 }
    )
  }

  const study = await getOwnedStudy(params.studyId, auth.user.id, auth.user.tenantId)
  if (!study) return NextResponse.json({ error: 'Study not found' }, { status: 404 })

  // Archive rather than delete: a study is evidence for decisions already taken,
  // and its trail should survive the user tidying their list.
  await prisma.whitespaceStudy.update({ where: { id: study.id }, data: { status: 'ARCHIVED' } })
  await appendTrail(study.id, 'SYSTEM', `user:${auth.user.id}`, 'Study archived')

  return NextResponse.json({ ok: true })
}
