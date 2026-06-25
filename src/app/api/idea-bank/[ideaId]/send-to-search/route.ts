import { NextRequest, NextResponse } from 'next/server'
import { IdeaBankService } from '@/lib/idea-bank-service'
import { verifyJWT } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const ideaBankService = new IdeaBankService()

async function getUserFromRequest(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }

  const token = authHeader.substring(7)
  const payload = verifyJWT(token)
  if (!payload || !payload.sub) {
    return null
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, email: true, name: true, tenantId: true }
  })

  return user
}

function buildNoveltyDescription(idea: any) {
  const parts = [
    idea.description,
    idea.abstract ? `\n\nAbstract:\n${idea.abstract}` : '',
    idea.technicalField ? `\n\nTechnical Field:\n${idea.technicalField}` : '',
    Array.isArray(idea.keyFeatures) && idea.keyFeatures.length
      ? `\n\nKey Features:\n${idea.keyFeatures.map((feature: string) => `- ${feature}`).join('\n')}`
      : '',
    Array.isArray(idea.potentialApplications) && idea.potentialApplications.length
      ? `\n\nPotential Applications:\n${idea.potentialApplications.map((application: string) => `- ${application}`).join('\n')}`
      : '',
    idea.priorArtSummary ? `\n\nPrior Art Summary:\n${idea.priorArtSummary}` : '',
  ];

  return parts.filter(Boolean).join('').slice(0, 4000);
}

// POST /api/idea-bank/[ideaId]/send-to-search
// Deprecated queueing behavior: returns a prefilled novelty workflow URL so Stage 0 can be reviewed.
export async function POST(
  request: NextRequest,
  { params }: { params: { ideaId: string } }
) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const requestHeaders: Record<string, string> = {}
    request.headers.forEach((value, key) => {
      requestHeaders[key] = value
    })

    const idea = await ideaBankService.getIdeaById(requestHeaders, params.ideaId, user)
    if (!idea) {
      return NextResponse.json({ error: 'Idea not found' }, { status: 404 })
    }
    if (!idea._isReservedByCurrentUser) {
      return NextResponse.json(
        { error: 'You must reserve this idea before sending it to novelty search' },
        { status: 400 }
      )
    }

    const searchParams = new URLSearchParams({
      title: idea.title,
      description: buildNoveltyDescription(idea),
      source: 'idea_bank',
      ideaId: params.ideaId,
    })

    return NextResponse.json({
      success: true,
      noveltySearchUrl: `/novelty-search?${searchParams.toString()}`,
      message: 'Open the novelty search workflow to review and approve Stage 0 before queueing.'
    })
  } catch (error) {
    console.error('Failed to send idea to novelty search:', error)
    return NextResponse.json({
      error: 'Failed to send idea to novelty search',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 400 })
  }
}
