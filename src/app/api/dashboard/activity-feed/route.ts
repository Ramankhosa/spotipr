import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyJWT } from '@/lib/auth'

// Force dynamic rendering since we access request headers
export const dynamic = 'force-dynamic'

interface ActivityItem {
  id: string
  type: 'idea' | 'draft' | 'novelty' | 'reservation'
  title: string
  description: string
  timestamp: string
  metadata?: Record<string, any>
  kishoNote?: string
}

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

/**
 * GET /api/dashboard/activity-feed
 * Returns unified activity feed from all user activities (drafts, novelty searches, ideas, reservations)
 * sorted by most recent first
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const limit = parseInt(url.searchParams.get('limit') || '10')

    const activities: ActivityItem[] = []

    // 1. Fetch recent drafting sessions (patents being drafted)
    try {
      const draftingSessions = await prisma.draftingSession.findMany({
        where: {
          userId: user.id,
        },
        include: {
          patent: {
            select: {
              id: true,
              title: true,
            }
          },
          ideaRecord: true,
          annexureDrafts: {
            orderBy: { version: 'desc' },
            take: 1
          }
        },
        orderBy: { updatedAt: 'desc' },
        take: limit
      })

      for (const session of draftingSessions) {
        const patentTitle = session.patent?.title || (session.ideaRecord as any)?.title || 'Untitled Draft'
        const hasAnnexure = session.annexureDrafts && session.annexureDrafts.length > 0
        const latestAnnexure = hasAnnexure ? session.annexureDrafts[0] : null
        
        // Calculate completion percentage based on stage
        let completionNote = ''
        let description = ''
        
        if (session.status === 'COMPLETED') {
          description = 'Draft completed and ready for export.'
          completionNote = 'All sections generated. Ready for final review.'
        } else if (latestAnnexure) {
          // Count sections from legacy columns and extraSections JSON
          const legacyColumns = ['fieldOfInvention', 'background', 'summary', 'briefDescriptionOfDrawings', 
            'detailedDescription', 'bestMethod', 'claims', 'abstract', 'industrialApplicability', 'listOfNumerals']
          const legacyCount = legacyColumns.filter(col => (latestAnnexure as any)[col]).length
          const extraSections = (latestAnnexure as any).extraSections || {}
          const extraCount = typeof extraSections === 'object' ? Object.keys(extraSections).filter(k => extraSections[k]).length : 0
          const sectionCount = legacyCount + extraCount
          description = `Draft in progress with ${sectionCount} section(s) generated.`
          completionNote = sectionCount > 5 
            ? 'Most sections complete. Consider running AI review.'
            : 'Continue drafting to complete more sections.'
        } else if (session.status) {
          description = `Currently at ${session.status.replace(/_/g, ' ').toLowerCase()} stage.`
          completionNote = 'Progress saved. Continue where you left off.'
        } else {
          description = 'Draft session started.'
          completionNote = 'Begin with invention details to get started.'
        }

        activities.push({
          id: `draft-${session.id}`,
          type: 'draft',
          title: patentTitle,
          description,
          timestamp: session.updatedAt.toISOString(),
          metadata: {
            sessionId: session.id,
            patentId: session.patentId,
            stage: session.status,
            status: session.status
          },
          kishoNote: completionNote
        })
      }
    } catch (e) {
      console.error('Error fetching drafting sessions:', e)
    }

    // 2. Fetch recent novelty searches
    try {
      const noveltySearches = await prisma.noveltySearchRun.findMany({
        where: {
          userId: user.id,
        },
        include: {
          project: {
            select: { name: true }
          }
        },
        orderBy: { createdAt: 'desc' } as any,
        take: limit
      })

      for (const search of noveltySearches) {
        let description = ''
        let kishoNote = ''

        const stage1Results = search.stage1Results as any
        const stage35Results = search.stage35Results as any[]
        
        if (search.status === 'COMPLETED') {
          const patentCount = stage1Results?.pqaiResults?.length || 0
          description = `Search complete. ${patentCount} patent matches found.`
          
          // Generate intelligent note based on results
          if (stage35Results && stage35Results.length > 0) {
            const highRelevance = stage35Results.filter((r: any) => r.relevanceScore >= 0.7).length
            if (highRelevance > 0) {
              kishoNote = `${highRelevance} high-relevance match${highRelevance > 1 ? 'es' : ''} found — review differentiation strategy.`
            } else {
              kishoNote = 'No blocking prior art detected. Strong novelty position.'
            }
          }
        } else if (search.status === 'FAILED') {
          description = 'Search encountered an error.'
          kishoNote = 'Consider rerunning the search or adjusting parameters.'
        } else {
          description = `Search in progress at stage ${search.currentStage || 1}.`
          kishoNote = 'Processing patent databases. Results coming soon.'
        }

        activities.push({
          id: `novelty-${search.id}`,
          type: 'novelty',
          title: search.title || 'Novelty Search',
          description,
          timestamp: search.createdAt.toISOString(),
          metadata: {
            searchId: search.id,
            status: search.status,
            projectName: search.project?.name
          },
          kishoNote
        })
      }
    } catch (e) {
      console.error('Error fetching novelty searches:', e)
    }

    // 3. Fetch recent ideas from idea bank
    try {
      const ideas = await prisma.ideaBankIdea.findMany({
        where: {
          AND: [
            {
              OR: [
                { createdBy: user.id },
                { tenantId: user.tenantId || undefined }
              ]
            },
            // A colleague's PRIVATE idea is confidential pre-filing subject matter and must not
            // reach another user's feed via the tenant branch above.
            { OR: [{ status: { not: 'PRIVATE' } }, { createdBy: user.id }] }
          ]
        },
        orderBy: { createdAt: 'desc' } as any,
        take: limit
      })

      for (const idea of ideas) {
        let kishoNote = ''
        
        if (idea.status === 'RESERVED') {
          kishoNote = 'This idea is reserved. Continue to drafting when ready.'
        } else if ((idea.noveltyScore || 0) >= 0.8) {
          kishoNote = 'High novelty score detected. Strong candidate for patenting.'
        } else if (idea.domainTags && (idea.domainTags as string[]).length > 2) {
          kishoNote = 'Cross-domain innovation detected — explore combination potential.'
        } else {
          kishoNote = 'Consider running novelty search to validate patentability.'
        }

        activities.push({
          id: `idea-${idea.id}`,
          type: 'idea',
          title: idea.title,
          description: idea.description.substring(0, 100) + (idea.description.length > 100 ? '...' : ''),
          timestamp: idea.createdAt.toISOString(),
          metadata: {
            ideaId: idea.id,
            status: idea.status,
            noveltyScore: idea.noveltyScore,
            domainTags: idea.domainTags
          },
          kishoNote
        })
      }
    } catch (e) {
      console.error('Error fetching ideas:', e)
    }

    // 4. Fetch active reservations
    try {
      const reservations = await prisma.ideaBankReservation.findMany({
        where: {
          userId: user.id,
          status: 'ACTIVE',
          expiresAt: { gt: new Date() }
        },
        include: {
          idea: {
            select: {
              id: true,
              title: true,
              description: true
            }
          }
        },
        orderBy: { reservedAt: 'desc' },
        take: limit
      })

      for (const reservation of reservations) {
        const daysRemaining = Math.ceil((reservation.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        
        let kishoNote = ''
        if (daysRemaining <= 7) {
          kishoNote = `Expiring soon! ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} left. Consider proceeding to drafting.`
        } else if (daysRemaining <= 14) {
          kishoNote = `${daysRemaining} days remaining. Plan your next steps.`
        } else {
          kishoNote = `Reservation active. ${daysRemaining} days remaining.`
        }

        activities.push({
          id: `reservation-${reservation.id}`,
          type: 'reservation',
          title: reservation.idea?.title || 'Reserved Idea',
          description: `Reservation active. ${daysRemaining} days remaining.`,
          timestamp: reservation.reservedAt.toISOString(),
          metadata: {
            reservationId: reservation.id,
            ideaId: reservation.ideaId,
            expiresAt: reservation.expiresAt.toISOString(),
            daysRemaining
          },
          kishoNote
        })
      }
    } catch (e) {
      console.error('Error fetching reservations:', e)
    }

    // Sort all activities by timestamp (most recent first)
    activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

    // Return the top N activities
    const result = activities.slice(0, limit)

    return NextResponse.json({
      success: true,
      activities: result,
      counts: {
        total: result.length,
        drafts: result.filter(a => a.type === 'draft').length,
        novelty: result.filter(a => a.type === 'novelty').length,
        ideas: result.filter(a => a.type === 'idea').length,
        reservations: result.filter(a => a.type === 'reservation').length
      }
    })
  } catch (error) {
    console.error('Activity feed error:', error)
    return NextResponse.json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}

