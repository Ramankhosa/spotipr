import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { appendTrail, computeSaturation, getOwnedSession } from '@/lib/prior-art-studio/service'

export const runtime = 'nodejs'

const TAGS = new Set(['RELEVANT', 'MAYBE', 'NOT_RELEVANT'])

const TAG_LABEL: Record<string, string> = {
  RELEVANT: 'Relevant',
  MAYBE: 'Maybe',
  NOT_RELEVANT: 'Not relevant',
}

export async function POST(request: NextRequest, { params }: { params: { sessionId: string } }) {
  const auth = await authenticateUser(request)
  if (!auth.user) {
    return NextResponse.json({ error: auth.error?.message || 'Unauthorized' }, { status: auth.error?.status || 401 })
  }
  const session = await getOwnedSession(params.sessionId, auth.user.id)
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const body = await request.json().catch(() => ({}))
  const familyKey = typeof body?.familyKey === 'string' ? body.familyKey.slice(0, 120) : ''
  const publicationNumber = typeof body?.publicationNumber === 'string' ? body.publicationNumber.slice(0, 60) : ''
  if (!familyKey || !publicationNumber) {
    return NextResponse.json({ error: 'familyKey and publicationNumber are required.' }, { status: 400 })
  }

  const tag = typeof body?.tag === 'string' && TAGS.has(body.tag) ? body.tag : body?.tag === null ? null : undefined
  const excluded = typeof body?.excluded === 'boolean' ? body.excluded : undefined
  const note = typeof body?.note === 'string' ? body.note.slice(0, 2000) : undefined

  const state = await prisma.priorArtStudioDocState.upsert({
    where: { sessionId_familyKey: { sessionId: session.id, familyKey } },
    update: {
      publicationNumber,
      ...(tag !== undefined ? { tag } : {}),
      ...(excluded !== undefined ? { excluded } : {}),
      ...(note !== undefined ? { note } : {}),
    },
    create: {
      sessionId: session.id,
      familyKey,
      publicationNumber,
      tag: tag ?? null,
      excluded: excluded ?? false,
      note: note ?? null,
    },
  })

  const action =
    tag !== undefined
      ? tag
        ? `Tagged ${publicationNumber}: ${TAG_LABEL[tag] || tag}`
        : `Cleared tag on ${publicationNumber}`
      : excluded !== undefined
        ? excluded
          ? `Excluded family of ${publicationNumber}`
          : `Restored family of ${publicationNumber}`
        : `Noted ${publicationNumber}`
  await appendTrail(session.id, tag !== undefined || excluded !== undefined ? 'TAG' : 'NOTE', `user:${auth.user.id}`, action)

  // Recompute the stopping rule on every mark so the meter is always live.
  const allStates = await prisma.priorArtStudioDocState.findMany({
    where: { sessionId: session.id },
    select: { tag: true, updatedAt: true },
  })

  return NextResponse.json({ state, saturation: computeSaturation(allStates) })
}
