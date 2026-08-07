import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { loadFirmBranding } from '@/lib/firm-profile-service'
import { getOwnedStudy, readScope } from '@/lib/whitespace/service'
import { buildWhitespaceReportModel } from '@/lib/whitespace/report-model'
import { buildWhitespaceReportDocx } from '@/lib/whitespace/report-docx'

export const runtime = 'nodejs'
export const maxDuration = 120

/** The stages whose stored results the report renders. */
const RESULT_STAGES = ['FIELD_MAP', 'SIGNALS', 'DIMENSION_MAP'] as const

const RUN_LIMIT = 50
const TRAIL_LIMIT = 100

/**
 * The study as a branded Word document.
 *
 * Not metered: this is a read of work the tenant has already paid to compute.
 *
 * Loading is deliberately two-pass. Run `results` hold whole census payloads and
 * can run to megabytes each, so the first pass takes run METADATA only — enough
 * for the diagnostics table, which must list every attempt including the failed
 * ones — and the second pass fetches results for just the newest completed run
 * of each stage the document actually renders. Cluster members are never loaded
 * at all: they are the one table that scales with corpus sample size, and
 * nothing in the report is drawn per-member.
 */
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

  const [runs, clusters, areas, hypotheses, concepts, trail, firm] = await Promise.all([
    prisma.whitespaceRun.findMany({
      where: { studyId: study.id },
      orderBy: { createdAt: 'desc' },
      take: RUN_LIMIT,
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
    }),
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
      },
    }),
    prisma.whitespaceAreaAnalysis.findMany({
      where: { studyId: study.id },
      select: { clusterId: true, status: true, textCoverage: true, results: true },
    }),
    prisma.whitespaceHypothesis.findMany({
      where: { studyId: study.id },
      orderBy: { createdAt: 'asc' },
      include: {
        evidence: {
          orderBy: { createdAt: 'asc' },
          take: 40,
          select: { kind: true, stance: true, refId: true, passage: true, queryText: true },
        },
      },
    }),
    prisma.whitespaceConcept.findMany({
      where: { studyId: study.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, hypothesisId: true, title: true, summary: true, status: true, features: true },
    }),
    prisma.whitespaceTrailEntry.findMany({
      where: { studyId: study.id },
      orderBy: { createdAt: 'desc' },
      take: TRAIL_LIMIT,
      select: { kind: true, actor: true, summary: true, createdAt: true },
    }),
    loadFirmBranding(study.tenantId),
  ])

  // Runs arrive newest-first, so the first COMPLETED match per stage is the latest.
  const latestIds = RESULT_STAGES.map(
    stage => runs.find(run => run.stage === stage && run.status === 'COMPLETED')?.id
  ).filter((id): id is string => Boolean(id))

  const resultRows = latestIds.length
    ? await prisma.whitespaceRun.findMany({
        where: { id: { in: latestIds } },
        select: { stage: true, results: true, scopeVersion: true },
      })
    : []

  const resultOf = (stage: string) => {
    const row = resultRows.find(entry => entry.stage === stage)
    return row ? { results: row.results, scopeVersion: row.scopeVersion } : null
  }

  const model = buildWhitespaceReportModel({
    study: {
      id: study.id,
      title: study.title,
      kind: study.kind,
      scopeVersion: study.scopeVersion,
      createdAt: study.createdAt,
      inventionJson: study.inventionJson,
    },
    scope: readScope(study.scope),
    preparedBy: auth.user.email || auth.user.id,
    firm,
    runs,
    stageResults: {
      fieldMap: resultOf('FIELD_MAP'),
      signals: resultOf('SIGNALS'),
      dimensionMap: resultOf('DIMENSION_MAP'),
    },
    clusters,
    areas,
    hypotheses,
    concepts,
    trail,
    generatedAt: new Date(),
    runsTruncated: runs.length === RUN_LIMIT,
    trailTruncated: trail.length === TRAIL_LIMIT,
  })

  const buffer = await buildWhitespaceReportDocx(model)

  // Id-derived and ASCII: the study title is user text and never belongs in a header.
  const filename = `Whitespace-Report_${study.id.slice(-6)}_v${study.scopeVersion}.docx`
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
