import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { getOwnedStudy } from '@/lib/whitespace/service'

export const runtime = 'nodejs'

/** The area map: clusters with their metrics, plus each area's deep-dive state. */
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

  const [clusters, areas] = await Promise.all([
    prisma.whitespaceCluster.findMany({
      where: { studyId: study.id, depth: 0 },
      orderBy: { fieldEstimate: 'desc' },
      select: {
        id: true,
        label: true,
        description: true,
        keywords: true,
        memberCount: true,
        fieldEstimate: true,
        cohesion: true,
        separation: true,
        silhouette: true,
        metrics: true,
        createdAt: true,
      },
    }),
    prisma.whitespaceAreaAnalysis.findMany({
      where: { studyId: study.id },
      select: { clusterId: true, status: true, textCoverage: true, results: true, updatedAt: true },
    }),
  ])

  const areaByCluster = new Map(areas.map(area => [area.clusterId, area]))

  // Latest signals results ride along so the divergence probe survives a reload.
  const signalsRun = await prisma.whitespaceRun.findFirst({
    where: { studyId: study.id, stage: 'SIGNALS', status: 'COMPLETED' },
    orderBy: { createdAt: 'desc' },
    select: { results: true, completedAt: true },
  })

  return NextResponse.json({
    clusters: clusters.map(cluster => ({
      ...cluster,
      deepDive: areaByCluster.get(cluster.id) ?? null,
    })),
    signals: signalsRun?.results ?? null,
    signalsAt: signalsRun?.completedAt ?? null,
  })
}
