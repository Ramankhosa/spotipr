import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { appendTrail, getOwnedSession } from '@/lib/prior-art-studio/service'
import type { Prisma } from '@prisma/client'

export const runtime = 'nodejs'

const KINDS = new Set(['ANTICIPATION', 'COMBINATION'])
/** A combination theory without an articulated motivation is not a theory. */
const MIN_MOTIVATION = 20

export async function GET(request: NextRequest, { params }: { params: { sessionId: string } }) {
  const auth = await authenticateUser(request)
  if (!auth.user) {
    return NextResponse.json({ error: auth.error?.message || 'Unauthorized' }, { status: auth.error?.status || 401 })
  }
  const session = await getOwnedSession(params.sessionId, auth.user.id)
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const theories = await prisma.priorArtStudioTheory.findMany({
    where: { sessionId: session.id },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json({ theories })
}

export async function POST(request: NextRequest, { params }: { params: { sessionId: string } }) {
  const auth = await authenticateUser(request)
  if (!auth.user) {
    return NextResponse.json({ error: auth.error?.message || 'Unauthorized' }, { status: auth.error?.status || 401 })
  }
  const session = await getOwnedSession(params.sessionId, auth.user.id)
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const body = await request.json().catch(() => ({}))
  const kind = typeof body?.kind === 'string' && KINDS.has(body.kind) ? body.kind : null
  const publicationNumbers = Array.isArray(body?.publicationNumbers)
    ? body.publicationNumbers.map((p: unknown) => String(p).slice(0, 60)).filter(Boolean).slice(0, 8)
    : []
  const familyKeys = Array.isArray(body?.familyKeys)
    ? body.familyKeys.map((p: unknown) => String(p).slice(0, 120)).filter(Boolean).slice(0, 8)
    : []
  const motivation = typeof body?.motivation === 'string' ? body.motivation.trim().slice(0, 4000) : ''

  if (!kind) return NextResponse.json({ error: 'kind must be ANTICIPATION or COMBINATION.' }, { status: 400 })
  if (!publicationNumbers.length) return NextResponse.json({ error: 'At least one document is required.' }, { status: 400 })
  if (motivation.length < MIN_MOTIVATION) {
    return NextResponse.json(
      {
        error:
          kind === 'COMBINATION'
            ? 'Write the motivation to combine before pinning — the system computes coverage, but the obviousness rationale has to be yours.'
            : 'Write a short rationale before pinning this reference.',
      },
      { status: 400 }
    )
  }

  const theory = await prisma.priorArtStudioTheory.create({
    data: {
      sessionId: session.id,
      kind,
      publicationNumbers,
      familyKeys,
      motivation,
      elementCoverage: (body?.elementCoverage ?? null) as Prisma.InputJsonValue,
      createdBy: auth.user.id,
    },
  })

  await appendTrail(
    session.id,
    'NOTE',
    `user:${auth.user.id}`,
    `${kind === 'ANTICIPATION' ? '§102 anticipation' : '§103 combination'} theory pinned: ${publicationNumbers.join(' + ')}`,
    { theoryId: theory.id, motivation } as unknown as Prisma.InputJsonValue
  )

  return NextResponse.json({ theory })
}

export async function DELETE(request: NextRequest, { params }: { params: { sessionId: string } }) {
  const auth = await authenticateUser(request)
  if (!auth.user) {
    return NextResponse.json({ error: auth.error?.message || 'Unauthorized' }, { status: auth.error?.status || 401 })
  }
  const session = await getOwnedSession(params.sessionId, auth.user.id)
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const theoryId = new URL(request.url).searchParams.get('theoryId')
  if (!theoryId) return NextResponse.json({ error: 'theoryId required.' }, { status: 400 })

  const theory = await prisma.priorArtStudioTheory.findUnique({ where: { id: theoryId } })
  if (!theory || theory.sessionId !== session.id) {
    return NextResponse.json({ error: 'Theory not found' }, { status: 404 })
  }
  await prisma.priorArtStudioTheory.delete({ where: { id: theoryId } })
  await appendTrail(session.id, 'NOTE', `user:${auth.user.id}`, `Theory removed: ${theory.publicationNumbers.join(' + ')}`)
  return NextResponse.json({ ok: true })
}
