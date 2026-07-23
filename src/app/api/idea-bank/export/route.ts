import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { z } from 'zod'

import { IdeaBankService } from '@/lib/idea-bank-service'
import { verifyJWT } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { enforceServiceAccess } from '@/lib/service-access-middleware'

const ideaBankService = new IdeaBankService()

// Force dynamic rendering since we access request headers and URL
export const dynamic = 'force-dynamic'

const exportSchema = z.object({
  query: z.string().optional(),
  domainTags: z.array(z.string()).optional(),
  technicalField: z.string().optional(),
  status: z.enum(['PUBLIC', 'RESERVED', 'LICENSED', 'ARCHIVED']).optional(),
  noveltyScoreMin: z.number().min(0).max(1).optional(),
  noveltyScoreMax: z.number().min(0).max(1).optional(),
  createdBy: z.string().optional(),
  tenantId: z.string().optional(),
})

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
    select: { id: true, email: true, name: true, tenantId: true },
  })

  return user
}

function buildExportRows(ideas: Awaited<ReturnType<IdeaBankService['exportIdeas']>>['ideas']) {
  return ideas.map((idea) => {
    const isReservedByCurrentUser = idea._isReservedByCurrentUser === true
    const safeDescription = idea._redactedDescription ?? idea.description

    return {
      id: idea.id,
      title: idea.title,
      status: idea.status,
      noveltyScore: idea.noveltyScore ?? '',
      domainTags: idea.domainTags.join(', '),
      technicalField: idea.technicalField ?? '',
      description: safeDescription,
      abstract: idea.abstract ?? '',
      keyFeatures: idea.keyFeatures.join('\n'),
      potentialApplications: idea.potentialApplications.join('\n'),
      priorArtSummary: idea.priorArtSummary ?? '',
      reservedCount: idea.reservedCount,
      reservedByCurrentUser: isReservedByCurrentUser ? 'yes' : 'no',
      creatorName: idea.creator.name ?? '',
      creatorEmail: idea.creator.email,
      tenantName: idea.tenant?.name ?? '',
      derivedFromId: idea.derivedFrom?.id ?? '',
      derivedFromTitle: idea.derivedFrom?.title ?? '',
      createdAt: idea.createdAt.toISOString(),
      publishedAt: idea.publishedAt?.toISOString() ?? '',
      updatedAt: idea.updatedAt.toISOString(),
    }
  })
}

export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Fails closed: a user with no tenant cannot be metered, so access is refused rather
    // than silently granted. Previously `if (user.tenantId)` skipped the check entirely.
    if (!user.tenantId) {
      return NextResponse.json(
        {
          error: 'Your account is not linked to an organisation, so usage cannot be metered. Please contact your administrator.',
          code: 'TENANT_UNRESOLVED'
        },
        { status: 403 }
      )
    }

    const serviceCheck = await enforceServiceAccess(user.id, user.tenantId, 'IDEA_BANK')
    if (!serviceCheck.allowed) {
      return serviceCheck.response
    }

    const url = new URL(request.url)
    const searchParams = Object.fromEntries(url.searchParams)

    const filters = exportSchema.parse({
      query: searchParams.query,
      domainTags: searchParams.domainTags ? searchParams.domainTags.split(',') : undefined,
      technicalField: searchParams.technicalField,
      status: searchParams.status,
      noveltyScoreMin: searchParams.noveltyScoreMin ? parseFloat(searchParams.noveltyScoreMin) : undefined,
      noveltyScoreMax: searchParams.noveltyScoreMax ? parseFloat(searchParams.noveltyScoreMax) : undefined,
      createdBy: searchParams.createdBy,
      tenantId: searchParams.tenantId,
    })

    const requestHeaders: Record<string, string> = {}
    request.headers.forEach((value, key) => {
      requestHeaders[key] = value
    })

    const exportResult = await ideaBankService.exportIdeas(requestHeaders, filters, user)
    const rows = buildExportRows(exportResult.ideas)

    const headerOrder = [
      'id',
      'title',
      'status',
      'noveltyScore',
      'domainTags',
      'technicalField',
      'description',
      'abstract',
      'keyFeatures',
      'potentialApplications',
      'priorArtSummary',
      'reservedCount',
      'reservedByCurrentUser',
      'creatorName',
      'creatorEmail',
      'tenantName',
      'derivedFromId',
      'derivedFromTitle',
      'createdAt',
      'publishedAt',
      'updatedAt',
    ] as const

    const worksheet = XLSX.utils.json_to_sheet(rows, { header: [...headerOrder] })
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'IdeaBank')

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
    const dateStamp = new Date().toISOString().slice(0, 10)
    const filename = `idea-bank-export-${dateStamp}.xlsx`

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
        'X-Export-Count': String(exportResult.ideas.length),
        'X-Export-TotalCount': String(exportResult.totalCount),
        'X-Export-Truncated': exportResult.truncated ? 'true' : 'false',
        'X-Export-Limit': String(exportResult.appliedLimit),
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 })
    }

    console.error('Failed to export idea bank ideas:', error)
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    )
  }
}
