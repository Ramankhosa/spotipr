import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { renderPlantUml } from '@/lib/plantuml-renderer'
import { renderAndWriteDiagramArtifacts, resolveDiagramPagePolicy } from '@/lib/patent-diagrams/artifacts'
import { extractReferenceMapComponents, semanticChecksum } from '@/lib/patent-diagrams/pipeline'
import { validateRawPlantUmlSource } from '@/lib/patent-diagrams/raw-source'
import { patentDiagramSchema } from '@/lib/patent-diagrams/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: { patentId: string } }
) {
  let logFigureNo: unknown
  try {
    const auth = await authenticateUser(request)
    if (auth.error || !auth.user) {
      return NextResponse.json({ error: auth.error?.message || 'Unauthorized' }, { status: auth.error?.status || 401 })
    }

    const { patentId } = params
    const body = await request.json()
    const { code, format = 'svg', figureNo, sessionId, language = 'en', persistArtifacts = false } = body || {}
    logFigureNo = figureNo

    if (!sessionId || typeof sessionId !== 'string') {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
    }
    if (!code || typeof code !== 'string') {
      return NextResponse.json({ error: 'code is required' }, { status: 400 })
    }
    if (code.length > 100_000) {
      return NextResponse.json({ error: 'code is too large' }, { status: 413 })
    }
    if (format !== 'svg' && format !== 'png') {
      return NextResponse.json({ error: 'format must be svg or png' }, { status: 400 })
    }

    const session = await prisma.draftingSession.findFirst({
      where: { id: sessionId, patentId, userId: auth.user.id },
      include: { referenceMap: true, diagramSources: true, figurePlans: true }
    })
    if (!session) {
      return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
    }

    let rendered: Awaited<ReturnType<typeof renderPlantUml>>
    let artifactPersisted = false
    if (persistArtifacts && Number.isInteger(Number(figureNo)) && Number(figureNo) > 0) {
      const source = session.diagramSources.find(item => item.figureNo === Number(figureNo) && item.language === String(language || 'en').toLowerCase())
      if (!source || source.plantumlCode !== code) {
        return NextResponse.json({ error: 'Only the currently saved diagram source can persist render artifacts' }, { status: 409 })
      }
      const components = extractReferenceMapComponents(session.referenceMap)
      const referenceMapChecksum = semanticChecksum((session.referenceMap as any)?.components || [])
      const plan = session.figurePlans.find(item => item.figureNo === Number(figureNo))
      const semantic = patentDiagramSchema.safeParse(plan?.semanticModel)
      const allowedProcessIdentifiers = semantic.success && semantic.data.kind === 'PROCESS'
        ? new Set(semantic.data.nodes.map(node => node.identifier?.toUpperCase()).filter(Boolean) as string[])
        : undefined
      const validation = validateRawPlantUmlSource(code, components, allowedProcessIdentifiers)
      // The raw dialect gate applies to pipeline-authored figures. Legacy
      // IMPORTED_RAW rows carry pre-migration syntax (activity/actor) that the
      // extractor cannot parse; they still render and must be able to backfill
      // artifacts, so their dialect issues stay report-only.
      const enforcesRawDialect = source.sourceMode === 'MANAGED' || source.sourceMode === 'RAW_OVERRIDE'
      const blocking = validation.issues.filter(issue => issue.severity === 'error' && !issue.code.startsWith('FILING_'))
      if (enforcesRawDialect && blocking.length) return NextResponse.json({ error: 'Diagram source validation failed', details: blocking }, { status: 422 })
      const countryCode = session.activeJurisdiction || session.draftingJurisdictions[0] || 'US'
      const pagePolicy = await resolveDiagramPagePolicy(countryCode)
      const artifactResult = await renderAndWriteDiagramArtifacts({
        patentId,
        figureNo: Number(figureNo),
        language: String(language || 'en').toLowerCase(),
        plantumlCode: validation.cleanedCode,
        pagePolicy,
        // Legacy IMPORTED_* rows use this path to backfill artifacts; their
        // pre-migration dialects cannot satisfy the strict filing-SVG gate.
        enforceFilingSvg: source.sourceMode === 'MANAGED' || source.sourceMode === 'RAW_OVERRIDE',
      })
      if (artifactResult.effectiveFontSizePt != null && artifactResult.effectiveFontSizePt < pagePolicy.minimumTextSizePt) {
        validation.issues.push({ code: 'FILING_PAGE_FIT', severity: 'error', message: 'Rendered diagram falls below the filing minimum text size' })
      }
      const report = {
        filingReady: !validation.issues.some(issue => issue.severity === 'error'),
        issues: validation.issues,
        sourceMode: source.sourceMode,
        render: { width: artifactResult.svg.width, height: artifactResult.svg.height, viewBox: artifactResult.svg.viewBox, effectiveFontSizePt: artifactResult.effectiveFontSizePt },
      }
      const updates: any[] = [
        prisma.diagramSource.update({
          where: { id: source.id },
          data: {
            renderArtifacts: artifactResult.artifacts as any,
            renderStatus: 'SUCCESS',
            renderError: null,
            imageFilename: artifactResult.artifacts.png.filename,
            imagePath: artifactResult.artifacts.png.path,
            imageChecksum: artifactResult.artifacts.png.checksum,
            imageUploadedAt: new Date(),
            referenceMapChecksum,
          },
        }),
      ]
      if (source.sourceMode !== 'MANAGED' && validation.facts.nodes.length) {
        // Only overwrite plan facts when the extractor understood the source;
        // legacy dialects would otherwise wipe existing nodes/edges with [].
        updates.push(prisma.figurePlan.updateMany({
          where: { sessionId, figureNo: Number(figureNo) },
          data: { nodes: validation.facts.nodes as any, edges: validation.facts.edges as any, validationReport: report as any },
        }))
      }
      await prisma.$transaction(updates)
      rendered = format === 'svg' ? artifactResult.svg : artifactResult.png
      artifactPersisted = true
    } else {
      rendered = await renderPlantUml(code, format)
    }
    return new NextResponse(new Uint8Array(rendered.buffer), {
      status: 200,
      headers: {
        'Content-Type': rendered.contentType,
        'Cache-Control': 'private, max-age=0',
        'X-Checksum': rendered.checksum,
        'X-Artifact-Persisted': artifactPersisted ? 'true' : 'false',
      }
    })
  } catch (error) {
    const err = error as Error & { upstreamStatus?: number; details?: string; cleaned?: string }
    if (err.upstreamStatus) {
      console.warn('[PlantUML render] Upstream render failed', {
        upstreamStatus: err.upstreamStatus,
        figureNo: typeof logFigureNo === 'undefined' ? undefined : logFigureNo,
        snippet: err.cleaned?.slice(0, 400)
      })
      return NextResponse.json(
        { error: 'Upstream render failed', upstreamStatus: err.upstreamStatus, details: err.details },
        { status: 502 }
      )
    }
    console.warn('[PlantUML render] Bad request', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }
}
