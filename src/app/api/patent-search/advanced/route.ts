import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { createPatentSearchQueryPlan, patentSearchOrchestrator } from '@/lib/patent-search'

export const runtime = 'nodejs'
export const maxDuration = 300

function headersToRecord(request: NextRequest) {
  const headers: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    headers[key] = value
  })
  return headers
}

function hasFilterCriteria(filters: unknown) {
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) return false
  return Object.values(filters).some(value => {
    if (Array.isArray(value)) return value.some(item => String(item || '').trim())
    return value !== undefined && value !== null && String(value).trim() !== ''
  })
}

export async function GET(request: NextRequest) {
  const auth = await authenticateUser(request)
  if (!auth.user) {
    return NextResponse.json({ error: auth.error?.message || 'Unauthorized' }, { status: auth.error?.status || 401 })
  }
  return NextResponse.json({ providers: patentSearchOrchestrator.getProviders() })
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateUser(request)
    if (!auth.user) {
      return NextResponse.json({ error: auth.error?.message || 'Unauthorized' }, { status: auth.error?.status || 401 })
    }

    const body = await request.json()
    const searchMode: 'manual' | 'intelligent' = body?.searchMode === 'manual' ? 'manual' : 'intelligent'
    const query = typeof body?.query === 'string' ? body.query.trim() : ''
    const inventionText = typeof body?.inventionText === 'string' ? body.inventionText.trim() : ''
    const title = typeof body?.title === 'string' ? body.title.trim() : ''
    if (!query && !inventionText && !body?.queryPlan?.searchQuery && !hasFilterCriteria(body?.filters)) {
      return NextResponse.json({ error: 'Search query or invention text is required.' }, { status: 400 })
    }

    const requestInput = {
      searchMode,
      query,
      title,
      inventionText,
      filters: body?.filters || {},
      providerIds: Array.isArray(body?.providerIds) ? body.providerIds : undefined,
      jurisdictions: Array.isArray(body?.jurisdictions) ? body.jurisdictions : undefined,
      sourceMode: body?.sourceMode,
      llmExpansion: body?.llmExpansion !== false,
      limit: Number(body?.limit || 20),
      candidateLimit: body?.candidateLimit !== undefined ? Number(body.candidateLimit) : undefined,
      offset: Number(body?.offset || 0),
      sort: body?.sort,
      queryPlan: body?.queryPlan,
      requestHeaders: headersToRecord(request),
    }

    if (body?.planOnly === true) {
      const queryPlan = await createPatentSearchQueryPlan(requestInput)
      return NextResponse.json({ queryPlan, providerStats: [], warnings: queryPlan.warnings, results: [] })
    }

    const response = await patentSearchOrchestrator.search(requestInput)

    return NextResponse.json(response)
  } catch (error) {
    console.error('[PatentSearch] Advanced search failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Patent search failed.' },
      { status: 500 }
    )
  }
}
