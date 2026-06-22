import { NextRequest, NextResponse } from 'next/server'
import { verifyJWT } from '@/lib/auth'
import { cancelNoveltySearch } from '@/lib/novelty-search-job-service'

export async function POST(request: NextRequest, { params }: { params: { searchId: string } }) {
  const header = request.headers.get('authorization')
  const userId = header?.startsWith('Bearer ') ? verifyJWT(header.slice(7))?.sub : null
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const result = await cancelNoveltySearch(params.searchId, userId)
  if (result.outcome === 'not_found') {
    return NextResponse.json({ error: 'Novelty search not found.' }, { status: 404 })
  }
  if (result.outcome === 'not_cancellable') {
    return NextResponse.json(
      { error: `A ${String(result.status).toLowerCase()} novelty search cannot be cancelled.` },
      { status: 409 },
    )
  }
  return NextResponse.json({ success: true, searchId: result.searchId, status: result.status })
}
