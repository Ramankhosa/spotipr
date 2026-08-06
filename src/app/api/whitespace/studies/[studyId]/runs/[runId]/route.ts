import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { getOwnedStudy, resolveStaleRun, runPayload } from '@/lib/whitespace/service'

export const runtime = 'nodejs'

/** Poll target for a stage started with 202. */
export async function GET(
  request: NextRequest,
  { params }: { params: { studyId: string; runId: string } }
) {
  const auth = await authenticateUser(request)
  if (!auth.user) {
    return NextResponse.json(
      { error: auth.error?.message || 'Unauthorized' },
      { status: auth.error?.status || 401 }
    )
  }

  const study = await getOwnedStudy(params.studyId, auth.user.id, auth.user.tenantId)
  if (!study) return NextResponse.json({ error: 'Study not found' }, { status: 404 })

  const run = await prisma.whitespaceRun.findUnique({ where: { id: params.runId } })
  if (!run || run.studyId !== study.id) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  }

  // Runs are detached in-process, so a restart leaves them PROCESSING forever.
  // Failing them lazily on read means no cron is needed to keep the list honest.
  const resolved = await resolveStaleRun(run)

  return NextResponse.json({
    ...runPayload(resolved),
    // A result computed against an earlier scope is not wrong, but it no longer
    // answers the question the user is now asking. Say so rather than hide it.
    scopeStale: resolved.scopeVersion !== study.scopeVersion,
    scopeVersion: resolved.scopeVersion,
    currentScopeVersion: study.scopeVersion,
  })
}
