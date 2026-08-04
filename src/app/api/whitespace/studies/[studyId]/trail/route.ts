import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { getOwnedStudy } from '@/lib/whitespace/service'

export const runtime = 'nodejs'

/**
 * The study's audit trail.
 *
 * Entries are written at every scope compile, edit, run and promotion and carry
 * human-written summaries; until now nothing read them back. A study is
 * evidence for a decision, so how it reached its answer has to be inspectable.
 */
export async function GET(request: NextRequest, { params }: { params: { studyId: string } }) {
  const auth = await authenticateUser(request)
  if (!auth.user) {
    return NextResponse.json(
      { error: auth.error?.message || 'Unauthorized' },
      { status: auth.error?.status || 401 }
    )
  }

  const study = await getOwnedStudy(params.studyId, auth.user.id)
  if (!study) return NextResponse.json({ error: 'Study not found' }, { status: 404 })

  const entries = await prisma.whitespaceTrailEntry.findMany({
    where: { studyId: study.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: { id: true, kind: true, actor: true, summary: true, createdAt: true },
  })

  return NextResponse.json({
    entries: entries.map(entry => ({
      id: entry.id,
      kind: entry.kind,
      // The actor is "user:<id>" or "model:<code>"; the client only needs to
      // distinguish a person from a model, never to see an internal id.
      actor: entry.actor.startsWith('model:') ? entry.actor.slice(6) : entry.actor.startsWith('user:') ? 'you' : 'system',
      byModel: entry.actor.startsWith('model:'),
      summary: entry.summary,
      at: entry.createdAt.toISOString(),
    })),
  })
}
