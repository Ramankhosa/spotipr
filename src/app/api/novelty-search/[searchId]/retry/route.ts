import { NextRequest, NextResponse } from 'next/server'
import { verifyJWT } from '@/lib/auth'
import { requeueNoveltySearch } from '@/lib/novelty-search-job-service'

export async function POST(request: NextRequest, { params }: { params: { searchId: string } }) {
  const header = request.headers.get('authorization')
  const userId = header?.startsWith('Bearer ') ? verifyJWT(header.slice(7))?.sub : null
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const result = await requeueNoveltySearch(params.searchId, userId)
  if (!result) return NextResponse.json({ error: 'Only failed background searches can be retried.' }, { status: 409 })
  return NextResponse.json({ success: true, ...result })
}
