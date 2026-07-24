import { NextRequest, NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { verifyJWT } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { llmGateway } from '@/lib/metering/gateway'
import { enforceServiceAccess } from '@/lib/service-access-middleware'
import { hydrateNoveltyReportPatentMetadata } from '@/lib/novelty-report-metadata'
import { IdeaBankService } from '@/lib/idea-bank-service'
import {
  buildIdeaRefinementPrompt,
  buildNoveltyDraftingPayload,
  parseIdeaRefinementResponse,
} from '@/lib/novelty-drafting-handoff'

export const runtime = 'nodejs'
export const maxDuration = 120

const ideaBankService = new IdeaBankService()

/**
 * Rewrites the invention disclosure against the findings of a completed novelty assessment, and
 * stores the result as a PRIVATE Idea Bank record owned by the requesting user.
 *
 * PRIVATE matters: the Idea Bank listing is platform-wide, so an unfiled invention saved as PUBLIC
 * would be readable — and reservable — by every user. See IdeaBankService.searchIdeas.
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
      select: { id: true, email: true, name: true, tenantId: true },
    })
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 401 })
    }

    // Fails closed: an untenanted user cannot be metered, and a drafting session without a
    // tenantId is invisible to every quota counter in the drafting route.
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

    const enrichedSearchRun = await hydrateNoveltyReportPatentMetadata(searchRun)
    const draftingPayload = buildNoveltyDraftingPayload(enrichedSearchRun)

    const prompt = buildIdeaRefinementPrompt({
      originalTitle: searchRun.title,
      originalDescription: searchRun.inventionDescription,
      payload: draftingPayload,
    })

    const requestHeaders: Record<string, string> = {}
    request.headers.forEach((value, key) => {
      requestHeaders[key] = value
    })

    const llmResult = await llmGateway.executeLLMOperation({ headers: requestHeaders }, {
      taskCode: 'LLM2_DRAFT',
      // Same stage as Stage 0 idea normalization, so the admin-configured drafting model applies
      // and the call is metered against patent drafting rather than novelty search.
      stageCode: 'DRAFT_IDEA_ENTRY',
      prompt,
      idempotencyKey: crypto.randomUUID(),
      inputTokens: Math.ceil(prompt.length / 4),
      parameters: { tenantId: user.tenantId, temperature: 0.2, maxOutputTokens: 3000 },
      metadata: {
        purpose: 'novelty_idea_refinement',
        searchId: searchRun.id,
      },
    })

    if (!llmResult.success || !llmResult.response) {
      return NextResponse.json(
        { error: llmResult.error?.message || 'Idea refinement failed' },
        { status: 502 }
      )
    }

    const parsed = parseIdeaRefinementResponse(llmResult.response.output)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: 502 })
    }

    const refined = parsed.data
    const existingHandoff = (searchRun.draftingHandoff as any) || {}
    const existingIdeaId: string | undefined = existingHandoff.ideaBankIdeaId

    // Novelty score as a rough patentability signal for the Idea Bank card: a High mapped-overlap
    // risk means less remaining space, not more.
    const noveltyScore = draftingPayload.risk.noveltyRisk === 'Low'
      ? 0.8
      : draftingPayload.risk.noveltyRisk === 'Moderate'
        ? 0.55
        : draftingPayload.risk.noveltyRisk === 'High'
          ? 0.3
          : 0.5

    const ideaFields = {
      title: refined.refinedTitle,
      description: refined.refinedDescription,
      abstract: refined.abstract || undefined,
      domainTags: refined.domainTags.length ? refined.domainTags : ['patent-drafting'],
      technicalField: refined.technicalField || undefined,
      keyFeatures: refined.keyFeatures,
      potentialApplications: refined.potentialApplications,
      priorArtSummary: draftingPayload.findingsDigest,
      noveltyScore,
    }

    let ideaId = existingIdeaId || ''

    // Re-running the refinement updates the same private record rather than littering the
    // Idea Bank with one row per attempt.
    const existingIdea = existingIdeaId
      ? await prisma.ideaBankIdea.findFirst({
          where: { id: existingIdeaId, createdBy: user.id, status: 'PRIVATE' },
          select: { id: true },
        })
      : null

    if (existingIdea) {
      await prisma.ideaBankIdea.update({
        where: { id: existingIdea.id },
        data: {
          title: ideaFields.title,
          description: ideaFields.description,
          abstract: ideaFields.abstract,
          domainTags: ideaFields.domainTags,
          technicalField: ideaFields.technicalField,
          keyFeatures: ideaFields.keyFeatures,
          potentialApplications: ideaFields.potentialApplications,
          priorArtSummary: ideaFields.priorArtSummary,
          noveltyScore: ideaFields.noveltyScore,
        },
      })
      ideaId = existingIdea.id
    } else {
      const created = await ideaBankService.createIdea(requestHeaders, {
        ...ideaFields,
        status: 'PRIVATE',
      }, user as any)
      ideaId = created.id
    }

    await prisma.noveltySearchRun.update({
      where: { id: searchRun.id },
      data: {
        draftingHandoff: {
          ...existingHandoff,
          ideaBankIdeaId: ideaId,
          refinedAt: new Date().toISOString(),
        } as any,
      },
    })

    return NextResponse.json({
      success: true,
      ideaId,
      original: {
        title: searchRun.title,
        description: searchRun.inventionDescription,
      },
      refined,
      payload: {
        searchId: draftingPayload.searchId,
        jurisdiction: draftingPayload.jurisdiction,
        citationCount: draftingPayload.citations.length,
        shortlistedCount: draftingPayload.shortlisted.length,
        citations: draftingPayload.citations.map(item => ({
          patentNumber: item.patentNumber,
          title: item.title,
          noveltyThreat: item.noveltyThreat,
          overlapRiskLevel: item.overlapRiskLevel,
        })),
        claimGuidance: draftingPayload.claimGuidance,
        findingsDigest: draftingPayload.findingsDigest,
        risk: draftingPayload.risk,
      },
    })
  } catch (error) {
    console.error('Novelty idea refinement error:', error)
    return NextResponse.json({ error: 'Internal server error during idea refinement' }, { status: 500 })
  }
}
