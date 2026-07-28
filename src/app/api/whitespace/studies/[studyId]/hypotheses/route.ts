import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { getOwnedStudy } from '@/lib/whitespace/service'

export const runtime = 'nodejs'

/** Hypotheses with their evidence trails and any concepts they became. */
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

  const [hypotheses, concepts, clusters] = await Promise.all([
    prisma.whitespaceHypothesis.findMany({
      where: { studyId: study.id },
      orderBy: { createdAt: 'desc' },
      include: {
        evidence: { orderBy: { createdAt: 'asc' }, take: 40 },
      },
    }),
    prisma.whitespaceConcept.findMany({
      where: { studyId: study.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, hypothesisId: true, title: true, summary: true, status: true, createdAt: true, features: true },
    }),
    prisma.whitespaceCluster.findMany({
      where: { studyId: study.id },
      select: { id: true, label: true },
    }),
  ])

  const labelByCluster = new Map(clusters.map(cluster => [cluster.id, cluster.label]))
  return NextResponse.json({
    hypotheses: hypotheses.map(hypothesis => ({
      ...hypothesis,
      clusterLabel: hypothesis.clusterId ? labelByCluster.get(hypothesis.clusterId) ?? null : null,
    })),
    concepts,
  })
}
