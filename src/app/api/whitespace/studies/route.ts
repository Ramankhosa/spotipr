import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { appendTrail } from '@/lib/whitespace/service'
import { emptyWhitespaceScope, parseStudyKind, WHITESPACE_STUDY_KINDS } from '@/lib/whitespace/types'
import type { Prisma } from '@prisma/client'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const auth = await authenticateUser(request)
  if (!auth.user) {
    return NextResponse.json(
      { error: auth.error?.message || 'Unauthorized' },
      { status: auth.error?.status || 401 }
    )
  }

  // Mirrors getOwnedStudy: a study created under another organisation must not
  // follow the user across tenants, and only bites when BOTH sides carry a
  // tenant. Tenantless studies are personal and always list.
  const studies = await prisma.whitespaceStudy.findMany({
    where: {
      userId: auth.user.id,
      status: 'ACTIVE',
      ...(auth.user.tenantId
        ? { OR: [{ tenantId: null }, { tenantId: auth.user.tenantId }] }
        : {}),
    },
    orderBy: { updatedAt: 'desc' },
    take: 50,
    select: {
      id: true,
      title: true,
      scopeVersion: true,
      role: true,
      kind: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { runs: true, clusters: true, hypotheses: true } },
    },
  })

  return NextResponse.json({ studies })
}

export async function POST(request: NextRequest) {
  const auth = await authenticateUser(request)
  if (!auth.user) {
    return NextResponse.json(
      { error: auth.error?.message || 'Unauthorized' },
      { status: auth.error?.status || 401 }
    )
  }

  const body = await request.json().catch(() => ({}))
  // An allowlist, not a ternary. `body.kind === 'INVENTION' ? … : 'FIELD'`
  // silently created a LANDSCAPE study for any kind it did not recognise, so a
  // client asking for a miner study would have got something else entirely,
  // with a 201 and no way to tell.
  const kind = body?.kind === undefined || body?.kind === null ? 'FIELD' : parseStudyKind(body.kind)
  if (!kind) {
    return NextResponse.json(
      { error: `Unknown study kind. Expected one of: ${WHITESPACE_STUDY_KINDS.join(', ')}.` },
      { status: 400 }
    )
  }

  // Invention and miner studies both arrive as a structured brief, kept
  // verbatim for display and recompiles and flattened into seedText for the
  // compiler. The fields differ because the questions differ: an invention
  // study describes ONE invention to place, a miner study describes the FIELD
  // to mine and, optionally, what the user already cares about inside it.
  const briefFields: Record<'INVENTION' | 'MINER', Array<{ key: string; limit: number; label: string }>> = {
    INVENTION: [
      { key: 'problem', limit: 4000, label: 'PROBLEM' },
      { key: 'approach', limit: 4000, label: 'APPROACH' },
      { key: 'constraints', limit: 2000, label: 'CONSTRAINTS' },
    ],
    MINER: [
      { key: 'field', limit: 4000, label: 'FIELD' },
      { key: 'focusProblems', limit: 2000, label: 'PROBLEMS OF INTEREST' },
      { key: 'constraints', limit: 2000, label: 'CONSTRAINTS' },
      { key: 'assigneeOfInterest', limit: 500, label: 'ASSIGNEE OF INTEREST' },
    ],
  }

  const rawInvention = (body?.invention ?? null) as Record<string, unknown> | null
  const fields = kind === 'FIELD' ? null : briefFields[kind]
  if (fields && rawInvention !== null) {
    // A string or array here used to truthiness-pass, persist an all-empty
    // brief, and leave a study that compiles from nothing.
    const shaped = typeof rawInvention === 'object' && !Array.isArray(rawInvention)
    const hasSubstance =
      shaped &&
      fields.some(field => typeof rawInvention[field.key] === 'string' && (rawInvention[field.key] as string).trim())
    if (!shaped || !hasSubstance) {
      return NextResponse.json(
        {
          error:
            kind === 'MINER'
              ? 'Say which field to mine — the brief needs at least the field, and may add the problems you care about.'
              : 'The invention brief must carry at least one of problem, approach or constraints as text.',
        },
        { status: 400 }
      )
    }
  }
  // The miner cannot start from nothing: the field IS the input, where an
  // invention study can be compiled from a free-text seed instead.
  if (kind === 'MINER') {
    const fieldText = typeof rawInvention?.field === 'string' ? rawInvention.field.trim() : ''
    const seed = typeof body?.seedText === 'string' ? body.seedText.trim() : ''
    if (!fieldText && !seed) {
      return NextResponse.json(
        { error: 'Say which field to mine. A miner study reads a whole field, so it needs one to read.' },
        { status: 400 }
      )
    }
  }

  const invention =
    fields && rawInvention
      ? Object.fromEntries(
          fields.map(field => [
            field.key,
            typeof rawInvention[field.key] === 'string'
              ? (rawInvention[field.key] as string).trim().slice(0, field.limit)
              : '',
          ])
        )
      : null
  const inventionText =
    invention && fields
      ? fields
          .map(field => (invention[field.key] ? `${field.label}: ${invention[field.key]}` : null))
          .filter(Boolean)
          .join('\n')
      : ''

  const seedText =
    typeof body?.seedText === 'string' && body.seedText.trim()
      ? body.seedText.slice(0, 60000)
      : inventionText || null
  const title =
    typeof body?.title === 'string' && body.title.trim()
      ? body.title.trim().slice(0, 200)
      : 'Untitled study'

  const scope = emptyWhitespaceScope()
  scope.title = title === 'Untitled study' ? '' : title

  const study = await prisma.whitespaceStudy.create({
    data: {
      userId: auth.user.id,
      tenantId: auth.user.tenantId || null,
      title,
      seedText,
      role: typeof body?.role === 'string' ? body.role.slice(0, 40) : null,
      kind,
      inventionJson: invention ? (invention as unknown as Prisma.InputJsonValue) : undefined,
      scope: scope as unknown as Prisma.InputJsonValue,
    },
  })

  await appendTrail(
    study.id,
    'SYSTEM',
    `user:${auth.user.id}`,
    kind === 'INVENTION' ? 'Invention study created' : kind === 'MINER' ? 'Mining study created' : 'Study created'
  )
  return NextResponse.json({ study }, { status: 201 })
}
