import { NextRequest, NextResponse } from 'next/server'
import { verifyJWT } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { enforceServiceAccess } from '@/lib/service-access-middleware'
import { hydrateNoveltyReportPatentMetadata } from '@/lib/novelty-report-metadata'
import { canDraftPatent, initializeSessionTracking } from '@/lib/patent-drafting-tracker'
import {
  buildAiAnalysisMap,
  buildNoveltyDraftingPayload,
  canonicalHandoffPatentNumber,
  rankCitationsForClaimRefinement,
  threatTag,
  toRelatedArtResultSeed,
  toSelectedPatentEntry,
  type NoveltyHandoffCitation,
} from '@/lib/novelty-drafting-handoff'

export const runtime = 'nodejs'
export const maxDuration = 120

/**
 * Creates the patent + drafting session for a completed novelty assessment and seeds the session
 * with the prior art the assessment already analysed, so drafting continues along the same path
 * rather than re-running a weaker search.
 *
 * The caller then drives the existing drafting handlers for jurisdiction/language (`set_stage`)
 * and Stage 0 normalization (`normalize_idea`) — that logic is not duplicated here.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { searchId: string } }
) {
  try {
    const authHeader = request.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Authorization token required' }, { status: 401 })
    }

    const payload = verifyJWT(authHeader.slice(7))
    if (!payload?.sub) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, tenantId: true },
    })
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 401 })
    }

    // A session without a tenantId is invisible to every quota counter in the drafting route,
    // so refuse rather than silently creating an unmeterable draft.
    if (!user.tenantId) {
      return NextResponse.json(
        {
          error: 'Your account is not linked to an organisation, so usage cannot be metered. Please contact your administrator.',
          code: 'TENANT_UNRESOLVED',
        },
        { status: 403 }
      )
    }

    const serviceCheck = await enforceServiceAccess(user.id, user.tenantId, 'PATENT_DRAFTING')
    if (!serviceCheck.allowed) {
      return serviceCheck.response
    }

    const body = await request.json().catch(() => ({}))
    const projectId = String(body?.projectId || '').trim()
    const patentTitle = String(body?.patentTitle || '').trim()

    if (!projectId) {
      return NextResponse.json({ error: 'A project is required to create the draft' }, { status: 400 })
    }
    if (!patentTitle) {
      return NextResponse.json({ error: 'Patent title is required' }, { status: 400 })
    }
    if (patentTitle.length > 300) {
      return NextResponse.json({ error: 'Title must be 300 characters or less' }, { status: 400 })
    }
    if (patentTitle.split(/\s+/).filter(Boolean).length > 15) {
      return NextResponse.json({ error: 'Title must be 15 words or less' }, { status: 400 })
    }

    const searchRun = await prisma.noveltySearchRun.findFirst({
      where: { id: params.searchId, userId: user.id },
    })
    if (!searchRun) {
      return NextResponse.json({ error: 'Novelty search not found' }, { status: 404 })
    }
    if (searchRun.status !== 'COMPLETED') {
      return NextResponse.json(
        { error: 'This novelty assessment has not finished yet. Wait for it to complete before drafting.' },
        { status: 409 }
      )
    }

    const projectAccess = await prisma.project.findFirst({
      where: {
        id: projectId,
        OR: [
          { user: { email: user.email } },
          { collaborators: { some: { user: { email: user.email } } } },
        ],
      },
      select: { id: true },
    })
    if (!projectAccess) {
      return NextResponse.json({ error: 'Project not found or access denied' }, { status: 404 })
    }

    const quota = await canDraftPatent(user.tenantId)
    if (!quota.allowed) {
      return NextResponse.json(
        { error: quota.reason || 'Patent drafting quota exceeded', quota: quota.quota },
        { status: 429 }
      )
    }

    const enrichedSearchRun = await hydrateNoveltyReportPatentMetadata(searchRun)
    const draftingPayload = buildNoveltyDraftingPayload(enrichedSearchRun)

    const existingHandoff = (searchRun.draftingHandoff as any) || {}

    const patent = await prisma.patent.create({
      data: {
        projectId,
        title: patentTitle,
        createdBy: user.id,
      },
    })

    // Everything below is seeding on top of that patent. If any of it fails the user would
    // otherwise be left with an empty patent and a half-populated session that still looks
    // like a real draft, so on failure the patent is removed and the FK cascade takes the
    // session, related-art run and selections with it.
    try {
      const session = await prisma.draftingSession.create({
        data: {
          patentId: patent.id,
          userId: user.id,
          tenantId: user.tenantId,
        },
      })

      await initializeSessionTracking(user.tenantId, session.id, patent.id, user.id)

      // ── Seed the Related Art stage from the assessment ────────────────────────────────────
      const analysed = draftingPayload.citations
      const seedResults = [...analysed, ...draftingPayload.shortlisted].map(toRelatedArtResultSeed)

      const run = await prisma.relatedArtRun.create({
        data: {
          sessionId: session.id,
          queryText: draftingPayload.searchQuery || patentTitle,
          paramsJson: {
            endpoint: 'novelty-search-handoff',
            searchId: searchRun.id,
            jurisdiction: draftingPayload.jurisdiction,
            analysedCount: analysed.length,
            shortlistedCount: draftingPayload.shortlisted.length,
            importedAt: new Date().toISOString(),
          } as any,
          resultsJson: seedResults as any,
          ranBy: user.id,
        },
      })

      const seenPatentNumbers = new Set<string>()
      const selectionRows: Array<{ citation: NoveltyHandoffCitation; tags: string[] }> = []

      for (const citation of [...analysed, ...draftingPayload.shortlisted]) {
        const key = canonicalHandoffPatentNumber(citation.patentNumber)
        if (!key || seenPatentNumbers.has(key)) continue
        seenPatentNumbers.add(key)

        // Analysed references drive drafting (USER_SELECTED); shortlisted-but-unmapped ones are
        // listed for reference only, so the user can promote them deliberately.
        const tags = citation.analysed
          ? ['USER_SELECTED', 'NOVELTY_SOURCED', 'AI_REVIEWED', threatTag(citation.noveltyThreat)]
          : ['NOVELTY_SOURCED']

        selectionRows.push({ citation, tags })
      }

      for (const { citation, tags } of selectionRows) {
        await prisma.relatedArtSelection.upsert({
          where: {
            sessionId_patentNumber_runId: {
              sessionId: session.id,
              patentNumber: citation.patentNumber,
              runId: run.id,
            },
          },
          update: {
            title: citation.title,
            snippet: citation.snippet || citation.abstract || undefined,
            score: typeof citation.score === 'number' ? citation.score : undefined,
            tags,
            publicationDate: citation.publicationDate || undefined,
            cpcCodes: citation.cpcCodes,
            ipcCodes: citation.ipcCodes,
            inventors: citation.inventors,
            assignees: citation.assignees,
          },
          create: {
            sessionId: session.id,
            runId: run.id,
            patentNumber: citation.patentNumber,
            title: citation.title,
            snippet: citation.snippet || citation.abstract || undefined,
            score: typeof citation.score === 'number' ? citation.score : undefined,
            tags,
            publicationDate: citation.publicationDate || undefined,
            cpcCodes: citation.cpcCodes,
            ipcCodes: citation.ipcCodes,
            inventors: citation.inventors,
            assignees: citation.assignees,
          },
        })
      }

      const selectedPatents = analysed.map(toSelectedPatentEntry)
      const claimRefinementPatents = rankCitationsForClaimRefinement(analysed, 5).map(toSelectedPatentEntry)

      await prisma.draftingSession.update({
        where: { id: session.id },
        data: {
          aiAnalysisData: buildAiAnalysisMap(analysed) as any,
          priorArtConfig: {
            priorArtForDrafting: {
              mode: 'ai',
              selectedPatents,
              manualText: '',
            },
            claimRefinementConfig: {
              mode: 'ai',
              selectedPatents: claimRefinementPatents,
              manualText: '',
            },
          } as any,
          noveltyHandoff: {
            searchId: searchRun.id,
            ideaBankIdeaId: existingHandoff.ideaBankIdeaId || null,
            claimGuidance: draftingPayload.claimGuidance,
            findingsDigest: draftingPayload.findingsDigest,
            risk: draftingPayload.risk,
            citationCount: analysed.length,
            shortlistedCount: draftingPayload.shortlisted.length,
            relatedArtRunId: run.id,
            importedAt: new Date().toISOString(),
          } as any,
        },
      })

      await prisma.noveltySearchRun.update({
        where: { id: searchRun.id },
        data: {
          draftingHandoff: {
            ...existingHandoff,
            patentId: patent.id,
            sessionId: session.id,
            at: new Date().toISOString(),
          } as any,
        },
      })

      return NextResponse.json({
        success: true,
        patentId: patent.id,
        sessionId: session.id,
        relatedArtRunId: run.id,
        imported: {
          analysed: analysed.length,
          shortlisted: draftingPayload.shortlisted.length,
          claimRefinementSelected: claimRefinementPatents.length,
        },
      })
    } catch (seedError) {
      await prisma.patent.delete({ where: { id: patent.id } }).catch(() => {})
      throw seedError
    }
  } catch (error) {
    console.error('Novelty to-drafting handoff error:', error)
    return NextResponse.json({ error: 'Internal server error during drafting handoff' }, { status: 500 })
  }
}
