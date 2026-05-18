import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { searchPatentCorpus } from '@/lib/patent-corpus-service'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateUser(request)
    if (!auth.user) {
      return NextResponse.json({ error: auth.error?.message || 'Unauthorized' }, { status: auth.error?.status || 401 })
    }

    const body = await request.json()
    const query = typeof body?.query === 'string' ? body.query.trim() : ''
    const limit = Number(body?.limit || 20)

    if (!query) {
      return NextResponse.json({ error: 'Search query is required.' }, { status: 400 })
    }

    const results = await searchPatentCorpus(query, limit)
    return NextResponse.json({ results })
  } catch (error) {
    console.error('[PatentCorpus] Search failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Patent corpus search failed.' },
      { status: 500 }
    )
  }
}
